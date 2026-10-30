const SWEEP_INTERVAL = 60_000

type Expiring = { readonly expiresAt: number }

// A map whose entries disappear at `expiresAt`. Reads skip expired entries, and writes remove all
// expired entries at most once per sweep interval, so memory stays bounded by the live entries.
// Each call takes the caller's `now`, so a caller reads its clock once for a get and a set.
export function expiringMap<Value extends Expiring>() {
  const entries = new Map<string, Value>()
  let sweptAt: number | undefined

  return {
    get(key: string, now: number) {
      const entry = entries.get(key)

      if (entry !== undefined && entry.expiresAt <= now) {
        entries.delete(key)
        return
      }

      return entry
    },

    set(key: string, value: Value, now: number) {
      sweptAt ??= now

      if (now - sweptAt >= SWEEP_INTERVAL) {
        for (const [entryKey, entry] of entries) {
          if (entry.expiresAt <= now) entries.delete(entryKey)
        }
        sweptAt = now
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
