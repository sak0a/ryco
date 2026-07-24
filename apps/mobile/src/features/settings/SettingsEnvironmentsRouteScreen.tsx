import { View } from "react-native";

import { EmptyState } from "../../components/EmptyState";

// B2 placeholder — replaced by the real screen in a later task. Keeps the
// navigation tree compiling and navigable in the interim.
export function SettingsEnvironmentsRouteScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-screen px-6">
      <EmptyState variant="plain" title="Environments" detail="Environment settings arrive in the next build." />
    </View>
  );
}
