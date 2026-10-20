// Integer geometry of the 3×3×3 cube. Everything about moves is derived from
// these rotations; no move table is typed in by hand.
//
// Axes: x = towards R, y = towards U, z = towards F.
// A cubie's position is a vector in {-1,0,1}^3; a sticker is (position, normal).

export type Vec3 = [number, number, number];
export type Axis = 0 | 1 | 2;

/** Row-major 3×3 integer matrices for the 24 proper rotations of the cube. */
export const ROTATIONS: Int8Array[] = [];
/** ROT_MUL[a * 24 + b] = index of R_a · R_b (apply b, then a). */
export const ROT_MUL = new Uint8Array(24 * 24);
/** ROT_INV[a] = index of R_a⁻¹. */
export const ROT_INV = new Uint8Array(24);
/** QUARTER[axis][q] = index of a rotation by q·90° (right-hand rule) about +axis. */
export const QUARTER: number[][] = [];

function matMul(a: ArrayLike<number>, b: ArrayLike<number>): Int8Array {
  const r = new Int8Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[i * 3 + k] * b[k * 3 + j];
      r[i * 3 + j] = s;
    }
  return r;
}

function matKey(m: ArrayLike<number>): string {
  return Array.prototype.join.call(m, ",");
}

export function rotate(m: ArrayLike<number>, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

// +90° about x: y→z.  +90° about y: z→x.  +90° about z: x→y.
const GENERATORS = [
  Int8Array.of(1, 0, 0, 0, 0, -1, 0, 1, 0),
  Int8Array.of(0, 0, 1, 0, 1, 0, -1, 0, 0),
  Int8Array.of(0, -1, 0, 1, 0, 0, 0, 0, 1),
];

(function buildRotationGroup() {
  const index = new Map<string, number>();
  const add = (m: Int8Array) => {
    const k = matKey(m);
    if (!index.has(k)) {
      index.set(k, ROTATIONS.length);
      ROTATIONS.push(m);
    }
  };
  add(Int8Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1));
  for (let i = 0; i < ROTATIONS.length; i++) for (const g of GENERATORS) add(matMul(g, ROTATIONS[i]));
  if (ROTATIONS.length !== 24) throw new Error("rotation group must have 24 elements");
  for (let a = 0; a < 24; a++)
    for (let b = 0; b < 24; b++) {
      const p = index.get(matKey(matMul(ROTATIONS[a], ROTATIONS[b])))!;
      ROT_MUL[a * 24 + b] = p;
      if (p === 0) ROT_INV[a] = b;
    }
  for (let axis = 0; axis < 3; axis++) {
    const g = index.get(matKey(GENERATORS[axis]))!;
    QUARTER[axis] = [0, g, ROT_MUL[g * 24 + g], ROT_MUL[g * 24 + ROT_MUL[g * 24 + g]]];
  }
})();

/** Position index 0..26 of a vector in {-1,0,1}^3. Index 13 is the core. */
export const posIndex = (v: Vec3) => (v[0] + 1) * 9 + (v[1] + 1) * 3 + (v[2] + 1);
export const POSITIONS: Vec3[] = Array.from({ length: 27 }, (_, i) => [
  Math.floor(i / 9) - 1,
  (Math.floor(i / 3) % 3) - 1,
  (i % 3) - 1,
]);

// ---- Faces and facelets ------------------------------------------------------
// Facelet order is the Kociemba / WCA-scrambler convention: U R F D L B, each
// face read row by row as seen from outside, with the face "up" direction:
// U: back at top · D: front at top · side faces: U at top.

export const FACE_NAMES = ["U", "R", "F", "D", "L", "B"] as const;
export type FaceName = (typeof FACE_NAMES)[number];

interface FaceFrame {
  normal: Vec3;
  right: Vec3;
  up: Vec3;
}
export const FACE_FRAMES: FaceFrame[] = [
  { normal: [0, 1, 0], right: [1, 0, 0], up: [0, 0, -1] }, // U
  { normal: [1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] }, // R
  { normal: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] }, // F
  { normal: [0, -1, 0], right: [1, 0, 0], up: [0, 0, 1] }, // D
  { normal: [-1, 0, 0], right: [0, 0, 1], up: [0, 1, 0] }, // L
  { normal: [0, 0, -1], right: [-1, 0, 0], up: [0, 1, 0] }, // B
];

