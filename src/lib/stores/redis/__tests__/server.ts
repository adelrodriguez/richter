import { expect, it } from "vitest"
import type { Store } from "#lib/store/store.ts"
import { fixedWindow } from "#lib/algorithms/algorithms.ts"

// The tests that need a server, which every store for these servers shares.

export const url = process.env.REDIS_URL ?? "redis://localhost:6379"

// The key prefixes of the clients that `testKeyPrefixes` compares.
export const prefixes = { a: "test:a:", b: "test:b:" } as const

export function testScriptReload(createStore: () => Store, flush: () => Promise<unknown>) {
  it("reloads its scripts after the server forgets them", async () => {
    const store = createStore()
    const algorithm = fixedWindow({ limit: 5, window: 2000 })
    await store.consume({ algorithm, cost: 1, key: "test:flush" })

    await flush()

    expect(await store.consume({ algorithm, cost: 0, key: "test:flush" })).toMatchObject({
      success: true,
    })
  })
}

// `storeA` and `storeB` use clients with the key prefixes in `prefixes`. `exists` counts the keys
// that exist, through a client with no key prefix.
export function testKeyPrefixes({
  exists,
  storeA,
  storeB,
}: {
  exists: (...keys: string[]) => Promise<number>
  storeA: () => Store
  storeB: () => Store
}) {
  it("keeps the counts of clients with different key prefixes apart", async () => {
    const a = storeA()
    const b = storeB()
    const algorithm = fixedWindow({ limit: 1, window: 60_000 })
    const key = crypto.randomUUID()

    expect(await a.consume({ algorithm, cost: 1, key })).toMatchObject({ success: true })
    expect(await b.consume({ algorithm, cost: 1, key })).toMatchObject({ success: true })
    expect(await exists(`${prefixes.a}${key}`, `${prefixes.b}${key}`, key)).toBe(2)

    await a.clear(key)

    expect(await exists(`${prefixes.a}${key}`, `${prefixes.b}${key}`)).toBe(1)
    expect(await b.consume({ algorithm, cost: 1, key })).toMatchObject({ success: false })
  })
}
