import { expect, type Page } from "@playwright/test";

export const KEY: Record<string, string> = {
  R: "i", "R'": "k", U: "j", "U'": "f", F: "h", "F'": "g", D: "s", "D'": "l", L: "d", "L'": "e", B: "w", "B'": "o",
};

declare global {
  interface Window {
    __u3: any;
  }
}

export async function boot(page: Page, errors: string[] = []) {
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await page.waitForFunction(() => !!window.__u3);
  return errors;
}

export async function waitStatus(page: Page, ...statuses: string[]) {
  await page.waitForFunction((ss) => ss.includes(window.__u3.game.status), statuses, { timeout: 30_000 });
}

/** Inverse of a face-turn scramble, as keys (half turns pressed twice). */
export function solutionKeys(alg: string): string[] {
  const inv = alg.split(" ").filter(Boolean).reverse().map((t) => (t.endsWith("'") ? t[0] : t.endsWith("2") ? t : t + "'"));
  return inv.flatMap((t) => (t.endsWith("2") ? [KEY[t[0]], KEY[t[0]]] : [KEY[t]]));
}

export async function press(page: Page, keys: string[], gapMs = 120) {
  for (const k of keys) {
    await page.keyboard.press(k);
    await page.waitForTimeout(gapMs);
  }
}

export async function stickerXY(page: Page, i: number): Promise<[number, number]> {
  return page.evaluate((i) => window.__u3.stickerScreen(i), i);
}

export async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(450);
}

export async function facelets(page: Page): Promise<string> {
  return page.evaluate(() => window.__u3.facelets());
}

export async function expected(page: Page, alg: string): Promise<string> {
  return page.evaluate((a) => window.__u3.expected(a), alg);
}

export { expect };
