import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { CubeView } from "./cubeView";

export const DEFAULT_YAW = -0.62;
export const DEFAULT_PITCH = 0.5;

/** Rolling frame-time log, read by the performance test. */
export const perf = { frames: [] as number[], work: [] as number[], record: false };

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  readonly cube = new CubeView();
  /** Presentation group: orbit yaw/pitch + celebration spin. */
  readonly pivot = new THREE.Group();
  yaw = DEFAULT_YAW;
  pitch = DEFAULT_PITCH;
  private yawVel = 0;
  private pitchVel = 0;
  private spin: { t: number; dur: number } | null = null;
  private resetAnim: { t: number; fromYaw: number; fromPitch: number } | null = null;
  private dirty = true;
  private last = performance.now();
  private listeners: ((dt: number) => void)[] = [];
  /** Translucent second cube for racing a previous solve (created on first use). */
  ghost: CubeView | null = null;
  private ghostPivot = new THREE.Group();

  /** Called when the orbit passes ±45° so the game can re-base the logical frame with y / y'. */
  onYawRebase: ((dir: 1 | -1) => void) | null = null;
  orbiting = false;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute("aria-hidden", "true");

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.95;
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(4, 7, 6);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfd2ff, 0.6);
    rim.position.set(-6, 2, -4);
    this.scene.add(rim);

    this.scene.add(this.pivot);
    this.pivot.add(this.cube.root);
    this.scene.add(this.shadow());

    this.camera.position.set(0, 0, 13.5);
    this.camera.lookAt(0, 0, 0);
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.applyOrbit();
    const loop = () => {
      this.frame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** Soft contact shadow under the cube. */
  private shadow() {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 256;
    const g = cv.getContext("2d")!;
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, "rgba(0,0,0,0.34)");
    grad.addColorStop(0.5, "rgba(0,0,0,0.12)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(cv);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(5.2, 5.2),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = -2.9;
    return m;
  }

  /** Screen space (px) kept free for UI around the cube. */
  private safeTop = 80;
  private safeBottom = 200;
  private safeRight = 0;
  /** Extra room on every side for the optional arrows. */
  private arrowRoom = 0;
  setSafeArea(top: number, bottom: number, right = 0) {
    if (Math.abs(top - this.safeTop) < 1 && Math.abs(bottom - this.safeBottom) < 1 && Math.abs(right - this.safeRight) < 1) return;
    this.safeTop = top;
    this.safeBottom = bottom;
    this.safeRight = right;
    this.resize();
  }
  setArrowRoom(px: number) {
    if (px === this.arrowRoom) return;
    this.arrowRoom = px;
    this.resize();
  }

  resize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Fit the cube's bounding sphere into the free area between the UI, and centre it there.
    const R = 2.6; // the cube's bounding sphere (half its space diagonal)
    const tanHalf = Math.tan((this.camera.fov * Math.PI) / 360);
    const bandH = Math.max(140, h - this.safeTop - this.safeBottom - 2 * this.arrowRoom);
    const bandW = Math.max(140, w - this.safeRight - 2 * this.arrowRoom);
    // never larger than ~560 px across, however big the screen
    const maxPx = 560;
    const dV = (R * h) / (0.97 * Math.min(bandH, maxPx) * tanHalf);
    const dH = (R * h) / (0.97 * Math.min(bandW, maxPx) * tanHalf);
    this.camera.position.set(0, 0, Math.max(dV, dH, 7));
    const bandCenterY = this.safeTop + (h - this.safeTop - this.safeBottom) / 2;
    const bandCenterX = (w - this.safeRight) / 2;
    this.camera.setViewOffset(w, h, w / 2 - bandCenterX, h / 2 - bandCenterY, w, h);
    this.camera.updateProjectionMatrix();
    this.placeGhost();
    this.invalidate();
  }

  invalidate() {
    this.dirty = true;
  }

  /** Client-pixel position of a point given in cube coordinates. */
  screenOf(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    const v = this.cube.root.localToWorld(new THREE.Vector3(x, y, z));
    const toCam = this.camera.position.clone().sub(v);
    const n = this.cube.root.localToWorld(new THREE.Vector3(x * 2, y * 2, z * 2)).sub(v);
    v.project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, visible: n.dot(toCam) > 0 };
  }

  /** Screen-space centre and radius of the cube. */
  cubeOnScreen() {
    const c = this.screenOf(0, 0, 0);
    const top = this.screenOf(0, 1.5, 0);
    const r = this.renderer.domElement.getBoundingClientRect();
    const fy = this.camera.position.z * Math.tan((this.camera.fov * Math.PI) / 360);
    return { x: c.x, y: c.y, r: (2.6 / fy) * (r.height / 2), top: top.y };
  }

  showGhost(on: boolean): CubeView | null {
    if (on && !this.ghost) {
      this.ghost = new CubeView({ ghost: true });
      this.ghostPivot.add(this.ghost.root);
      this.scene.add(this.ghostPivot);
      this.placeGhost();
    }
    this.ghostPivot.visible = on;
    this.invalidate();
    return on ? this.ghost : null;
  }

  /** Small ghost cube in the top-right corner of the free band. */
  private placeGhost() {
    if (!this.ghost) return;
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    const scale = w < 720 ? 0.26 : 0.3;
    const px = Math.min(110, w * 0.16);
    const ndc = new THREE.Vector3(((w - 24 - px) / w) * 2 - 1, -(((this.safeTop + px) / h) * 2 - 1), 0.5);
    ndc.unproject(this.camera);
    const dir = ndc.sub(this.camera.position).normalize();
    const t = -this.camera.position.z / dir.z;
    this.ghostPivot.position.copy(this.camera.position).addScaledVector(dir, t);
    this.ghostPivot.scale.setScalar(scale);
  }

  onFrame(fn: (dt: number) => void) {
    this.listeners.push(fn);
  }

  // ---- orbit ------------------------------------------------------------------

  orbitBy(dx: number, dy: number) {
    this.resetAnim = null;
    this.yaw += dx;
    this.pitch = Math.max(-0.35, Math.min(1.25, this.pitch + dy));
    this.applyOrbit();
  }

  setOrbitVelocity(vx: number, vy: number) {
    this.yawVel = vx;
    this.pitchVel = vy;
  }

  resetView() {
    this.yawVel = this.pitchVel = 0;
    this.resetAnim = { t: 0, fromYaw: this.yaw, fromPitch: this.pitch };
  }

  celebrate() {
    this.spin = { t: 0, dur: 1100 };
  }

  private applyOrbit() {
    // Re-base the logical frame so "F" is always the face most facing the player.
    if (this.yaw > DEFAULT_YAW + Math.PI / 4 && this.onYawRebase) {
      this.yaw -= Math.PI / 2;
      this.onYawRebase(-1);
    } else if (this.yaw < DEFAULT_YAW - Math.PI / 4 && this.onYawRebase) {
      this.yaw += Math.PI / 2;
      this.onYawRebase(1);
    }
    const spin = this.spin ? easeInOut(Math.min(1, this.spin.t / this.spin.dur)) * Math.PI * 2 : 0;
    this.pivot.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw + spin, 0, "XYZ"));
    this.invalidate();
  }

  private frame() {
    const now = performance.now();
    this.frameWork(now);
    if (perf.record) perf.work.push(performance.now() - now);
  }

  private frameWork(now: number) {
    const dt = Math.min(64, now - this.last);
    this.last = now;
    let active = false;
    for (const fn of this.listeners) fn(dt);
    if (this.cube.update(dt)) active = true;
    if (this.ghost && this.ghostPivot.visible) {
      this.ghostPivot.quaternion.copy(this.pivot.quaternion);
      if (this.ghost.update(dt)) active = true;
    }
    if (!this.orbiting && (Math.abs(this.yawVel) > 1e-4 || Math.abs(this.pitchVel) > 1e-4)) {
      this.orbitBy(this.yawVel * dt, this.pitchVel * dt);
      const decay = Math.exp(-dt / 220);
      this.yawVel *= decay;
      this.pitchVel *= decay;
      active = true;
    }
    if (this.resetAnim) {
      const r = this.resetAnim;
      r.t += dt;
      const u = easeInOut(Math.min(1, r.t / 450));
      this.yaw = r.fromYaw + (DEFAULT_YAW - r.fromYaw) * u;
      this.pitch = r.fromPitch + (DEFAULT_PITCH - r.fromPitch) * u;
      if (u >= 1) this.resetAnim = null;
      this.applyOrbit();
      active = true;
    }
    if (this.spin) {
      this.spin.t += dt;
      if (this.spin.t >= this.spin.dur) this.spin = null;
      this.applyOrbit();
      active = true;
    }
    if (active || this.dirty) {
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
      if (perf.record) perf.frames.push(dt);
    }
  }
}

function easeInOut(u: number) {
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}
