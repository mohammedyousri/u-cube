// The 3D cube. It never owns the truth: every cubie transform is computed from
// a logical CubeState (exact integer rotations). During a turn, the turning
// layer is drawn at  rotation(axis, θ) · base  and snapped back to the exact
// state when the turn ends, so floating-point error cannot accumulate.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { POSITIONS, ROTATIONS, stickerNormals, faceOfNormal, type Vec3 } from "../core/geometry";
import { applyLayerMove, cubiePosition, solvedState, type CubeState } from "../core/cube";
import type { LayerMove } from "../core/notation";

/** Sticker palettes, URFDLB. FACE_COLORS holds the active one (mutated in place). */
export const PALETTES: Record<string, { label: string; colors: string[] }> = {
  classic: { label: "Classic", colors: ["#f5f5f2", "#c8102e", "#00a651", "#ffd400", "#ff6a13", "#0051ba"] },
  vivid: { label: "Vivid", colors: ["#ffffff", "#ff1744", "#00e676", "#ffea00", "#ff9100", "#2979ff"] },
  pastel: { label: "Pastel", colors: ["#fbfaf5", "#ef8a8a", "#86d3a2", "#f6dd84", "#f6b482", "#88aef0"] },
  contrast: { label: "High contrast", colors: ["#ffffff", "#d55e00", "#009e73", "#f0e442", "#e69f00", "#0072b2"] },
};
export const FACE_COLORS = PALETTES.classic.colors.slice(); // U R F D L B
export type BodyStyle = "black" | "white" | "stickerless";
export const FACE_GLYPHS = ["ring", "cross", "plus", "dot", "diamond", "square"] as const;

const SPACING = 1.0;
const AXIS_VECS = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

// Exact quaternions for the 24 rotations.
const ROT_QUATS = ROTATIONS.map((m) => {
  const mat = new THREE.Matrix4().set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
  return new THREE.Quaternion().setFromRotationMatrix(mat);
});

export interface TurnAnim {
  /** null = settle back without changing the state */
  move: LayerMove | null;
  axis: number;
  ids: number[];
  from: number;
  to: number;
  elapsed: number;
  duration: number;
  ease: (u: number) => number;
  onDone?: () => void;
}

const easeMagnetic = (u: number) => {
  // ease-out with a small overshoot: fast start, a magnetic snap into place
  const s = 0.9;
  const v = u - 1;
  return 1 + (s + 1) * v * v * v + s * v * v;
};
const easeOutCubic = (u: number) => 1 - Math.pow(1 - u, 3);

function roundedRectShape(size: number, r: number) {
  const h = size / 2;
  const s = new THREE.Shape();
  s.moveTo(-h + r, -h);
  s.lineTo(h - r, -h);
  s.quadraticCurveTo(h, -h, h, -h + r);
  s.lineTo(h, h - r);
  s.quadraticCurveTo(h, h, h - r, h);
  s.lineTo(-h + r, h);
  s.quadraticCurveTo(-h, h, -h, h - r);
  s.lineTo(-h, -h + r);
  s.quadraticCurveTo(-h, -h, -h + r, -h);
  return s;
}

