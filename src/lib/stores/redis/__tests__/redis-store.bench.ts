import { Redis } from "ioredis"
import { createClient } from "redis"
import { afterAll, describe } from "vitest"
import { benchStore } from "#lib/store/__tests__/benchmarks.ts"
import { redisStore } from "#lib/stores/redis/redis-store.ts"
import { url } from "./server.ts"

// Needs a Redis server at REDIS_URL.
const ioredis = new Redis(url)
const nodeRedis = await createClient({ url }).connect()

afterAll(async () => {
  await Promise.all([ioredis.quit(), nodeRedis.close()])
})

describe.each([
  { client: ioredis, name: "ioredis" },
  { client: nodeRedis, name: "node-redis" },
])("redisStore with $name", ({ client }) => {
  benchStore(() => redisStore(client))
})
