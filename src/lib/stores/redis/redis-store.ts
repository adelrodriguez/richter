import type { Store } from "#lib/store/index.ts"
import { scriptStore } from "./script-store.ts"

/**
 * The part of an ioredis client the store uses.
 */
export type IoredisClient = {
  evalsha(sha: string, numkeys: number, ...args: string[]): Promise<unknown>
  eval(source: string, numkeys: number, ...args: string[]): Promise<unknown>
  del(key: string): Promise<unknown>
}

/**
 * The part of a node-redis client the store uses.
 */
export type NodeRedisClient = {
  evalSha(sha: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>
  eval(source: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>
  del(key: string): Promise<unknown>
}

/**
 * Counts in Redis through an ioredis or node-redis client. Each check runs one Lua script, so it is
 * atomic across all instances that share the server. The store sends through the client's own
 * methods, so the client's `keyPrefix` applies.
 */
export function redisStore(client: IoredisClient | NodeRedisClient): Store {
  if ("evalsha" in client) {
    return scriptStore({
      del: (key) => client.del(key),
      eval: (source, key, args) => client.eval(source, 1, key, ...args),
      evalsha: (sha, key, args) => client.evalsha(sha, 1, key, ...args),
    })
  }

  return scriptStore({
    del: (key) => client.del(key),
    eval: (source, key, args) => client.eval(source, { arguments: args, keys: [key] }),
    evalsha: (sha, key, args) => client.evalSha(sha, { arguments: args, keys: [key] }),
  })
}
