import { decodeBase64Url, encodeBase64Url } from "./base64url";

interface JsonCredentialDescriptor {
  readonly id: string;
  readonly type: "public-key";
  readonly transports?: ReadonlyArray<AuthenticatorTransport>;
}

interface AuthenticationOptionsJson {
  readonly challenge: string;
  readonly timeout?: number;
  readonly rpId?: string;
  readonly allowCredentials?: ReadonlyArray<JsonCredentialDescriptor>;
  readonly userVerification?: UserVerificationRequirement;
  readonly extensions?: AuthenticationExtensionsClientInputs;
}

interface RegistrationOptionsJson {
  readonly challenge: string;
  readonly rp: PublicKeyCredentialRpEntity;
  readonly user: Omit<PublicKeyCredentialUserEntity, "id"> & { readonly id: string };
  readonly pubKeyCredParams: ReadonlyArray<PublicKeyCredentialParameters>;
  readonly timeout?: number;
  readonly excludeCredentials?: ReadonlyArray<JsonCredentialDescriptor>;
  readonly authenticatorSelection?: AuthenticatorSelectionCriteria;
  readonly attestation?: AttestationConveyancePreference;
  readonly extensions?: AuthenticationExtensionsClientInputs;
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

function descriptor(input: JsonCredentialDescriptor): PublicKeyCredentialDescriptor {
  return {
    id: decodeBase64Url(input.id),
    type: "public-key",
    ...(input.transports ? { transports: [...input.transports] } : {}),
  };
}

function authenticatorAttachment(value: string | null): AuthenticatorAttachment | undefined {
  return value === "platform" || value === "cross-platform" ? value : undefined;
}

function authenticatorTransports(
  values: ReadonlyArray<string>,
): ReadonlyArray<AuthenticatorTransport> {
  const allowed = new Set<string>([
    "ble",
    "cable",
    "hybrid",
    "internal",
    "nfc",
    "smart-card",
    "usb",
  ]);
  return values.filter((value): value is AuthenticatorTransport => allowed.has(value));
}

function publicKeyCredential(value: Credential | null): PublicKeyCredential {
  if (!(value instanceof PublicKeyCredential)) throw new Error("Passkey ceremony was cancelled.");
  return value;
}

export async function getPasskeyAuthentication(
  options: unknown,
  signal?: AbortSignal,
): Promise<AuthenticationResponseJson> {
  const input = options as AuthenticationOptionsJson;
  if (typeof input?.challenge !== "string") throw new Error("Invalid passkey options.");
  const credential = publicKeyCredential(
    await navigator.credentials.get({
      publicKey: {
        challenge: decodeBase64Url(input.challenge),
        ...(input.timeout === undefined ? {} : { timeout: input.timeout }),
        ...(input.rpId === undefined ? {} : { rpId: input.rpId }),
        ...(input.allowCredentials
          ? { allowCredentials: input.allowCredentials.map(descriptor) }
          : {}),
        ...(input.userVerification === undefined
          ? {}
          : { userVerification: input.userVerification }),
        ...(input.extensions === undefined ? {} : { extensions: input.extensions }),
      },
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
  const input = options as RegistrationOptionsJson;
  if (
    typeof input?.challenge !== "string" ||
    typeof input.user?.id !== "string" ||
    !Array.isArray(input.pubKeyCredParams)
  ) {
    throw new Error("Invalid passkey options.");
  }
  const credential = publicKeyCredential(
    await navigator.credentials.create({
      publicKey: {
        challenge: decodeBase64Url(input.challenge),
        rp: input.rp,
        user: { ...input.user, id: decodeBase64Url(input.user.id) },
        pubKeyCredParams: [...input.pubKeyCredParams],
        ...(input.timeout === undefined ? {} : { timeout: input.timeout }),
        ...(input.excludeCredentials
          ? { excludeCredentials: input.excludeCredentials.map(descriptor) }
          : {}),
        ...(input.authenticatorSelection === undefined
          ? {}
          : { authenticatorSelection: input.authenticatorSelection }),
        ...(input.attestation === undefined ? {} : { attestation: input.attestation }),
        ...(input.extensions === undefined ? {} : { extensions: input.extensions }),
      },
      ...(signal ? { signal } : {}),
    }),
  );
  const response = credential.response;
  if (!(response instanceof AuthenticatorAttestationResponse)) {
    throw new Error("Invalid passkey response.");
  }
  const publicKey = response.getPublicKey?.() ?? null;
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
      ...(publicKey ? { publicKey: encodeBase64Url(publicKey) } : {}),
      ...(authenticatorData ? { authenticatorData: encodeBase64Url(authenticatorData) } : {}),
    },
    type: "public-key",
    clientExtensionResults: credential.getClientExtensionResults(),
    ...(authenticatorAttachment(credential.authenticatorAttachment)
      ? { authenticatorAttachment: authenticatorAttachment(credential.authenticatorAttachment)! }
      : {}),
  };
}
