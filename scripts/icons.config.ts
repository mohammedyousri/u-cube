import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  outputDir: "../test-results/.playwright-scripts",
  testMatch: ["make-icons.spec.ts", "tnoodle-sheet.spec.ts", "gallery*.spec.ts", "looks.spec.ts", "ux-journey.spec.ts", "pwa.spec.ts"],
  use: { baseURL: "http://localhost:5173", channel: "chrome", headless: true },
});
