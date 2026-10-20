// The U.CUBE mark: a 3×3 cube face whose stickers spell "U", with one small
// cube, carrying the exponent 3, twisted out over the top-right corner.

export interface LogoScheme {
  /** Tile colour, and an optional hairline edge for light tiles. */
  base: string;
  edge?: string;
  /** U stickers: gradient from → to (top-left to bottom-right of each sticker). */
  cells: [string, string];
  /** Outline of the two empty grid cells. */
  grid: string;
  gridOpacity: number;
}

/** The small corner cube: glossy tangerine, the same in every version. */
const CORNER: [string, string] = ["#ff9a2e", "#f0324f"];
/** Navy seal: the brand navy. */
export const NAVY = "#131a26";

export const LOGO_SCHEMES = {
  /** White tile, navy U — for light surfaces. */
  light: { base: "#ffffff", edge: "#dfe3ec", cells: ["#2d3a52", NAVY], grid: NAVY, gridOpacity: 0.28 },
  /** Navy tile, white U — for dark surfaces and the app icon. */
  dark: { base: NAVY, cells: ["#ffffff", "#d9e0f0"], grid: "#ffffff", gridOpacity: 0.3 },
} satisfies Record<string, LogoScheme>;

interface LogoOpts {
  scheme?: keyof typeof LOGO_SCHEMES;
  /**
   * Draw straight on the app background, without the tile: the U takes the
   * theme's colours from CSS (--logo-u-a / --logo-u-b), so it always matches.
   */
  onPage?: boolean;
  /** Draw the rounded-square tile (default true). */
  base?: boolean;
  /** Staggered build-up animation (About window). */
  animate?: boolean;
  /** Unique id prefix (several logos can share a page). */
  id?: string;
  title?: string;
}

// U cells in writing order: down the left, across the bottom, up the right.
const U_CELLS: [number, number][] = [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [2, 1], [2, 0]];
const EMPTY_CELLS: [number, number][] = [[1, 0], [1, 1]];

export function logoSvg(opts: LogoOpts = {}): string {
  const id = opts.id ?? "u3";
  const k: LogoScheme = LOGO_SCHEMES[opts.scheme ?? "dark"];
  const cell = 13, gap = 3.2, ox = 7, oy = 14;
  const x = (c: number) => ox + c * (cell + gap);
  const y = (r: number) => oy + r * (cell + gap);
  const anim = (i: number) => (opts.animate ? ` class="u3-pop" style="animation-delay:${80 + i * 70}ms"` : "");
  const cells = U_CELLS.map(
    ([c, r], i) => `<rect${anim(i)} x="${x(c)}" y="${y(r)}" width="${cell}" height="${cell}" rx="3.4" fill="url(#${id}-u)"/>`,
  ).join("");
  const gridStroke = opts.onPage ? `style="stroke:var(--logo-u-b)" stroke-opacity=".3"` : `stroke="${k.grid}" stroke-opacity="${k.gridOpacity}"`;
  const empty = EMPTY_CELLS.map(
    ([c, r]) => `<rect x="${x(c) + 0.6}" y="${y(r) + 0.6}" width="${cell - 1.2}" height="${cell - 1.2}" rx="3" fill="none" ${gridStroke} stroke-width="1.2"/>`,
  ).join("");
  const stop = (i: 0 | 1) => (opts.onPage ? `style="stop-color:var(--logo-u-${i ? "b" : "a"})"` : `stop-color="${k.cells[i]}"`);
  const tx = x(2) + 6, ty = 0.5; // the corner cube, popping out over the top-right corner
  const edge = k.edge ? ` stroke="${k.edge}" stroke-width="1"` : "";
  const inset = k.edge ? 0.5 : 0;
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${opts.title ?? "U.CUBE"}">
    <defs>
      <linearGradient id="${id}-u" x1="0" y1="0" x2="1" y2="1"><stop offset="0" ${stop(0)}/><stop offset="1" ${stop(1)}/></linearGradient>
      <linearGradient id="${id}-t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${CORNER[0]}"/><stop offset="1" stop-color="${CORNER[1]}"/></linearGradient>
      <filter id="${id}-s" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="1.6" stdDeviation="1.4" flood-color="#000" flood-opacity=".35"/></filter>
    </defs>
    ${opts.base === false || opts.onPage ? "" : `<rect x="${inset}" y="${inset}" width="${64 - 2 * inset}" height="${64 - 2 * inset}" rx="15" fill="${k.base}"${edge}/>`}
    ${empty}${cells}
    <g class="${opts.animate ? "u3-twist" : "u3-tile"}" filter="url(#${id}-s)" transform="rotate(-14 ${tx + 8.5} ${ty + 8.5})">
      <rect x="${tx}" y="${ty}" width="17" height="17" rx="4.6" fill="url(#${id}-t)"/>
      <text x="${tx + 8.5}" y="${ty + 13.1}" text-anchor="middle" font-family="ui-rounded, 'SF Pro Rounded', system-ui, sans-serif" font-weight="900" font-size="13" fill="#ffffff">3</text>
    </g>
  </svg>`;
}
