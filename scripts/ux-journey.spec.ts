// A human-style walkthrough with real touch input (CDP touch events), screenshots
// of every step in test-results/ux/, and touch-latency measurements.
// Run: npx playwright test --config scripts/icons.config.ts ux-journey
/// <reference types="node" />
import { test, expect, type Page, type CDPSession } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "test-results/ux";
mkdirSync(OUT, { recursive: true });

declare global {
  interface Window {
    __u3: any;
    __lat: { input: number[]; frames: number[] };
  }
}

/** For each face move: [from sticker, toward sticker, extend past target]. Directions verified by the drag tests. */
const DRAG: Record<string, [number, number, boolean]> = {
  "R'": [20, 26, false], R: [26, 20, false],
  "L": [18, 24, false], "L'": [24, 18, false],
  U: [20, 19, true], "U'": [18, 19, true],
  D: [24, 25, true], "D'": [26, 25, true],
  F: [9, 15, false], "F'": [15, 9, false],
  B: [2, 1, true], "B'": [0, 1, true],
};

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

async function touchDrag(page: Page, cdp: CDPSession, a: [number, number], b: [number, number], ms = 200) {
  const steps = Math.max(6, Math.round(ms / 16));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: a[0], y: a[1] }] });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // a finger accelerates and settles
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: a[0] + (b[0] - a[0]) * e, y: a[1] + (b[1] - a[1]) * e }] });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function tap(cdp: CDPSession, p: [number, number]) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p[0], y: p[1] }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function tapEl(page: Page, cdp: CDPSession, sel: string) {
  const box = await page.locator(sel).first().boundingBox();
  if (!box) throw new Error(`not visible: ${sel}`);
  await tap(cdp, [box.x + box.width / 2, box.y + box.height / 2]);
  await page.waitForTimeout(250);
}

async function dragMove(page: Page, cdp: CDPSession, move: string) {
  if (move.endsWith("2")) {
    await dragMove(page, cdp, move[0]);
    await dragMove(page, cdp, move[0]);
    return;
  }
  const [from, to, extend] = DRAG[move];
  const A: [number, number] = await page.evaluate((i) => window.__u3.stickerScreen(i), from);
  const B: [number, number] = await page.evaluate((i) => window.__u3.stickerScreen(i), to);
  const end: [number, number] = extend ? [2 * B[0] - A[0], 2 * B[1] - A[1]] : B;
  await touchDrag(page, cdp, A, end, 220);
  await page.waitForTimeout(260);
}

const inverse = (alg: string) =>
  alg.split(" ").filter(Boolean).reverse().map((t) => (t.endsWith("'") ? t[0] : t.endsWith("2") ? t : t + "'"));

function stats(xs: number[]) {
  const s = xs.slice().sort((a, b) => a - b);
  const p = (q: number) => +(s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0).toFixed(1);
  return { n: s.length, p50: p(0.5), p95: p(0.95), max: +(s[s.length - 1] ?? 0).toFixed(1) };
}

