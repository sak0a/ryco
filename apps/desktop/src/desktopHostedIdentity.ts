import * as Crypto from "node:crypto";

import { HostedHubApi, HostedHubApiError } from "@ryco/client-runtime/authorization";
import type {
  HttpClientService,
  NativeAuthorizationService,
  PasskeyCeremonyService,
} from "@ryco/client-runtime/platform";
import { createDpopProofSigner } from "@ryco/client-runtime/relay";

import { runDesktopAutomaticNodeClaim } from "./automaticNodeClaim.ts";
import type { DesktopHubControlClient } from "./desktopHubControl.ts";
import { DesktopE2eeTrustStore } from "./desktopE2eeTrust.ts";
import type { DesktopHostedSessionCredentials } from "./hostedCredentials.ts";
import {
  runDesktopLocalTrustedIntroduction,
  type DesktopLocalIntroductionSecurity,
} from "./localTrustedIntroduction.ts";
import type { DesktopProtectedRecordStore } from "./protectedRecordStore.ts";

const unavailablePasskeys: PasskeyCeremonyService = {
  authenticate: async () => {
    throw new Error("Browser passkeys are unavailable in Desktop main.");
  },
  register: async () => {
    throw new Error("Browser passkeys are unavailable in Desktop main.");
  },
};

export async function createDesktopHostedHubApi(input: {
  readonly origin: string;
  readonly credentials: DesktopHostedSessionCredentials;
  readonly security: DesktopLocalIntroductionSecurity;
  readonly nativeAuthorization: NativeAuthorizationService;
  readonly fetch?: typeof globalThis.fetch;
}): Promise<HostedHubApi> {
  const fetch = input.fetch ?? globalThis.fetch;
  const httpClient: HttpClientService = {
    fetch: (url, init) =>
      fetch(url, init === undefined ? undefined : (init as RequestInit)) as Promise<Response>,
  };
  const signingKey = await input.security.getSigningKey();
  const dpopSigner = createDpopProofSigner(signingKey, {
    now: Date.now,
    randomJti: () => Crypto.randomUUID(),
    sha256: async (bytes) => Uint8Array.from(Crypto.createHash("sha256").update(bytes).digest()),
  });
  return new HostedHubApi({
    endpoint: {
      origin: () => input.origin,
      readPrimaryTarget: () => null,
      resolveHttpUrl: (pathname, searchParams) => {
        const url = new URL(pathname, input.origin);
        for (const [key, value] of Object.entries(searchParams ?? {})) {
          url.searchParams.set(key, value);
        }
        return url.toString();
      },
      resolveWsUrl: (url) => url,
    },
    httpClient,
    passkeyCeremony: unavailablePasskeys,
    sessionCredentials: input.credentials,
    dpopSigner,
    nativeAuthorization: input.nativeAuthorization,
  });
}

export type DesktopHostedIdentityStatus =
  | { readonly status: "signed-out" }
  | {
      readonly status: "ready";
      readonly accountId: string;
      readonly nodeId: string;
      readonly localNodeHandle: string;
    }
  | { readonly status: "unavailable" };

export type DesktopHostedIdentitySetup = (input: { readonly accountId: string }) => Promise<{
  readonly nodeId: string;
  readonly localNodeHandle: string;
}>;

export class DesktopHostedIdentityCoordinator {
  readonly #origin: string;
  readonly #installationId: string;
  readonly #api: HostedHubApi;
  readonly #credentials: DesktopHostedSessionCredentials;
  readonly #control: DesktopHubControlClient;
  readonly #security: DesktopLocalIntroductionSecurity;
  readonly #records: DesktopProtectedRecordStore;
  readonly #trust: DesktopE2eeTrustStore;
  readonly #setup: DesktopHostedIdentitySetup;
  #operation: Promise<DesktopHostedIdentityStatus> | undefined;
  #operationInteractive = false;

  constructor(input: {
    readonly origin: string;
    readonly installationId: string;
    readonly api: HostedHubApi;
    readonly credentials: DesktopHostedSessionCredentials;
    readonly control: DesktopHubControlClient;
    readonly security: DesktopLocalIntroductionSecurity;
    readonly records: DesktopProtectedRecordStore;
    readonly trust?: DesktopE2eeTrustStore;
    readonly setup?: DesktopHostedIdentitySetup;
  }) {
    this.#origin = input.origin;
    this.#installationId = input.installationId;
    this.#api = input.api;
    this.#credentials = input.credentials;
    this.#control = input.control;
    this.#security = input.security;
    this.#records = input.records;
    this.#trust = input.trust ?? new DesktopE2eeTrustStore(input.records);
    this.#setup =
      input.setup ??
      (async ({ accountId }) => {
        const claimed = await runDesktopAutomaticNodeClaim({
          api: this.#api,
          control: this.#control,
          installationId: this.#installationId,
          expectedHubOrigin: this.#origin,
          expectedAccountId: accountId,
        });
        const pin = await runDesktopLocalTrustedIntroduction({
          control: this.#control,
          security: this.#security,
          records: this.#records,
          trust: this.#trust,
          installationId: this.#installationId,
          expectedHubOrigin: this.#origin,
          claim: claimed.claim,
          result: claimed.result,
        });
        return {
          nodeId: claimed.result.node.id,
          localNodeHandle: pin.localNodeHandle,
        };
      });
  }

  resume(): Promise<DesktopHostedIdentityStatus> {
    return this.#serialize(false);
  }

  connect(): Promise<DesktopHostedIdentityStatus> {
    return this.#serialize(true);
  }

  async disconnect(): Promise<void> {
    await this.#operation?.catch(() => undefined);
    this.#api.clearSessionMaterial();
    await this.#credentials.clear();
  }

  #serialize(interactive: boolean): Promise<DesktopHostedIdentityStatus> {
    const current = this.#operation;
    if (current !== undefined) {
      if (!interactive || this.#operationInteractive) return current;
      return current.then((status) => (status.status === "ready" ? status : this.#serialize(true)));
    }

    let operation: Promise<DesktopHostedIdentityStatus>;
    operation = this.#run(interactive).finally(() => {
      if (this.#operation === operation) {
        this.#operation = undefined;
        this.#operationInteractive = false;
      }
    });
    this.#operation = operation;
    this.#operationInteractive = interactive;
    return operation;
  }

  async #run(interactive: boolean): Promise<DesktopHostedIdentityStatus> {
    await this.#credentials.hydrate();
    let session;
    if (!this.#api.hasSessionMaterial) {
      if (!interactive) return { status: "signed-out" };
      try {
        session = await this.#api.signIn();
        await this.#credentials.flush();
      } catch {
        return { status: "unavailable" };
      }
    } else {
      try {
        session = await this.#api.restoreSession();
      } catch (cause) {
        if (cause instanceof HostedHubApiError && cause.code === "session_invalid") {
          await this.#credentials.clear().catch(() => undefined);
          if (!interactive) return { status: "signed-out" };
          try {
            session = await this.#api.signIn();
            await this.#credentials.flush();
          } catch {
            return { status: "unavailable" };
          }
        } else {
          return { status: "unavailable" };
        }
      }
    }

    try {
      const setup = await this.#setup({ accountId: session.account.id });
      return {
        status: "ready",
        accountId: session.account.id,
        nodeId: setup.nodeId,
        localNodeHandle: setup.localNodeHandle,
      };
    } catch {
      return { status: "unavailable" };
    }
  }
}
