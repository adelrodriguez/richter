import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { defineMacro } from "unplugin-macros"

// The only files the macro can read, so a caller cannot inline any other file from the build host.
const scripts = ["fixed-window.lua", "sliding-window.lua", "token-bucket.lua"] as const

/**
 * Build-time macro that inlines a Lua script from this folder into the bundle, so the store never
 * reads files at run time. It registers the script as a watched input, so editing a `.lua` file
 * rebuilds in watch mode.
 */
export const readScript = defineMacro(function readScript(file: (typeof scripts)[number]): string {
  if (!scripts.includes(file)) throw new Error(`readScript cannot read ${String(file)}`)

  const path = fileURLToPath(new URL(file, import.meta.url))
  this.unpluginContext.addWatchFile(path)
  return readFileSync(path, "utf8")
})
