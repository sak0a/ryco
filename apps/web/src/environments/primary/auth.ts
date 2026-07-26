import {
  BootstrapHttpError,
  createPrimaryAuth,
  type ServerAuthGateState,
  type ServerClientSessionRecord,
  type ServerPairingLinkRecord,
} from "@ryco/client-runtime/connection";

import { webEndpoint } from "../../platform/endpoint";
import { webHttpClient } from "../../platform/httpClient";
import { webPairingCredentialSource } from "../../platform/pairingCredentialSource";
import { webSessionCredentials } from "../../platform/sessionCredentials";
import { stripPairingTokenFromUrl } from "./pairingCredential";

export {
  peekPairingTokenFromUrl,
  stripPairingTokenFromUrl,
  takePairingTokenFromUrl,
} from "./pairingCredential";

export {
  BootstrapHttpError,
  type ServerAuthGateState,
  type ServerClientSessionRecord,
  type ServerPairingLinkRecord,
};

const auth = createPrimaryAuth({
  endpoint: webEndpoint,
  httpClient: webHttpClient,
  pairingCredentialSource: webPairingCredentialSource,
  readBootstrapCredential: () => {
    const bootstrap = window.desktopBridge?.getLocalEnvironmentBootstrap();
    return typeof bootstrap?.bootstrapToken === "string" && bootstrap.bootstrapToken.length > 0
      ? bootstrap.bootstrapToken
      : null;
  },
  sessionCredentials: webSessionCredentials,
});

export const fetchSessionState = auth.fetchSessionState;
export const issuePrimaryWebSocketToken = auth.issuePrimaryWebSocketToken;
export const retryTransientBootstrap = auth.retryTransientBootstrap;
export const createServerPairingCredential = auth.createServerPairingCredential;
export const listServerPairingLinks = auth.listServerPairingLinks;
export const revokeServerPairingLink = auth.revokeServerPairingLink;
export const listServerClientSessions = auth.listServerClientSessions;
export const revokeServerClientSession = auth.revokeServerClientSession;
export const revokeOtherServerClientSessions = auth.revokeOtherServerClientSessions;
export const fetchHubStatus = auth.fetchHubStatus;
export const fetchHubIdentity = auth.fetchHubIdentity;
export const fetchHubEnrollment = auth.fetchHubEnrollment;
export const startHubEnrollment = auth.startHubEnrollment;
export const cancelHubEnrollment = auth.cancelHubEnrollment;
export const resumeHubConnector = auth.resumeHubConnector;
export const leaveHub = auth.leaveHub;
export const resolveInitialServerAuthGateState = auth.resolveInitialServerAuthGateState;
export const __resetServerAuthBootstrapForTests = auth.resetForTests;

export async function submitServerAuthCredential(credential: string): Promise<void> {
  await auth.submitServerAuthCredential(credential);
  stripPairingTokenFromUrl();
}
