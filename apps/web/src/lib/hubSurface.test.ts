import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  HUB_SURFACE_ATTRIBUTE,
  HUB_SURFACE_VALUE,
  isHubSurface,
  syncDocumentHubSurface,
} from "./hubSurface";

/** A documentElement that records only what `setAttribute` actually wrote. */
function stubDocument(): { attributes: Map<string, string> } {
  const attributes = new Map<string, string>();
  vi.stubGlobal("document", {
    documentElement: {
      setAttribute: (name: string, value: string) => {
        attributes.set(name, value);
      },
      getAttribute: (name: string) => attributes.get(name) ?? null,
    },
  });
  return { attributes };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("syncDocumentHubSurface", () => {
  it("stamps the Hub surface attribute in a hosted-hub build", () => {
    vi.stubEnv("VITE_RYCO_CLIENT_MODE", "hosted-hub");
    const { attributes } = stubDocument();

    syncDocumentHubSurface();

    expect(attributes.get(HUB_SURFACE_ATTRIBUTE)).toBe(HUB_SURFACE_VALUE);
    expect(isHubSurface()).toBe(true);
  });

  // The isolation guarantee for the standalone Hub design. Every Hub token
  // override is written as `:root[data-surface="hub"]` and every Hub utility
  // goes through the `hub:` variant, so a node/desktop build that never stamps
  // this attribute cannot render Hub chrome even if Hub code is imported into
  // the graph. If this assertion ever fails, Hub styling has become able to
  // reach the node app.
  it("stamps nothing in a standard build", () => {
    vi.stubEnv("VITE_RYCO_CLIENT_MODE", "standard");
    const { attributes } = stubDocument();

    syncDocumentHubSurface();

    expect(attributes.has(HUB_SURFACE_ATTRIBUTE)).toBe(false);
    expect(isHubSurface()).toBe(false);
  });

  it("treats an unset client mode as standard", () => {
    vi.stubEnv("VITE_RYCO_CLIENT_MODE", "");
    const { attributes } = stubDocument();

    syncDocumentHubSurface();

    expect(attributes.has(HUB_SURFACE_ATTRIBUTE)).toBe(false);
  });

  it("is idempotent", () => {
    vi.stubEnv("VITE_RYCO_CLIENT_MODE", "hosted-hub");
    const { attributes } = stubDocument();

    syncDocumentHubSurface();
    syncDocumentHubSurface();

    expect(attributes.size).toBe(1);
    expect(attributes.get(HUB_SURFACE_ATTRIBUTE)).toBe(HUB_SURFACE_VALUE);
  });

  it("does nothing without a document", () => {
    vi.stubEnv("VITE_RYCO_CLIENT_MODE", "hosted-hub");
    vi.stubGlobal("document", undefined);

    expect(() => syncDocumentHubSurface()).not.toThrow();
    expect(isHubSurface()).toBe(false);
  });
});
