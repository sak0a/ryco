import type { EnvironmentId } from "@ryco/contracts";

import type { InboxEnvironment } from "../inbox/inboxModel";

export interface DirectHomeEnvironmentInput {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connectionState: "connecting" | "connected" | "disconnected" | "error";
  readonly role: "client" | "owner" | null;
  readonly threadSettlementSupported: boolean;
  readonly shellCurrent: boolean;
  readonly apiAvailable: boolean;
}

export interface HostedHomeEnvironmentInput {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly transportStatus:
    | "idle"
    | "requesting-ticket"
    | "connecting"
    | "authenticating"
    | "opening-channel"
    | "online"
    | "reconnecting"
    | "draining"
    | "terminal-failure";
  readonly sessionStatus:
    | "synchronizing"
    | "ready"
    | "stale"
    | "replaying"
    | "delivery-unknown"
    | "closed";
  readonly role: "viewer" | "operator" | "owner" | null;
  readonly threadSettlementSupported: boolean;
  readonly shellCurrent: boolean;
  readonly apiAvailable: boolean;
}

function directState(input: DirectHomeEnvironmentInput): InboxEnvironment["connectionState"] {
  if (input.connectionState === "connected") return "connected";
  if (input.connectionState === "connecting") return "reconnecting";
  return "offline";
}

export function hostedState(
  input: Pick<HostedHomeEnvironmentInput, "transportStatus" | "sessionStatus" | "role">,
): InboxEnvironment["connectionState"] {
  if (input.transportStatus === "online" && input.sessionStatus === "ready") {
    return input.role === "viewer" ? "read-only" : "connected";
  }
  if (
    input.transportStatus === "requesting-ticket" ||
    input.transportStatus === "connecting" ||
    input.transportStatus === "authenticating" ||
    input.transportStatus === "opening-channel" ||
    input.transportStatus === "reconnecting" ||
    input.sessionStatus === "synchronizing" ||
    input.sessionStatus === "replaying"
  ) {
    return "reconnecting";
  }
  return "offline";
}

export function buildHomeEnvironments(input: {
  readonly direct: ReadonlyArray<DirectHomeEnvironmentInput>;
  readonly hosted: HostedHomeEnvironmentInput | null;
}): ReadonlyArray<InboxEnvironment> {
  const environments = new Map<EnvironmentId, InboxEnvironment>();
  for (const direct of input.direct) {
    environments.set(direct.environmentId, {
      environmentId: direct.environmentId,
      label: direct.label,
      connectionState: directState(direct),
      threadSettlementSupported: direct.threadSettlementSupported,
      mutationReady: direct.connectionState === "connected" && direct.apiAvailable,
      shellCurrent: direct.shellCurrent,
    });
  }
  if (input.hosted) {
    environments.set(input.hosted.environmentId, {
      environmentId: input.hosted.environmentId,
      label: input.hosted.label,
      connectionState: hostedState(input.hosted),
      threadSettlementSupported: input.hosted.threadSettlementSupported,
      mutationReady:
        hostedState(input.hosted) === "connected" &&
        input.hosted.role !== "viewer" &&
        input.hosted.apiAvailable,
      shellCurrent: input.hosted.shellCurrent,
    });
  }
  return [...environments.values()];
}
