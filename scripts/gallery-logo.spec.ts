import { test } from "@playwright/test";
import { boot } from "../e2e/helpers";
test("logo gallery", async ({ page }) => {
  await boot(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: "test-results/shots/20-header-light.png", clip: { x: 0, y: 0, width: 420, height: 80 } });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/shots/21-header-dark.png", clip: { x: 0, y: 0, width: 420, height: 80 } });
  await page.click("#brand");
  await page.waitForTimeout(3600);
  await page.screenshot({ path: "test-results/shots/22-about-dark.png" });
  await page.keyboard.press("Escape");
  await page.emulateMedia({ colorScheme: "light" });
  await page.click("#brand");
  await page.waitForTimeout(3600);
  await page.screenshot({ path: "test-results/shots/23-about-light.png" });
  // both marks side by side, large
  await page.setContent(`<html><body style="margin:0;display:flex;gap:40px;padding:40px;background:#e9edf3">
    <div>${await page.evaluate(async () => (await import(/* @vite-ignore */ "/src/ui/logo.ts" as string)).logoSvg({ scheme: "light", id: "a" }))}</div>
    <div>${await page.evaluate(async () => (await import(/* @vite-ignore */ "/src/ui/logo.ts" as string)).logoSvg({ scheme: "dark", id: "b" }))}</div>
    <style>svg{width:300px;height:300px;overflow:visible}</style></body></html>`).catch(() => undefined);
});
