import "./style.css";
import { applyAlg, facelets, solvedState } from "./core/cube";
import { FACELET_NORMAL, FACELET_POS } from "./core/geometry";
import { Vector3 } from "three";
import { formatToken, type LayerMove, fromLayerMove } from "./core/notation";
import { Stage, perf } from "./render/scene";
import { Game, type Status } from "./game/session";
import { PointerInput } from "./input/pointer";
import { KEY_HELP, keyToToken } from "./input/keyboard";
import { solver } from "./solver/client";
import { LEVELS, type LevelId } from "./solver/scramble";
import { allSolves, deleteSolve, importSolves, loadPref, loadSettings, storePref, storeSettings, type Settings } from "./game/storage";
import { averageOf, bestSingle, formatResult, formatTime, type SolveRecord } from "./game/stats";
import { STAGES } from "./game/stages";
import { Replay, decodeShare, encodeShare, tpsSeries, type ReplayRecord } from "./game/replay";
import { ICONS } from "./ui/icons";
import { netSvg } from "./ui/net";
import { openScanner } from "./scan/scanner";
import { GhostRun } from "./game/ghost";
import { BACKGROUNDS, applyAppearance } from "./ui/appearance";
import { Arrows } from "./ui/arrows";
import { logoSvg } from "./ui/logo";
import { openAbout } from "./ui/about";
import { PALETTES } from "./render/cubeView";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pretty = (alg: string) => alg.replace(/'/g, "′");

// ---- settings & theme -----------------------------------------------------------
let settings: Settings = loadSettings();
function applySettings() {
  applyAppearance(settings, stage);
  stage.cube.turnMs = settings.turnMs;
  stage.cube.setGlyphs(settings.glyphs);
  stage.cube.highlight = settings.highlight;
  arrows?.setEnabled(settings.arrows);
  stage.invalidate();
  storeSettings(settings);
}

function haptic() {
  if (settings.haptics) navigator.vibrate?.(8);
}

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const stage = new Stage($("#stage"));
stage.cube.reducedMotion = reduceMotion.matches;
reduceMotion.addEventListener("change", () => (stage.cube.reducedMotion = reduceMotion.matches));
const game = new Game(stage, () => settings);
let arrows: Arrows | null = null;
applySettings();
arrows = new Arrows($("#app"), stage, {
  active: () => game.acceptsMoves,
  turn: (t) => {
    game.commit(t);
    haptic();
  },
  rotate: (t) => {
    game.commit(t);
    haptic();
  },
});
arrows.setEnabled(settings.arrows);
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyAppearance(settings, stage));

const savedLevel = loadPref("level") as LevelId | null;
if (savedLevel && LEVELS.some((l) => l.id === savedLevel)) game.level = savedLevel;

let solverReady = false;
solver.ready.then(() => {
  solverReady = true;
  solver.prefetch(game.level);
  renderStatus();
});

// ---- top bar ----------------------------------------------------------------------
const brand = $<HTMLButtonElement>("#brand");
brand.innerHTML =
  logoSvg({ id: "brand", onPage: true, title: "U.CUBE" }) +
  `<span class="brand-word" aria-hidden="true"><b class="u">U</b><span class="dot">.</span>CUBE</span>`;
brand.onclick = () => {
  closePanel();
  openAbout($("#about"), () => brand.focus());
};

for (const btn of document.querySelectorAll<HTMLButtonElement>(".top-actions [data-action]"))
  btn.innerHTML = ICONS[btn.dataset.action as keyof typeof ICONS];

const levelsNav = $("nav.levels");
levelsNav.innerHTML = LEVELS.map(
  (l) => `<button class="level" role="radio" data-level="${l.id}" aria-label="${l.label}, ${l.blurb}" aria-checked="false">${l.label}</button>`,
).join("");
levelsNav.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-level]");
  if (!b) return;
  const id = b.dataset.level as LevelId;
  storePref("level", id);
  closeResult();
  if (replay) exitReplay();
  dropGhost();
  void game.newSolve(id);
});
function renderLevels() {
  for (const b of levelsNav.querySelectorAll<HTMLButtonElement>("[data-level]"))
    b.setAttribute("aria-checked", String(b.dataset.level === game.level));
}

document.querySelector(".top-actions")!.addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-action]")?.dataset.action;
  if (a === "stats") void openPanel("stats");
  if (a === "settings") void openPanel("settings");
  if (a === "help") void openPanel("help");
  if (a === "scan") startScan();
});

