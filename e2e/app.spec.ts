import { test } from "@playwright/test";
import AxeBuilder from "./axe";
import { boot, drag, expect, expected, facelets, press, solutionKeys, stickerXY, waitStatus } from "./helpers";

const SOLVED = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";

test("every level produces a scramble at its stated distance, without errors", async ({ page }) => {
  const errors = await boot(page);
  for (const level of ["warmup", "easy", "medium", "hard", "expert"]) {
    await page.click(`[data-level="${level}"]`);
    await waitStatus(page, "ready", "inspecting");
    const s = await page.evaluate(() => window.__u3.game.scramble);
    const badge = await page.locator("#distance-badge").textContent();
    if (s.optimal !== null) expect(badge).toBe(`Solvable in ${s.optimal}`);
    expect(await facelets(page)).toBe(await expected(page, s.alg));
  }
  expect(errors).toEqual([]);
});

test("solve with the keyboard: timer, result card, stats and replay", async ({ page }) => {
  await boot(page);
  await page.click('[data-level="easy"]');
  await waitStatus(page, "ready");
  const alg: string = await page.evaluate(() => window.__u3.game.scramble.alg);
  await press(page, solutionKeys(alg), 150);
  await waitStatus(page, "solved");
  await expect(page.locator("#result")).toBeVisible();
  const rec = await page.evaluate(() => window.__u3.game.last);
  expect(rec.timeMs).toBeGreaterThan(0);
  expect(rec.htm).toBeLessThanOrEqual(alg.split(" ").length);
  expect(await facelets(page)).toBe(SOLVED);

  // stats panel lists it
  await page.click('[data-action="stats"]');
  await expect(page.locator(".solve-list li")).toHaveCount(1);
  await page.click('[data-p="close"]');

  // replay reproduces the solve
  await page.click('[data-r="replay"]');
  await expect(page.locator("#replay-bar")).toBeVisible();
  await page.waitForFunction(() => {
    const r = document.querySelector<HTMLInputElement>("#rp-seek");
    return r && Number(r.value) >= Number(r.max) - 1;
  }, undefined, { timeout: 20_000 });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__u3.stage.cube.state.join(","))).toBe(
    await page.evaluate(() => window.__u3.game.state.join(",")),
  );
});

test("dragging a sticker turns the layer under it, in the direction dragged", async ({ page }) => {
  await boot(page);
  const cases: [number, number, string, boolean][] = [
    // [from sticker, toward sticker, expected move, extend one more sticker past the target]
    [20, 26, "R'", false], // front-right column, downward
    [19, 18, "U", true], // front top row, to the left
    [22, 23, "E", true], // front center, to the right (middle slice)
    [9, 15, "F", false], // right face front column, downward
    [8, 2, "R", false], // top face, away from the viewer
    [24, 25, "D", true], // front bottom row, to the right
  ];
  for (const [a, b, move, extend] of cases) {
    await page.evaluate(() => window.__u3.game.reset());
    const A = await stickerXY(page, a);
    const B = await stickerXY(page, b);
    const to: [number, number] = extend ? [2 * B[0] - A[0], 2 * B[1] - A[1]] : B;
    await drag(page, A, to);
    expect(await facelets(page), `drag ${a}→${b} should be ${move}`).toBe(await expected(page, move));
  }
});

test("race your ghost on the same scramble", async ({ page }) => {
  await boot(page);
  await page.click('[data-level="warmup"]');
  await waitStatus(page, "ready");
  const alg: string = await page.evaluate(() => window.__u3.game.scramble.alg);
  await press(page, solutionKeys(alg), 300);
  await waitStatus(page, "solved");
  await page.click('[data-r="race"]');
  await waitStatus(page, "ready");
  expect(await page.evaluate(() => window.__u3.game.scramble.alg)).toBe(alg);
  await expect(page.locator("#ghost-label")).toBeVisible();
  await press(page, solutionKeys(alg), 60);
  await waitStatus(page, "solved");
  await expect(page.locator(".verdict")).toContainText("ghost");
});

