import { ScrollView } from "react-native";

import { usePreferences } from "../../state/preferencesStore";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection } from "./components/SettingsSection";

// Device-local client settings (mobileKV). Server-owned settings live under the
// active environment; these are the client-only preferences (§3-2, R6).
export function SettingsClientStorageRouteScreen() {
  const preferences = usePreferences();
  const groupingLabel = preferences.projectGroupingEnabled === false ? "By project" : "By repository";

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      className="flex-1 bg-screen"
      contentContainerStyle={{ paddingVertical: 12 }}
    >
      <SettingsSection title="Stored on this device">
        <SettingsRow first label="Project grouping" value={groupingLabel} />
        <SettingsRow label="Base font size" value={preferences.baseFontSize ? `${preferences.baseFontSize}pt` : "Default"} />
      </SettingsSection>
    </ScrollView>
  );
}
