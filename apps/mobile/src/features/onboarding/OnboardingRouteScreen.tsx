import { View } from "react-native";

import { EmptyState } from "../../components/EmptyState";

// B2 placeholder — replaced by the real screen in a later task. Keeps the
// navigation tree compiling and navigable in the interim.
export function OnboardingRouteScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-screen px-6">
      <EmptyState
        variant="plain"
        title="Connect"
        detail="The onboarding surface arrives in the next build."
      />
    </View>
  );
}
