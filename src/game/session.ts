// The game: owns the logical cube, the attempt's timeline and the timer.
// The 3D view only follows (it may lag a few animation frames behind).

import { applyLayerMove, facelets, isSolvedFacelets, solvedState, type CubeState } from "../core/cube";
import { formatToken, invertToken, parseAlg, simplify, toLayerMove, type Token } from "../core/notation";
import type { Stage } from "../render/scene";
import { solver } from "../solver/client";
import type { LevelId, Scramble } from "../solver/scramble";
import { StageTracker } from "./stages";
import { inspectionPenalty, moveCost, type Penalty, type SolveRecord, type TimedMove } from "./stats";
import { saveSolve, type Settings } from "./storage";

export type Status = "idle" | "loading" | "scrambling" | "inspecting" | "ready" | "solving" | "solved" | "replay";

const ROTATION = new Set(["x", "y", "z"]);

export class Game {
  state: CubeState = solvedState();
  status: Status = "idle";
  level: LevelId = "easy";
  scramble: Scramble | null = null;
  inspectionStart = 0;
  timerStart = 0;
  endTime = 0;
  penalty: Penalty = 0;
  htm = 0;
  stm = 0;
  hints = 0;
  tracker = new StageTracker();
  last: SolveRecord | null = null;
  /** Hint currently shown (cleared on the next move). */
  hint: Token | null = null;
  private timeline: { at: number; m: string }[] = [];
  /** Turns made since the timer started, for move counting (adjacent same-layer turns merge: U U = U2). */
  private solveTokens: Token[] = [];
  private undoStack: Token[] = [];
  private listeners = new Set<(why: string) => void>();
  private loadToken = 0;

  constructor(private stage: Stage, private settings: () => Settings) {
    stage.onFrame(() => {
      if (this.status === "scrambling" && !stage.cube.busy) {
        this.inspectionStart = performance.now();
        this.status = this.usesInspection() ? "inspecting" : "ready";
        this.emit("status");
      }
    });
    stage.onYawRebase = (dir) => this.rebase(dir);
  }

  on(fn: (why: string) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(why: string) {
    for (const fn of this.listeners) fn(why);
  }

  usesInspection() {
    const s = this.settings().inspection;
    return s === "always" || (s === "expert" && this.level === "expert");
  }

  get acceptsMoves() {
    return this.status !== "loading" && this.status !== "scrambling" && this.status !== "replay";
  }

  /** Elapsed solve time in ms, for the live timer. */
  elapsed(now = performance.now()): number {
    if (this.status === "solving") return now - this.timerStart;
    if (this.status === "solved") return this.endTime - this.timerStart;
    return 0;
  }

  inspectionElapsed(now = performance.now()) {
    return this.status === "inspecting" ? now - this.inspectionStart : 0;
  }

  /**
   * Apply a move. `animate: false` when the view already shows it (a finished drag).
   * Returns false if moves are not accepted right now.
   */
  commit(t: Token, opts: { animate?: boolean; undo?: boolean } = {}): boolean {
    if (!this.acceptsMoves) return false;
    const lm = toLayerMove(t);
    this.state = applyLayerMove(this.state, lm);
    if (opts.animate !== false) this.stage.cube.enqueue(lm);
    this.stage.cube.clearNudge();
    this.hint = null;
    if (!opts.undo) this.undoStack.push(t);
    const now = performance.now();
    const rotation = ROTATION.has(t.base);

    if ((this.status === "inspecting" || this.status === "ready") && !rotation) {
      this.penalty = this.status === "inspecting" ? inspectionPenalty(now - this.inspectionStart) : 0;
      this.timerStart = now;
      this.status = "solving";
      this.emit("status");
    }
    if (this.status === "solving" || this.status === "inspecting" || this.status === "ready") {
      this.timeline.push({ at: now, m: formatToken(t) });
      if (this.status === "solving") {
        this.solveTokens.push(t);
        this.recount();
        const f = facelets(this.state);
        this.tracker.update(f, now - this.timerStart);
        if (isSolvedFacelets(f)) this.finish(now);
      }
    }
    this.emit("move");
    return true;
  }

  private recount() {
    this.htm = this.stm = 0;
    for (const x of simplify(this.solveTokens)) {
      const c = moveCost(x.base);
      this.htm += c.htm;
      this.stm += c.stm;
    }
  }

  undo() {
    const t = this.undoStack.pop();
    if (t) this.commit(invertToken(t), { undo: true });
  }

  /** Orbiting past 45° turns the logical frame too (y / y'), invisibly. */
  private rebase(dir: 1 | -1) {
    if (this.status === "replay" || this.status === "loading") return;
    const t: Token = { base: "y", amount: dir === 1 ? 1 : -1 };
    this.stage.cube.flush();
    const lm = toLayerMove(t);
    this.state = applyLayerMove(this.state, lm);
    this.stage.cube.setState(this.state);
    if (this.status === "solving" || this.status === "inspecting" || this.status === "ready")
      this.timeline.push({ at: performance.now(), m: formatToken(t) });
    this.emit("move");
  }

  private finish(now: number) {
    this.endTime = now;
    this.status = "solved";
    const s = this.scramble!;
    const record: SolveRecord = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      date: Date.now(),
      level: s.level,
      scramble: s.alg,
      timeMs: Math.round(now - this.timerStart),
      penalty: this.penalty,
      htm: this.htm,
      stm: this.stm,
      optimal: s.optimal,
      lower: s.lower,
      upper: s.upper,
      hints: this.hints,
      inspectionMs: this.usesInspection() ? Math.round(this.timerStart - this.inspectionStart) : null,
      moves: this.timeline.map((x): TimedMove => ({ t: Math.round(x.at - this.timerStart), m: x.m })),
      splits: this.tracker.times.map((x) => (x === null ? null : Math.round(x))),
    };
    this.last = record;
    void saveSolve(record);
    this.stage.celebrate();
    this.emit("solved");
  }

