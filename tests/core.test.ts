import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ROTATIONS, ROT_MUL, CORNER_FACELETS, EDGE_FACELETS } from "../src/core/geometry";
import { applyAlg, applyTokens, facelets, isSolved, solvedState, statesEqual } from "../src/core/cube";
import { formatAlg, invertAlg, parseAlg, simplify, type Token, FAMILIES } from "../src/core/notation";
import {
  applyFaceMove,
  cubieFromFacelets,
  faceletsFromCubie,
  invariants,
  invert,
  multiply,
  solvedCubie,
  isSolvedCubie,
} from "../src/core/cubie";

const SOLVED = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";
const RUNS = 10_000;

const ALL_BASES = Object.keys(FAMILIES);
const FACE_BASES = ["U", "R", "F", "D", "L", "B"];
const tokenArb = (bases: string[]) =>
  fc.record({
    base: fc.constantFrom(...bases),
    amount: fc.constantFrom<1 | 2 | -1>(1, 2, -1),
  });
const algArb = (bases: string[], max = 40) => fc.array(tokenArb(bases), { minLength: 0, maxLength: max });

describe("geometry", () => {
  it("has exactly the 24 proper rotations, closed under composition", () => {
    expect(ROTATIONS.length).toBe(24);
    for (let a = 0; a < 24; a++) for (let b = 0; b < 24; b++) expect(ROT_MUL[a * 24 + b]).toBeLessThan(24);
  });
  it("matches Kociemba's published facelet numbering", () => {
    // URF = U9 R1 F3; UFL = U7 F1 L3; DRB = D9 R9 B7 (0-based facelet indices below)
    expect(CORNER_FACELETS[0]).toEqual([8, 9, 20]);
    expect(CORNER_FACELETS[1]).toEqual([6, 18, 38]);
    expect(CORNER_FACELETS[7]).toEqual([35, 17, 51]);
    // UR = U6 R2; FR = F6 R4; BR = B4 R6
    expect(EDGE_FACELETS[0]).toEqual([5, 10]);
    expect(EDGE_FACELETS[8]).toEqual([23, 12]);
    expect(EDGE_FACELETS[11]).toEqual([48, 14]);
  });
});

describe("notation", () => {
  it("parses and prints WCA notation", () => {
    expect(formatAlg(parseAlg("R U R' U2 Rw r2 M' x y2 z'"))).toBe("R U R' U2 Rw Rw2 M' x y2 z'");
    expect(formatAlg(parseAlg("R2' U3 F’"))).toBe("R2 U' F'");
    expect(formatAlg(parseAlg("RUR'U'"))).toBe("R U R' U'");
    expect(() => parseAlg("R Q")).toThrow();
  });
  it("round-trips any sequence", () => {
    fc.assert(
      fc.property(algArb(ALL_BASES), (ts) => {
        expect(parseAlg(formatAlg(ts))).toEqual(ts);
      }),
      { numRuns: 2000 },
    );
  });
  it("simplifies cancellations", () => {
    expect(formatAlg(simplify(parseAlg("R R' U U U2 F F")))).toBe("F2");
  });
});

