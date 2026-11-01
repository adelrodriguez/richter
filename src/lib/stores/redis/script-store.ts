import type { Algorithm } from "#lib/algorithms/algorithms.ts"
import type { Store, StoreResult } from "#lib/store/store.ts"
import { readScript } from "./scripts.macro.ts" with { type: "macro" }

/**
 * The three commands the scripts need, each on one key. A client store sends them through its
 * client's own methods, so the client applies its key prefix and other key handling.
 */
export type ScriptCommands = {
  readonly evalsha: (sha: string, key: string, args: string[]) => Promise<unknown>
  readonly eval: (source: string, key: string, args: string[]) => Promise<unknown>
  readonly del: (key: string) => Promise<unknown>
}

type Script = { readonly source: string; readonly sha: Promise<string> }

/**
 * Counts with Lua scripts on a server that speaks the Redis protocol. Each call runs one script, so
 * it is atomic across all instances that share the server. The client stores adapt their client to
 * `commands`.
 */
export function scriptStore(commands: ScriptCommands): Store {
  const loaded = {
    fixedWindow: script(readScript("fixed-window.lua")),
    slidingWindow: script(readScript("sliding-window.lua")),
    tokenBucket: script(readScript("token-bucket.lua")),
  }

  async function evaluate({ source, sha }: Script, key: string, args: string[]) {
    try {
      return await commands.evalsha(await sha, key, args)
    } catch (error) {
      if (!isNoScriptError(error)) throw error

      // EVAL also caches the script, so later calls succeed with EVALSHA.
      return commands.eval(source, key, args)
    }
  }

  return {
    clear: async (key) => {
      await commands.del(key)
    },

    consume: async ({ key, algorithm, cost }) =>
      parseReply(await evaluate(loaded[algorithm.type], key, scriptArgs(algorithm, cost))),
  }
}

function script(source: string): Script {
  return { sha: sha1(source), source }
}

async function sha1(source: string) {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(source))

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function scriptArgs(algorithm: Algorithm, cost: number) {
  switch (algorithm.type) {
    case "fixedWindow":
    case "slidingWindow":
      return [String(algorithm.limit), String(algorithm.window), String(cost)]

    case "tokenBucket":
      return [
        String(algorithm.refillRate),
        String(algorithm.interval),
        String(algorithm.capacity),
        String(cost),
      ]
  }
}

function isNoScriptError(error: unknown) {
  return error instanceof Error && error.message.includes("NOSCRIPT")
}

function parseReply(reply: unknown): StoreResult {
  const values: unknown[] = Array.isArray(reply) ? reply : []
  const [success, remaining, reset, now] = values

  if (
    values.length !== 4
    || (success !== 0 && success !== 1)
    || typeof remaining !== "number"
    || typeof reset !== "number"
    || typeof now !== "number"
    // The scripts return whole numbers, so anything else comes from a faulty client or server.
    || !Number.isSafeInteger(remaining)
    || !Number.isSafeInteger(reset)
    || !Number.isSafeInteger(now)
    || remaining < 0
  ) {
    throw new InvalidReplyError(reply)
  }

  return { now, remaining, reset, success: success === 1 }
}

export class InvalidReplyError extends Error {
  override readonly name = "InvalidReplyError"
  readonly reply: unknown

  constructor(reply: unknown) {
    super("The store returned an unexpected reply to a rate limit script")
    this.reply = reply
  }
}
