type ConsoleMethod = "debug" | "error" | "info" | "log" | "warn";

let installed = false;

/**
 * Hosted pages must never forward node payloads or authentication material to
 * browser logs or a console-capturing crash reporter. Existing feature code
 * was written for a local trusted client and sometimes logs caught values, so
 * hosted mode installs a fail-closed console sink before authentication.
 */
export function installHostedConsoleBoundary(): void {
  if (installed || typeof console === "undefined") return;
  installed = true;
  for (const method of [
    "debug",
    "error",
    "info",
    "log",
    "warn",
  ] as const satisfies ReadonlyArray<ConsoleMethod>) {
    console[method] = () => undefined;
  }
}

export function resetHostedConsoleBoundaryForTests(): void {
  installed = false;
}
