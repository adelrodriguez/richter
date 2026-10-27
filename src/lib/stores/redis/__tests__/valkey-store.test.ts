import { Valkey } from "iovalkey"
import { afterAll, describe } from "vitest"
import { testStore } from "#lib/store/__tests__/conformance.ts"
import { valkeyStore } from "#lib/stores/redis/valkey-store.ts"
import { prefixes, testKeyPrefixes, testScriptReload, url } from "./server.ts"

// Needs a Valkey server at REDIS_URL.
const client = new Valkey(url)
const clientA = new Valkey(url, { keyPrefix: prefixes.a })
const clientB = new Valkey(url, { keyPrefix: prefixes.b })

afterAll(async () => {
  await Promise.all([client.quit(), clientA.quit(), clientB.quit()])
})

describe("valkeyStore with iovalkey", () => {
  testStore(() => valkeyStore(client))

  testScriptReload(
    () => valkeyStore(client),
    () => client.script("FLUSH")
  )

  testKeyPrefixes({
    exists: (...keys) => client.exists(...keys),
    storeA: () => valkeyStore(clientA),
    storeB: () => valkeyStore(clientB),
  })
})
