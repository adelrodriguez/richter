import { describe, expect, it } from "vitest"
import type { Algorithm } from "#lib/algorithms/algorithms.ts"
import type { State } from "#lib/transitions/index.ts"
import { fixedWindow, slidingWindow, tokenBucket } from "#lib/algorithms/algorithms.ts"
import { transition } from "#lib/transitions/index.ts"

// Sends requests for one key one after another, and keeps the state each transition returns, as a
// store does.
function oneKey(algorithm: Algorithm) {
  let stored: State | undefined

  return (cost: number, now: number) => {
    const { result, state } = transition(algorithm, stored, cost, now)
    stored = state ?? stored
    return result
  }
}

describe("transition", () => {
  describe("slidingWindow", () => {
    const algorithm = slidingWindow({ limit: 10, window: 1000 })

    it("counts the previous window in proportion to its overlap", () => {
      const request = oneKey(algorithm)
      request(8, 10_000)

      // 25% into the next window, 75% of the previous window's 8 units still count.
      expect(request(0, 11_250)).toMatchObject({ remaining: 4 })
    })

    it("resets a denial at the first millisecond the request succeeds", () => {
      const request = oneKey(algorithm)
      request(8, 10_000)
      request(2, 11_000)

      const denied = request(1, 11_000)
      expect(denied.success).toBe(false)

      expect(request(1, denied.reset - 1)).toMatchObject({ success: false })
      expect(request(1, denied.reset)).toMatchObject({ success: true })
    })

    it("waits for the next window when the current window alone is full", () => {
      const request = oneKey(algorithm)
      request(10, 10_000)

      const denied = request(4, 10_000)
      // In the next window, floor(10 * (1 - elapsed)) must be at most 6: past 30% of the way in.
      expect(denied.reset).toBe(11_301)

      expect(request(4, 11_300)).toMatchObject({ success: false })
      expect(request(4, 11_301)).toMatchObject({ success: true })
    })

    it("forgets windows older than the previous window", () => {
      const request = oneKey(algorithm)
      request(10, 10_000)

      expect(request(0, 12_000)).toMatchObject({ remaining: 10 })
    })
  })

  describe("fixedWindow", () => {
    it("starts a new count in the next window", () => {
      const request = oneKey(fixedWindow({ limit: 3, window: 1000 }))
      request(3, 10_999)

      expect(request(1, 11_000)).toMatchObject({ remaining: 2, reset: 12_000, success: true })
    })
  })

  describe("tokenBucket", () => {
    const algorithm = tokenBucket({ capacity: 5, interval: 1000, refillRate: 2 })

    it("adds refillRate tokens per whole interval, up to the capacity", () => {
      const request = oneKey(algorithm)
      request(5, 10_000)

      expect(request(0, 11_999)).toMatchObject({ remaining: 2 })
      expect(request(0, 20_000)).toMatchObject({ remaining: 5 })
    })

    it("resets a denial when enough tokens refill for its cost", () => {
      const request = oneKey(algorithm)
      request(5, 10_000)

      const denied = request(3, 10_000)
      expect(denied.reset).toBe(12_000)

      expect(request(3, 11_999)).toMatchObject({ success: false })
      expect(request(3, 12_000)).toMatchObject({ success: true })
    })

    it("keeps refills on the interval grid across requests", () => {
      const request = oneKey(algorithm)
      request(5, 10_000)
      request(1, 11_500)

      expect(request(0, 12_000)).toMatchObject({ remaining: 3 })
    })
  })

  it("returns no state to write after a denial", () => {
    const algorithm = fixedWindow({ limit: 1, window: 1000 })
    const spent = transition(algorithm, undefined, 1, 10_000)

    expect(transition(algorithm, spent.state, 1, 10_000)).toStrictEqual({
      result: { now: 10_000, remaining: 0, reset: 11_000, success: false },
    })
  })

  it.each(
    Object.values({
      fixedWindow: fixedWindow({ limit: 5, window: 1000 }),
      slidingWindow: slidingWindow({ limit: 5, window: 1000 }),
      tokenBucket: tokenBucket({ capacity: 5, interval: 1000, refillRate: 1 }),
    } satisfies Record<Algorithm["type"], Algorithm>)
  )("returns no state to write for a cost of 0 with $type", (algorithm) => {
    expect(transition(algorithm, undefined, 0, 10_000)).toStrictEqual({
      result: { now: 10_000, remaining: 5, reset: 11_000, success: true },
    })
  })

  it("counts a state that another algorithm wrote as no state", () => {
    const { state } = transition(fixedWindow({ limit: 5, window: 1000 }), undefined, 5, 10_000)
    const bucket = tokenBucket({ capacity: 5, interval: 1000, refillRate: 1 })

    expect(transition(bucket, state, 1, 10_000).result).toStrictEqual({
      now: 10_000,
      remaining: 4,
      reset: 11_000,
      success: true,
    })
  })
})
