import { describe, expect, it } from "vitest"
import type { Limiter } from "#lib/limiter/build-limiter.ts"
import type { Identity } from "#lib/limiter/identity.ts"
import type { Store, StoreRequest } from "#lib/store/store.ts"
import { fixedWindow, tokenBucket } from "#lib/algorithms/algorithms.ts"
import { buildLimiter } from "#lib/limiter/build-limiter.ts"
import { StoreError, StoreTimeoutError } from "#lib/limiter/errors.ts"
import { headers } from "#lib/limiter/headers.ts"
import { clear, rateLimit, remaining } from "#lib/limiter/rate-limit.ts"
import { InvalidOptionError } from "#lib/options/options.ts"
import { memoryStore } from "#lib/stores/memory/memory-store.ts"

function recordingStore(store: Store = memoryStore()) {
  const requests: StoreRequest[] = []

  return {
    requests,
    store: {
      clear: store.clear,
      consume: (request: StoreRequest) => {
        requests.push(request)
        return store.consume(request)
      },
    } satisfies Store,
  }
}

const failingStore: Store = {
  clear: () => Promise.reject(new Error("connection refused")),
  consume: () => Promise.reject(new Error("connection refused")),
}

// Never answers.
const silentStore: Store = {
  clear: () => Promise.withResolvers<never>().promise,
  consume: () => Promise.withResolvers<never>().promise,
}

type Chain = readonly [Limiter, Limiter]

const threePerMinute = fixedWindow({ limit: 3, window: 60_000 })

