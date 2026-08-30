import type { ChatMessage } from "@ryco/client-runtime/state/threads";
import * as Linking from "expo-linking";
import { Image, ScrollView, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { resolveNativeMarkdownTypography } from "../../lib/appearancePreferences";
import { useFontFamily } from "../../lib/useFontFamily";
import { useThemeColor } from "../../lib/useThemeColor";
import {
  hasNativeSelectableMarkdownText,
  SelectableMarkdownText,
  type NativeMarkdownTextStyle,
} from "../../native/SelectableMarkdownText";
import { useScaledTextRole } from "../settings/appearance/useScaledTextRole";
import { threadMessagePresentation } from "./threadPresentation";

export function ThreadMessage(props: { readonly message: ChatMessage }) {
  const isUser = props.message.role === "user";
  const presentation = threadMessagePresentation(isUser ? "user" : "assistant");
  const bodyText = useScaledTextRole("body");
  const typography = resolveNativeMarkdownTypography(bodyText.fontSize);
  const regularFont = useFontFamily("regular");
  const boldFont = useFontFamily("bold");
  const bodyColor = useThemeColor("--color-md-body");
  const strongColor = useThemeColor("--color-md-strong");
  const mutedColor = useThemeColor("--color-foreground-muted");
  const linkColor = useThemeColor("--color-md-link");
  const codeColor = useThemeColor("--color-md-code-text");
  const codeBackground = useThemeColor("--color-md-code-bg");
  const codeBlockBackground = useThemeColor("--color-card-alt");
  const fileTextColor = useThemeColor("--color-md-link");
  const skillTextColor = useThemeColor("--color-inline-skill-foreground");
  const quoteMarkerColor = useThemeColor("--color-md-blockquote-border");
  const dividerColor = useThemeColor("--color-md-hr");
  const markdownStyle: NativeMarkdownTextStyle = {
    color: String(bodyColor),
    strongColor: String(strongColor),
    mutedColor: String(mutedColor),
    linkColor: String(linkColor),
    inlineCodeColor: String(codeColor),
    codeColor: String(codeColor),
    codeBackgroundColor: String(codeBackground),
    codeBlockBackgroundColor: String(codeBlockBackground),
    fileTextColor: String(fileTextColor),
    skillTextColor: String(skillTextColor),
    quoteMarkerColor: String(quoteMarkerColor),
    dividerColor: String(dividerColor),
    fontSize: typography.fontSize,
    lineHeight: typography.lineHeight,
    fontFamily: regularFont,
    headingFontFamily: boldFont,
    boldFontFamily: boldFont,
    headingFontSizes: typography.headingFontSizes,
  };
  const text = props.message.text || (props.message.streaming ? "…" : "");
  const attachments = props.message.attachments ?? [];

  return (
    <View className={`px-4 py-2 ${isUser ? "items-end" : "items-start"}`}>
      <View
        className={
          isUser
            ? `max-w-[88%] rounded-[20px] px-4 py-3 ${presentation.bubbleClassName}`
            : "w-full px-1 py-1"
        }
      >
        {isUser && props.message.dispatchMode === "steer" ? (
          <Text className="mb-1 text-2xs font-ryco-bold uppercase tracking-wide text-foreground-muted">
            Steered
          </Text>
        ) : null}
        {isUser || !hasNativeSelectableMarkdownText() ? (
          <Text
            selectable
            className={`font-sans text-base leading-normal ${presentation.textClassName}`}
          >
            {text}
          </Text>
        ) : (
          <SelectableMarkdownText
            markdown={text}
            textStyle={markdownStyle}
            preserveSoftBreaks
            marginTop={0}
            marginBottom={0}
            onLinkPress={(href) => {
              void Linking.openURL(href).catch(() => undefined);
            }}
          />
        )}
        {attachments.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-2 grow-0">
            <View className="flex-row gap-2">
              {attachments.map((attachment) =>
                attachment.type === "image" && attachment.previewUrl ? (
                  <Image
                    key={attachment.id}
                    source={{ uri: attachment.previewUrl }}
                    className="h-36 w-36 rounded-2xl bg-subtle"
                    resizeMode="cover"
                    accessibilityLabel={attachment.name}
                  />
                ) : (
                  <View
                    key={attachment.id}
                    className="min-h-20 w-44 justify-center rounded-2xl bg-subtle px-3 py-2"
                  >
                    <Text className="font-ryco-bold text-sm text-foreground" numberOfLines={2}>
                      {attachment.name}
                    </Text>
                    <Text className="mt-1 text-xs text-foreground-muted" numberOfLines={1}>
                      {attachment.mimeType} · {Math.ceil(attachment.sizeBytes / 1024)} KB
                    </Text>
                  </View>
                ),
              )}
            </View>
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}
