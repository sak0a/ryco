import { Switch, View } from "react-native";

import { AppText as Text } from "../../../components/AppText";

export function SettingsSwitchRow(props: {
  readonly label: string;
  readonly value: boolean;
  readonly onValueChange: (value: boolean) => void;
  readonly first?: boolean;
}) {
  return (
    <View
      className={`flex-row items-center gap-3 px-5 py-3 ${props.first ? "" : "border-t border-border-subtle"}`}
    >
      <Text className="flex-1 font-sans text-[17px] text-foreground">{props.label}</Text>
      <Switch value={props.value} onValueChange={props.onValueChange} />
    </View>
  );
}
