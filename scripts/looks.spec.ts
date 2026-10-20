// Renders the candidate "looks" as a contact sheet: docs/looks.png
/// <reference types="node" />
import { test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const LOOKS = [
  { id: "A", name: "Navy signature", note: "Brand navy, classic stickers, black cube", s: { background: "navy", palette: "classic", body: "black" } },
  { id: "B", name: "Daylight classic", note: "Bright studio, classic stickers, black cube", s: { background: "auto", theme: "light", palette: "classic", body: "black" } },
  { id: "C", name: "Stickerless pro", note: "Graphite, vivid stickerless speedcube", s: { background: "custom", customBg: "#17191f", palette: "vivid", body: "stickerless" } },
  { id: "D", name: "Paper and pastel", note: "Warm paper, pastel stickers, white cube", s: { background: "paper", palette: "pastel", body: "white" } },
];

async function shoot(page: Page, settings: object, w: number, h: number, file: string, mobile: boolean) {
  await page.setViewportSize({ width: w, height: h });
  await page.evaluate((s) => localStorage.setItem("u3.settings", JSON.stringify({ ...s, turnMs: 400 })), settings);
  await page.evaluate(() => localStorage.setItem("u3.level", "medium"));
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__u3);
  await page.click('[data-action="new"]');
  await page.waitForFunction(() => ["ready", "inspecting"].includes((window as any).__u3.game.status));
  await page.waitForTimeout(600);
  await page.keyboard.press("i"); // R, captured mid-turn to show the highlight
  await page.waitForTimeout(170);
  await page.screenshot({ path: file });
  void mobile;
}

test("looks", async ({ browser }) => {
  test.setTimeout(240_000);
  const desk = await browser.newPage();
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })).newPage();
  await desk.goto("/");
  await phone.goto("/");
  for (const l of LOOKS) {
    await shoot(desk, l.s, 1280, 800, `test-results/shots/look-${l.id}-desk.png`, false);
    await shoot(phone, l.s, 390, 844, `test-results/shots/look-${l.id}-phone.png`, true);
  }
  const img = (f: string) => `data:image/png;base64,${readFileSync(f).toString("base64")}`;
  const rows = LOOKS.map((l) => `
    <div style="display:flex;gap:18px;align-items:flex-start;margin-bottom:26px">
      <div style="width:150px;font:600 15px system-ui;color:#12224F"><div style="font:800 34px system-ui;color:#FF610F">${l.id}</div>${l.name}<div style="font:400 13px system-ui;color:#5d667a;margin-top:6px">${l.note}</div></div>
      <img src="${img(`test-results/shots/look-${l.id}-desk.png`)}" style="width:640px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.15)">
      <img src="${img(`test-results/shots/look-${l.id}-phone.png`)}" style="width:195px;border-radius:14px;box-shadow:0 2px 10px rgba(0,0,0,.15)">
    </div>`).join("");
  await desk.setViewportSize({ width: 1060, height: 800 });
  await desk.setContent(`<html><body style="margin:0;padding:26px;background:#f3f4f7">${rows}</body></html>`);
  await desk.waitForTimeout(300);
  await desk.screenshot({ path: "docs/looks.png", fullPage: true });
});