describe("buildLimiter", () => {
  it("prefixes keys with the limiter name", async () => {
    const { requests, store } = recordingStore()
    const limiter = buildLimiter({ store })({ algorithm: threePerMinute, name: "suggestions:ip" })

    await rateLimit(limiter, "203.0.113.7")

    expect(requests.map((request) => request.key)).toEqual(["suggestions:ip:203.0.113.7"])
  })

  it("starts every key with the prefix, and keeps it out of the name", async () => {
    const { requests, store } = recordingStore()
    const limiter = buildLimiter({ prefix: "app", store })({
      algorithm: threePerMinute,
      name: "suggestions:ip",
    })

    const result = await rateLimit(limiter, "203.0.113.7")

    expect(requests.map((request) => request.key)).toEqual(["app:suggestions:ip:203.0.113.7"])
    expect(result.name).toBe("suggestions:ip")
    expect(limiter.name).toBe("suggestions:ip")
  })

  it("keeps the counts of limiters with different prefixes apart in one store", async () => {
    const store = memoryStore()
    const options = { algorithm: fixedWindow({ limit: 1, window: 60_000 }), name: "api" }
    const first = buildLimiter({ prefix: "first", store })(options)
    const second = buildLimiter({ prefix: "second", store })(options)

    await rateLimit(first, "ada")

    await expect(rateLimit(first, "ada")).resolves.toMatchObject({ success: false })
    await expect(rateLimit(second, "ada")).resolves.toMatchObject({ success: true })
  })

  it("rejects a prefix that is empty or not printable ASCII", () => {
    const store = memoryStore()

    expect(() => buildLimiter({ prefix: "", store })).toThrow(InvalidOptionError)
    expect(() => buildLimiter({ prefix: "límite", store })).toThrow(InvalidOptionError)
  })

  it("gives every identity its own key, even when names and parts contain separators", async () => {
    const { requests, store } = recordingStore()
    const limiter = buildLimiter({ store })
    const short = limiter({ algorithm: threePerMinute, name: "a" })
    const long = limiter({ algorithm: threePerMinute, name: "a:b" })

    await rateLimit(short, ["b", "c"])
    await rateLimit(long, "c")
    await rateLimit(short, "b:c")
    await rateLimit(short, "b|c")
    await rateLimit(short, "::1")

    const keys = requests.map((request) => request.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toContain("a:b|c")
  })

  it("counts every null identity against one global key", async () => {
    const { requests, store } = recordingStore()
    const limiter = buildLimiter({ store })
    const short = limiter({ algorithm: threePerMinute, name: "a" })
    const long = limiter({ algorithm: threePerMinute, name: "a:b" })
    const daily = limiter({ algorithm: threePerMinute, identify: () => null, name: "daily" })

    await rateLimit(long, null)
    await rateLimit(short, "b")
    await rateLimit(long, "")
    await rateLimit(long, "%00")
    await rateLimit(daily, "anything")
    await rateLimit(daily, "else")

    const keys = requests.map((request) => request.key)
    expect(new Set(keys.slice(0, 4)).size).toBe(4)
    expect(keys[4]).toBe(keys[5])
  })

  it("passes the input to identify", async () => {
    const { requests, store } = recordingStore()
    const limiter = buildLimiter({ store })({
      algorithm: threePerMinute,
      identify: (request: { ip: string; user: string }) =>
        Promise.resolve<Identity>([request.ip, request.user]),
      name: "chat",
    })

    await rateLimit(limiter, { ip: "203.0.113.7", user: "ada" })

    expect(requests[0]?.key).toBe("chat:203.0.113.7|ada")
  })

  it("rejects a name that headers cannot carry", () => {
    const limiter = buildLimiter({ store: memoryStore() })

    expect(() => limiter({ algorithm: threePerMinute, name: "" })).toThrow(InvalidOptionError)
    expect(() => limiter({ algorithm: threePerMinute, name: "límite" })).toThrow(InvalidOptionError)
  })

  it("rejects a timeout that is not a positive integer", () => {
    expect(() =>
      buildLimiter({ store: memoryStore(), timeout: 0 })({ algorithm: threePerMinute, name: "x" })
    ).toThrow(InvalidOptionError)
  })

  it("lets limiter settings override factory settings", async () => {
    const limiter = buildLimiter({ store: silentStore, timeout: 60_000 })
    const quick = limiter({ algorithm: threePerMinute, name: "quick", timeout: 10 })

    const result = await rateLimit(quick, "k")

    expect(result.reason).toBe("storeError")
  })
})

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

  describe("the blocked-identity cache", () => {
    it("answers a repeated denial without the store", async () => {
      const { requests, store } = recordingStore()
      const limiter = buildLimiter({ store })({ algorithm: threePerMinute, name: "x" })
      await rateLimit(limiter, "k", { cost: 3 })
      await rateLimit(limiter, "k")

      const result = await rateLimit(limiter, "k")

      expect(result).toMatchObject({ reason: "cache", success: false })
      expect(requests).toHaveLength(2)
    })

    it("asks the store for any other cost, which reports its own reset", async () => {
      const { requests, store } = recordingStore(memoryStore({ clock: () => 0 }))
      const limiter = buildLimiter({ store })({
        algorithm: tokenBucket({ capacity: 5, interval: 60_000, refillRate: 1 }),
        name: "x",
      })
      await rateLimit(limiter, "k", { cost: 3 })
      await rateLimit(limiter, "k", { cost: 3 })

      expect(await rateLimit(limiter, "k", { cost: 3 })).toMatchObject({ reason: "cache" })
      expect(await rateLimit(limiter, "k", { cost: 4 })).toMatchObject({
        reason: "store",
        reset: 120_000,
        retryAfter: 120_000,
        success: false,
      })
      expect(await rateLimit(limiter, "k", { cost: 2 })).toMatchObject({
        reason: "store",
        success: true,
      })
      expect(requests).toHaveLength(4)
    })

    it("asks the store every time when the cache is off", async () => {
      const { requests, store } = recordingStore()
      const limiter = buildLimiter({ cache: false, store })({
        algorithm: threePerMinute,
        name: "x",
      })
      await rateLimit(limiter, "k", { cost: 3 })
      await rateLimit(limiter, "k")

      expect(await rateLimit(limiter, "k")).toMatchObject({ reason: "store", success: false })
      expect(requests).toHaveLength(3)
    })
  })

  describe("dry-run mode", () => {
    it("lets a denied request through and reports it", async () => {
      const limiter = buildLimiter({ store: memoryStore() })({
        algorithm: threePerMinute,
        mode: "dryRun",
        name: "x",
      })
      await rateLimit(limiter, "k", { cost: 3 })

      expect(await rateLimit(limiter, "k")).toMatchObject({
        reason: "dryRun",
        remaining: 0,
        success: true,
      })
      expect(await rateLimit(limiter, "k")).toMatchObject({ reason: "dryRun", success: true })
    })

    it("marks every result with the mode, so headers can leave them out", async () => {
      const limiter = buildLimiter({ store: memoryStore() })({
        algorithm: threePerMinute,
        mode: "dryRun",
        name: "x",
      })

      expect(await rateLimit(limiter, "k")).toMatchObject({
        mode: "dryRun",
        reason: "store",
        success: true,
      })
    })
  })

  describe("store errors", () => {
    it("reports a failing store as a store error, never a success", async () => {
      const limiter = buildLimiter({ store: failingStore })({
        algorithm: threePerMinute,
        name: "x",
      })

      const result = await rateLimit(limiter, "k")

      expect(result).toMatchObject({ name: "x", reason: "storeError", success: false })
      expect(result.reason === "storeError" && result.error).toBeInstanceOf(StoreError)
      expect(result.reason === "storeError" && result.error.cause).toEqual(
        new Error("connection refused")
      )
    })

    it("reports a silent store as a store error after the timeout", async () => {
      const limiter = buildLimiter({ store: silentStore, timeout: 20 })({
        algorithm: threePerMinute,
        name: "x",
      })

      const result = await rateLimit(limiter, "k")

      expect(result.reason === "storeError" && result.error.cause).toBeInstanceOf(StoreTimeoutError)
    })
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
