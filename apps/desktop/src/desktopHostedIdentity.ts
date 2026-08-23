import * as Crypto from "node:crypto";

import type {
  DesktopHostedIdentityActionResult,
  DesktopHostedIdentityState,
} from "@ryco/contracts";
import {
  HostedHubApi,
  HostedHubApiError,
  type HostedHubNode,
} from "@ryco/client-runtime/authorization";
import type {
  DpopSignerService,
  HttpClientService,
  NativeAuthorizationService,
  PasskeyCeremonyService,
} from "@ryco/client-runtime/platform";
import { createDpopProofSigner } from "@ryco/client-runtime/relay";
import type { HostedRelayTicket } from "@ryco/client-runtime/authorization";

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

export async function createDesktopDpopSigner(
  security: DesktopLocalIntroductionSecurity,
): Promise<DpopSignerService> {
  const signingKey = await security.getSigningKey();
  return createDpopProofSigner(signingKey, {
    now: Date.now,
    randomJti: () => Crypto.randomUUID(),
    sha256: async (bytes) => Uint8Array.from(Crypto.createHash("sha256").update(bytes).digest()),
  });
}

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
  const dpopSigner = await createDesktopDpopSigner(input.security);
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
      readonly github?: NonNullable<DesktopHostedIdentityState["github"]>;
    }
  | { readonly status: "unavailable" };

export type DesktopHostedIdentitySetup = (input: { readonly accountId: string }) => Promise<{
  readonly nodeId: string;
  readonly localNodeHandle: string;
}>;

export interface DesktopHostedGitHubActionResult {
  readonly outcome: DesktopHostedIdentityActionResult["outcome"];
  readonly github?: NonNullable<DesktopHostedIdentityState["github"]>;
  readonly signedOut: boolean;
}

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
  readonly #relayDpopSigner: DpopSignerService | undefined;
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
    readonly relayDpopSigner?: DpopSignerService;
  }) {
    this.#origin = input.origin;
    this.#installationId = input.installationId;
    this.#api = input.api;
    this.#credentials = input.credentials;
    this.#control = input.control;
    this.#security = input.security;
    this.#records = input.records;
    this.#trust = input.trust ?? new DesktopE2eeTrustStore(input.records);
    this.#relayDpopSigner = input.relayDpopSigner;
    this.#setup =
      input.setup ??
      (async ({ accountId }) => {
        try {
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
        } catch (cause) {
          // Client identity is independent of node-connector uptime. A prior
          // local introduction remains the exact local tie-break when the node
          // plane is intentionally disabled or temporarily unavailable.
          const localPins = (await this.#trust.list(this.#origin, accountId)).filter(
            (pin) => pin.verificationMethod === "local-trusted-introduction-v1",
          );
          if (localPins.length !== 1) throw cause;
          return {
            nodeId: localPins[0]!.nodeId,
            localNodeHandle: localPins[0]!.localNodeHandle,
          };
        }
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

  /** Directory projection for the native Desktop client; credentials stay in main. */
  async listNodes(): Promise<ReadonlyArray<HostedHubNode>> {
    await this.#operation?.catch(() => undefined);
    if (!this.#api.hasSessionMaterial) return [];
    return this.#api.listNodes();
  }

  /** Main-process-only relay attempt material. Never return this through preload. */
  async issueRelayTicket(nodeId: string): Promise<HostedRelayTicket> {
    await this.#operation?.catch(() => undefined);
    if (!this.#api.hasSessionMaterial) throw new Error("Desktop Hub session is unavailable.");
    return this.#api.issueRelayTicket(nodeId);
  }

  /** Main-process-only DPoP upgrade headers for the origin-pinned relay URL. */
  async authorizeRelayUpgrade(url: string): Promise<Readonly<Record<string, string>>> {
    await this.#credentials.hydrate();
    const relayUrl = new URL("/v1/relay/client", this.#origin);
    relayUrl.protocol = relayUrl.protocol === "https:" ? "wss:" : "ws:";
    if (url !== relayUrl.toString()) throw new Error("Desktop relay URL is invalid.");
    const token = this.#credentials.readBearerToken?.() ?? null;
    if (!token || !this.#relayDpopSigner) throw new Error("Desktop Hub session is unavailable.");
    const proof = await this.#relayDpopSigner.sign({ method: "GET", url, token });
    return { Authorization: `DPoP ${token}`, DPoP: proof };
  }

  async connectGitHub(input?: {
    readonly totpCode?: string;
  }): Promise<DesktopHostedGitHubActionResult> {
    await this.#operation?.catch(() => undefined);
    if (!this.#api.hasSessionMaterial) {
      return { outcome: "unavailable", signedOut: true };
    }
    try {
      const identity = await this.#api.connectExternalIdentity("github", input);
      return {
        outcome: "committed",
        github: (await this.#readGitHubState()) ?? { linkAvailable: true, identity },
        signedOut: false,
      };
    } catch (cause) {
      const github = await this.#readGitHubState();
      return {
        outcome: desktopGitHubActionOutcome(cause),
        ...(github === undefined ? {} : { github }),
        signedOut: false,
      };
    }
  }

  async disconnectGitHub(input?: {
    readonly totpCode?: string;
  }): Promise<DesktopHostedGitHubActionResult> {
    await this.#operation?.catch(() => undefined);
    if (!this.#api.hasSessionMaterial) {
      return { outcome: "unavailable", signedOut: true };
    }
    try {
      const result = await this.#api.disconnectExternalIdentity("github", input);
      if (result.signedOut) {
        await this.#credentials.clear();
        return { outcome: "committed", signedOut: true };
      }
      return {
        outcome: "committed",
        github: (await this.#readGitHubState()) ?? { linkAvailable: true, identity: null },
        signedOut: false,
      };
    } catch (cause) {
      const github = await this.#readGitHubState();
      return {
        outcome: desktopGitHubActionOutcome(cause),
        ...(github === undefined ? {} : { github }),
        signedOut: false,
      };
    }
  }

  cancelGitHubConnection(): void {
    this.#api.cancelExternalIdentityConnection("github");
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
      const github = await this.#readGitHubState();
      return {
        status: "ready",
        accountId: session.account.id,
        nodeId: setup.nodeId,
        localNodeHandle: setup.localNodeHandle,
        ...(github === undefined ? {} : { github }),
      };
    } catch {
      return { status: "unavailable" };
    }
  }

  async #readGitHubState(): Promise<NonNullable<DesktopHostedIdentityState["github"]> | undefined> {
    try {
      const [configuration, security] = await Promise.all([
        this.#api.getExternalIdentityConfiguration(),
        this.#api.getAccountSecurity(),
      ]);
      const policy =
        configuration.providers.find((provider) => provider.provider === "github") ?? null;
      const identity =
        security.externalIdentities.find((entry) => entry.provider === "github") ?? null;
      if (policy === null && identity === null) return undefined;
      return { linkAvailable: policy?.link === true, identity };
    } catch {
      return undefined;
    }
  }
}

function desktopGitHubActionOutcome(cause: unknown): DesktopHostedIdentityActionResult["outcome"] {
  if (cause instanceof HostedHubApiError) {
    if (cause.code === "step_up_required") return "step-up-required";
    if (cause.code === "last_primary_credential") return "last-primary-credential";
    if (cause.code === "external_authorization_cancelled") return "cancelled";
  }
  if (cause instanceof Error && cause.name === "AbortError") return "cancelled";
  return "unavailable";
}
