import { Schema } from "effect";

export const NATIVE_HANDOFF_CAPABILITY_PATH = "/.well-known/ryco-hub" as const;
export const NATIVE_HANDOFF_PROTOCOL_VERSION = 1 as const;
export const NATIVE_HANDOFF_VERSION = 1 as const;
export const NATIVE_HANDOFF_MODE = "system-browser" as const;

export const NATIVE_HANDOFF_START_PATH = "/api/auth/native/handoff/start" as const;
export const NATIVE_HANDOFF_REDEEM_PATH = "/api/auth/native/handoff/redeem" as const;
export const NATIVE_HANDOFF_PRESENTATION_PATH_PREFIX = "/api/auth/native/handoff/" as const;
export const NATIVE_HANDOFF_AUTHORIZE_PATH_PREFIX = "/native/authorize/" as const;
export const NATIVE_HANDOFF_APPROVE_PATH_SUFFIX = "/approve" as const;
export const NATIVE_HANDOFF_CANCEL_PATH_SUFFIX = "/cancel" as const;

export const NATIVE_HANDOFF_CALLBACK_URIS = [
  "ryco-dev://hosted/complete",
  "ryco-preview://hosted/complete",
  "ryco://hosted/complete",
] as const;

export const NATIVE_HANDOFF_TRANSACTION_LIFETIME_MS = 5 * 60_000;
export const NATIVE_HANDOFF_CODE_LIFETIME_MS = 60_000;
export const NATIVE_HANDOFF_MAX_BODY_BYTES = 4 * 1_024;
export const NATIVE_HANDOFF_MAX_CAPABILITY_BYTES = 16 * 1_024;
export const NATIVE_HANDOFF_MAX_DEVICE_LABEL_CHARS = 64;
export const NATIVE_HANDOFF_MAX_URL_CHARS = 2_048;

const strict = <S extends Schema.Top>(schema: S): S =>
  schema.annotate({ parseOptions: { onExcessProperty: "error" } }) as S;

const Base64Url256 = Schema.String.check(
  Schema.isMinLength(43),
  Schema.isMaxLength(43),
  Schema.isPattern(/^[A-Za-z0-9_-]{43}$/),
);
const isBase64Url256 = Schema.is(Base64Url256);

export const NativeHandoffId = Base64Url256.pipe(Schema.brand("NativeHandoffId"));
export type NativeHandoffId = typeof NativeHandoffId.Type;

export const NativeHandoffState = Base64Url256.pipe(Schema.brand("NativeHandoffState"));
export type NativeHandoffState = typeof NativeHandoffState.Type;

export const NativeHandoffCode = Base64Url256.pipe(Schema.brand("NativeHandoffCode"));
export type NativeHandoffCode = typeof NativeHandoffCode.Type;

export const NativeHandoffCodeVerifier = Base64Url256.pipe(
  Schema.brand("NativeHandoffCodeVerifier"),
);
export type NativeHandoffCodeVerifier = typeof NativeHandoffCodeVerifier.Type;

export const NativeHandoffCodeChallenge = Base64Url256.pipe(
  Schema.brand("NativeHandoffCodeChallenge"),
);
export type NativeHandoffCodeChallenge = typeof NativeHandoffCodeChallenge.Type;

export const NativeHandoffCallbackUri = Schema.Literals(NATIVE_HANDOFF_CALLBACK_URIS);
export type NativeHandoffCallbackUri = typeof NativeHandoffCallbackUri.Type;

const EpochMs = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const BoundedDeviceLabel = Schema.Trim.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(NATIVE_HANDOFF_MAX_DEVICE_LABEL_CHARS),
);
const RelyingPartyId = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(253),
  Schema.isPattern(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/i,
  ),
);
const DisplayName = Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(64));

const AuthorizationUrl = Schema.String.check(
  Schema.isMaxLength(NATIVE_HANDOFF_MAX_URL_CHARS),
  Schema.makeFilter((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" &&
        url.hostname.length > 0 &&
        url.username === "" &&
        url.password === "" &&
        url.search === "" &&
        url.hash === "" &&
        new RegExp(`^${NATIVE_HANDOFF_AUTHORIZE_PATH_PREFIX}[A-Za-z0-9_-]{43}$`).test(url.pathname)
        ? undefined
        : "authorization URL must be a canonical HTTPS native-authorization route";
    } catch {
      return "authorization URL must be an absolute URL";
    }
  }),
);

function callbackBase(url: URL): NativeHandoffCallbackUri | null {
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.hash !== "" ||
    url.pathname !== "/complete"
  ) {
    return null;
  }
  const candidate = `${url.protocol}//${url.host}${url.pathname}`;
  return NATIVE_HANDOFF_CALLBACK_URIS.find((value) => value === candidate) ?? null;
}

function hasOnlySearchKeys(url: URL, expected: ReadonlyArray<string>): boolean {
  const expectedSet = new Set(expected);
  const actual = [...url.searchParams.keys()];
  return (
    actual.length === expected.length &&
    actual.every((key) => expectedSet.has(key)) &&
    expected.every((key) => url.searchParams.getAll(key).length === 1)
  );
}

