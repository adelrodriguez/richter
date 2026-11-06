import type { Store } from "#lib/store/index.ts"
import { scriptStore } from "./script-store.ts"

/**
 * The part of a `Bun.RedisClient` the store uses.
 */
export type BunRedisClient = {
  send(command: string, args: string[]): Promise<unknown>
}

/**
 * Counts in Redis or Valkey through Bun's own Redis client. Each check runs one Lua script, so it
 * is atomic across all instances that share the server.
 */
export function bunRedisStore(client: BunRedisClient): Store {
  return scriptStore({
    del: (key) => client.send("DEL", [key]),
    eval: (source, key, args) => client.send("EVAL", [source, "1", key, ...args]),
    evalsha: (sha, key, args) => client.send("EVALSHA", [sha, "1", key, ...args]),
  })
}
