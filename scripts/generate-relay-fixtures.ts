import {
  RELAY_INITIAL_LIMITS,
  RELAY_MAX_CONTROL_FRAME_BYTES,
  RELAY_MAX_DATA_CHUNK_BYTES,
  RELAY_MAX_DATA_FRAME_BYTES,
  RELAY_PROTOCOL_MAJOR,
  RELAY_PROTOCOL_MINOR,
  RELAY_PROTOCOL_MINIMUM_MINOR,
  type RelayProtocolErrorCode,
} from "@ryco/contracts/relay";
import { decodeRelayFrame, encodeRelayFrame } from "@ryco/shared/relayCodec";
import { encode, rfc8949EncodeOptions } from "cborg";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const RELAY_FIXTURE_ROOT = fileURLToPath(
  new URL("../packages/contracts/fixtures/relay/v1/", import.meta.url),
);

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

interface FixtureSource {
  readonly path: string;
  readonly purpose: string;
  readonly bytes: Uint8Array;
  readonly expectedError?: RelayProtocolErrorCode;
}

interface FixtureManifestEntry {
  readonly path: string;
  readonly purpose: string;
  readonly encodedBytes: number;
  readonly sha256: string;
  readonly expected:
    | { readonly status: "success"; readonly value: JsonValue }
    | { readonly status: "error"; readonly code: RelayProtocolErrorCode };
}

export interface RelayFixtureCorpus {
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly manifest: {
    readonly formatVersion: 1;
    readonly encoding: "deterministic-cbor-rfc8949";
    readonly protocol: {
      readonly major: number;
      readonly currentMinor: number;
      readonly minimumMinor: number;
    };
    readonly fixtures: readonly FixtureManifestEntry[];
  };
  readonly manifestJson: string;
}

const version = {
  protocolMajor: RELAY_PROTOCOL_MAJOR,
  protocolMinor: RELAY_PROTOCOL_MINOR,
} as const;
const nodeId = `node_${"n".repeat(22)}`;
const channelId = `ch_${"c".repeat(22)}`;
const heartbeatNonce = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]);

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function encodeFrame(frame: unknown): Uint8Array {
  const result = encodeRelayFrame(frame);
  if (!result.ok) {
    throw new Error(`Fixture source failed to encode: ${result.error.code}`);
  }
  return result.value;
}

function encodeRaw(value: unknown): Uint8Array {
  return encode(value, rfc8949EncodeOptions);
}

function appendByte(bytes: Uint8Array, byte: number): Uint8Array {
  const output = new Uint8Array(bytes.byteLength + 1);
  output.set(bytes);
  output[output.byteLength - 1] = byte;
  return output;
}

function makeNonCanonicalInteger(): Uint8Array {
  const canonical = encodeRaw({ protocolMajor: 1, protocolMinor: 1 });
  const integerIndex = canonical.lastIndexOf(1);
  if (integerIndex < 0) {
    throw new Error("Unable to construct noncanonical integer fixture");
  }
  const output = new Uint8Array(canonical.byteLength + 1);
  output.set(canonical.subarray(0, integerIndex), 0);
  output[integerIndex] = 0x18;
  output[integerIndex + 1] = 0x01;
  output.set(canonical.subarray(integerIndex + 1), integerIndex + 2);
  return output;
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return { $bytes: Buffer.from(value).toString("hex") };
  }
  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }
  if (typeof value === "object" && value !== null) {
    const output: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).toSorted()) {
      output[key] = toJsonValue((value as Record<string, unknown>)[key]);
    }
    return output;
  }
  throw new Error("Fixture expected value is outside the manifest JSON profile");
}

function validFixture(path: string, purpose: string, frame: unknown): FixtureSource {
  return { path: `valid/${path}.cbor`, purpose, bytes: encodeFrame(frame) };
}