function glyphTexture(kind: (typeof FACE_GLYPHS)[number]): THREE.CanvasTexture {
  const n = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = n;
  const g = cv.getContext("2d")!;
  g.fillStyle = g.strokeStyle = "rgba(10,12,16,0.78)";
  g.lineWidth = 13;
  g.lineCap = "round";
  const c = n / 2;
  g.beginPath();
  switch (kind) {
    case "ring": g.arc(c, c, 26, 0, Math.PI * 2); g.stroke(); break;
    case "dot": g.arc(c, c, 19, 0, Math.PI * 2); g.fill(); break;
    case "square": g.rect(c - 20, c - 20, 40, 40); g.fill(); break;
    case "diamond": g.moveTo(c, c - 30); g.lineTo(c + 30, c); g.lineTo(c, c + 30); g.lineTo(c - 30, c); g.closePath(); g.fill(); break;
    case "plus": g.moveTo(c, c - 28); g.lineTo(c, c + 28); g.moveTo(c - 28, c); g.lineTo(c + 28, c); g.stroke(); break;
    case "cross": g.moveTo(c - 22, c - 22); g.lineTo(c + 22, c + 22); g.moveTo(c + 22, c - 22); g.lineTo(c - 22, c + 22); g.stroke(); break;
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class CubeView {
  /** Orbit/presentation transform lives here; cubies are children. */
  readonly root = new THREE.Group();
  readonly cubies: (THREE.Group | null)[] = [];
  /** Meshes the pointer can hit; userData.id = cubie id. */
  readonly pickables: THREE.Object3D[] = [];
  private displayed: CubeState = solvedState();
  private queue: { move: LayerMove; duration?: number; onDone?: () => void }[] = [];
  private anim: TurnAnim | null = null;
  private drag: { move: Omit<LayerMove, "qt">; ids: number[]; angle: number } | null = null;
  private nudge: { axis: number; ids: number[]; dir: number; t: number } | null = null;
  private glyphMeshes: THREE.Mesh[] = [];
  private tiles: THREE.Mesh[] = [];
  /** Per-cubie materials so a single layer can be highlighted. */
  private bodyMats: (THREE.MeshPhysicalMaterial | null)[] = [];
  private tileMats: THREE.MeshPhysicalMaterial[][] = [];
  private glow = new Float32Array(27);
  private glowTarget = new Float32Array(27);
  private selected: number[] = [];
  highlight = true;
  turnMs = 110;
  reducedMotion = false;

  constructor(opts: { ghost?: boolean } = {}) {
    const body = new RoundedBoxGeometry(0.97, 0.97, 0.97, 4, 0.1);
    const ghost = opts.ghost ? { transparent: true, opacity: 0.5 } : {};
    const tileGeo = new THREE.ExtrudeGeometry(roundedRectShape(0.82, 0.13), {
      depth: 0.012, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 3, curveSegments: 6,
    });
    tileGeo.translate(0, 0, 0.484);
    const glyphGeo = new THREE.PlaneGeometry(0.5, 0.5);
    glyphGeo.translate(0, 0, 0.5105);
    const glyphMats = FACE_GLYPHS.map(
      (k) => new THREE.MeshBasicMaterial({ map: glyphTexture(k), transparent: true, depthWrite: false }),
    );

    for (let id = 0; id < 27; id++) {
      this.tileMats.push([]);
      if (id === 13) {
        this.cubies.push(null);
        this.bodyMats.push(null);
        continue;
      }
      const g = new THREE.Group();
      const bodyMat = new THREE.MeshPhysicalMaterial({
        color: 0x15171c, roughness: 0.55, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0, ...ghost,
      });
      this.bodyMats.push(bodyMat);
      const b = new THREE.Mesh(body, bodyMat);
      b.userData.id = id;
      g.add(b);
      this.pickables.push(b);
      for (const n of stickerNormals(POSITIONS[id])) {
        const face = faceOfNormal(n);
        const mat = new THREE.MeshPhysicalMaterial({
          color: new THREE.Color(FACE_COLORS[face]), roughness: 0.32, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.25,
          emissive: new THREE.Color(FACE_COLORS[face]), emissiveIntensity: 0, ...ghost,
        });
        mat.userData.face = face;
        this.tileMats[id].push(mat);
        const tile = new THREE.Mesh(tileGeo, mat);
        tile.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...n));
        tile.userData.id = id;
        tile.userData.face = face;
        g.add(tile);
        this.tiles.push(tile);
        this.pickables.push(tile);
        const glyph = new THREE.Mesh(glyphGeo, glyphMats[face]);
        glyph.quaternion.copy(tile.quaternion);
        glyph.visible = false;
        g.add(glyph);
        this.glyphMeshes.push(glyph);
      }
      this.cubies.push(g);
      this.root.add(g);
    }
    this.snap();
  }

  setGlyphs(on: boolean) {
    for (const g of this.glyphMeshes) g.visible = on;
  }

  /** Sticker palette and plastic style. */
  setAppearance(colors: string[], body: BodyStyle) {
    for (const mats of this.tileMats)
      for (const m of mats) {
        m.color.set(colors[m.userData.face as number]);
        m.emissive.set(colors[m.userData.face as number]);
      }
    const bodyColor = body === "white" ? 0xe8eaee : body === "stickerless" ? 0x202228 : 0x15171c;
    this.bodyBase.setHex(bodyColor);
    this.bodyStyle = body;
    for (const m of this.bodyMats) m?.color.setHex(bodyColor);
    for (let id = 0; id < 27; id++) this.applyGlow(id, this.glow[id]);
    const k = body === "stickerless" ? 1.135 : 1;
    for (const t of this.tiles) t.scale.set(k, k, 1);
  }

  /** Keep a layer softly lit (the face chosen for the on-screen arrows). */
  select(ids: number[]) {
    this.selected = ids;
    this.retargetGlow();
  }

  private retargetGlow() {
    this.glowTarget.fill(0);
    for (const id of this.selected) this.glowTarget[id] = 0.55;
    const moving = this.anim?.ids ?? this.drag?.ids ?? [];
    if (this.highlight) for (const id of moving) this.glowTarget[id] = 1;
  }

  /** Ease each cubie's glow toward its target. Returns true while changing. */
  private updateGlow(dt: number): boolean {
    let changing = false;
    const k = 1 - Math.exp(-dt / 70);
    for (let id = 0; id < 27; id++) {
      const g = this.glow[id], t = this.glowTarget[id];
      if (Math.abs(g - t) < 0.005) {
        if (g !== t) this.applyGlow(id, (this.glow[id] = t));
        continue;
      }
      this.applyGlow(id, (this.glow[id] = g + (t - g) * k));
      changing = true;
    }
    return changing;
  }

  private bodyBase = new THREE.Color(0x15171c);
  private bodyStyle: BodyStyle = "black";
  /** On a white cube a white glow would vanish, so the plastic warms to brand orange instead. */
  private static readonly ORANGE = new THREE.Color("#f26510");

  private applyGlow(id: number, v: number) {
    if (this.bodyStyle === "white") {
      const b = this.bodyMats[id];
      if (b) {
        b.emissiveIntensity = 0;
        b.color.copy(this.bodyBase).lerp(CubeView.ORANGE, 0.85 * v);
      }
      for (const m of this.tileMats[id]) m.emissiveIntensity = 0.1 * v;
      return;
    }
    const b = this.bodyMats[id];
    // a white glow: the plastic around the turning layer lights up white, and the
    // stickers brighten in their own colour (adding white would wash them out)
    if (b) b.emissiveIntensity = 0.62 * v;
    for (const m of this.tileMats[id]) m.emissiveIntensity = 0.1 * v;
  }

  get state(): CubeState {
    return this.displayed;
  }

  get busy() {
    return this.anim !== null || this.queue.length > 0 || this.drag !== null;
  }

  get pending() {
    return this.queue.length + (this.anim ? 1 : 0);
  }

  /** Hard-set the displayed state, dropping any animation. */
  setState(s: CubeState) {
    this.queue.length = 0;
    this.anim = null;
    this.drag = null;
    this.nudge = null;
    this.displayed = s;
    this.selected = [];
    this.retargetGlow();
    this.snap();
  }

  enqueue(move: LayerMove, opts: { duration?: number; onDone?: () => void } = {}) {
    this.queue.push({ move, ...opts });
  }

  /** Finish every queued turn instantly. */
  flush() {
    if (this.anim) {
      if (this.anim.move) this.displayed = applyLayerMove(this.displayed, this.anim.move);
      this.anim.onDone?.();
      this.anim = null;
    }
    for (const q of this.queue) {
      this.displayed = applyLayerMove(this.displayed, q.move);
      q.onDone?.();
    }
    this.queue.length = 0;
    this.nudge = null;
    this.retargetGlow();
    this.snap();
  }

  /** Advance animations. Returns true while something is moving. */
  update(dt: number): boolean {
    let moving = this.updateGlow(dt);
    if (!this.anim && this.queue.length) this.startNext();
    if (this.anim) {
      const a = this.anim;
      a.elapsed += dt;
      const u = a.duration <= 0 ? 1 : Math.min(1, a.elapsed / a.duration);
      if (u >= 1) {
        if (a.move) this.displayed = applyLayerMove(this.displayed, a.move);
        this.anim = null;
        this.snap();
        a.onDone?.();
        if (this.queue.length) this.startNext();
        this.retargetGlow();
      } else this.poseLayer(a.axis, a.ids, a.from + (a.to - a.from) * a.ease(u));
      moving = true;
    }
    if (this.nudge && !this.anim && !this.drag) {
      const n = this.nudge;
      n.t += dt;
      const T = 900;
      if (n.t >= T * 2) {
        this.nudge = null;
        this.snap();
      } else {
        const u = (n.t % T) / T;
        this.poseLayer(n.axis, n.ids, n.dir * 0.32 * Math.sin(Math.PI * Math.min(1, u * 1.6)));
      }
      moving = true;
    }
    return moving || this.drag !== null;
  }

  private startNext() {
    const q = this.queue.shift()!;
    const ids = this.layerIds(q.move.axis, q.move.layers);
    const quarters = q.move.qt === 3 ? -1 : q.move.qt;
    const base = q.duration ?? this.turnMs * (Math.abs(quarters) === 2 ? 1.45 : 1);
    // Speed up when moves pile up so input never lags behind the player.
    const backlog = this.queue.length;
    const duration = this.reducedMotion ? 0 : Math.max(28, base / (1 + 0.75 * backlog));
    this.anim = {
      move: q.move, axis: q.move.axis, ids, from: 0, to: (quarters * Math.PI) / 2, elapsed: 0, duration,
      ease: easeMagnetic, onDone: q.onDone,
    };
    this.retargetGlow();
  }

  /** Cubies currently in the outer layer on the given side of an axis (sign ±1). */
  faceIds(axis: number, sign: number): number[] {
    return this.layerIds(axis, sign > 0 ? 0b100 : 0b001);
  }

  private layerIds(axis: number, layers: number): number[] {
    const out: number[] = [];
    for (let id = 0; id < 27; id++) {
      if (id === 13) continue;
      const p = cubiePosition(this.displayed, id);
      if ((layers >> (p[axis] + 1)) & 1) out.push(id);
    }
    return out;
  }

  private tmpQ = new THREE.Quaternion();
  private poseLayer(axis: number, ids: number[], angle: number) {
    this.tmpQ.setFromAxisAngle(AXIS_VECS[axis], angle);
    for (const id of ids) {
      const g = this.cubies[id]!;
      const r = this.displayed[id];
      const p = POSITIONS[id];
      const m = ROTATIONS[r];
      g.position.set(
        (m[0] * p[0] + m[1] * p[1] + m[2] * p[2]) * SPACING,
        (m[3] * p[0] + m[4] * p[1] + m[5] * p[2]) * SPACING,
        (m[6] * p[0] + m[7] * p[1] + m[8] * p[2]) * SPACING,
      ).applyQuaternion(this.tmpQ);
      g.quaternion.multiplyQuaternions(this.tmpQ, ROT_QUATS[r]);
    }
  }

  /** Put every cubie exactly where the logical state says. */
  snap() {
    for (let id = 0; id < 27; id++) {
      const g = this.cubies[id];
      if (!g) continue;
      const r = this.displayed[id];
      const p: Vec3 = cubiePosition(this.displayed, id);
      g.position.set(p[0] * SPACING, p[1] * SPACING, p[2] * SPACING);
      g.quaternion.copy(ROT_QUATS[r]);
    }
  }

  // ---- direct manipulation -------------------------------------------------------

  beginDrag(axis: 0 | 1 | 2, layers: number) {
    this.flush();
    this.drag = { move: { axis, layers }, ids: this.layerIds(axis, layers), angle: 0 };
    this.retargetGlow();
  }

  setDragAngle(angle: number) {
    if (!this.drag) return;
    this.drag.angle = angle;
    this.poseLayer(this.drag.move.axis, this.drag.ids, angle);
  }

  get dragAngle() {
    return this.drag?.angle ?? 0;
  }

  /**
   * Release the dragged layer: it settles on `quarters` quarter turns
   * (0 = spring back). Returns the resulting move at once so the caller can
   * commit it to the logical state; the view finishes the settle on its own.
   */
  endDrag(quarters: number, velocity: number): LayerMove | null {
    if (!this.drag) return null;
    const d = this.drag;
    this.drag = null;
    const to = (quarters * Math.PI) / 2;
    const remaining = Math.abs(to - d.angle);
    const speed = Math.max(Math.abs(velocity), 7); // rad/s
    const duration = this.reducedMotion ? 0 : Math.min(220, Math.max(45, (remaining / speed) * 1000 * 1.5));
    const q = ((quarters % 4) + 4) % 4;
    const move: LayerMove | null = q === 0 ? null : { ...d.move, qt: q as 1 | 2 | 3 };
    this.anim = { move, axis: d.move.axis, ids: d.ids, from: d.angle, to, elapsed: 0, duration, ease: easeOutCubic };
    this.retargetGlow();
    return move;
  }

  /** Show the direction of a suggested turn by nudging the layer back and forth. */
  showNudge(move: LayerMove) {
    if (this.reducedMotion) return;
    const quarters = move.qt === 3 ? -1 : 1;
    this.nudge = { axis: move.axis, ids: this.layerIds(move.axis, move.layers), dir: quarters, t: 0 };
  }

  clearNudge() {
    if (this.nudge) {
      this.nudge = null;
      this.snap();
    }
  }
}
