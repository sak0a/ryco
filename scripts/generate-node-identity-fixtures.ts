import {
  encodeNodeAuthenticationTranscript,
  encodeNodeKeyRotationTranscript,
  fingerprintNodePublicKey,
  formatNodePublicKeyFingerprint,
} from "@ryco/shared/nodeIdentity";
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const NODE_IDENTITY_FIXTURE_ROOT = fileURLToPath(
  new URL("../packages/shared/fixtures/node-identity/v1/", import.meta.url),
);

const TEST_SEED = Buffer.from(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  "hex",
);

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function generateNodeIdentityFixtureManifest(): string {
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), TEST_SEED]),
    format: "der",
    type: "pkcs8",
  });
  const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const publicKey = Uint8Array.from(spki.subarray(spki.byteLength - 32));
  const fingerprint = fingerprintNodePublicKey({ algorithm: "ed25519", publicKey });
  const authenticationTranscript = encodeNodeAuthenticationTranscript({
    hubOrigin: "https://hub.example.com",
    protocolMajor: 1,
    protocolMinor: 1,
    nodeId: "node_AAAAAAAAAAAAAAAAAAAAAA",
    activeKeyId: "nkey_BBBBBBBBBBBBBBBBBBBBBB",
    challengeExpiresAt: 1_784_160_030_000,
    challenge: new Uint8Array(32).fill(0x5a),
  });
  const rotationTranscript = encodeNodeKeyRotationTranscript({
    hubOrigin: "https://hub.example.com",
    protocolMajor: 1,
    protocolMinor: 1,
    rotationRequestId: "nrot_CCCCCCCCCCCCCCCCCCCCCC",
    nodeId: "node_AAAAAAAAAAAAAAAAAAAAAA",
    oldActiveKeyId: "nkey_BBBBBBBBBBBBBBBBBBBBBB",
    newKeyId: "nkey_DDDDDDDDDDDDDDDDDDDDDD",
    newKey: { algorithm: "ed25519", publicKey },
    challengeExpiresAt: 1_784_160_030_000,
    challenge: new Uint8Array(32).fill(0xa5),
  });

  const manifest = {
    formatVersion: 1,
    warning: "Deterministic test material only; never use this key for a real node.",
    encoding: "deterministic-cbor-rfc8949",
    algorithm: "ed25519",
    publicKeyHex: hex(publicKey),
    fingerprintHex: hex(fingerprint),
    fingerprintDisplay: formatNodePublicKeyFingerprint(fingerprint),
    authentication: {
      transcriptHex: hex(authenticationTranscript),
      transcriptSha256: sha256(authenticationTranscript),
      signatureHex: sign(null, authenticationTranscript, privateKey).toString("hex"),
    },
    rotation: {
      transcriptHex: hex(rotationTranscript),
      transcriptSha256: sha256(rotationTranscript),
      signatureHex: sign(null, rotationTranscript, privateKey).toString("hex"),
    },
  } as const;
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export async function writeNodeIdentityFixtureManifest(
  fixtureRoot: string = NODE_IDENTITY_FIXTURE_ROOT,
): Promise<void> {
  await mkdir(fixtureRoot, { recursive: true });
  await writeFile(`${fixtureRoot}/manifest.json`, generateNodeIdentityFixtureManifest(), "utf8");
}

if (import.meta.main) {
  await writeNodeIdentityFixtureManifest();
  process.stdout.write(`Wrote node identity fixtures to ${NODE_IDENTITY_FIXTURE_ROOT}\n`);
}
