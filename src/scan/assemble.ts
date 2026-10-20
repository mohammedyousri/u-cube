// Turning six photos into a cube, and a cube into instructions a person can follow.

import { FACELET_AT, FACE_NAMES, POSITIONS, ROTATIONS, faceOfNormal, posIndex, rotate, stickerNormals } from "../core/geometry";
import type { CubeState } from "../core/cube";
import type { Token } from "../core/notation";

export interface CaptureStep {
  /** Face index in URFDLB order that this photo fills. */
  face: number;
  /** What to tell the player, given the colour names of the U and F centers once known. */
  title: string;
  how: string;
  /** Face shown at the top of the photo. */
  top: number;
}

// Order chosen so each step is one simple motion from the previous one.
// Each photo is read row by row exactly as Kociemba's facelet order expects.
export const CAPTURE_STEPS: CaptureStep[] = [
  { face: 2, title: "Front", top: 0, how: "Hold the cube with the white center on top and the green center facing the camera." },
  { face: 1, title: "Right", top: 0, how: "Turn the whole cube a quarter turn to the left: the red center now faces the camera, white still on top." },
  { face: 5, title: "Back", top: 0, how: "Another quarter turn to the left: blue faces the camera, white on top." },
  { face: 4, title: "Left", top: 0, how: "Another quarter turn to the left: orange faces the camera, white on top." },
  { face: 0, title: "Top", top: 5, how: "Turn left once more so green faces you again, then tip the top toward the camera: white faces it, blue is on top." },
  { face: 3, title: "Bottom", top: 2, how: "Tip it back, then tip the bottom toward the camera: yellow faces it, green is on top." },
];

/**
 * Build a logical cube state from a 54-character facelet string (face letters),
 * for display in 3D. Throws if some piece cannot be placed (invalid scan).
 */
export function stateFromFacelets(f: string): CubeState {
  const s = new Uint8Array(27);
  for (let id = 0; id < 27; id++) {
    const home = POSITIONS[id];
    const normals = stickerNormals(home);
    if (normals.length <= 1) continue; // centers and core stay put (centers define the frame)
    let found = -1;
    for (let r = 0; r < 24 && found < 0; r++) {
      const R = ROTATIONS[r];
      const p = posIndex(rotate(R, home));
      if (normals.every((n) => f[FACELET_AT[p * 6 + faceOfNormal(rotate(R, n))]] === FACE_NAMES[faceOfNormal(n)])) found = r;
    }
    if (found < 0) throw new Error(`piece ${id} cannot be placed`);
    s[id] = found;
  }
  return s;
}

/** Plain-language description of a face turn, for someone holding the cube as instructed. */
export function describeMove(t: Token): string {
  const twice = t.amount === 2;
  const prime = t.amount === -1;
  switch (t.base) {
    case "U": return twice ? "Turn the top layer twice (half turn)." : prime ? "Turn the top layer to the right." : "Turn the top layer to the left.";
    case "D": return twice ? "Turn the bottom layer twice (half turn)." : prime ? "Turn the bottom layer to the left." : "Turn the bottom layer to the right.";
    case "R": return twice ? "Turn the right side twice (half turn)." : prime ? "Turn the right side down, toward you." : "Turn the right side up, away from you.";
    case "L": return twice ? "Turn the left side twice (half turn)." : prime ? "Turn the left side up, away from you." : "Turn the left side down, toward you.";
    case "F": return twice ? "Turn the front face twice (half turn)." : prime ? "Turn the front face counter-clockwise." : "Turn the front face clockwise.";
    case "B": return twice ? "Turn the back face twice (half turn)." : prime ? "Turn the back face so its top row moves to the right (seen from the front)." : "Turn the back face so its top row moves to the left (seen from the front).";
  }
  return "";
}