function buildFixtureSources(): readonly FixtureSource[] {
  const validPing = encodeFrame({ type: "ping", ...version, nonce: heartbeatNonce });

  return [
    validFixture("auth-node", "Valid node authentication handshake", {
      type: "auth",
      peer: "node",
      ...version,
      nodeId,
      nonce: new Uint8Array(32).fill(0x11),
      signature: new Uint8Array(64).fill(0x22),
    }),
    validFixture("auth-client", "Valid client relay-ticket authentication handshake", {
      type: "auth",
      peer: "client",
      ...version,
      relayTicket: new Uint8Array(32).fill(0x33),
    }),
    validFixture("ready", "Valid ready frame with initial negotiated limits", {
      type: "ready",
      ...version,
      limits: RELAY_INITIAL_LIMITS,
    }),
    validFixture("channel-open", "Valid channel.open frame", {
      type: "channel.open",
      ...version,
      channelId,
    }),
    validFixture("channel-accept", "Valid channel.accept frame", {
      type: "channel.accept",
      ...version,
      channelId,
    }),
    validFixture("channel-reject", "Valid channel.reject frame with v1.1 retry metadata", {
      type: "channel.reject",
      ...version,
      channelId,
      reason: "rate_limited",
      retryAfterMs: 5_000,
    }),
    validFixture("data", "Valid opaque binary data frame", {
      type: "data",
      ...version,
      channelId,
      sequence: 7,
      payload: Uint8Array.from([0x00, 0xff, 0x80, 0x7f, 0x52, 0x50, 0x43]),
    }),
    validFixture("flow-pause", "Valid flow.pause frame", {
      type: "flow.pause",
      ...version,
      channelId,
    }),
    validFixture("flow-resume", "Valid flow.resume frame", {
      type: "flow.resume",
      ...version,
      channelId,
    }),
    validFixture("channel-close", "Valid channel.close frame", {
      type: "channel.close",
      ...version,
      channelId,
      reason: "server_draining",
    }),
    validFixture("ping", "Valid heartbeat ping frame", {
      type: "ping",
      ...version,
      nonce: heartbeatNonce,
    }),
    validFixture("pong", "Valid heartbeat pong frame", {
      type: "pong",
      ...version,
      nonce: heartbeatNonce,
    }),
    validFixture("error", "Valid upgrade-facing protocol error frame", {
      type: "error",
      ...version,
      code: "protocol_unsupported",
      fatal: true,
      supported: { protocolMajor: 1, minimumMinor: 0, maximumMinor: 1 },
    }),
    {
      path: "valid/older-minor-channel-open.cbor",
      purpose: "Compatible protocol 1.0 frame",
      bytes: encodeFrame({
        type: "channel.open",
        protocolMajor: 1,
        protocolMinor: 0,
        channelId,
      }),
    },
    {
      path: "valid/future-optional-channel-open.cbor",
      purpose: "Known frame with a canonical future optional field",
      bytes: encodeRaw({
        type: "channel.open",
        protocolMajor: 1,
        protocolMinor: 7,
        channelId,
        futureCapability: { enabled: true, generation: 2 },
      }),
    },
    {
      path: "invalid/missing-discriminant.cbor",
      purpose: "Envelope without a type discriminant",
      bytes: encodeRaw(version),
      expectedError: "missing_discriminant",
    },
    {
      path: "invalid/unknown-frame-type.cbor",
      purpose: "Envelope with an unknown frame discriminant",
      bytes: encodeRaw({ type: "future.frame", ...version }),
      expectedError: "unknown_frame_type",
    },
    {
      path: "invalid/unsupported-major.cbor",
      purpose: "Frame using unsupported protocol major version 2",
      bytes: encodeRaw({
        type: "ping",
        protocolMajor: 2,
        protocolMinor: 0,
        nonce: heartbeatNonce,
      }),
      expectedError: "protocol_unsupported",
    },
    {
      path: "invalid/truncated-ping.cbor",
      purpose: "Truncated canonical frame",
      bytes: validPing.slice(0, -1),
      expectedError: "invalid_encoding",
    },
    {
      path: "invalid/trailing-byte.cbor",
      purpose: "Canonical frame followed by a second CBOR item",
      bytes: appendByte(validPing, 0),
      expectedError: "invalid_encoding",
    },
    {
      path: "invalid/noncanonical-integer.cbor",
      purpose: "Integer encoded wider than its deterministic representation",
      bytes: makeNonCanonicalInteger(),
      expectedError: "invalid_encoding",
    },
    {
      path: "invalid/malformed-cbor.cbor",
      purpose: "Malformed standalone CBOR break code",
      bytes: Uint8Array.of(0xff),
      expectedError: "invalid_encoding",
    },
    {
      path: "invalid/malformed-node-id.cbor",
      purpose: "Node authentication with malformed node identifier",
      bytes: encodeRaw({
        type: "auth",
        peer: "node",
        ...version,
        nodeId: "node_invalid+identifier",
        nonce: new Uint8Array(32),
        signature: new Uint8Array(64),
      }),
      expectedError: "invalid_frame",
    },
    {
      path: "invalid/oversized-channel-id.cbor",
      purpose: "Channel identifier longer than the explicit bound",
      bytes: encodeRaw({
        type: "channel.open",
        ...version,
        channelId: `ch_${"c".repeat(23)}`,
      }),
      expectedError: "invalid_frame",
    },
    {
      path: "invalid/missing-required-field.cbor",
      purpose: "channel.open frame missing channelId",
      bytes: encodeRaw({ type: "channel.open", ...version }),
      expectedError: "invalid_frame",
    },
    {
      path: "invalid/invalid-binary-payload.cbor",
      purpose: "Data payload encoded as text instead of a CBOR byte string",
      bytes: encodeRaw({
        type: "data",
        ...version,
        channelId,
        sequence: 0,
        payload: "not-binary",
      }),
      expectedError: "invalid_frame",
    },
    {
      path: "invalid/invalid-client-ticket.cbor",
      purpose: "Client authentication with text ticket material",
      bytes: encodeRaw({
        type: "auth",
        peer: "client",
        ...version,
        relayTicket: "RELAY_TICKET_CANARY_NOT_BYTES",
      }),
      expectedError: "invalid_frame",
    },
    {
      path: "invalid/invalid-limits-range.cbor",
      purpose: "Ready frame with zero simultaneous channels",
      bytes: encodeRaw({
        type: "ready",
        ...version,
        limits: { ...RELAY_INITIAL_LIMITS, maxChannels: 0 },
      }),
      expectedError: "invalid_limits",
    },
    {
      path: "invalid/invalid-limits-relation.cbor",
      purpose: "Ready frame with a queue smaller than one maximum data frame",
      bytes: encodeRaw({
        type: "ready",
        ...version,
        limits: {
          ...RELAY_INITIAL_LIMITS,
          maxQueuedBytes: RELAY_INITIAL_LIMITS.maxDataChunkBytes,
        },
      }),
      expectedError: "invalid_limits",
    },
    {
      path: "invalid/retry-on-minor-zero.cbor",
      purpose: "Version 1.0 rejection using v1.1 retry metadata",
      bytes: encodeRaw({
        type: "channel.reject",
        protocolMajor: 1,
        protocolMinor: 0,
        channelId,
        reason: "rate_limited",
        retryAfterMs: 1_000,
      }),
      expectedError: "invalid_frame",
    },
    {
      path: "invalid/oversized-control-frame.cbor",
      purpose: "Control frame larger than the 256 KiB encoded limit",
      bytes: encodeRaw({
        type: "ping",
        ...version,
        nonce: heartbeatNonce,
        futureBlob: new Uint8Array(RELAY_MAX_CONTROL_FRAME_BYTES),
      }),
      expectedError: "frame_too_large",
    },
    {
      path: "invalid/oversized-data-payload.cbor",
      purpose: "Data payload one byte larger than the 256 KiB chunk limit",
      bytes: encodeRaw({
        type: "data",
        ...version,
        channelId,
        sequence: 0,
        payload: new Uint8Array(RELAY_MAX_DATA_CHUNK_BYTES + 1),
      }),
      expectedError: "frame_too_large",
    },
    {
      path: "invalid/oversized-absolute-frame.cbor",
      purpose: "Frame larger than the absolute 257 KiB message limit",
      bytes: encodeRaw({
        type: "ping",
        ...version,
        nonce: heartbeatNonce,
        futureBlob: new Uint8Array(RELAY_MAX_DATA_FRAME_BYTES),
      }),
      expectedError: "frame_too_large",
    },
  ];
}

