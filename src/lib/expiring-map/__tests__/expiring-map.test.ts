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

  it("removes expired entries on a read, when nothing is written", () => {
    const map = expiringMap<{ expiresAt: number }>()
    map.set("a", { expiresAt: 100 }, 0)
    map.set("b", { expiresAt: 100 }, 0)

    map.get("c", 60_000)

    expect(map.size).toBe(0)
  })

  it("drops the oldest entry to stay within its limit", () => {
    const map = expiringMap<{ expiresAt: number }>({ limit: 2 })
    map.set("a", { expiresAt: 100 }, 0)
    map.set("b", { expiresAt: 100 }, 0)

    map.set("c", { expiresAt: 100 }, 0)

    expect(map.size).toBe(2)
    expect(map.get("a", 0)).toBeUndefined()
    expect(map.get("c", 0)).toEqual({ expiresAt: 100 })
  })

  it("keeps every live entry when it has no limit", () => {
    const map = expiringMap<{ expiresAt: number }>()

    for (let index = 0; index < 20_000; index += 1) map.set(`k${index}`, { expiresAt: 100 }, 0)

    expect(map.size).toBe(20_000)
  })
})
