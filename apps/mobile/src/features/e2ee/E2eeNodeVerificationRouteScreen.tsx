import { useNavigation } from "@react-navigation/native";
import { useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { useThemeColor } from "../../lib/useThemeColor";
import { E2eeActionButton, E2eeIdentityColumn, E2eeSafetyNumberCard } from "./E2eeTrustParts";
import { E2EE_ACKNOWLEDGEMENT_SYMBOLS } from "./e2eeTrustSymbols";
import {
  createE2eeVerificationDraft,
  deriveE2eeVerificationView,
  E2EE_COMPARISON_AFFIRMATION,
  E2EE_PRESENTED_COLUMN_TITLE,
  E2EE_PREVIOUSLY_VERIFIED_COLUMN_TITLE,
} from "./e2eeTrustUiModel";
import { useMobileE2eeSession } from "./useMobileE2eeSession";

/**
 * The §13.2 pairing ceremony and §13.3's re-verification UI.
 *
 * Layout only. The stage machine, every string, the enrollment-fingerprint
 * comparison, and the single action that mints a §13.2 step 5 decision are all
 * `e2eeTrustUiModel.ts`'s.
 */
export function E2eeNodeVerificationRouteScreen() {
  const navigation = useNavigation();
  const session = useMobileE2eeSession();
  const [draft, setDraft] = useState(createE2eeVerificationDraft);
  const placeholderColor = useThemeColor("--color-foreground-muted");
  const iconColor = useThemeColor("--color-icon-muted");

  const view = deriveE2eeVerificationView({
    session,
    draft,
    onDraftChange: setDraft,
    onCompleted: () => navigation.goBack(),
    now: () => Date.now(),
  });

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      className="flex-1 bg-screen"
      contentContainerStyle={{ paddingTop: 4, paddingBottom: 48 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text className="mx-5 mt-4 text-xl font-ryco-bold text-foreground">{view.title}</Text>
      {view.nodeLabel ? (
        <Text className="mx-5 mt-1 font-sans text-sm text-foreground-muted">{view.nodeLabel}</Text>
      ) : null}
      <Text className="mx-5 mt-3 font-sans text-sm leading-relaxed text-foreground">
        {view.message}
      </Text>

      {/* §13.2.1 situation 2 alone: the previously verified pair beside the newly
          presented one, before any pairing step proceeds. */}
      {view.previouslyVerified && view.presented ? (
        <View className="mx-5 mt-4 flex-row gap-3">
          <E2eeIdentityColumn
            title={E2EE_PREVIOUSLY_VERIFIED_COLUMN_TITLE}
            identity={view.previouslyVerified}
          />
          <E2eeIdentityColumn title={E2EE_PRESENTED_COLUMN_TITLE} identity={view.presented} />
        </View>
      ) : null}

      {view.stage === "enrollment-fingerprint" ? (
        <View className="mx-5 mt-4">
          <TextInput
            accessibilityLabel="Node enrollment fingerprint"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={view.fingerprintPlaceholder}
            placeholderTextColor={placeholderColor as string}
            value={view.fingerprintValue}
            onChangeText={view.onChangeFingerprint}
            className="rounded-2xl border border-border bg-card px-4 py-3 font-mono text-sm text-foreground"
          />
          {view.fingerprintError ? (
            <Text className="mt-2 font-sans text-xs leading-relaxed text-danger-foreground">
              {view.fingerprintError}
            </Text>
          ) : null}
        </View>
      ) : null}

      {view.stage === "compare" ? (
        <>
          <E2eeSafetyNumberCard
            groups={view.safetyNumberGroups}
            caption={view.safetyNumberCaption}
            value={view.presented?.safetyNumber ?? ""}
          />
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: view.comparisonAcknowledged }}
            onPress={() => view.onAcknowledgeComparison(!view.comparisonAcknowledged)}
            className="mx-5 mt-4 flex-row items-start gap-3 rounded-2xl border border-border bg-card p-4 active:opacity-80"
          >
            <SymbolView
              name={
                view.comparisonAcknowledged
                  ? E2EE_ACKNOWLEDGEMENT_SYMBOLS.checked
                  : E2EE_ACKNOWLEDGEMENT_SYMBOLS.unchecked
              }
              size={18}
              tintColor={iconColor}
              type="monochrome"
            />
            <Text className="flex-1 font-sans text-sm leading-relaxed text-foreground">
              {E2EE_COMPARISON_AFFIRMATION}
            </Text>
          </Pressable>
        </>
      ) : null}

      {view.errorMessage ? (
        <Text className="mx-5 mt-4 font-sans text-sm leading-relaxed text-danger-foreground">
          {view.errorMessage}
        </Text>
      ) : null}

      {/* ABSENT until the owner has said they compared — never a disabled button
          that a stray press could re-enable. */}
      {view.confirm ? (
        <E2eeActionButton action={view.confirm} onConfirm={(action) => action.run()} />
      ) : null}

      <Text className="mx-5 mt-6 font-sans text-xs leading-relaxed text-foreground-muted">
        {view.nodeApprovalMessage}
      </Text>
      <Text className="mx-5 mt-3 font-sans text-xs leading-relaxed text-foreground-muted">
        {view.outcomeMessage}
      </Text>

      <E2eeActionButton
        action={view.dismiss}
        onConfirm={(action) => action.run()}
        variant="quiet"
      />
    </ScrollView>
  );
}
