import type { Algorithm } from "#lib/algorithms/index.ts"

export type StoreRequest<Supported extends Algorithm = Algorithm> = {
  readonly key: string
  readonly algorithm: Supported
  /**
   * A whole number from 0 to the algorithm's capacity. A cost of 0 reads without writing.
   */
  readonly cost: number
}

export type StoreResult = {
  readonly success: boolean
  readonly remaining: number
  /**
   * When the request can next succeed if denied, or when the window ends, in epoch ms.
   */
  readonly reset: number
  /**
   * The store's clock when it decided, in epoch ms.
   */
  readonly now: number
}

/**
 * Applies algorithms to keys. Each `consume` call must be atomic: concurrent calls for one key,
 * from any process, must behave as if they ran one after another. A denied request changes
 * nothing.
 *
 * The members are properties, not methods, so TypeScript checks `Supported` strictly: a store for
 * fewer algorithms cannot stand in for a store for more.
 */
export type Store<Supported extends Algorithm = Algorithm> = {
  readonly consume: (request: StoreRequest<Supported>) => Promise<StoreResult>
  readonly clear: (key: string) => Promise<void>
}