test("a share link opens the replay", async ({ page }) => {
  await boot(page);
  await page.click('[data-level="warmup"]');
  await waitStatus(page, "ready");
  const alg: string = await page.evaluate(() => window.__u3.game.scramble.alg);
  await press(page, solutionKeys(alg), 150);
  await waitStatus(page, "solved");
  const code = await page.evaluate(() => window.__u3.shareCode(window.__u3.game.last));
  await page.goto(`/#replay=${code}`);
  await expect(page.locator("#replay-bar")).toBeVisible();
  await expect(page.locator("#rp-race")).toBeVisible();
});

test("scanner: enter a cube by hand, follow every step, end solved", async ({ page }) => {
  await boot(page);
  const scramble = "R U R' U' F2 D L2 B U2 F' R D'";
  const target = await expected(page, scramble);
  await page.click('[data-action="scan"]');
  await page.click('[data-s="manual"]');
  // an impossible cube is rejected with a reason
  for (let i = 0; i < 54; i++) {
    if (i % 9 === 4) continue;
    await page.evaluate(([i, c]) => {
      document.querySelector(`#review-net [data-i="${i}"]`)!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      document.querySelector<HTMLButtonElement>(`.palette [data-c="${c}"]`)!.click();
    }, [i, target[i]] as const);
  }
  await expect(page.locator(".review-msg")).toHaveText("Looks like a real cube.");
  // twist one corner in place → must be refused
  await page.evaluate(() => {
    const click = (i: number, c: string) => {
      document.querySelector(`#review-net [data-i="${i}"]`)!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      document.querySelector<HTMLButtonElement>(`.palette [data-c="${c}"]`)!.click();
    };
    const f = window.__u3.expected("R U R' U' F2 D L2 B U2 F' R D'");
    // URF corner stickers 8, 9, 20 rotated by one
    click(8, f[20]);
    click(9, f[8]);
    click(20, f[9]);
  });
  await expect(page.locator(".review-msg")).toContainText("can't come from a real cube");
  await expect(page.locator('[data-s="solve"]')).toBeDisabled();
  // fix it back
  await page.evaluate(() => {
    const click = (i: number, c: string) => {
      document.querySelector(`#review-net [data-i="${i}"]`)!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      document.querySelector<HTMLButtonElement>(`.palette [data-c="${c}"]`)!.click();
    };
    const f = window.__u3.expected("R U R' U' F2 D L2 B U2 F' R D'");
    click(8, f[8]);
    click(9, f[9]);
    click(20, f[20]);
  });
  await page.click('[data-s="solve"]');
  await expect(page.locator(".guide-move")).toBeVisible();
  const steps = await page.locator(".guide-list button").count();
  expect(steps).toBeGreaterThan(0);
  expect(steps).toBeLessThanOrEqual(21);
  // apply the guide's moves ourselves, like a person would on a real cube
  const moves = await page.locator(".guide-list button").allTextContents();
  const applied = await page.evaluate(
    ([s, m]) => window.__u3.expected(s + " " + m),
    [scramble, moves.join(" ").replace(/′/g, "'")] as const,
  );
  expect(applied).toBe(SOLVED);
  for (let k = 0; k < steps; k++) await page.click('[data-s="next"]');
  await expect(page.locator("#scan-title")).toHaveText("Solved");
});

test("phone layout: everything reachable, no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await boot(page);
  await page.click('[data-action="new"]');
  await waitStatus(page, "ready", "inspecting");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  for (const sel of ['[data-action="new"]', '[data-action="hint"]', '[data-action="stats"]', '[data-level="expert"]', "#timer"])
    await expect(page.locator(sel)).toBeInViewport();
  await page.screenshot({ path: "test-results/phone.png" });
});

