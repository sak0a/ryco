import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { installHostedConsoleBoundary, resetHostedConsoleBoundaryForTests } from "./logging";

const originals = {
  debug: console.debug,
  error: console.error,
  info: console.info,
  log: console.log,
  warn: console.warn,
};

afterEach(() => {
  Object.assign(console, originals);
  resetHostedConsoleBoundaryForTests();
});

describe("hosted console boundary", () => {
  it("drops sensitive values before a console or crash collector can receive them", () => {
    const collector = vi.fn();
    console.error = collector;
    installHostedConsoleBoundary();
    console.error("credential-sensitive-canary", { relayPayload: "payload-sensitive-canary" });
    expect(collector).not.toHaveBeenCalled();
  });
});
