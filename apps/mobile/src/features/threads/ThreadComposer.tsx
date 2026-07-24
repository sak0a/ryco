import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { GlassSurface } from "../../components/GlassSurface";
import { useThemeColor } from "../../lib/useThemeColor";

// Floating glass composer capsule (§3.5.2, §5). The bar is a translucent glass
// capsule the thread content fades beneath; Send is a white primary circle with a
// black glyph. The native inline-token ComposerEditor is a follow-up.
export function ThreadComposer(props: {
  // Returns false when the send failed (offline/error) so the composer keeps the
  // user's text; enqueue/dispatch success returns true (or void) and clears it.
  readonly onSend: (text: string) => boolean | void | Promise<boolean | void>;
  readonly disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const placeholderColor = useThemeColor("--color-placeholder");
  const textColor = useThemeColor("--color-foreground");
  const primaryFg = useThemeColor("--color-primary-foreground");
  const iconSubtle = useThemeColor("--color-icon-subtle");

  const canSend = text.trim().length > 0 && !sending && !props.disabled;

  const send = async () => {
    if (!canSend) return;
    const value = text;
    setSending(true);
    try {
      const result = await props.onSend(value);
      // Keep the input on an explicit failure; clear it on success/enqueue.
      if (result !== false) setText("");
    } finally {
      setSending(false);
    }
  };

  return (
    <View className="px-4 pb-2 pt-1">
      <GlassSurface
        radius={26}
        glassEffectStyle="regular"
        style={{ paddingLeft: 18, paddingRight: 6, paddingVertical: 6 }}
      >
        <View className="flex-row items-end gap-2">
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Message"
            placeholderTextColor={placeholderColor as string}
            multiline
            editable={!props.disabled}
            className="max-h-32 flex-1 py-2 font-sans text-base"
            style={{ color: textColor as string }}
          />
          <Pressable
            disabled={!canSend}
            onPress={() => void send()}
            accessibilityRole="button"
            accessibilityLabel="Send"
            className="h-9 w-9 items-center justify-center rounded-full bg-primary active:opacity-70 disabled:opacity-40"
          >
            <SymbolView
              name="arrow.up"
              size={17}
              tintColor={(canSend ? primaryFg : iconSubtle) as string}
              type="monochrome"
            />
          </Pressable>
        </View>
      </GlassSurface>
    </View>
  );
}
