import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";

import { derSignatureToRaw, uncompressedPointToJwk } from "@ryco/client-runtime/relay";
import { generateE2eeAgreementKeyPair } from "@ryco/shared/relayE2eeKeys";
import { describe, expect, it, vi } from "vite-plus/test";

import { DesktopE2eePrekeyIssuer } from "./desktopE2eePrekey.ts";
import type { DesktopLocalIntroductionSecurity } from "./localTrustedIntroduction.ts";
import type { DesktopProtectedRecordStore } from "./protectedRecordStore.ts";

const rawP256 = (key: KeyObject) => {
  const jwk = key.export({ format: "jwk" });
  return Uint8Array.from([
    0x04,
    ...Buffer.from(jwk.x!, "base64url"),
    ...Buffer.from(jwk.y!, "base64url"),
  ]);
};

function harness() {
  const values = new Map<string, string>();
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const identityPublicKey = rawP256(keys.publicKey);
  const agreement = generateE2eeAgreementKeyPair();
  const signTranscript = vi.fn(async (message: Uint8Array) =>
    derSignatureToRaw(Uint8Array.from(sign("sha256", message, keys.privateKey))),
  );
  const store: DesktopProtectedRecordStore = {
    read: async (name) => values.get(name) ?? null,
    create: async (name, value) => {
      if (values.has(name)) return false;
      values.set(name, value);
      return true;
    },
    write: async (name, value) => {
      values.set(name, value);
    },
    delete: async (name) => {
      values.delete(name);
    },
  };
  const security: DesktopLocalIntroductionSecurity = {
    getSigningPublicKey: async () => identityPublicKey,
    getSigningKey: async () => ({
      algorithm: "ES256",
      publicJwk: uncompressedPointToJwk(identityPublicKey),
      sign: signTranscript,
    }),
    ensureAgreementPublicKey: async () => agreement.publicKey,
  };
  return { values, store, security, signTranscript, agreement };
}

describe("Desktop E2EE client prekey", () => {
  it("reuses one verified public certificate for an unchanged account", async () => {
    const state = harness();
    const issuer = new DesktopE2eePrekeyIssuer({
      origin: "https://hub.example.test",
      security: state.security,
      records: state.store,
      now: () => 1_800_000_000_000,
    });

    const first = await issuer.ensure(`acct_${"A".repeat(22)}`);
    const second = await issuer.ensure(`acct_${"A".repeat(22)}`);

    expect(second).toEqual(first);
    expect(state.signTranscript).toHaveBeenCalledOnce();
    expect(state.values.has("e2ee-client-prekey")).toBe(true);
    state.agreement.secretKey.fill(0);
  });

  it("re-signs instead of trusting a corrupted stored certificate", async () => {
    const state = harness();
    state.values.set("e2ee-client-prekey", "not-json");
    const issuer = new DesktopE2eePrekeyIssuer({
      origin: "https://hub.example.test",
      security: state.security,
      records: state.store,
      now: () => 1_800_000_000_000,
    });

    await expect(issuer.ensure(`acct_${"A".repeat(22)}`)).resolves.toMatchObject({
      hubOrigin: "https://hub.example.test",
    });
    expect(state.signTranscript).toHaveBeenCalledOnce();
    state.agreement.secretKey.fill(0);
  });
});
