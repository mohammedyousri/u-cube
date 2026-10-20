// Production build checks: installable as an app, and playable offline.
// Needs `vite preview` on port 4173. Run: npx playwright test --config scripts/icons.config.ts pwa
import { test, expect } from "@playwright/test";

test.use({ baseURL: "http://localhost:4173" });

test("installable web app that works offline", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).__u3);
  // Chrome's own installability verdict
  const cdp = await ctx.newCDPSession(page);
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  // "in-incognito" only reflects the test browser's private profile, not the app
  expect(installabilityErrors.filter((e) => e.errorId !== "in-incognito")).toEqual([]);
  // service worker takes control, then the game works with the network cut
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.ready), undefined, { timeout: 15_000 });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: 15_000 });
  await page.click('[data-level="easy"]'); // also caches the solver worker
  await page.waitForFunction(() => ["ready", "inspecting"].includes((window as any).__u3.game.status), undefined, { timeout: 30_000 });
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__u3, undefined, { timeout: 15_000 });
  await page.click('[data-action="new"]');
  await page.waitForFunction(() => ["ready", "inspecting"].includes((window as any).__u3.game.status), undefined, { timeout: 30_000 });
  await expect(page.locator(".brand")).toBeVisible();
  await page.screenshot({ path: "test-results/ux/offline.png" });
});
