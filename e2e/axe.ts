/// <reference types="node" />
// Minimal axe-core runner (injects the installed axe-core into the page).
import type { Page } from "@playwright/test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

export default class AxeBuilder {
  constructor(private page: Page) {}
  async analyze(): Promise<{ violations: { id: string; nodes: unknown[]; help: string }[] }> {
    await this.page.addScriptTag({ content: AXE_SOURCE });
    return this.page.evaluate(async () => {
      // @ts-expect-error injected global
      const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
      return { violations: r.violations.map((v: { id: string; nodes: unknown[]; help: string }) => ({ id: v.id, nodes: v.nodes, help: v.help })) };
    });
  }
}
