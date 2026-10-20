// Solve history in IndexedDB; settings in localStorage. Every access is
// guarded: private windows and blocked storage must not break the game.

import type { SolveRecord } from "./stats";

const DB = "u3";
const STORE = "solves";
let dbp: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore(STORE, { keyPath: "id" });
        s.createIndex("date", "date");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

const memory: SolveRecord[] = [];

export async function saveSolve(r: SolveRecord) {
  const d = await db();
  if (!d) return void memory.push(r);
  await new Promise<void>((res) => {
    const tx = d.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(r);
    tx.oncomplete = () => res();
    tx.onerror = () => res();
  });
}

export async function allSolves(): Promise<SolveRecord[]> {
  const d = await db();
  if (!d) return memory.slice();
  return new Promise((res) => {
    const req = d.transaction(STORE).objectStore(STORE).getAll();
    req.onsuccess = () => res((req.result as SolveRecord[]).sort((a, b) => a.date - b.date));
    req.onerror = () => res([]);
  });
}

export async function deleteSolve(id: string) {
  const d = await db();
  if (!d) {
    const i = memory.findIndex((r) => r.id === id);
    if (i >= 0) memory.splice(i, 1);
    return;
  }
  await new Promise<void>((res) => {
    const tx = d.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => res();
    tx.onerror = () => res();
  });
}

export async function importSolves(rs: SolveRecord[]) {
  for (const r of rs) if (r && typeof r.id === "string" && typeof r.timeMs === "number") await saveSolve(r);
}

export interface Settings {
  inspection: "expert" | "always" | "never";
  turnMs: number;
  glyphs: boolean;
  theme: "system" | "light" | "dark";
  showNotation: boolean;
  background: "auto" | "navy" | "midnight" | "ocean" | "forest" | "sunset" | "paper" | "custom";
  customBg: string;
  palette: "classic" | "vivid" | "pastel" | "contrast";
  body: "black" | "white" | "stickerless";
  arrows: boolean;
  highlight: boolean;
  haptics: boolean;
}

const DEFAULTS: Settings = {
  inspection: "expert", turnMs: 110, glyphs: false, theme: "light", showNotation: true,
  background: "auto", customBg: "#1d2a44", palette: "classic", body: "black",
  arrows: false, highlight: true, haptics: true,
};

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("u3.settings") ?? "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export function storeSettings(s: Settings) {
  try {
    localStorage.setItem("u3.settings", JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this visit only */
  }
}

export function loadPref(key: string): string | null {
  try {
    return localStorage.getItem(`u3.${key}`);
  } catch {
    return null;
  }
}

export function storePref(key: string, v: string) {
  try {
    localStorage.setItem(`u3.${key}`, v);
  } catch {
    /* ignore */
  }
}