// ---- HUD --------------------------------------------------------------------------
const timerEl = $("#timer");
const statusEl = $("#status-line");
const metaEl = $("#meta");
const scrambleEl = $<HTMLElement>(".scramble");

$("#actions").addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-action]")?.dataset.action;
  if (a === "new") newScramble();
  if (a === "undo") game.undo();
  if (a === "hint") void hint();
});

function newScramble() {
  closeResult();
  if (replay) exitReplay();
  dropGhost();
  void game.newSolve(game.level);
}

async function hint() {
  try {
    const t = await game.requestHint();
    if (!t) return;
  } catch (e) {
    toast((e as Error).message);
  }
}

const STATUS_TEXT: Record<Status, string> = {
  idle: window.matchMedia("(pointer: coarse)").matches
    ? "Tap <b>New scramble</b> to start · drag a sticker to turn · drag outside the cube to look around"
    : "Press <kbd>Space</kbd> for a scramble · drag a sticker to turn · drag outside to look around",
  loading: "Preparing scramble…",
  scrambling: "Scrambling…",
  inspecting: "Inspection · your first turn starts the timer",
  ready: "Timer starts on your first turn",
  solving: "",
  solved: "Solved",
  replay: "Replay",
};

function renderStatus() {
  renderLevels();
  let text = STATUS_TEXT[game.status];
  if (game.status === "loading" && !solverReady) text = "Warming up the solver…";
  if (game.status === "solving") {
    const n = game.tracker.current;
    text = n > 0 ? STAGES.slice(0, n).map((s) => `${s} ✓`).join("  ") : "";
  }
  statusEl.innerHTML = text;

  const s = game.scramble;
  const showScramble = !!s && game.status !== "idle" && game.status !== "replay";
  scrambleEl.hidden = !showScramble;
  if (s && showScramble) {
    $("#scramble-alg").textContent = settings.showNotation ? pretty(s.alg) : "";
    $("#distance-badge").textContent = distanceText(s.optimal, s.lower, s.upper);
  }
  const busy = game.status === "loading" || game.status === "scrambling" || game.status === "replay";
  ($('[data-action="new"]') as HTMLButtonElement).disabled = game.status === "loading";
  ($('[data-action="hint"]') as HTMLButtonElement).disabled = busy;
  ($('[data-action="undo"]') as HTMLButtonElement).disabled = busy;
  $("#actions").hidden = game.status === "replay";
  renderMeta();
  renderTimer();
}

function distanceText(optimal: number | null, lower: number, upper: number) {
  if (optimal !== null) return `Solvable in ${optimal}`;
  if (lower >= 11) return `Solvable in ${lower}–${upper}`;
  return `Solvable in ≤ ${upper}`;
}

function renderMeta() {
  const parts: string[] = [];
  if (game.status === "solving" || game.status === "solved" || game.status === "inspecting" || game.status === "ready") {
    parts.push(`Moves <b>${game.htm}</b>`);
    const secs = game.elapsed() / 1000;
    if (secs > 0.5) parts.push(`TPS <b>${(game.stm / secs).toFixed(1)}</b>`);
    if (game.hints) parts.push(`Hints <b>${game.hints}</b>`);
  }
  metaEl.innerHTML = parts.map((p) => `<span>${p}</span>`).join("");
}

function renderTimer() {
  timerEl.className = "timer";
  if (game.status === "inspecting") {
    const ms = game.inspectionElapsed();
    const left = 15 - Math.floor(ms / 1000);
    timerEl.textContent = ms > 17000 ? "DNF" : ms > 15000 ? "+2" : String(left);
    timerEl.classList.add(ms > 17000 ? "bad" : ms > 15000 || left <= 3 ? "warn" : "inspecting");
    return;
  }
  if (game.status === "solved") {
    timerEl.textContent = game.last ? formatResult(game.last) : formatTime(game.elapsed());
    timerEl.classList.add("solved");
    return;
  }
  if (game.status === "replay" && replay) {
    timerEl.textContent = formatTime(Math.max(0, replay.playhead));
    return;
  }
  timerEl.textContent = formatTime(game.elapsed());
}

stage.onFrame((dt) => {
  if (game.status === "solving" || game.status === "inspecting") {
    renderTimer();
    renderMeta();
  }
  replay?.tick(dt);
});

