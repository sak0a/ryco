import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AppProviders } from "./providers/AppProviders";
import { initializeMobileRuntime } from "./runtime/bootstrap";

// B1 app root: the provider stack + one-time runtime init. The direct-node
// pairing surface is mounted here by the pairing-loop task.
export default function App() {
  useEffect(() => {
    initializeMobileRuntime();
  }, []);

  return (
    <AppProviders>
      <View style={styles.container}>
        <Text style={styles.title}>Ryco</Text>
      </View>
    </AppProviders>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
  },
});
