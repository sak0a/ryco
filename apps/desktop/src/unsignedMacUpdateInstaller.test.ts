import { describe, expect, it } from "vite-plus/test";

import {
  createUnsignedMacUpdateInstallScript,
  parseMacCodeSignatureKind,
  resolveMacAppBundlePath,
  resolveMacUpdateTargetAppPath,
  shouldUseUnsignedMacUpdateInstaller,
} from "./unsignedMacUpdateInstaller.ts";

describe("parseMacCodeSignatureKind", () => {
  it("detects Developer ID signatures", () => {
    expect(
      parseMacCodeSignatureKind({
        exitCode: 0,
        output:
          "Executable=/Applications/Ryco.app/Contents/MacOS/Ryco\nAuthority=Developer ID Application: Example\n",
      }),
    ).toBe("developer-id");
  });

  it("detects ad-hoc signatures", () => {
    expect(
      parseMacCodeSignatureKind({
        exitCode: 0,
        output: "Executable=/Applications/Ryco.app/Contents/MacOS/Ryco\nSignature=adhoc\n",
      }),
    ).toBe("ad-hoc");
  });

  it("detects unsigned bundles from codesign failures", () => {
    expect(
      parseMacCodeSignatureKind({
        exitCode: 1,
        output: "/Applications/Ryco.app: code object is not signed at all\n",
      }),
    ).toBe("unsigned");
  });
});

describe("shouldUseUnsignedMacUpdateInstaller", () => {
  it("uses the fallback for packaged unsigned macOS builds", () => {
    expect(
      shouldUseUnsignedMacUpdateInstaller({
        platform: "darwin",
        isPackaged: true,
        signatureKind: "unsigned",
        disabledByEnv: false,
        forcedByEnv: false,
      }),
    ).toBe(true);
  });

  it("keeps Developer ID builds on the native updater path", () => {
    expect(
      shouldUseUnsignedMacUpdateInstaller({
        platform: "darwin",
        isPackaged: true,
        signatureKind: "developer-id",
        disabledByEnv: false,
        forcedByEnv: false,
      }),
    ).toBe(false);
  });

  it("does not use the fallback outside packaged macOS builds", () => {
    expect(
      shouldUseUnsignedMacUpdateInstaller({
        platform: "linux",
        isPackaged: true,
        signatureKind: "unsigned",
        disabledByEnv: false,
        forcedByEnv: true,
      }),
    ).toBe(false);
  });
});

describe("macOS app path helpers", () => {
  it("resolves the current app bundle path from the executable path", () => {
    expect(resolveMacAppBundlePath("/Applications/Ryco.app/Contents/MacOS/Ryco")).toBe(
      "/Applications/Ryco.app",
    );
  });

  it("resolves the /Applications install target from the current bundle name", () => {
    expect(resolveMacUpdateTargetAppPath("/Volumes/Ryco/Ryco (Nightly).app")).toBe(
      "/Applications/Ryco (Nightly).app",
    );
  });
});

describe("createUnsignedMacUpdateInstallScript", () => {
  it("creates a quoted installer script that extracts, copies, unquarantines, and opens the app", () => {
    const script = createUnsignedMacUpdateInstallScript({
      appLabel: "Laurin's Ryco",
      updateZipPath: "/tmp/Ryco update.zip",
      targetAppPath: "/Applications/Ryco.app",
      waitPid: 123,
      logPath: "/tmp/ryco update.log",
    });

    expect(script).toContain("APP_LABEL='Laurin'\\''s Ryco'");
    expect(script).toContain("UPDATE_ZIP='/tmp/Ryco update.zip'");
    expect(script).toContain("WAIT_PID=123");
    expect(script).toContain('/usr/bin/ditto -x -k "$UPDATE_ZIP" "$STAGING_DIR"');
    expect(script).toContain("/usr/bin/xattr -dr com.apple.quarantine");
    expect(script).toContain('/usr/bin/open "$TARGET_APP"');
  });
});
