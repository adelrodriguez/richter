// The most mean latency, in microseconds, that each benchmark case may take on a GitHub-hosted
// runner. `scripts/bench-report.ts` fails a pull request that goes over a budget. Each budget started
// at 2x the slowest of three CI runs, because results move by up to 2x between runners. Lower a
// budget when a change makes a case faster, and never raise one without a reason in the pull request.
export const budgets: Record<string, Record<string, Record<string, number>>> = {
  "bunRedisStore with Bun.RedisClient": {
    fixedWindow: {
      "100 concurrent, one key": 2500,
      "100 concurrent, unique keys": 2700,
      allowed: 290,
      denied: 280,
    },
    slidingWindow: {
      "100 concurrent, one key": 2500,
      "100 concurrent, unique keys": 2900,
      allowed: 280,
      denied: 280,
    },
    tokenBucket: {
      "100 concurrent, one key": 2600,
      "100 concurrent, unique keys": 2800,
      allowed: 280,
      denied: 270,
    },
  },
  memoryStore: {
    fixedWindow: {
      "100 concurrent, one key": 130,
      "100 concurrent, unique keys": 250,
      allowed: 0.75,
      denied: 0.6,
    },
    slidingWindow: {
      "100 concurrent, one key": 120,
      "100 concurrent, unique keys": 250,
      allowed: 1.4,
      denied: 1.3,
    },
    tokenBucket: {
      "100 concurrent, one key": 120,
      "100 concurrent, unique keys": 270,
      allowed: 1.5,
      denied: 1.4,
    },
  },
  rateLimit: {
    fixedWindow: {
      rateLimit: 4.6,
      "store.consume": 0.68,
    },
  },
  "redisStore with ioredis": {
    fixedWindow: {
      "100 concurrent, one key": 3600,
      "100 concurrent, unique keys": 3700,
      allowed: 350,
      denied: 350,
    },
    slidingWindow: {
      "100 concurrent, one key": 4000,
      "100 concurrent, unique keys": 3700,
      allowed: 350,
      denied: 340,
    },
    tokenBucket: {
      "100 concurrent, one key": 4300,
      "100 concurrent, unique keys": 4300,
      allowed: 370,
      denied: 360,
    },
  },
  "redisStore with node-redis": {
    fixedWindow: {
      "100 concurrent, one key": 2900,
      "100 concurrent, unique keys": 3400,
      allowed: 380,
      denied: 370,
    },
    slidingWindow: {
      "100 concurrent, one key": 3000,
      "100 concurrent, unique keys": 3700,
      allowed: 350,
      denied: 340,
    },
    tokenBucket: {
      "100 concurrent, one key": 3000,
      "100 concurrent, unique keys": 3400,
      allowed: 360,
      denied: 360,
    },
  },
  "valkeyStore with iovalkey": {
    fixedWindow: {
      "100 concurrent, one key": 3800,
      "100 concurrent, unique keys": 4000,
      allowed: 350,
      denied: 320,
    },
    slidingWindow: {
      "100 concurrent, one key": 4000,
      "100 concurrent, unique keys": 4500,
      allowed: 350,
      denied: 350,
    },
    tokenBucket: {
      "100 concurrent, one key": 3600,
      "100 concurrent, unique keys": 3900,
      allowed: 330,
      denied: 330,
    },
  },
}
