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

  // A forgotten block only sends the next request to the store, so a limit is safe here.
  it("forgets the oldest block once it holds 10,000", () => {
    const cache = blockedCache()

    for (let index = 0; index <= 10_000; index += 1) cache.block(`k${index}`, 1, denial)

    expect(cache.lookup("k0", 1)).toBeUndefined()
    expect(cache.lookup("k1", 1)).toBeDefined()
    expect(cache.lookup("k10000", 1)).toBeDefined()
  })

  it("forgets a cleared key", () => {
    const cache = blockedCache()
    cache.block("k", 2, denial)

    cache.clear("k")

    expect(cache.lookup("k", 2)).toBeUndefined()
  })
})
