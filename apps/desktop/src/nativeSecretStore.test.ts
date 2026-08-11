import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { DesktopNativeSecurityError } from "./nativeSecurityHelper.ts";
import {
  createDesktopNativeSecretStore,
  type DesktopSecretProtection,
} from "./nativeSecretStore.ts";

const roots: string[] = [];
const namespace = "a".repeat(64);

function temporaryDirectory(): string {
  const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "ryco-native-secret-store-"));
  roots.push(root);
  return Path.join(root, "keys");
}

function protection(available = true): DesktopSecretProtection {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plaintext) =>
      Buffer.from(Buffer.from(plaintext, "utf8").map((byte) => byte ^ 0x5a)),
    decryptString: (ciphertext) =>
      Buffer.from(ciphertext.map((byte) => byte ^ 0x5a)).toString("utf8"),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) FS.rmSync(root, { recursive: true, force: true });
});

describe("Desktop native secret store", () => {
  it("creates once, encrypts at rest, verifies modes, and deletes", async () => {
    const directory = temporaryDirectory();
    const store = createDesktopNativeSecretStore({
      directory,
      namespace,
      protection: protection(),
    });
    const keyRecord = Buffer.from("hardware-bound-record").toString("base64");
    await expect(store.create("signing", keyRecord)).resolves.toBe(true);
    await expect(store.create("signing", "replacement")).resolves.toBe(false);
    await expect(store.read("signing")).resolves.toBe(keyRecord);

    const file = Path.join(directory, `${namespace}.signing.record`);
    const raw = FS.readFileSync(file, "utf8");
    expect(raw).not.toContain(keyRecord);
    expect(FS.statSync(directory).mode & 0o777).toBe(0o700);
    expect(FS.statSync(file).mode & 0o777).toBe(0o600);

    await store.delete("signing");
    await expect(store.read("signing")).resolves.toBeNull();
  });

  it("fails closed without encryption or for a symlinked key file", async () => {
    const unavailable = createDesktopNativeSecretStore({
      directory: temporaryDirectory(),
      namespace,
      protection: protection(false),
    });
    await expect(unavailable.read("signing")).rejects.toBeInstanceOf(DesktopNativeSecurityError);

    const directory = temporaryDirectory();
    FS.mkdirSync(directory, { recursive: true, mode: 0o700 });
    FS.symlinkSync("/dev/null", Path.join(directory, `${namespace}.agreement.record`));
    const store = createDesktopNativeSecretStore({
      directory,
      namespace,
      protection: protection(),
    });
    await expect(store.read("agreement")).rejects.toBeInstanceOf(DesktopNativeSecurityError);
  });
});
