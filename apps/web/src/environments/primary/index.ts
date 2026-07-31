export {
  getPrimaryKnownEnvironment,
  readPrimaryEnvironmentDescriptor,
  resetPrimaryEnvironmentDescriptorForTests,
  resolveInitialPrimaryEnvironmentDescriptor,
  usePrimaryEnvironmentDescriptor,
  usePrimaryEnvironmentId,
  writePrimaryEnvironmentDescriptor,
  __resetPrimaryEnvironmentBootstrapForTests,
  __resetPrimaryEnvironmentDescriptorBootstrapForTests,
} from "./context";

export {
  resolveInitialPrimaryEnvironmentDescriptor as ensurePrimaryEnvironmentReady,
  writePrimaryEnvironmentDescriptor as updatePrimaryEnvironmentDescriptor,
} from "./context";

export {
  cancelHubEnrollment,
  createServerPairingCredential,
  fetchHubEnrollment,
  fetchHubIdentity,
  fetchHubStatus,
  fetchSessionState,
  leaveHub,
  resumeHubConnector,
  startHubEnrollment,
  issuePrimaryWebSocketToken,
  listServerClientSessions,
  listServerPairingLinks,
  peekPairingTokenFromUrl,
  resolveInitialServerAuthGateState,
  revokeOtherServerClientSessions,
  revokeServerClientSession,
  revokeServerPairingLink,
  stripPairingTokenFromUrl,
  submitServerAuthCredential,
  takePairingTokenFromUrl,
  type ServerClientSessionRecord,
  type ServerPairingLinkRecord,
  __resetServerAuthBootstrapForTests,
} from "./auth";

export { resolvePrimaryEnvironmentHttpUrl, isLoopbackHostname } from "./target";
