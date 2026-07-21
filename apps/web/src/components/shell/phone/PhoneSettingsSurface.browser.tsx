// Production CSS is part of the behavior under test: row heights, the
// full-screen popup geometry, and the safe-area/motion utility classes drive
// the assertions below.
import "../../../index.css";

import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  type LocalApi,
  type ServerConfig,
  type SourceControlDiscoveryResult,
} from "@ryco/contracts";
import { page, userEvent } from "vite-plus/test/browser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

// The archived-threads section reaches for router state through the shared
// thread actions; the surface itself never navigates.
const navigate = vi.fn(async () => undefined);
const routerStub = { navigate, state: { matches: [] } };
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
  useRouter: () => routerStub,
}));

vi.mock("../../../environments/runtime", () => {
  const primaryConnection = {
    kind: "primary" as const,
    knownEnvironment: {
      id: "environment-local",
      label: "Local environment",
      source: "manual" as const,
      environmentId: EnvironmentId.make("environment-local"),
      target: {
        httpBaseUrl: "http://localhost:3000",
        wsBaseUrl: "ws://localhost:3000",
      },
    },
    environmentId: EnvironmentId.make("environment-local"),
    client: {
      server: {
        subscribeAuthAccess: (listener: (event: unknown) => void) => {
          listener({
            version: 1,
            revision: 1,
            type: "snapshot",
            payload: { pairingLinks: [], clientSessions: [] },
          });
          return () => {};
        },
        getAdvertisedEndpoints: async () => [],
      },
    },
    ensureBootstrapped: async () => undefined,
    reconnect: async () => undefined,
    dispose: async () => undefined,
  };

  return {
    getEnvironmentHttpBaseUrl: () => "http://localhost:3000",
    getSavedEnvironmentRecord: () => null,
    getSavedEnvironmentRuntimeState: () => null,
    hasSavedEnvironmentRegistryHydrated: () => true,
    listSavedEnvironmentRecords: () => [],
    resetSavedEnvironmentRegistryStoreForTests: () => undefined,
    resetSavedEnvironmentRuntimeStoreForTests: () => undefined,
    resolveEnvironmentHttpUrl: (_environmentId: unknown, path: string) =>
      new URL(path, "http://localhost:3000").toString(),
    waitForSavedEnvironmentRegistryHydration: async () => undefined,
    addSavedEnvironment: vi.fn(),
    connectDesktopSshEnvironment: vi.fn(),
    disconnectSavedEnvironment: vi.fn(),
    ensureEnvironmentConnectionBootstrapped: async () => undefined,
    getPrimaryEnvironmentConnection: () => primaryConnection,
    readEnvironmentConnection: () => primaryConnection,
    reconnectSavedEnvironment: vi.fn(),
    removeSavedEnvironment: vi.fn(),
    requireEnvironmentConnection: () => primaryConnection,
    resetEnvironmentServiceForTests: () => undefined,
    startEnvironmentConnectionService: () => undefined,
    subscribeEnvironmentConnections: () => () => {},
    useSavedEnvironmentRegistryStore: (
      selector: (state: { byId: Record<string, never> }) => unknown,
    ) => selector({ byId: {} }),
    useSavedEnvironmentRuntimeStore: (
      selector: (state: { byId: Record<string, never> }) => unknown,
    ) => selector({ byId: {} }),
  };
});

import { __resetLocalApiForTests } from "../../../localApi";
import { syncDocumentPresentationTier } from "../../../lib/presentationTier";
import { AppAtomRegistryProvider } from "../../../rpc/atomRegistry";
import { resetServerStateForTests, setServerConfigSnapshot } from "../../../rpc/serverState";
import { useSettingsDialogStore } from "../../../settingsDialogStore";
import { PhoneSettingsSurface } from "./PhoneSettingsSurface";

const GENERAL_SECTION_LABELS = [
  "General",
  "Providers",
  "Plugins",
  "MCP Servers",
  "Appearance",
  "Keybindings",
  "Source Control",
  "Connections",
  "Statistics",
  "Archive",
] as const;

