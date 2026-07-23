import { decodeBase64Url } from "./base64url.ts";

/**
 * Platform-neutral WebAuthn option/response codecs. The browser ceremony
 * (`navigator.credentials`) is supplied by the web adapter behind the platform
 * `PasskeyCeremony` seam; this module owns only the fail-closed option
 * validation and the response transcript shapes. The DOM lib is excluded from
 * this package, so the WebAuthn structural types the codecs need are declared
 * locally as neutral shapes rather than pulled from `lib.dom`.
 */

/** Neutral mirrors of the WebAuthn dictionaries used by the codecs below. */
export type AuthenticatorAttachment = "platform" | "cross-platform";
export type AuthenticatorTransport =
  | "ble"
  | "cable"
  | "hybrid"
  | "internal"
  | "nfc"
  | "smart-card"
  | "usb";
type UserVerificationRequirement = "discouraged" | "preferred" | "required";
type ResidentKeyRequirement = "discouraged" | "preferred" | "required";
type AttestationConveyancePreference = "none" | "indirect" | "direct" | "enterprise";
type AuthenticationExtensionsClientInputs = Record<string, unknown>;

interface PublicKeyCredentialDescriptor {
  id: Uint8Array<ArrayBuffer>;
  type: "public-key";
  transports?: AuthenticatorTransport[];
}

interface PublicKeyCredentialParameters {
  type: "public-key";
  alg: number;
}

interface AuthenticatorSelectionCriteria {
  authenticatorAttachment?: AuthenticatorAttachment;
  residentKey?: ResidentKeyRequirement;
  requireResidentKey?: boolean;
  userVerification?: UserVerificationRequirement;
}

interface PublicKeyCredentialRequestOptions {
  challenge: Uint8Array<ArrayBuffer>;
  timeout?: number;
  rpId?: string;
  allowCredentials?: PublicKeyCredentialDescriptor[];
  userVerification?: UserVerificationRequirement;
  extensions?: AuthenticationExtensionsClientInputs;
}

interface PublicKeyCredentialCreationOptions {
  challenge: Uint8Array<ArrayBuffer>;
  rp: { name: string; id?: string };
  user: { id: Uint8Array<ArrayBuffer>; name: string; displayName: string };
  pubKeyCredParams: PublicKeyCredentialParameters[];
  timeout?: number;
  excludeCredentials?: PublicKeyCredentialDescriptor[];
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  attestation?: AttestationConveyancePreference;
  extensions?: AuthenticationExtensionsClientInputs;
}

export interface AuthenticationResponseJson {
  readonly id: string;
  readonly rawId: string;
  readonly response: {
    readonly clientDataJSON: string;
    readonly authenticatorData: string;
    readonly signature: string;
    readonly userHandle?: string;
  };
  readonly type: "public-key";
  readonly clientExtensionResults: unknown;
  readonly authenticatorAttachment?: AuthenticatorAttachment;
}

export interface RegistrationResponseJson {
  readonly id: string;
  readonly rawId: string;
  readonly response: {
    readonly clientDataJSON: string;
    readonly attestationObject: string;
    readonly transports?: ReadonlyArray<AuthenticatorTransport>;
    readonly publicKeyAlgorithm?: number;
    readonly publicKey?: string | null;
    readonly authenticatorData?: string;
  };
  readonly type: "public-key";
  readonly clientExtensionResults: unknown;
  readonly authenticatorAttachment?: AuthenticatorAttachment;
}

type JsonRecord = Record<string, unknown>;

export const AUTHENTICATOR_TRANSPORTS = new Set<string>([
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
]);

function invalidOptions(): never {
  throw new Error("Invalid passkey options.");
}

function objectValue(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalidOptions();
  return value as JsonRecord;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) invalidOptions();
  return value;
}

function optionalTimeout(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalidOptions();
  return value;
}

function credentialBytes(value: unknown): Uint8Array<ArrayBuffer> {
  try {
    return decodeBase64Url(requiredString(value));
  } catch {
    return invalidOptions();
  }
}

function credentialDescriptors(value: unknown): PublicKeyCredentialDescriptor[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) invalidOptions();
  return value.map((entry) => {
    const descriptor = objectValue(entry);
    if (descriptor.type !== "public-key") invalidOptions();
    const transports = descriptor.transports;
    if (transports !== undefined && !Array.isArray(transports)) invalidOptions();
    if (
      Array.isArray(transports) &&
      transports.some(
        (transport) => typeof transport !== "string" || !AUTHENTICATOR_TRANSPORTS.has(transport),
      )
    ) {
      invalidOptions();
    }
    return {
      id: credentialBytes(descriptor.id),
      type: "public-key",
      ...(Array.isArray(transports) ? { transports: transports as AuthenticatorTransport[] } : {}),
    };
  });
}

