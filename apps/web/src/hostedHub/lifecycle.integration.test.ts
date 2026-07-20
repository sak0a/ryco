import {
  EnvironmentId,
  ORCHESTRATION_WS_METHODS,
  type OrchestrationShellSnapshot,
} from "@ryco/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { HostedHubNode, HostedHubSessionResponse } from "./types";

interface CapturedTransport {
  readonly resolveUrl: () => Promise<string>;
  readonly options: {
    readonly authorizeRequest?: (request: {
      readonly tag: string;
      readonly stream: boolean;
    }) => boolean;
    readonly onOpen?: () => void;
  };
}

interface CapturedClient {
  readonly reconnect: ReturnType<typeof vi.fn>;
  readonly dispose: ReturnType<typeof vi.fn>;
  emitShellSnapshot(snapshot: OrchestrationShellSnapshot): void;
}

const { capturedTransports, capturedClients, createWsRpcClient } = vi.hoisted(() => ({
  capturedTransports: [] as CapturedTransport[],
  capturedClients: [] as CapturedClient[],
  createWsRpcClient: vi.fn(),
}));

function MockWsTransport(resolveUrl: () => Promise<string>, options: CapturedTransport["options"]) {
  capturedTransports.push({ resolveUrl, options });
}

vi.mock("../rpc/wsTransport", () => ({ WsTransport: MockWsTransport }));

vi.mock("../rpc/wsRpcClient", () => ({ createWsRpcClient }));

const environmentId = EnvironmentId.make("env_aaaaaaaaaaaaaaaaaaaaaa");
const selectedNode: HostedHubNode = {
  id: "node_aaaaaaaaaaaaaaaaaaaaaa",
  environmentId,
  label: "Test node",
  platformOs: "linux",
  platformArch: "x64",
  clientVersion: "0.9.0",
  createdAt: 1,
  updatedAt: 1,
  lastAuthenticatedAt: 1,
  revokedAt: null,
  revocationReasonCode: null,
  grant: { id: "grant_aaaaaaaaaaaaaaaaaaaaaa", role: "operator" },
  effectiveRole: "operator",
  presence: { online: true, lastHeartbeatAt: 1 },
};
const sessionResponse: HostedHubSessionResponse = {
  account: {
    id: "acct_aaaaaaaaaaaaaaaaaaaaaa",
    displayName: "Test account",
    role: "owner",
    createdAt: 1,
    disabledAt: null,
  },
  session: {
    id: "sess_aaaaaaaaaaaaaaaaaaaaaa",
    accountId: "acct_aaaaaaaaaaaaaaaaaaaaaa",
    createdAt: 1,
    expiresAt: 2,
    lastSeenAt: 1,
    revokedAt: null,
    revocationReasonCode: null,
  },
  csrfToken: "test-csrf",
};

function shellSnapshot(sequence: number): OrchestrationShellSnapshot {
  return {
    snapshotSequence: sequence,
    projects: [],
    threads: [],
    updatedAt: "2026-07-20T00:00:00.000Z",
  };
}

function makeClient(): CapturedClient & Record<string, unknown> {
  let shellListener:
    | ((item: { kind: "snapshot"; snapshot: OrchestrationShellSnapshot }) => void)
    | null = null;
  const client: CapturedClient & Record<string, unknown> = {
    reconnect: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
    isHeartbeatFresh: vi.fn(() => false),
    server: {
      subscribeLifecycle: vi.fn(() => () => undefined),
      subscribeConfig: vi.fn(() => () => undefined),
    },
    orchestration: {
      subscribeShell: vi.fn((listener: typeof shellListener) => {
        shellListener = listener;
        return () => {
          shellListener = null;
        };
      }),
    },
    terminal: { onEvent: vi.fn(() => () => undefined) },
    emitShellSnapshot(snapshot) {
      shellListener?.({ kind: "snapshot", snapshot });
    },
  };
  return client;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_RYCO_CLIENT_MODE", "hosted-hub");
  vi.stubGlobal("window", {
    location: { href: "https://hub.example.test/", origin: "https://hub.example.test" },
  });
  capturedTransports.length = 0;
  capturedClients.length = 0;
  createWsRpcClient.mockReset();
  createWsRpcClient.mockImplementation(() => {
    const client = makeClient();
    capturedClients.push(client);
    return client;
  });
});

