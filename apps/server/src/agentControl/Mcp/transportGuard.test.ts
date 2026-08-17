import { describe, expect, it } from "vite-plus/test";

import {
  AGENT_CONTROL_MCP_PATH,
  isLoopbackRemoteAddress,
  rejectAgentControlMcpTransport,
  type AgentControlMcpTransportInput,
} from "./transportGuard.ts";

const admitted: AgentControlMcpTransportInput = {
  method: "POST",
  pathname: AGENT_CONTROL_MCP_PATH,
  remoteAddress: "127.0.0.1",
  origin: undefined,
  contentType: "application/json",
  hasCookieHeader: false,
  hasDpopHeader: false,
  hasDesktopControlHeader: false,
};

describe("rejectAgentControlMcpTransport", () => {
  it("admits a loopback MCP POST with no browser or hub auth surfaces", () => {
    expect(rejectAgentControlMcpTransport(admitted)).toBeNull();
    expect(rejectAgentControlMcpTransport({ ...admitted, remoteAddress: "::1" })).toBeNull();
    expect(
      rejectAgentControlMcpTransport({ ...admitted, remoteAddress: "::ffff:127.0.0.1" }),
    ).toBeNull();
  });

  it("rejects non-loopback remote addresses", () => {
    for (const remoteAddress of ["192.168.1.20", "10.0.0.5", "0.0.0.0", undefined]) {
      expect(rejectAgentControlMcpTransport({ ...admitted, remoteAddress })?.status).toBe(403);
    }
  });

  it("rejects every browser-originated request outright (no CORS, ever)", () => {
    for (const origin of ["https://app.example.com", "http://localhost:5173", "null"]) {
      expect(rejectAgentControlMcpTransport({ ...admitted, origin })?.status).toBe(403);
    }
  });

  it("rejects hub/browser/desktop-style authorization surfaces", () => {
    expect(rejectAgentControlMcpTransport({ ...admitted, hasCookieHeader: true })?.status).toBe(
      403,
    );
    expect(rejectAgentControlMcpTransport({ ...admitted, hasDpopHeader: true })?.status).toBe(403);
    expect(
      rejectAgentControlMcpTransport({ ...admitted, hasDesktopControlHeader: true })?.status,
    ).toBe(403);
  });

  it("rejects unknown paths and non-POST methods", () => {
    expect(rejectAgentControlMcpTransport({ ...admitted, pathname: "/" })?.status).toBe(404);
    expect(rejectAgentControlMcpTransport({ ...admitted, pathname: "/ws" })?.status).toBe(404);
    for (const method of ["GET", "DELETE", "PUT", "OPTIONS", undefined]) {
      expect(rejectAgentControlMcpTransport({ ...admitted, method })?.status).toBe(405);
    }
  });

  it("rejects non-JSON content types", () => {
    for (const contentType of ["text/plain", "application/x-www-form-urlencoded", undefined]) {
      expect(rejectAgentControlMcpTransport({ ...admitted, contentType })?.status).toBe(415);
    }
  });
});

describe("isLoopbackRemoteAddress", () => {
  it("accepts loopback shapes only", () => {
    expect(isLoopbackRemoteAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackRemoteAddress("::1")).toBe(true);
    expect(isLoopbackRemoteAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackRemoteAddress("127.0.0.2")).toBe(false);
    expect(isLoopbackRemoteAddress("192.168.0.10")).toBe(false);
    expect(isLoopbackRemoteAddress(undefined)).toBe(false);
  });
});
