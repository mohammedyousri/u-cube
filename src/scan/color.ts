// Sticker colour classification for the cube scanner.
//
// Each of the 54 samples is an sRGB colour (median of a sticker's pixels).
// Colours are compared in CIELAB with CIEDE2000. The six centers seed six
// clusters, and stickers are assigned with an exact balanced assignment
// (Hungarian algorithm): every colour gets exactly nine stickers, which is
// what makes white/yellow and red/orange separable under poor lighting.

export type RGB = [number, number, number]; // 0..255
export type Lab = [number, number, number];

function srgbToLinear(c: number) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function rgbToLab([r8, g8, b8]: RGB): Lab {
  const r = srgbToLinear(r8), g = srgbToLinear(g8), b = srgbToLinear(b8);
  // sRGB D65 → XYZ, normalised by the D65 white point
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000 colour difference. kL > 1 de-emphasises lightness (useful under uneven light). */
export function deltaE2000([L1, a1, b1]: Lab, [L2, a2, b2]: Lab, kL = 1): number {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (a: number, b: number) => {
    if (a === 0 && b === 0) return 0;
    const v = Math.atan2(b, a) / rad;
    return v < 0 ? v + 360 : v;
  };
  const h1p = h(a1p, b1), h2p = h(a2p, b2);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lpm = (L1 + L2) / 2;
  const Cpm = (C1p + C2p) / 2;
  let hpm = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hpm = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
    else hpm = (h1p + h2p) / 2;
  }
  const T = 1 - 0.17 * Math.cos((hpm - 30) * rad) + 0.24 * Math.cos(2 * hpm * rad) + 0.32 * Math.cos((3 * hpm + 6) * rad) - 0.2 * Math.cos((4 * hpm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hpm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lpm - 50) ** 2) / Math.sqrt(20 + (Lpm - 50) ** 2);
  const Sc = 1 + 0.045 * Cpm;
  const Sh = 1 + 0.015 * Cpm * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / (kL * Sl)) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

/** Minimum-cost perfect assignment for a square cost matrix (Hungarian algorithm, O(n³)). Returns row → column. */
export function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  const u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= n; j++)
        if (!used[j]) {
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
      for (let j = 0; j <= n; j++)
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const rowToCol = new Array(n).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j]) rowToCol[p[j] - 1] = j - 1;
  return rowToCol;
}

/**
 * One colour for a sticker from its pixels (RGB triples, flat). Specular glare is
 * the brightest part of a sticker, so the brightest quarter is dropped before
 * taking the per-channel median.
 */
export function robustColor(px: ArrayLike<number>, stride = 3): RGB {
  const n = Math.floor(px.length / stride);
  const idx = Array.from({ length: n }, (_, i) => i);
  const lum = (i: number) => 0.2126 * px[i * stride] + 0.7152 * px[i * stride + 1] + 0.0722 * px[i * stride + 2];
  idx.sort((a, b) => lum(a) - lum(b));
  const keep = idx.slice(0, Math.max(1, Math.ceil(n * 0.75)));
  const med = (k: number) => {
    const v = keep.map((i) => px[i * stride + k]).sort((a, b) => a - b);
    return v[v.length >> 1];
  };
  return [med(0), med(1), med(2)];
}

export interface Classification {
  /** For each of the 54 stickers, the index (0..5 = URFDLB) of the face whose center it matches. */
  labels: number[];
  /** Per-sticker confidence 0..1 (margin between best and second-best colour). */
  confidence: number[];
  /** Mean colour of each cluster, sRGB. */
  means: RGB[];
}

const CENTERS = [4, 13, 22, 31, 40, 49];

/**
 * Classify 54 samples (Kociemba facelet order). Centers are fixed to their
 * own face; the other 48 stickers are assigned eight per colour, refined over
 * a few rounds with cluster means.
 */