game.on((why) => {
  if (why.startsWith("error:")) toast(why.slice(6));
  if (why === "hint" && game.hint) {
    statusEl.innerHTML = `<span class="hint-chip">Next: ${pretty(formatToken(game.hint))}</span>`;
  }
  if (why === "move") {
    renderMeta();
    if (game.status === "solving" || statusEl.querySelector(".hint-chip")) renderStatus();
  }
  if (why === "status") renderStatus();
  if (why === "solved") {
    renderStatus();
    showResult(game.last!);
  }
});

// ---- input --------------------------------------------------------------------------
new PointerInput(stage, $("#stage"), {
  canTurn: () => game.acceptsMoves,
  commit: (m: LayerMove, pointerType: string) => {
    const t = fromLayerMove(m);
    if (t) game.commit(t, { animate: false });
    if (pointerType === "touch") haptic();
  },
  onTap: (face) => arrows?.select(face),
});

window.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement;
  if (target.closest("input, textarea, select, [contenteditable]")) return;
  if (e.key === "Escape") {
    if (!$("#scan").hidden || !$("#about").hidden) return;
    if (!$("#panel").hidden) return closePanel();
    if (replay) return exitReplay();
    if (!$("#result").hidden) return closeResult();
    game.abandon();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    game.undo();
    return;
  }
  if (!$("#panel").hidden || !$("#scan").hidden || !$("#about").hidden) return;
  if (e.key === " ") {
    e.preventDefault();
    if (replay) return replay.playing ? replay.pause() : replay.play();
    if (game.status !== "solving") newScramble();
    return;
  }
  if (e.key === "?") return void openPanel("help");
  const t = keyToToken(e);
  if (t && !e.repeat) {
    e.preventDefault();
    if (target.tagName === "BUTTON") target.blur();
    game.commit(t);
  }
});

// ---- result card --------------------------------------------------------------------
const resultEl = $("#result");
function closeResult() {
  if (resultEl.hidden) return;
  resultEl.hidden = true;
  document.body.classList.remove("result-open");
  $(".hud").hidden = false;
  requestAnimationFrame(updateSafeArea);
}

function verdict(r: SolveRecord) {
  if (r.optimal !== null) {
    const extra = r.htm - r.optimal;
    if (extra <= 0) return `Perfect: you found an optimal ${r.optimal}-move solution.`;
    return `${r.htm} moves; the shortest solution was ${r.optimal} (${extra} extra).`;
  }
  return `${r.htm} moves. This position needed between ${r.lower || "?"} and ${r.upper} moves.`;
}

function ghostVerdict(r: SolveRecord) {
  if (!ghost || r.penalty === "DNF") return "";
  const mine = r.timeMs + Number(r.penalty || 0);
  const theirs = ghost.rec.timeMs;
  const d = Math.abs(mine - theirs) / 1000;
  return mine < theirs ? `<br><b>You beat your ghost by ${d.toFixed(2)} s.</b>` : `<br>Your ghost was ${d.toFixed(2)} s faster.`;
}

/** CFOP splits only mean something on full scrambles that started without a cross. */
function splitsMeaningful(r: Pick<SolveRecord, "level" | "splits">) {
  return (r.level === "hard" || r.level === "expert") && r.splits[0] !== null && r.splits[0] > 0;
}

