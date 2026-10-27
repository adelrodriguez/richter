# richter

## 0.1.0

### Minor Changes

- cf61f77: Add atomic rate limiting: `buildLimiter`, `rateLimit`, `remaining`, `clear`, and `headers`; the fixed window, sliding window, and token bucket algorithms; a memory store at `richter/stores/memory`; and stores that take each client as it is: `richter/stores/redis` for ioredis and node-redis, `richter/stores/valkey` for iovalkey, and `richter/stores/bun-redis` for `Bun.RedisClient`.
- f3b2b87: Accept `null` as the global identity. Every request whose identity is `null` shares one count, so `identify` can return `null` for a global limit or for a request without the header it reads.
