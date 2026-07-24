import { Context, Layer, Tracer } from "effect";

import type { KnownEnvironmentConnectionTarget } from "../knownEnvironment.ts";
import type { KnownEnvironmentSource } from "../knownEnvironment.ts";

export interface PrimaryEnvironmentTarget {
  readonly source: KnownEnvironmentSource;
  readonly target: KnownEnvironmentConnectionTarget;
}

/** Platform-owned primary endpoint resolution. */
export interface EndpointService {
  readonly origin: () => string;
  readonly readPrimaryTarget: () => PrimaryEnvironmentTarget | null;
  readonly resolveHttpUrl: (
    pathname: string,
    searchParams?: Readonly<Record<string, string>>,
  ) => string;
  readonly resolveWsUrl: (wsBaseUrl: string) => string;
}

export class Endpoint extends Context.Service<Endpoint, EndpointService>()(
  "@ryco/client-runtime/platform/Endpoint",
) {}

/** The WebSocket-constructor seam used by Effect socket layers and the relay. */
export interface SocketService {
  readonly webSocketConstructor: (
    url: string,
    protocols?: string | ReadonlyArray<string>,
  ) => unknown;
}

export class Socket extends Context.Service<Socket, SocketService>()(
  "@ryco/client-runtime/platform/Socket",
) {}

export type AppLifecycleEvent = "background" | "foreground" | "offline" | "online" | "resume";

/** Foreground/background, connectivity, and resume signals. */
export interface AppLifecycleService {
  readonly isForeground: () => boolean;
  readonly isOnline: () => boolean;
  readonly subscribe: (listener: (event: AppLifecycleEvent) => void) => () => void;
}

export class AppLifecycle extends Context.Service<AppLifecycle, AppLifecycleService>()(
  "@ryco/client-runtime/platform/AppLifecycle",
) {}

/** Plain asynchronous key-value storage for non-secret client state. */
export interface KVService {
  readonly getItem: (key: string) => Promise<string | null>;
  readonly setItem: (key: string, value: string) => Promise<void>;
  readonly removeItem: (key: string) => Promise<void>;
}

export class KV extends Context.Service<KV, KVService>()("@ryco/client-runtime/platform/KV") {}

/** Separate storage for bearer tokens and other secrets. */
export interface SecretKVService {
  readonly get: (key: string) => Promise<string | null>;
  /** Returns false when the platform could not persist the secret. */
  readonly set: (key: string, value: string) => Promise<boolean>;
  readonly remove: (key: string) => Promise<void>;
}

export class SecretKV extends Context.Service<SecretKV, SecretKVService>()(
  "@ryco/client-runtime/platform/SecretKV",
) {}

/** Minimal platform HTTP seam; runtime code never reads a global fetch implementation. */
export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly json: () => Promise<unknown>;
  readonly text: () => Promise<string>;
}

export interface HttpRequestInit {
  readonly method?: string;
  readonly headers?: unknown;
  readonly body?: string;
  readonly credentials?: "include" | "omit" | "same-origin";
  readonly cache?: "no-store";
  readonly signal?: AbortSignal;
}

export interface HttpClientService {
  readonly fetch: (url: string, init?: HttpRequestInit) => Promise<HttpResponse>;
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
  readonly authenticatorAttachment?: "platform" | "cross-platform";
}

export interface RegistrationResponseJson {
  readonly id: string;
  readonly rawId: string;
  readonly response: {
    readonly clientDataJSON: string;
    readonly attestationObject: string;
    readonly transports?: ReadonlyArray<string>;
    readonly publicKeyAlgorithm?: number;
    readonly publicKey?: string | null;
    readonly authenticatorData?: string;
  };
  readonly type: "public-key";
  readonly clientExtensionResults: unknown;
  readonly authenticatorAttachment?: "platform" | "cross-platform";
}

/** Native/browser passkey ceremony; shared code validates options before calling it. */
export interface PasskeyCeremonyService {
  readonly authenticate: (
    options: unknown,
    signal?: unknown,
  ) => Promise<AuthenticationResponseJson>;
  readonly register: (options: unknown, signal?: unknown) => Promise<RegistrationResponseJson>;
}

export class PasskeyCeremony extends Context.Service<PasskeyCeremony, PasskeyCeremonyService>()(
  "@ryco/client-runtime/platform/PasskeyCeremony",
) {}

/**
 * Cookie or bearer session policy. Cookie adapters hold only the in-memory CSRF
 * token; bearer (native/DPoP) adapters additionally hold the native session
 * token behind `readBearerToken`/`writeBearerToken`. The bearer accessors are
 * optional so cookie adapters (web) stay untouched; a `mode:"bearer"` adapter
 * that omits them is a configuration error the hosted API rejects on
 * construction.
 */