test("phone: touch journey, CPU 4× slower", async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  // input-to-frame latency: time from a touch-driven pointermove to the next animation frame
  await page.addInitScript(() => {
    window.__lat = { input: [], frames: [] };
    let pending: number[] = [];
    addEventListener("pointermove", (e) => pending.push(e.timeStamp), true);
    let last = performance.now();
    const loop = (t: number) => {
      for (const s of pending) window.__lat.input.push(t - s);
      pending = [];
      window.__lat.frames.push(t - last);
      last = t;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.goto("/");
  await page.waitForFunction(() => !!window.__u3);
  await page.waitForTimeout(1500);
  await shot(page, "p01-first-open");

  await tapEl(page, cdp, '[data-action="help"]');
  await page.waitForTimeout(400);
  await shot(page, "p02-help");
  await tapEl(page, cdp, '[data-p="close"]');

  await tapEl(page, cdp, '[data-level="warmup"]');
  await page.waitForFunction(() => ["ready", "inspecting"].includes(window.__u3.game.status), undefined, { timeout: 30_000 });
  await page.waitForTimeout(500);
  await shot(page, "p03-warmup-scrambled");

  // solve by dragging stickers with a finger
  const alg: string = await page.evaluate(() => window.__u3.game.scramble.alg);
  await page.evaluate(() => {
    window.__lat.input.length = 0;
    window.__lat.frames.length = 0;
  });
  for (const m of inverse(alg)) await dragMove(page, cdp, m);
  const touchLatency = await page.evaluate(() => ({ input: window.__lat.input.slice(), frames: window.__lat.frames.slice() }));
  await page.waitForTimeout(1300);
  const status = await page.evaluate(() => window.__u3.game.status);
  await shot(page, "p04-solved-result");
  expect(status, `scramble ${alg} should be solved by touch`).toBe("solved");

  await tapEl(page, cdp, '[data-r="replay"]');
  await page.waitForTimeout(1500);
  await shot(page, "p05-replay");
  await tapEl(page, cdp, "#rp-close");

  await tapEl(page, cdp, '[data-action="stats"]');
  await page.waitForTimeout(400);
  await shot(page, "p06-stats");
  await tapEl(page, cdp, '[data-p="close"]');

  await tapEl(page, cdp, '[data-action="settings"]');
  await page.waitForTimeout(400);
  await shot(page, "p07-settings-top");
  await page.locator(".panel-body").evaluate((el) => (el.scrollTop = 700));
  await page.waitForTimeout(200);
  await shot(page, "p08-settings-controls");
  await tapEl(page, cdp, "label[for='arrows'] ~ input, #arrows");
  await tapEl(page, cdp, '[data-p="close"]');

  // arrows: new easy scramble, tap the front face, turn with the arrow
  await tapEl(page, cdp, '[data-level="easy"]');
  await page.waitForFunction(() => ["ready", "inspecting"].includes(window.__u3.game.status), undefined, { timeout: 30_000 });
  await page.waitForTimeout(500);
  const center: [number, number] = await page.evaluate(() => window.__u3.stickerScreen(22));
  await tap(cdp, center);
  await page.waitForTimeout(400);
  await shot(page, "p09-arrows-face-selected");
  await tapEl(page, cdp, ".turn-arrow[data-turn='1']");
  await page.waitForTimeout(90);
  await shot(page, "p10-arrow-turn-highlight");
  await page.waitForTimeout(400);
  await tapEl(page, cdp, '.nav-arrow[data-rot="y"]');
  await page.waitForTimeout(500);
  await shot(page, "p11-after-rotate");

  // hint
  await tapEl(page, cdp, '[data-action="hint"]');
  await page.waitForTimeout(1200);
  await shot(page, "p12-hint");

  // scanner, manual entry
  await tapEl(page, cdp, '[data-action="scan"]');
  await page.waitForTimeout(400);
  await shot(page, "p13-scan-intro");
  await tapEl(page, cdp, '[data-s="manual"]');
  await page.waitForTimeout(300);
  await shot(page, "p14-scan-manual");
  const f: string = await page.evaluate(() => window.__u3.expected("R U R' F2 D L2 B U2 F' R"));
  for (let i = 0; i < 54; i++) {
    if (i % 9 === 4) continue;
    await page.evaluate(([i, c]) => {
      document.querySelector(`#review-net [data-i="${i}"]`)!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      document.querySelector<HTMLButtonElement>(`.palette [data-c="${c}"]`)!.click();
    }, [i, f[i]] as const);
  }
  await page.waitForTimeout(200);
  await shot(page, "p15-scan-filled");
  await tapEl(page, cdp, '[data-s="solve"]');
  await page.waitForTimeout(2500);
  await shot(page, "p16-guide-step1");
  await tapEl(page, cdp, '[data-s="next"]');
  await page.waitForTimeout(1500);
  await shot(page, "p17-guide-step2");
  await tapEl(page, cdp, '[data-s="close"]');

  await tapEl(page, cdp, "#brand");
  await page.waitForTimeout(3600);
  await shot(page, "p18-about");

  writeFileSync(`${OUT}/phone-metrics.json`, JSON.stringify({
    cpuThrottle: 4,
    touchInputToNextFrameMs: stats(touchLatency.input),
    frameIntervalDuringDragsMs: stats(touchLatency.frames.slice(5)),
    errors,
  }, null, 2));
  expect(errors).toEqual([]);
});

test("tablet and landscape phone snapshots", async ({ browser }) => {
  test.setTimeout(120_000);
  for (const [name, w, h] of [["t01-tablet-portrait", 820, 1180], ["t02-tablet-landscape", 1180, 820], ["t03-phone-landscape", 844, 390], ["t04-small-phone", 360, 640]] as const) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: w < 900, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto("/");
    await page.waitForFunction(() => !!window.__u3);
    await page.locator('[data-action="new"]').click();
    await page.waitForFunction(() => ["ready", "inspecting"].includes(window.__u3.game.status), undefined, { timeout: 30_000 });
    await page.waitForTimeout(600);
    await shot(page, name);
    // finish a solve to see the result card in this layout
    const alg: string = await page.evaluate(() => window.__u3.game.scramble.alg);
    const keys: Record<string, string> = { R: "i", "R'": "k", U: "j", "U'": "f", F: "h", "F'": "g", D: "s", "D'": "l", L: "d", "L'": "e", B: "w", "B'": "o" };
    for (const m of inverse(alg)) for (const k of m.endsWith("2") ? [keys[m[0]], keys[m[0]]] : [keys[m]]) await page.keyboard.press(k);
    await page.waitForTimeout(1500);
    await shot(page, `${name}-result`);
    await ctx.close();
  }
});
