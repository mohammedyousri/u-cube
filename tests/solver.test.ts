/// <reference types="node" />
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createRequire } from "node:module";
import { solvedCubie, cubieFromFacelets, faceletsFromCubie, isSolvedCubie, type CubieCube } from "../src/core/cubie";
import { formatAlg, faceMoveToken } from "../src/core/notation";
import {
  N_FLIP, N_PERM8, N_SLICE, N_SLICE_PERM, N_TWIST,
  getCornerPerm, getFlip, getSlice, getSlicePerm, getTwist, getUDEdgePerm,
  setCornerPerm, setFlip, setSlice, setSlicePerm, setTwist, setUDEdgePerm,
} from "../src/solver/coords";
import { initTables, solve } from "../src/solver/twophase";
import { depthCounts, optimalDistance, optimalSolution } from "../src/solver/distance";
import { LEVELS, applyMoves, canonicalWalk, generateScramble, randomState, seededRng, type LevelId } from "../src/solver/scramble";

const require = createRequire(import.meta.url);
const CubeJS = require("cubejs");
const text = (ms: number[]) => formatAlg(ms.map(faceMoveToken));

describe("coordinates", () => {
  const cases: [string, number, (c: CubieCube, i: number) => void, (c: CubieCube) => number][] = [
    ["twist", N_TWIST, setTwist, getTwist],
    ["flip", N_FLIP, setFlip, getFlip],
    ["slice", N_SLICE, setSlice, getSlice],
    ["corner perm", N_PERM8, setCornerPerm, getCornerPerm],
    ["U/D edge perm", N_PERM8, setUDEdgePerm, getUDEdgePerm],
    ["slice perm", N_SLICE_PERM, setSlicePerm, getSlicePerm],
  ];
  for (const [name, n, set, get] of cases)
    it(`${name}: get(set(i)) = i for all ${n}`, () => {
      const c = solvedCubie();
      for (let i = 0; i < n; i++) {
        set(c, i);
        if (get(c) !== i) throw new Error(`${name} ${i} -> ${get(c)}`);
      }
    });
  it("solved cube has all coordinates 0", () => {
    const c = solvedCubie();
    expect([getTwist(c), getFlip(c), getSlice(c), getCornerPerm(c), getUDEdgePerm(c), getSlicePerm(c)]).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe("meet-in-the-middle distance table", () => {
  it("matches the published number of positions at each distance 0–5 (cube20.org, HTM)", () => {
    expect(depthCounts()).toEqual([1, 18, 243, 3240, 43239, 574908]);
  });

  it("agrees with brute-force search on 300 positions up to 5 moves", () => {
    const rng = seededRng(7);
    for (let n = 0; n < 300; n++) {
      const c = applyMoves(solvedCubie(), canonicalWalk(1 + (n % 5), rng));
      expect(optimalDistance(c)).toBe(bruteForce(c, 5));
    }
  });

  it("returns a solution of exactly the reported length that really solves (400 walks of 1–12 moves)", () => {
    const rng = seededRng(11);
    for (let n = 0; n < 400; n++) {
      const walk = canonicalWalk(1 + (n % 12), rng);
      const c = applyMoves(solvedCubie(), walk);
      const sol = optimalSolution(c);
      if (sol === null) {
        expect(walk.length).toBeGreaterThan(10);
        continue;
      }
      expect(sol.length).toBeLessThanOrEqual(walk.length);
      expect(isSolvedCubie(applyMoves(c, sol))).toBe(true);
      // the independent cubejs implementation agrees the solution solves it
      const theirs = CubeJS.fromString(faceletsFromCubie(c)).move(text(sol));
      expect(theirs.isSolved()).toBe(true);
    }
  });
});

function bruteForce(c: CubieCube, maxDepth: number): number | null {
  for (let d = 0; d <= maxDepth; d++) if (dfs(c, d, -1)) return d;
  return null;
  function dfs(s: CubieCube, togo: number, last: number): boolean {
    if (togo === 0) return isSolvedCubie(s);
    for (let m = 0; m < 18; m++) {
      if (((m / 3) | 0) === last) continue;
      if (dfs(applyMoves(s, [m]), togo - 1, (m / 3) | 0)) return true;
    }
    return false;
  }
}

describe("two-phase solver", () => {
  it("builds its tables", () => {
    const t0 = performance.now();
    initTables();
    console.log(`two-phase tables: ${(performance.now() - t0).toFixed(0)} ms`);
  });

  it("solves 200 random-state cubes; cubejs confirms every solution", () => {
    const rng = seededRng(2026);
    const lengths: number[] = [];
    const times: number[] = [];
    for (let n = 0; n < 200; n++) {
      const c = randomState(rng);
      const t0 = performance.now();
      // generous budget: the search stops as soon as it finds ≤ 21 moves, so this only matters on slow machines
      const sol = solve(c, { targetLength: 21, timeoutMs: 30_000 });
      times.push(performance.now() - t0);
      expect(sol).not.toBeNull();
      expect(isSolvedCubie(applyMoves(c, sol!))).toBe(true);
      expect(CubeJS.fromString(faceletsFromCubie(c)).move(text(sol!)).isSolved()).toBe(true);
      lengths.push(sol!.length);
    }
    times.sort((a, b) => a - b);
    console.log(
      `two-phase: max length ${Math.max(...lengths)}, mean ${(lengths.reduce((a, b) => a + b) / lengths.length).toFixed(1)}; ` +
        `time median ${times[100].toFixed(0)} ms, p95 ${times[190].toFixed(0)} ms`,
    );
    expect(Math.max(...lengths)).toBeLessThanOrEqual(21);
  });

  it("solves states read from facelets of any valid cube (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2 ** 31 }), (seed) => {
        const c = randomState(seededRng(seed));
        const back = cubieFromFacelets(faceletsFromCubie(c));
        const sol = solve(back, { targetLength: 23, timeoutMs: 30_000 })!;
        expect(isSolvedCubie(applyMoves(back, sol))).toBe(true);
      }),
      { numRuns: 50 },
    );
  });
});

