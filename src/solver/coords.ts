// Coordinates on the cubie model (Kociemba's two-phase formulation).

import type { CubieCube } from "../core/cubie";
import { solvedCubie } from "../core/cubie";

const FACT = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800, 39916800, 479001600];

export function cnk(n: number, k: number): number {
  if (k < 0 || n < k) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
}

/** Lehmer code of a permutation of 0..n−1. */
export function permIndex(p: ArrayLike<number>, n = p.length, offset = 0): number {
  let idx = 0;
  for (let i = 0; i < n; i++) {
    let smaller = 0;
    const v = p[offset + i];
    for (let j = i + 1; j < n; j++) if (p[offset + j] < v) smaller++;
    idx += smaller * FACT[n - 1 - i];
  }
  return idx;
}

export function permFromIndex(idx: number, n: number): number[] {
  const avail = Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = FACT[n - 1 - i];
    const q = Math.floor(idx / f);
    idx -= q * f;
    out.push(avail.splice(q, 1)[0]);
  }
  return out;
}

export const N_TWIST = 2187; // 3^7
export const N_FLIP = 2048; // 2^11
export const N_SLICE = 495; // C(12,4)
export const N_PERM8 = 40320; // 8!
export const N_SLICE_PERM = 24; // 4!

export function getTwist(c: CubieCube): number {
  let r = 0;
  for (let i = 0; i < 7; i++) r = r * 3 + c.co[i];
  return r;
}
export function setTwist(c: CubieCube, t: number) {
  let sum = 0;
  for (let i = 6; i >= 0; i--) {
    c.co[i] = t % 3;
    sum += c.co[i];
    t = Math.floor(t / 3);
  }
  c.co[7] = (3 - (sum % 3)) % 3;
}

export function getFlip(c: CubieCube): number {
  let r = 0;
  for (let i = 0; i < 11; i++) r = r * 2 + c.eo[i];
  return r;
}
export function setFlip(c: CubieCube, f: number) {
  let sum = 0;
  for (let i = 10; i >= 0; i--) {
    c.eo[i] = f & 1;
    sum += c.eo[i];
    f >>= 1;
  }
  c.eo[11] = sum & 1;
}

/** Which 4 of the 12 slots hold the E-slice edges (FR FL BL BR = 8..11). 0 ⇔ all in the slice. */
export function getSlice(c: CubieCube): number {
  let a = 0;
  let x = 0;
  for (let j = 11; j >= 0; j--)
    if (c.ep[j] >= 8) {
      a += cnk(11 - j, x + 1);
      x++;
    }
  return a;
}
export function setSlice(c: CubieCube, a: number) {
  // Greedy decode of the combinatorial number system used by getSlice.
  let x = 4;
  let nextSlice = 8;
  let nextOther = 0;
  for (let j = 0; j < 12; j++) {
    const v = x > 0 ? cnk(11 - j, x) : Infinity;
    if (a >= v) {
      c.ep[j] = nextSlice++;
      a -= v;
      x--;
    } else c.ep[j] = nextOther++;
  }
}

export const getCornerPerm = (c: CubieCube) => permIndex(c.cp);
export function setCornerPerm(c: CubieCube, idx: number) {
  c.cp = permFromIndex(idx, 8);
}

/** Phase 2 only: permutation of the 8 U/D edges among the U/D slots. */
export const getUDEdgePerm = (c: CubieCube) => permIndex(c.ep, 8);
export function setUDEdgePerm(c: CubieCube, idx: number) {
  const p = permFromIndex(idx, 8);
  for (let i = 0; i < 8; i++) c.ep[i] = p[i];
  for (let i = 8; i < 12; i++) c.ep[i] = i;
}

/** Phase 2 only: permutation of the 4 slice edges within the slice. */
export function getSlicePerm(c: CubieCube): number {
  return permIndex(c.ep.slice(8).map((e) => e - 8));
}
export function setSlicePerm(c: CubieCube, idx: number) {
  const p = permFromIndex(idx, 4);
  for (let i = 0; i < 8; i++) c.ep[i] = i;
  for (let i = 0; i < 4; i++) c.ep[8 + i] = p[i] + 8;
}

export const blankCube = solvedCubie;
