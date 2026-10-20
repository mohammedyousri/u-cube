// Renders the scramble nets used for the TNoodle cross-check (docs/tnoodle-check.png).
/// <reference types="node" />
import { test } from "@playwright/test";
import { writeFileSync } from "node:fs";

export const SCRAMBLES = [
  "R2 D' F2 U' B2 R2 D2 L2 U' F2 L' F' R2 U B' L' D2 R' F R'",
  "F2 U2 L2 B2 D' R2 U' F2 D B2 U' L D F' L' R2 B U' R D' F'",
  "U' B2 U' L2 B2 U2 R2 D' L2 F2 R' U F' D2 L' B R F' U2 R",
  "L2 F' R2 D2 B' U2 B R2 F' R2 F2 R' D L' D' B2 U' F' L2 U",
  "D2 B2 L' U2 L' F2 R' B2 L2 U2 B' L D R2 U B' D' F U2",
];

test("tnoodle sheet", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).__u3);
  const html = await page.evaluate(async (scr) => {
    const { netSvg } = await import(/* @vite-ignore */ "/src/ui/net.ts");
    const rows = scr.map((s: string, i: number) => {
      const f = (window as any).__u3.expected(s);
      return `<div style="display:flex;gap:24px;align-items:center;margin:0 0 18px"><div style="width:30px;font:700 20px system-ui">${i + 1}</div>${netSvg(f, { size: 18 })}<code style="font:15px ui-monospace,monospace;max-width:420px">${s}</code></div>`;
    });
    return `<div style="padding:24px;background:#fff">${rows.join("")}</div>`;
  }, SCRAMBLES);
  await page.setViewportSize({ width: 1000, height: 1000 });
  await page.setContent(`<html><body style="margin:0;background:#fff">${html}</body></html>`);
  await page.screenshot({ path: "docs/tnoodle-check.png", fullPage: true });
  writeFileSync("docs/tnoodle-scrambles.txt", SCRAMBLES.join("\n") + "\n");
});