test("logo opens About, signed M.Yousri; Esc closes it", async ({ page }) => {
  await boot(page);
  await page.click("#brand");
  await expect(page.locator("#about")).toBeVisible();
  await expect(page.locator(".signature")).toHaveAttribute("aria-label", "Signed, M.Yousri");
  await expect(page.locator(".about-credit")).toContainText("M.Yousri");
  await page.keyboard.press("Escape");
  await expect(page.locator("#about")).toBeHidden();
});

test("optional arrows: tap a face, turn it; side arrows rotate the cube", async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("u3.settings", JSON.stringify({ arrows: true }));
      sessionStorage.setItem("seeded", "1");
    }
  });
  await boot(page);
  await expect(page.locator(".nav-arrow")).toHaveCount(4);
  const [x, y] = await stickerXY(page, 22); // front center
  await page.mouse.click(x, y);
  await expect(page.locator(".turn-arrow[data-turn='1']")).toBeVisible();
  await expect(page.locator(".turn-arrow[data-turn='1']")).toHaveAttribute("aria-label", /front face clockwise/);
  await page.click(".turn-arrow[data-turn='1']");
  await page.waitForTimeout(300);
  expect(await facelets(page)).toBe(await expected(page, "F"));
  await page.click(".turn-arrow[data-turn='-1']");
  await page.waitForTimeout(300);
  expect(await facelets(page)).toBe(await expected(page, "F F'"));
  await page.click('.nav-arrow[data-rot="y"]');
  await page.waitForTimeout(300);
  expect(await facelets(page)).toBe(await expected(page, "y"));
  // arrows are off by default
  await page.evaluate(() => localStorage.setItem("u3.settings", "{}"));
  await page.reload();
  await page.waitForFunction(() => !!window.__u3);
  await expect(page.locator(".arrows")).toBeHidden();
});

/**
 * The one accepted exception, chosen by the designer: white text on the brand
 * orange #f26510 (3.2:1). It is matched by exact colours so nothing else slips through.
 */
type AxeNode = { target: unknown; any?: { data?: { fgColor?: string; bgColor?: string } }[] };
function withoutBrandException(vs: { id: string; nodes: unknown[] }[]) {
  return vs
    .map((v) => ({
      id: v.id,
      nodes: (v.nodes as AxeNode[]).filter((n) => {
        const d = n.any?.[0]?.data;
        return !(v.id === "color-contrast" && d?.bgColor === "#f26510" && d?.fgColor === "#ffffff");
      }),
    }))
    .filter((v) => v.nodes.length > 0);
}

test("accessibility: no axe violations on the main views", async ({ page }) => {
  await boot(page);
  await page.waitForTimeout(800); // let entrance transitions finish
  const check = async (name: string) => {
    const r = await new AxeBuilder(page).analyze();
    expect(withoutBrandException(r.violations).map((v) => `${name}: ${v.id} ${JSON.stringify(v.nodes.map((n) => n.target))}`)).toEqual([]);
  };
  await check("home");
  await page.click('[data-action="new"]');
  await waitStatus(page, "ready", "inspecting");
  await check("solving");
  for (const p of ["stats", "settings", "help"]) {
    await page.click(`[data-action="${p}"]`);
    await page.waitForTimeout(500); // panel slide-in
    await check(p);
    await page.click('[data-p="close"]');
  }
  await page.click('[data-action="scan"]');
  await page.waitForTimeout(400);
  await check("scan intro");
  await page.click('[data-s="manual"]');
  await check("scan review");
  await page.click('[data-s="close"]');
  await page.click("#brand");
  await page.waitForTimeout(3500);
  await check("about");
});

test("accessibility in dark mode with arrows and a preset background", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => localStorage.setItem("u3.settings", JSON.stringify({ arrows: true, background: "ocean" })));
  await boot(page);
  await page.waitForTimeout(800);
  const r = await new AxeBuilder(page).analyze();
  expect(withoutBrandException(r.violations).map((v) => v.id)).toEqual([]);
});
