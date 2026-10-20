// Scan a real cube with the camera (or enter its colours by hand), check that
// the result is a cube that can exist, solve it, and walk the player through
// the solution one turn at a time on a 3D copy held the same way.

import { applyTokens } from "../core/cube";
import { cubieFromFacelets, unsolvableReason, InvalidCubeError } from "../core/cubie";
import { FACE_NAMES } from "../core/geometry";
import { formatToken, parseAlg, toLayerMove, type Token } from "../core/notation";
import type { Game } from "../game/session";
import { FACE_COLORS } from "../render/cubeView";
import type { Stage } from "../render/scene";
import { solver } from "../solver/client";
import { ICONS } from "../ui/icons";
import { CAPTURE_STEPS, describeMove, stateFromFacelets } from "./assemble";
import { classify, colorName, robustColor, type RGB } from "./color";

interface Deps {
  stage: Stage;
  game: Game;
  toast: (m: string) => void;
  netSvg: (f: string, o?: { size?: number; selected?: number; interactive?: boolean }) => string;
}

const STANDARD_NAMES = ["white", "red", "green", "yellow", "orange", "blue"];
const pretty = (s: string) => s.replace(/'/g, "′");

export function openScanner(root: HTMLElement, deps: Deps) {
  const { stage, game, toast, netSvg } = deps;
  let stream: MediaStream | null = null;
  let liveTimer = 0;
  let mirrored = false;
  const samples: (RGB | null)[] = new Array(54).fill(null);
  let step = 0;
  let letters = "";
  let confidence: number[] = new Array(54).fill(1);
  let colorNames = STANDARD_NAMES.slice();
  let selected = -1;
  let manual = false;
  let cleanup: (() => void)[] = [];

  root.hidden = false;
  root.className = "scan";
  document.body.classList.add("scanning");

  function close() {
    stopCamera();
    for (const c of cleanup) c();
    cleanup = [];
    root.hidden = true;
    root.innerHTML = "";
    root.classList.remove("solution-mode");
    document.body.classList.remove("scanning");
    game.reset();
  }

  function stopCamera() {
    clearInterval(liveTimer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  function shell(title: string, body: string, opts: { back?: boolean } = {}) {
    root.innerHTML = `
      <header class="scan-head">
        ${opts.back ? `<button class="icon-btn" data-s="back" aria-label="Back">${ICONS.back}</button>` : ""}
        <h2 id="scan-title">${title}</h2>
        <button class="icon-btn" data-s="close" aria-label="Close scanner">${ICONS.close}</button>
      </header>
      <div class="scan-body">${body}</div>`;
    root.querySelector<HTMLButtonElement>('[data-s="close"]')!.onclick = close;
  }

  // ---- 1. intro --------------------------------------------------------------------
  function intro() {
    shell(
      "Scan your cube",
      `<div class="scan-intro">
        <p class="lead">Show each face of your real cube to the camera. U.CUBE reads the colours, checks the cube could really exist, and then guides you to solved one turn at a time.</p>
        <ol class="scan-tips">
          <li>Use even light; avoid strong reflections on the stickers.</li>
          <li>Fill the guide with one face, held straight.</li>
          <li>Photos never leave your device.</li>
        </ol>
        <div class="row-btns">
          <button class="btn primary" data-s="camera">Use camera</button>
          <button class="btn" data-s="manual">Enter colours by hand</button>
        </div>
      </div>`,
    );
    root.querySelector<HTMLButtonElement>('[data-s="camera"]')!.onclick = () => void startCamera();
    root.querySelector<HTMLButtonElement>('[data-s="manual"]')!.onclick = startManual;
  }

  // ---- 2. camera capture -----------------------------------------------------------
  async function startCamera() {
    manual = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      toast("This browser can't open the camera here. Enter the colours by hand instead.");
      return startManual();
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
    } catch {
      toast("Camera unavailable or blocked. You can enter the colours by hand.");
      return startManual();
    }
    const facing = stream.getVideoTracks()[0]?.getSettings().facingMode;
    mirrored = facing !== "environment";
    step = 0;
    captureView();
  }

  function captureView() {
    const s = CAPTURE_STEPS[step];
    shell(
      `Scan ${step + 1} of 6 · ${s.title}`,
      `<div class="cam">
         <video playsinline muted autoplay ${mirrored ? 'class="mirror"' : ""}></video>
         <div class="cam-guide"><div class="cam-grid">${Array.from({ length: 9 }, (_, i) => `<span data-cell="${i}"></span>`).join("")}</div></div>
       </div>
       <div class="cam-panel">
         <p class="cam-how">${s.how}</p>
         <div class="cam-row">
           <div class="cam-net">${netSvg(progressLetters(), { size: 9 })}</div>
           <button class="btn primary cam-shoot" data-s="shoot">Capture ${s.title.toLowerCase()}</button>
         </div>
         <button class="link-btn" data-s="manual">Enter colours by hand instead</button>
       </div>`,
      { back: step > 0 },
    );
    const video = root.querySelector("video")!;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
    root.querySelector<HTMLButtonElement>('[data-s="shoot"]')!.onclick = () => shoot(video);
    root.querySelector<HTMLButtonElement>('[data-s="manual"]')!.onclick = () => {
      stopCamera();
      startManual();
    };
    root.querySelector<HTMLButtonElement>('[data-s="back"]')?.addEventListener("click", () => {
      step--;
      captureView();
    });
    clearInterval(liveTimer);
    liveTimer = window.setInterval(() => {
      const cells = sampleFace(video);
      if (!cells) return;
      root.querySelectorAll<HTMLElement>("[data-cell]").forEach((el, i) => {
        const [r, g, b] = cells[displayToRaw(i)];
        el.style.setProperty("--dot", `rgb(${r},${g},${b})`);
      });
    }, 140);
  }

  // Cell i as displayed → cell in the raw (unmirrored) camera frame.
  const displayToRaw = (i: number) => (mirrored ? Math.floor(i / 3) * 3 + (2 - (i % 3)) : i);

  function progressLetters() {
    let out = "";
    for (let i = 0; i < 54; i++) {
      const face = Math.floor(i / 9);
      const done = CAPTURE_STEPS.findIndex((c) => c.face === face) < step;
      out += done ? FACE_NAMES[face] : i % 9 === 4 ? "?" : "?";
    }
    return out;
  }

  const work = document.createElement("canvas");
  /** Median colour of the central part of each of the 9 cells inside the guide (raw frame coordinates). */
  function sampleFace(video: HTMLVideoElement): RGB[] | null {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const guide = root.querySelector<HTMLElement>(".cam-grid")!.getBoundingClientRect();
    const box = video.getBoundingClientRect();
    // object-fit: cover mapping from screen to video pixels
    const scale = Math.max(box.width / vw, box.height / vh);
    const ox = (box.width - vw * scale) / 2, oy = (box.height - vh * scale) / 2;
    let gx = (guide.left - box.left - ox) / scale;
    const gy = (guide.top - box.top - oy) / scale;
    const gs = guide.width / scale;
    if (mirrored) gx = vw - gx - gs;
    const N = 180;
    work.width = work.height = N;
    const g = work.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(video, gx, gy, gs, gs, 0, 0, N, N);
    const data = g.getImageData(0, 0, N, N).data;
    const cell = N / 3;
    const out: RGB[] = [];
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) {
        const x0 = Math.round(c * cell + cell * 0.28), x1 = Math.round((c + 1) * cell - cell * 0.28);
        const y0 = Math.round(r * cell + cell * 0.28), y1 = Math.round((r + 1) * cell - cell * 0.28);
        const px: number[] = [];
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            const k = (y * N + x) * 4;
            px.push(data[k], data[k + 1], data[k + 2]);
          }
        out.push(robustColor(px));
      }
    return out;
  }

  function shoot(video: HTMLVideoElement) {
    const cells = sampleFace(video);
    if (!cells) return toast("The camera isn't ready yet");
    const face = CAPTURE_STEPS[step].face;
    cells.forEach((rgb, i) => (samples[face * 9 + i] = rgb));
    root.querySelector(".cam-guide")?.classList.add("flash");
    step++;
    if (step < 6) setTimeout(captureView, 160);
    else {
      stopCamera();
      const cl = classify(samples as RGB[]);
      letters = cl.labels.map((l) => FACE_NAMES[l]).join("");
      confidence = cl.confidence;
      colorNames = cl.means.map(colorName);
      selected = -1;
      review();
    }
  }

  // ---- 3. manual entry / review ------------------------------------------------------
  function startManual() {
    manual = true;
    letters = Array.from({ length: 54 }, (_, i) => (i % 9 === 4 ? FACE_NAMES[Math.floor(i / 9)] : "?")).join("");
    confidence = new Array(54).fill(1);
    colorNames = STANDARD_NAMES.slice();
    selected = 0;
    review();
  }

  function validate(): { ok: boolean; message: string } {
    const counts = new Array(6).fill(0);
    let unknown = 0;
    for (const ch of letters) {
      const f = FACE_NAMES.indexOf(ch as never);
      if (f >= 0) counts[f]++;
      else unknown++;
    }
    if (unknown) return { ok: false, message: `${unknown} sticker${unknown > 1 ? "s" : ""} still to set.` };
    const off = counts.map((n, f) => [n, f]).filter(([n]) => n !== 9);
    if (off.length)
      return { ok: false, message: off.map(([n, f]) => `${colorNames[f]}: ${n} of 9`).join(" · ") + ". Tap a sticker to fix it." };
    try {
      const why = unsolvableReason(cubieFromFacelets(letters));
      if (why) return { ok: false, message: `This can't come from a real cube: ${why}. Check the highlighted stickers.` };
    } catch (e) {
      if (e instanceof InvalidCubeError) return { ok: false, message: `This can't come from a real cube: ${e.message}. Check the highlighted stickers.` };
      throw e;
    }
    return { ok: true, message: "Looks like a real cube." };
  }

  function review() {
    const v = validate();
    const lowConf = new Set(confidence.map((c, i) => (c < 0.25 && i % 9 !== 4 ? i : -1)).filter((i) => i >= 0));
    shell(
      manual ? "Enter your cube's colours" : "Check the colours",
      `<div class="review">
        <p class="cam-how">${manual
          ? "Hold the cube with white on top and green facing you. Tap a sticker, then its colour. The net unfolds like a box: top above, bottom below, sides in a row."
          : "Compare with your cube. Tap any sticker that's wrong, then pick the right colour. Stickers the camera wasn't sure about are outlined."}</p>
        <div class="review-net" id="review-net">${netSvg(letters, { size: 30, selected, interactive: true })}</div>
        <div class="palette" role="group" aria-label="Colours">${FACE_NAMES.map((f, i) => `<button data-c="${f}" style="--c:${FACE_COLORS[i]}" aria-label="${colorNames[i]}"><span></span>${colorNames[i]}</button>`).join("")}</div>
        <p class="review-msg ${v.ok ? "ok" : "bad"}" role="status">${v.message}</p>
        <div class="row-btns">
          ${manual ? "" : `<button class="btn" data-s="rescan">Scan again</button>`}
          <button class="btn primary" data-s="solve" ${v.ok ? "" : "disabled"}>Solve it</button>
        </div>
      </div>`,
    );
    const netEl = root.querySelector<HTMLElement>("#review-net")!;
    for (const i of lowConf) netEl.querySelector(`[data-i="${i}"]`)?.classList.add("unsure");
    netEl.onclick = (e) => {
      const i = (e.target as Element).getAttribute("data-i");
      if (i === null) return;
      if (Number(i) % 9 === 4) return toast("Centers can't move; they define each face");
      selected = Number(i);
      review();
    };
    netEl.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") (e.target as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    };
    root.querySelector<HTMLElement>(".palette")!.onclick = (e) => {
      const c = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-c]")?.dataset.c;
      if (!c || selected < 0) return;
      letters = letters.slice(0, selected) + c + letters.slice(selected + 1);
      confidence[selected] = 1;
      // advance to the next unset sticker when entering by hand
      if (manual) {
        const next = letters.indexOf("?", selected + 1);
        selected = next >= 0 ? next : letters.indexOf("?");
      }
      review();
    };
    root.querySelector<HTMLButtonElement>('[data-s="rescan"]')?.addEventListener("click", () => void startCamera());
    root.querySelector<HTMLButtonElement>('[data-s="solve"]')!.onclick = () => void solveView();
  }

  // ---- 4. guided solution ----------------------------------------------------------
  async function solveView() {
    shell("Finding a solution…", `<p class="cam-how">Searching for a short solution…</p>`);
    let res: { alg: string; optimal: boolean };
    try {
      res = await solver.solve(letters, 1500);
    } catch (e) {
      toast((e as Error).message);
      return review();
    }
    const moves: Token[] = parseAlg(res.alg);
    const start = stateFromFacelets(letters);
    const stateAt = (k: number) => applyTokens(start, moves.slice(0, k));
    let i = 0;
    let demo = 0;
    game.enterReplay(); // the on-screen cube follows the guide, not the player's drags
    root.classList.add("solution-mode");
    stage.resetView();

    // The 3D cube demonstrates the current move on a loop: before → after, pause, repeat.
    const demoLoop = () => {
      clearInterval(demo);
      stage.cube.setState(stateAt(i));
      if (i >= moves.length || stage.cube.reducedMotion) return;
      const run = () => {
        stage.cube.setState(stateAt(i));
        stage.cube.enqueue(toLayerMove(moves[i]), { duration: 700 });
      };
      demo = window.setTimeout(() => {
        run();
        demo = window.setInterval(run, 2200);
      }, 450);
    };
    cleanup.push(() => {
      clearInterval(demo);
      clearTimeout(demo);
    });

    const show = () => {
      const done = i >= moves.length;
      const t = moves[i];
      shell(
        done ? (moves.length ? "Solved" : "Already solved") : `Step ${i + 1} of ${moves.length}`,
        `<div class="guide">
          ${i === 0 && !done ? `<p class="hold">Hold your cube with <b>${colorNames[2]}</b> facing you and <b>${colorNames[0]}</b> on top, and keep it that way.</p>` : ""}
          ${done
            ? `<div class="guide-move done">✓</div><p class="guide-desc">${moves.length ? `Solved in ${moves.length} moves${res.optimal ? ", the fewest possible" : ""}.` : "Your cube is already solved."}</p>`
            : `<div class="guide-move" aria-live="polite">${pretty(formatToken(t))}</div><p class="guide-desc">${describeMove(t)}</p>`}
          <div class="guide-list" aria-label="All moves">${moves.map((m, k) => `<button data-k="${k}" class="${k < i ? "past" : k === i ? "now" : ""}" aria-label="Go to step ${k + 1}">${pretty(formatToken(m))}</button>`).join("")}</div>
          <div class="row-btns">
            ${done
              ? `<button class="btn" data-s="again">Scan another</button><button class="btn primary" data-s="close2">Done</button>`
              : `<button class="btn" data-s="prev" ${i === 0 ? "disabled" : ""}>Back</button><button class="btn primary" data-s="next">Done, next</button>`}
          </div>
          ${!done ? `<p class="guide-meta">${moves.length} moves${res.optimal ? " · proven shortest" : ""} · ← → keys work too</p>` : ""}
        </div>`,
      );
      const btn = (k: string) => root.querySelector<HTMLButtonElement>(`[data-s="${k}"]`);
      btn("next")?.addEventListener("click", next);
      btn("prev")?.addEventListener("click", prev);
      btn("again")?.addEventListener("click", () => {
        clearInterval(demo);
        root.classList.remove("solution-mode");
        game.reset();
        intro();
      });
      btn("close2")?.addEventListener("click", close);
      root.querySelector<HTMLElement>(".guide-list")!.onclick = (e) => {
        const k = (e.target as HTMLElement).closest<HTMLElement>("[data-k]")?.dataset.k;
        if (k === undefined) return;
        i = Number(k);
        show();
      };
      // frame the 3D cube between the header and the guide card
      const head = root.querySelector(".scan-head")!.getBoundingClientRect();
      const card = root.querySelector(".guide")!.getBoundingClientRect();
      stage.setSafeArea(head.bottom + 8, window.innerHeight - card.top + 8);
      demoLoop();
      if (done && moves.length) stage.celebrate();
    };
    const next = () => {
      if (i < moves.length) {
        i++;
        show();
      }
    };
    const prev = () => {
      if (i > 0) {
        i--;
        show();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (root.hidden) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      }
      if (e.key === "ArrowLeft") prev();
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    cleanup.push(() => window.removeEventListener("keydown", onKey));
    show();
  }

  intro();
}
