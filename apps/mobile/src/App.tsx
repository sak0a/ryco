import { StyleSheet, Text, View } from "react-native";

// B1 scaffold placeholder. The real provider stack (RegistryContext → SafeArea →
// Keyboard → navigation) and the direct-node pairing surface are wired in the
// runtime-wiring and pairing-loop tasks.
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Ryco</Text>
    </View>
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
