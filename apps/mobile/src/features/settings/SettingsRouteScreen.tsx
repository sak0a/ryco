import { useNavigation } from "@react-navigation/native";
import { useLayoutEffect } from "react";
import { Pressable, ScrollView } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { useThemeColor } from "../../lib/useThemeColor";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection } from "./components/SettingsSection";

export function SettingsRouteScreen() {
  const navigation = useNavigation();
  const iconColor = useThemeColor("--color-icon");

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="h-11 w-11 items-center justify-center rounded-full active:bg-subtle-strong"
          onPress={() => navigation.getParent()?.goBack()}
        >
          <SymbolView
            name="chevron.left"
            size={19}
            tintColor={iconColor as string}
            type="monochrome"
          />
        </Pressable>
      ),
    });
  }, [iconColor, navigation]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      className="flex-1 bg-screen"
      contentContainerStyle={{ paddingTop: 4, paddingBottom: 40 }}
    >
      <SettingsSection title="Hub">
        <SettingsRow
          first
          label="Hub and account"
          onPress={() => navigation.navigate("SettingsHub" as never)}
        />
      </SettingsSection>

      <SettingsSection title="Security">
        <SettingsRow
          first
          label="Node security"
          onPress={() => navigation.navigate("SettingsNodeSecurity" as never)}
        />
      </SettingsSection>

      <SettingsSection title="Workspace">
        <SettingsRow
          first
          label="Defaults"
          onPress={() => navigation.navigate("SettingsWorkspace" as never)}
        />
      </SettingsSection>

      <SettingsSection title="Appearance">
        <SettingsRow
          first
          label="Text and code"
          onPress={() => navigation.navigate("SettingsAppearance" as never)}
        />
      </SettingsSection>

      <SettingsSection title="App">
        <SettingsRow
          first
          label="Local storage"
          onPress={() => navigation.navigate("SettingsClientStorage" as never)}
        />
        <SettingsRow
          label="About Ryco"
          onPress={() => navigation.navigate("SettingsAbout" as never)}
        />
      </SettingsSection>
    </ScrollView>
  );
}
