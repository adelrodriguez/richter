const SWEEP_INTERVAL = 60_000

type Expiring = { readonly expiresAt: number }

type ExpiringMapOptions = {
  /**
   * The most entries the map holds. When it is full, a new entry replaces the oldest one. Use it
   * only where a lost entry is safe. Defaults to no limit.
   */
  readonly limit?: number
}

// A map whose entries disappear at `expiresAt`. Reads skip expired entries, and reads and writes
// remove all expired entries at most once per sweep interval, so memory stays bounded by the live
// entries. Each call takes the caller's `now`, so a caller reads its clock once for a get and a set.
export function expiringMap<Value extends Expiring>({ limit }: ExpiringMapOptions = {}) {
  const entries = new Map<string, Value>()
  let sweptAt: number | undefined

  function sweep(now: number) {
    sweptAt ??= now

    if (now - sweptAt < SWEEP_INTERVAL) return

    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(key)
    }
    sweptAt = now
  }

  return {
    get(key: string, now: number) {
      sweep(now)
      const entry = entries.get(key)

      if (entry !== undefined && entry.expiresAt <= now) {
        entries.delete(key)
        return
      }

      return entry
    },

    set(key: string, value: Value, now: number) {
      sweep(now)

      // A Map iterates in insertion order, so its first key is the oldest entry.
      if (limit !== undefined && entries.size >= limit && !entries.has(key)) {
        const [oldest] = entries.keys()
        if (oldest !== undefined) entries.delete(oldest)
      }

      entries.set(key, value)
    },

    delete(key: string) {
      entries.delete(key)
    },

    get size() {
      return entries.size
    },
  }
}
