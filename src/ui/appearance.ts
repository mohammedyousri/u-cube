// Background, theme and cube colouring. Text contrast is guaranteed: every
// background declares (or, for a custom colour, is measured for) the tone of
// text that reads on it, and custom colours in the low-contrast middle band are
// nudged out of it.

import { FACE_COLORS, PALETTES } from "../render/cubeView";
import type { Stage } from "../render/scene";
import type { Settings } from "../game/storage";

const GLOW = "1100px 760px at 50% 44%";

export const BACKGROUNDS: Record<Settings["background"], { label: string; tone: "light" | "dark" | null; css: string | null; swatch: string }> = {
  auto: { label: "Auto", tone: null, css: null, swatch: "linear-gradient(135deg, #eef1f6 50%, #07090d 50%)" },
  navy: { label: "Navy", tone: "dark", css: `radial-gradient(${GLOW}, #26324a, #0b0f17 72%)`, swatch: "#131a26" },
  midnight: { label: "Midnight", tone: "dark", css: `radial-gradient(${GLOW}, #26315a, #070a14 72%)`, swatch: "#1d2747" },
  ocean: { label: "Ocean", tone: "dark", css: `radial-gradient(${GLOW}, #11606f, #03151a 72%)`, swatch: "#0d4b57" },
  forest: { label: "Forest", tone: "dark", css: `radial-gradient(${GLOW}, #22553a, #04100a 72%)`, swatch: "#1b4430" },
  sunset: { label: "Sunset", tone: "light", css: `radial-gradient(${GLOW}, #fff1e3, #f6b49c 78%)`, swatch: "#f8c3a6" },
  paper: { label: "Paper", tone: "light", css: `radial-gradient(${GLOW}, #fffdf8, #efe8d8 78%)`, swatch: "#f4eedf" },
  custom: { label: "Custom", tone: null, css: null, swatch: "conic-gradient(#f43f5e, #f59e0b, #22c55e, #3b82f6, #a855f7, #f43f5e)" },
};

function hexToRgb(h: string): [number, number, number] {
  const m = h.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [29, 42, 68];
}
const rgbToHex = (c: number[]) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

/** WCAG relative luminance. */
export function luminance([r, g, b]: number[]): number {
  const f = (v: number) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export const contrastRatio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

const DARK_TEXT = luminance(hexToRgb("#0f1424"));
const LIGHT_TEXT = luminance(hexToRgb("#e9edf5"));

/**
 * Pick the text tone with the better contrast and, if even that is under 4.5:1,
 * darken or lighten the colour until it reaches it.
 */
export function readableBackground(hex: string): { color: string; tone: "light" | "dark" } {
  let c = hexToRgb(hex);
  const L = luminance(c);
  const tone: "light" | "dark" = contrastRatio(L, DARK_TEXT) >= contrastRatio(L, LIGHT_TEXT) ? "light" : "dark";
  for (let i = 0; i < 40; i++) {
    const ratio = contrastRatio(luminance(c), tone === "light" ? DARK_TEXT : LIGHT_TEXT);
    if (ratio >= 4.5) break;
    // work in whole 8-bit values so the colour we test is exactly the colour we return
    c = (tone === "light" ? c.map((v) => Math.ceil(v + (255 - v) * 0.08)) : c.map((v) => Math.floor(v * 0.92))) as typeof c;
  }
  return { color: rgbToHex(c), tone };
}

function mix(hex: string, toward: number, amount: number) {
  return rgbToHex(hexToRgb(hex).map((v) => v + (toward - v) * amount));
}

/** Move a text colour toward black or white until it reaches `min` contrast on every given background. */
function readableOn(fg: string, bgs: string[], min: number, toward: 0 | 255): string {
  let c = hexToRgb(fg);
  for (let i = 0; i < 60; i++) {
    const worst = Math.min(...bgs.map((b) => contrastRatio(luminance(c), luminance(hexToRgb(b)))));
    if (worst >= min) break;
    c = c.map((v) => (toward ? Math.ceil(v + (toward - v) * 0.08) : Math.floor(v * 0.92))) as typeof c;
  }
  return rgbToHex(c);
}

/** The two ends of each preset's gradient (centre glow and edge), for contrast checks. */
const BG_STOPS: Partial<Record<Settings["background"], string[]>> = {
  navy: ["#26324a", "#0b0f17"],
  midnight: ["#26315a", "#070a14"],
  ocean: ["#11606f", "#03151a"],
  forest: ["#22553a", "#04100a"],
  sunset: ["#fff1e3", "#f6b49c"],
  paper: ["#fffdf8", "#efe8d8"],
};

export function applyAppearance(s: Settings, stage: Stage) {
  const root = document.documentElement;
  const bg = BACKGROUNDS[s.background] ?? BACKGROUNDS.auto;
  let tone: "light" | "dark" | null = bg.tone;
  let css = bg.css;
  if (s.background === "custom") {
    const r = readableBackground(s.customBg);
    tone = r.tone;
    css = `radial-gradient(${GLOW}, ${mix(r.color, tone === "dark" ? 255 : 255, 0.14)}, ${r.color} 72%)`;
  }
  const theme = tone ?? (s.theme === "system" ? null : s.theme);
  if (theme) root.setAttribute("data-theme", theme);
  else root.removeAttribute("data-theme");
  if (css) root.style.setProperty("--app-bg", css);
  else root.style.removeProperty("--app-bg");
  // Secondary text sits straight on the background: keep it at 4.5:1 or better.
  let stops = BG_STOPS[s.background];
  if (s.background === "custom") {
    const c = readableBackground(s.customBg).color;
    stops = [c, mix(c, 255, 0.14)];
  }
  if (stops && tone) {
    const toward = tone === "light" ? 0 : 255;
    root.style.setProperty("--muted", readableOn(tone === "light" ? "#5d667a" : "#9aa3b8", stops, 4.6, toward));
    root.style.setProperty("--faint", readableOn(tone === "light" ? "#646c7f" : "#808a9f", stops, 4.6, toward));
  } else {
    root.style.removeProperty("--muted");
    root.style.removeProperty("--faint");
  }
  const dark = theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#07090d" : "#eef1f6");

  const colors = (PALETTES[s.palette] ?? PALETTES.classic).colors;
  FACE_COLORS.splice(0, 6, ...colors);
  stage.cube.setAppearance(colors, s.body);
  stage.ghost?.setAppearance(colors, s.body);
  stage.invalidate();
}
