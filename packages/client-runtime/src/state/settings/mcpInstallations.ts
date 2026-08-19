import type {
  AgentControlMcpInstallation,
  AgentControlMcpInstallationListResult,
  AgentControlMcpInstallationMutationResult,
} from "@ryco/contracts";

export interface McpInstallationSettingsState {
  readonly installations: ReadonlyArray<AgentControlMcpInstallation>;
}

export const emptyMcpInstallationSettingsState = (): McpInstallationSettingsState => ({
  installations: [],
});

const sortInstallations = (
  installations: ReadonlyArray<AgentControlMcpInstallation>,
): ReadonlyArray<AgentControlMcpInstallation> =>
  [...installations].toSorted(
    (left, right) =>
      left.driver.localeCompare(right.driver) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.installationId.localeCompare(right.installationId),
  );

export const applyMcpInstallationList = (
  _state: McpInstallationSettingsState,
  result: AgentControlMcpInstallationListResult,
): McpInstallationSettingsState => ({
  installations: sortInstallations(result.installations),
});

export const applyMcpInstallationMutation = (
  state: McpInstallationSettingsState,
  result: AgentControlMcpInstallationMutationResult,
): McpInstallationSettingsState => {
  const existing = state.installations.find(
    (entry) => entry.installationId === result.installation.installationId,
  );
  if (existing && existing.revision > result.installation.revision) return state;
  return {
    installations: sortInstallations([
      ...state.installations.filter(
        (entry) => entry.installationId !== result.installation.installationId,
      ),
      result.installation,
    ]),
  };
};
