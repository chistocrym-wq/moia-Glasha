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

function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function PwaRuntime() {
  const [online, setOnline] = useState(true);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    installed = isStandalone();
    setOnline(navigator.onLine);
    notify();

    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

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

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (sessionStorage.getItem("glasha-pwa-updating") === "1") {
          sessionStorage.removeItem("glasha-pwa-updating");
          window.location.reload();
        }
      });

      navigator.serviceWorker.register("/sw.js", { scope: "/" })
        .then((nextRegistration) => {
          setRegistration(nextRegistration);
          if (nextRegistration.waiting && navigator.serviceWorker.controller) {
            setUpdateAvailable(true);
          }

          nextRegistration.addEventListener("updatefound", () => {
            const worker = nextRegistration.installing;
            if (!worker) return;
            worker.addEventListener("statechange", () => {
              if (worker.state === "installed" && navigator.serviceWorker.controller) {
                setUpdateAvailable(true);
              }
            });
          });

          void nextRegistration.update();
        })
        .catch((error) => {
          console.error("service_worker_registration_failed", error);
        });
    }

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function applyUpdate() {
    if (!registration?.waiting) return;
    sessionStorage.setItem("glasha-pwa-updating", "1");
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
  }

  return (
    <>
      {!online && (
        <div className="pwaRuntimeBanner offline" role="status">
          Нет подключения к интернету. Сохранённые онлайн-функции временно недоступны.
        </div>
      )}
      {updateAvailable && (
        <div className="pwaRuntimeBanner update" role="status">
          <span>Доступно обновление Глаши.</span>
          <button type="button" onClick={applyUpdate}>Обновить</button>
        </div>
      )}
    </>
  );
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
    if (installed || isStandalone()) return;

    if (deferredPrompt) {
      const prompt = deferredPrompt;
      deferredPrompt = null;
      await prompt.prompt();
      const result = await prompt.userChoice;
      if (result.outcome === "accepted") {
        setHelp("Установка запущена.");
      } else {
        setHelp("Установка отменена.");
      }
      notify();
      return;
    }

    if (isIOS()) {
      setHelp("На iPhone/iPad: Safari → Поделиться → «На экран Домой».");
    }
  }

  const isInstalled = installed || isStandalone();
  if (isInstalled) return null;

  const canPrompt = Boolean(deferredPrompt);
  const canGuideIOS = isIOS();
  if (!canPrompt && !canGuideIOS) return null;

  return (
    <>
      <button
        type="button"
        className="quickTile installTile"
        onClick={install}
        aria-describedby={help ? "pwa-install-help" : undefined}
      >
        <span>⬇</span>
        <b>Установить Глашу</b>
      </button>
      {help ? <div id="pwa-install-help" className="installHelp">{help}</div> : null}
    </>
  );
}
