import type { AppLifecycleService } from "@ryco/client-runtime/platform";

export const webAppLifecycle: AppLifecycleService = {
  isForeground: () => typeof document === "undefined" || document.visibilityState !== "hidden",
  isOnline: () => typeof navigator === "undefined" || navigator.onLine !== false,
  subscribe: (listener) => {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return () => undefined;
    }
    const onVisibility = () =>
      listener(document.visibilityState === "hidden" ? "background" : "foreground");
    const onOffline = () => listener("offline");
    const onOnline = () => listener("online");
    const onPageShow = () => listener("resume");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pageshow", onPageShow);
    };
  },
};
