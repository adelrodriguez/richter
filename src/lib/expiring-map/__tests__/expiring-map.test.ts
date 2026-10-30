import { describe, expect, it } from "vitest"
import { expiringMap } from "#lib/expiring-map/expiring-map.ts"

describe("expiringMap", () => {
  it("hides an entry from its expiry time", () => {
    const map = expiringMap<{ expiresAt: number }>()
    map.set("a", { expiresAt: 100 }, 0)

    expect(map.get("a", 99)).toEqual({ expiresAt: 100 })
    expect(map.get("a", 100)).toBeUndefined()
  })

  it("removes expired entries it never reads", () => {
    const map = expiringMap<{ expiresAt: number }>()
    map.set("a", { expiresAt: 100 }, 0)
    map.set("b", { expiresAt: 100 }, 0)

    map.set("c", { expiresAt: 120_000 }, 60_000)

    expect(map.size).toBe(1)
  })
})
