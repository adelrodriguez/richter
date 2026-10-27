import { Valkey } from "iovalkey"
import { afterAll, describe } from "vitest"
import { benchStore } from "#lib/store/__tests__/benchmarks.ts"
import { valkeyStore } from "#lib/stores/redis/valkey-store.ts"
import { url } from "./server.ts"

// Needs a Valkey server at REDIS_URL.
const client = new Valkey(url)

afterAll(async () => {
  await client.quit()
})

describe("valkeyStore with iovalkey", () => {
  benchStore(() => valkeyStore(client))
})
