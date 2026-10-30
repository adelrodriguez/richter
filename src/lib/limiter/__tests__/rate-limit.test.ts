import { describe, expect, it } from "vitest"
import type { Limiter } from "#lib/limiter/build-limiter.ts"
import type { Store, StoreRequest } from "#lib/store/store.ts"
import { fixedWindow } from "#lib/algorithms/algorithms.ts"
import { buildLimiter } from "#lib/limiter/build-limiter.ts"
import { StoreError } from "#lib/limiter/errors.ts"
import { headers } from "#lib/limiter/headers.ts"
import { clear, rateLimit, remaining } from "#lib/limiter/rate-limit.ts"
import { InvalidOptionError } from "#lib/options/options.ts"
import { memoryStore } from "#lib/stores/memory/memory-store.ts"
import { failingStore, recordingStore } from "./stores.ts"

type Chain = readonly [Limiter, Limiter]

const threePerMinute = fixedWindow({ limit: 3, window: 60_000 })

describe("rateLimit", () => {
  it("returns the counts of an allowed request", async () => {
    const limiter = buildLimiter({ store: memoryStore() })({ algorithm: threePerMinute, name: "x" })

    const result = await rateLimit(limiter, "k")

    expect(result).toMatchObject({
      limit: 3,
      name: "x",
      reason: "store",
      remaining: 2,
      success: true,
      window: 60_000,
    })
    expect(result.success && result.retryAfter).toBeGreaterThan(0)
  })

  it("denies once the limit is spent", async () => {
    const limiter = buildLimiter({ store: memoryStore() })({ algorithm: threePerMinute, name: "x" })

    await rateLimit(limiter, "k", { cost: 3 })

    expect(await rateLimit(limiter, "k")).toMatchObject({
      reason: "store",
      remaining: 0,
      success: false,
    })
  })

  it.each([0, -1, 1.5, 4, Number.NaN])("rejects a cost of %s", async (cost) => {
    const limiter = buildLimiter({ store: memoryStore() })({ algorithm: threePerMinute, name: "x" })

    await expect(rateLimit(limiter, "k", { cost })).rejects.toThrow(InvalidOptionError)
  })

  describe("with several limiters", () => {
    it("stops at the first denial and spends nothing on later limiters", async () => {
      const { requests, store } = recordingStore()
      const limiter = buildLimiter({ store })
      const strict = limiter({
        algorithm: fixedWindow({ limit: 1, window: 60_000 }),
        name: "strict",
      })
      const loose = limiter({ algorithm: threePerMinute, name: "loose" })
      await rateLimit([strict, loose], "k")

      const result = await rateLimit([strict, loose], "k")

      expect(result).toMatchObject({ name: "strict", success: false })
      expect(result.results).toHaveLength(1)
      expect(requests.map((request) => request.key)).toEqual(["strict:k", "loose:k", "strict:k"])
    })

    it("returns the allowed result with the fewest units remaining", async () => {
      const limiter = buildLimiter({ store: memoryStore() })
      const roomy = limiter({
        algorithm: fixedWindow({ limit: 10, window: 60_000 }),
        name: "roomy",
      })
      const tight = limiter({ algorithm: threePerMinute, name: "tight" })

      const result = await rateLimit([roomy, tight], "k")

      expect(result).toMatchObject({ name: "tight", remaining: 2, success: true })
      expect(result.results.map((each) => each.name)).toEqual(["roomy", "tight"])
    })

    it("does not stop at a dry-run limiter", async () => {
      const limiter = buildLimiter({ store: memoryStore() })
      const watched = limiter({
        algorithm: fixedWindow({ limit: 1, window: 60_000 }),
        mode: "dryRun",
        name: "watched",
      })
      const enforced = limiter({ algorithm: threePerMinute, name: "enforced" })
      await rateLimit(watched, "k")

      const result = await rateLimit([watched, enforced], "k")

      expect(result.success).toBe(true)
      expect(result.results.map((each) => each.reason)).toEqual(["dryRun", "store"])
    })

    it.each([
      ["before", (watched: Limiter, enforced: Limiter): Chain => [watched, enforced]],
      ["after", (watched: Limiter, enforced: Limiter): Chain => [enforced, watched]],
    ])(
      "decides by an enforced limiter when a spent dry-run limiter runs %s it",
      async (_order, chain) => {
        const limiter = buildLimiter({ store: memoryStore({ clock: () => 0 }) })
        const watched = limiter({
          algorithm: fixedWindow({ limit: 1, window: 60_000 }),
          mode: "dryRun",
          name: "watched",
        })
        const enforced = limiter({ algorithm: threePerMinute, name: "enforced" })
        await rateLimit(watched, "k")

        const result = await rateLimit(chain(watched, enforced), "k")

        expect(result).toMatchObject({ mode: "enforce", name: "enforced", remaining: 2 })
        expect(headers(result)).toHaveProperty("RateLimit", '"enforced";r=2;t=60')
      }
    )

    it("stops at a store error", async () => {
      const healthy = buildLimiter({ store: memoryStore() })({
        algorithm: threePerMinute,
        name: "healthy",
      })
      const broken = buildLimiter({ store: failingStore })({
        algorithm: threePerMinute,
        name: "broken",
      })

      const result = await rateLimit([broken, healthy], "k")

      expect(result).toMatchObject({ name: "broken", reason: "storeError", success: false })
      expect(result.results).toHaveLength(1)
    })

    it("checks the cost against every limiter before spending", async () => {
      const { requests, store } = recordingStore()
      const limiter = buildLimiter({ store })
      const large = limiter({
        algorithm: fixedWindow({ limit: 10, window: 60_000 }),
        name: "large",
      })
      const small = limiter({ algorithm: threePerMinute, name: "small" })

      await expect(rateLimit([large, small], "k", { cost: 5 })).rejects.toThrow(InvalidOptionError)
      expect(requests).toHaveLength(0)
    })

    it("answers a remembered denial of a later limiter before any limiter spends", async () => {
      const { requests, store } = recordingStore()
      const limiter = buildLimiter({ store })
      const narrow = limiter({ algorithm: threePerMinute, name: "narrow" })
      const broad = limiter({ algorithm: fixedWindow({ limit: 1, window: 60_000 }), name: "broad" })
      await rateLimit([narrow, broad], "k")
      await rateLimit([narrow, broad], "k")
      requests.length = 0

      const result = await rateLimit([narrow, broad], "k")

      expect(result).toMatchObject({ name: "broad", reason: "cache", success: false })
      expect(result.results).toHaveLength(1)
      expect(requests).toHaveLength(0)
      await expect(remaining(narrow, "k")).resolves.toMatchObject({ remaining: 1 })
    })

    it("uses a denial remembered while an earlier limiter waits for the store", async () => {
      const memory = memoryStore()
      const paused = Promise.withResolvers<undefined>()
      let broadFails = false
      let broadCalls = 0
      const store: Store = {
        clear: memory.clear,
        consume: async (request: StoreRequest) => {
          if (request.key.startsWith("narrow:")) await paused.promise
          if (request.key.startsWith("broad:")) {
            broadCalls += 1
            if (broadFails) throw new Error("connection refused")
          }
          return memory.consume(request)
        },
      }
      const limiter = buildLimiter({ store })
      const narrow = limiter({ algorithm: threePerMinute, name: "narrow" })
      const broad = limiter({ algorithm: fixedWindow({ limit: 1, window: 60_000 }), name: "broad" })
      await rateLimit(broad, "k")

      const chain = rateLimit([narrow, broad], "k")
      await expect(rateLimit(broad, "k")).resolves.toMatchObject({ reason: "store" })
      broadFails = true
      paused.resolve()
      const result = await chain

      expect(result).toMatchObject({ name: "broad", reason: "cache", success: false })
      expect(result.results.map((each) => each.name)).toEqual(["narrow", "broad"])
      expect(broadCalls).toBe(2)
    })

    it("does not run later identify functions after a remembered denial", async () => {
      const identified: string[] = []
      const limiter = buildLimiter({ store: memoryStore() })
      const blocked = limiter({
        algorithm: fixedWindow({ limit: 1, window: 60_000 }),
        identify: (input: string) => {
          identified.push("blocked")
          return input
        },
        name: "blocked",
      })
      const later = limiter({
        algorithm: threePerMinute,
        identify: (input: string) => {
          identified.push("later")
          return input
        },
        name: "later",
      })
      await rateLimit(blocked, "k")
      await rateLimit(blocked, "k")
      identified.length = 0

      await rateLimit([blocked, later], "k")

      expect(identified).toEqual(["blocked"])
    })
  })
})

