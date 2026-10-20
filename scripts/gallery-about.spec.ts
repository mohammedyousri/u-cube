import { test } from "@playwright/test";
import { boot } from "../e2e/helpers";
test("about gallery", async ({ page }) => {
  await boot(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: "test-results/shots/10-header.png", clip: { x: 0, y: 0, width: 520, height: 90 } });
  await page.click("#brand");
  await page.waitForTimeout(3600);
  await page.screenshot({ path: "test-results/shots/11-about-light.png" });
  await page.keyboard.press("Escape");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click("#brand");
  await page.waitForTimeout(3600);
  await page.screenshot({ path: "test-results/shots/12-about-dark-phone.png" });
});
