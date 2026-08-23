import { describe, expect, it, vi } from "vite-plus/test";

import {
  DesktopNativeSecurityError,
  DesktopNativeSecurityHelper,
  desktopNativeInstallationNamespace,
  desktopNativeSecurityNamespace,
  resolveDesktopNativeSecurityHelperPath,
  type DesktopNativeSecretStore,
  type NativeSecurityHelperRunner,
} from "./nativeSecurityHelper.ts";

const point = new Uint8Array([
  0x04,
  ...new Uint8Array(32).fill(0x11),
  ...new Uint8Array(32).fill(0x22),
]);
const agreementPublic = new Uint8Array(32).fill(0x33);
const agreementSecret = new Uint8Array(32).fill(0x44);
const derSignature = new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02]);
const base64 = (value: Uint8Array) => Buffer.from(value).toString("base64");
const signingRecord = base64(new Uint8Array([1, 2, 3]));
const agreementRecord = base64(new Uint8Array([4, 5, 6]));

function memoryStore(): DesktopNativeSecretStore {
  const records = new Map<string, string>();
  return {
    read: async (kind) => records.get(kind) ?? null,
    create: async (kind, value) => {
      if (records.has(kind)) return false;
      records.set(kind, value);
      return true;
    },
    delete: async (kind) => {
      records.delete(kind);
    },
  };
}

describe("Desktop native security helper", () => {
  it("derives a stable opaque namespace and resolves development/packaged helpers", () => {
    expect(desktopNativeSecurityNamespace("hub\0installation")).toMatch(/^[0-9a-f]{64}$/);
    expect(desktopNativeSecurityNamespace("hub\0installation")).toBe(
      desktopNativeSecurityNamespace("hub\0installation"),
    );
    expect(
      resolveDesktopNativeSecurityHelperPath({
        isPackaged: false,
        resourcesPath: "/Applications/Ryco.app/Contents/Resources",
        moduleDirectory: "/repo/apps/desktop/dist-electron",
      }),
    ).toBe("/repo/apps/desktop/resources/ryco-desktop-security-helper");
    expect(
      resolveDesktopNativeSecurityHelperPath({
        isPackaged: true,
        resourcesPath: "/Applications/Ryco.app/Contents/Resources",
        moduleDirectory: "/ignored",
      }),
    ).toBe("/Applications/Ryco.app/Contents/Resources/ryco-desktop-security-helper");
  });

  it("isolates development and preview records while preserving the production namespace", () => {
    const legacyProductionNamespace = desktopNativeSecurityNamespace(
      "ryco.desktop.installation.v1",
    );
    expect(desktopNativeInstallationNamespace("production")).toBe(legacyProductionNamespace);
    expect(desktopNativeInstallationNamespace("development")).not.toBe(legacyProductionNamespace);
    expect(desktopNativeInstallationNamespace("preview")).not.toBe(legacyProductionNamespace);
    expect(desktopNativeInstallationNamespace("development")).not.toBe(
      desktopNativeInstallationNamespace("preview"),
    );
  });

  it("keeps signing hardware-backed and converts the native DER signature", async () => {
    const run = vi.fn<NativeSecurityHelperRunner>(async (request) => {
      if (request.operation === "signing.create") {
        return {
          ok: true,
          backing: "secure-enclave",
          keyRecord: signingRecord,
          publicKey: base64(point),
        };
      }
      if (request.operation === "signing.sign") {
        expect(request.keyRecord).toBe(signingRecord);
        return { ok: true, signature: base64(derSignature) };
      }
      throw new Error("unexpected");
    });
    const helper = new DesktopNativeSecurityHelper({ run, store: memoryStore() });
    const signingKey = await helper.getSigningKey();

    expect(signingKey.publicJwk).toEqual({
      kty: "EC",
      crv: "P-256",
      x: "ERERERERERERERERERERERERERERERERERERERERERE",
      y: "IiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiI",
    });
    expect(await helper.getSigningPublicKey()).toEqual(point);
    expect(await signingKey.sign(new Uint8Array([1, 2, 3]))).toEqual(
      new Uint8Array([...new Uint8Array(31), 1, ...new Uint8Array(31), 2]),
    );
    expect(run.mock.calls[1]?.[0]).toMatchObject({
      operation: "signing.sign",
      payload: "AQID",
    });
  });

  it("reopens the stored hardware record instead of silently replacing it", async () => {
    const store = memoryStore();
    await store.create("signing", signingRecord);
    const run = vi.fn<NativeSecurityHelperRunner>(async (request) => {
      if (request.operation === "signing.inspect") {
        expect(request.keyRecord).toBe(signingRecord);
        return { ok: true, backing: "secure-enclave", publicKey: base64(point) };
      }
      throw new Error("unexpected");
    });
    const helper = new DesktopNativeSecurityHelper({ run, store });
    await expect(helper.getSigningKey()).resolves.toMatchObject({ algorithm: "ES256" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("borrows the device-bound agreement scalar for one operation and erases it", async () => {
    const run: NativeSecurityHelperRunner = async (request) => {
      if (request.operation === "agreement.create") {
        return {
          ok: true,
          keyRecord: agreementRecord,
          publicKey: base64(agreementPublic),
        };
      }
      if (request.operation === "agreement.inspect") {
        return { ok: true, publicKey: base64(agreementPublic) };
      }
      if (request.operation === "agreement.borrow") {
        return { ok: true, secretKey: base64(agreementSecret) };
      }
      throw new Error("unexpected");
    };
    const store = memoryStore();
    const helper = new DesktopNativeSecurityHelper({ run, store });
    expect(await helper.ensureAgreementPublicKey()).toEqual(agreementPublic);
    let borrowed: Uint8Array | undefined;
    await helper.withAgreementSecretKey((secretKey) => {
      borrowed = secretKey;
      expect(secretKey).toEqual(agreementSecret);
    });
    expect(borrowed).toEqual(new Uint8Array(32));
    await helper.deleteAgreementKey();
    await expect(helper.getAgreementPublicKey()).rejects.toMatchObject({ code: "key_missing" });
  });

  it("collapses missing hardware and malformed helper output", async () => {
    const unavailable = new DesktopNativeSecurityHelper({
      store: memoryStore(),
      run: async () => ({ ok: false, error: "unavailable" }),
    });
    await expect(unavailable.getSigningKey()).rejects.toMatchObject({
      name: "DesktopNativeSecurityError",
      code: "hardware_unavailable",
    });

    const malformed = new DesktopNativeSecurityHelper({
      store: memoryStore(),
      run: async () => ({
        ok: true,
        backing: "secure-enclave",
        keyRecord: signingRecord,
        publicKey: "not-base64",
      }),
    });
    await expect(malformed.getSigningKey()).rejects.toBeInstanceOf(DesktopNativeSecurityError);
  });
});
