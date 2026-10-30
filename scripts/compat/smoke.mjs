// The compatibility checks that every runtime runs on the built package. Each runtime has an entry
// file in this folder that loads the package and calls `smoke`. This file imports nothing, so a
// runtime without a file system, such as workerd, can bundle it.

/**
 * @typedef {object} Package
 * @property {typeof import("../../src/index")} library The `richter` entry.
 * @property {typeof import("../../src/stores/memory")} memory The `richter/stores/memory` entry.
 * @property {typeof import("../../src/stores/redis")} redis The `richter/stores/redis` entry.
 * @property {typeof import("../../src/stores/valkey")} valkey The `richter/stores/valkey` entry.
 * @property {typeof import("../../src/stores/bun-redis")} bunRedis The `richter/stores/bun-redis`
 *   entry.
 */

function check(condition, message) {
  if (!condition) {
    throw new Error(`Compatibility smoke test failed: ${message}`)
  }
}

// The reply of a rate limit script that allows the request.
const allowed = [1, 0, 60_000, 0]

/**
 * @param {Package} pkg The built package.
 */
export async function smoke({ library, memory, redis, valkey, bunRedis }) {
  check(typeof Promise.withResolvers === "function", "the runtime is at or above its floor")

  const algorithm = library.fixedWindow({ limit: 1, window: 60_000 })
  const limiter = library.buildLimiter({ store: memory.memoryStore() })({ algorithm, name: "key" })

  const first = await library.rateLimit(limiter, "a")
  const second = await library.rateLimit(limiter, "a")

  check(first.success, "a limiter allows the first request")
  check(!second.success, "a limiter denies past its limit")

  // Each Redis store hashes its scripts with Web Crypto, sends them through its client, and parses
  // the reply.
  /**
   * @type {string[]}
   */
  const commands = []
  const scriptClient = {
    del: () => Promise.resolve(0),
    eval: () => Promise.resolve(allowed),
    evalsha: () => {
      commands.push("EVALSHA")
      return Promise.resolve(allowed)
    },
  }
  const stores = await Promise.all([
    redis.redisStore(scriptClient).consume({ algorithm, cost: 1, key: "k" }),
    valkey.valkeyStore(scriptClient).consume({ algorithm, cost: 1, key: "k" }),
    bunRedis
      .bunRedisStore({
        send: (command) => {
          commands.push(command)
          return Promise.resolve(allowed)
        },
      })
      .consume({ algorithm, cost: 1, key: "k" }),
  ])

  check(
    stores.every((result) => result.success),
    "the Redis, Valkey, and Bun Redis stores parse the reply"
  )
  check(
    commands.length === 3 && commands.every((command) => command === "EVALSHA"),
    "the Redis, Valkey, and Bun Redis stores run their script by hash"
  )
}
