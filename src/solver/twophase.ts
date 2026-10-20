// Kociemba's two-phase algorithm.
//   Phase 1: reach G1 = <U, D, R2, L2, F2, B2> (twist = flip = 0, slice edges in the slice).
//   Phase 2: solve within G1.
// Pruning: max of two projections per phase. Moves are face index × 3 + (power − 1), URFDLB.

import { type CubieCube, MOVE_CUBES, cloneCubie, isSolvedCubie, multiply, solvedCubie } from "../core/cubie";
import {
  N_FLIP, N_PERM8, N_SLICE, N_SLICE_PERM, N_TWIST,
  getCornerPerm, getFlip, getSlice, getSlicePerm, getTwist, getUDEdgePerm,
  setCornerPerm, setFlip, setSlice, setSlicePerm, setTwist, setUDEdgePerm,
} from "./coords";

const N_MOVES = 18;
/** Moves that keep the cube in G1. */
export const PHASE2_MOVES = [0, 1, 2, 4, 7, 9, 10, 11, 13, 16];
const IS_PHASE2_MOVE = new Uint8Array(18);
for (const m of PHASE2_MOVES) IS_PHASE2_MOVE[m] = 1;

interface Tables {
  twistMove: Uint16Array;
  flipMove: Uint16Array;
  sliceMove: Uint16Array;
  cpMove: Uint16Array;
  udMove: Uint16Array;
  spMove: Uint8Array;
  pruneSliceTwist: Int8Array;
  pruneSliceFlip: Int8Array;
  pruneCpSp: Int8Array;
  pruneUdSp: Int8Array;
}

let T: Tables | null = null;
export const tables = () => initTables();

function moveTable(
  n: number,
  set: (c: CubieCube, i: number) => void,
  get: (c: CubieCube) => number,
  moves: number[],
  Arr: Uint16ArrayConstructor | Uint8ArrayConstructor = Uint16Array,
) {
  const table = new Arr(n * N_MOVES);
  const c = solvedCubie();
  for (let i = 0; i < n; i++) {
    set(c, i);
    for (const m of moves) table[i * N_MOVES + m] = get(multiply(c, MOVE_CUBES[m]));
  }
  return table;
}

function pruneTable(
  n1: number, n2: number,
  move1: ArrayLike<number>, move2: ArrayLike<number>,
  moves: number[],
  goal: number,
) {
  const t = new Int8Array(n1 * n2).fill(-1);
  t[goal] = 0;
  let filled = 1;
  for (let depth = 0; filled < t.length; depth++) {
    let changed = 0;
    for (let i = 0; i < t.length; i++) {
      if (t[i] !== depth) continue;
      const a = Math.floor(i / n2);
      const b = i - a * n2;
      for (const m of moves) {
        const j = move1[a * N_MOVES + m] * n2 + move2[b * N_MOVES + m];
        if (t[j] === -1) {
          t[j] = depth + 1;
          filled++;
          changed++;
        }
      }
    }
    if (changed === 0) break;
  }
  return t;
}

export function initTables(): Tables {
  if (T) return T;
  const all = Array.from({ length: 18 }, (_, i) => i);
  const twistMove = moveTable(N_TWIST, setTwist, getTwist, all) as Uint16Array;
  const flipMove = moveTable(N_FLIP, setFlip, getFlip, all) as Uint16Array;
  const sliceMove = moveTable(N_SLICE, setSlice, getSlice, all) as Uint16Array;
  const cpMove = moveTable(N_PERM8, setCornerPerm, getCornerPerm, all) as Uint16Array;
  const udMove = moveTable(N_PERM8, setUDEdgePerm, getUDEdgePerm, PHASE2_MOVES) as Uint16Array;
  const spMove = moveTable(N_SLICE_PERM, setSlicePerm, getSlicePerm, PHASE2_MOVES, Uint8Array) as Uint8Array;
  T = {
    twistMove, flipMove, sliceMove, cpMove, udMove, spMove,
    pruneSliceTwist: pruneTable(N_SLICE, N_TWIST, sliceMove, twistMove, all, 0),
    pruneSliceFlip: pruneTable(N_SLICE, N_FLIP, sliceMove, flipMove, all, 0),
    pruneCpSp: pruneTable(N_PERM8, N_SLICE_PERM, cpMove, spMove, PHASE2_MOVES, 0),
    pruneUdSp: pruneTable(N_PERM8, N_SLICE_PERM, udMove, spMove, PHASE2_MOVES, 0),
  };
  return T;
}

