"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const subscribers = new Set<() => void>();

function notify() {
  subscribers.forEach((listener) => listener());
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  const iosNavigator = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || iosNavigator.standalone === true;
}

export function PwaRuntime() {
  useEffect(() => {
    installed = isStandalone();
    notify();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" })
        .then((registration) => registration.update())
        .catch(() => undefined);
    }

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      deferredPrompt = event as BeforeInstallPromptEvent;
      notify();
    };

    const onInstalled = () => {
      deferredPrompt = null;
      installed = true;
      notify();
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  return null;
}

export function InstallGlashaTile() {
  const [, rerender] = useState(0);
  const [help, setHelp] = useState<string | null>(null);

  useEffect(() => {
    const listener = () => rerender((value) => value + 1);
    subscribers.add(listener);
    installed = installed || isStandalone();
    return () => { subscribers.delete(listener); };
  }, []);

  async function install() {
    if (installed || isStandalone()) {
      installed = true;
      setHelp("Глаша уже запущена как установленное приложение.");
      notify();
      return;
    }

    if (deferredPrompt) {
      const prompt = deferredPrompt;
      deferredPrompt = null;
      await prompt.prompt();
      const result = await prompt.userChoice;
      if (result.outcome === "accepted") {
        setHelp("Установка запущена. Значок Глаши появится среди приложений.");
      } else {
        setHelp("Установку можно повторить позже из этого же раздела.");
      }
      notify();
      return;
    }

    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setHelp(
      isIOS
        ? "На iPhone/iPad: нажми «Поделиться» → «На экран Домой»."
        : "Открой меню браузера и выбери «Установить приложение» / «Установить Глашу»."
    );
  }

  const isInstalled = installed || isStandalone();

  return (
    <>
      <button
        type="button"
        className={`quickTile installTile ${isInstalled ? "installed" : ""}`}
        onClick={install}
        aria-describedby={help ? "pwa-install-help" : undefined}
      >
        <span>{isInstalled ? "✓" : "⬇"}</span>
        <b>{isInstalled ? "Глаша установлена" : "Установить Глашу"}</b>
      </button>
      {help ? <div id="pwa-install-help" className="installHelp">{help}</div> : null}
    </>
  );
}