function createBaseServerConfig(): ServerConfig {
  return {
    environment: {
      environmentId: EnvironmentId.make("environment-local"),
      label: "Local environment",
      platform: { os: "darwin" as const, arch: "arm64" as const },
      serverVersion: "0.0.0-test",
      capabilities: { repositoryIdentity: true },
    },
    auth: {
      policy: "loopback-browser",
      bootstrapMethods: ["one-time-token"],
      sessionMethods: ["browser-session-cookie", "bearer-session-token"],
      sessionCookieName: "ryco_session",
    },
    cwd: "/repo/project",
    keybindingsConfigPath: "/repo/project/.ryco-keybindings.json",
    keybindings: [],
    issues: [],
    providers: [],
    availableEditors: ["cursor"],
    observability: {
      logsDirectoryPath: "/repo/project/.ryco/logs",
      localTracingEnabled: true,
      otlpTracesUrl: "http://localhost:4318/v1/traces",
      otlpTracesEnabled: true,
      otlpMetricsEnabled: false,
    },
    settings: DEFAULT_SERVER_SETTINGS,
  };
}

/**
 * A minimal native API: enough for the settings panels to mount without
 * crashing. Panels whose data sources reject render their bounded error or
 * empty states — the surface bar (back affordance plus section heading) never
 * depends on panel data, which is exactly what the paged navigation tests
 * assert.
 */
function installNativeApiStub() {
  window.nativeApi = {
    persistence: {
      getClientSettings: vi.fn().mockResolvedValue(null),
      setClientSettings: vi.fn().mockResolvedValue(undefined),
      getSavedEnvironmentRegistry: vi.fn().mockResolvedValue([]),
      setSavedEnvironmentRegistry: vi.fn().mockResolvedValue(undefined),
      getSavedEnvironmentSecret: vi.fn().mockResolvedValue(null),
      setSavedEnvironmentSecret: vi.fn().mockResolvedValue(true),
      removeSavedEnvironmentSecret: vi.fn().mockResolvedValue(undefined),
    },
    server: {
      getConfig: vi.fn().mockResolvedValue(createBaseServerConfig()),
      refreshProviders: vi.fn().mockResolvedValue({ providers: [] }),
      upsertKeybinding: vi.fn().mockResolvedValue({ keybindings: [] }),
      getSettings: vi.fn().mockResolvedValue(DEFAULT_SERVER_SETTINGS),
      updateSettings: vi.fn().mockResolvedValue(DEFAULT_SERVER_SETTINGS),
      discoverSourceControl: vi.fn().mockResolvedValue({
        versionControlSystems: [],
        sourceControlProviders: [],
      } satisfies SourceControlDiscoveryResult),
      getStatistics: vi.fn().mockRejectedValue(new Error("Statistics unavailable in tests.")),
      getDiagnosticsSnapshot: vi
        .fn()
        .mockRejectedValue(new Error("Diagnostics unavailable in tests.")),
      listOpinionatedPlugins: vi.fn().mockResolvedValue({ plugins: [] }),
      checkOpinionatedPlugins: vi.fn().mockResolvedValue({ statuses: [] }),
    },
    shell: {
      openInEditor: vi.fn().mockResolvedValue(undefined),
      openExternal: vi.fn().mockResolvedValue(undefined),
    },
    dialogs: {
      pickFolder: vi.fn().mockResolvedValue(null),
      confirm: vi.fn().mockResolvedValue(false),
    },
    contextMenu: {
      show: vi.fn().mockResolvedValue(null),
    },
  } as unknown as LocalApi;
}

function settingsPopup(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="phone-settings-surface"]');
}

function listRow(label: string): HTMLButtonElement | null {
  const popup = settingsPopup();
  if (!popup) return null;
  return (
    [...popup.querySelectorAll<HTMLButtonElement>("nav button")].find(
      (button) => button.textContent?.trim() === label,
    ) ?? null
  );
}

