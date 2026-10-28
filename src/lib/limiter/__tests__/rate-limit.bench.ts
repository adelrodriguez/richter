import { describe, test } from "vitest"
import { fixedWindow } from "#lib/algorithms/algorithms.ts"
import { buildLimiter } from "#lib/limiter/build-limiter.ts"
import { rateLimit } from "#lib/limiter/rate-limit.ts"
import { memoryStore } from "#lib/stores/memory/memory-store.ts"

// The cost of the limiter on top of its store. The memory store makes no network calls, so the
// difference between the two is the limiter's own work.
describe("rateLimit", () => {
  test("fixedWindow", async ({ bench }) => {
    const store = memoryStore()
    const algorithm = fixedWindow({ limit: 1_000_000_000, window: 60_000 })
    const limiter = buildLimiter({ store })({ algorithm, name: "bench" })

    await bench.compare(
      bench("store.consume", async () => {
        await store.consume({ algorithm, cost: 1, key: "bench:203.0.113.7" })
      }),
      bench("rateLimit", async () => {
        await rateLimit(limiter, "203.0.113.7")
      })
    )
  })
})
