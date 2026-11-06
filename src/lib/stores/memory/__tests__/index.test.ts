import { describe, expect, it } from "vitest"
import { fixedWindow } from "#lib/algorithms/index.ts"
import { testStore } from "#lib/store/__tests__/conformance.ts"
import { memoryStore } from "#lib/stores/memory/index.ts"

// The arithmetic has its own tests in `src/lib/transitions/__tests__/index.test.ts`.
describe("memoryStore", () => {
  testStore(() => memoryStore())

  it("decides by the clock it is given", async () => {
    const store = memoryStore({ clock: () => 10_999 })

    expect(
      await store.consume({ algorithm: fixedWindow({ limit: 3, window: 1000 }), cost: 1, key: "k" })
    ).toStrictEqual({ now: 10_999, remaining: 2, reset: 11_000, success: true })
  })
})