export function generateRelayFixtureCorpus(): RelayFixtureCorpus {
  const sources = [...buildFixtureSources()].toSorted((left, right) =>
    left.path.localeCompare(right.path),
  );
  const files = new Map<string, Uint8Array>();
  const fixtures: FixtureManifestEntry[] = [];

  for (const source of sources) {
    const result = decodeRelayFrame(source.bytes);
    let expected: FixtureManifestEntry["expected"];
    if (source.expectedError === undefined) {
      if (!result.ok) {
        throw new Error(`${source.path} unexpectedly failed with ${result.error.code}`);
      }
      expected = { status: "success", value: toJsonValue(result.value) };
    } else {
      if (result.ok || result.error.code !== source.expectedError) {
        const actual = result.ok ? "success" : result.error.code;
        throw new Error(`${source.path} expected ${source.expectedError} but received ${actual}`);
      }
      expected = { status: "error", code: source.expectedError };
    }

    files.set(source.path, source.bytes);
    fixtures.push({
      path: source.path,
      purpose: source.purpose,
      encodedBytes: source.bytes.byteLength,
      sha256: sha256(source.bytes),
      expected,
    });
  }

  const manifest = {
    formatVersion: 1 as const,
    encoding: "deterministic-cbor-rfc8949" as const,
    protocol: {
      major: RELAY_PROTOCOL_MAJOR,
      currentMinor: RELAY_PROTOCOL_MINOR,
      minimumMinor: RELAY_PROTOCOL_MINIMUM_MINOR,
    },
    fixtures,
  };
  return { files, manifest, manifestJson: `${JSON.stringify(manifest, null, 2)}\n` };
}

export async function writeRelayFixtureCorpus(
  fixtureRoot: string = RELAY_FIXTURE_ROOT,
): Promise<void> {
  const corpus = generateRelayFixtureCorpus();
  await Promise.all([
    rm(`${fixtureRoot}/valid`, { recursive: true, force: true }),
    rm(`${fixtureRoot}/invalid`, { recursive: true, force: true }),
  ]);
  await mkdir(`${fixtureRoot}/valid`, { recursive: true });
  await mkdir(`${fixtureRoot}/invalid`, { recursive: true });
  for (const [relativePath, bytes] of corpus.files) {
    await writeFile(`${fixtureRoot}/${relativePath}`, bytes);
  }
  await writeFile(`${fixtureRoot}/manifest.json`, corpus.manifestJson, "utf8");
}

if (import.meta.main) {
  await writeRelayFixtureCorpus();
  process.stdout.write(`Wrote relay fixtures to ${RELAY_FIXTURE_ROOT}\n`);
}
