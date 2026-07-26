import { describe, expect, it } from "vite-plus/test";

import { validateHubOrigin } from "./hubOrigin.ts";

describe("validateHubOrigin", () => {
  it("accepts a canonical HTTPS origin unchanged", () => {
    expect(validateHubOrigin("https://hub.example.com")).toEqual({
      ok: true,
      origin: "https://hub.example.com",
      normalized: false,
    });
  });

  // The whole point of validating in the desktop rather than handing the raw
  // string to the connector: these are things a person types, not different Hubs.
  it("normalizes the things people actually type", () => {
    for (const input of [
      "  https://hub.example.com  ",
      "https://hub.example.com/",
      "HTTPS://HUB.EXAMPLE.COM",
      "hub.example.com",
      "https://hub.example.com:443",
    ]) {
      const result = validateHubOrigin(input);
      expect(result, input).toMatchObject({ ok: true, origin: "https://hub.example.com" });
    }
  });

  it("reports a path rather than silently discarding it, and offers the bare origin", () => {
    // Silently stripping would change what the operator asked for without
    // saying so; a path is a different intent, not a typo.
    expect(validateHubOrigin("https://hub.example.com/nodes")).toEqual({
      ok: false,
      reason: "has_path",
      suggestion: "https://hub.example.com",
    });
    expect(validateHubOrigin("https://hub.example.com/?a=b")).toMatchObject({
      reason: "has_path",
    });
  });

  it("names each rejection distinctly so the field can explain itself", () => {
    expect(validateHubOrigin("")).toEqual({ ok: false, reason: "empty" });
    expect(validateHubOrigin("   ")).toEqual({ ok: false, reason: "empty" });
    expect(validateHubOrigin(`https://${"a".repeat(600)}.com`)).toEqual({
      ok: false,
      reason: "too_long",
    });
    expect(validateHubOrigin("http://hub.example.com")).toEqual({
      ok: false,
      reason: "insecure_scheme",
    });
    expect(validateHubOrigin("https://user:pw@hub.example.com")).toEqual({
      ok: false,
      reason: "has_credentials",
    });
  });

  it("allows loopback HTTP for development only", () => {
    expect(validateHubOrigin("http://127.0.0.1:8787")).toMatchObject({ ok: true });
    expect(validateHubOrigin("http://localhost:8787")).toMatchObject({ ok: true });
    expect(validateHubOrigin("http://192.168.1.10:8787")).toEqual({
      ok: false,
      reason: "insecure_scheme",
    });
  });
});