function validCallbackResponse(value: string, outcome: "approved" | "cancelled"): boolean {
  if (value.length < 1 || value.length > NATIVE_HANDOFF_MAX_URL_CHARS) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (callbackBase(url) === null) return false;
  if (outcome === "approved") {
    if (!hasOnlySearchKeys(url, ["code", "state", "handoff_id"])) return false;
    return (
      isBase64Url256(url.searchParams.get("code")) &&
      isBase64Url256(url.searchParams.get("state")) &&
      isBase64Url256(url.searchParams.get("handoff_id"))
    );
  }
  if (!hasOnlySearchKeys(url, ["error", "state", "handoff_id"])) return false;
  return (
    url.searchParams.get("error") === "access_denied" &&
    isBase64Url256(url.searchParams.get("state")) &&
    isBase64Url256(url.searchParams.get("handoff_id"))
  );
}

const ApprovedCallbackUrl = Schema.String.check(
  Schema.makeFilter((value) =>
    validCallbackResponse(value, "approved") ? undefined : "invalid approved callback URL",
  ),
);
const CancelledCallbackUrl = Schema.String.check(
  Schema.makeFilter((value) =>
    validCallbackResponse(value, "cancelled") ? undefined : "invalid cancelled callback URL",
  ),
);

export const NativeHandoffCapability = strict(
  Schema.Struct({
    service: Schema.Literal("ryco-hub"),
    protocolVersion: Schema.Literal(NATIVE_HANDOFF_PROTOCOL_VERSION),
    nativeHandoff: strict(
      Schema.Struct({
        mode: Schema.Literal(NATIVE_HANDOFF_MODE),
        version: Schema.Literal(NATIVE_HANDOFF_VERSION),
      }),
    ),
    relyingParty: strict(
      Schema.Struct({
        id: RelyingPartyId,
        displayName: DisplayName,
      }),
    ),
  }),
);
export type NativeHandoffCapability = typeof NativeHandoffCapability.Type;

export const NativeHandoffStartRequest = strict(
  Schema.Struct({
    redirectUri: NativeHandoffCallbackUri,
    codeChallenge: NativeHandoffCodeChallenge,
    codeChallengeMethod: Schema.Literal("S256"),
    state: NativeHandoffState,
    deviceLabel: BoundedDeviceLabel,
  }),
);
export type NativeHandoffStartRequest = typeof NativeHandoffStartRequest.Type;

export const NativeHandoffStartResponse = strict(
  Schema.Struct({
    handoffId: NativeHandoffId,
    authorizationUrl: AuthorizationUrl,
    expiresAt: EpochMs,
  }),
);
export type NativeHandoffStartResponse = typeof NativeHandoffStartResponse.Type;

export const NativeHandoffPresentation = strict(
  Schema.Struct({
    status: Schema.Literal("pending"),
    deviceLabel: BoundedDeviceLabel,
    expiresAt: EpochMs,
  }),
);
export type NativeHandoffPresentation = typeof NativeHandoffPresentation.Type;

export const NativeHandoffApproveResponse = strict(
  Schema.Struct({ redirectUri: ApprovedCallbackUrl }),
);
export type NativeHandoffApproveResponse = typeof NativeHandoffApproveResponse.Type;

export const NativeHandoffCancelResponse = strict(
  Schema.Struct({ redirectUri: CancelledCallbackUrl }),
);
export type NativeHandoffCancelResponse = typeof NativeHandoffCancelResponse.Type;

export const NativeHandoffRedeemRequest = strict(
  Schema.Struct({
    handoffId: NativeHandoffId,
    code: NativeHandoffCode,
    codeVerifier: NativeHandoffCodeVerifier,
  }),
);
export type NativeHandoffRedeemRequest = typeof NativeHandoffRedeemRequest.Type;

const AccountId = Schema.String.check(
  Schema.isPattern(/^acct_[A-Za-z0-9_-]{22,43}$/),
  Schema.isMaxLength(48),
);
const SessionId = Schema.String.check(
  Schema.isPattern(/^sess_[A-Za-z0-9_-]{22,43}$/),
  Schema.isMaxLength(48),
);
const SessionFamilyId = Schema.String.check(
  Schema.isPattern(/^sfam_[A-Za-z0-9_-]{22,43}$/),
  Schema.isMaxLength(48),
);
const NullableSessionLabel = Schema.NullOr(
  Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(NATIVE_HANDOFF_MAX_DEVICE_LABEL_CHARS)),
);

const NativeHandoffAccount = strict(
  Schema.Struct({
    id: AccountId,
    displayName: Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(200)),
    role: Schema.Literals(["viewer", "operator", "owner"]),
    createdAt: EpochMs,
    disabledAt: Schema.Null,
  }),
);

const NativeHandoffSession = strict(
  Schema.Struct({
    id: SessionId,
    accountId: AccountId,
    familyId: SessionFamilyId,
    clientLabel: NullableSessionLabel,
    kind: Schema.Literal("native"),
    createdAt: EpochMs,
    expiresAt: EpochMs,
    lastSeenAt: EpochMs,
    replacedBySessionId: Schema.Null,
    revokedAt: Schema.Null,
    revocationReasonCode: Schema.Null,
  }).check(
    Schema.makeFilter((session) =>
      session.expiresAt > session.createdAt &&
      session.lastSeenAt >= session.createdAt &&
      session.lastSeenAt <= session.expiresAt
        ? undefined
        : "native session timestamps are inconsistent",
    ),
  ),
);

export const NativeHandoffRedeemResponse = strict(
  Schema.Struct({
    account: NativeHandoffAccount,
    session: NativeHandoffSession,
    token: Base64Url256,
  }).check(
    Schema.makeFilter((value) =>
      value.session.accountId === value.account.id
        ? undefined
        : "native session account does not match",
    ),
  ),
);
export type NativeHandoffRedeemResponse = typeof NativeHandoffRedeemResponse.Type;
