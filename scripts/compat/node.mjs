// Runs the compatibility checks on Node.js. CI runs this file on the `engines.node` floor in
// package.json. This file also removes globals that are newer than the floor, so a run on a newer
// Node.js fails in the same way as a run on the floor.
//
// The bundle must not import Node.js modules, so it also runs on Bun and workerd. That check reads
// the files, so only this runtime runs it.
//
// Usage: node scripts/compat/node.mjs [dist directory]

import { readdir, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { load } from "./load.mjs"
import { smoke } from "./smoke.mjs"

const distDir = resolve(process.argv[2] ?? "dist")

const all = await readdir(distDir, { recursive: true })
const files = all.filter((file) => file.endsWith(".js"))
const contents = await Promise.all(files.map((file) => readFile(resolve(distDir, file), "utf8")))

for (const [index, content] of contents.entries()) {
  if (/(?:from|import|require)\s*\(?\s*["']node:/.test(content)) {
    throw new Error(`Compatibility smoke test failed: ${files[index]} imports a Node.js module`)
  }
}

// Globals that Node.js added after 22.0.0.
delete RegExp.escape
delete Error.isError
delete Math.sumPrecise

await smoke(await load(distDir))
