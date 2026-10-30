# Testing

- A source file's tests live next to it in `__tests__/<file>.test.ts`, and test that file. Helpers that several test files share go in a plain `__tests__/<name>.ts` file.
- `pnpm run test` runs the unit tests, which need no server. Each store has its own Vitest project and script: `test:redis-store`, `test:valkey-store`, and `test:bun-redis-store`. CI runs each as its own job.
- The store tests need a server at `REDIS_URL`, which defaults to `redis://localhost:6379`. Start one with `docker run --rm -p 6379:6379 redis:8`, or `valkey/valkey:8` for the Valkey store.
- `test:bun-redis-store` runs Vitest on Bun, so it needs Bun installed.
- `script-store.test.ts` tests the scripts themselves and runs with both the Redis and the Valkey store tests.
- Every store runs the shared suite in `src/lib/store/__tests__/conformance.ts`. A new store must pass it.
- Each supported runtime runs the built package on its floor. `scripts/compat/smoke.mjs` holds the checks and imports nothing. Each runtime has an entry file in `scripts/compat/` and a `compat-<runtime>` job in `test.yml`, which pins the floor from `engines` in `package.json`. To add a runtime such as workerd, add an entry file that loads `dist/` and calls `smoke`, and add its job.
