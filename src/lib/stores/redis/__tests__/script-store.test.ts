import { Redis } from "ioredis"
import { afterAll, describe, expect, it } from "vitest"
import type { ScriptCommands } from "#lib/stores/redis/script-store.ts"
import { fixedWindow, slidingWindow, tokenBucket } from "#lib/algorithms/algorithms.ts"
import { memoryStore } from "#lib/stores/memory/memory-store.ts"
import { InvalidReplyError, scriptStore } from "#lib/stores/redis/script-store.ts"
import { testScriptReload, url } from "./server.ts"

// Tests the scripts themselves, through ioredis. CI runs this file against Redis and Valkey.
const week = 7 * 24 * 60 * 60 * 1000

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

const client = new Redis(url)
const commands: ScriptCommands = {
  del: (key) => client.del(key),
  eval: (source, key, args) => client.eval(source, 1, key, ...args),
  evalsha: (sha, key, args) => client.evalsha(sha, 1, key, ...args),
}

afterAll(async () => {
  await client.quit()
})

describe("scriptStore", () => {
  // Runs the same requests against Redis and the memory store, with the memory store's clock set to
  // the time Redis read. The scripts must then return exactly what the memory store returns, which
  // checks the Lua arithmetic at real timestamps, across window boundaries, and for every cost.
  it.each([
    fixedWindow({ limit: 5, window: 100 }),
    slidingWindow({ limit: 5, window: 100 }),
    tokenBucket({ capacity: 5, interval: 100, refillRate: 2 }),
  ])("returns what the memory store returns for $type", async (algorithm) => {
    const redis = scriptStore(commands)
    let now = 0
    const memory = memoryStore({ clock: () => now })
    const key = `test:${crypto.randomUUID()}`

    for (let step = 0; step < 60; step += 1) {
      const cost = (step * 7) % 6
      // oxlint-disable-next-line eslint/no-await-in-loop -- Each request must see the state the one before it left.
      const expected = await redis.consume({ algorithm, cost, key })
      now = expected.now

      // oxlint-disable-next-line eslint/no-await-in-loop -- As above.
      expect(await memory.consume({ algorithm, cost, key })).toEqual(expected)

      // oxlint-disable-next-line eslint/no-await-in-loop -- Spreads the requests over several windows.
      await sleep((step * 13) % 40)
    }
  })

  testScriptReload(
    () => scriptStore(commands),
    () => client.script("FLUSH")
  )

  it("runs a loaded script by its hash alone", async () => {
    const sent: string[] = []
    const store = scriptStore({
      del: (key) => {
        sent.push("DEL")
        return commands.del(key)
      },
      eval: (source, key, args) => {
        sent.push("EVAL")
        return commands.eval(source, key, args)
      },
      evalsha: (sha, key, args) => {
        sent.push("EVALSHA")
        return commands.evalsha(sha, key, args)
      },
    })
    const algorithm = fixedWindow({ limit: 5, window: 2000 })
    await store.consume({ algorithm, cost: 1, key: "test:hash" })
    sent.length = 0

    await store.consume({ algorithm, cost: 1, key: "test:hash" })

    expect(sent).toEqual(["EVALSHA"])
  })

  it.each([
    fixedWindow({ limit: 5, window: 2000 }),
    slidingWindow({ limit: 5, window: 2000 }),
    tokenBucket({ capacity: 5, interval: 2000, refillRate: 1 }),
  ])("expires $type state once it no longer matters", async (algorithm) => {
    const store = scriptStore(commands)
    const key = `test:${crypto.randomUUID()}`
    await store.consume({ algorithm, cost: 1, key })

    const ttl = await client.pttl(key)

    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(4000)
  })

  it.each([
    fixedWindow({ limit: 5, window: week }),
    slidingWindow({ limit: 5, window: week }),
    tokenBucket({ capacity: 5, interval: week, refillRate: 1 }),
  ])("expires $type state with a one-week window", async (algorithm) => {
    const store = scriptStore(commands)
    const key = `test:${crypto.randomUUID()}`
    await store.consume({ algorithm, cost: 1, key })

    const ttl = await client.pttl(key)

    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(2 * week)
  })

  it("rejects a reply it does not recognize", async () => {
    const store = scriptStore({
      del: () => Promise.resolve(0),
      eval: () => Promise.resolve(["OK"]),
      evalsha: () => Promise.resolve(["OK"]),
    })

    await expect(
      store.consume({ algorithm: fixedWindow({ limit: 5, window: 2000 }), cost: 1, key: "k" })
    ).rejects.toThrow(InvalidReplyError)
  })
})
