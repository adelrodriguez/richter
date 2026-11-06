import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import packageJson from "../package.json" with { type: "json" }

const packageRoot = join(import.meta.dirname, "..")
const temporaryDirectory = mkdtempSync(join(tmpdir(), "richter-build-"))
const targets = Object.values(packageJson.exports)
const exportPaths = [
  packageJson.module,
  packageJson.types,
  ...targets.flatMap((target) => Object.values(target)),
]
const specifiers = Object.keys(packageJson.exports).map(
  (subpath) => `${packageJson.name}${subpath.slice(1)}`
)

function run(command: string, arguments_: string[], cwd: string) {
  execFileSync(command, arguments_, { cwd, stdio: "inherit" })
}

try {
  for (const exportPath of exportPaths) {
    const resolvedPath = join(packageRoot, exportPath)
    if (!existsSync(resolvedPath)) {
      throw new Error(`The package export does not exist: ${exportPath}`)
    }
  }

  // `tsdown.config.ts` builds every file in `src/stores/`, so each built store needs an export.
  const exported = new Set(targets.map((target) => target.import))
  const unexported = readdirSync(join(packageRoot, "dist/stores"))
    .filter((file) => file.endsWith(".js"))
    .map((file) => `./dist/stores/${file}`)
    .filter((path) => !exported.has(path))
  if (unexported.length > 0) {
    throw new Error(`These built entries have no package export: ${unexported.join(", ")}`)
  }

  run("pnpm", ["pack", "--pack-destination", temporaryDirectory], packageRoot)

  const tarballs = readdirSync(temporaryDirectory).filter((file) => file.endsWith(".tgz"))
  const [tarball] = tarballs
  if (!tarball || tarballs.length !== 1) {
    throw new Error(`Expected one package tarball, found ${tarballs.length}`)
  }

  const tarballPath = join(temporaryDirectory, tarball)
  writeFileSync(
    join(temporaryDirectory, "package.json"),
    `${JSON.stringify({ name: "richter-build-verification", private: true, type: "module" }, null, 2)}\n`
  )
  run("npm", ["install", "--ignore-scripts", "--no-package-lock", tarballPath], temporaryDirectory)

  writeFileSync(
    join(temporaryDirectory, "runtime.mjs"),
    `import assert from "node:assert/strict"

import { buildLimiter, fixedWindow, InvalidOptionError, rateLimit } from "richter"
import { memoryStore } from "richter/stores/memory"

const limiter = buildLimiter({ store: memoryStore() })
const perKey = limiter({ algorithm: fixedWindow({ limit: 1, window: 60_000 }), name: "key" })

assert.equal((await rateLimit(perKey, "a")).success, true)
assert.equal((await rateLimit(perKey, "a")).success, false)
assert.throws(() => fixedWindow({ limit: 0, window: 1 }), InvalidOptionError)

for (const specifier of ${JSON.stringify(specifiers)}) {
  const entry = await import(specifier)
  assert.notEqual(Object.keys(entry).length, 0, \`\${specifier} exports nothing\`)
}
`
  )
  run(process.execPath, ["runtime.mjs"], temporaryDirectory)

  writeFileSync(
    join(temporaryDirectory, "consumer.ts"),
    `import { buildLimiter, fixedWindow, rateLimit } from "richter"
import type { LimitResult } from "richter"
import { memoryStore } from "richter/stores/memory"
import { redisStore } from "richter/stores/redis"
import type { IoredisClient } from "richter/stores/redis"

const limiter = buildLimiter({ store: memoryStore() })
const perIp = limiter({
  algorithm: fixedWindow({ limit: 1, window: 60_000 }),
  identify: (request: { ip: string }) => request.ip,
  name: "ip",
})
const result: Promise<LimitResult> = rateLimit(perIp, { ip: "203.0.113.7" })
const client: IoredisClient = {
  del: () => Promise.resolve(0),
  eval: () => Promise.resolve([1, 0, 0, 0]),
  evalsha: () => Promise.resolve([1, 0, 0, 0]),
}

// @ts-expect-error -- perIp identifies a request, not a string.
void rateLimit(perIp, "203.0.113.7")

void [result, redisStore(client)]
`
  )
  writeFileSync(
    join(temporaryDirectory, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          strict: true,
          target: "ESNext",
        },
        files: ["consumer.ts"],
      },
      null,
      2
    )}\n`
  )

  run(
    process.execPath,
    [join(packageRoot, "node_modules/typescript/bin/tsc"), "--project", "tsconfig.json"],
    temporaryDirectory
  )

  console.info("Verified the packed runtime and declarations.")
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true })
}
