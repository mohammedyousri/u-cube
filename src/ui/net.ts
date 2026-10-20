// 2D unfolded net of a facelet string, in the layout WCA scramble sheets use:
//        U
//     L  F  R  B
//        D

import { FACE_COLORS } from "../render/cubeView";

const OFFSETS: Record<number, [number, number]> = { 0: [3, 0], 4: [0, 3], 2: [3, 3], 1: [6, 3], 5: [9, 3], 3: [3, 6] };

export function netSvg(facelets: string, opts: { size?: number; selected?: number; interactive?: boolean } = {}): string {
  const s = opts.size ?? 14;
  const gap = Math.max(1, s * 0.12);
  const parts: string[] = [];
  for (let face = 0; face < 6; face++) {
    const [ox, oy] = OFFSETS[face];
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) {
        const i = face * 9 + r * 3 + c;
        const letter = facelets[i];
        const fi = "URFDLB".indexOf(letter);
        const fill = fi >= 0 ? FACE_COLORS[fi] : "transparent";
        const x = (ox + c) * s + gap / 2;
        const y = (oy + r) * s + gap / 2;
        const sel = opts.selected === i ? ` stroke="var(--accent)" stroke-width="${gap * 2}"` : ` stroke="rgba(0,0,0,.35)" stroke-width="${gap * 0.5}"`;
        const attrs = opts.interactive ? ` data-i="${i}" role="button" tabindex="0" aria-label="sticker ${i + 1}"` : "";
        parts.push(`<rect x="${x}" y="${y}" width="${s - gap}" height="${s - gap}" rx="${s * 0.16}" fill="${fill}"${sel}${attrs}/>`);
      }
  }
  const role = opts.interactive ? `role="group" aria-label="Cube net: tap a sticker to change its colour"` : `role="img" aria-label="Cube net"`;
  return `<svg viewBox="0 0 ${12 * s} ${9 * s}" width="${12 * s}" height="${9 * s}" ${role}>${parts.join("")}</svg>`;
}
