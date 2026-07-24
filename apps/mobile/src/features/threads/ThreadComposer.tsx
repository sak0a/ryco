import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useThemeColor } from "../../lib/useThemeColor";

// Lean text composer. The native ComposerEditor (Liquid Glass pill, inline tokens)
// + draft-store binding are owner-Simulator polish deferred to a follow-up; this
// keeps the Thread screen functional and sends through the runtime send path.
export function ThreadComposer(props: {
  readonly onSend: (text: string) => void | Promise<void>;
  readonly disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const placeholderColor = useThemeColor("--color-icon-subtle");
  const textColor = useThemeColor("--color-foreground");

  const canSend = text.trim().length > 0 && !sending && !props.disabled;

  const send = async () => {
    if (!canSend) return;
    const value = text;
    setSending(true);
    try {
      await props.onSend(value);
      setText("");
    } finally {
      setSending(false);
    }
  };

  return (
    <View className="flex-row items-end gap-2 border-t border-border bg-screen px-3 py-2">
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Message"
        placeholderTextColor={placeholderColor as string}
        multiline
        editable={!props.disabled}
        className="max-h-32 flex-1 rounded-2xl border border-border bg-card px-4 py-2.5 font-sans text-base"
        style={{ color: textColor as string }}
      />
      <Pressable
        disabled={!canSend}
        onPress={() => void send()}
        className="mb-0.5 items-center justify-center rounded-full bg-primary px-4 py-2.5 active:opacity-70 disabled:opacity-40"
      >
        <Text className="text-sm font-ryco-bold text-primary-foreground">Send</Text>
      </Pressable>
    </View>
  );
}
