import { describe, expect, it } from "vitest"
import { fixedWindow, slidingWindow, tokenBucket } from "#lib/algorithms/algorithms.ts"
import { InvalidOptionError } from "#lib/options/options.ts"

// The longest period every store can expire state for. See `MAX_PERIOD` in algorithms.ts.
const longest = 2 ** 50

describe("algorithms", () => {
  it.each([fixedWindow, slidingWindow])("accepts a window of up to 2^50 ms for %o", (window) => {
    expect(window({ limit: 1, window: longest }).window).toBe(longest)
    expect(() => window({ limit: 1, window: longest + 1 })).toThrow(InvalidOptionError)
  })

  it("accepts a token bucket that refills completely in up to 2^50 ms", () => {
    expect(() => tokenBucket({ capacity: 4, interval: longest / 4, refillRate: 1 })).not.toThrow()
    expect(() => tokenBucket({ capacity: 5, interval: longest / 4, refillRate: 1 })).toThrow(
      InvalidOptionError
    )
  })

  it("rejects a token bucket whose full refill is too long for any store to expire", () => {
    expect(() =>
      tokenBucket({
        capacity: Number.MAX_SAFE_INTEGER,
        interval: Number.MAX_SAFE_INTEGER,
        refillRate: 1,
      })
    ).toThrow(InvalidOptionError)
  })
})
