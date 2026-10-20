import type { LevelId, Scramble } from "./scramble";
import type { WorkerRequest, WorkerResponse } from "./worker";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type Req = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;

export interface SolveResult {
  alg: string;
  /** True when the solution is proven shortest (position within 10 moves). */
  optimal: boolean;
}

class SolverClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private queued = new Map<LevelId, Promise<Scramble>>();
  readonly ready: Promise<{ ms: number }>;

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error));
    };
    this.ready = this.call({ type: "warm" }) as Promise<{ ms: number }>;
  }

  private call(req: Req): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...req, id } as WorkerRequest);
    });
  }

  /** Next scramble for a level; one is always kept pre-generated so "new solve" is instant. */
  scramble(level: LevelId): Promise<Scramble> {
    const ready = this.queued.get(level) ?? (this.call({ type: "scramble", level }) as Promise<Scramble>);
    const next = ready.catch(() => undefined).then(() => this.call({ type: "scramble", level }) as Promise<Scramble>);
    next.catch(() => undefined);
    this.queued.set(level, next);
    return ready;
  }

  prefetch(level: LevelId) {
    if (!this.queued.has(level)) this.queued.set(level, this.call({ type: "scramble", level }) as Promise<Scramble>);
  }

  solve(facelets: string, timeoutMs = 500): Promise<SolveResult> {
    return this.call({ type: "solve", facelets, timeoutMs }) as Promise<SolveResult>;
  }
}

export const solver = new SolverClient();
