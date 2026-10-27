import { Redis } from "ioredis"
import { createClient } from "redis"
import { afterAll, describe } from "vitest"
import { testStore } from "#lib/store/__tests__/conformance.ts"
import { redisStore } from "#lib/stores/redis/redis-store.ts"
import { prefixes, testKeyPrefixes, testScriptReload, url } from "./server.ts"

// Needs a Redis server at REDIS_URL.
const ioredis = new Redis(url)
const ioredisA = new Redis(url, { keyPrefix: prefixes.a })
const ioredisB = new Redis(url, { keyPrefix: prefixes.b })
const nodeRedis = await createClient({ url }).connect()
const nodeRedisA = await createClient({ keyPrefix: prefixes.a, url }).connect()
const nodeRedisB = await createClient({ keyPrefix: prefixes.b, url }).connect()

afterAll(async () => {
  await Promise.all([
    ioredis.quit(),
    ioredisA.quit(),
    ioredisB.quit(),
    nodeRedis.close(),
    nodeRedisA.close(),
    nodeRedisB.close(),
  ])
})

describe.each([
  { client: ioredis, clientA: ioredisA, clientB: ioredisB, name: "ioredis" },
  { client: nodeRedis, clientA: nodeRedisA, clientB: nodeRedisB, name: "node-redis" },
])("redisStore with $name", ({ client, clientA, clientB }) => {
  testStore(() => redisStore(client))

  testScriptReload(
    () => redisStore(client),
    () => ioredis.script("FLUSH")
  )

  testKeyPrefixes({
    exists: (...keys) => ioredis.exists(...keys),
    storeA: () => redisStore(clientA),
    storeB: () => redisStore(clientB),
  })
})