afterEach(async () => {
  const { resetEnvironmentServiceForTests } = await import("../environments/runtime/service");
  const { resetPrimaryEnvironmentDescriptorForTests } = await import("../environments/primary");
  const { deactivateHostedNode } = await import("./environment");
  const { hostedHubController } = await import("./state");
  await deactivateHostedNode(environmentId);
  await resetEnvironmentServiceForTests();
  resetPrimaryEnvironmentDescriptorForTests();
  hostedHubController.resetForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("hosted browser lifecycle integration", () => {
  it("disposes the stale transport before same-node recovery and accepts only a fresh snapshot", async () => {
    const { hostedHubApi } = await import("./api");
    const { activateHostedNode } = await import("./environment");
    const { listEnvironmentConnections } = await import("../environments/runtime/service");
    const { hostedHubController, useHostedHubStore } = await import("./state");
    const issueRelayTicket = vi.spyOn(hostedHubApi, "issueRelayTicket").mockResolvedValue({
      ticket: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
      expiresAt: Date.now() + 60_000,
      protocolMajor: 1,
      protocolMinor: 2,
    });
    vi.spyOn(hostedHubApi, "restoreSession").mockResolvedValue(sessionResponse);
    vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([selectedNode]);
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      account: sessionResponse.account,
      session: sessionResponse.session,
      directoryStatus: "ready",
      nodes: [selectedNode],
      selectedNode,
      selectionStatus: "online",
      effectiveRole: "operator",
      transportStatus: "online",
      sessionStatus: "synchronizing",
      sessionEstablished: false,
      browserStatus: "current",
      generation: 4,
    });

    await activateHostedNode(selectedNode, null);
    expect(capturedClients).toHaveLength(1);
    expect(capturedTransports).toHaveLength(1);
    expect(listEnvironmentConnections()).toHaveLength(1);
    await capturedTransports[0]!.resolveUrl();
    capturedTransports[0]!.options.onOpen?.();
    hostedHubController.transportStatus(4, "online");
    capturedClients[0]!.emitShellSnapshot(shellSnapshot(1));
    expect(useHostedHubStore.getState()).toMatchObject({
      browserStatus: "current",
      sessionStatus: "ready",
      sessionEstablished: true,
    });
    expect(
      capturedTransports[0]!.options.authorizeRequest?.({
        tag: ORCHESTRATION_WS_METHODS.dispatchCommand,
        stream: false,
      }),
    ).toBe(true);

    hostedHubController.suspendBrowser("offline");
    expect(
      capturedTransports[0]!.options.authorizeRequest?.({
        tag: ORCHESTRATION_WS_METHODS.dispatchCommand,
        stream: false,
      }),
    ).toBe(false);
    await vi.waitFor(() => expect(capturedClients[0]!.dispose).toHaveBeenCalledOnce());

    await hostedHubController.resumeBrowser();
    expect(capturedClients).toHaveLength(2);
    expect(capturedTransports).toHaveLength(2);
    expect(listEnvironmentConnections()).toHaveLength(1);
    await capturedTransports[1]!.resolveUrl();
    capturedTransports[1]!.options.onOpen?.();
    hostedHubController.transportStatus(6, "online");
    expect(useHostedHubStore.getState()).toMatchObject({
      browserStatus: "synchronizing",
      sessionEstablished: false,
    });
    expect(
      capturedTransports[1]!.options.authorizeRequest?.({
        tag: ORCHESTRATION_WS_METHODS.dispatchCommand,
        stream: false,
      }),
    ).toBe(false);

    capturedClients[0]!.emitShellSnapshot(shellSnapshot(2));
    expect(useHostedHubStore.getState().sessionEstablished).toBe(false);

    capturedClients[1]!.emitShellSnapshot(shellSnapshot(2));
    expect(useHostedHubStore.getState()).toMatchObject({
      browserStatus: "current",
      sessionStatus: "ready",
      sessionEstablished: true,
    });
    expect(
      capturedTransports[1]!.options.authorizeRequest?.({
        tag: ORCHESTRATION_WS_METHODS.dispatchCommand,
        stream: false,
      }),
    ).toBe(true);
    expect(issueRelayTicket).toHaveBeenCalledTimes(2);
  });
});
