import type { ReactNode } from "react";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppAtomRegistryProvider } from "../rpc/registry";

// The app root provider stack, copied from the upstream shell and stripped of
// the hosted-auth/cloud providers: RegistryContext (atom reactivity) wraps the
// gesture/safe-area/keyboard providers the screens rely on.
export function AppProviders({ children }: { readonly children: ReactNode }) {
  return (
    <GestureHandlerRootView style={styles.root}>
      <AppAtomRegistryProvider>
        <SafeAreaProvider>
          <KeyboardProvider>{children}</KeyboardProvider>
        </SafeAreaProvider>
      </AppAtomRegistryProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
