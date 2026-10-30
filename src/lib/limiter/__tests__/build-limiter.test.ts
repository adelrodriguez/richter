import { describe, expect, it } from "vitest"
import type { Identity } from "#lib/limiter/identity.ts"
import { fixedWindow, tokenBucket } from "#lib/algorithms/algorithms.ts"
import { buildLimiter } from "#lib/limiter/build-limiter.ts"
import { StoreError, StoreTimeoutError } from "#lib/limiter/errors.ts"
import { rateLimit } from "#lib/limiter/rate-limit.ts"
import { InvalidOptionError } from "#lib/options/options.ts"
import { memoryStore } from "#lib/stores/memory/memory-store.ts"
import { failingStore, recordingStore, silentStore } from "./stores.ts"

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
})
