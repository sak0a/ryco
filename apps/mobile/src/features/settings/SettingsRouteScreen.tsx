import { useNavigation } from "@react-navigation/native";
import { ScrollView } from "react-native";

import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection } from "./components/SettingsSection";

// Settings hub, stripped of the hosted-auth / cloud account + push surfaces (the hosted
// account rows render only when hosted mode is enabled — inert until workstream C).
export function SettingsRouteScreen() {
  const navigation = useNavigation();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      className="flex-1 bg-screen"
      contentContainerStyle={{ paddingVertical: 12 }}
    >
      <SettingsSection title="Workspace">
        <SettingsRow
          first
          label="Environments"
          onPress={() => navigation.navigate("SettingsEnvironments" as never)}
        />
      </SettingsSection>
      <SettingsSection title="Preferences">
        <SettingsRow first label="Appearance" onPress={() => navigation.navigate("SettingsAppearance" as never)} />
        <SettingsRow label="Client storage" onPress={() => navigation.navigate("SettingsClientStorage" as never)} />
      </SettingsSection>
    </ScrollView>
  );
}
