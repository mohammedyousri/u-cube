// Review sheet: node scripts/tools/sheet.mjs out.png width img1.png img2.png ...
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
const [, , out, width, ...files] = process.argv;
const imgs = files
  .map((f) => `<figure style="margin:0"><img src="data:image/png;base64,${readFileSync(f).toString("base64")}" style="height:520px;border-radius:12px;box-shadow:0 1px 6px rgba(0,0,0,.2)"><figcaption style="font:12px system-ui;color:#555;margin-top:4px">${f.split("/").pop()}</figcaption></figure>`)
  .join("");
const html = resolve(out + ".html");
writeFileSync(html, `<html><body style="margin:0;padding:16px;background:#e9ecf1;display:flex;flex-wrap:wrap;gap:14px">${imgs}</body></html>`);
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ viewport: { width: Number(width), height: 600 } });
await p.goto("file://" + html);
await p.screenshot({ path: out, fullPage: true });
await b.close();