describe("cube state: identities that must hold for any correct cube", () => {
  it("solved cube reads as the solved facelet string", () => {
    expect(facelets(solvedState())).toBe(SOLVED);
    expect(isSolved(solvedState())).toBe(true);
  });

  it("every single turn has order 4 (2 for half turns)", () => {
    for (const base of ALL_BASES) {
      let s = solvedState();
      for (let i = 1; i <= 4; i++) {
        s = applyAlg(s, base);
        expect(statesEqual(s, solvedState())).toBe(i === 4);
      }
    }
  });

  it("(R U R' U') × 6 is the identity, and not before", () => {
    let s = solvedState();
    for (let i = 1; i <= 6; i++) {
      s = applyAlg(s, "R U R' U'");
      expect(statesEqual(s, solvedState())).toBe(i === 6);
    }
  });

  it("(R U) has order 105", () => {
    let s = solvedState();
    for (let i = 1; i <= 105; i++) {
      s = applyAlg(s, "R U");
      expect(isSolved(s)).toBe(i === 105);
    }
  });

  it("superflip (20 moves) flips every edge and nothing else", () => {
    const c = cubieFromFacelets(facelets(applyAlg(solvedState(), "U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2")));
    expect(c.cp).toEqual(solvedCubie().cp);
    expect(c.co).toEqual(solvedCubie().co);
    expect(c.ep).toEqual(solvedCubie().ep);
    expect(c.eo).toEqual(new Array(12).fill(1));
  });

  it("wide moves, slices and rotations decompose correctly", () => {
    const eq = (a: string, b: string) =>
      expect(facelets(applyAlg(solvedState(), a))).toBe(facelets(applyAlg(solvedState(), b)));
    eq("Rw", "R M'");
    eq("Lw", "L M");
    eq("Uw", "U E'");
    eq("Dw", "D E");
    eq("Fw", "F S");
    eq("Bw", "B S'");
    eq("x", "R M' L'");
    eq("y", "U E' D'");
    eq("z", "F S B'");
    eq("M2", "M M");
  });

  it(`any sequence followed by its inverse is exactly the identity (${RUNS} cases)`, () => {
    fc.assert(
      fc.property(algArb(ALL_BASES, 60), (ts) => {
        const s = applyTokens(applyTokens(solvedState(), ts), invertAlg(ts));
        expect(statesEqual(s, solvedState())).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });

  it(`every reachable state satisfies twist ≡ 0 (mod 3), flip ≡ 0 (mod 2), equal parities (${RUNS} cases)`, () => {
    fc.assert(
      fc.property(algArb(ALL_BASES, 60), (ts) => {
        const r = invariants(cubieFromFacelets(facelets(applyTokens(solvedState(), ts))));
        expect(r.twist).toBe(0);
        expect(r.flip).toBe(0);
        expect(r.cornerParity).toBe(r.edgeParity);
      }),
      { numRuns: RUNS },
    );
  });
});

describe("cubie model agrees with the geometric model", () => {
  it(`face turns compose identically in both models (${RUNS} cases)`, () => {
    fc.assert(
      fc.property(algArb(FACE_BASES, 40), (ts: Token[]) => {
        const geo = facelets(applyTokens(solvedState(), ts));
        let c = solvedCubie();
        for (const t of ts) applyAndAssign(t);
        function applyAndAssign(t: Token) {
          const f = FACE_BASES.indexOf(t.base);
          c = applyFaceMove(c, f * 3 + (t.amount === 1 ? 0 : t.amount === 2 ? 1 : 2));
        }
        expect(faceletsFromCubie(c)).toBe(geo);
        expect(faceletsFromCubie(cubieFromFacelets(geo))).toBe(geo);
      }),
      { numRuns: RUNS },
    );
  });

  it("invert() is a true group inverse", () => {
    fc.assert(
      fc.property(algArb(FACE_BASES, 30), (ts) => {
        const c = cubieFromFacelets(facelets(applyTokens(solvedState(), ts)));
        expect(isSolvedCubie(multiply(c, invert(c)))).toBe(true);
        expect(isSolvedCubie(multiply(invert(c), c))).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it("rejects physically impossible cubes with the right reason", () => {
    const twisted = SOLVED.split("");
    // twist URF corner in place: U9 R1 F3 -> R F U
    [twisted[8], twisted[9], twisted[20]] = ["F", "U", "R"];
    expect(invariants(cubieFromFacelets(twisted.join(""))).twist).not.toBe(0);
    const flipped = SOLVED.split("");
    [flipped[5], flipped[10]] = ["R", "U"];
    expect(invariants(cubieFromFacelets(flipped.join(""))).flip).toBe(1);
    expect(() => cubieFromFacelets("U".repeat(54))).toThrow();
  });
});
