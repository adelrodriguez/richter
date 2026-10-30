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

  // A narrow limit before a broad one, the order the README recommends.
  test("several limiters", async ({ bench }) => {
    const limiter = buildLimiter({ store: memoryStore() })
    const roomy = fixedWindow({ limit: 1_000_000_000, window: 60_000 })
    const narrow = limiter({ algorithm: roomy, name: "narrow" })
    const broad = limiter({ algorithm: roomy, name: "broad" })
    const spent = limiter({ algorithm: fixedWindow({ limit: 1, window: 60_000 }), name: "spent" })
    await rateLimit(spent, "203.0.113.7")
    await rateLimit(spent, "203.0.113.7")

    await bench.compare(
      bench("allowed", async () => {
        await rateLimit([narrow, broad], "203.0.113.7")
      }),
      bench("broad limit blocked", async () => {
        await rateLimit([narrow, spent], "203.0.113.7")
      })
    )
  })
})