export interface SessionCredentialsService {
  readonly mode: "bearer" | "cookie";
  readonly readCsrfToken: () => string | null;
  readonly writeCsrfToken: (token: string | null) => void;
  /** Bearer mode only: the persisted native session token (never a cookie). */
  readonly readBearerToken?: () => string | null;
  readonly writeBearerToken?: (token: string | null) => void;
}

export class SessionCredentials extends Context.Service<
  SessionCredentials,
  SessionCredentialsService
>()("@ryco/client-runtime/platform/SessionCredentials") {}

/**
 * The per-request DPoP proof input the hosted API hands the signer. `token` is
 * present on authenticated requests (the proof carries `ath`) and absent on the
 * login/mint ceremony (the proof carries no `ath`); the branch is driven purely
 * by whether a native session token is bound yet.
 */
export interface DpopProofInput {
  readonly method: string;
  readonly url: string;
  readonly token?: string;
}

/**
 * Platform DPoP signer seam (RFC 9449). Returns a compact-JWS proof for the
 * request. The mobile app supplies a Secure-Enclave/StrongBox-backed
 * implementation (the private key never enters the runtime); web never
 * instantiates it. Build one from a hardware key with `createDpopProofSigner`
 * (`@ryco/client-runtime/relay`) so the proof-construction and asym-alg
 * allow-list live in one shared place rather than being reimplemented.
 */
export interface DpopSignerService {
  readonly sign: (input: DpopProofInput) => Promise<string>;
}

export class DpopSigner extends Context.Service<DpopSigner, DpopSignerService>()(
  "@ryco/client-runtime/platform/DpopSigner",
) {}

/**
 * Reads a pairing credential once and atomically destroys its source before returning it.
 * Implementations must never leave the credential available through history or a deep link.
 */
export interface PairingCredentialSourceService {
  readonly take: () => Promise<string | null>;
}

export class PairingCredentialSource extends Context.Service<
  PairingCredentialSource,
  PairingCredentialSourceService
>()("@ryco/client-runtime/platform/PairingCredentialSource") {}

export type ComposerAttachment =
  | {
      readonly id: string;
      readonly mime: string;
      readonly size: number;
      readonly bytes: Uint8Array;
    }
  | {
      readonly id: string;
      readonly mime: string;
      readonly size: number;
      readonly uri: string;
    };

/** Converts a platform attachment to and from the neutral composer attachment value. */
export interface AttachmentCodecService {
  readonly encode: (attachment: unknown) => Promise<ComposerAttachment>;
  readonly decode: (attachment: ComposerAttachment) => Promise<unknown>;
}

export class AttachmentCodec extends Context.Service<AttachmentCodec, AttachmentCodecService>()(
  "@ryco/client-runtime/platform/AttachmentCodec",
) {}

export interface ClockService {
  readonly now: () => number;
}

export class Clock extends Context.Service<Clock, ClockService>()(
  "@ryco/client-runtime/platform/Clock",
) {}

export interface FrameSchedulerService {
  readonly scheduleFrame: (callback: () => void) => void;
}

export class FrameScheduler extends Context.Service<FrameScheduler, FrameSchedulerService>()(
  "@ryco/client-runtime/platform/FrameScheduler",
) {}

export interface ObservabilityService {
  readonly tracingLayer: Layer.Layer<never, never, never>;
  /**
   * Cheap gate consulted before building performance payloads so inert
   * observability adds no work to hot paths.
   */
  readonly performanceEnabled: () => boolean;
  readonly recordPerformance: (
    label: string,
    value?: unknown,
    record?: { readonly count?: number; readonly durationMs?: number },
  ) => void;
}

const noopTracer = Tracer.make({
  span(options) {
    return new Tracer.NativeSpan(options);
  },
});

/** The default emits no telemetry and records no performance payloads. */
export const NOOP_OBSERVABILITY: ObservabilityService = {
  tracingLayer: Layer.succeed(Tracer.Tracer, noopTracer),
  performanceEnabled: () => false,
  recordPerformance: () => undefined,
};

export const Observability = Context.Reference<ObservabilityService>(
  "@ryco/client-runtime/platform/Observability",
  { defaultValue: () => NOOP_OBSERVABILITY },
);

export type ClientMode = "hosted-hub" | "standard";

/** Bootstrap configuration replacing ambient import.meta.env reads. */
export interface ClientRuntimeConfigService {
  readonly clientMode: ClientMode;
  readonly httpBaseUrl?: string;
  readonly wsBaseUrl?: string;
  readonly hostedAppUrl?: string;
  readonly devServerUrl?: string;
  readonly perfProfile?: string;
}

export class ClientRuntimeConfig extends Context.Service<
  ClientRuntimeConfig,
  ClientRuntimeConfigService
>()("@ryco/client-runtime/platform/ClientRuntimeConfig") {}