function showResult(r: SolveRecord) {
  const secs = r.timeMs / 1000;
  const splits = r.splits;
  const segs: string[] = [];
  const legend: string[] = [];
  const colors = ["var(--stage-cross)", "var(--stage-f2l)", "var(--stage-oll)", "var(--stage-pll)"];
  let prev = 0;
  splits.forEach((t, i) => {
    const dur = t === null ? null : t - prev;
    if (t !== null) prev = t;
    if (dur !== null && r.timeMs > 0) segs.push(`<span style="width:${(dur / r.timeMs) * 100}%;background:${colors[i]}"></span>`);
    legend.push(`<div><i style="background:${colors[i]}"></i>${STAGES[i]}<b>${dur === null ? "—" : formatTime(dur)}</b></div>`);
  });
  resultEl.className = "result card";
  resultEl.innerHTML = `
    <div class="result-top">
      <div>
        <h2 id="result-title">${LEVELS.find((l) => l.id === r.level)?.label ?? ""} · Solved</h2>
        <div class="big">${formatResult(r)}</div>
      </div>
      <dl class="kv">
        <dt>Moves</dt><dd>${r.htm}${r.optimal !== null ? ` <span style="color:var(--muted);font-weight:500">/ ${r.optimal} optimal</span>` : ""}</dd>
        <dt>Turns per second</dt><dd>${secs >= 0.5 ? (r.stm / secs).toFixed(2) : "—"}</dd>
        ${r.inspectionMs !== null ? `<dt>Inspection</dt><dd>${(r.inspectionMs / 1000).toFixed(1)} s${r.penalty === 2000 ? " (+2)" : r.penalty === "DNF" ? " (DNF)" : ""}</dd>` : ""}
        ${r.hints ? `<dt>Hints used</dt><dd>${r.hints}</dd>` : ""}
      </dl>
    </div>
    <div class="verdict">${verdict(r)}${ghostVerdict(r)}</div>
    ${splitsMeaningful(r) ? `<div class="splits" aria-hidden="true">${segs.join("")}</div><div class="split-legend">${legend.join("")}</div>` : ""}
    <div class="result-btns">
      <button class="btn" data-r="replay">Replay</button>
      <button class="btn" data-r="race">Race ghost</button>
      <button class="btn" data-r="share">Share</button>
      <button class="btn primary" data-r="next">Next scramble</button>
    </div>`;
  resultEl.hidden = false;
  document.body.classList.add("result-open");
  $(".hud").hidden = true;
  requestAnimationFrame(updateSafeArea);
  resultEl.querySelector<HTMLButtonElement>('[data-r="next"]')!.focus({ preventScroll: true });
  resultEl.onclick = (e) => {
    const a = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-r]")?.dataset.r;
    if (a === "next") newScramble();
    if (a === "replay") startReplay(r);
    if (a === "race") void race(r);
    if (a === "share") void share(r);
  };
}

async function share(r: ReplayRecord) {
  const url = `${location.origin}${location.pathname}#replay=${encodeShare(r)}`;
  try {
    await navigator.clipboard.writeText(url);
    toast("Replay link copied");
  } catch {
    prompt("Copy this link", url);
  }
}

// ---- ghost racing -----------------------------------------------------------------
let ghost: GhostRun | null = null;
const ghostLabel = $("#ghost-label");

function dropGhost() {
  ghost = null;
  stage.showGhost(false);
  ghostLabel.hidden = true;
}

/** Retry a scramble against the best earlier attempt at it (or the given record). */
async function race(rec: ReplayRecord) {
  closeResult();
  if (replay) exitReplay();
  const same = (await allSolves()).filter((r) => r.scramble === rec.scramble && r.penalty !== "DNF");
  const best = [rec, ...same].sort((a, b) => a.timeMs + Number(a.penalty || 0) - (b.timeMs + Number(b.penalty || 0)))[0];
  await game.newSolve(rec.level, {
    level: rec.level, alg: rec.scramble, optimal: rec.optimal, lower: rec.lower, upper: rec.upper, solution: "",
  });
  ghost = new GhostRun(stage.showGhost(true)!, best);
  ghostLabel.innerHTML = `Ghost <b>${formatTime(best.timeMs)}</b>`;
  ghostLabel.hidden = false;
}

stage.onFrame(() => {
  if (!ghost) return;
  ghost.tick();
  if (game.status === "solving" || game.status === "solved")
    ghostLabel.innerHTML = ghost.finished ? `Ghost finished <b>${formatTime(ghost.rec.timeMs)}</b>` : `Ghost <b>${formatTime(ghost.elapsed())}</b>`;
});

game.on((why) => {
  if (!ghost) return;
  if (why === "status" && game.status === "solving") ghost.go(game.timerStart);
  if (why === "status" && (game.status === "idle" || game.status === "replay")) dropGhost();
  if (why === "solved") ghost.stop();
});

// ---- replay -------------------------------------------------------------------------
let replay: Replay | null = null;
const replayBar = $("#replay-bar");

