import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  format: ["esm"],
  target: "node18",
  clean: true,
  sourcemap: true,
  dts: false,
  shims: false,
});