function sectionHeading(): HTMLElement | null {
  return settingsPopup()?.querySelector<HTMLElement>("h1[tabindex]") ?? null;
}

function backToSettingsButton(): HTMLElement | null {
  return (
    settingsPopup()?.querySelector<HTMLElement>('button[aria-label="Back to settings"]') ?? null
  );
}

function accessibleName(button: HTMLElement): string {
  return (
    button.getAttribute("aria-label")?.trim() ||
    (button.getAttribute("aria-labelledby")
      ? (document.getElementById(button.getAttribute("aria-labelledby") ?? "")?.textContent ?? "")
      : "") ||
    button.textContent?.trim() ||
    ""
  );
}

async function mountSurface() {
  return render(
    <AppAtomRegistryProvider>
      <PhoneSettingsSurface />
    </AppAtomRegistryProvider>,
  );
}

let mounted: Awaited<ReturnType<typeof render>> | null = null;

describe("PhoneSettingsSurface", () => {
  beforeAll(() => {
    syncDocumentPresentationTier();
  });

  beforeEach(async () => {
    await page.viewport(390, 844);
    localStorage.clear();
    resetServerStateForTests();
    await __resetLocalApiForTests();
    installNativeApiStub();
    setServerConfigSnapshot(createBaseServerConfig());
    useSettingsDialogStore.setState({ open: false, section: "general" });
  });

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    useSettingsDialogStore.setState({ open: false, section: "general" });
    Reflect.deleteProperty(window, "nativeApi");
    resetServerStateForTests();
    await __resetLocalApiForTests();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    await page.viewport(1_280, 720);
  });

  it("lists every section as a labeled 44px row at 320px, with diagnostics under Advanced", async () => {
    await page.viewport(320, 568);
    mounted = await mountSurface();
    useSettingsDialogStore.getState().openSettings();

    const popup = await vi.waitFor(() => {
      const element = settingsPopup();
      expect(element).not.toBeNull();
      return element!;
    });
    // Full-screen: the popup covers the whole viewport.
    await vi.waitFor(() => {
      const rect = popup.getBoundingClientRect();
      expect(rect.width).toBeGreaterThanOrEqual(320 - 0.5);
      expect(rect.height).toBeGreaterThanOrEqual(568 - 0.5);
    });

    for (const label of GENERAL_SECTION_LABELS) {
      const row = listRow(label);
      expect(row, `Missing settings row "${label}".`).not.toBeNull();
      expect(row!.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
    // Diagnostics is not in the resting list: it lives behind the Advanced
    // progressive disclosure.
    expect(listRow("Diagnostics")).toBeNull();
    const advancedToggle = listRow("Advanced");
    expect(advancedToggle).not.toBeNull();
    expect(advancedToggle!.getAttribute("aria-expanded")).toBe("false");
    advancedToggle!.click();
    const diagnosticsRow = await vi.waitFor(() => {
      const row = listRow("Diagnostics");
      expect(row).not.toBeNull();
      return row!;
    });
    expect(advancedToggle!.getAttribute("aria-expanded")).toBe("true");
    expect(diagnosticsRow.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);

    // Label audit: every control inside the surface has an accessible name.
    for (const button of popup.querySelectorAll<HTMLElement>("button")) {
      expect(accessibleName(button), "Icon-only control without accessible name.").not.toBe("");
    }
    // No page-level horizontal overflow at 320px.
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
  });

  it("pushes every section full-width with a working back affordance at 320px", async () => {
    await page.viewport(320, 568);
    mounted = await mountSurface();
    useSettingsDialogStore.getState().openSettings();
    await vi.waitFor(() => {
      expect(settingsPopup()).not.toBeNull();
    });

    const advancedToggle = listRow("Advanced");
    expect(advancedToggle).not.toBeNull();
    advancedToggle!.click();
    await vi.waitFor(() => {
      expect(listRow("Diagnostics")).not.toBeNull();
    });

    for (const label of [...GENERAL_SECTION_LABELS, "Diagnostics"]) {
      const row = await vi.waitFor(() => {
        const element = listRow(label);
        expect(element, `Missing settings row "${label}".`).not.toBeNull();
        return element!;
      });
      row.click();
      await vi.waitFor(() => {
        const heading = sectionHeading();
        expect(heading?.textContent).toBe(label);
        expect(backToSettingsButton()).not.toBeNull();
      });
      // The section page spans the full surface width; the store tracks the
      // pushed section.
      expect(useSettingsDialogStore.getState().section).toBe(
        label === "Diagnostics"
          ? "diagnostics"
          : {
              General: "general",
              Providers: "providers",
              Plugins: "opinionated-plugins",
              "MCP Servers": "mcp-servers",
              Appearance: "appearance",
              Keybindings: "keybindings",
              "Source Control": "source-control",
              Connections: "connections",
              Statistics: "statistics",
              Archive: "archived",
            }[label],
      );
      backToSettingsButton()!.click();
      await vi.waitFor(() => {
        expect(sectionHeading()).toBeNull();
        expect(listRow("General")).not.toBeNull();
      });
      if (label === "Diagnostics") continue;
      // The Advanced disclosure keeps its expanded state while paging.
      expect(listRow("Diagnostics")).not.toBeNull();
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
  });

  it("moves focus to the section on push and back to the originating row on pop", async () => {
    mounted = await mountSurface();
    useSettingsDialogStore.getState().openSettings();
    const appearanceRow = await vi.waitFor(() => {
      const row = listRow("Appearance");
      expect(row).not.toBeNull();
      return row!;
    });

    appearanceRow.click();
    await vi.waitFor(() => {
      const heading = sectionHeading();
      expect(heading?.textContent).toBe("Appearance");
      expect(document.activeElement).toBe(heading);
    });

    backToSettingsButton()!.click();
    await vi.waitFor(() => {
      const row = listRow("Appearance");
      expect(row).not.toBeNull();
      expect(document.activeElement).toBe(row);
    });
  });

  it("closes on Escape from both the list and a pushed section (desktop dialog parity)", async () => {
    mounted = await mountSurface();
    useSettingsDialogStore.getState().openSettings();
    await vi.waitFor(() => {
      expect(settingsPopup()).not.toBeNull();
    });

    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(useSettingsDialogStore.getState().open).toBe(false);
      expect(settingsPopup()).toBeNull();
    });

    useSettingsDialogStore.getState().openSettings();
    const row = await vi.waitFor(() => {
      const element = listRow("Appearance");
      expect(element).not.toBeNull();
      return element!;
    });
    row.click();
    await vi.waitFor(() => {
      expect(sectionHeading()?.textContent).toBe("Appearance");
    });
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(useSettingsDialogStore.getState().open).toBe(false);
      expect(settingsPopup()).toBeNull();
    });
  });

  it("lands directly on the section page for open-to-section deep links", async () => {
    mounted = await mountSurface();

    // Closed -> openSettings(section): the section page renders immediately.
    useSettingsDialogStore.getState().openSettings("source-control");
    await vi.waitFor(() => {
      expect(sectionHeading()?.textContent).toBe("Source Control");
      expect(backToSettingsButton()).not.toBeNull();
    });
    // The back affordance still reaches the list.
    backToSettingsButton()!.click();
    await vi.waitFor(() => {
      expect(sectionHeading()).toBeNull();
      expect(listRow("General")).not.toBeNull();
    });

    // While open, a menu-driven openSettings(section) pushes that section.
    useSettingsDialogStore.getState().openSettings("connections");
    await vi.waitFor(() => {
      expect(sectionHeading()?.textContent).toBe("Connections");
    });

    // Close and reopen generically: the list is the resting view again, and
    // the SAME deep link keeps working on the next open.
    useSettingsDialogStore.getState().closeSettings();
    await vi.waitFor(() => {
      expect(settingsPopup()).toBeNull();
    });
    useSettingsDialogStore.getState().openSettings();
    await vi.waitFor(() => {
      expect(settingsPopup()).not.toBeNull();
      expect(sectionHeading()).toBeNull();
      expect(listRow("General")).not.toBeNull();
    });
    useSettingsDialogStore.getState().closeSettings();
    await vi.waitFor(() => {
      expect(settingsPopup()).toBeNull();
    });
    useSettingsDialogStore.getState().openSettings("source-control");
    await vi.waitFor(() => {
      expect(sectionHeading()?.textContent).toBe("Source Control");
    });
  });

  it("keeps the QA tier-preview override reachable under Advanced diagnostics, dev-gated", async () => {
    mounted = await mountSurface();
    useSettingsDialogStore.getState().openSettings();
    const advancedToggle = await vi.waitFor(() => {
      const toggle = listRow("Advanced");
      expect(toggle).not.toBeNull();
      return toggle!;
    });
    advancedToggle.click();
    const diagnosticsRow = await vi.waitFor(() => {
      const row = listRow("Diagnostics");
      expect(row).not.toBeNull();
      return row!;
    });
    diagnosticsRow.click();
    await vi.waitFor(() => {
      expect(sectionHeading()?.textContent).toBe("Diagnostics");
    });
    // The dev-gated preview override renders inside the unchanged
    // DiagnosticsSettings section (the browser suite runs a dev build; the
    // gate itself stays `import.meta.env.DEV` in DiagnosticsSettings).
    await vi.waitFor(() => {
      expect(settingsPopup()?.textContent).toContain("Presentation tier preview");
    });
  });

  it("declares safe-area and reduced-motion behavior on the surface popup", async () => {
    mounted = await mountSurface();
    useSettingsDialogStore.getState().openSettings();
    const popup = await vi.waitFor(() => {
      const element = settingsPopup();
      expect(element).not.toBeNull();
      return element!;
    });
    // Safe areas: top, both landscape sides, and a bottom inset composed
    // with the keyboard inset variable.
    expect(popup.className).toContain("pt-safe");
    expect(popup.className).toContain("pl-safe");
    expect(popup.className).toContain("pr-safe");
    expect(popup.className).toContain(
      "pb-[max(env(safe-area-inset-bottom),var(--app-keyboard-inset,0px))]",
    );
    // Reduced motion: the sheet transition declares a motion-reduce variant;
    // navigation correctness never depends on animation completion.
    expect(popup.className).toContain("motion-reduce:transition-none");
  });

  it("survives 200% text scaling at 320px without hiding controls or page overflow", async () => {
    await page.viewport(320, 568);
    const previousFontSize = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = "32px";
    try {
      mounted = await mountSurface();
      useSettingsDialogStore.getState().openSettings();
      const popup = await vi.waitFor(() => {
        const element = settingsPopup();
        expect(element).not.toBeNull();
        return element!;
      });
      // Wait out the entry transition before measuring geometry.
      await vi.waitFor(() => {
        const rect = popup.getBoundingClientRect();
        expect(rect.width).toBeGreaterThanOrEqual(320 - 0.5);
        expect(Math.round(rect.left)).toBe(0);
      });
      const closeButton = popup.querySelector<HTMLElement>('button[aria-label="Close settings"]')!;
      expect(closeButton).not.toBeNull();
      const closeRect = closeButton.getBoundingClientRect();
      expect(closeRect.width).toBeGreaterThan(0);
      expect(closeRect.right).toBeLessThanOrEqual(320 + 0.5);
      for (const label of GENERAL_SECTION_LABELS) {
        const row = listRow(label);
        expect(row, `Missing settings row "${label}" at 200% text scale.`).not.toBeNull();
        expect(row!.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      }
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
    } finally {
      document.documentElement.style.fontSize = previousFontSize;
    }
  });
});
