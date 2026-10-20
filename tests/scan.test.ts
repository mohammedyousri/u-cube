import { describe, expect, it } from "vitest";
import { applyTokens, facelets, solvedState, statesEqual } from "../src/core/cube";
import { cubieFromFacelets, isSolvedCubie } from "../src/core/cubie";
import { parseAlg, type Token } from "../src/core/notation";
import { classify, colorName, deltaE2000, hungarian, rgbToLab, robustColor, type RGB } from "../src/scan/color";
import { describeMove, stateFromFacelets } from "../src/scan/assemble";
import { applyMoves, canonicalWalk, randomState, seededRng, type Rng } from "../src/solver/scramble";
import { faceletsFromCubie } from "../src/core/cubie";
import { solve } from "../src/solver/twophase";

// Typical photographed sticker colours (sRGB), URFDLB = white red green yellow orange blue.
const PALETTE: RGB[] = [
  [226, 228, 222],
  [188, 28, 42],
  [24, 158, 82],
  [238, 208, 36],
  [240, 108, 30],
  [22, 82, 178],
];

interface Light {
  name: string;
  tint: [number, number, number];
  exposure: [number, number];
  /** per-pixel sensor noise (sRGB units) */
  noise: number;
  /** probability a sticker carries a specular highlight */
  glare: number;
}

const LIGHTS: Light[] = [
  { name: "daylight", tint: [1, 1, 1], exposure: [0.85, 1.05], noise: 8, glare: 0.05 },
  { name: "warm indoor bulb", tint: [1, 0.86, 0.64], exposure: [0.75, 1.0], noise: 10, glare: 0.1 },
  { name: "cool LED", tint: [0.88, 0.95, 1.05], exposure: [0.8, 1.05], noise: 10, glare: 0.1 },
  { name: "dim + noisy phone", tint: [1, 0.93, 0.82], exposure: [0.45, 0.7], noise: 22, glare: 0.1 },
];

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** Simulate the camera: each sticker is a 12×12 pixel patch with noise, a light gradient and maybe a glare spot. */
function photograph(f: string, light: Light, rng: Rng): RGB[] {
  const exposure = light.exposure[0] + rng() * (light.exposure[1] - light.exposure[0]);
  const gauss = () => (rng() + rng() + rng() - 1.5) * 2; // ~N(0,1)
  return Array.from(f, (ch, i) => {
    const base = PALETTE["URFDLB".indexOf(ch)];
    const face = Math.floor(i / 9), r = Math.floor((i % 9) / 3), c = i % 3;
    // light falls off across each face
    const local = exposure * (1 + 0.12 * ((c - 1) * 0.5 + (r - 1) * 0.3) + 0.04 * Math.sin(face));
    const glare = rng() < light.glare;
    const gx = rng() * 12, gy = rng() * 12, gr = 2.5 + rng() * 2.5; // glare spot covers ~15–40% of the patch
    const px: number[] = [];
    for (let y = 0; y < 12; y++)
      for (let x = 0; x < 12; x++) {
        let p = base.map((v, k) => v * light.tint[k] * local + gauss() * light.noise);
        if (glare && Math.hypot(x - gx, y - gy) < gr) p = p.map((v) => v * 0.3 + 255 * 0.7);
        px.push(...p.map(clamp));
      }
    return robustColor(px);
  });
}

describe("colour maths", () => {
  it("CIEDE2000 matches published reference pairs (Sharma, Wu & Dalal 2005)", () => {
    // Pairs 1, 7 and 17 from the CIEDE2000 test data set.
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 3);
    expect(deltaE2000([50, 0, 0], [50, -1, 2])).toBeCloseTo(2.3669, 3);
    expect(deltaE2000([50, 2.5, 0], [56, -27, -3])).toBeCloseTo(31.903, 2);
  });
  it("sRGB white maps to L*=100, a*=b*=0", () => {
    const [L, a, b] = rgbToLab([255, 255, 255]);
    expect(L).toBeCloseTo(100, 1);
    expect(Math.abs(a)).toBeLessThan(0.05);
    expect(Math.abs(b)).toBeLessThan(0.05);
  });
  it("Hungarian algorithm finds the optimal assignment", () => {
    const cost = [
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ];
    const a = hungarian(cost);
    expect(a.reduce((s, j, i) => s + cost[i][j], 0)).toBe(5); // 1 + 2 + 2
  });
  it("names the six standard sticker colours", () => {
    expect(PALETTE.map(colorName)).toEqual(["white", "red", "green", "yellow", "orange", "blue"]);
  });
});

describe("scan classification on synthetic photos", () => {
  for (const light of LIGHTS) {
    it(`recovers random cubes exactly under ${light.name}`, () => {
      const rng = seededRng(light.name.length * 97);
      const N = 300;
      let exact = 0;
      let wrongStickers = 0;
      for (let n = 0; n < N; n++) {
        const truth = faceletsFromCubie(randomState(rng));
        const cl = classify(photograph(truth, light, rng));
        const got = cl.labels.map((l) => "URFDLB"[l]).join("");
        if (got === truth) exact++;
        for (let i = 0; i < 54; i++) if (got[i] !== truth[i]) wrongStickers++;
      }
      console.log(`${light.name.padEnd(18)} exact cubes ${exact}/${N}, wrong stickers ${wrongStickers}/${N * 54}`);
      expect(exact / N).toBeGreaterThanOrEqual(0.98);
    });
  }
});

describe("scan → state → solution", () => {
  it("rebuilds the exact 3D state from a facelet string (1,000 random positions)", () => {
    const rng = seededRng(5);
    for (let n = 0; n < 1000; n++) {
      const walk = canonicalWalk(25, rng).map((m): Token => ({ base: "URFDLB"[(m / 3) | 0], amount: m % 3 === 0 ? 1 : m % 3 === 1 ? 2 : -1 }));
      const s = applyTokens(solvedState(), walk);
      const f = facelets(s);
      const back = stateFromFacelets(f);
      expect(facelets(back)).toBe(f);
      // non-center cubies are fully determined by the stickers
      for (let id = 0; id < 27; id++) {
        const isCenter = [4, 10, 12, 14, 16, 22, 13].includes(id);
        if (!isCenter) expect(back[id]).toBe(s[id]);
      }
    }
    expect(statesEqual(stateFromFacelets(facelets(solvedState())), solvedState())).toBe(true);
  });

  it("a photographed cube, once classified and solved, really ends up solved", () => {
    const rng = seededRng(77);
    for (let n = 0; n < 50; n++) {
      const truth = randomState(rng);
      const cl = classify(photograph(faceletsFromCubie(truth), LIGHTS[0], rng));
      const read = cl.labels.map((l) => "URFDLB"[l]).join("");
      expect(read).toBe(faceletsFromCubie(truth));
      const c = cubieFromFacelets(read);
      const sol = solve(c, { targetLength: 21, timeoutMs: 2000 })!;
      expect(isSolvedCubie(applyMoves(c, sol))).toBe(true);
      // and following the steps on the 3D state reaches solved too
      const s3d = applyTokens(stateFromFacelets(faceletsFromCubie(c)), sol.map((m) => ({ base: "URFDLB"[(m / 3) | 0], amount: m % 3 === 0 ? 1 : m % 3 === 1 ? 2 : -1 })));
      expect(facelets(s3d)).toBe("UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB");
    }
  });

  it("describes every face turn in words", () => {
    for (const t of parseAlg("U U' U2 D D' D2 R R' R2 L L' L2 F F' F2 B B' B2")) expect(describeMove(t).length).toBeGreaterThan(10);
  });
});
