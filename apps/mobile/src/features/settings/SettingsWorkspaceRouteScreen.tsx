import { useNavigation } from "@react-navigation/native";
import { ScrollView } from "react-native";

import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection } from "./components/SettingsSection";

export function SettingsWorkspaceRouteScreen() {
  const navigation = useNavigation();
  const rootNavigation = navigation.getParent();

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      className="flex-1 bg-screen"
      contentContainerStyle={{ paddingTop: 4, paddingBottom: 40 }}
    >
      <SettingsSection title="Context">
        <SettingsRow
          first
          label="Preferred node"
          value="Last ready"
          onPress={() => rootNavigation?.navigate("Connections" as never)}
        />
        <SettingsRow label="Project and worktree" value="Current context" />
      </SettingsSection>

      <SettingsSection title="New tasks">
        <SettingsRow first label="Provider and model" value="Project default" />
        <SettingsRow label="Runtime mode" value="Thread default" />
      </SettingsSection>
    </ScrollView>
  );
}
