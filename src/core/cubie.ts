// Kociemba's cubie-level model: corner/edge permutation + orientation, with
// the six centers fixed. Used by the solver, the scramble generators and the
// invariant checks. The face-turn tables are derived from the geometric model,
// not typed in.

import { CORNER_FACELETS, EDGE_FACELETS } from "./geometry";
import { applyLayerMove, facelets, solvedState } from "./cube";
import { toLayerMove, FACE_TURN_BASES } from "./notation";

export interface CubieCube {
  cp: number[]; // cp[slot] = corner currently in slot
  co: number[]; // 0..2
  ep: number[]; // ep[slot] = edge currently in slot
  eo: number[]; // 0..1
}

const FACE_LETTERS = "URFDLB";

export const solvedCubie = (): CubieCube => ({
  cp: [0, 1, 2, 3, 4, 5, 6, 7],
  co: [0, 0, 0, 0, 0, 0, 0, 0],
  ep: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
});

export const cloneCubie = (c: CubieCube): CubieCube => ({
  cp: c.cp.slice(),
  co: c.co.slice(),
  ep: c.ep.slice(),
  eo: c.eo.slice(),
});

// Colours (as face indices) of each corner / edge in the solved cube, in facelet order.
const CORNER_COLORS = CORNER_FACELETS.map((fs) => fs.map((f) => Math.floor(f / 9)));
const EDGE_COLORS = EDGE_FACELETS.map((fs) => fs.map((f) => Math.floor(f / 9)));

export class InvalidCubeError extends Error {}

/**
 * Read a 54-character facelet string. Characters may be any six distinct
 * symbols; the center stickers say which symbol belongs to which face, so a
 * cube held in any orientation (or with slice moves applied) is read
 * relative to its current centers.
 */
export function cubieFromFacelets(f: string): CubieCube {
  if (f.length !== 54) throw new InvalidCubeError("need 54 stickers");
  const faceOf = new Map<string, number>();
  for (let face = 0; face < 6; face++) faceOf.set(f[face * 9 + 4], face);
  if (faceOf.size !== 6) throw new InvalidCubeError("the six centers must be six different colours");
  const col = (i: number) => {
    const v = faceOf.get(f[i]);
    if (v === undefined) throw new InvalidCubeError(`sticker ${i} has a colour no center has`);
    return v;
  };
  const counts = new Array(6).fill(0);
  for (let i = 0; i < 54; i++) counts[col(i)]++;
  if (counts.some((n) => n !== 9)) throw new InvalidCubeError("each colour must appear exactly 9 times");

  const c = solvedCubie();
  const seenC = new Set<number>();
  for (let i = 0; i < 8; i++) {
    let ori = 0;
    while (ori < 3 && col(CORNER_FACELETS[i][ori]) !== 0 && col(CORNER_FACELETS[i][ori]) !== 3) ori++;
    if (ori === 3) throw new InvalidCubeError(`corner ${i} has no U/D colour`);
    const c1 = col(CORNER_FACELETS[i][(ori + 1) % 3]);
    const c2 = col(CORNER_FACELETS[i][(ori + 2) % 3]);
    const j = CORNER_COLORS.findIndex((cc) => cc[1] === c1 && cc[2] === c2);
    if (j < 0) throw new InvalidCubeError(`corner ${i} is not a real corner`);
    c.cp[i] = j;
    c.co[i] = ori;
    seenC.add(j);
  }
  if (seenC.size !== 8) throw new InvalidCubeError("a corner appears twice");
  const seenE = new Set<number>();
  for (let i = 0; i < 12; i++) {
    const a = col(EDGE_FACELETS[i][0]);
    const b = col(EDGE_FACELETS[i][1]);
    let found = false;
    for (let j = 0; j < 12; j++) {
      if (EDGE_COLORS[j][0] === a && EDGE_COLORS[j][1] === b) {
        c.ep[i] = j;
        c.eo[i] = 0;
        found = true;
      } else if (EDGE_COLORS[j][0] === b && EDGE_COLORS[j][1] === a) {
        c.ep[i] = j;
        c.eo[i] = 1;
        found = true;
      }
      if (found) break;
    }
    if (!found) throw new InvalidCubeError(`edge ${i} is not a real edge`);
    seenE.add(c.ep[i]);
  }
  if (seenE.size !== 12) throw new InvalidCubeError("an edge appears twice");
  return c;
}

