// "Install app" — one tap where the browser supports installing web apps
// (Chrome/Edge on Android, Windows, Mac, Linux), step-by-step help on Safari,
// and nothing at all once U.CUBE is already running as an installed app.

import { ICONS } from "./icons";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const isSafari = /Safari/.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg\//.test(ua);
const isMacSafari = isSafari && !isIOS && /Macintosh/.test(ua);

export function isInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function setupInstall(button: HTMLButtonElement, sheetHost: HTMLElement, toast: (m: string) => void) {
  let deferred: InstallPromptEvent | null = null;
  const show = (on: boolean) => (button.hidden = !on || isInstalled());

  // Safari has no install prompt: offer the manual steps instead.
  show(isIOS || isMacSafari);

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep the browser's mini-bar away; we offer our own button
    deferred = e as InstallPromptEvent;
    show(true);
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    show(false);
    toast("U.CUBE installed");
  });

  button.onclick = async () => {
    if (deferred) {
      const ev = deferred;
      deferred = null;
      await ev.prompt();
      const { outcome } = await ev.userChoice;
      if (outcome === "accepted") show(false);
      return;
    }
    openSteps(sheetHost, button);
  };
}

const SHARE_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-3px"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>`;

function openSteps(host: HTMLElement, returnFocus: HTMLElement) {
  const steps = isIOS
    ? [`Tap the <b>Share</b> button ${SHARE_ICON} in Safari's toolbar.`, "Scroll down and choose <b>Add to Home Screen</b>.", "Tap <b>Add</b>. U.CUBE appears on your home screen and works offline."]
    : isMacSafari
      ? ["In Safari's menu bar choose <b>File → Add to Dock…</b>", "Click <b>Add</b>. U.CUBE opens in its own window and works offline."]
      : ["Open this page in <b>Chrome</b> or <b>Edge</b>.", "Use the install icon at the right of the address bar."];
  host.innerHTML = `
    <div class="about-card card install-card" role="document">
      <button class="icon-btn about-close" aria-label="Close">${ICONS.close}</button>
      <h2 id="install-title">Install U.CUBE</h2>
      <p class="about-body">Get it on your ${isIOS ? "home screen" : "computer"}: full screen, its own icon, and it plays without internet.</p>
      <ol class="install-steps">${steps.map((s) => `<li>${s}</li>`).join("")}</ol>
      <button class="btn primary install-done" type="button">Got it</button>
    </div>`;
  host.setAttribute("aria-labelledby", "install-title");
  host.hidden = false;
  const close = () => {
    host.hidden = true;
    host.innerHTML = "";
    document.removeEventListener("keydown", onKey, true);
    returnFocus.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener("keydown", onKey, true);
  host.onclick = (e) => {
    if (e.target === host) close();
  };
  host.querySelector<HTMLButtonElement>(".about-close")!.onclick = close;
  host.querySelector<HTMLButtonElement>(".install-done")!.onclick = close;
  host.querySelector<HTMLButtonElement>(".install-done")!.focus();
}
