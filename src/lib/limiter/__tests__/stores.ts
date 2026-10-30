import type { Store, StoreRequest } from "#lib/store/store.ts"
import { memoryStore } from "#lib/stores/memory/memory-store.ts"

// The stores that the limiter tests share.

export function recordingStore(store: Store = memoryStore()) {
  const requests: StoreRequest[] = []

  return {
    requests,
    store: {
      clear: store.clear,
      consume: (request: StoreRequest) => {
        requests.push(request)
        return store.consume(request)
      },
    } satisfies Store,
  }
}

export const failingStore: Store = {
  clear: () => Promise.reject(new Error("connection refused")),
  consume: () => Promise.reject(new Error("connection refused")),
}

// Never answers.
export const silentStore: Store = {
  clear: () => Promise.withResolvers<never>().promise,
  consume: () => Promise.withResolvers<never>().promise,
}
