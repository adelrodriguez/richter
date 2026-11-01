# Architecture

- `src/lib` holds one folder per domain. Dependencies point one way: `options` and `expiring-map` ← `algorithms` ← `store` (the contract) ← `stores/*` and `limiter`. `oxlint.config.ts` enforces this.
- A folder imports its own files with `./`, and other folders with `#lib/...`.
- A new store goes in `src/lib/stores/<name>/`, with its public entry in `src/stores/<name>.ts`, a `./stores/<name>` export in `package.json`, and an entry in `tsdown.config.ts`. The lint rules already cover it.
- An error class lives with the code that throws it.
- The Redis scripts are plain `.lua` files. `scripts.macro.ts` inlines them into the bundle at build time through `unplugin-macros`, so the package never reads files at run time.
- `src/lib/stores/redis/` holds one store per client: `redis-store.ts` (ioredis and node-redis), `valkey-store.ts` (iovalkey), and `bun-redis-store.ts` (`Bun.RedisClient`). Each takes the client as it is and adapts it to `scriptStore` in `script-store.ts`, which runs the scripts. A new client for these servers gets its own store here.
