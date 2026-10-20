/// <reference types="node" />
import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { KEY, boot, facelets, expected } from "./helpers";

const N = 200;
const TPS = 12;

const pct = (xs: number[], p: number) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

test(`${N}-move keyboard burst at ${TPS} TPS, CPU throttled 4×: no dropped moves, frames on budget`, async ({ page, browser }) => {
  test.setTimeout(180_000);
  await boot(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.waitForTimeout(2000);

  // deterministic random face turns
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const moves = Object.keys(KEY);
  const seq = Array.from({ length: N }, () => moves[Math.floor(rnd() * moves.length)]);

  await browser.startTracing(page, { path: "test-results/perf-trace.json", screenshots: false });
  await page.evaluate(() => {
    const p = window.__u3.perf;
    p.frames.length = 0;
    p.work.length = 0;
    p.record = true;
  });
  const start = Date.now();
  for (let i = 0; i < N; i++) {
    const due = start + (i * 1000) / TPS;
    const wait = due - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    await page.keyboard.press(KEY[seq[i]]);
  }
  const sent = Date.now();
  await page.waitForFunction(() => !window.__u3.stage.cube.busy, undefined, { timeout: 30_000 });
  const settled = Date.now();
  const perf = await page.evaluate(() => {
    const p = window.__u3.perf;
    p.record = false;
    return { frames: p.frames.slice(), work: p.work.slice() };
  });
  await browser.stopTracing();

  const want = await expected(page, seq.join(" "));
  const got = await facelets(page);
  const viewMatches = await page.evaluate(() => window.__u3.stage.cube.state.join(",") === window.__u3.game.state.join(","));
  const report = {
    moves: N,
    achievedTps: +(N / ((sent - start) / 1000)).toFixed(2),
    cpuThrottle: 4,
    droppedMoves: got === want ? 0 : "MISMATCH",
    viewMatchesLogicalState: viewMatches,
    lagAfterLastKeyMs: settled - sent,
    frameIntervalMs: { p50: +pct(perf.frames, 50).toFixed(2), p95: +pct(perf.frames, 95).toFixed(2), max: +Math.max(...perf.frames).toFixed(2), count: perf.frames.length },
    frameWorkMs: { p50: +pct(perf.work, 50).toFixed(2), p95: +pct(perf.work, 95).toFixed(2), max: +Math.max(...perf.work).toFixed(2) },
    trace: "test-results/perf-trace.json",
  };
  writeFileSync("test-results/perf.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  expect(got).toBe(want);
  expect(viewMatches).toBe(true);
  expect(report.frameWorkMs.p95).toBeLessThanOrEqual(16.7);
});
