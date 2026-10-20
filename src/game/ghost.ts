// Race a previous solve of the same scramble: a translucent copy replays it in real time.

import { applyAlg, applyTokens, solvedState } from "../core/cube";
import { parseAlg, toLayerMove } from "../core/notation";
import type { CubeView } from "../render/cubeView";
import type { SolveRecord } from "./stats";

export class GhostRun {
  private start = 0;
  private index = 0;
  private running = false;
  private tokens;

  constructor(private view: CubeView, readonly rec: Pick<SolveRecord, "scramble" | "moves" | "timeMs">) {
    this.tokens = rec.moves.map((m) => parseAlg(m.m)[0]);
    this.reset();
  }

  /** Scrambled, plus any rotations the ghost made during inspection. */
  reset() {
    this.running = false;
    let n = 0;
    while (n < this.rec.moves.length && this.rec.moves[n].t < 0) n++;
    this.index = n;
    this.view.setState(applyTokens(applyAlg(solvedState(), this.rec.scramble), this.tokens.slice(0, n)));
  }

  go(now = performance.now()) {
    this.start = now;
    this.running = true;
  }

  stop() {
    this.running = false;
  }

  /** Ghost's elapsed time, capped at its finish. */
  elapsed(now = performance.now()) {
    if (!this.running && this.index === 0) return 0;
    return Math.min(this.rec.timeMs, now - this.start);
  }

  get finished() {
    return this.index >= this.rec.moves.length;
  }

  tick(now = performance.now()) {
    if (!this.running) return;
    const t = now - this.start;
    const ms = this.rec.moves;
    while (this.index < ms.length && ms[this.index].t <= t) {
      const next = ms[this.index + 1];
      const gap = next ? next.t - ms[this.index].t : 200;
      this.view.enqueue(toLayerMove(this.tokens[this.index]), { duration: Math.max(30, Math.min(this.view.turnMs, gap * 0.9)) });
      this.index++;
    }
    if (this.finished) this.running = false;
  }
}
