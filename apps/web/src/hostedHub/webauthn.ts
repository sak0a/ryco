import { decodeBase64Url, encodeBase64Url } from "./base64url";

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
  readonly clientExtensionResults: AuthenticationExtensionsClientOutputs;
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
  readonly clientExtensionResults: AuthenticationExtensionsClientOutputs;
  readonly authenticatorAttachment?: AuthenticatorAttachment;
}

type JsonRecord = Record<string, unknown>;

const AUTHENTICATOR_TRANSPORTS = new Set<string>([
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
  return objectValue(value) as AuthenticationExtensionsClientInputs;
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

function authenticatorAttachment(value: string | null): AuthenticatorAttachment | undefined {
  return value === "platform" || value === "cross-platform" ? value : undefined;
}

function authenticatorTransports(
  values: ReadonlyArray<string>,
): ReadonlyArray<AuthenticatorTransport> {
  return values.filter((value): value is AuthenticatorTransport =>
    AUTHENTICATOR_TRANSPORTS.has(value),
  );
}

function publicKeyCredential(value: Credential | null): PublicKeyCredential {
  if (!(value instanceof PublicKeyCredential)) throw new Error("Passkey ceremony was cancelled.");
  return value;
}

export async function getPasskeyAuthentication(
  options: unknown,
  signal?: AbortSignal,
): Promise<AuthenticationResponseJson> {
  const publicKeyOptions = authenticationOptions(options);
  const credential = publicKeyCredential(
    await navigator.credentials.get({
      publicKey: publicKeyOptions,
      ...(signal ? { signal } : {}),
    }),
  );
  const response = credential.response;
  if (!(response instanceof AuthenticatorAssertionResponse)) {
    throw new Error("Invalid passkey response.");
  }
  return {
    id: credential.id,
    rawId: encodeBase64Url(credential.rawId),
    response: {
      clientDataJSON: encodeBase64Url(response.clientDataJSON),
      authenticatorData: encodeBase64Url(response.authenticatorData),
      signature: encodeBase64Url(response.signature),
      ...(response.userHandle ? { userHandle: encodeBase64Url(response.userHandle) } : {}),
    },
    type: "public-key",
    clientExtensionResults: credential.getClientExtensionResults(),
    ...(authenticatorAttachment(credential.authenticatorAttachment)
      ? { authenticatorAttachment: authenticatorAttachment(credential.authenticatorAttachment)! }
      : {}),
  };
}

export async function createPasskeyRegistration(
  options: unknown,
  signal?: AbortSignal,
): Promise<RegistrationResponseJson> {
  const publicKeyOptions = registrationOptions(options);
  const credential = publicKeyCredential(
    await navigator.credentials.create({
      publicKey: publicKeyOptions,
      ...(signal ? { signal } : {}),
    }),
  );
  const response = credential.response;
  if (!(response instanceof AuthenticatorAttestationResponse)) {
    throw new Error("Invalid passkey response.");
  }
  const publicKeyBytes = response.getPublicKey?.() ?? null;
  const authenticatorData = response.getAuthenticatorData?.();
  const publicKeyAlgorithm = response.getPublicKeyAlgorithm?.();
  const transports = response.getTransports?.();
  return {
    id: credential.id,
    rawId: encodeBase64Url(credential.rawId),
    response: {
      clientDataJSON: encodeBase64Url(response.clientDataJSON),
      attestationObject: encodeBase64Url(response.attestationObject),
      ...(transports ? { transports: authenticatorTransports(transports) } : {}),
      ...(publicKeyAlgorithm === undefined ? {} : { publicKeyAlgorithm }),
      ...(publicKeyBytes ? { publicKey: encodeBase64Url(publicKeyBytes) } : {}),
      ...(authenticatorData ? { authenticatorData: encodeBase64Url(authenticatorData) } : {}),
    },
    type: "public-key",
    clientExtensionResults: credential.getClientExtensionResults(),
    ...(authenticatorAttachment(credential.authenticatorAttachment)
      ? { authenticatorAttachment: authenticatorAttachment(credential.authenticatorAttachment)! }
      : {}),
  };
}
