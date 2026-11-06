import type { Store } from "#lib/store/index.ts"
import type { State } from "#lib/transitions/index.ts"
import { expiringMap } from "#lib/expiring-map/index.ts"
import { transition } from "#lib/transitions/index.ts"

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
      const { result, state } = transition(algorithm, states.get(key, now), cost, now)

      if (state !== undefined) states.set(key, state, now)

      return Promise.resolve(result)
    },
  }
}
