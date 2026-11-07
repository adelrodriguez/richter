# richter

## 0.3.0

### Minor Changes

- 2a64eac: Require Node.js 22 or later, or Bun 1.4 or later. Node.js 20 reached its end of life in April 2026, and Bun 1.4 is the first release built from Bun's Rust code.
- 7350c80: `rateLimit` with several limiters now checks every limiter's remembered denials before any limiter spends. When a later limiter is blocked in this process, the request is denied without a store call, and earlier limiters spend nothing.

### Patch Changes

- 1b0e08c: The denial cache of each limiter now holds at most 10,000 denials and forgets the oldest first, so callers who choose many identities cannot grow it without a limit. The memory store and the denial cache also remove expired entries when they are only read.
- d00480c: Make `rateLimit` and the memory store faster. A limiter now times out its store calls with one shared timer, a key skips escaping when its identity has nothing to escape, and the memory store reads the clock once for each call.
- 7b1f387: Reject periods longer than 2^50 ms, and token buckets that take longer than that to refill completely. A Redis store wrote the state before the expiry failed, so the state never expired. The Redis stores also reject a reply with numbers that no script returns, such as `NaN`, instead of treating it as a success.

## 0.2.0

### Minor Changes

- f5079df: Add a `prefix` option to `buildLimiter`. The prefix goes before the limiter name in every key, so apps with different prefixes can use one store without sharing counts.

## 0.1.0

### Minor Changes

- cf61f77: Add atomic rate limiting: `buildLimiter`, `rateLimit`, `remaining`, `clear`, and `headers`; the fixed window, sliding window, and token bucket algorithms; a memory store at `richter/stores/memory`; and stores that take each client as it is: `richter/stores/redis` for ioredis and node-redis, `richter/stores/valkey` for iovalkey, and `richter/stores/bun-redis` for `Bun.RedisClient`.
- f3b2b87: Accept `null` as the global identity. Every request whose identity is `null` shares one count, so `identify` can return `null` for a global limit or for a request without the header it reads.
