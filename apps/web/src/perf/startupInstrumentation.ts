const STARTUP_PREFIX = "ryco:startup:";

export type StartupPhase =
  | "root-before-load-start"
  | "root-before-load-ready"
  | "primary-ws-open"
  | "primary-shell-snapshot-received"
  | "primary-shell-snapshot-applied"
  | "primary-shell-usable";

function canUsePerformance(): boolean {
  return typeof performance !== "undefined" && typeof performance.mark === "function";
}

export function makeStartupMarkName(phase: StartupPhase): string {
  return `${STARTUP_PREFIX}${phase}`;
}

export function markStartupPhase(phase: StartupPhase): void {
  if (!canUsePerformance()) return;
  try {
    performance.mark(makeStartupMarkName(phase));
  } catch {
    // Startup instrumentation must never affect startup behavior.
  }
}

export function measureStartupPhase(
  name: string,
  startPhase: StartupPhase,
  endPhase: StartupPhase,
): void {
  if (!canUsePerformance() || typeof performance.measure !== "function") return;
  try {
    performance.measure(`${STARTUP_PREFIX}${name}`, {
      start: makeStartupMarkName(startPhase),
      end: makeStartupMarkName(endPhase),
    });
  } catch {
    // Missing marks are expected on partial startup paths.
  }
}
