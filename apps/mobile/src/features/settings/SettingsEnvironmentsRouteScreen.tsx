import { useNavigation } from "@react-navigation/native";
import { ScrollView } from "react-native";

import { EmptyState } from "../../components/EmptyState";
import { StatusPill } from "../../components/StatusPill";
import { useSavedEnvironments } from "../connection/useConnectionController";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection } from "./components/SettingsSection";

// Local environments only — the cloud environment rows + showcase rows are dropped.
export function SettingsEnvironmentsRouteScreen() {
  const navigation = useNavigation();
  const { rows } = useSavedEnvironments();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      className="flex-1 bg-screen"
      contentContainerStyle={{ paddingVertical: 12 }}
    >
      <SettingsSection>
        <SettingsRow first label="Add environment" onPress={() => navigation.navigate("SettingsEnvironmentNew" as never)} />
      </SettingsSection>
      {rows.length === 0 ? (
        <EmptyState variant="plain" title="No environments" detail="Pair a Ryco node to connect." />
      ) : (
        <SettingsSection title="Paired">
          {rows.map((row, index) => (
            <SettingsRow key={row.record.environmentId} first={index === 0} label={row.record.label} value={row.statusLabel} />
          ))}
        </SettingsSection>
      )}
    </ScrollView>
  );
}
