import { defineConfig } from "tsdown"
import { Macros } from "unplugin-macros"

export default defineConfig({
  clean: true,
  dts: true,
  // `scripts/verify-build.ts` fails when a built store has no export in `package.json`.
  entry: ["src/index.ts", "src/stores/*.ts"],
  fixedExtension: false,
  minify: true,
  outDir: "dist",
  platform: "node",
  plugins: [Macros.rolldown()],
  sourcemap: false,
  tsconfig: "tsconfig.build.json",
})
