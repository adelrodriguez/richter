import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { blockedCache } from "#lib/limiter/blocked-cache.ts"

// A denial that the store made at its own time 1000, with a reset 5000 ms later.
const denial = { now: 1000, remaining: 0, reset: 6000, success: false }

describe("blockedCache", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 50_000 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("answers the cost it was denied for until the store's wait ends on the local clock", () => {
    const cache = blockedCache()
    cache.block("k", 2, denial)

    vi.advanceTimersByTime(1000)
    expect(cache.lookup("k", 2)).toEqual({ remaining: 0, reset: 6000, retryAfter: 4000 })

    vi.advanceTimersByTime(4000)
    expect(cache.lookup("k", 2)).toBeUndefined()
  })

  it("does not answer any other cost", () => {
    const cache = blockedCache()
    cache.block("k", 2, denial)

    expect(cache.lookup("k", 1)).toBeUndefined()
    expect(cache.lookup("k", 3)).toBeUndefined()
  })

  it("forgets a cleared key", () => {
    const cache = blockedCache()
    cache.block("k", 2, denial)

    cache.clear("k")

    expect(cache.lookup("k", 2)).toBeUndefined()
  })
})
