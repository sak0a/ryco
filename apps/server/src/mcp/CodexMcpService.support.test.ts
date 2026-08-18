import { ProviderDriverKind } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import { mcpSupportForDriver } from "./CodexMcpService.ts";

describe("user-managed MCP support matrix", () => {
  it("keeps existing provider configuration ownership separate from Agent Control injection", () => {
    expect(mcpSupportForDriver(ProviderDriverKind.make("codex")).status).toBe("managed");
    expect(mcpSupportForDriver(ProviderDriverKind.make("claudeAgent")).status).toBe("external");
    expect(mcpSupportForDriver(ProviderDriverKind.make("copilot")).status).toBe("external");
    expect(mcpSupportForDriver(ProviderDriverKind.make("opencode")).status).toBe("external");
    const cursor = mcpSupportForDriver(ProviderDriverKind.make("cursor"));
    expect(cursor.status).toBe("unsupported");
    expect(cursor.message).toContain("user-managed MCP configuration");
    expect(cursor.message).toContain("private internal Agent Control server");
  });
});