function startReplay(rec: ReplayRecord) {
  closeResult();
  closePanel();
  game.enterReplay();
  replay = new Replay(stage, rec);
  const series = tpsSeries(rec.moves, rec.timeMs);
  const maxTps = Math.max(4, ...series.map((p) => p.tps));
  const W = 700, H = 70;
  const x = (t: number) => ((t - replay!.t0) / (replay!.tEnd - replay!.t0)) * W;
  const y = (v: number) => H - 4 - (v / maxTps) * (H - 14);
  const line = series.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.tps).toFixed(1)}`).join("");
  const area = `${line}L${x(rec.timeMs).toFixed(1)},${H}L${x(0).toFixed(1)},${H}Z`;
  const marks: string[] = [];
  if (splitsMeaningful(rec)) {
    let lastX = -Infinity;
    let lastLabel = -1;
    rec.splits.forEach((t, i) => {
      if (t === null) return;
      const px = x(t);
      const color = `var(--stage-${["cross", "f2l", "oll", "pll"][i]})`;
      marks.push(`<line x1="${px}" x2="${px}" y1="0" y2="${H}" stroke="${color}" stroke-width="1.5" stroke-dasharray="3 3"/>`);
      // stages finished at (nearly) the same moment share one label
      if (lastLabel >= 0 && px - lastX < 60) marks[lastLabel] = marks[lastLabel].replace("</text>", ` · ${STAGES[i]}</text>`);
      else {
        lastLabel = marks.push(`<text x="${px + 4}" y="11" font-size="11" fill="var(--muted)">${STAGES[i]}</text>`) - 1;
        lastX = px;
      }
    });
  }
  replayBar.className = "replay-bar card";
  replayBar.innerHTML = `
    <div class="replay-move" id="replay-move"></div>
    <svg class="replay-graph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Turns per second over the solve, peak ${maxTps} TPS">
      <path d="${area}" fill="var(--accent-soft)"/><path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/>
      ${marks.join("")}<line id="playhead" x1="0" x2="0" y1="0" y2="${H}" stroke="var(--text)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
    </svg>
    <div class="replay-controls">
      <button class="icon-btn" id="rp-play" aria-label="Play"></button>
      <input type="range" id="rp-seek" min="${replay.t0}" max="${replay.tEnd}" step="any" value="${replay.t0}" aria-label="Replay position">
      <span class="replay-time" id="rp-time">0.00</span>
    </div>
    <div class="replay-controls">
      <div class="seg" id="rp-speed" role="group" aria-label="Playback speed">${[0.5, 1, 2, 4].map((s) => `<button aria-pressed="${s === 1}" data-s="${s}">${s}×</button>`).join("")}</div>
      <button class="btn" id="rp-race">Race ghost</button>
      <button class="icon-btn" id="rp-close" aria-label="Close replay">${ICONS.close}</button>
    </div>`;
  replayBar.hidden = false;
  requestAnimationFrame(updateSafeArea);
  const seek = $<HTMLInputElement>("#rp-seek");
  const play = $("#rp-play");
  seek.oninput = () => {
    replay!.pause();
    replay!.seek(Number(seek.value));
  };
  play.onclick = () => (replay!.playing ? replay!.pause() : replay!.play());
  $("#rp-close").onclick = exitReplay;
  $("#rp-race").onclick = () => void race(rec);
  $("#rp-speed").onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-s]");
    if (!b) return;
    replay!.speed = Number(b.dataset.s);
    for (const x of $("#rp-speed").querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
  };
  const moveEl = $("#replay-move");
  replay.onChange(() => {
    const r = replay!;
    seek.value = String(r.playhead);
    play.innerHTML = r.playing ? ICONS.pause : ICONS.play;
    play.setAttribute("aria-label", r.playing ? "Pause" : "Play");
    $("#rp-time").textContent = formatTime(Math.max(0, r.playhead));
    $("#playhead").setAttribute("x1", String(x(r.playhead)));
    $("#playhead").setAttribute("x2", String(x(r.playhead)));
    const from = Math.max(0, r.position - 8);
    moveEl.innerHTML = r.rec.moves
      .slice(from, r.position + 4)
      .map((m, i) => (from + i === r.position - 1 ? `<b style="color:var(--text)">${pretty(m.m)}</b>` : esc(pretty(m.m))))
      .join(" ");
    renderTimer();
  });
  replay.seek(replay.t0);
  renderStatus();
  setTimeout(() => replay?.play(), 400);
}

function exitReplay() {
  replay?.pause();
  replay = null;
  replayBar.hidden = true;
  requestAnimationFrame(updateSafeArea);
  stage.cube.flush();
  game.exitReplay();
  renderStatus();
}

// ---- side panel ---------------------------------------------------------------------
const panel = $("#panel");
let panelView = "";
function closePanel() {
  panel.hidden = true;
  panelView = "";
}

async function openPanel(view: "stats" | "settings" | "help") {
  if (panelView === view && !panel.hidden) return closePanel();
  panelView = view;
  const title = { stats: "Statistics", settings: "Settings", help: "How to play" }[view];
  panel.innerHTML = `<div class="panel-head"><h2 id="panel-title">${title}</h2><button class="icon-btn" data-p="close" aria-label="Close">${ICONS.close}</button></div><div class="panel-body" tabindex="0" role="region" aria-label="${title}"></div>`;
  panel.hidden = false;
  panel.querySelector<HTMLButtonElement>('[data-p="close"]')!.onclick = closePanel;
  const body = panel.querySelector<HTMLElement>(".panel-body")!;
  if (view === "stats") await renderStats(body);
  if (view === "settings") renderSettings(body);
  if (view === "help") renderHelp(body);
  panel.querySelector<HTMLButtonElement>('[data-p="close"]')!.focus();
}

async function renderStats(body: HTMLElement) {
  const all = await allSolves();
  let level: LevelId = game.level;
  const draw = () => {
    const rs = all.filter((r) => r.level === level);
    const recent = rs.slice().reverse().slice(0, 50);
    body.innerHTML = `
      <div class="seg" role="group" aria-label="Level">${LEVELS.map((l) => `<button data-l="${l.id}" aria-pressed="${l.id === level}">${l.label}</button>`).join("")}</div>
      <h3 style="margin-top:18px">Session records</h3>
      <div class="stat-grid">
        <div class="stat"><small>Best</small><b>${formatTime(bestSingle(rs))}</b></div>
        <div class="stat"><small>ao5</small><b>${formatTime(averageOf(rs, 5), "average")}</b></div>
        <div class="stat"><small>ao12</small><b>${formatTime(averageOf(rs, 12), "average")}</b></div>
        <div class="stat"><small>Solves</small><b>${rs.length}</b></div>
        <div class="stat"><small>Mean moves</small><b>${rs.length ? (rs.reduce((a, r) => a + r.htm, 0) / rs.length).toFixed(1) : "—"}</b></div>
        <div class="stat"><small>Optimal found</small><b>${rs.filter((r) => r.optimal !== null && r.htm <= r.optimal).length}</b></div>
      </div>
      <h3>History</h3>
      ${recent.length ? `<ul class="solve-list">${recent.map((r) => `
        <li><div><b>${formatResult(r)}</b><div class="sub">${r.htm} moves${r.optimal !== null ? ` · optimal ${r.optimal}` : ""}${r.hints ? ` · ${r.hints} hint${r.hints > 1 ? "s" : ""}` : ""} · ${new Date(r.date).toLocaleDateString()}</div></div>
        <button class="link-btn" data-replay="${r.id}">Replay</button><button class="link-btn" data-del="${r.id}" aria-label="Delete solve">✕</button></li>`).join("")}</ul>` : `<p>No ${LEVELS.find((l) => l.id === level)!.label} solves yet. Press <b>Space</b> to start one.</p>`}
      <h3>Data</h3>
      <div class="row-btns"><button class="btn" data-x="export">Export JSON</button><label class="btn" style="text-align:center">Import<input type="file" accept="application/json" hidden data-x="import"></label></div>`;
  };
  draw();
  body.onclick = async (e) => {
    const el = e.target as HTMLElement;
    const l = el.closest<HTMLElement>("[data-l]")?.dataset.l;
    if (l) {
      level = l as LevelId;
      draw();
    }
    const rid = el.closest<HTMLElement>("[data-replay]")?.dataset.replay;
    if (rid) startReplay(all.find((r) => r.id === rid)!);
    const del = el.closest<HTMLElement>("[data-del]")?.dataset.del;
    if (del) {
      await deleteSolve(del);
      all.splice(all.findIndex((r) => r.id === del), 1);
      draw();
    }
    if (el.closest('[data-x="export"]')) {
      const blob = new Blob([JSON.stringify(all, null, 1)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `u3-solves-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  };
  body.onchange = async (e) => {
    const input = e.target as HTMLInputElement;
    if (input.dataset.x !== "import" || !input.files?.[0]) return;
    try {
      const data = JSON.parse(await input.files[0].text());
      await importSolves(Array.isArray(data) ? data : []);
      toast("Solves imported");
      void openPanel("stats");
    } catch {
      toast("That file is not a U.CUBE export");
    }
  };
}

