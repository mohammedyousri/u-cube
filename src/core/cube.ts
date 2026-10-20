// The logical cube. State = the rotation (one of 24) of each of the 27 cubies,
// indexed by the cubie's home position. A cubie's position is its rotation
// applied to its home position, so position and orientation can never disagree.
// This is the single source of truth; the 3D scene only displays it.

import {
  FACELET_AT,
  FACE_NAMES,
  POSITIONS,
  QUARTER,
  ROTATIONS,
  ROT_MUL,
  faceOfNormal,
  posIndex,
  rotate,
  stickerNormals,
} from "./geometry";
import { parseAlg, toLayerMove, type LayerMove, type Token } from "./notation";

export type CubeState = Uint8Array; // length 27, rotation index per cubie

export const solvedState = (): CubeState => new Uint8Array(27);

/** Current position vector of cubie `id`. */
export function cubiePosition(s: CubeState, id: number) {
  return rotate(ROTATIONS[s[id]], POSITIONS[id]);
}

function inLayers(coord: number, layers: number) {
  return (layers >> (coord + 1)) & 1;
}

export function applyLayerMove(s: CubeState, m: LayerMove): CubeState {
  const out = new Uint8Array(s);
  const q = QUARTER[m.axis][m.qt];
  for (let id = 0; id < 27; id++) {
    const p = rotate(ROTATIONS[s[id]], POSITIONS[id]);
    if (inLayers(p[m.axis], m.layers)) out[id] = ROT_MUL[q * 24 + s[id]];
  }
  return out;
}

export function applyTokens(s: CubeState, ts: readonly Token[]): CubeState {
  for (const t of ts) s = applyLayerMove(s, toLayerMove(t));
  return s;
}

export function applyAlg(s: CubeState, alg: string): CubeState {
  return applyTokens(s, parseAlg(alg));
}

/** IDs of cubies currently in the given layer(s) of an axis. */
export function cubiesInLayers(s: CubeState, axis: number, layers: number): number[] {
  const out: number[] = [];
  for (let id = 0; id < 27; id++) {
    if (id === 13) continue;
    const p = cubiePosition(s, id);
    if (inLayers(p[axis], layers)) out.push(id);
  }
  return out;
}

/**
 * 54-character facelet string in URFDLB order; each character names the face
 * whose colour the sticker carries in the solved cube (Kociemba convention).
 */
export function facelets(s: CubeState): string {
  const out = new Array<string>(54);
  for (let id = 0; id < 27; id++) {
    const home = POSITIONS[id];
    const R = ROTATIONS[s[id]];
    const p = posIndex(rotate(R, home));
    for (const n of stickerNormals(home)) {
      out[FACELET_AT[p * 6 + faceOfNormal(rotate(R, n))]] = FACE_NAMES[faceOfNormal(n)];
    }
  }
  return out.join("");
}

/** Solved = every face shows one colour (any whole-cube orientation, any center spin). */
export function isSolvedFacelets(f: string): boolean {
  for (let face = 0; face < 6; face++) {
    const c = f[face * 9 + 4];
    for (let i = 0; i < 9; i++) if (f[face * 9 + i] !== c) return false;
  }
  return true;
}

export const isSolved = (s: CubeState) => isSolvedFacelets(facelets(s));

export function statesEqual(a: CubeState, b: CubeState) {
  for (let i = 0; i < 27; i++) if (a[i] !== b[i]) return false;
  return true;
}
