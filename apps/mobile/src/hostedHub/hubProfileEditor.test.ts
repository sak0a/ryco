import { describe, expect, it, vi } from "vite-plus/test";

import type { HubCapabilityCheck } from "./hubCapability";
import {
  createHubProfileEditor,
  hubOriginFailureText,
  hubProfileEditorFailureText,
} from "./hubProfileEditor";

const ORIGIN = "https://hub.ryco.dev";

function compatible(
  checkedAt = 123,
): Extract<HubCapabilityCheck, { readonly status: "compatible" }> {
  return {
    status: "compatible",
    checkedAt,
    capability: {
      protocolVersion: 1,
      nativeHandoff: { mode: "system-browser", version: 1 },
      relyingParty: { id: "hub.ryco.dev", displayName: "Studio Hub" },
    },
  };
}

describe("Hub profile editor", () => {
  it("validates before I/O and exposes bounded origin copy", async () => {
    const check = vi.fn(async () => compatible());
    const editor = createHubProfileEditor({ check, allowInsecure: false });

    const result = await editor.check({ origin: "hub.ryco.dev", label: "" });

    expect(result).toEqual({ status: "invalid", generation: 1, reason: "invalid-url" });
    expect(check).not.toHaveBeenCalled();
    expect(hubProfileEditorFailureText(result)).toBe(hubOriginFailureText("invalid-url"));
    expect(hubProfileEditorFailureText(result).length).toBeLessThanOrEqual(180);
  });

  it("constructs the exact compatible bounded profile", async () => {
    const editor = createHubProfileEditor({
      check: async () => compatible(),
      allowInsecure: false,
    });

    await expect(editor.check({ origin: ` ${ORIGIN}/ `, label: "" })).resolves.toEqual({
      status: "compatible",
      generation: 1,
      profile: {
        origin: ORIGIN,
        label: "Studio Hub",
        compatibility: {
          status: "compatible",
          checkedAt: 123,
          protocolVersion: 1,
          handoffVersion: 1,
          relyingPartyId: "hub.ryco.dev",
        },
      },
    });
  });

  it("projects incompatibility through the existing capability vocabulary", async () => {
    const editor = createHubProfileEditor({
      check: async () => ({
        status: "incompatible",
        checkedAt: 123,
        reason: "unsupported-handoff",
      }),
      allowInsecure: false,
    });
    const result = await editor.check({ origin: ORIGIN, label: "Hub" });

    expect(result).toEqual({
      status: "incompatible",
      generation: 1,
      reason: "unsupported-handoff",
    });
    expect(hubProfileEditorFailureText(result)).toBe(
      "This Hub does not support the required system-browser handoff.",
    );
  });

  it("aborts and fences a late response when a newer origin is checked", async () => {
    const releases: Array<(result: HubCapabilityCheck) => void> = [];
    const signals: AbortSignal[] = [];
    const editor = createHubProfileEditor({
      check: (_origin, signal) => {
        signals.push(signal!);
        return new Promise((resolve) => releases.push(resolve));
      },
      allowInsecure: false,
    });

    const first = editor.check({ origin: ORIGIN, label: "First" });
    const second = editor.check({ origin: "https://other.ryco.dev", label: "Second" });
    expect(signals[0]?.aborted).toBe(true);

    releases[1]?.({
      ...compatible(456),
      capability: {
        ...compatible().capability,
        relyingParty: { id: "ryco.dev", displayName: "Other Hub" },
      },
    });
    await expect(second).resolves.toMatchObject({
      status: "compatible",
      generation: 2,
      profile: { origin: "https://other.ryco.dev", label: "Second" },
    });

    releases[0]?.(compatible());
    await expect(first).resolves.toEqual({ status: "stale", generation: 1 });
  });

  it("invalidates an in-flight result when the draft changes without a new check", async () => {
    let release: ((result: HubCapabilityCheck) => void) | undefined;
    const editor = createHubProfileEditor({
      check: () => new Promise((resolve) => (release = resolve)),
      allowInsecure: false,
    });

    const pending = editor.check({ origin: ORIGIN, label: "Hub" });
    editor.invalidate();
    release?.(compatible());

    await expect(pending).resolves.toEqual({ status: "stale", generation: 1 });
    expect(editor.generation()).toBe(2);
  });
});
