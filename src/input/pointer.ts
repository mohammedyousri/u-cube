// Direct manipulation. Press on a sticker and drag: the layer under your
// finger turns with it (the sticker stays under the pointer); release and it
// settles on the nearest quarter turn, carried by your release velocity.
// Drag empty space (or use two fingers) to orbit.

import * as THREE from "three";
import type { Stage } from "../render/scene";
import type { LayerMove } from "../core/notation";
import { cubiePosition } from "../core/cube";

const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
const LOCK_PX = 7;
const ORBIT_GAIN = 0.0085;

interface LayerDrag {
  kind: "layer";
  id: number;
  start: THREE.Vector2;
  point: THREE.Vector3; // hit point, cube-local
  normalAxis: number;
  axis: number;
  layer: number;
  /** screen px per radian of rotation, for the locked axis */
  perRad: THREE.Vector2;
  samples: { t: number; a: number }[];
}
interface OrbitDrag {
  kind: "orbit";
  last: THREE.Vector2;
  travel: number;
  samples: { t: number; x: number; y: number }[];
}

export class PointerInput {
  private ray = new THREE.Raycaster();
  private drag: LayerDrag | OrbitDrag | null = null;
  private pointers = new Map<number, THREE.Vector2>();
  private lastTap = 0;

  constructor(
    private stage: Stage,
    private el: HTMLElement,
    private hooks: {
      canTurn: () => boolean;
      commit: (m: LayerMove, pointerType: string) => void;
      /** A tap without dragging: on a face (axis, sign) or on empty space (null). */
      onTap?: (face: { axis: number; sign: number } | null) => void;
      onTouchStart?: () => void;
    },
  ) {
    el.addEventListener("pointerdown", this.down);
    el.addEventListener("pointermove", this.move);
    el.addEventListener("pointerup", this.up);
    el.addEventListener("pointercancel", this.cancel);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private ndc(x: number, y: number) {
    const r = this.el.getBoundingClientRect();
    return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }

  /** Cube-local point → screen px. */
  private toScreen(p: THREE.Vector3): THREE.Vector2 {
    const r = this.el.getBoundingClientRect();
    const w = this.stage.cube.root.localToWorld(p.clone()).project(this.stage.camera);
    return new THREE.Vector2((w.x + 1) * 0.5 * r.width, (1 - w.y) * 0.5 * r.height);
  }

  private lastPointerType = "mouse";
  private down = (e: PointerEvent) => {
    this.lastPointerType = e.pointerType;
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, new THREE.Vector2(e.clientX, e.clientY));
    this.hooks.onTouchStart?.();
    if (this.pointers.size >= 2) {
      // second finger: abandon any layer drag, orbit instead
      if (this.drag?.kind === "layer") this.finishLayer(true);
      this.startOrbit();
      return;
    }
    const now = performance.now();
    if (now - this.lastTap < 300 && !this.hitCube(e)) {
      this.stage.resetView();
      this.lastTap = 0;
      return;
    }
    this.lastTap = now;
    const hit = this.hooks.canTurn() ? this.hitCube(e) : null;
    if (!hit) return this.startOrbit();
    const root = this.stage.cube.root;
    const local = root.worldToLocal(hit.point.clone());
    // The touched face: of the cubie's outward-facing axes, the one the hit point sticks out along most.
    const id: number = hit.object.userData.id;
    const c = cubiePosition(this.stage.cube.state, id);
    const o = [local.x - c[0], local.y - c[1], local.z - c[2]];
    let normalAxis = -1;
    for (let k = 0; k < 3; k++)
      if (c[k] !== 0 && Math.sign(o[k]) === c[k] && (normalAxis < 0 || Math.abs(o[k]) > Math.abs(o[normalAxis]))) normalAxis = k;
    if (normalAxis < 0) return this.startOrbit();
    this.drag = {
      kind: "layer", id, start: new THREE.Vector2(e.clientX, e.clientY), point: local,
      normalAxis, axis: -1, layer: 0, perRad: new THREE.Vector2(), samples: [],
    };
  };

  private hitCube(e: PointerEvent) {
    this.ray.setFromCamera(this.ndc(e.clientX, e.clientY), this.stage.camera);
    return this.ray.intersectObjects(this.stage.cube.pickables, false)[0] ?? null;
  }

  private startOrbit() {
    const c = this.centroid();
    this.drag = { kind: "orbit", last: c, samples: [], travel: 0 };
    this.stage.orbiting = true;
    this.stage.setOrbitVelocity(0, 0);
  }

  private centroid() {
    const c = new THREE.Vector2();
    for (const p of this.pointers.values()) c.add(p);
    return c.multiplyScalar(1 / Math.max(1, this.pointers.size));
  }

