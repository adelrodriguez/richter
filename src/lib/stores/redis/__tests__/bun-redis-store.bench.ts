import { RedisClient } from "bun"
import { afterAll, describe } from "vitest"
import { benchStore } from "#lib/store/__tests__/benchmarks.ts"
import { bunRedisStore } from "#lib/stores/redis/bun-redis-store.ts"
import { url } from "./server.ts"

// Needs Bun and a Redis server at REDIS_URL. Run it with `bun --bun vitest bench --project bun-redis-store`.
const client = new RedisClient(url)

afterAll(() => {
  client.close()
})

describe("bunRedisStore with Bun.RedisClient", () => {
  benchStore(() => bunRedisStore(client))
})
