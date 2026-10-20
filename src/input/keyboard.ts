// Keyboard turning with the layout speedcubers know from cstimer / qqtimer.

import type { Token } from "../core/notation";

const T = (base: string, amount: 1 | 2 | -1 = 1): Token => ({ base, amount });

export const KEYMAP: Record<string, Token> = {
  i: T("R"), k: T("R", -1),
  j: T("U"), f: T("U", -1),
  h: T("F"), g: T("F", -1),
  w: T("B"), o: T("B", -1),
  s: T("D"), l: T("D", -1),
  d: T("L"), e: T("L", -1),
  u: T("Rw"), m: T("Rw", -1),
  v: T("Lw"), r: T("Lw", -1),
  t: T("x"), y: T("x"), b: T("x", -1), n: T("x", -1),
  ";": T("y"), a: T("y", -1),
  p: T("z"), q: T("z", -1),
  "5": T("M"), "6": T("M"), x: T("M", -1), ".": T("M", -1),
};

/** Grouped for the help sheet. */
export const KEY_HELP: [string, string][] = [
  ["I / K", "R / R′"], ["J / F", "U / U′"], ["H / G", "F / F′"], ["D / E", "L / L′"],
  ["S / L", "D / D′"], ["W / O", "B / B′"], ["U / M", "r / r′"], ["V / R", "l / l′"],
  ["5 6 / X .", "M / M′"], ["T Y / B N", "x / x′"], ["; / A", "y / y′"], ["P / Q", "z / z′"],
];

export function keyToToken(e: KeyboardEvent): Token | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  return KEYMAP[e.key.toLowerCase()] ?? null;
}