function renderSettings(body: HTMLElement) {
  const seg = (key: string, opts: [string, string][], val: string) =>
    `<div class="seg" data-k="${key}">${opts.map(([v, l]) => `<button data-v="${v}" aria-pressed="${v === val}">${l}</button>`).join("")}</div>`;
  const toggle = (id: string, label: string, hint: string, on: boolean) =>
    `<div class="setting switch"><div><label for="${id}">${label}</label>${hint ? `<br><small>${hint}</small>` : ""}</div><input id="${id}" type="checkbox" ${on ? "checked" : ""}></div>`;
  const locked = settings.background !== "auto";
  body.innerHTML = `
    <h3>Appearance</h3>
    <div class="setting"><label>Background</label>
      <div class="swatches" data-k="background" role="radiogroup" aria-label="Background">${(Object.keys(BACKGROUNDS) as (keyof typeof BACKGROUNDS)[]).map((k) =>
        `<button role="radio" data-v="${k}" aria-checked="${settings.background === k}" aria-label="${BACKGROUNDS[k].label}"><i style="background:${BACKGROUNDS[k].swatch}"></i><span>${BACKGROUNDS[k].label}</span></button>`).join("")}</div>
      <div class="custom-bg" ${settings.background === "custom" ? "" : "hidden"}><label for="custom-bg">Custom colour</label><input id="custom-bg" type="color" value="${settings.customBg}"><small>Text colour adjusts automatically to stay readable.</small></div>
    </div>
    <div class="setting"><label>Sticker colours</label>
      <div class="palettes" data-k="palette" role="radiogroup" aria-label="Sticker colours">${Object.entries(PALETTES).map(([k, p]) =>
        `<button role="radio" data-v="${k}" aria-checked="${settings.palette === k}"><span class="strip">${p.colors.map((c) => `<i style="background:${c}"></i>`).join("")}</span>${p.label}</button>`).join("")}</div>
    </div>
    <div class="setting"><label>Cube body</label>${seg("body", [["black", "Black"], ["white", "White"], ["stickerless", "Stickerless"]], settings.body)}</div>
    <div class="setting"><label>Theme</label>${seg("theme", [["system", "System"], ["light", "Light"], ["dark", "Dark"]], settings.theme)}
      ${locked ? `<small>The background you picked sets light or dark for contrast. Choose “Auto” background to use this.</small>` : ""}</div>
    ${toggle("glyphs", "Colour-blind symbols", "Adds a shape to every sticker.", settings.glyphs)}

    <h3>Controls</h3>
    ${toggle("arrows", "On-screen arrows", "Arrows around the cube rotate it; tap a face for arrows that turn it.", settings.arrows)}
    ${toggle("highlight", "Highlight the turning layer", "", settings.highlight)}
    ${toggle("haptics", "Vibrate on each turn", "Phones that support it.", settings.haptics)}
    <div class="setting"><label for="turn-ms">Turn speed · <span id="turn-ms-val">${settings.turnMs} ms</span></label>
      <input id="turn-ms" type="range" min="50" max="220" step="10" value="${settings.turnMs}">
      <small>Animations speed up automatically when you type faster than they play.</small></div>

    <h3>Solving</h3>
    <div class="setting"><label>Inspection (WCA, 15 s)</label>${seg("inspection", [["expert", "Expert only"], ["always", "Always"], ["never", "Never"]], settings.inspection)}
      <small>Over 15 s adds +2; over 17 s is a DNF, as in competition.</small></div>
    ${toggle("notation", "Show scramble notation", "", settings.showNotation)}`;
  body.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-v]");
    const k = b?.closest<HTMLElement>("[data-k]")?.dataset.k;
    if (!b || !k) return;
    (settings as unknown as Record<string, string>)[k] = b.dataset.v!;
    applySettings();
    renderSettings(body);
    body.querySelector<HTMLElement>(`[data-k="${k}"] [data-v="${b.dataset.v}"]`)?.focus();
  };
  body.oninput = (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === "turn-ms") {
      settings.turnMs = Number(t.value);
      $("#turn-ms-val").textContent = `${t.value} ms`;
    }
    if (t.id === "custom-bg") settings.customBg = t.value;
    if (t.id === "glyphs") settings.glyphs = t.checked;
    if (t.id === "notation") settings.showNotation = t.checked;
    if (t.id === "arrows") settings.arrows = t.checked;
    if (t.id === "highlight") settings.highlight = t.checked;
    if (t.id === "haptics") settings.haptics = t.checked;
    applySettings();
    renderStatus();
  };
}

