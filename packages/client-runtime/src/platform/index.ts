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
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly credentials?: "include";
}

export interface HttpClientService {
  readonly fetch: (url: string, init?: HttpRequestInit) => Promise<HttpResponse>;
}

export class HttpClient extends Context.Service<HttpClient, HttpClientService>()(
  "@ryco/client-runtime/platform/HttpClient",
) {}

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

/** Cookie or bearer session policy plus the in-memory CSRF token holder. */
export interface SessionCredentialsService {
  readonly mode: "bearer" | "cookie";
  readonly readCsrfToken: () => string | null;
  readonly writeCsrfToken: (token: string | null) => void;
}

export class SessionCredentials extends Context.Service<
  SessionCredentials,
  SessionCredentialsService
>()("@ryco/client-runtime/platform/SessionCredentials") {}

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
  readonly recordPerformance: (label: string, value?: unknown) => void;
}

const noopTracer = Tracer.make({
  span(options) {
    return new Tracer.NativeSpan(options);
  },
});

/** The default emits no telemetry and records no performance payloads. */
export const NOOP_OBSERVABILITY: ObservabilityService = {
  tracingLayer: Layer.succeed(Tracer.Tracer, noopTracer),
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
