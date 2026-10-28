# AGENTS.md

Use ASD-STE100 Simplified Technical English for all communication.

Before you explore or change code, read the relevant `GLOSSARY.md` files. Use the
ubiquitous language in these files.

## Agent skills

### Issue tracker

Issues and PRDs are tracked as GitHub issues at `adelrodriguez/richter`. See
`docs/agents/issue-tracker.md`.

### Triage labels

Use the default five-role triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Use the single-context domain-doc layout. See `docs/agents/domain.md`.

## Changesets

- Use Changesets for versioning and changelog management.
- Run `pnpm exec changeset --empty` to create an empty changeset.
- Do not make a major version bump unless the user requests it.
- If a change is breaking and the package is at version 1.0.0 or higher, alert the user.

<!-- ADAMANTITE:START -->

## Adamantite

This project uses Adamantite for its managed formatting, linting, type checking, and dependency-analysis setup.

- Prefer the package scripts Adamantite added for this workspace.
- Run `pnpm run check` to catch formatting, lint, and type issues. Direct command: `adamantite check`.
- Run `pnpm run fix` to apply formatting and safe lint fixes. Direct command: `adamantite fix`.
- Run `pnpm run analyze` after changing dependencies, imports, or exports. Direct command: `adamantite analyze`.
- Use `adamantite doctor` to inspect managed setup and `adamantite doctor --fix` for safe local fixes.

<!-- ADAMANTITE:END -->

<!-- PACKREF:START -->

## Packref

Packref provides local copies of dependency source code so you can inspect the exact implementation used by this project.

- Source references are stored in `.packref/packages/<registry>/<package>/<version>/` for unscoped packages and `.packref/packages/<registry>/<scope>/<package>/<version>/` for scoped packages — browse these directories to read dependency internals
- `.packref/packref-lock.json` is shared and should be committed; `.packref/packages/` is developer-local and git-ignored
- Run `packref install` after cloning when locked references are missing; install restores locked references exactly and does not install runtime dependencies
- Available commands:
  - `packref add [package]` — select manifest dependencies, fetch a registry package, or fetch a direct repository source (e.g. `packref add react`, `packref add hono@4.2.0`, `packref add adelrodriguez/packref`)
    - Direct repository package specs support GitHub shorthand (`owner/repository[/directory][@ref]`), provider shorthand (`github:`, `gitlab:`, `bitbucket:`, or `sourcehut:`), standard Git URLs, and SCP-style SSH URLs
    - A repository ref can be a tag, branch, or full 40-character commit SHA; without a ref, Packref pins the default branch commit
  - `packref remove [package]` — select or name package references to remove
  - `packref install` — materialize every reference already recorded in the committed lockfile
  - `packref sync` — update or remove dependency-tracked lock entries to match current `package.json` dependency versions
  - `packref list` — show all referenced packages
  - `packref prune` — remove unused entries from the global store
  - `packref clean` — remove all project-local references
  - `packref clean --global` — wipe all global store entries
- `packref remove`, `packref prune`, and `packref clean` delete state — run them only when the user requests that removal
- Use Packref when you need to understand how a dependency works internally — read the source in `.packref/` instead of guessing or searching the web
- Multiple versions of the same package can coexist; check `.packref/packref-lock.json` for the full list

<!-- PACKREF:END -->

## Structure

- `src/lib` holds one folder per domain. Dependencies point one way: `options` and `expiring-map` ← `algorithms` ← `store` (the contract) ← `stores/*` and `limiter`. `oxlint.config.ts` enforces this.
- A folder imports its own files with `./`, and other folders with `#lib/...`.
- A new store goes in `src/lib/stores/<name>/`, with its public entry in `src/stores/<name>.ts`, a `./stores/<name>` export in `package.json`, and an entry in `tsdown.config.ts`. The lint rules already cover it.
- An error class lives with the code that throws it.
- The Redis scripts are plain `.lua` files. `scripts.macro.ts` inlines them into the bundle at build time through `unplugin-macros`, so the package never reads files at run time.
- `src/lib/stores/redis/` holds one store per client: `redis-store.ts` (ioredis and node-redis), `valkey-store.ts` (iovalkey), and `bun-redis-store.ts` (`Bun.RedisClient`). Each takes the client as it is and adapts it to `scriptStore` in `script-store.ts`, which runs the scripts. A new client for these servers gets its own store here.

## Tests

- `pnpm run test` runs the unit tests, which need no server. Each store has its own Vitest project and script: `test:redis-store`, `test:valkey-store`, and `test:bun-redis-store`. CI runs each as its own job.
- The store tests need a server at `REDIS_URL`, which defaults to `redis://localhost:6379`. Start one with `docker run --rm -p 6379:6379 redis:8`, or `valkey/valkey:8` for the Valkey store.
- `test:bun-redis-store` runs Vitest on Bun, so it needs Bun installed.
- `script-store.test.ts` tests the scripts themselves and runs with both the Redis and the Valkey store tests.
- Every store runs the shared suite in `src/lib/store/__tests__/conformance.ts`. A new store must pass it.

## Benchmarks

- `pnpm run bench` runs the benchmarks that need no server: the memory store and the limiter. Each store has its own script: `bench:redis-store`, `bench:valkey-store`, and `bench:bun-redis-store`. They need the same server as the store tests.
- Every store runs the shared benchmarks in `src/lib/store/__tests__/benchmarks.ts`. A new store gets a `<name>.bench.ts` file and a `benchmark.include` entry in `vitest.config.ts`.
- `vitest bench` names each benchmark project `<project> (bench)`.
- The `performance-check` workflow runs on each pull request that changes `src/`, `vitest.config.ts`, or `pnpm-lock.yaml`. The `performance-check` label makes it run on any pull request. It runs the benchmarks of the pull request and of its base branch on the same runner, and posts the results as one comment, which each run updates.
- The check fails when a case is more than 10% slower than the base branch, by more than the combined margin of error, or when a case goes over its budget in `scripts/bench-budgets.ts`. `scripts/bench-report.ts` makes this decision and writes the comment. The `performance-check` job is a required check on `main`. When no benchmarks need to run, it is skipped, which counts as passed.
- The budgets are mean latencies on a GitHub-hosted runner, in microseconds. Results move by up to 2x between runners, so a budget is 2x the slowest CI result. A local run can go over a budget on a slower machine. When a change makes a case faster, the comment proposes a lower budget. Do not raise a budget without a reason in the pull request.