function renderHelp(body: HTMLElement) {
  body.innerHTML = `
    <h3>Turning</h3>
    <p><b>Drag a sticker</b> and the layer under your finger turns with it. Let go and it snaps to the nearest quarter turn; a quick flick carries it further. Dragging a center sticker turns the middle slice.</p>
    <p><b>Drag empty space</b> (or use two fingers) to look around. Double-tap empty space to reset the view.</p>
    <p><b>Prefer tapping?</b> Turn on <b>On-screen arrows</b> in Settings: arrows beside the cube rotate it, and tapping a face shows two arrows that turn that face.</p>
    <h3>Difficulty is distance</h3>
    <p>Every cube position can be solved in 20 moves or fewer. U.CUBE grades scrambles by how many moves the <b>shortest</b> solution needs, not by how long the scramble is:</p>
    <ul>${LEVELS.map((l) => `<li><b>${l.label}</b>: ${l.blurb}</li>`).join("")}</ul>
    <p>Up to 10 moves the distance is proven exactly, so you can try to match the optimal solution.</p>
    <h3>Timing</h3>
    <p>The timer starts on your first turn and stops when the cube is solved. Expert uses WCA inspection: 15 seconds to study the cube, +2 after that, DNF after 17. Each solve is split into Cross, F2L, OLL and PLL when you solve that way.</p>
    <h3>Keyboard</h3>
    <div class="keys">${KEY_HELP.map(([k, m]) => `<kbd>${k}</kbd><span>${m}</span>`).join("")}
      <kbd>Space</kbd><span>New scramble · play/pause replay</span><kbd>Ctrl Z</kbd><span>Undo</span><kbd>Esc</kbd><span>Close / stop</span></div>
    <h3>Why “U.CUBE”</h3>
    <p>U is the top face in cube notation, and U³ (three quarter turns of the top) is the same move as U′. Say “U-cubed” out loud and you hear the name of its maker, Yousri.</p>`;
}

