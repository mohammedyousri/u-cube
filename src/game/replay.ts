// Replays a recorded solve on the main cube, and encodes solves as share links.

import { applyAlg, applyTokens, solvedState, type CubeState } from "../core/cube";
import { parseAlg, toLayerMove, type Token } from "../core/notation";
import type { Stage } from "../render/scene";
import type { SolveRecord, TimedMove } from "./stats";

export type ReplayRecord = Pick<SolveRecord, "scramble" | "moves" | "timeMs" | "penalty" | "splits" | "level" | "htm" | "optimal" | "lower" | "upper">;

const ROT = new Set(["x", "y", "z"]);

export class Replay {
  readonly start: CubeState;
  readonly tokens: Token[];
  readonly t0: number;
  readonly tEnd: number;
  playhead: number;
  playing = false;
  speed = 1;
  private index = 0;
  private listeners: (() => void)[] = [];

  constructor(private stage: Stage, readonly rec: ReplayRecord) {
    this.start = applyAlg(solvedState(), rec.scramble);
    this.tokens = rec.moves.map((m) => parseAlg(m.m)[0]);
    this.t0 = Math.min(0, rec.moves[0]?.t ?? 0) - 500;
    this.tEnd = Math.max(rec.timeMs, rec.moves[rec.moves.length - 1]?.t ?? 0) + 400;
    this.playhead = this.t0;
    this.seek(this.t0);
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }
  private emit() {
    for (const f of this.listeners) f();
  }

  /** Index of the next move not yet shown. */
  get position() {
    return this.index;
  }

  seek(t: number) {
    this.playhead = Math.max(this.t0, Math.min(this.tEnd, t));
    let n = 0;
    while (n < this.rec.moves.length && this.rec.moves[n].t <= this.playhead) n++;
    this.index = n;
    this.stage.cube.setState(applyTokens(this.start, this.tokens.slice(0, n)));
    this.emit();
  }

  play() {
    if (this.playhead >= this.tEnd) this.seek(this.t0);
    this.playing = true;
    this.emit();
  }

  pause() {
    this.playing = false;
    this.emit();
  }

  tick(dt: number) {
    if (!this.playing) return;
    this.playhead += dt * this.speed;
    const moves = this.rec.moves;
    while (this.index < moves.length && moves[this.index].t <= this.playhead) {
      const next = moves[this.index + 1];
      const gap = next ? (next.t - moves[this.index].t) / this.speed : 200;
      this.stage.cube.enqueue(toLayerMove(this.tokens[this.index]), { duration: Math.max(30, Math.min(this.stage.cube.turnMs, gap * 0.9)) });
      this.index++;
    }
    if (this.playhead >= this.tEnd) {
      this.playhead = this.tEnd;
      this.playing = false;
    }
    this.emit();
  }
}

/** Turns per second over time (1 s window), sampled every 100 ms. Rotations excluded. */
export function tpsSeries(moves: TimedMove[], timeMs: number): { t: number; tps: number }[] {
  const ts = moves.filter((m) => m.t >= 0 && !ROT.has(m.m.replace(/['2]/g, ""))).map((m) => m.t);
  const out: { t: number; tps: number }[] = [];
  for (let t = 0; t <= timeMs; t += 100) {
    let n = 0;
    for (const x of ts) if (x > t - 500 && x <= t + 500) n++;
    out.push({ t, tps: n });
  }
  return out;
}

// ---- share links --------------------------------------------------------------

function b64urlEncode(s: string) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeShare(r: ReplayRecord): string {
  const payload = {
    v: 1, l: r.level, s: r.scramble, t: r.timeMs, p: r.penalty, h: r.htm, o: r.optimal, lo: r.lower, up: r.upper, sp: r.splits,
    m: r.moves.map((x) => `${x.m}@${x.t.toString(36)}`).join(" "),
  };
  return b64urlEncode(JSON.stringify(payload));
}

export function decodeShare(code: string): ReplayRecord | null {
  try {
    const p = JSON.parse(b64urlDecode(code));
    if (p.v !== 1 || typeof p.s !== "string") return null;
    parseAlg(p.s); // validate
    const moves: TimedMove[] = p.m
      ? String(p.m).split(" ").map((x: string) => {
          const [m, t] = x.split("@");
          parseAlg(m);
          return { m, t: parseInt(t, 36) };
        })
      : [];
    return {
      level: p.l, scramble: p.s, timeMs: Number(p.t) || 0, penalty: p.p ?? 0, htm: p.h ?? 0,
      optimal: p.o ?? null, lower: p.lo ?? 0, upper: p.up ?? 0, splits: Array.isArray(p.sp) ? p.sp : [null, null, null, null], moves,
    };
  } catch {
    return null;
  }
}
