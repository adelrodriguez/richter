<div align="center">
  <h1 align="center">✋🏻 <code>richter</code></h1>

  <p align="center">
    <strong>Atomic rate limiting with pluggable stores</strong>
  </p>
</div>

richter counts requests in a store that every instance of your application shares, so a limit holds across instances and restarts. Each check runs as one atomic step inside the store: requests that arrive together can never pass a limit together.

You define limiters once and run them with plain functions. richter has no framework integrations, so you compose your own middleware for Hono, Express, or anything else in a few lines.

## Contents

- [Features](#features)
- [Install richter](#install-richter)
- [Get started](#get-started)
- [Define limiters](#define-limiters)
  - [Choose an algorithm](#choose-an-algorithm)
  - [Identify the caller](#identify-the-caller)
  - [Shared and per-limiter settings](#shared-and-per-limiter-settings)
- [Run limiters](#run-limiters)
  - [Spend more than one unit](#spend-more-than-one-unit)
  - [Run several limiters](#run-several-limiters)
  - [Read and clear counts](#read-and-clear-counts)
- [Read the result](#read-the-result)
- [Send rate limit headers](#send-rate-limit-headers)
- [Write middleware](#write-middleware)
- [Handle store errors](#handle-store-errors)
- [Try a limit in dry-run mode](#try-a-limit-in-dry-run-mode)
- [Stores](#stores)
  - [Redis and Valkey](#redis-and-valkey)
  - [Memory](#memory)
  - [Write a store](#write-a-store)
- [Errors](#errors)
- [Compared with other libraries](#compared-with-other-libraries)
- [License](#license)

## Features

- **Atomic:** Each check runs as one indivisible step in the store, such as a Lua script in Redis.
- **Three algorithms:** Fixed window, sliding window, and token bucket. A denied request spends nothing, the cost is checked before any units are spent, and a denial reports the exact time the request can succeed.
- **Your Redis client as it is:** Pass an ioredis, node-redis, iovalkey, or Bun client straight to its store. No adapter, no type assertions.
- **Safe on failure:** When the store fails, the result is never a success, so a spending cap stays a cap.
- **One clock:** Windows follow the store's clock, so instances with drifting clocks agree.
- **Composable:** Limiters are definitions that plain functions run. Build middleware for any platform.
- **Typed:** The input type of each limiter comes from how it identifies the caller.
- **No runtime dependencies.**

## Install richter

```sh
pnpm add richter
```

You can also use Bun, npm, or Yarn. richter needs Node.js 22 or later, or Bun 1.4 or later.

## Get started

Create a limiter factory with a store, define a limiter, and run it:

```typescript
import Redis from "ioredis"
import { buildLimiter, rateLimit, slidingWindow } from "richter"
import { redisStore } from "richter/stores/redis"

const redis = new Redis(process.env.REDIS_URL)

const limiter = buildLimiter({
  store: redisStore(redis),
})

const perIp = limiter({
  name: "api:ip",
  algorithm: slidingWindow({ limit: 30, window: 60 * 60 * 1000 }),
})

const result = await rateLimit(perIp, ip)

if (!result.success) {
  // Refuse the request.
}
```

## Define limiters

A limiter is a named definition: the algorithm that decides, and how to identify the caller. The factory supplies the store and shared settings.

### Choose an algorithm

Every duration is a whole number of milliseconds.

```typescript
import { fixedWindow, slidingWindow, tokenBucket } from "richter"

// At most 2,000 units per day. Days start at midnight UTC.
fixedWindow({ limit: 2_000, window: 86_400_000 })

// At most 30 units in any hour.
slidingWindow({ limit: 30, window: 3_600_000 })

// A bucket of 50 tokens that gains 5 tokens every minute.
tokenBucket({ refillRate: 5, interval: 60_000, capacity: 50 })
```

- **Fixed window:** Counts units in windows that start at multiples of the window length since the epoch. It is exact and cheap, but a client can spend a full limit at the end of one window and again at the start of the next.
- **Sliding window:** Adds the current window's count to the previous window's count, weighted by how much of it the last full window length still covers. It smooths the boundary of a fixed window.
- **Token bucket:** Allows bursts up to the capacity, then a steady rate.

For readable durations, use [humanspan](https://github.com/adelrodriguez/humanspan):

```typescript
import { ms } from "humanspan"

slidingWindow({ limit: 30, window: ms("1h") })
```

### Identify the caller

`identify` turns your input into an identity, the value the limiter counts against. Its parameter type becomes the limiter's input type:

```typescript
import type { Context } from "hono"

const perDevice = limiter({
  name: "suggestions:device",
  algorithm: slidingWindow({ limit: 10, window: ms("1h") }),
  identify: (c: Context) => c.req.header("x-device-id") ?? null,
})

await rateLimit(perDevice, c) // c must be a Context
```

An identity can have several parts. Return a tuple, and richter encodes the parts so that different tuples never share a count:

```typescript
identify: (c: Context) => [c.get("orgId"), c.get("userId")]
```

Without `identify`, you pass the identity itself:

```typescript
const perKey = limiter({ name: "api:key", algorithm: fixedWindow({ limit: 100, window: 60_000 }) })

await rateLimit(perKey, apiKey)
```

`null` is the global identity. Every request that returns `null` shares one count, so a global limit returns it for every request:

```typescript
const daily = limiter({
  name: "suggestions:daily",
  algorithm: fixedWindow({ limit: 2_000, window: ms("1d") }),
  identify: () => null,
})
```

`identify` must always return an identity. There is no way to skip a limiter, because a client could then avoid a limit by leaving out a header. Return `null` instead, as `perDevice` does above, so that every request without the header shares the global count. The global identity never shares a count with a string or a tuple.

`identify` can be async.

### Shared and per-limiter settings

The `name` labels results and headers. It also goes into every key in the store, so limiters with different names never share counts. Give each limiter a unique name of printable ASCII characters.

| Setting   | Type                    | Default     | Description                                                                                              |
| --------- | ----------------------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| `timeout` | `number`                | `1000`      | Milliseconds to wait for the store before the result is a store error.                                   |
| `cache`   | `boolean`               | `true`      | Remember denials in this process until they reset, and skip the store when the same cost is asked again. |
| `mode`    | `"enforce" \| "dryRun"` | `"enforce"` | See [dry-run mode](#try-a-limit-in-dry-run-mode).                                                        |

Pass a setting to `buildLimiter` to apply it to every limiter, or to one limiter to override it:

```typescript
const limiter = buildLimiter({ store, timeout: 500 })

const slowButImportant = limiter({ name: "billing", algorithm, timeout: 2_000 })
```

### Share a store with other apps

Limiters with the same name share counts when they use the same store. To keep apps or services apart in one store, give each factory its own `prefix`:

```typescript
const limiter = buildLimiter({ store, prefix: "billing" })

limiter({ name: "api:ip", algorithm }) // keys start with "billing:api:ip:"
```

The prefix goes before the limiter name in every key, joined with `:`. Limiters share counts when `prefix:name` and the identity match, so prefix `a:b` with name `c` shares counts with prefix `a` with name `b:c`. Results and headers do not show the prefix. The prefix must be printable ASCII. If your Redis client sets a `keyPrefix`, the client adds it before the prefix.

## Run limiters

`rateLimit` spends units and returns the result. It does not reject when the store fails. See [handle store errors](#handle-store-errors).

```typescript
const result = await rateLimit(perIp, c)
```

### Spend more than one unit

Pass a `cost` from 1 to the limiter's limit or capacity. The default is 1:

```typescript
await rateLimit(perUserTokens, c, { cost: usage.totalTokens })
```

A denied request spends nothing. A request that costs 5 with 3 units left is denied, and the 3 units stay available.

### Run several limiters

Pass an array to run limiters in order. `rateLimit` stops at the first denial or store error:

```typescript
const result = await rateLimit([perDevice, perIp, daily], c)

result.name // the limiter that decided
result.results // every limiter's own result, in order
```

When every limiter allows the request, the result is the allowed result with the fewest units remaining, taken from an enforced limiter when there is one. `rateLimit` checks the cost against every limiter before it spends anything.

Limiters that ran before a denial have already spent. Put the broadest limit, such as a global daily total, last: then only requests that pass the narrower limits spend from it.

### Read and clear counts

```typescript
import { clear, remaining } from "richter"

await remaining(perIp, c) // { name, limit, remaining, reset }, spends nothing
await clear(perIp, c) // restores every unit
```

Both reject with `StoreError` when the store fails.

## Read the result

```typescript
const result = await rateLimit(perIp, c)

result.name // "suggestions:ip"
result.success // true when the request may proceed
result.reason // what decided: "store", "cache", "dryRun", or "storeError"

if (result.reason !== "storeError") {
  result.limit // 30
  result.remaining // 12
  result.reset // when a denied request can succeed, or when the window ends, in epoch ms
  result.retryAfter // milliseconds until reset, measured on the store's clock
  result.window // the period the limit covers, in milliseconds
}

if (result.success) result.mode // "enforce" or "dryRun"
```

| `success` | `reason`       | Meaning                                                                   |
| --------- | -------------- | ------------------------------------------------------------------------- |
| `true`    | `"store"`      | The store allowed the request.                                            |
| `true`    | `"dryRun"`     | The store denied the request, but the limiter is in dry-run mode.         |
| `false`   | `"store"`      | The store denied the request.                                             |
| `false`   | `"cache"`      | A denial remembered in this process denied the request without the store. |
| `false`   | `"storeError"` | The store failed or timed out. `result.error` is a `StoreError`.          |

A store error has no counts, so TypeScript asks you to check `reason` before you read them.

For a denied request, `reset` is the first moment the same request can succeed, so `retryAfter` is an exact wait, not a guess.

## Send rate limit headers

`headers(result)` returns the `RateLimit-Policy` and `RateLimit` headers of the [IETF RateLimit header fields draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/), and `Retry-After` for a denial:

```typescript
import { headers } from "richter"

headers(result)
// {
//   "RateLimit-Policy": '"suggestions:ip";q=30;w=3600',
//   "RateLimit": '"suggestions:ip";r=12;t=1800',
//   "Retry-After": "1800", // only when denied
// }
```

A store error and a dry-run limiter's result produce no headers.

## Write middleware

Middleware is a few lines of your own code. This Hono middleware runs limiters, sets headers, and refuses denied requests:

```typescript
import type { Context } from "hono"
import { createMiddleware } from "hono/factory"
import { headers, rateLimit, type Limiter } from "richter"

export function withRateLimit(limiters: [Limiter<Context>, ...Array<Limiter<Context>>]) {
  return createMiddleware(async (c, next) => {
    const result = await rateLimit(limiters, c)

    for (const [name, value] of Object.entries(headers(result))) c.header(name, value)

    if (!result.success) {
      return c.json({ error: "rate_limited", limit: result.name }, 429)
    }

    await next()
  })
}

app.post("/v1/goals/suggestions", withRateLimit([perDevice, perIp, daily]), suggest)
```

Express is the same shape:

```typescript
export function withRateLimit(limiters: [Limiter<Request>, ...Array<Limiter<Request>>]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const result = await rateLimit(limiters, req)

    res.set(headers(result))

    if (!result.success) return res.status(429).json({ error: "rate_limited" })

    next()
  }
}
```

## Handle store errors

When the store fails or does not answer within `timeout`, `rateLimit` returns a store error: `success` is `false`, and `error` is a `StoreError` with the original error as its `cause`. Code that only checks `success` refuses the request. This keeps a limit that protects spending, such as calls to a paid API, in force during an outage.

A store error does not mean nothing was counted. A command that timed out can still complete in the store, so the request may have spent units.

To let requests through on some routes instead, decide in your middleware:

```typescript
export function withRateLimit(limiters, { onStoreError = "deny" } = {}) {
  return createMiddleware(async (c, next) => {
    const result = await rateLimit(limiters, c)

    if (result.reason === "storeError") {
      logger.warn({ limiter: result.name, error: result.error }, "Rate limit store unavailable")

      if (onStoreError === "allow") return next()
    }

    // ...
  })
}

app.get("/v1/invites/:code", withRateLimit([perIpInvites], { onStoreError: "allow" }), invite)
```

To fall back to counting in each instance, run a second limiter on a [memory store](#memory). Give it a lower limit, because each instance counts separately: with four instances, a local limit of 10 allows up to 40 requests in total.

```typescript
const local = buildLimiter({ store: memoryStore() })

const perIpLocal = local({
  name: "suggestions:ip",
  algorithm: slidingWindow({ limit: 10, window: ms("1h") }),
  identify: ipOf,
})

let result = await rateLimit(perIp, c)
if (result.reason === "storeError") result = await rateLimit(perIpLocal, c)
```

When the Redis server is down, ioredis and Bun's client queue commands until they reconnect by default, so each request waits for the full `timeout`. To fail at once instead, set `enableOfflineQueue: false` on either client.

## Try a limit in dry-run mode

A limiter in dry-run mode counts normally but lets denied requests through, with `reason: "dryRun"`. Use it to see how often a new limit would deny before you enforce it:

```typescript
const perDevice = limiter({
  name: "suggestions:device",
  algorithm: slidingWindow({ limit: 10, window: ms("1h") }),
  identify: deviceOf,
  mode: "dryRun",
})

const result = await rateLimit([perDevice, perIp], c)

for (const each of result.results) {
  if (each.reason === "dryRun") logger.info({ limiter: each.name }, "Rate limit would deny")
}
```

A dry-run limiter never stops a chain of limiters, never decides a chain that has an enforced limiter, does not use the denial cache, and produces no headers.

## Stores

A store holds the counts and applies an algorithm to them in one indivisible step.

### Redis, Valkey, and Bun

Each client has its own store. Pass the client as it is:

```typescript
// ioredis or node-redis
import { redisStore } from "richter/stores/redis"
redisStore(redis)

// iovalkey
import { valkeyStore } from "richter/stores/valkey"
valkeyStore(valkey)

// Bun's own client
import { bunRedisStore } from "richter/stores/bun-redis"
bunRedisStore(new Bun.RedisClient(process.env.REDIS_URL))
```

The stores work with Redis 7 or later and Valkey 7.2 or later, on any server that speaks the Redis protocol and runs Lua scripts. They run the same scripts, so they count the same way. A client's `keyPrefix` applies to every key the store writes and clears.

Each check runs one Lua script with `EVALSHA`, and loads the script with `EVAL` when the server does not have it. Scripts read the time with `TIME`, so every instance agrees on window boundaries. Keys expire when their state no longer matters.

Every check touches a single key, as Redis Cluster requires.

### Memory

`memoryStore` counts in the current process. Each instance of your application counts separately, and a restart clears all counts. Use it for tests, for single-instance applications, and as a fallback.

```typescript
import { memoryStore } from "richter/stores/memory"

memoryStore()
memoryStore({ clock: () => fakeNow }) // a clock you control, for tests
```

### Write a store

A store implements two functions:

```typescript
import type { Store } from "richter"

const store: Store = {
  consume: async ({ key, algorithm, cost }) => {
    // Apply the algorithm atomically.
    return { success, remaining, reset, now }
  },
  clear: async (key) => {
    // Forget the key.
  },
}
```

A store must follow these rules:

- **Each `consume` call is atomic.** Concurrent calls for one key, from any process, behave as if they ran one after another. A read followed by a separate write is not enough: concurrent requests then pass the limit together.
- **A denial changes nothing.**
- **A cost of 0 reads without writing.**
- **The store's own clock decides.** `now` is the store's time in epoch milliseconds.
- **The arithmetic matches the built-in stores.** See `src/lib/stores/memory/memory-store.ts`.

A store that supports only some algorithms declares them, and TypeScript then refuses the others:

```typescript
const store: Store<FixedWindow> = postgresStore({ query })
```

Key-value abstractions such as unstorage drivers cannot be stores, because they have no atomic read-and-write.

## Errors

richter exports these `Error` subclasses. `InvalidReplyError` comes from `richter/stores/redis`, `richter/stores/valkey`, and `richter/stores/bun-redis`, and the rest from `richter`:

| Error                | Fields            | When                                                                    |
| -------------------- | ----------------- | ----------------------------------------------------------------------- |
| `InvalidOptionError` | `option`, `value` | A limit, window, interval, capacity, timeout, name, or cost is invalid. |
| `StoreError`         | `cause`           | The store failed. Carried in a store error result.                      |
| `StoreTimeoutError`  | `timeout`         | The store did not answer in time. The `cause` of a `StoreError`.        |
| `InvalidReplyError`  | `reply`           | Redis returned an unexpected reply. The `cause` of a `StoreError`.      |

`rateLimit` rejects only with `InvalidOptionError`, or with whatever your `identify` function throws.

## Compared with other libraries

|                         | richter                    | hono-rate-limiter        | rate-limiter-flexible |
| ----------------------- | -------------------------- | ------------------------ | --------------------- |
| Stores                  | Redis, Valkey, Bun, memory | Memory, Redis, unstorage | Many                  |
| Algorithms              | Fixed, sliding, bucket     | Fixed                    | Fixed                 |
| Counts across instances | Yes                        | Not with memory          | Yes                   |
| Atomic in every store   | Yes                        | Not with unstorage       | Yes                   |
| Framework integrations  | None, by design            | Hono                     | None                  |

## License

[MIT](LICENSE)
