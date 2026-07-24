import { ActivityIndicator, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useWorkspaceState } from "../../state/useWorkspaceState";
import {
  shouldShowWorkspaceConnectionStatus,
  workspaceConnectionStatusLabel,
} from "./workspace-connection-status";

// Spec §Bundling: "the connection UI must present reconnecting state clearly."
// Driven by the synthesized workspace state (§3-1) + the pure status helpers. iOS
// backgrounding kills the socket, so this row surfaces reconnecting/offline while
// the supervisor re-drives the connection on foreground.
export function WorkspaceConnectionStatus() {
  const workspace = useWorkspaceState();
  if (!shouldShowWorkspaceConnectionStatus(workspace)) return null;

  const label = workspaceConnectionStatusLabel(workspace);
  const isBusy =
    workspace.hasConnectingEnvironment ||
    workspace.hasPendingShellSnapshot ||
    workspace.connectionState === "reconnecting" ||
    workspace.connectionState === "connecting";

  return (
    <View
      accessibilityRole="alert"
      className="mx-4 my-2 flex-row items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3"
    >
      {isBusy ? <ActivityIndicator size="small" /> : null}
      <Text className="flex-1 font-sans text-sm text-foreground-muted">{label}</Text>
    </View>
  );
}