describe("difficulty levels", () => {
  const PER_LEVEL = Number(process.env.LEVEL_SAMPLES ?? 100);
  for (const level of LEVELS) {
    it(`${level.label}: ${PER_LEVEL} scrambles all inside ${level.min}–${level.max}`, () => {
      const rng = seededRng(level.id.length * 1000 + 3);
      const hist = new Map<string, number>();
      const t0 = performance.now();
      for (let n = 0; n < PER_LEVEL; n++) {
        const s = generateScramble(level.id as LevelId, rng);
        const c = applyMoves(solvedCubie(), s.alg.split(" ").map((t) => toIdx(t)));
        // the stated solution solves the scramble
        expect(isSolvedCubie(applyMoves(c, s.solution.split(" ").map(toIdx)))).toBe(true);
        if (s.optimal !== null) {
          expect(s.optimal).toBeGreaterThanOrEqual(level.min);
          expect(s.optimal).toBeLessThanOrEqual(level.max);
          expect(optimalDistance(c)).toBe(s.optimal);
        } else {
          expect(s.lower).toBeGreaterThanOrEqual(11);
          expect(optimalDistance(c)).toBeNull();
          expect(s.upper).toBeLessThanOrEqual(level.id === "hard" ? 15 : 20);
        }
        const key = s.optimal !== null ? `${s.optimal}` : `≤${s.upper}`;
        hist.set(key, (hist.get(key) ?? 0) + 1);
      }
      const ms = (performance.now() - t0) / PER_LEVEL;
      console.log(`${level.label.padEnd(8)} ${[...hist].sort().map(([k, v]) => `${k}:${v}`).join("  ")}   (${ms.toFixed(0)} ms/scramble)`);
    });
  }
});

function toIdx(t: string): number {
  const f = "URFDLB".indexOf(t[0]);
  const p = t.length === 1 ? 0 : t[1] === "2" ? 1 : 2;
  return f * 3 + p;
}
