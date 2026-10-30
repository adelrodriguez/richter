import { describe, expect, it } from "vitest"
import { keyOf } from "#lib/limiter/identity.ts"

describe("keyOf", () => {
  it("joins the name and the parts of the identity", () => {
    expect(keyOf("suggestions:ip", "203.0.113.7")).toBe("suggestions:ip:203.0.113.7")
    expect(keyOf("chat", ["203.0.113.7", "ada"])).toBe("chat:203.0.113.7|ada")
  })

  it("escapes the separators and the escape character in each part", () => {
    expect(keyOf("a", "%:|")).toBe("a:%25%3A%7C")
    expect(keyOf("a", ["b:c", "d|e"])).toBe("a:b%3Ac|d%7Ce")
  })

  it("gives every identity its own key, even when names and parts contain separators", () => {
    const keys = [
      keyOf("a", ["b", "c"]),
      keyOf("a:b", "c"),
      keyOf("a", "b:c"),
      keyOf("a", "b|c"),
      keyOf("a", "::1"),
    ]

    expect(new Set(keys).size).toBe(keys.length)
  })

  it("gives the global identity a key that no other identity has", () => {
    const global = keyOf("a:b", null)

    expect(keyOf("a:b", null)).toBe(global)
    expect([keyOf("a", "b"), keyOf("a:b", ""), keyOf("a:b", "%00")]).not.toContain(global)
  })
})
