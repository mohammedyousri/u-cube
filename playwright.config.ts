import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.U3_PORT ?? 5173);

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results/.playwright",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: "chrome",
    headless: true,
    viewport: { width: 1280, height: 860 },
  },
});
