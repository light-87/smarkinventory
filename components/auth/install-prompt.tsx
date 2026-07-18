"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

/** Chrome/Android's non-standard `beforeinstallprompt` event — not yet in lib.dom.d.ts. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function getIsStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

/** display-mode can flip live (installed while the tab is open) — worth actually subscribing to. */
function subscribeStandalone(onChange: () => void): () => void {
  const mql = window.matchMedia("(display-mode: standalone)");
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function isIosUserAgent(): boolean {
  return typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * PWA install prompt (CLAUDE.md PWA checklist, lives on THIS login page):
 * Android gets the real `beforeinstallprompt` button; iOS (which never
 * fires that event) gets a static "Share → Add to Home Screen" card.
 * Renders nothing once already installed/standalone.
 *
 * `useSyncExternalStore` (not `useState` + effect) reads the standalone
 * display-mode: the server snapshot always says "installed" so the server
 * render + the first client render agree (both render nothing) — no
 * hydration mismatch, and no synchronous setState-from-effect to trigger
 * react-hooks/set-state-in-effect. Once the client's real value is known,
 * React reconciles to it on its own.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const standalone = useSyncExternalStore(subscribeStandalone, getIsStandalone, () => true);

  useEffect(() => {
    // Subscribing to an external event and setting state from its callback —
    // the pattern react-hooks/set-state-in-effect explicitly calls out as fine.
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (standalone) return null;

  if (deferred) {
    return (
      <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-charcoal bg-surface-panel px-4 py-3">
        <span className="text-[15px] text-silver-mist">Install SmarkStock on this device</span>
        <Button
          variant="accent-outline"
          size="sm"
          onClick={async () => {
            await deferred.prompt();
            await deferred.userChoice;
            setDeferred(null);
          }}
        >
          Install app
        </Button>
      </div>
    );
  }

  if (isIosUserAgent()) {
    return (
      <div className="mt-5 rounded-xl border border-charcoal bg-surface-panel px-4 py-3 text-[15px] text-silver-mist">
        Install this app: tap <span className="text-snow">Share</span>, then{" "}
        <span className="text-snow">“Add to Home Screen”</span>.
      </div>
    );
  }

  return null;
}
