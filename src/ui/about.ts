// About U.CUBE — opened from the logo.

import "@fontsource/mrs-saint-delafield/latin-400.css";
import { ICONS } from "./icons";
import { logoSvg } from "./logo";

export function openAbout(host: HTMLElement, onClose: () => void) {
  host.innerHTML = `
    <div class="about-card card" role="document">
      <button class="icon-btn about-close" aria-label="Close">${ICONS.close}</button>
      <div class="about-logo">${logoSvg({ animate: true, onPage: true, id: "about", title: "U.CUBE logo" })}</div>
      <h2 id="about-title"><b class="u">U</b><span class="dot">.</span>CUBE <span>say it: you-cubed</span></h2>
      <p class="about-lead">A 3D cube where difficulty is real distance. Every scramble is graded by its shortest solution, proven exactly up to ten moves.</p>
      <p class="about-body">Race the clock under WCA rules, replay any solve stage by stage, race your own ghost, or scan the cube on your desk and let U.CUBE walk you to solved, one turn at a time.</p>
      <ul class="about-facts">
        <li><b>20</b><span>moves solve any position</span></li>
        <li><b>43 quintillion</b><span>possible positions</span></li>
        <li><b>≤ 10</b><span>moves: distance proven exactly</span></li>
      </ul>
      <div class="signature" role="img" aria-label="Signed, M.Yousri">
        <span class="sig-name" aria-hidden="true">M.Yousri</span>
        <svg class="sig-flourish" viewBox="0 0 260 40" aria-hidden="true"><path d="M8 26 C 60 34, 120 10, 170 22 S 240 30, 252 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
      </div>
      <button class="btn about-share" type="button">Share U.CUBE</button>
      <p class="about-credit">Designed &amp; built by M.Yousri · ${new Date().getFullYear()}</p>
    </div>`;
  host.hidden = false;
  const close = () => {
    host.hidden = true;
    host.innerHTML = "";
    document.removeEventListener("keydown", onKey);
    onClose();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener("keydown", onKey, true);
  host.querySelector<HTMLButtonElement>(".about-close")!.onclick = close;
  host.querySelector<HTMLButtonElement>(".about-share")!.onclick = async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const url = `${location.origin}${location.pathname}`;
    const data = { title: "U.CUBE", text: "A 3D cube where difficulty is real distance. Can you find the shortest solution?", url };
    try {
      if (navigator.share) await navigator.share(data);
      else {
        await navigator.clipboard.writeText(url);
        btn.textContent = "Link copied";
      }
    } catch {
      /* the player closed the share sheet */
    }
  };
  host.onclick = (e) => {
    if (e.target === host) close();
  };
  host.querySelector<HTMLButtonElement>(".about-close")!.focus();
}
