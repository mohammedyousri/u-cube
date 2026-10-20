import { chromium } from "@playwright/test";
const [,, html, png, width] = process.argv;
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ viewport: { width: Number(width || 1500), height: 600 } });
await p.goto("file://" + html);
await p.screenshot({ path: png, fullPage: true });
await b.close();
