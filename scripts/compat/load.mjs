// Loads the built package from a directory, for the runtimes that can import files by path.

import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

/**
 * @param {string} distDir The directory of the built package.
 *
 * @returns {Promise<import("./smoke.mjs").Package>} Every entry of the package.
 */
export async function load(distDir) {
  /**
   * @param {string} file
   */
  const url = (file) => pathToFileURL(resolve(distDir, file)).href

  return {
    /**
     * @type {typeof import("../../src/stores/bun-redis")}
     */
    bunRedis: await import(url("stores/bun-redis.js")),
    /**
     * @type {typeof import("../../src/index")}
     */
    library: await import(url("index.js")),
    /**
     * @type {typeof import("../../src/stores/memory")}
     */
    memory: await import(url("stores/memory.js")),
    /**
     * @type {typeof import("../../src/stores/redis")}
     */
    redis: await import(url("stores/redis.js")),
    /**
     * @type {typeof import("../../src/stores/valkey")}
     */
    valkey: await import(url("stores/valkey.js")),
  }
}
