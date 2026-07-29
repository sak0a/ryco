import type { ComponentProps } from "react";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { ComposerAttachmentStrip } from "../../components/ComposerAttachmentStrip";
import { ComposerToolbarButton, ComposerToolbarRow } from "../../components/ComposerToolbarTrigger";
import { GlassSurface } from "../../components/GlassSurface";
import { ProviderIcon } from "../../components/ProviderIcon";
import {
  convertPastedImagesToAttachments,
  pickComposerImages,
  type DraftComposerImageAttachment,
} from "../../lib/composerImages";
import { useThemeColor } from "../../lib/useThemeColor";
import { ComposerEditor } from "../../native/ComposerEditor";

// Floating glass composer capsule (§3.5.2, §5). It uses the shared native
// ComposerEditor so mentions/skills, hardware-keyboard submit, and pasted images
// behave like the desktop composer while preserving a compact phone footprint.
export function ThreadComposer(props: {
  // Returns false when the send failed (offline/error) so the composer keeps the
  // user's text; enqueue/dispatch success returns true (or void) and clears it.
  readonly onSend: (
    text: string,
    attachments: ReadonlyArray<DraftComposerImageAttachment>,
  ) => boolean | void | Promise<boolean | void>;
  readonly disabled?: boolean;
  /**
   * Session-policy rail. Omitted on surfaces that have no thread to configure,
   * in which case no rail renders at all — the composer keeps its old shape.
   *
   * `policyDisabled` gates only the rail. It is deliberately separate from
   * `disabled`, which gates attach/send: a thread can be un-sendable while its
   * policy is still readable, and vice versa.
   */
  readonly policyLabel?: string;
  readonly policyIcon?: ComponentProps<typeof SymbolView>["name"];
  readonly policyCaution?: boolean;
  readonly policyAccessibilityLabel?: string;
  readonly policyDisabled?: boolean;
  readonly onOpenPolicy?: () => void;
  /** Provider+model pill. Rendered left of the policy pill when supplied. */
  readonly modelLabel?: string;
  readonly modelProviderDriver?: string | null;
  readonly modelAccessibilityLabel?: string;
  /** Selected reasoning level, short form. Quieter than the model name. */
  readonly modelReasoningLabel?: string | null;
  readonly modelFastEnabled?: boolean;
  readonly onOpenModel?: () => void;
}) {
  const safeAreaInsets = useSafeAreaInsets();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ReadonlyArray<DraftComposerImageAttachment>>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const primaryFg = useThemeColor("--color-primary-foreground");
  const iconSubtle = useThemeColor("--color-icon-subtle");
  const iconColor = useThemeColor("--color-icon");
  const warningColor = useThemeColor("--color-warning");

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !sending && !props.disabled;

  const send = async () => {
    if (!canSend) return;
    const value = text;
    const imageSnapshot = attachments;
    setSending(true);
    try {
      const result = await props.onSend(value, imageSnapshot);
      // Keep the complete draft on an explicit failure; clear on success/enqueue.
      if (result !== false) {
        setText("");
        setAttachments([]);
        setAttachmentError(null);
      }
    } finally {
      setSending(false);
    }
  };

  const pickImages = async () => {
    const result = await pickComposerImages({ existingCount: attachments.length });
    setAttachmentError(result.error);
    if (result.images.length > 0) {
      setAttachments((current) => [...current, ...result.images]);
    }
  };

  const pasteImages = async (uris: ReadonlyArray<string>) => {
    const images = await convertPastedImagesToAttachments({
      uris,
      existingCount: attachments.length,
    });
    if (images.length === 0 && uris.length > 0) {
      setAttachmentError("The pasted image could not be attached.");
      return;
    }
    setAttachmentError(null);
    setAttachments((current) => [...current, ...images]);
  };

  return (
    <View className="px-4 pt-1" style={{ paddingBottom: Math.max(8, safeAreaInsets.bottom) }}>
      {attachmentError ? (
        <Text className="px-3 pb-1.5 text-xs font-ryco-medium text-danger-foreground">
          {attachmentError}
        </Text>
      ) : null}
      <GlassSurface
        radius={26}
        glassEffectStyle="regular"
        style={{ paddingHorizontal: 6, paddingVertical: 6 }}
      >
        <View className="gap-1">
          {props.onOpenPolicy && props.policyLabel ? (
            <ComposerToolbarRow paddingTop={2} paddingBottom={2} paddingHorizontal={2}>
              {props.onOpenModel && props.modelLabel ? (
                <ComposerToolbarButton
                  iconNode={<ProviderIcon provider={props.modelProviderDriver} size={14} />}
                  label={props.modelLabel}
                  suffixLabel={props.modelReasoningLabel ?? undefined}
                  suffixIcon={props.modelFastEnabled ? "bolt.fill" : undefined}
                  suffixIconColor={warningColor as string}
                  accessibilityLabel={props.modelAccessibilityLabel ?? props.modelLabel}
                  disabled={props.policyDisabled}
                  onPress={props.onOpenModel}
                  className="max-w-full flex-1"
                />
              ) : null}
              {/* Icon only. The glyph alone says which access mode the task is
                  in — open padlock for full access, closed for supervised,
                  pencil for auto-accept — and dropping the word gives the model
                  name the width it actually needs. The full mode name still
                  reaches screen readers through accessibilityLabel, and the
                  caution mode keeps its amber tint so it is not silent. */}
              <ComposerToolbarButton
                iconNode={
                  <SymbolView
                    name={props.policyIcon ?? "lock"}
                    size={16}
                    tintColor={(props.policyCaution ? warningColor : iconColor) as string}
                    type="monochrome"
                  />
                }
                accessibilityLabel={props.policyAccessibilityLabel ?? props.policyLabel}
                active={props.policyCaution}
                disabled={props.policyDisabled}
                showChevron={false}
                onPress={props.onOpenPolicy}
              />
            </ComposerToolbarRow>
          ) : null}
          <View className="px-2">
            <ComposerAttachmentStrip
              attachments={attachments}
              imageSize={58}
              imageBorderRadius={13}
              onRemove={(id) =>
                setAttachments((current) => current.filter((attachment) => attachment.id !== id))
              }
            />
          </View>
          <View className="flex-row items-end gap-1">
            <Pressable
              disabled={sending || props.disabled}
              onPress={() => void pickImages()}
              accessibilityRole="button"
              accessibilityLabel="Attach images"
              className="h-11 w-11 items-center justify-center rounded-full active:bg-subtle-strong disabled:opacity-40"
            >
              <SymbolView
                name="paperclip"
                size={18}
                tintColor={iconColor as string}
                type="monochrome"
              />
            </Pressable>
            <ComposerEditor
              value={text}
              onChangeText={setText}
              placeholder="Message"
              multiline
              editable={!props.disabled && !sending}
              contentInsetVertical={10}
              style={{ minHeight: 44, maxHeight: 128, flex: 1 }}
              onPasteImages={(uris) => void pasteImages(uris)}
              onSubmit={() => void send()}
            />
            <Pressable
              disabled={!canSend}
              onPress={() => void send()}
              accessibilityRole="button"
              accessibilityLabel="Send"
              className="h-11 w-11 items-center justify-center rounded-full bg-primary active:opacity-70 disabled:opacity-40"
            >
              <SymbolView
                name="arrow.up"
                size={18}
                tintColor={(canSend ? primaryFg : iconSubtle) as string}
                type="monochrome"
              />
            </Pressable>
          </View>
        </View>
      </GlassSurface>
    </View>
  );
}
