// Exact optimal distance (half-turn metric) for positions up to 10 moves from
// solved, by meet-in-the-middle: a table of every position within 5 moves of
// solved (621,649 of them), and a depth-5 search from the position itself.
//
// State inside the search: corner permutation, twist and flip as coordinates
// (via the two-phase move tables) plus the raw edge permutation.

import { type CubieCube, MOVE_CUBES } from "../core/cubie";
import { getCornerPerm, getFlip, getTwist } from "./coords";
import { tables } from "./twophase";

export const TABLE_DEPTH = 5;
export const MAX_EXACT = TABLE_DEPTH * 2;

const EP_MOVES = MOVE_CUBES.map((m) => Uint8Array.from(m.ep));

/** key1 = (cornerPerm·2187 + twist)·2048 + flip  (< 2^38);  key2 = edge permutation packed 4 bits each (< 2^48). */
interface Node {
  cp: number;
  tw: number;
  fl: number;
  ep: Uint8Array;
}

const key1 = (n: Node) => (n.cp * 2187 + n.tw) * 2048 + n.fl;
function key2(ep: Uint8Array): number {
  let k = 0;
  for (let i = 11; i >= 0; i--) k = k * 16 + ep[i];
  return k;
}

function step(n: Node, m: number, out: Node): Node {
  const t = tables();
  out.cp = t.cpMove[n.cp * 18 + m];
  out.tw = t.twistMove[n.tw * 18 + m];
  out.fl = t.flipMove[n.fl * 18 + m];
  const pm = EP_MOVES[m];
  for (let i = 0; i < 12; i++) out.ep[i] = n.ep[pm[i]];
  return out;
}

const newNode = (): Node => ({ cp: 0, tw: 0, fl: 0, ep: new Uint8Array(12) });
const copyNode = (n: Node): Node => ({ cp: n.cp, tw: n.tw, fl: n.fl, ep: n.ep.slice() });

function fromCubie(c: CubieCube): Node {
  return { cp: getCornerPerm(c), tw: getTwist(c), fl: getFlip(c), ep: Uint8Array.from(c.ep) };
}

// ---- open-addressing hash table --------------------------------------------------
const BITS = 21;
const SIZE = 1 << BITS;
let keys1: Float64Array | null = null;
let keys2: Float64Array;
let depths: Int8Array;

function slot(a: number, b: number): number {
  const h =
    Math.imul((a % 4294967296) | 0, 0x9e3779b1) ^
    Math.imul(Math.floor(a / 4294967296) | 0, 0x85ebca6b) ^
    Math.imul((b % 4294967296) | 0, 0xc2b2ae35) ^
    Math.imul(Math.floor(b / 4294967296) | 0, 0x27d4eb2f);
  return ((h ^ (h >>> 15)) >>> 0) & (SIZE - 1);
}

function lookup(n: Node): number {
  const a = key1(n);
  const b = key2(n.ep);
  for (let i = slot(a, b); ; i = (i + 1) & (SIZE - 1)) {
    const d = depths[i];
    if (d === -1) return -1;
    if (keys1![i] === a && keys2[i] === b) return d;
  }
}

function insert(n: Node, depth: number): boolean {
  const a = key1(n);
  const b = key2(n.ep);
  for (let i = slot(a, b); ; i = (i + 1) & (SIZE - 1)) {
    if (depths[i] === -1) {
      keys1![i] = a;
      keys2[i] = b;
      depths[i] = depth;
      return true;
    }
    if (keys1![i] === a && keys2[i] === b) return false;
  }
}

export function buildTable() {
  if (keys1) return;
  tables();
  keys1 = new Float64Array(SIZE);
  keys2 = new Float64Array(SIZE);
  depths = new Int8Array(SIZE).fill(-1);
  const solved: Node = { cp: 0, tw: 0, fl: 0, ep: Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) };
  insert(solved, 0);
  let frontier: Node[] = [solved];
  for (let d = 0; d < TABLE_DEPTH; d++) {
    const next: Node[] = [];
    for (const s of frontier)
      for (let m = 0; m < 18; m++) {
        const child = step(s, m, newNode());
        if (insert(child, d + 1) && d + 1 < TABLE_DEPTH) next.push(child);
      }
    frontier = next;
  }
}

/**
 * An optimal solution (list of face-move indices) if the position is at most
 * 10 moves from solved; null if it is further.
 */
export function optimalSolution(c: CubieCube): number[] | null {
  buildTable();
  let best = Infinity;
  let bestPrefix: number[] = [];
  let bestNode: Node | null = null;
  const path: number[] = [];
  const bufs = Array.from({ length: TABLE_DEPTH + 1 }, newNode);

  const dfs = (s: Node, k: number, lastFace: number) => {
    const d = lookup(s);
    if (d >= 0 && k + d < best) {
      best = k + d;
      bestPrefix = path.slice(0, k);
      bestNode = copyNode(s);
    }
    if (k === TABLE_DEPTH || k + 1 >= best) return;
    for (let m = 0; m < 18; m++) {
      const f = (m / 3) | 0;
      if (f === lastFace || f === lastFace - 3) continue;
      path[k] = m;
      dfs(step(s, m, bufs[k + 1]), k + 1, f);
    }
  };
  dfs(fromCubie(c), 0, -1);
  if (!bestNode) return null;

  // Walk down the table from the meeting point.
  const out = bestPrefix;
  let node: Node = bestNode;
  let d = lookup(node);
  const tmp = newNode();
  while (d > 0) {
    let stepped = false;
    for (let m = 0; m < 18 && !stepped; m++) {
      if (lookup(step(node, m, tmp)) === d - 1) {
        out.push(m);
        node = copyNode(tmp);
        d--;
        stepped = true;
      }
    }
    if (!stepped) throw new Error("distance table is inconsistent");
  }
  return out;
}

/** Exact optimal distance, or null if more than 10. */
export function optimalDistance(c: CubieCube): number | null {
  const s = optimalSolution(c);
  return s ? s.length : null;
}

/** Number of table positions at each distance 0..5 (for checking against published counts). */
export function depthCounts(): number[] {
  buildTable();
  const counts = new Array(TABLE_DEPTH + 1).fill(0);
  for (let i = 0; i < SIZE; i++) if (depths[i] >= 0) counts[depths[i]]++;
  return counts;
}
