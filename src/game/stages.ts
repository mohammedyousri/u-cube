// CFOP stage detection on a facelet string, colour-neutral: the cross may be
// built on any face. A sticker is "correct" when it matches the center of the
// face it is on.

import { FACELET_POS, FACE_FRAMES } from "../core/geometry";

export const STAGES = ["Cross", "F2L", "OLL", "PLL"] as const;

interface FaceSets {
  cross: number[];
  f2l: number[];
  oppositeFace: number;
}

const SETS: FaceSets[] = FACE_FRAMES.map(({ normal }, face) => {
  const ax = normal.findIndex((v) => v !== 0);
  const sg = normal[ax];
  const cross: number[] = [];
  const f2l: number[] = [];
  for (let i = 0; i < 54; i++) {
    const p = FACELET_POS[i];
    const layer = p[ax] * sg; // 1 = cross-face layer, 0 = middle, −1 = last layer
    const isEdge = p.filter((v) => v !== 0).length === 2;
    if (layer === 1 && isEdge) cross.push(i);
    if (layer >= 0) f2l.push(i);
  }
  return { cross, f2l, oppositeFace: (face + 3) % 6 };
});

const correct = (f: string, i: number) => f[i] === f[Math.floor(i / 9) * 9 + 4];

export function crossFace(f: string): number {
  for (let face = 0; face < 6; face++) if (SETS[face].cross.every((i) => correct(f, i))) return face;
  return -1;
}

/** Highest stage completed (0 = none, 1 cross, 2 F2L, 3 OLL, 4 solved) for a given cross face. */
export function stageOn(f: string, face: number): number {
  const s = SETS[face];
  if (!s.cross.every((i) => correct(f, i))) return 0;
  if (!s.f2l.every((i) => correct(f, i))) return 1;
  const o = s.oppositeFace * 9;
  for (let i = 0; i < 9; i++) if (f[o + i] !== f[o + 4]) return 2;
  for (let i = 0; i < 54; i++) if (!correct(f, i)) return 3;
  return 4;
}

/** Tracks when each stage is first reached during a solve. */
export class StageTracker {
  face = -1;
  /** ms timestamps for Cross, F2L, OLL, PLL (null = not reached in order). */
  times: (number | null)[] = [null, null, null, null];
  private reached = 0;

  update(f: string, t: number) {
    if (this.face < 0) {
      this.face = crossFace(f);
      if (this.face < 0) return;
    }
    const s = stageOn(f, this.face);
    while (this.reached < s) this.times[this.reached++] = t;
  }

  get current() {
    return this.reached;
  }
}
