import { useNavigation } from "@react-navigation/native";
import { ScrollView } from "react-native";

import { getMobileHostedConfig } from "../../hostedHub/runtimeConfig";
import { useHostedModeAvailable } from "../hostedHub/useHostedMode";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection } from "./components/SettingsSection";

export function SettingsHubRouteScreen() {
  const navigation = useNavigation();
  const hostedAvailable = useHostedModeAvailable();
  const hostedConfig = getMobileHostedConfig();
  const rootNavigation = navigation.getParent();

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      className="flex-1 bg-screen"
      contentContainerStyle={{ paddingTop: 4, paddingBottom: 40 }}
    >
      <SettingsSection title="Hub">
        <SettingsRow first label="Domain" value={hostedConfig?.hubOrigin ?? "Not configured"} />
        <SettingsRow
          label="Nodes"
          value="Hub and direct"
          onPress={() => rootNavigation?.navigate("Connections" as never)}
        />
      </SettingsSection>

      <SettingsSection title="Account and security">
        <SettingsRow
          first
          label="Account"
          value={hostedAvailable ? undefined : "Unavailable"}
          disabled={!hostedAvailable}
          onPress={() => navigation.navigate("SettingsAccount" as never)}
        />
      </SettingsSection>
    </ScrollView>
  );
}
