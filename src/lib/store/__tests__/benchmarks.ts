import { test } from "vitest"
import type { Algorithm } from "#lib/algorithms/algorithms.ts"
import type { Store } from "#lib/store/store.ts"
import { fixedWindow, slidingWindow, tokenBucket } from "#lib/algorithms/algorithms.ts"

// The benchmarks every store runs. Run them with `vitest bench`.

// The calls in each concurrent batch.
const batch = 100

// The limits are high enough that the benchmarks never use them up, so every call is allowed,
// except the calls to the denied key.
const algorithms = {
  fixedWindow: {
    allowed: fixedWindow({ limit: 1_000_000_000, window: 60_000 }),
    denied: fixedWindow({ limit: 1, window: 3_600_000 }),
  },
  slidingWindow: {
    allowed: slidingWindow({ limit: 1_000_000_000, window: 60_000 }),
    denied: slidingWindow({ limit: 1, window: 3_600_000 }),
  },
  tokenBucket: {
    allowed: tokenBucket({ capacity: 1_000_000_000, interval: 1000, refillRate: 1_000_000_000 }),
    denied: tokenBucket({ capacity: 1, interval: 3_600_000, refillRate: 1 }),
  },
} satisfies Record<Algorithm["type"], { allowed: Algorithm; denied: Algorithm }>

export function benchStore(createStore: () => Store) {
  for (const [type, { allowed, denied }] of Object.entries(algorithms)) {
    test(type, async ({ bench }) => {
      const store = createStore()
      // Each run uses new keys, so runs against one server do not share counts.
      const prefix = `bench:${crypto.randomUUID()}`
      let next = 0

      await store.consume({ algorithm: denied, cost: 1, key: `${prefix}:denied` })

      await bench.compare(
        bench("allowed", async () => {
          await store.consume({ algorithm: allowed, cost: 1, key: `${prefix}:hot` })
        }),
        bench("denied", async () => {
          await store.consume({ algorithm: denied, cost: 1, key: `${prefix}:denied` })
        }),
        bench(`${batch} concurrent, one key`, async () => {
          await Promise.all(
            Array.from({ length: batch }, () =>
              store.consume({ algorithm: allowed, cost: 1, key: `${prefix}:hot` })
            )
          )
        }),
        bench(`${batch} concurrent, unique keys`, async () => {
          await Promise.all(
            Array.from({ length: batch }, () => {
              next += 1
              return store.consume({ algorithm: allowed, cost: 1, key: `${prefix}:${next}` })
            })
          )
        })
      )
    })
  }
}
