import { ScrollView, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { LoadingScreen } from "../../components/LoadingScreen";
import { stepBaseFontSize, stepCodeFontSize } from "../../lib/appearancePreferences";
import { useAppearancePreferences } from "./appearance/AppearancePreferencesProvider";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { Pressable } from "react-native";

function Stepper(props: {
  readonly label: string;
  readonly value: number;
  readonly display: string;
  readonly onStep: (direction: -1 | 1) => void;
  readonly first?: boolean;
}) {
  return (
    <View
      className={`flex-row items-center gap-3 px-4 py-3 ${props.first ? "" : "border-t border-border"}`}
    >
      <Text className="flex-1 font-sans text-base text-foreground">{props.label}</Text>
      <Pressable
        onPress={() => props.onStep(-1)}
        className="h-8 w-8 items-center justify-center rounded-full border border-border active:opacity-70"
      >
        <Text className="text-lg font-ryco-bold text-foreground">−</Text>
      </Pressable>
      <Text className="w-12 text-center font-mono text-sm text-foreground-muted">
        {props.display}
      </Text>
      <Pressable
        onPress={() => props.onStep(1)}
        className="h-8 w-8 items-center justify-center rounded-full border border-border active:opacity-70"
      >
        <Text className="text-lg font-ryco-bold text-foreground">+</Text>
      </Pressable>
    </View>
  );
}

export function SettingsAppearanceRouteScreen() {
  const { appearance, isReady, setBaseFontSize, setCodeFontSize, setCodeWordBreak } =
    useAppearancePreferences();

  if (!isReady) return <LoadingScreen message="Loading appearance…" />;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      className="flex-1 bg-screen"
      contentContainerStyle={{ paddingVertical: 12 }}
    >
      <SettingsSection title="Text">
        <Stepper
          first
          label="Base font size"
          value={appearance.baseFontSize}
          display={`${appearance.baseFontSize}pt`}
          onStep={(direction) =>
            setBaseFontSize(stepBaseFontSize(appearance.baseFontSize, direction))
          }
        />
      </SettingsSection>
      <SettingsSection title="Code">
        <Stepper
          first
          label="Code font size"
          value={appearance.codeFontSize}
          display={`${appearance.codeFontSize}pt`}
          onStep={(direction) =>
            setCodeFontSize(stepCodeFontSize(appearance.codeFontSize, direction))
          }
        />
        <SettingsSwitchRow
          label="Wrap long code lines"
          value={appearance.codeWordBreak}
          onValueChange={setCodeWordBreak}
        />
      </SettingsSection>
    </ScrollView>
  );
}