// ---- toast --------------------------------------------------------------------------
let toastTimer = 0;
function toast(msg: string) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), 2600);
}

// ---- scanner ------------------------------------------------------------------------
function startScan() {
  closeResult();
  closePanel();
  if (replay) exitReplay();
  game.reset();
  openScanner($("#scan"), { stage, game, toast, netSvg });
}

// ---- shared replay links ------------------------------------------------------------
function openFromHash() {
  const m = location.hash.match(/replay=([A-Za-z0-9_-]+)/);
  if (!m) return;
  const rec = decodeShare(m[1]);
  if (rec) startReplay(rec);
  else toast("That replay link is damaged");
}
window.addEventListener("hashchange", openFromHash);
openFromHash();

// Keep the cube framed between the top bar / scramble and the HUD.
const landscapePhone = window.matchMedia("(max-height: 520px) and (orientation: landscape)");
function updateSafeArea() {
  if (document.body.classList.contains("scanning")) return; // the scanner frames the cube itself
  // the scramble sits right under the header, whatever height the header wrapped to
  const headerBottom = $(".top").getBoundingClientRect().bottom;
  scrambleEl.style.top = `${headerBottom + 4}px`;
  const top = Math.max(headerBottom, scrambleEl.hidden ? 0 : scrambleEl.getBoundingClientRect().bottom);
  const hud = !$("#replay-bar").hidden ? $("#replay-bar") : !resultEl.hidden ? resultEl : $(".hud");
  const box = hud.getBoundingClientRect();
  if (landscapePhone.matches && hud !== $("#replay-bar")) {
    // landscape phone: the HUD / result card is a column on the right; keep the cube to its left
    stage.setSafeArea(top + 8, 12, window.innerWidth - box.left + 8);
    return;
  }
  stage.setSafeArea(top + 12, window.innerHeight - box.top + 12);
}
landscapePhone.addEventListener("change", () => requestAnimationFrame(updateSafeArea));
new ResizeObserver(updateSafeArea).observe(document.body);
game.on(() => requestAnimationFrame(updateSafeArea));

renderStatus();
updateSafeArea();

// Installable, offline-capable app (production builds only, so development never serves stale files).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("./sw.js").catch(() => undefined));
}

// Debug and test hooks.
Object.assign(window, {
  __u3: {
    game, stage, perf,
    facelets: () => facelets(game.state),
    shareCode: encodeShare,
    expected: (alg: string) => facelets(applyAlg(solvedState(), alg)),
    /** Screen position (client px) of a sticker's center on the cube as currently shown. */
    stickerScreen(i: number, along: [number, number, number] = [0, 0, 0]) {
      const p = FACELET_POS[i], n = FACELET_NORMAL[i];
      const v = new Vector3(p[0] + n[0] * 0.5 + along[0], p[1] + n[1] * 0.5 + along[1], p[2] + n[2] * 0.5 + along[2]);
      stage.cube.root.localToWorld(v).project(stage.camera);
      const r = $("#stage").getBoundingClientRect();
      return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
    },
  },
});
