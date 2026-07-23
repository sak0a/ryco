import type { ClockService, FrameSchedulerService } from "@ryco/client-runtime/platform";

export const webClock: ClockService = {
  now: () =>
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now(),
};

export const webFrameScheduler: FrameSchedulerService = {
  scheduleFrame: (callback) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => callback());
      return;
    }
    setTimeout(callback, 0);
  },
};
