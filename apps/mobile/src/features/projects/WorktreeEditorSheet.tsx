import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, TextInput, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { ErrorBanner } from "../../components/ErrorBanner";
import { useThemeColor } from "../../lib/useThemeColor";

export function WorktreeEditorSheet(props: {
  readonly visible: boolean;
  readonly title: string;
  readonly detail: string;
  readonly label: string;
  readonly initialValue?: string;
  readonly placeholder: string;
  readonly actionLabel: string;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly onClose: () => void;
  readonly onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(props.initialValue ?? "");
  const placeholderColor = useThemeColor("--color-placeholder");
  const textColor = useThemeColor("--color-foreground");

  useEffect(() => {
    if (props.visible) setValue(props.initialValue ?? "");
  }, [props.initialValue, props.visible]);

  return (
    <Modal
      visible={props.visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={props.onClose}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        className="flex-1 bg-screen"
        contentContainerStyle={{ padding: 20, gap: 18 }}
      >
        <View className="flex-row items-center gap-3">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            className="h-11 min-w-11 items-center justify-center rounded-full px-2 active:bg-subtle"
            onPress={props.onClose}
          >
            <Text className="font-ryco-medium text-base text-foreground">Cancel</Text>
          </Pressable>
          <Text className="flex-1 text-center text-lg font-ryco-bold text-foreground">
            {props.title}
          </Text>
          <View className="h-11 min-w-11" />
        </View>

        <Text className="font-sans text-base leading-normal text-foreground-muted">
          {props.detail}
        </Text>
        {props.error ? <ErrorBanner message={props.error} /> : null}

        <View className="gap-2">
          <Text className="px-1 text-sm font-ryco-medium text-foreground-muted">{props.label}</Text>
          <TextInput
            autoFocus
            value={value}
            onChangeText={setValue}
            placeholder={props.placeholder}
            placeholderTextColor={placeholderColor as string}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="done"
            className="min-h-14 rounded-2xl border border-border bg-card px-4 py-3 font-mono text-base"
            style={{ color: textColor as string }}
            onSubmitEditing={() => {
              if (!props.busy && value.trim()) props.onSubmit(value);
            }}
          />
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={props.busy || !value.trim()}
          onPress={() => props.onSubmit(value)}
          className="h-12 items-center justify-center rounded-full bg-primary px-5 active:opacity-80 disabled:opacity-40"
        >
          <Text className="text-base font-ryco-bold text-primary-foreground">
            {props.busy ? "Working…" : props.actionLabel}
          </Text>
        </Pressable>
      </ScrollView>
    </Modal>
  );
}