export function faceletsFromCubie(c: CubieCube): string {
  const out = new Array<string>(54);
  for (let face = 0; face < 6; face++) out[face * 9 + 4] = FACE_LETTERS[face];
  for (let i = 0; i < 8; i++)
    for (let k = 0; k < 3; k++)
      out[CORNER_FACELETS[i][(k + c.co[i]) % 3]] = FACE_LETTERS[CORNER_COLORS[c.cp[i]][k]];
  for (let i = 0; i < 12; i++)
    for (let k = 0; k < 2; k++)
      out[EDGE_FACELETS[i][(k + c.eo[i]) % 2]] = FACE_LETTERS[EDGE_COLORS[c.ep[i]][k]];
  return out.join("");
}

/** a · b : apply a, then b ("replaced-by" composition). */
export function multiply(a: CubieCube, b: CubieCube): CubieCube {
  const r = solvedCubie();
  for (let i = 0; i < 8; i++) {
    r.cp[i] = a.cp[b.cp[i]];
    r.co[i] = (a.co[b.cp[i]] + b.co[i]) % 3;
  }
  for (let i = 0; i < 12; i++) {
    r.ep[i] = a.ep[b.ep[i]];
    r.eo[i] = (a.eo[b.ep[i]] + b.eo[i]) % 2;
  }
  return r;
}

export function invert(a: CubieCube): CubieCube {
  const r = solvedCubie();
  for (let i = 0; i < 8; i++) {
    r.cp[a.cp[i]] = i;
  }
  for (let i = 0; i < 8; i++) r.co[i] = (3 - a.co[r.cp[i]]) % 3;
  for (let i = 0; i < 12; i++) r.ep[a.ep[i]] = i;
  for (let i = 0; i < 12; i++) r.eo[i] = a.eo[r.ep[i]];
  return r;
}

/** The 18 face turns (URFDLB × {1, 2, 3}), derived from the geometric model. */
export const MOVE_CUBES: CubieCube[] = [];
for (let f = 0; f < 6; f++) {
  const quarter = cubieFromFacelets(
    facelets(applyLayerMove(solvedState(), toLayerMove({ base: FACE_TURN_BASES[f], amount: 1 }))),
  );
  let m = quarter;
  for (let p = 0; p < 3; p++) {
    MOVE_CUBES.push(m);
    m = multiply(m, quarter);
  }
}

export function applyFaceMove(c: CubieCube, m: number): CubieCube {
  return multiply(c, MOVE_CUBES[m]);
}

// ---- Invariants ---------------------------------------------------------------

export function permutationParity(p: readonly number[]): number {
  let parity = 0;
  const seen = new Array(p.length).fill(false);
  for (let i = 0; i < p.length; i++) {
    if (seen[i]) continue;
    let len = 0;
    for (let j = i; !seen[j]; j = p[j]) {
      seen[j] = true;
      len++;
    }
    parity ^= (len - 1) & 1;
  }
  return parity;
}

export interface InvariantReport {
  twist: number; // corner orientation sum mod 3 — must be 0
  flip: number; // edge orientation sum mod 2 — must be 0
  cornerParity: number;
  edgeParity: number; // must equal cornerParity
  solvable: boolean;
}

export function invariants(c: CubieCube): InvariantReport {
  const twist = c.co.reduce((a, b) => a + b, 0) % 3;
  const flip = c.eo.reduce((a, b) => a + b, 0) % 2;
  const cornerParity = permutationParity(c.cp);
  const edgeParity = permutationParity(c.ep);
  return { twist, flip, cornerParity, edgeParity, solvable: twist === 0 && flip === 0 && cornerParity === edgeParity };
}

/** Human-readable reason a physically assembled cube cannot be solved, or null. */
export function unsolvableReason(c: CubieCube): string | null {
  const r = invariants(c);
  if (r.twist !== 0) return "one corner is twisted in place";
  if (r.flip !== 0) return "one edge is flipped in place";
  if (r.cornerParity !== r.edgeParity) return "two pieces are swapped";
  return null;
}

export function isSolvedCubie(c: CubieCube): boolean {
  for (let i = 0; i < 8; i++) if (c.cp[i] !== i || c.co[i] !== 0) return false;
  for (let i = 0; i < 12; i++) if (c.ep[i] !== i || c.eo[i] !== 0) return false;
  return true;
}
