import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_DESKTOP_SETTINGS,
  DesktopSettingsReadError,
  readDesktopSettings,
  resolveDefaultDesktopSettings,
  setDesktopServerExposurePreference,
  setDesktopTailscaleServePreference,
  setDesktopUpdateChannelPreference,
  writeDesktopSettings,
} from "./desktopSettings.ts";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function makeSettingsPath() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ryco-desktop-settings-test-"));
  tempDirectories.push(directory);
  return path.join(directory, "desktop-settings.json");
}

describe("desktopSettings", () => {
  it("returns defaults when no settings file exists", () => {
    expect(readDesktopSettings(makeSettingsPath(), "0.0.17")).toEqual(DEFAULT_DESKTOP_SETTINGS);
  });

  it("defaults packaged nightly builds to the nightly update channel", () => {
    expect(resolveDefaultDesktopSettings("0.0.17-nightly.20260415.1")).toEqual({
      serverExposureMode: "local-only",
      tailscaleServeEnabled: false,
      tailscaleServePort: 443,
      updateChannel: "nightly",
      updateChannelConfiguredByUser: false,
      hubConnectorEnabled: false,
      hubOrigin: null,
    });
  });

  it("persists and reloads the configured server exposure mode", () => {
    const settingsPath = makeSettingsPath();

    writeDesktopSettings(settingsPath, {
      serverExposureMode: "network-accessible",
      tailscaleServeEnabled: true,
      tailscaleServePort: 8443,
      updateChannel: "latest",
      updateChannelConfiguredByUser: true,
      hubConnectorEnabled: false,
      hubOrigin: null,
    });

    expect(readDesktopSettings(settingsPath, "0.0.17")).toEqual({
      serverExposureMode: "network-accessible",
      tailscaleServeEnabled: true,
      tailscaleServePort: 8443,
      updateChannel: "latest",
      updateChannelConfiguredByUser: true,
      hubConnectorEnabled: false,
      hubOrigin: null,
    });
  });

  it("preserves the requested network-accessible preference across temporary fallback", () => {
    expect(
      setDesktopServerExposurePreference(
        {
          serverExposureMode: "local-only",
          tailscaleServeEnabled: false,
          tailscaleServePort: 443,
          updateChannel: "latest",
          updateChannelConfiguredByUser: false,
          hubConnectorEnabled: false,
          hubOrigin: null,
        },
        "network-accessible",
      ),
    ).toEqual({
      serverExposureMode: "network-accessible",
      tailscaleServeEnabled: false,
      tailscaleServePort: 443,
      updateChannel: "latest",
      updateChannelConfiguredByUser: false,
      hubConnectorEnabled: false,
      hubOrigin: null,
    });
  });

  it("persists the requested Tailscale Serve preference", () => {
    expect(
      setDesktopTailscaleServePreference(
        {
          serverExposureMode: "local-only",
          tailscaleServeEnabled: false,
          tailscaleServePort: 443,
          updateChannel: "latest",
          updateChannelConfiguredByUser: false,
          hubConnectorEnabled: false,
          hubOrigin: null,
        },
        { enabled: true, port: 8443 },
      ),
    ).toEqual({
      serverExposureMode: "local-only",
      tailscaleServeEnabled: true,
      tailscaleServePort: 8443,
      updateChannel: "latest",
      updateChannelConfiguredByUser: false,
      hubConnectorEnabled: false,
      hubOrigin: null,
    });
  });

  it("preserves the configured Tailscale Serve port when no new port is requested", () => {
    expect(
      setDesktopTailscaleServePreference(
        {
          serverExposureMode: "local-only",
          tailscaleServeEnabled: false,
          tailscaleServePort: 8443,
          updateChannel: "latest",
          updateChannelConfiguredByUser: false,
          hubConnectorEnabled: false,
          hubOrigin: null,
        },
        { enabled: true },
      ),
    ).toEqual({
      serverExposureMode: "local-only",
      tailscaleServeEnabled: true,
      tailscaleServePort: 8443,
      updateChannel: "latest",
      updateChannelConfiguredByUser: false,
      hubConnectorEnabled: false,
      hubOrigin: null,
    });
  });

  it("persists the requested nightly update channel", () => {
    expect(
      setDesktopUpdateChannelPreference(
        {
          serverExposureMode: "local-only",
          tailscaleServeEnabled: false,
          tailscaleServePort: 443,
          updateChannel: "latest",
          updateChannelConfiguredByUser: false,
          hubConnectorEnabled: false,
          hubOrigin: null,
        },
        "nightly",
      ),
    ).toEqual({
      serverExposureMode: "local-only",
      tailscaleServeEnabled: false,
      tailscaleServePort: 443,
      updateChannel: "nightly",
      updateChannelConfiguredByUser: true,
      hubConnectorEnabled: false,
      hubOrigin: null,
    });
  });

  // Deliberate change of behaviour: this used to return defaults. Doing so meant
  // the next write persisted them, silently discarding a configured Hub
  // connection with no signal to the operator.
  it("surfaces a malformed settings file instead of silently resetting it", () => {
    const settingsPath = makeSettingsPath();
    fs.writeFileSync(settingsPath, "{not-json", "utf8");

    expect(() => readDesktopSettings(settingsPath, "0.0.17")).toThrow(DesktopSettingsReadError);
    // The bad file must survive, so it can be inspected rather than overwritten.
    expect(fs.readFileSync(settingsPath, "utf8")).toBe("{not-json");
  });

  it("still returns defaults when no settings file exists yet", () => {
    expect(readDesktopSettings(makeSettingsPath(), "0.0.17")).toEqual(DEFAULT_DESKTOP_SETTINGS);
  });

  it("writes the settings file owner-only", () => {
    const settingsPath = makeSettingsPath();
    writeDesktopSettings(settingsPath, DEFAULT_DESKTOP_SETTINGS);
    // The Hub address says where this machine is reachable; other local users
    // have no business reading it.
    expect(fs.statSync(settingsPath).mode & 0o777).toBe(0o600);
  });

  it("round-trips the hub launch configuration", () => {
    const settingsPath = makeSettingsPath();
    writeDesktopSettings(settingsPath, {
      ...DEFAULT_DESKTOP_SETTINGS,
      hubConnectorEnabled: true,
      hubOrigin: "https://hub.example.com",
    });
    expect(readDesktopSettings(settingsPath, "0.0.17")).toMatchObject({
      hubConnectorEnabled: true,
      hubOrigin: "https://hub.example.com",
    });
  });

  it("falls back to the nightly channel for legacy nightly settings without an update track", () => {
    const settingsPath = makeSettingsPath();
    fs.writeFileSync(settingsPath, JSON.stringify({ serverExposureMode: "local-only" }), "utf8");

    expect(readDesktopSettings(settingsPath, "0.0.17-nightly.20260415.1")).toEqual({
      serverExposureMode: "local-only",
      tailscaleServeEnabled: false,
      tailscaleServePort: 443,
      updateChannel: "nightly",
      updateChannelConfiguredByUser: false,
      hubConnectorEnabled: false,
      hubOrigin: null,
    });
  });

  it("migrates legacy implicit stable settings to nightly when running a nightly build", () => {
    const settingsPath = makeSettingsPath();
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        serverExposureMode: "local-only",
        updateChannel: "latest",
      }),
      "utf8",
    );

    expect(readDesktopSettings(settingsPath, "0.0.17-nightly.20260415.1")).toEqual({
      serverExposureMode: "local-only",
      tailscaleServeEnabled: false,
      tailscaleServePort: 443,
      updateChannel: "nightly",
      updateChannelConfiguredByUser: false,
      hubConnectorEnabled: false,
      hubOrigin: null,
    });
  });

  it("preserves an explicit stable choice on nightly builds", () => {
    const settingsPath = makeSettingsPath();
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        serverExposureMode: "local-only",
        updateChannel: "latest",
        updateChannelConfiguredByUser: true,
        hubConnectorEnabled: false,
        hubOrigin: null,
      }),
      "utf8",
    );

    expect(readDesktopSettings(settingsPath, "0.0.17-nightly.20260415.1")).toEqual({
      serverExposureMode: "local-only",
      tailscaleServeEnabled: false,
      tailscaleServePort: 443,
      updateChannel: "latest",
      updateChannelConfiguredByUser: true,
      hubConnectorEnabled: false,
      hubOrigin: null,
    });
  });

  it("falls back to the default Tailscale Serve port when the persisted port is invalid", () => {
    const settingsPath = makeSettingsPath();
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        tailscaleServeEnabled: true,
        tailscaleServePort: 0,
      }),
      "utf8",
    );

    expect(readDesktopSettings(settingsPath, "0.0.17")).toEqual({
      serverExposureMode: "local-only",
      tailscaleServeEnabled: true,
      tailscaleServePort: 443,
      updateChannel: "latest",
      updateChannelConfiguredByUser: false,
      hubConnectorEnabled: false,
      hubOrigin: null,
    });
  });
});
