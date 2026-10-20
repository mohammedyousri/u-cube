// Difficulty = distance from solved, not scramble length.

import { type CubieCube, MOVE_CUBES, invariants, multiply, solvedCubie } from "../core/cubie";
import { faceMoveToken, formatAlg, invertAlg, type Token } from "../core/notation";
import { permFromIndex } from "./coords";
import { optimalSolution } from "./distance";
import { solve } from "./twophase";

/** Every position of the cube can be solved in at most 20 face turns. */
export const GODS_NUMBER = 20;

export type LevelId = "warmup" | "easy" | "medium" | "hard" | "expert";

export interface LevelInfo {
  id: LevelId;
  label: string;
  blurb: string;
  min: number;
  max: number;
}

export const LEVELS: LevelInfo[] = [
  { id: "warmup", label: "Warm-up", blurb: "1–3 moves from solved", min: 1, max: 3 },
  { id: "easy", label: "Easy", blurb: "4–6 moves from solved", min: 4, max: 6 },
  { id: "medium", label: "Medium", blurb: "7–10 moves from solved", min: 7, max: 10 },
  { id: "hard", label: "Hard", blurb: "11–15 moves from solved", min: 11, max: 15 },
  { id: "expert", label: "Expert", blurb: "Random state, as in competition", min: 16, max: 20 },
];

export interface Scramble {
  level: LevelId;
  alg: string;
  /** Exact optimal distance, when known (Warm-up … Medium). */
  optimal: number | null;
  /** Proven bounds on the optimal distance. */
  lower: number;
  upper: number;
  /** A known solution from the scrambled state (face-move tokens as text). */
  solution: string;
}

export type Rng = () => number; // uniform [0, 1)

export const cryptoRng: Rng = () => {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 4294967296;
};

/** Small deterministic generator for tests and daily challenges. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randInt = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

/** Random walk with no redundant pairs (no same face twice, opposite faces in fixed order). */
export function canonicalWalk(len: number, rng: Rng): number[] {
  const out: number[] = [];
  let last = -1;
  while (out.length < len) {
    const m = randInt(rng, 0, 17);
    const f = (m / 3) | 0;
    if (f === last || f === last - 3) continue;
    out.push(m);
    last = f;
  }
  return out;
}

export function applyMoves(c: CubieCube, moves: number[]): CubieCube {
  for (const m of moves) c = multiply(c, MOVE_CUBES[m]);
  return c;
}

const toTokens = (moves: number[]): Token[] => moves.map(faceMoveToken);
const toText = (moves: number[]) => formatAlg(toTokens(moves));

/** Uniformly random solvable cube (random-state). */
export function randomState(rng: Rng): CubieCube {
  const c = solvedCubie();
  c.cp = permFromIndex(randInt(rng, 0, 40319), 8);
  c.ep = permFromIndex(randInt(rng, 0, 479001599), 12);
  if (invariants(c).cornerParity !== invariants(c).edgeParity) [c.ep[10], c.ep[11]] = [c.ep[11], c.ep[10]];
  let tw = 0;
  for (let i = 0; i < 7; i++) {
    c.co[i] = randInt(rng, 0, 2);
    tw += c.co[i];
  }
  c.co[7] = (3 - (tw % 3)) % 3;
  let fl = 0;
  for (let i = 0; i < 11; i++) {
    c.eo[i] = randInt(rng, 0, 1);
    fl += c.eo[i];
  }
  c.eo[11] = fl & 1;
  return c;
}

export function generateScramble(level: LevelId, rng: Rng = cryptoRng): Scramble {
  const info = LEVELS.find((l) => l.id === level)!;
  if (level === "warmup" || level === "easy" || level === "medium") {
    for (let attempt = 0; ; attempt++) {
      const want = randInt(rng, info.min, info.max);
      const walk = canonicalWalk(want, rng);
      const sol = optimalSolution(applyMoves(solvedCubie(), walk));
      if (!sol) continue;
      if (sol.length === want || (attempt > 40 && sol.length >= info.min && sol.length <= info.max))
        return { level, alg: toText(walk), optimal: sol.length, lower: sol.length, upper: sol.length, solution: toText(sol) };
    }
  }
  if (level === "hard") {
    for (;;) {
      const walk = canonicalWalk(randInt(rng, 13, 15), rng);
      const c = applyMoves(solvedCubie(), walk);
      if (optimalSolution(c)) continue; // must be more than 10 away
      const tp = solve(c, { targetLength: 11, maxLength: walk.length - 1, timeoutMs: 150 });
      const sol = tp ?? invertMoves(walk);
      return { level, alg: toText(walk), optimal: null, lower: 11, upper: sol.length, solution: toText(sol) };
    }
  }
  // expert: random state, scramble = inverse of a two-phase solution
  for (;;) {
    const c = randomState(rng);
    const sol = solve(c, { targetLength: 20, timeoutMs: 1500 });
    if (!sol || sol.length < 2) continue;
    const scramble = invertAlg(toTokens(sol));
    const far = optimalSolution(c) === null;
    return {
      level,
      alg: formatAlg(scramble),
      optimal: null,
      lower: far ? 11 : 0,
      upper: Math.min(sol.length, GODS_NUMBER), // every position is within 20 moves (Rokicki et al., 2010)
      solution: toText(sol),
    };
  }
}

export function invertMoves(moves: number[]): number[] {
  return moves
    .slice()
    .reverse()
    .map((m) => ((m / 3) | 0) * 3 + (2 - (m % 3)));
}

/** Best solution we can find quickly: optimal if within 10 moves, else two-phase. */
export function bestSolution(c: CubieCube, timeoutMs = 400): { moves: number[]; optimal: boolean } | null {
  const opt = optimalSolution(c);
  if (opt) return { moves: opt, optimal: true };
  const tp = solve(c, { targetLength: 0, timeoutMs });
  return tp ? { moves: tp, optimal: false } : null;
}