  private move = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.get(e.pointerId)!.set(e.clientX, e.clientY);
    const d = this.drag;
    if (!d) return;
    if (d.kind === "orbit") {
      const c = this.centroid();
      const dx = c.x - d.last.x;
      const dy = c.y - d.last.y;
      d.last.copy(c);
      d.travel += Math.abs(dx) + Math.abs(dy);
      this.stage.orbitBy(dx * ORBIT_GAIN, dy * ORBIT_GAIN);
      d.samples.push({ t: performance.now(), x: dx, y: dy });
      if (d.samples.length > 8) d.samples.shift();
      return;
    }
    const delta = new THREE.Vector2(e.clientX, e.clientY).sub(d.start);
    if (d.axis < 0) {
      if (delta.length() < LOCK_PX) return;
      this.lockAxis(d, delta);
      this.stage.cube.beginDrag(d.axis as 0 | 1 | 2, 1 << (d.layer + 1));
    }
    const angle = this.angleUnderFinger(d, delta);
    this.stage.cube.setDragAngle(angle);
    d.samples.push({ t: performance.now(), a: angle });
    if (d.samples.length > 8) d.samples.shift();
    this.stage.invalidate();
  };

  /**
   * The layer angle that puts the touched point closest to the finger. Searching the
   * real circular path (not a straight-line estimate) keeps long drags honest: past
   * the cube's edge the layer stops following, just like a physical cube.
   */
  private q = new THREE.Quaternion();
  private angleUnderFinger(d: LayerDrag, delta: THREE.Vector2): number {
    const target = this.toScreen(d.point).add(delta);
    const axis = AXES[d.axis];
    const at = (a: number) => {
      this.q.setFromAxisAngle(axis, a);
      return this.toScreen(d.point.clone().applyQuaternion(this.q)).distanceToSquared(target);
    };
    let best = 0, bestD = Infinity;
    for (let a = -2.1; a <= 2.1; a += 0.03) {
      const dd = at(a);
      if (dd < bestD) {
        bestD = dd;
        best = a;
      }
    }
    for (let step = 0.015; step > 0.001; step /= 2) {
      const l = at(best - step), r = at(best + step);
      if (l < bestD && l <= r) {
        best -= step;
        bestD = l;
      } else if (r < bestD) {
        best += step;
        bestD = r;
      }
    }
    return best;
  }

  /**
   * Pick the rotation axis whose on-screen motion best matches the drag. Each axis is
   * judged by how it moves stickers within the touched face's own plane (axis × normal),
   * which is the same everywhere on the face; the full 3D tangent would also include
   * motion toward the viewer, which makes the two axes look alike near corners.
   */
  private lockAxis(d: LayerDrag, delta: THREE.Vector2) {
    const dir = delta.clone().normalize();
    const p0 = this.toScreen(d.point);
    const n = new THREE.Vector3();
    n.setComponent(d.normalAxis, Math.sign(d.point.getComponent(d.normalAxis)) || 1);
    let best = -1;
    for (let a = 0; a < 3; a++) {
      if (a === d.normalAxis) continue;
      const inPlane = new THREE.Vector3().crossVectors(AXES[a], n).multiplyScalar(0.05);
      const s = this.toScreen(d.point.clone().add(inPlane)).sub(p0);
      const score = Math.abs(s.clone().normalize().dot(dir));
      if (score > best) {
        best = score;
        d.axis = a;
        d.perRad = s;
      }
    }
    const coord = [d.point.x, d.point.y, d.point.z][d.axis];
    d.layer = Math.max(-1, Math.min(1, Math.round(coord)));
  }

  private up = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size > 0 && this.drag?.kind === "orbit") {
      this.drag.last.copy(this.centroid());
      return;
    }
    if (this.drag?.kind === "layer") this.finishLayer(false);
    else if (this.drag?.kind === "orbit") {
      if (this.drag.travel < 6) this.hooks.onTap?.(null);
      const s = this.drag.samples.filter((x) => performance.now() - x.t < 90);
      const span = s.length > 1 ? Math.max(16, s[s.length - 1].t - s[0].t) : 16;
      const vx = s.reduce((a, b) => a + b.x, 0) / span;
      const vy = s.reduce((a, b) => a + b.y, 0) / span;
      this.stage.orbiting = false;
      this.stage.setOrbitVelocity(vx * ORBIT_GAIN, vy * ORBIT_GAIN);
    }
    this.drag = null;
    this.stage.orbiting = false;
  };

  private cancel = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.drag?.kind === "layer") this.finishLayer(true);
    this.drag = null;
    this.stage.orbiting = false;
  };

  private finishLayer(springBack: boolean) {
    const d = this.drag as LayerDrag;
    this.drag = null;
    if (d.axis < 0) {
      if (!springBack) this.hooks.onTap?.({ axis: d.normalAxis, sign: Math.sign(d.point.getComponent(d.normalAxis)) || 1 });
      return;
    }
    const angle = this.stage.cube.dragAngle;
    const s = d.samples.filter((x) => performance.now() - x.t < 100);
    const vel = s.length > 1 ? ((s[s.length - 1].a - s[0].a) / Math.max(1, s[s.length - 1].t - s[0].t)) * 1000 : 0;
    // A flick carries the layer a little further, but never more than about half a quarter turn.
    const bonus = Math.max(-0.75, Math.min(0.75, vel * 0.07));
    const projected = angle + bonus;
    let quarters = springBack ? 0 : Math.round(projected / (Math.PI / 2));
    quarters = Math.max(-2, Math.min(2, quarters));
    const move = this.stage.cube.endDrag(quarters, vel);
    if (move) this.hooks.commit(move, this.lastPointerType);
  }
}
