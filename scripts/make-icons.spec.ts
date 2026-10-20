// Generates the web-app icons from the logo source (src/ui/logo.ts).
// Run: npx playwright test --config scripts/icons.config.ts
/// <reference types="node" />
import { test } from "@playwright/test";
import { writeFileSync } from "node:fs";

test("make icons", async ({ page }) => {
  await page.goto("/");
  const modulePath = "/src/ui/logo.ts";
  const { icon, maskable } = await page.evaluate(async (p) => {
    const { logoSvg } = await import(/* @vite-ignore */ p);
    const icon: string = logoSvg({ id: "i", scheme: "dark" });
    // maskable: full-bleed square, artwork inside the 80% safe zone
    const inner = logoSvg({ base: false, id: "m", scheme: "dark" }).replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
    const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#131a26"/><g transform="translate(9.6 10.4) scale(0.7)">${inner}</g></svg>`;
    return { icon, maskable };
  }, modulePath);
  writeFileSync("public/icon.svg", icon.replace(/\s+/g, " ").trim());
  writeFileSync("public/icon-maskable.svg", maskable.replace(/\s+/g, " ").trim());
  const shoot = async (svg: string, size: number, file: string) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: `public/${file}`, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  };
  await shoot(icon, 192, "icon-192.png");
  await shoot(icon, 512, "icon-512.png");
  await shoot(maskable, 512, "icon-maskable-512.png");
  await shoot(maskable, 180, "apple-touch-icon.png");
});