/** Typical photographed sticker colours, URFDLB = white red green yellow orange blue. */
export const REFERENCE: RGB[] = [
  [226, 228, 222], [188, 28, 42], [24, 158, 82], [238, 208, 36], [240, 108, 30], [22, 82, 178],
];

/**
 * White balance from a known fact: every cube has exactly nine stickers of each
 * colour, so the average of all 54 stickers is the same for any scramble. Scaling
 * each channel (in linear light) so the observed average matches the expected one
 * removes the light's colour cast and exposure.
 */
export function whiteBalance(samples: RGB[]): RGB[] {
  const lin = samples.map((c) => c.map(srgbToLinear));
  const expected = [0, 1, 2].map((k) => REFERENCE.reduce((a, c) => a + srgbToLinear(c[k]), 0) / 6);
  const observed = [0, 1, 2].map((k) => lin.reduce((a, c) => a + c[k], 0) / lin.length);
  const gain = expected.map((e, k) => e / Math.max(1e-4, observed[k]));
  return lin.map((c) => c.map((v, k) => linearToSrgb(v * gain[k])) as RGB);
}

function linearToSrgb(v: number) {
  v = Math.max(0, Math.min(1, v));
  return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
}

const KL = 2;

export function classify(rawSamples: RGB[]): Classification {
  const samples = whiteBalance(rawSamples);
  const labs = samples.map(rgbToLab);
  let means: Lab[] = CENTERS.map((i) => labs[i]);
  let labels = new Array(54).fill(0);
  const others = Array.from({ length: 54 }, (_, i) => i).filter((i) => !CENTERS.includes(i));
  for (let round = 0; round < 4; round++) {
    // 48 stickers × 48 slots (8 per colour)
    const cost = others.map((i) => {
      const row: number[] = [];
      for (let c = 0; c < 6; c++) {
        const d = deltaE2000(labs[i], means[c], KL);
        for (let k = 0; k < 8; k++) row.push(d);
      }
      return row;
    });
    const assign = hungarian(cost);
    labels = new Array(54).fill(0);
    CENTERS.forEach((ci, f) => (labels[ci] = f));
    others.forEach((i, r) => (labels[i] = Math.floor(assign[r] / 8)));
    // Re-estimate cluster means, weighting the center (a known member) double.
    const next: Lab[] = [];
    for (let c = 0; c < 6; c++) {
      const members = labels.map((l, i) => (l === c ? i : -1)).filter((i) => i >= 0);
      const acc: Lab = [0, 0, 0];
      let w = 0;
      for (const i of members) {
        const wi = i === CENTERS[c] ? 2 : 1;
        for (let k = 0; k < 3; k++) acc[k] += labs[i][k] * wi;
        w += wi;
      }
      next.push(acc.map((x) => x / w) as Lab);
    }
    means = next;
  }
  const confidence = labs.map((lab, i) => {
    const ds = means.map((m) => deltaE2000(lab, m, KL));
    const own = ds[labels[i]];
    const other = Math.min(...ds.filter((_, c) => c !== labels[i]));
    return Math.max(0, Math.min(1, (other - own) / Math.max(1, other)));
  });
  const meanRgb = means.map((_, c) => {
    const members = labels.map((l, i) => (l === c ? i : -1)).filter((i) => i >= 0);
    return [0, 1, 2].map((k) => Math.round(members.reduce((a, i) => a + samples[i][k], 0) / members.length)) as RGB;
  });
  return { labels, confidence, means: meanRgb };
}

/** Plain-language name for a cube sticker colour. */
export function colorName([r, g, b]: RGB): string {
  const [L, a, bb] = rgbToLab([r, g, b]);
  const C = Math.hypot(a, bb);
  if (C < 18) return L > 55 ? "white" : "grey";
  const h = ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  if (h < 47 || h >= 345) return "red";
  if (h < 75) return "orange";
  if (h < 110) return "yellow";
  if (h < 200) return "green";
  return "blue";
}
