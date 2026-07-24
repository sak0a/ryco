import { useNavigation } from "@react-navigation/native";
import { ScrollView } from "react-native";

import { useHostedModeAvailable } from "../hostedHub/useHostedMode";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection } from "./components/SettingsSection";

// Settings hub. The Hub account row renders only when hosted mode is actually
// available — a build with no Hub, or a device with no hardware-backed key, has
// no hosted plane to configure, and an inert row would imply a broken feature.
export function SettingsRouteScreen() {
  const navigation = useNavigation();
  const hostedModeAvailable = useHostedModeAvailable();
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
      {hostedModeAvailable ? (
        <SettingsSection title="Hub">
          <SettingsRow
            first
            label="Account"
            onPress={() => navigation.navigate("SettingsAccount" as never)}
          />
        </SettingsSection>
      ) : null}
      <SettingsSection title="Preferences">
        <SettingsRow
          first
          label="Appearance"
          onPress={() => navigation.navigate("SettingsAppearance" as never)}
        />
        <SettingsRow
          label="Client storage"
          onPress={() => navigation.navigate("SettingsClientStorage" as never)}
        />
      </SettingsSection>
    </ScrollView>
  );
}
