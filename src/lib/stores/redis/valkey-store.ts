import type { Store } from "#lib/store/index.ts"
import { scriptStore } from "./script-store.ts"

/**
 * The part of an iovalkey client the store uses.
 */
export type IovalkeyClient = {
  evalsha(sha: string, numkeys: number, ...args: string[]): Promise<unknown>
  eval(source: string, numkeys: number, ...args: string[]): Promise<unknown>
  del(key: string): Promise<unknown>
}

/**
 * Counts in Valkey through an iovalkey client. Each check runs one Lua script, so it is atomic
 * across all instances that share the server. The store sends through the client's own methods, so
 * the client's `keyPrefix` applies.
 */
export function valkeyStore(client: IovalkeyClient): Store {
  return scriptStore({
    del: (key) => client.del(key),
    eval: (source, key, args) => client.eval(source, 1, key, ...args),
    evalsha: (sha, key, args) => client.evalsha(sha, 1, key, ...args),
  })
}
