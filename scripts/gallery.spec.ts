// Screenshots for visual review (not assertions). Run: npx playwright test e2e/gallery.spec.ts
import { test } from "@playwright/test";
import { boot, waitStatus } from "../e2e/helpers";

const DIR = "test-results/shots";

async function settle(page: import("@playwright/test").Page, ms = 900) {
  await page.waitForTimeout(ms);
}

test("gallery", async ({ page }) => {
  test.setTimeout(180_000);
  await boot(page);
  await page.click('[data-level="medium"]');
  await waitStatus(page, "ready");
  await settle(page);
  await page.screenshot({ path: `${DIR}/01-desktop-light.png` });

  // appearance: midnight + vivid + stickerless, arrows on with a face selected
  await page.evaluate(() => {
    localStorage.setItem("u3.settings", JSON.stringify({ background: "midnight", palette: "vivid", body: "stickerless", arrows: true }));
  });
  await page.reload();
  await page.waitForFunction(() => !!window.__u3);
  await page.click('[data-level="medium"]');
  await waitStatus(page, "ready");
  await settle(page);
  const [x, y] = await page.evaluate(() => window.__u3.stickerScreen(22));
  await page.mouse.click(x, y);
  await settle(page, 500);
  await page.screenshot({ path: `${DIR}/02-midnight-vivid-arrows.png` });
  await page.click(".turn-arrow[data-turn='1']");
  await page.waitForTimeout(60);
  await page.screenshot({ path: `${DIR}/03-turning-highlight.png` });

  await page.click('[data-action="settings"]');
  await settle(page, 500);
  await page.screenshot({ path: `${DIR}/04-settings.png` });
  await page.click('[data-p="close"]');

  await page.evaluate(() => localStorage.setItem("u3.settings", JSON.stringify({ background: "sunset", palette: "pastel", body: "white" })));
  await page.reload();
  await page.waitForFunction(() => !!window.__u3);
  await settle(page);
  await page.screenshot({ path: `${DIR}/05-sunset-pastel-white.png` });

  await page.evaluate(() => localStorage.setItem("u3.settings", JSON.stringify({ background: "custom", customBg: "#7a7a7a", palette: "contrast", glyphs: true })));
  await page.reload();
  await page.waitForFunction(() => !!window.__u3);
  await settle(page);
  await page.screenshot({ path: `${DIR}/06-custom-grey-contrast-glyphs.png` });

  await page.evaluate(() => localStorage.setItem("u3.settings", JSON.stringify({ arrows: true })));
  for (const [name, w, h] of [["07-phone", 390, 844], ["08-tablet", 820, 1180], ["09-phone-landscape", 844, 390]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.reload();
    await page.waitForFunction(() => !!window.__u3);
    await page.click('[data-action="new"]');
    await waitStatus(page, "ready", "inspecting");
    await settle(page);
    await page.screenshot({ path: `${DIR}/${name}.png` });
  }
});
