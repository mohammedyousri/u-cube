/// <reference types="node" />
// Independent implementations as oracles. Neither shares code or tables with ours.
//  - cubejs (Kociemba port): compared on the raw 54-facelet string.
//  - cubing.js KPuzzle: compared piece by piece via a fixed relabelling of its slot names.

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createRequire } from "node:module";
import { cube3x3x3 } from "cubing/puzzles";
import { applyTokens, facelets, solvedState } from "../src/core/cube";
import { FAMILIES, formatAlg, type Token } from "../src/core/notation";
import { faceletsFromCubie, solvedCubie } from "../src/core/cubie";

const require = createRequire(import.meta.url);
const CubeJS = require("cubejs");

const CASES = 1000;
const tokenArb = (bases: string[]) =>
  fc.record({ base: fc.constantFrom(...bases), amount: fc.constantFrom<1 | 2 | -1>(1, 2, -1) });
const ALL = Object.keys(FAMILIES);

// cubejs writes wide moves as lowercase letters.
const toCubeJS = (ts: Token[]) =>
  ts.map((t) => (t.base.endsWith("w") ? t.base[0].toLowerCase() : t.base) + (t.amount === 2 ? "2" : t.amount === -1 ? "'" : "")).join(" ");

// cubing.js slot order (Reid order) → Kociemba indices.
const EDGE_MAP = [1, 0, 3, 2, 5, 4, 7, 6, 8, 9, 11, 10]; // UF UR UB UL DF DR DB DL FR FL BR BL
const CORNER_MAP = [0, 3, 2, 1, 4, 5, 6, 7]; // UFR URB UBL ULF DRF DFL DLB DBR
const CENTER_MAP = [0, 4, 2, 1, 5, 3]; // U L F R B D

interface Orbit { pieces: number[]; orientation: number[] }
function kpatternToFacelets(data: Record<string, Orbit>): string {
  const c = solvedCubie();
  data.EDGES.pieces.forEach((p, slot) => {
    c.ep[EDGE_MAP[slot]] = EDGE_MAP[p];
    c.eo[EDGE_MAP[slot]] = data.EDGES.orientation[slot];
  });
  data.CORNERS.pieces.forEach((p, slot) => {
    c.cp[CORNER_MAP[slot]] = CORNER_MAP[p];
    c.co[CORNER_MAP[slot]] = data.CORNERS.orientation[slot];
  });
  const f = faceletsFromCubie(c).split("");
  data.CENTERS.pieces.forEach((p, slot) => {
    f[CENTER_MAP[slot] * 9 + 4] = "URFDLB"[CENTER_MAP[p]];
  });
  return f.join("");
}

describe("oracle: cubejs (Kociemba facelet strings)", () => {
  it(`agrees on ${CASES} random sequences using every move family`, () => {
    fc.assert(
      fc.property(fc.array(tokenArb(ALL), { minLength: 1, maxLength: 50 }), (ts) => {
        const theirs = new CubeJS().move(toCubeJS(ts)).asString();
        expect(facelets(applyTokens(solvedState(), ts)), formatAlg(ts)).toBe(theirs);
      }),
      { numRuns: CASES },
    );
  });
});

describe("oracle: cubing.js KPuzzle", async () => {
  const kpuzzle = await cube3x3x3.kpuzzle();
  it(`agrees on ${CASES} random sequences using every move family`, () => {
    fc.assert(
      fc.property(fc.array(tokenArb(ALL), { minLength: 1, maxLength: 50 }), (ts) => {
        const alg = formatAlg(ts);
        const theirs = kpatternToFacelets(kpuzzle.defaultPattern().applyAlg(alg).patternData as never);
        expect(facelets(applyTokens(solvedState(), ts)), alg).toBe(theirs);
      }),
      { numRuns: CASES },
    );
  });
});
