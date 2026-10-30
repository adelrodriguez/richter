import type { Algorithm } from "#lib/algorithms/algorithms.ts"
import type { Store, StoreResult } from "#lib/store/store.ts"
import { capacityOf, windowOf } from "#lib/algorithms/algorithms.ts"
import { positiveInteger, printable } from "#lib/options/options.ts"
import type { Identity } from "./identity.ts"
import { blockedCache } from "./blocked-cache.ts"
import { StoreError } from "./errors.ts"
import { keyOf } from "./identity.ts"
import { storeTimer } from "./store-timer.ts"

const DEFAULT_TIMEOUT = 1000

/**
 * `"enforce"` refuses denied requests. `"dryRun"` counts normally but lets them through.
 */
export type Mode = "enforce" | "dryRun"

export type LimiterSettings = {
  /**
   * How long to wait for the store in milliseconds. Defaults to 1000.
   */
  readonly timeout?: number
  /**
   * Remember denials in this process until they reset, to skip the store. Defaults to `true`.
   */
  readonly cache?: boolean
  /**
   * Defaults to `"enforce"`.
   */
  readonly mode?: Mode
}

export type BuildLimiterOptions<Supported extends Algorithm> = LimiterSettings & {
  readonly store: Store<Supported>
  /**
   * Goes before the limiter name in every key, joined with `:`. Limiters share counts when
   * `prefix:name` and the identity match, so prefix `a:b` with name `c` shares counts with prefix
   * `a` with name `b:c`. Results and headers do not show the prefix. Printable ASCII only.
   */
  readonly prefix?: string
}

export type LimiterOptions<Supported extends Algorithm> = LimiterSettings & {
  /**
   * Labels results and headers, and goes into every key. Printable ASCII only.
   */
  readonly name: string
  readonly algorithm: Supported
}

export type Identify<Input> = (input: Input) => Identity | Promise<Identity>

type Counts = {
  readonly limit: number
  readonly remaining: number
  /**
   * When a denied request can succeed, or when the window ends, in epoch ms.
   */
  readonly reset: number
  /**
   * Milliseconds until `reset`, measured on the store's clock.
   */
  readonly retryAfter: number
  /**
   * The period the limit covers in milliseconds.
   */
  readonly window: number
}

export type AllowedResult = Counts & {
  readonly name: string
  readonly success: true
  /**
   * `"store"`: the store allowed the request. `"dryRun"`: the store denied it, in dry-run mode.
   */
  readonly reason: "store" | "dryRun"
  /**
   * The limiter's mode. A dry-run limiter allows every request it counts.
   */
  readonly mode: Mode
}

export type DeniedResult = Counts & {
  readonly name: string
  readonly success: false
  /**
   * `"store"`: the store denied the request. `"cache"`: a remembered denial did.
   */
  readonly reason: "store" | "cache"
}

/**
 * The store failed or did not answer in time. A store error is never a success, but the request may
 * still have been counted: a command that timed out can complete in the store, then or later.
 */
export type StoreErrorResult = {
  readonly name: string
  readonly success: false
  readonly reason: "storeError"
  readonly error: StoreError
}

export type LimitResult = AllowedResult | DeniedResult | StoreErrorResult

export type Remaining = {
  readonly name: string
  readonly limit: number
  readonly remaining: number
  readonly reset: number
}

export const internal = Symbol("richter.limiter")

type Internal<Input> = {
  readonly capacity: number
  readonly key: (input: Input) => Promise<string>
  /**
   * The denial this process remembers for `key` and `cost`, without the store.
   */
  readonly blocked: (key: string, cost: number) => DeniedResult | undefined
  /**
   * Spends `cost` units in the store. It does not look at remembered denials.
   */
  readonly consume: (key: string, cost: number) => Promise<LimitResult>
  readonly read: (input: Input) => Promise<Remaining>
  readonly clear: (input: Input) => Promise<void>
}

/**
 * A limit definition. Run it with `rateLimit`, `remaining`, and `clear`.
 */
export type Limiter<in Input = Identity> = {
  readonly name: string
  readonly [internal]: Internal<Input>
}

export type DefineLimiter<Supported extends Algorithm> = {
  <Input>(
    options: LimiterOptions<Supported> & { readonly identify: Identify<Input> }
  ): Limiter<Input>
  (options: LimiterOptions<Supported> & { readonly identify?: undefined }): Limiter
}

/**
 * Binds a store and shared settings, and returns a function that defines limiters. Settings on a
 * limiter override the settings given here.
 */
export function buildLimiter<Supported extends Algorithm>({
  store,
  prefix,
  ...defaults
}: BuildLimiterOptions<Supported>): DefineLimiter<Supported> {
  const namespace = prefix === undefined ? "" : `${printable("prefix", prefix)}:`

  function define<Input>(
    options: LimiterOptions<Supported>,
    identify: Identify<Input>
  ): Limiter<Input> {
    const name = printable("name", options.name)
    const { algorithm } = options
    const timeout = positiveInteger(
      "timeout",
      options.timeout ?? defaults.timeout ?? DEFAULT_TIMEOUT
    )
    const mode = options.mode ?? defaults.mode ?? "enforce"
    const blocks = (options.cache ?? defaults.cache ?? true) ? blockedCache() : undefined
    const limit = capacityOf(algorithm)
    const window = windowOf(algorithm)
    const watch = storeTimer(timeout)

    async function keyFor(input: Input) {
      return keyOf(`${namespace}${name}`, await identify(input))
    }

    function ask(key: string, cost: number) {
      return watch(store.consume({ algorithm, cost, key }))
    }

    function counts({ now, remaining, reset }: StoreResult) {
      return { limit, remaining, reset, retryAfter: Math.max(0, reset - now), window }
    }

    return {
      [internal]: {
        blocked: (key, cost) => {
          const blocked = mode === "enforce" ? blocks?.lookup(key, cost) : undefined

          if (blocked === undefined) return

          return { ...blocked, limit, name, reason: "cache", success: false, window }
        },

        capacity: limit,

        clear: async (input) => {
          const key = await keyFor(input)
          blocks?.clear(key)

          try {
            await watch(store.clear(key))
          } catch (error) {
            throw new StoreError(error)
          }
        },

        consume: async (key, cost) => {
          let result: StoreResult

          try {
            result = await ask(key, cost)
          } catch (error) {
            return { error: new StoreError(error), name, reason: "storeError", success: false }
          }

          if (result.success) {
            return { ...counts(result), mode, name, reason: "store", success: true }
          }

          if (mode === "dryRun") {
            return { ...counts(result), mode, name, reason: "dryRun", success: true }
          }

          blocks?.block(key, cost, result)

          return { ...counts(result), name, reason: "store", success: false }
        },

        key: keyFor,

        read: async (input) => {
          const key = await keyFor(input)

          try {
            const { remaining, reset } = await ask(key, 0)
            return { limit, name, remaining, reset }
          } catch (error) {
            throw new StoreError(error)
          }
        },
      },
      name,
    }
  }

  function limiter<Input>(
    options: LimiterOptions<Supported> & { readonly identify: Identify<Input> }
  ): Limiter<Input>
  function limiter(options: LimiterOptions<Supported> & { readonly identify?: undefined }): Limiter
  function limiter<Input>(
    options: LimiterOptions<Supported> & { readonly identify?: Identify<Input> | undefined }
  ): Limiter<Input> | Limiter {
    if (options.identify === undefined) return define(options, (identity: Identity) => identity)

    return define(options, options.identify)
  }

  return limiter
}
