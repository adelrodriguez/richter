// Checks that the built bundle runs on the minimum supported runtime.
//
// The floor is the `engines.node` version in package.json. The bundle must not import Node.js
// modules. This script also removes globals that are newer than the floor, so a run on a newer
// runtime fails in the same way as a run on the floor.
//
// Usage: node scripts/compat-smoke.mjs [dist directory]

import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const distDir = resolve(process.argv[2] ?? "dist")
const entries = [
  "index.js",
  "stores/memory.js",
  "stores/redis.js",
  "stores/valkey.js",
  "stores/bun-redis.js",
].map((file) => resolve(distDir, file))

function check(condition, message) {
  if (!condition) {
    throw new Error(`Compatibility smoke test failed: ${message}`)
  }
}

const contents = await Promise.all(entries.map((entry) => readFile(entry, "utf8")))

for (const [index, content] of contents.entries()) {
  check(
    !/(?:from|import|require)\s*\(?\s*["']node:/.test(content),
    `${entries[index]} imports no Node.js module`
  )
}

if (typeof Promise.withResolvers !== "function") {
  throw new Error("This runtime is below the supported floor")
}

// Globals that Node.js added after 22.0.0.
delete RegExp.escape
delete Error.isError
delete Math.sumPrecise

/**
 * @type {typeof import("../src/index")}
 */
const library = await import(pathToFileURL(entries[0]).href)
/**
 * @type {typeof import("../src/stores/memory")}
 */
const memory = await import(pathToFileURL(entries[1]).href)
/**
 * @type {typeof import("../src/stores/redis")}
 */
const redis = await import(pathToFileURL(entries[2]).href)

const limiter = library.buildLimiter({ store: memory.memoryStore() })
const algorithm = library.fixedWindow({ limit: 1, window: 60_000 })
const perKey = limiter({ algorithm, name: "key" })

const first = await library.rateLimit(perKey, "a")
const second = await library.rateLimit(perKey, "a")

check(first.success, "a limiter allows the first request")
check(!second.success, "a limiter denies past its limit")

// A Redis store hashes its scripts with Web Crypto and parses the reply.
const commands = []
const store = redis.redisStore({
  del: () => Promise.resolve(0),
  eval: () => Promise.resolve([1, 0, 60_000, 0]),
  evalsha: () => {
    commands.push("EVALSHA")
    return Promise.resolve([1, 0, 60_000, 0])
  },
})
const result = await store.consume({ algorithm, cost: 1, key: "k" })

check(result.success && commands[0] === "EVALSHA", "a Redis store runs its script by hash")
