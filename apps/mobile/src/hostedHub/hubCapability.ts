import type { HttpClientService } from "@ryco/client-runtime/platform";

export const HUB_CAPABILITY_PATH = "/.well-known/ryco-hub";
export const SUPPORTED_HUB_PROTOCOL_VERSION = 1;
export const SUPPORTED_HUB_HANDOFF_VERSION = 1;

const MAX_CAPABILITY_BODY_LENGTH = 16_384;
const MAX_RELYING_PARTY_LENGTH = 253;
const MAX_DISPLAY_NAME_LENGTH = 64;
const MAX_MODE_LENGTH = 32;
const RELYING_PARTY_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/i;

export type HubCapabilityFailureReason =
  | "capability-not-found"
  | "invalid-document"
  | "invalid-relying-party"
  | "unreachable"
  | "unsupported-handoff"
  | "unsupported-protocol";

export interface HubCapability {
  readonly protocolVersion: number;
  readonly nativeHandoff: {
    readonly mode: string;
    readonly version: number;
  };
  readonly relyingParty: {
    readonly id: string;
    readonly displayName: string | null;
  };
}

export type HubCapabilityCheck =
  | {
      readonly status: "compatible";
      readonly checkedAt: number;
      readonly capability: HubCapability;
    }
  | {
      readonly status: "incompatible";
      readonly checkedAt: number;
      readonly reason: HubCapabilityFailureReason;
    };

type CapabilityDecodeResult =
  | { readonly ok: true; readonly capability: HubCapability }
  | { readonly ok: false; readonly reason: "invalid-document" | "invalid-relying-party" };

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function boundedInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 65_535;
}

function boundedMode(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_MODE_LENGTH &&
    /^[a-z][a-z0-9-]*$/.test(value)
  );
}

function validRelyingPartyId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_RELYING_PARTY_LENGTH &&
    RELYING_PARTY_PATTERN.test(value)
  );
}

function relyingPartyMatchesOrigin(relyingPartyId: string, origin: string): boolean {
  const hostname = new URL(origin).hostname.toLocaleLowerCase();
  const candidate = relyingPartyId.toLocaleLowerCase();
  return hostname === candidate || hostname.endsWith(`.${candidate}`);
}

export function decodeHubCapability(value: unknown, origin: string): CapabilityDecodeResult {
  const document = objectValue(value);
  const nativeHandoff = objectValue(document?.nativeHandoff);
  const relyingParty = objectValue(document?.relyingParty);
  if (
    document?.service !== "ryco-hub" ||
    !boundedInteger(document.protocolVersion) ||
    !nativeHandoff ||
    !boundedMode(nativeHandoff.mode) ||
    !boundedInteger(nativeHandoff.version) ||
    !relyingParty ||
    !validRelyingPartyId(relyingParty.id)
  ) {
    return { ok: false, reason: "invalid-document" };
  }
  if (!relyingPartyMatchesOrigin(relyingParty.id, origin)) {
    return { ok: false, reason: "invalid-relying-party" };
  }
  const displayName =
    typeof relyingParty.displayName === "string" &&
    relyingParty.displayName.trim().length > 0 &&
    Array.from(relyingParty.displayName.trim()).length <= MAX_DISPLAY_NAME_LENGTH
      ? relyingParty.displayName.trim()
      : null;
  return {
    ok: true,
    capability: {
      protocolVersion: document.protocolVersion,
      nativeHandoff: {
        mode: nativeHandoff.mode,
        version: nativeHandoff.version,
      },
      relyingParty: {
        id: relyingParty.id.toLocaleLowerCase(),
        displayName,
      },
    },
  };
}

export function createHubCapabilityClient(
  httpClient: HttpClientService,
  now: () => number = Date.now,
): {
  readonly check: (origin: string, signal?: AbortSignal) => Promise<HubCapabilityCheck>;
} {
  return {
    check: async (origin, signal) => {
      const checkedAt = now();
      let response: Awaited<ReturnType<HttpClientService["fetch"]>>;
      try {
        response = await httpClient.fetch(new URL(HUB_CAPABILITY_PATH, origin).toString(), {
          method: "GET",
          headers: { Accept: "application/json" },
          credentials: "omit",
          cache: "no-store",
          ...(signal ? { signal } : {}),
        });
      } catch {
        return { status: "incompatible", checkedAt, reason: "unreachable" };
      }
      if (!response.ok) {
        return {
          status: "incompatible",
          checkedAt,
          reason: response.status === 404 ? "capability-not-found" : "unreachable",
        };
      }

      let body: string;
      try {
        body = await response.text();
      } catch {
        return { status: "incompatible", checkedAt, reason: "invalid-document" };
      }
      if (body.length === 0 || body.length > MAX_CAPABILITY_BODY_LENGTH) {
        return { status: "incompatible", checkedAt, reason: "invalid-document" };
      }

      let value: unknown;
      try {
        value = JSON.parse(body);
      } catch {
        return { status: "incompatible", checkedAt, reason: "invalid-document" };
      }
      const decoded = decodeHubCapability(value, origin);
      if (!decoded.ok) {
        return { status: "incompatible", checkedAt, reason: decoded.reason };
      }
      if (decoded.capability.protocolVersion !== SUPPORTED_HUB_PROTOCOL_VERSION) {
        return { status: "incompatible", checkedAt, reason: "unsupported-protocol" };
      }
      if (
        decoded.capability.nativeHandoff.mode !== "system-browser" ||
        decoded.capability.nativeHandoff.version !== SUPPORTED_HUB_HANDOFF_VERSION
      ) {
        return { status: "incompatible", checkedAt, reason: "unsupported-handoff" };
      }
      return { status: "compatible", checkedAt, capability: decoded.capability };
    },
  };
}

export function hubCapabilityFailureText(reason: HubCapabilityFailureReason): string {
  switch (reason) {
    case "capability-not-found":
      return "This server does not advertise Ryco Hub mobile support.";
    case "invalid-document":
      return "The Hub returned an invalid compatibility document.";
    case "invalid-relying-party":
      return "The Hub advertised a relying party that does not match its domain.";
    case "unreachable":
      return "Ryco could not reach the Hub compatibility endpoint.";
    case "unsupported-handoff":
      return "This Hub does not support the required system-browser handoff.";
    case "unsupported-protocol":
      return "This Hub uses an unsupported mobile protocol version.";
  }
}
