type ConsoleMethod = "debug" | "error" | "info" | "log" | "warn";

let installed = false;
let originals: Record<ConsoleMethod, (...args: ReadonlyArray<unknown>) => void> | null = null;

/**
 * Hosted pages must never forward node payloads or authentication material to
 * browser logs or a console-capturing crash reporter. Existing feature code
 * was written for a local trusted client and sometimes logs caught values, so
 * hosted mode installs a fail-closed console sink before authentication.
 */
export function installHostedConsoleBoundary(): void {
  if (installed || typeof console === "undefined") return;
  installed = true;
  const methods = [
    "debug",
    "error",
    "info",
    "log",
    "warn",
  ] as const satisfies ReadonlyArray<ConsoleMethod>;
  const consoleMethods = console as unknown as Record<
    ConsoleMethod,
    (...args: ReadonlyArray<unknown>) => void
  >;
  originals = Object.fromEntries(
    methods.map((method) => [method, consoleMethods[method]]),
  ) as Record<ConsoleMethod, (...args: ReadonlyArray<unknown>) => void>;
  for (const method of methods) {
    consoleMethods[method] = () => undefined;
  }
}

export function resetHostedConsoleBoundaryForTests(): void {
  if (originals) Object.assign(console, originals);
  originals = null;
  installed = false;
}
