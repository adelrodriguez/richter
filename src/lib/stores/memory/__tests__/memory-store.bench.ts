import { describe } from "vitest"
import { benchStore } from "#lib/store/__tests__/benchmarks.ts"
import { memoryStore } from "#lib/stores/memory/memory-store.ts"

describe("memoryStore", () => {
  benchStore(() => memoryStore())
})
