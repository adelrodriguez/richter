import { describe, expect, it } from "vitest"
import type { Algorithm } from "#lib/algorithms/algorithms.ts"
import type { Store, StoreResult } from "#lib/store/store.ts"
import { fixedWindow, slidingWindow, tokenBucket } from "#lib/algorithms/algorithms.ts"

// The behaviour every store must have. These tests use the store's real clock, so they use short
// windows and wait for the times the store reports.

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

// Waits until `result.reset` on the store's clock, plus a margin for scheduling.
function untilReset(result: StoreResult) {
  return sleep(result.reset - result.now + 20)
}

function uniqueKey() {
  return `test:${crypto.randomUUID()}`
}

// Starts a test early in a fresh window, so the window does not roll over during the test.
async function freshKey(store: Store, algorithm: Algorithm) {
  const key = uniqueKey()
  const probe = await store.consume({ algorithm, cost: 0, key })

  if (algorithm.type !== "tokenBucket" && probe.reset - probe.now < algorithm.window / 2) {
    await untilReset(probe)
  }

  return key
}

export function testStore(createStore: () => Store) {
  const algorithms = {
    fixedWindow: fixedWindow({ limit: 5, window: 2000 }),
    slidingWindow: slidingWindow({ limit: 5, window: 2000 }),
    tokenBucket: tokenBucket({ capacity: 5, interval: 2000, refillRate: 1 }),
  } satisfies Record<Algorithm["type"], Algorithm>

  describe.each(Object.values(algorithms))("$type", (algorithm) => {
    it("allows exactly the capacity when requests arrive together", async () => {
      const store = createStore()
      const key = await freshKey(store, algorithm)

      const results = await Promise.all(
        Array.from({ length: 20 }, () => store.consume({ algorithm, cost: 1, key }))
      )

      expect(results.filter((result) => result.success)).toHaveLength(5)
    })

    it("counts down the remaining units, then denies", async () => {
      const store = createStore()
      const key = await freshKey(store, algorithm)
      const spend = () => store.consume({ algorithm, cost: 1, key })
      const results = [
        await spend(),
        await spend(),
        await spend(),
        await spend(),
        await spend(),
        await spend(),
      ]

      expect(results.map((result) => [result.success, result.remaining])).toEqual([
        [true, 4],
        [true, 3],
        [true, 2],
        [true, 1],
        [true, 0],
        [false, 0],
      ])
    })

    it("spends nothing on a denied request", async () => {
      const store = createStore()
      const key = await freshKey(store, algorithm)

      await store.consume({ algorithm, cost: 4, key })
      const denied = await store.consume({ algorithm, cost: 2, key })
      const allowed = await store.consume({ algorithm, cost: 1, key })

      expect(denied).toMatchObject({ remaining: 1, success: false })
      expect(allowed).toMatchObject({ remaining: 0, success: true })
    })

    it("reads without spending for a cost of 0", async () => {
      const store = createStore()
      const key = await freshKey(store, algorithm)

      await store.consume({ algorithm, cost: 2, key })
      const first = await store.consume({ algorithm, cost: 0, key })
      const second = await store.consume({ algorithm, cost: 0, key })

      expect(first).toMatchObject({ remaining: 3, success: true })
      expect(second).toMatchObject({ remaining: 3, success: true })
    })

    it("reads the same remaining units and reset as the request before it", async () => {
      const store = createStore()
      const key = await freshKey(store, algorithm)

      const spent = await store.consume({ algorithm, cost: 2, key })
      const read = await store.consume({ algorithm, cost: 0, key })

      expect(read).toMatchObject({ remaining: spent.remaining, reset: spent.reset })
    })

    it("reads the units that came back after a reset", async () => {
      const store = createStore()
      const key = await freshKey(store, algorithm)

      await store.consume({ algorithm, cost: 5, key })
      const denied = await store.consume({ algorithm, cost: 1, key })
      await untilReset(denied)
      const read = await store.consume({ algorithm, cost: 0, key })

      expect(read.remaining).toBeGreaterThanOrEqual(1)
    })

    it("allows a denied request again at its reset", async () => {
      const store = createStore()
      const key = await freshKey(store, algorithm)

      await store.consume({ algorithm, cost: 5, key })
      const denied = await store.consume({ algorithm, cost: 1, key })
      expect(denied.success).toBe(false)
      expect(denied.reset).toBeGreaterThan(denied.now)

      await untilReset(denied)

      expect(await store.consume({ algorithm, cost: 1, key })).toMatchObject({ success: true })
    })

    it("counts each key separately", async () => {
      const store = createStore()
      const key = await freshKey(store, algorithm)

      await store.consume({ algorithm, cost: 5, key })

      expect(await store.consume({ algorithm, cost: 1, key: uniqueKey() })).toMatchObject({
        remaining: 4,
        success: true,
      })
    })

    it("restores all units when cleared", async () => {
      const store = createStore()
      const key = await freshKey(store, algorithm)

      await store.consume({ algorithm, cost: 5, key })
      await store.clear(key)

      expect(await store.consume({ algorithm, cost: 1, key })).toMatchObject({
        remaining: 4,
        success: true,
      })
    })
  })

  it("ends fixed windows at multiples of the window size", async () => {
    const store = createStore()
    const result = await store.consume({
      algorithm: algorithms.fixedWindow,
      cost: 1,
      key: uniqueKey(),
    })

    expect(result.reset % 2000).toBe(0)
    expect(result.reset - result.now).toBeLessThanOrEqual(2000)
  })

  it("reports the next refill as the reset of a token bucket", async () => {
    const store = createStore()
    const result = await store.consume({
      algorithm: algorithms.tokenBucket,
      cost: 1,
      key: uniqueKey(),
    })

    expect(result.reset - result.now).toBe(2000)
  })
}
