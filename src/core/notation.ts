// WCA notation (Regulations Article 12) plus the common extensions used by
// cubers: slices M/E/S, wide moves (Rw or r) and whole-cube rotations x/y/z.

import type { Axis } from "./geometry";

export type Amount = 1 | 2 | -1;

export interface Token {
  /** Canonical family: U R F D L B, Uw Rw Fw Dw Lw Bw, M E S, x y z. */
  base: string;
  amount: Amount;
}

/** A geometric layer turn: `qt` right-hand quarter turns about +axis of the layers in `layers`. */
export interface LayerMove {
  axis: Axis;
  /** Bitmask over layer coordinates: bit 0 = −1, bit 1 = 0, bit 2 = +1. */
  layers: number;
  qt: 1 | 2 | 3;
}

interface Family {
  axis: Axis;
  layers: number;
  /** Right-hand quarter turns about +axis for one clockwise turn. */
  cw: 1 | -1;
}

const NEG = 0b001, MID = 0b010, POS = 0b100;

export const FAMILIES: Record<string, Family> = {
  R: { axis: 0, layers: POS, cw: -1 },
  L: { axis: 0, layers: NEG, cw: 1 },
  U: { axis: 1, layers: POS, cw: -1 },
  D: { axis: 1, layers: NEG, cw: 1 },
  F: { axis: 2, layers: POS, cw: -1 },
  B: { axis: 2, layers: NEG, cw: 1 },
  M: { axis: 0, layers: MID, cw: 1 }, // follows L
  E: { axis: 1, layers: MID, cw: 1 }, // follows D
  S: { axis: 2, layers: MID, cw: -1 }, // follows F
  Rw: { axis: 0, layers: POS | MID, cw: -1 },
  Lw: { axis: 0, layers: NEG | MID, cw: 1 },
  Uw: { axis: 1, layers: POS | MID, cw: -1 },
  Dw: { axis: 1, layers: NEG | MID, cw: 1 },
  Fw: { axis: 2, layers: POS | MID, cw: -1 },
  Bw: { axis: 2, layers: NEG | MID, cw: 1 },
  x: { axis: 0, layers: NEG | MID | POS, cw: -1 }, // follows R
  y: { axis: 1, layers: NEG | MID | POS, cw: -1 }, // follows U
  z: { axis: 2, layers: NEG | MID | POS, cw: -1 }, // follows F
};

export const FACE_TURN_BASES = ["U", "R", "F", "D", "L", "B"];

export function toLayerMove(t: Token): LayerMove {
  const fam = FAMILIES[t.base];
  if (!fam) throw new Error(`unknown move ${t.base}`);
  const qt = ((((fam.cw * t.amount) % 4) + 4) % 4) as 1 | 2 | 3;
  return { axis: fam.axis, layers: fam.layers, qt };
}

/** Find the notation token for a geometric layer turn, if one exists. */
export function fromLayerMove(m: LayerMove): Token | null {
  for (const base of Object.keys(FAMILIES)) {
    const f = FAMILIES[base];
    if (f.axis !== m.axis || f.layers !== m.layers) continue;
    const cwTurns = (((f.cw * m.qt) % 4) + 4) % 4; // clockwise quarter turns
    const amount: Amount = cwTurns === 1 ? 1 : cwTurns === 2 ? 2 : -1;
    return { base, amount };
  }
  return null;
}

const TOKEN_RE = /([URFDLBMESxyz]w?|[urfdlb])(2|3)?('|’)?/y;

export function parseAlg(text: string): Token[] {
  const out: Token[] = [];
  const s = text.replace(/[\s,]+/g, " ").trim();
  let i = 0;
  while (i < s.length) {
    if (s[i] === " ") {
      i++;
      continue;
    }
    TOKEN_RE.lastIndex = i;
    const m = TOKEN_RE.exec(s);
    if (!m || m[0].length === 0) throw new Error(`cannot parse move at "${s.slice(i, i + 6)}"`);
    let base = m[1];
    if (/^[urfdlb]$/.test(base)) base = base.toUpperCase() + "w";
    if (!FAMILIES[base]) throw new Error(`unknown move ${m[1]}`);
    let n = m[2] ? Number(m[2]) : 1;
    if (m[3]) n = -n;
    const amount = (((n % 4) + 4) % 4);
    if (amount !== 0) out.push({ base, amount: amount === 1 ? 1 : amount === 2 ? 2 : -1 });
    i = TOKEN_RE.lastIndex;
  }
  return out;
}

export function formatToken(t: Token): string {
  return t.base + (t.amount === 2 ? "2" : t.amount === -1 ? "'" : "");
}

export function formatAlg(ts: readonly Token[]): string {
  return ts.map(formatToken).join(" ");
}

export function invertToken(t: Token): Token {
  return { base: t.base, amount: t.amount === 2 ? 2 : ((-t.amount) as Amount) };
}

export function invertAlg(ts: readonly Token[]): Token[] {
  return ts.slice().reverse().map(invertToken);
}

/** Face-turn index used by the solver: face (URFDLB) × 3 + (power − 1). */
export function faceMoveIndex(t: Token): number {
  const f = FACE_TURN_BASES.indexOf(t.base);
  if (f < 0) throw new Error(`${t.base} is not a face turn`);
  const p = t.amount === 1 ? 0 : t.amount === 2 ? 1 : 2;
  return f * 3 + p;
}

export function faceMoveToken(m: number): Token {
  const p = m % 3;
  return { base: FACE_TURN_BASES[(m / 3) | 0], amount: p === 0 ? 1 : p === 1 ? 2 : -1 };
}

/** Merge adjacent same-family turns and drop cancellations (for move counts and replays). */
export function simplify(ts: readonly Token[]): Token[] {
  const out: Token[] = [];
  for (const t of ts) {
    const last = out[out.length - 1];
    if (last && last.base === t.base) {
      const n = (((last.amount + t.amount) % 4) + 4) % 4;
      out.pop();
      if (n !== 0) out.push({ base: t.base, amount: n === 1 ? 1 : n === 2 ? 2 : -1 });
    } else out.push(t);
  }
  return out;
}
