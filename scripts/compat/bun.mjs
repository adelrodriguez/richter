// Runs the compatibility checks on Bun. CI runs this file on the `engines.bun` floor in
// package.json: 1.4.0, the first release built from Bun's Rust code.
//
// Usage: bun scripts/compat/bun.mjs [dist directory]

import { resolve } from "node:path"
import { load } from "./load.mjs"
import { smoke } from "./smoke.mjs"

// `bunRedisStore` takes a `Bun.RedisClient` as it is, so the client must have the method it uses.
if (typeof Bun.RedisClient.prototype.send !== "function") {
  throw new Error("Compatibility smoke test failed: Bun.RedisClient has no send method")
}

await smoke(await load(resolve(process.argv[2] ?? "dist")))
