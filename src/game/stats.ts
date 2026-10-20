// Results, penalties and averages as the WCA defines them (Regulations 9f, 9f1,
// Article A for inspection). ao12 follows the community convention (drop the
// single best and worst, mean of the other 10).

import type { LevelId } from "../solver/scramble";

export type Penalty = 0 | 2000 | "DNF";

export interface TimedMove {
  /** ms since the timer started (negative = during inspection). */
  t: number;
  m: string;
}

export interface SolveRecord {
  id: string;
  date: number;
  level: LevelId;
  scramble: string;
  timeMs: number;
  penalty: Penalty;
  htm: number;
  stm: number;
  optimal: number | null;
  lower: number;
  upper: number;
  hints: number;
  inspectionMs: number | null;
  moves: TimedMove[];
  /** Cross, F2L, OLL, PLL completion times (ms), null if not reached in order. */
  splits: (number | null)[];
}

export const effective = (r: Pick<SolveRecord, "timeMs" | "penalty">) =>
  r.penalty === "DNF" ? Infinity : r.timeMs + r.penalty;

/** WCA inspection: >15 s → +2, >17 s → DNF. */
export function inspectionPenalty(ms: number): Penalty {
  if (ms > 17000) return "DNF";
  if (ms > 15000) return 2000;
  return 0;
}

/** Trimmed mean of the last n results; null if fewer than n, Infinity for DNF. */
export function averageOf(records: Pick<SolveRecord, "timeMs" | "penalty">[], n: number): number | null {
  if (records.length < n) return null;
  const xs = records.slice(-n).map(effective).sort((a, b) => a - b);
  const trimmed = xs.slice(1, -1);
  if (trimmed.some((x) => !isFinite(x))) return Infinity;
  return trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
}

export function bestSingle(records: Pick<SolveRecord, "timeMs" | "penalty">[]): number | null {
  let best = Infinity;
  for (const r of records) best = Math.min(best, effective(r));
  return records.length ? best : null;
}

/** Singles are truncated to hundredths; averages rounded (Regulation 9f1). */
export function formatTime(ms: number | null, kind: "single" | "average" = "single"): string {
  if (ms === null) return "—";
  if (!isFinite(ms)) return "DNF";
  const cs = kind === "single" ? Math.floor(ms / 10) : Math.round(ms / 10);
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  const body = `${m > 0 ? `${s}`.padStart(2, "0") : s}.${`${c}`.padStart(2, "0")}`;
  return m > 0 ? `${m}:${body}` : body;
}

export function formatResult(r: Pick<SolveRecord, "timeMs" | "penalty">): string {
  if (r.penalty === "DNF") return `DNF (${formatTime(r.timeMs)})`;
  if (r.penalty === 2000) return `${formatTime(r.timeMs + 2000)}+`;
  return formatTime(r.timeMs);
}

/** Move counts: HTM counts slices as 2; STM counts any layer turn as 1; rotations are free. */
export function moveCost(base: string): { htm: number; stm: number } {
  if (base === "x" || base === "y" || base === "z") return { htm: 0, stm: 0 };
  if (base === "M" || base === "E" || base === "S") return { htm: 2, stm: 1 };
  return { htm: 1, stm: 1 };
}
