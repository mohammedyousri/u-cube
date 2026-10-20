// Smoke test of the deployed site: node scripts/tools/live-check.mjs <url>
import { chromium } from "@playwright/test";
const url = process.argv[2];
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto(url);
await p.waitForFunction(() => !!window.__u3, undefined, { timeout: 20000 });
await p.click('[data-action="new"]');
await p.waitForFunction(() => ["ready", "inspecting"].includes(window.__u3.game.status), undefined, { timeout: 30000 });
const sw = await p.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()));
console.log(JSON.stringify({ title: await p.title(), scramble: await p.evaluate(() => window.__u3.game.scramble.alg), serviceWorker: sw, errors }));
await b.close();