  async newSolve(level: LevelId = this.level, given?: Scramble) {
    const token = ++this.loadToken;
    this.level = level;
    this.status = "loading";
    this.emit("status");
    let s: Scramble;
    try {
      s = given ?? (await solver.scramble(level));
    } catch (e) {
      this.status = "idle";
      this.emit("error:" + (e as Error).message);
      return;
    }
    if (token !== this.loadToken) return;
    this.scramble = s;
    this.resetAttempt();
    this.stage.cube.setState(solvedState());
    this.state = solvedState();
    const moves = parseAlg(s.alg);
    for (const t of moves) {
      const lm = toLayerMove(t);
      this.state = applyLayerMove(this.state, lm);
      this.stage.cube.enqueue(lm, { duration: 55 });
    }
    this.status = "scrambling";
    this.emit("status");
    solver.prefetch(level);
  }

  /** Back to a solved cube with no attempt running. */
  reset() {
    this.loadToken++;
    this.resetAttempt();
    this.scramble = null;
    this.state = solvedState();
    this.stage.cube.setState(this.state);
    this.status = "idle";
    this.emit("status");
  }

  /** Stop the attempt but keep the cube as it is (free play). */
  abandon() {
    if (this.status === "solving" || this.status === "inspecting" || this.status === "ready") {
      this.status = "idle";
      this.emit("status");
    }
  }

  private resetAttempt() {
    this.timeline = [];
    this.solveTokens = [];
    this.undoStack = [];
    this.htm = this.stm = this.hints = 0;
    this.penalty = 0;
    this.tracker = new StageTracker();
    this.hint = null;
    this.last = null;
  }

  async requestHint(): Promise<Token | null> {
    if (!this.acceptsMoves) return null;
    const f = facelets(this.state);
    if (isSolvedFacelets(f)) return null;
    const before = this.state;
    const res = await solver.solve(f, 600);
    if (this.state !== before) return null; // the cube moved meanwhile
    const first = parseAlg(res.alg)[0] ?? null;
    if (!first) return null;
    if (this.status === "solving" || this.status === "inspecting" || this.status === "ready") this.hints++;
    this.hint = first;
    this.stage.cube.flush();
    this.stage.cube.showNudge(toLayerMove(first));
    this.emit("hint");
    return first;
  }

  enterReplay() {
    this.loadToken++;
    this.status = "replay";
    this.emit("status");
  }

  exitReplay() {
    this.status = "idle";
    this.state = this.stage.cube.state;
    this.emit("status");
  }
}
