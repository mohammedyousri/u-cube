import { describe, expect, it } from "vitest";
import { contrastRatio, luminance, readableBackground } from "../src/ui/appearance";
import { seededRng } from "../src/solver/scramble";

const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

describe("custom backgrounds keep text readable", () => {
  it("any colour the player picks gets ≥ 4.5:1 contrast with the chosen text tone (2,000 random colours)", () => {
    const rng = seededRng(42);
    const dark = luminance(rgb("#0f1424")), light = luminance(rgb("#e9edf5"));
    for (let i = 0; i < 2000; i++) {
      const pick = hex(Math.floor(rng() * 0xffffff));
      const { color, tone } = readableBackground(pick);
      const ratio = contrastRatio(luminance(rgb(color)), tone === "light" ? dark : light);
      expect(ratio, `${pick} → ${color} (${tone})`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("leaves already-readable colours alone", () => {
    expect(readableBackground("#ffffff").color).toBe("#ffffff");
    expect(readableBackground("#000000").color).toBe("#000000");
  });
});