export interface SolveOptions {
  /** Stop as soon as a solution of at most this many moves is found. */
  targetLength?: number;
  /** Never return anything longer than this. */
  maxLength?: number;
  /** Stop searching after this long; the best solution found so far (or null) is returned. */
  timeoutMs?: number;
}

class Timeout extends Error {}

/** Returns a list of face-move indices that solves `c`, or null if none was found in time. */
export function solve(c: CubieCube, opts: SolveOptions = {}): number[] | null {
  const t = initTables();
  const target = opts.targetLength ?? 21;
  const deadline = performance.now() + (opts.timeoutMs ?? 10_000);
  const maxLen = opts.maxLength ?? 30;
  if (isSolvedCubie(c)) return [];

  let best: number[] | null = null;
  const moves1 = new Int8Array(32);
  const moves2 = new Int8Array(32);
  let nodes = 0;
  let done = false;

  const tick = () => {
    if ((++nodes & 1023) === 0 && performance.now() > deadline) throw new Timeout();
  };

  function search2(cp: number, ud: number, sp: number, depth: number, togo: number, lastFace: number): boolean {
    tick();
    if (togo === 0) return cp === 0 && ud === 0 && sp === 0;
    for (const m of PHASE2_MOVES) {
      const f = (m / 3) | 0;
      if (f === lastFace || f === lastFace - 3) continue;
      const cp2 = t.cpMove[cp * N_MOVES + m];
      const ud2 = t.udMove[ud * N_MOVES + m];
      const sp2 = t.spMove[sp * N_MOVES + m];
      const h = Math.max(t.pruneCpSp[cp2 * 24 + sp2], t.pruneUdSp[ud2 * 24 + sp2]);
      if (h > togo - 1) continue;
      moves2[depth] = m;
      if (search2(cp2, ud2, sp2, depth + 1, togo - 1, f)) return true;
    }
    return false;
  }

  function phase2(depth1: number) {
    let cc = cloneCubie(c);
    for (let i = 0; i < depth1; i++) cc = multiply(cc, MOVE_CUBES[moves1[i]]);
    const cp = getCornerPerm(cc);
    const ud = getUDEdgePerm(cc);
    const sp = getSlicePerm(cc);
    const h = Math.max(t.pruneCpSp[cp * 24 + sp], t.pruneUdSp[ud * 24 + sp]);
    const lastFace = depth1 > 0 ? (moves1[depth1 - 1] / 3) | 0 : -1;
    const limit = (best ? best.length - 1 : maxLen) - depth1;
    for (let d2 = h; d2 <= limit; d2++) {
      if (search2(cp, ud, sp, 0, d2, lastFace)) {
        best = [...moves1.slice(0, depth1), ...moves2.slice(0, d2)];
        if (best.length <= target) done = true;
        return;
      }
    }
  }

  function search1(tw: number, fl: number, sl: number, depth: number, togo: number, lastFace: number) {
    tick();
    if (done) return;
    if (togo === 0) {
      if (tw === 0 && fl === 0 && sl === 0 && (depth === 0 || !IS_PHASE2_MOVE[moves1[depth - 1]])) phase2(depth);
      return;
    }
    for (let m = 0; m < N_MOVES && !done; m++) {
      const f = (m / 3) | 0;
      if (f === lastFace || f === lastFace - 3) continue;
      const tw2 = t.twistMove[tw * N_MOVES + m];
      const fl2 = t.flipMove[fl * N_MOVES + m];
      const sl2 = t.sliceMove[sl * N_MOVES + m];
      const h = Math.max(t.pruneSliceTwist[sl2 * N_TWIST + tw2], t.pruneSliceFlip[sl2 * N_FLIP + fl2]);
      if (h > togo - 1) continue;
      moves1[depth] = m;
      search1(tw2, fl2, sl2, depth + 1, togo - 1, f);
    }
  }

  const tw = getTwist(c), fl = getFlip(c), sl = getSlice(c);
  const h0 = Math.max(t.pruneSliceTwist[sl * N_TWIST + tw], t.pruneSliceFlip[sl * N_FLIP + fl]);
  try {
    for (let d1 = h0; d1 <= maxLen && !done; d1++) {
      if (best && d1 >= (best as number[]).length) break;
      search1(tw, fl, sl, 0, d1, -1);
    }
  } catch (e) {
    if (!(e instanceof Timeout)) throw e;
  }
  return best;
}
