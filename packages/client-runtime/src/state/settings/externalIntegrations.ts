import type {
  AgentControlExternalIntegrationDetail,
  AgentControlExternalIntegrationListResult,
  AgentControlExternalPairingResult,
  AgentControlExternalTopology,
  AgentControlIntegrationId,
} from "@ryco/contracts";

/** Transport-independent settings state. Its shape has no credential field by design. */
export interface ExternalIntegrationSettingsState {
  readonly integrations: ReadonlyArray<AgentControlExternalIntegrationDetail>;
  readonly topology: AgentControlExternalTopology;
  readonly pairingCodes: Readonly<Record<string, string>>;
}

export const emptyExternalIntegrationSettingsState = (): ExternalIntegrationSettingsState => ({
  integrations: [],
  topology: { available: false, reason: "Not loaded." },
  pairingCodes: {},
});

export const applyExternalIntegrationList = (
  _state: ExternalIntegrationSettingsState,
  result: AgentControlExternalIntegrationListResult,
): ExternalIntegrationSettingsState => ({
  integrations: result.integrations,
  topology: result.topology,
  // Pairing codes are ceremony-only and do not survive a refresh/reconnect.
  pairingCodes: {},
});

export const applyExternalIntegrationPairing = (
  state: ExternalIntegrationSettingsState,
  result: AgentControlExternalPairingResult,
): ExternalIntegrationSettingsState => ({
  ...state,
  integrations: [
    ...state.integrations.filter(
      (detail) => detail.integration.integrationId !== result.detail.integration.integrationId,
    ),
    result.detail,
  ],
  pairingCodes: {
    ...state.pairingCodes,
    [result.detail.integration.integrationId]: result.pairingCode,
  },
});

export const removeExternalIntegration = (
  state: ExternalIntegrationSettingsState,
  integrationId: AgentControlIntegrationId,
): ExternalIntegrationSettingsState => {
  const pairingCodes = { ...state.pairingCodes };
  delete pairingCodes[integrationId];
  return {
    ...state,
    integrations: state.integrations.filter(
      (detail) => detail.integration.integrationId !== integrationId,
    ),
    pairingCodes,
  };
};
