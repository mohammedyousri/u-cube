/// <reference lib="webworker" />
// Runs the heavy searches off the main thread.

import { cubieFromFacelets, unsolvableReason, InvalidCubeError } from "../core/cubie";
import { faceMoveToken, formatAlg } from "../core/notation";
import { buildTable } from "./distance";
import { bestSolution, generateScramble, type LevelId } from "./scramble";
import { initTables } from "./twophase";

export type WorkerRequest =
  | { id: number; type: "warm" }
  | { id: number; type: "scramble"; level: LevelId }
  | { id: number; type: "solve"; facelets: string; timeoutMs?: number };

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

const post = (r: WorkerResponse) => (self as unknown as Worker).postMessage(r);

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    switch (req.type) {
      case "warm": {
        const t0 = performance.now();
        initTables();
        buildTable();
        post({ id: req.id, ok: true, result: { ms: Math.round(performance.now() - t0) } });
        break;
      }
      case "scramble":
        post({ id: req.id, ok: true, result: generateScramble(req.level) });
        break;
      case "solve": {
        const c = cubieFromFacelets(req.facelets);
        const why = unsolvableReason(c);
        if (why) throw new InvalidCubeError(why);
        const sol = bestSolution(c, req.timeoutMs ?? 500);
        if (!sol) throw new Error("no solution found in time");
        post({ id: req.id, ok: true, result: { alg: formatAlg(sol.moves.map(faceMoveToken)), optimal: sol.optimal } });
        break;
      }
    }
  } catch (err) {
    post({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
