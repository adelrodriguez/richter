import type { StoreResult } from "#lib/store/store.ts"
import { expiringMap } from "#lib/expiring-map/expiring-map.ts"

type Block = {
  readonly cost: number
  readonly remaining: number
  readonly reset: number
  /**
   * The local time at which the block ends, in epoch ms.
   */
  readonly expiresAt: number
}

// Remembers denials in this process, so a denied identity does not reach the store again until its
// reset. A block answers only the cost it was denied for: a larger cost is denied too, but its reset
// is later and depends on the algorithm, so the store must say when. The block lasts as long as the store said to wait, measured on the local clock,
// so a local clock that differs from the store's clock does not change its length.
// It holds at most `LIMIT` blocks, because callers can choose their identities. A forgotten block is
// safe: the next request for it asks the store.
const LIMIT = 10_000

export function blockedCache() {
  const blocks = expiringMap<Block>({ limit: LIMIT })

  return {
    block(key: string, cost: number, { now, remaining, reset }: StoreResult) {
      const localNow = Date.now()
      blocks.set(key, { cost, expiresAt: localNow + (reset - now), remaining, reset }, localNow)
    },

    clear(key: string) {
      blocks.delete(key)
    },

    lookup(key: string, cost: number) {
      const now = Date.now()
      const block = blocks.get(key, now)

      if (block === undefined || cost !== block.cost) return

      return {
        remaining: block.remaining,
        reset: block.reset,
        retryAfter: Math.max(0, block.expiresAt - now),
      }
    },
  }
}