/** Face index (0..5, URFDLB) of a unit axis vector. */
export function faceOfNormal(n: Vec3): number {
  for (let f = 0; f < 6; f++) {
    const m = FACE_FRAMES[f].normal;
    if (m[0] === n[0] && m[1] === n[1] && m[2] === n[2]) return f;
  }
  throw new Error(`not a face normal: ${n}`);
}

/** FACELET_AT[pos * 6 + face] = facelet index 0..53, or -1. */
export const FACELET_AT = new Int8Array(27 * 6).fill(-1);
/** For each facelet 0..53: its cubie position and outward normal. */
export const FACELET_POS: Vec3[] = [];
export const FACELET_NORMAL: Vec3[] = [];

for (let f = 0; f < 6; f++) {
  const { normal, right, up } = FACE_FRAMES[f];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      const p: Vec3 = [0, 1, 2].map((k) => normal[k] + (c - 1) * right[k] + (1 - r) * up[k]) as Vec3;
      const idx = f * 9 + r * 3 + c;
      FACELET_AT[posIndex(p) * 6 + f] = idx;
      FACELET_POS[idx] = p;
      FACELET_NORMAL[idx] = normal;
    }
}

export function faceletAt(p: Vec3, n: Vec3): number {
  return FACELET_AT[posIndex(p) * 6 + faceOfNormal(n)];
}

/** Outward normals of the stickers a cubie at home position p carries. */
export function stickerNormals(p: Vec3): Vec3[] {
  const out: Vec3[] = [];
  for (let k = 0; k < 3; k++)
    if (p[k] !== 0) {
      const n: Vec3 = [0, 0, 0];
      n[k] = p[k];
      out.push(n);
    }
  return out;
}

// ---- Kociemba cubie numbering -------------------------------------------------
// Corner and edge slots in Kociemba order. Each slot's facelets start with the
// U/D facelet (F/B for middle-layer edges) and go clockwise seen from outside.

export const CORNER_NAMES = ["URF", "UFL", "ULB", "UBR", "DFR", "DLF", "DBL", "DRB"];
export const EDGE_NAMES = ["UR", "UF", "UL", "UB", "DR", "DF", "DL", "DB", "FR", "FL", "BL", "BR"];

const LETTER_VEC: Record<string, Vec3> = {
  U: [0, 1, 0], D: [0, -1, 0], R: [1, 0, 0], L: [-1, 0, 0], F: [0, 0, 1], B: [0, 0, -1],
};
function slotVector(name: string): Vec3 {
  const v: Vec3 = [0, 0, 0];
  for (const ch of name) for (let k = 0; k < 3; k++) v[k] += LETTER_VEC[ch][k];
  return v;
}
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const CORNER_FACELETS: number[][] = CORNER_NAMES.map((name) => {
  const p = slotVector(name);
  const ns = stickerNormals(p);
  const ud = ns.find((n) => n[1] !== 0)!;
  const others = ns.filter((n) => n !== ud);
  // ud → a → b is clockwise seen from outside when (ud × a)·p < 0.
  const [a, b] = dot(cross(ud, others[0]), p) < 0 ? others : [others[1], others[0]];
  return [ud, a, b].map((n) => faceletAt(p, n));
});

export const EDGE_FACELETS: number[][] = EDGE_NAMES.map((name) => {
  const p = slotVector(name);
  const ns = stickerNormals(p);
  const primary = ns.find((n) => n[1] !== 0) ?? ns.find((n) => n[2] !== 0)!;
  const other = ns.find((n) => n !== primary)!;
  return [primary, other].map((n) => faceletAt(p, n));
});

/** Face index of each facelet in the solved cube (facelet → URFDLB). */
export const FACELET_FACE = Array.from({ length: 54 }, (_, i) => Math.floor(i / 9));