describe("remaining", () => {
  it("reads the units left without spending any", async () => {
    const limiter = buildLimiter({ store: memoryStore() })({ algorithm: threePerMinute, name: "x" })
    await rateLimit(limiter, "k")

    await remaining(limiter, "k")

    expect(await remaining(limiter, "k")).toMatchObject({ limit: 3, name: "x", remaining: 2 })
  })

  it("rejects with StoreError when the store fails", async () => {
    const limiter = buildLimiter({ store: failingStore })({ algorithm: threePerMinute, name: "x" })

    await expect(remaining(limiter, "k")).rejects.toThrow(StoreError)
  })
})

describe("clear", () => {
  it("restores every unit and forgets a cached denial", async () => {
    const limiter = buildLimiter({ store: memoryStore() })({ algorithm: threePerMinute, name: "x" })
    await rateLimit(limiter, "k", { cost: 3 })
    await rateLimit(limiter, "k")

    await clear(limiter, "k")

    expect(await rateLimit(limiter, "k")).toMatchObject({
      reason: "store",
      remaining: 2,
      success: true,
    })
  })

  it("rejects with StoreError when the store fails", async () => {
    const limiter = buildLimiter({ store: failingStore })({ algorithm: threePerMinute, name: "x" })

    await expect(clear(limiter, "k")).rejects.toThrow(StoreError)
  })
})
