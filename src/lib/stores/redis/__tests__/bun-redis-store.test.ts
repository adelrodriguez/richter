import { RedisClient } from "bun"
import { afterAll, describe } from "vitest"
import { testStore } from "#lib/store/__tests__/conformance.ts"
import { bunRedisStore } from "#lib/stores/redis/bun-redis-store.ts"
import { testScriptReload, url } from "./server.ts"

// Needs Bun and a Redis server at REDIS_URL. Run it with `bun --bun vitest run --project bun-redis-store`.
const client = new RedisClient(url)

afterAll(() => {
  client.close()
})

describe("bunRedisStore with Bun.RedisClient", () => {
  testStore(() => bunRedisStore(client))

  testScriptReload(
    () => bunRedisStore(client),
    () => client.send("SCRIPT", ["FLUSH"])
  )
})
