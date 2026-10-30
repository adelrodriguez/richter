import type { FixedWindow, SlidingWindow, TokenBucket } from "#lib/algorithms/algorithms.ts"
import type { Store, StoreResult } from "#lib/store/store.ts"
import { expiringMap } from "#lib/expiring-map/expiring-map.ts"

type FixedWindowState = {
  readonly type: "fixedWindow"
  readonly window: number
  readonly count: number
  readonly expiresAt: number
}

type SlidingWindowState = {
  readonly type: "slidingWindow"
  readonly window: number
  readonly current: number
  readonly previous: number
  readonly expiresAt: number
}

type TokenBucketState = {
  readonly type: "tokenBucket"
  readonly tokens: number
  readonly refilledAt: number
  readonly expiresAt: number
}

type State = FixedWindowState | SlidingWindowState | TokenBucketState

// A transition without `state` leaves the stored state unchanged.
type Transition = { readonly result: StoreResult; readonly state?: State }

export type MemoryStoreOptions = {
  /**
   * Returns the current time in epoch ms. Defaults to `Date.now`.
   */
  readonly clock?: () => number
}

/**
 * Counts in this process. Each instance of an application counts separately, and a restart clears
 * all counts. Use it for tests, single-instance applications, and as a fallback store.
 */
export function memoryStore({ clock = Date.now }: MemoryStoreOptions = {}): Store {
  const states = expiringMap<State>()

  return {
    clear: (key) => {
      states.delete(key)
      return Promise.resolve()
    },

    // JavaScript runs this body to completion before any other call, so each call is atomic.
    consume: ({ key, algorithm, cost }) => {
      const now = clock()
      const state = states.get(key, now)
      const transition =
        algorithm.type === "fixedWindow"
          ? applyFixedWindow(algorithm, state, cost, now)
          : algorithm.type === "slidingWindow"
            ? applySlidingWindow(algorithm, state, cost, now)
            : applyTokenBucket(algorithm, state, cost, now)

      // A cost of 0 reads without writing.
      if (cost > 0 && transition.state !== undefined) states.set(key, transition.state, now)

      return Promise.resolve(transition.result)
    },
  }
}

function applyFixedWindow(
  { limit, window: size }: FixedWindow,
  state: State | undefined,
  cost: number,
  now: number
): Transition {
  const window = Math.floor(now / size)
  const reset = (window + 1) * size
  const count = state?.type === "fixedWindow" && state.window === window ? state.count : 0

  if (count + cost > limit) {
    return { result: { now, remaining: limit - count, reset, success: false } }
  }

  return {
    result: { now, remaining: limit - count - cost, reset, success: true },
    state: { count: count + cost, expiresAt: reset, type: "fixedWindow", window },
  }
}

function applySlidingWindow(
  { limit, window: size }: SlidingWindow,
  state: State | undefined,
  cost: number,
  now: number
): Transition {
  const window = Math.floor(now / size)
  const start = window * size
  const { current, previous } = slidingWindowCounts(state, window)
  // The previous window counts in proportion to how much of it the sliding period still covers.
  const used = Math.floor((previous * (size - (now - start))) / size) + current

  if (used + cost > limit) {
    return {
      result: {
        now,
        remaining: Math.max(0, limit - used),
        reset: slidingWindowRetry({ cost, current, limit, previous, size, start }),
        success: false,
      },
    }
  }

  return {
    result: { now, remaining: limit - used - cost, reset: start + size, success: true },
    state: {
      current: current + cost,
      expiresAt: start + 2 * size,
      previous,
      type: "slidingWindow",
      window,
    },
  }
}

function slidingWindowCounts(state: State | undefined, window: number) {
  if (state?.type !== "slidingWindow") return { current: 0, previous: 0 }
  if (state.window === window) return { current: state.current, previous: state.previous }
  if (state.window === window - 1) return { current: 0, previous: state.current }

  return { current: 0, previous: 0 }
}

// Finds the first millisecond at which a request of `cost` succeeds. Within the current window it
// needs floor(previous * (size - elapsed) / size) <= limit - current - cost. When the current
// window alone is too full, the request waits for the next window, where `current` becomes the
// previous count. Integer arithmetic keeps this identical to the Redis script.
function slidingWindowRetry({
  cost,
  current,
  limit,
  previous,
  size,
  start,
}: {
  cost: number
  current: number
  limit: number
  previous: number
  size: number
  start: number
}) {
  const room = limit - current - cost

  if (room >= 0) {
    return Math.min(start + Math.floor((size * (previous - room - 1)) / previous) + 1, start + size)
  }

  const nextRoom = limit - cost

  return Math.min(
    start + size + Math.floor((size * (current - nextRoom - 1)) / current) + 1,
    start + 2 * size
  )
}

function applyTokenBucket(
  { capacity, interval, refillRate }: TokenBucket,
  state: State | undefined,
  cost: number,
  now: number
): Transition {
  const { refilledAt, tokens } = refill(state, { capacity, interval, refillRate }, now)

  if (tokens < cost) {
    const refills = Math.ceil((cost - tokens) / refillRate)

    return {
      result: { now, remaining: tokens, reset: refilledAt + refills * interval, success: false },
    }
  }

  const remaining = tokens - cost
  const result = { now, remaining, reset: refilledAt + interval, success: true }

  // A missing bucket is a full bucket, so the state can expire once the bucket refills.
  const expiresAt = refilledAt + Math.ceil((capacity - remaining) / refillRate) * interval

  return { result, state: { expiresAt, refilledAt, tokens: remaining, type: "tokenBucket" } }
}

function refill(
  state: State | undefined,
  { capacity, interval, refillRate }: Omit<TokenBucket, "type">,
  now: number
) {
  if (state?.type !== "tokenBucket") return { refilledAt: now, tokens: capacity }

  const refills = Math.max(0, Math.floor((now - state.refilledAt) / interval))

  return {
    refilledAt: state.refilledAt + refills * interval,
    tokens: Math.min(capacity, state.tokens + refills * refillRate),
  }
}
