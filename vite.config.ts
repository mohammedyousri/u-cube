import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: true },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 120_000,
  },
});
