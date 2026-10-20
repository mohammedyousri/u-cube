// Optional on-screen arrows, for players who prefer tapping to dragging:
//  · four arrows around the cube rotate the whole cube (to reach the back faces);
//  · tap a face and two curved arrows appear on it to turn it either way.
// The chosen face stays softly lit until you tap empty space.

import type { Token } from "../core/notation";
import type { Stage } from "../render/scene";

const FACE_OF: Record<string, string> = { "0,1": "R", "0,-1": "L", "1,1": "U", "1,-1": "D", "2,1": "F", "2,-1": "B" };
const FACE_NAME: Record<string, string> = { U: "top", D: "bottom", R: "right", L: "left", F: "front", B: "back" };

const chevron = (rot: number) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(${rot}deg)"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
// Circular arrows: an open circle with the arrowhead at the top, pointing the way the face turns.
const curved = (cw: boolean) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" style="${cw ? "" : "transform:scaleX(-1)"}"><path d="M20 12a8 8 0 1 1-2.6-5.9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M20.5 3.5v4.4h-4.4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export class Arrows {
  private el: HTMLElement;
  private face: { axis: number; sign: number; letter: string } | null = null;
  private enabled = false;
  private lastIds = "";

  constructor(
    host: HTMLElement,
    private stage: Stage,
    private hooks: { turn: (t: Token) => void; rotate: (t: Token) => void; active: () => boolean },
  ) {
    this.el = document.createElement("div");
    this.el.className = "arrows";
    this.el.hidden = true;
    this.el.innerHTML = `
      <button class="nav-arrow" data-rot="y" aria-label="Rotate the cube to the left">${chevron(0)}</button>
      <button class="nav-arrow" data-rot="y'" aria-label="Rotate the cube to the right">${chevron(180)}</button>
      <button class="nav-arrow" data-rot="x" aria-label="Tip the cube up">${chevron(90)}</button>
      <button class="nav-arrow" data-rot="x'" aria-label="Tip the cube down">${chevron(-90)}</button>
      <button class="turn-arrow" data-turn="-1" hidden>${curved(false)}</button>
      <button class="turn-arrow" data-turn="1" hidden>${curved(true)}</button>`;
    host.appendChild(this.el);
    this.el.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!b || !this.hooks.active()) return;
      if (b.dataset.rot) {
        const r = b.dataset.rot;
        this.select(null);
        this.hooks.rotate({ base: r[0], amount: r.endsWith("'") ? -1 : 1 });
      } else if (b.dataset.turn && this.face) {
        this.hooks.turn({ base: this.face.letter, amount: b.dataset.turn === "1" ? 1 : -1 });
      }
    });
    stage.onFrame(() => this.update());
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.el.hidden = !on;
    this.stage.setArrowRoom(on ? 50 : 0);
    if (!on) this.select(null);
  }

  /** Choose the face whose turn arrows are shown (null = none). */
  select(face: { axis: number; sign: number } | null) {
    if (!this.enabled || !face) {
      this.face = null;
      this.lastIds = "";
      this.stage.cube.select([]);
      for (const b of this.el.querySelectorAll<HTMLElement>(".turn-arrow")) b.hidden = true;
      return;
    }
    const letter = FACE_OF[`${face.axis},${face.sign}`];
    this.face = { ...face, letter };
    for (const b of this.el.querySelectorAll<HTMLButtonElement>(".turn-arrow")) {
      b.hidden = false;
      const cw = b.dataset.turn === "1";
      b.setAttribute("aria-label", `Turn the ${FACE_NAME[letter]} face ${cw ? "clockwise" : "counter-clockwise"} (${letter}${cw ? "" : "′"})`);
    }
    this.lastIds = "";
    this.update();
  }

  private update() {
    if (!this.enabled) return;
    const active = this.hooks.active();
    this.el.classList.toggle("inactive", !active);
    const c = this.stage.cubeOnScreen();
    const vw = window.innerWidth;
    const clampX = (x: number) => Math.max(30, Math.min(vw - 30, x));
    // the cube's silhouette spans about ±0.8 of its bounding-sphere radius
    const gap = c.r * 0.8 + 30;
    const pos: Record<string, [number, number]> = {
      y: [clampX(c.x - gap), c.y],
      "y'": [clampX(c.x + gap), c.y],
      x: [c.x, c.y - c.r * 0.8 - 26],
      "x'": [c.x, c.y + c.r * 0.8 + 26],
    };
    for (const b of this.el.querySelectorAll<HTMLElement>(".nav-arrow")) {
      const [x, y] = pos[b.dataset.rot!];
      b.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    }
    if (!this.face) return;
    if (!active) return this.select(null);
    const n = [0, 0, 0];
    n[this.face.axis] = this.face.sign * 1.52;
    const s = this.stage.screenOf(n[0], n[1], n[2]);
    if (!s.visible) return this.select(null);
    const offset = Math.max(30, c.r * 0.2);
    this.el.querySelectorAll<HTMLElement>(".turn-arrow").forEach((b) => {
      const dx = b.dataset.turn === "1" ? offset : -offset;
      b.style.transform = `translate(${s.x + dx}px, ${s.y}px) translate(-50%, -50%)`;
    });
    if (!this.stage.cube.busy) {
      const ids = this.stage.cube.faceIds(this.face.axis, this.face.sign);
      const key = ids.join(",");
      if (key !== this.lastIds) {
        this.lastIds = key;
        this.stage.cube.select(ids);
      }
    }
  }
}