function userVerification(value: unknown): UserVerificationRequirement | undefined {
  if (value === undefined) return undefined;
  if (value === "discouraged" || value === "preferred" || value === "required") return value;
  return invalidOptions();
}

function extensions(value: unknown): AuthenticationExtensionsClientInputs | undefined {
  if (value === undefined) return undefined;
  return objectValue(value);
}

function authenticationOptions(value: unknown): PublicKeyCredentialRequestOptions {
  const input = objectValue(value);
  const options: PublicKeyCredentialRequestOptions = {
    challenge: credentialBytes(input.challenge),
  };
  const timeout = optionalTimeout(input.timeout);
  const rpId = input.rpId === undefined ? undefined : requiredString(input.rpId);
  const allowCredentials = credentialDescriptors(input.allowCredentials);
  const verification = userVerification(input.userVerification);
  const extensionValues = extensions(input.extensions);
  if (timeout !== undefined) options.timeout = timeout;
  if (rpId !== undefined) options.rpId = rpId;
  if (allowCredentials !== undefined) options.allowCredentials = allowCredentials;
  if (verification !== undefined) options.userVerification = verification;
  if (extensionValues !== undefined) options.extensions = extensionValues;
  return options;
}

function registrationOptions(value: unknown): PublicKeyCredentialCreationOptions {
  const input = objectValue(value);
  const rpInput = objectValue(input.rp);
  const userInput = objectValue(input.user);
  if (!Array.isArray(input.pubKeyCredParams) || input.pubKeyCredParams.length === 0)
    invalidOptions();
  const pubKeyCredParams = input.pubKeyCredParams.map((entry) => {
    const parameter = objectValue(entry);
    if (
      parameter.type !== "public-key" ||
      typeof parameter.alg !== "number" ||
      !Number.isSafeInteger(parameter.alg)
    ) {
      invalidOptions();
    }
    return { type: "public-key", alg: parameter.alg } satisfies PublicKeyCredentialParameters;
  });
  const options: PublicKeyCredentialCreationOptions = {
    challenge: credentialBytes(input.challenge),
    rp: {
      name: requiredString(rpInput.name),
      ...(rpInput.id === undefined ? {} : { id: requiredString(rpInput.id) }),
    },
    user: {
      id: credentialBytes(userInput.id),
      name: requiredString(userInput.name),
      displayName: requiredString(userInput.displayName),
    },
    pubKeyCredParams,
  };
  const timeout = optionalTimeout(input.timeout);
  const excludeCredentials = credentialDescriptors(input.excludeCredentials);
  const selection = authenticatorSelection(input.authenticatorSelection);
  const attestation = attestationPreference(input.attestation);
  const extensionValues = extensions(input.extensions);
  if (timeout !== undefined) options.timeout = timeout;
  if (excludeCredentials !== undefined) options.excludeCredentials = excludeCredentials;
  if (selection !== undefined) options.authenticatorSelection = selection;
  if (attestation !== undefined) options.attestation = attestation;
  if (extensionValues !== undefined) options.extensions = extensionValues;
  return options;
}

/** Fail-closed codec executed by the runtime before the platform ceremony seam. */
export function validatePasskeyAuthenticationOptions(value: unknown): unknown {
  return authenticationOptions(value);
}

/** Fail-closed codec executed by the runtime before the platform ceremony seam. */
export function validatePasskeyRegistrationOptions(value: unknown): unknown {
  return registrationOptions(value);
}

function authenticatorSelection(value: unknown): AuthenticatorSelectionCriteria | undefined {
  if (value === undefined) return undefined;
  const input = objectValue(value);
  const attachment = input.authenticatorAttachment;
  const residentKey = input.residentKey;
  const requireResidentKey = input.requireResidentKey;
  const verification = userVerification(input.userVerification);
  if (attachment !== undefined && attachment !== "platform" && attachment !== "cross-platform") {
    invalidOptions();
  }
  if (
    residentKey !== undefined &&
    residentKey !== "discouraged" &&
    residentKey !== "preferred" &&
    residentKey !== "required"
  ) {
    invalidOptions();
  }
  if (requireResidentKey !== undefined && typeof requireResidentKey !== "boolean") invalidOptions();
  return {
    ...(attachment === undefined ? {} : { authenticatorAttachment: attachment }),
    ...(residentKey === undefined ? {} : { residentKey }),
    ...(requireResidentKey === undefined ? {} : { requireResidentKey }),
    ...(verification === undefined ? {} : { userVerification: verification }),
  };
}

function attestationPreference(value: unknown): AttestationConveyancePreference | undefined {
  if (value === undefined) return undefined;
  if (value === "none" || value === "indirect" || value === "direct" || value === "enterprise") {
    return value;
  }
  return invalidOptions();
}
