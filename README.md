# U.CUBE

**Play it: https://mohammedyousri.github.io/u-cube/**

A 3D Rubik's Cube for the web where **difficulty is real distance**: every scramble is graded by the length of its shortest solution, proven exactly up to 10 moves. Designed and built by M.Yousri.

- **Play**: drag a sticker and the layer under your finger turns with it. A flick carries it on to the next quarter turn. There's keyboard play with the cstimer layout, and optional on-screen arrows.
- **Five levels**:

  | Level | Distance from solved |
  | --- | --- |
  | Warm-up | 1–3 moves |
  | Easy | 4–6 moves |
  | Medium | 7–10 moves |
  | Hard | 11–15 moves |
  | Expert | Random state, as in competition |

- **Speedcubing**: WCA inspection rules (+2 after 15 s, DNF after 17 s), best/ao5/ao12, and history saved in your browser.
- **Every solve is a recording**: replay with a scrubber, see Cross/F2L/OLL/PLL splits and a TPS graph, race a ghost of your best attempt, share a link.
- **Scan your real cube**: take six photos (or enter the colours by hand). It checks the cube can physically exist, then guides you to solved one turn at a time on a 3D copy held the same way.
- **Appearance**: 7 backgrounds including a custom colour (text contrast is kept automatically), 4 sticker palettes, 3 cube bodies, colour-blind symbols, light/dark, and a turning-layer highlight. Works on phone and tablet in portrait and landscape.

## Run

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. The camera scanner needs `localhost` or HTTPS.

```bash
npm run build
```

The output in `dist/` is a static site you can host anywhere. It's installable as a web app (manifest and icons in `public/`).

## Share and install

U.CUBE is a web app. Put the `dist/` folder on any static host and share the link; it runs on phones, tablets and computers. Free hosts that serve it over HTTPS (which the camera scanner needs) include GitHub Pages, Netlify, Vercel and Cloudflare Pages.

**Install it like an app.** It's an installable, offline-capable web app: after the first visit it plays with no connection.

| Device | How to install |
| --- | --- |
| iPhone / iPad (Safari) | Share → Add to Home Screen |
| Android (Chrome) | ⋮ → Install app (or the install banner) |
| Windows / Mac (Chrome, Edge) | Install icon in the address bar |

It then opens full screen with the U.CUBE icon. **Share U.CUBE** in the About window opens the phone's share sheet. Solves are shared from the result card.

**App stores (optional).** [PWABuilder](https://www.pwabuilder.com) can package the hosted app for Google Play and the Microsoft Store; the Apple App Store needs a native wrapper such as Capacitor. Each store needs its own developer account.

## Test

```bash
npm test
```

```bash
npm run test:e2e
```

End-to-end tests and the performance test use your installed Google Chrome, headless, and expect the dev server on port 5173. Screenshots, icons and the TNoodle sheet are generated with:

```bash
npx playwright test --config scripts/icons.config.ts
```

## How it is built

| Area | Files | Notes |
| --- | --- | --- |
| Cube state | `src/core/` | Each of the 27 cubies stores one of 24 exact rotations. Every move (face, slice, wide, rotation) is derived from integer geometry, not typed in. The 3D view only displays this state and snaps to it after each turn, so there's no drift. |
| Solver | `src/solver/` | Kociemba two-phase, written from scratch; meet-in-the-middle search for exact distance ≤ 10 (a table of all 621,649 positions within 5 moves); level generators. Runs in a Web Worker. |
| 3D | `src/render/` | Three.js. Physically based stickers, environment lighting, a turn queue that speeds up when you type faster than it animates, and per-layer highlight. |
| Input | `src/input/` | The pointer finds the exact angle that keeps the touched sticker under your finger. There's also a keyboard map. |
| Game | `src/game/` | Timer, WCA penalties, averages, CFOP stage detection, replays, ghosts, share links, storage. |
| Scanner | `src/scan/` | Glare-robust sampling. White balance comes from the fact that every cube has nine stickers of each colour. Colours are compared with CIEDE2000, and assignment is balanced (Hungarian algorithm) so each colour gets exactly nine stickers. |

## Verification record

Each check is made against something other than the code itself.

| Check | Source of truth | Result |
| --- | --- | --- |
| Group invariants (twist, flip, parity), 10,000 random sequences | Mathematics of the cube group | Pass |
| Any sequence followed by its inverse is the identity, 10,000 cases; (R U R′ U′)×6 = I; (R U) has order 105; superflip | Mathematics | Pass |
| Facelet strings, 1,000 random sequences using every move type | [cubejs](https://github.com/ldez/cubejs) (independent implementation) | Identical |
| Piece states, 1,000 random sequences | [cubing.js](https://js.cubing.net/cubing/) KPuzzle | Identical |
| Positions at distance 0–5: 1, 18, 243, 3,240, 43,239, 574,908 | Published counts ([cube20.org](https://cube20.org)) | Identical |
| Exact distance vs brute-force search, 300 positions | Independent search in the test | Identical |
| 200 random-state solves (max 21 moves, median 8 ms) | cubejs confirms each solution | Pass |
| 100 scrambles per level, distance inside each band | The solvers above | Pass |
| Scanner, 1,200 synthetic photographed cubes (daylight, warm bulb, cool LED, dim/noisy, glare spots) | Known ground truth | 1,200/1,200 exact |
| CIEDE2000 | Sharma, Wu & Dalal reference pairs | Pass |
| Custom background text contrast ≥ 4.5:1, 2,000 random colours | WCAG formula | Pass |
| Drag mapping for 6 gestures, solve flow, ghost race, share link, scanner, phone layout | Headless Chrome (Playwright) | Pass |
| Accessibility on every view, light and dark | axe-core (WCAG 2.1 AA rules) | 0 violations, except one deliberate brand choice: white text on orange #f26510 buttons and tabs is 3.2:1, below the 4.5:1 minimum for small text. The test accepts exactly that colour pair and nothing else. Using a deeper orange such as #c94a00 would pass. |
| Production build is installable and plays offline (network cut, new scramble still generated) | Chrome's installability check | Pass |
| Phone walkthrough with real touch events, CPU throttled 4×: solve by dragging, replay, stats, settings, arrows, hint, scanner, About | Headless Chrome, screenshots of every step reviewed | Pass; finger to next frame about 30 ms (2 frames), drag frames 16.7 ms |
| 200 keyboard moves at 12 TPS with the CPU throttled 4× | Chrome DevTools throttling and trace | 0 dropped moves; frame interval p95 17.6 ms, max 18.4 ms; main-thread work p95 1.3 ms |

### Still to check by hand

1. **Official WCA scrambler**: open `docs/tnoodle-check.png` and compare each net with TNoodle's image for the same scramble (`docs/tnoodle-scrambles.txt`). TNoodle needs Java, which isn't installed here.
2. **Physical cube**: apply a scramble to a real cube and compare it with the screen.
3. **Camera scan**: scan a real cube under your own light. The synthetic tests can't replace this.
4. **Real phone**: play on a mid-range Android phone. The performance numbers above come from desktop Chrome with throttling.
5. **People**: have one speedcuber and one first-timer play it.
