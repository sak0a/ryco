import { describe, expect, it } from "vite-plus/test";

import {
  deriveHostedConnectionStatusText,
  type HostedConnectionStatusInput,
} from "./connectionStatus";

function input(overrides: Partial<HostedConnectionStatusInput>): HostedConnectionStatusInput {
  return {
    browserStatus: "current",
    sessionStatus: "ready",
    selectionStatus: "online",
    transportStatus: "online",
    ...overrides,
  };
}

describe("deriveHostedConnectionStatusText", () => {
  it("keeps the bounded status vocabulary in the documented precedence order", () => {
    expect(deriveHostedConnectionStatusText(input({}))).toBe("Online");
    expect(deriveHostedConnectionStatusText(input({ browserStatus: "offline" }))).toBe("Offline");
    expect(deriveHostedConnectionStatusText(input({ browserStatus: "checking-access" }))).toBe(
      "Checking access",
    );
    expect(deriveHostedConnectionStatusText(input({ browserStatus: "synchronizing" }))).toBe(
      "Synchronizing",
    );
    expect(deriveHostedConnectionStatusText(input({ browserStatus: "suspended" }))).toBe("Stale");
    expect(deriveHostedConnectionStatusText(input({ browserStatus: "stale" }))).toBe("Stale");
    expect(deriveHostedConnectionStatusText(input({ sessionStatus: "delivery-unknown" }))).toBe(
      "Delivery unknown",
    );
    expect(
      deriveHostedConnectionStatusText(
        input({ sessionStatus: "stale", selectionStatus: "authorization-removed" }),
      ),
    ).toBe("Authorization removed");
    expect(
      deriveHostedConnectionStatusText(
        input({ sessionStatus: "stale", selectionStatus: "revoked" }),
      ),
    ).toBe("Revoked");
    expect(
      deriveHostedConnectionStatusText(
        input({ sessionStatus: "stale", selectionStatus: "incompatible" }),
      ),
    ).toBe("Incompatible");
    expect(
      deriveHostedConnectionStatusText(
        input({ sessionStatus: "stale", transportStatus: "reconnecting" }),
      ),
    ).toBe("Reconnecting");
    expect(
      deriveHostedConnectionStatusText(
        input({ sessionStatus: "stale", transportStatus: "idle", selectionStatus: "offline" }),
      ),
    ).toBe("Offline");
  });

  it("browser lifecycle status wins over session and selection states", () => {
    expect(
      deriveHostedConnectionStatusText(
        input({ browserStatus: "offline", sessionStatus: "delivery-unknown" }),
      ),
    ).toBe("Offline");
    expect(
      deriveHostedConnectionStatusText(
        input({ browserStatus: "checking-access", selectionStatus: "revoked" }),
      ),
    ).toBe("Checking access");
  });

  it("falls back to the hyphen-expanded transport status only for uncovered states", () => {
    expect(
      deriveHostedConnectionStatusText(
        input({
          sessionStatus: "stale",
          selectionStatus: "online",
          transportStatus: "terminal-failure",
        }),
      ),
    ).toBe("terminal failure");
  });
});
