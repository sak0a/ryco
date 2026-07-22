import {
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ScopedThreadRef,
  type ServerProviderModel,
} from "@ryco/contracts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionDescriptors,
  isClaudeUltrathinkPrompt,
} from "@ryco/shared/model";
import { memo, useCallback } from "react";

import { useComposerDraftStore, type DraftId } from "../../composerDraftStore";
import { getProviderModelCapabilities } from "../../providerModels";
import { boundedDisabledReason } from "~/lib/boundedReason";

import { AgentChip } from "./AgentChip";
import { ContextWindowChip } from "./ContextWindowChip";
import { FastModeChip } from "./FastModeChip";
import { GenericSelectChip } from "./GenericSelectChip";
import { ReasoningChip } from "./ReasoningChip";
import { ThinkingChip } from "./ThinkingChip";

// Descriptor ids that have a dedicated chip component. Any other select
// descriptor (e.g. OpenCode's "variant") falls back to GenericSelectChip.
const REASONING_DESCRIPTOR_IDS = new Set(["effort", "reasoningEffort", "reasoning"]);
const KNOWN_SELECT_IDS = new Set([...REASONING_DESCRIPTOR_IDS, "contextWindow", "agent"]);

type ProviderOptions = ReadonlyArray<ProviderOptionSelection>;

type Persistence =
  | {
      threadRef?: ScopedThreadRef;
      draftId?: DraftId;
      onModelOptionsChange?: never;
    }
  | {
      threadRef?: undefined;
      draftId?: undefined;
      onModelOptionsChange: (nextOptions: ProviderOptions | undefined) => void;
    };

export type TraitsChipsProps = {
  provider: ProviderDriverKind;
  instanceId?: ProviderInstanceId;
  models: ReadonlyArray<ServerProviderModel>;
  model: string | null | undefined;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  modelOptions?: ProviderOptions | null | undefined;
  /**
   * Renders the disabled presentation and blocks every option change. The
   * chips sit beside the model pill and the session-policy control in the
   * composer, so they gate on the same read-only mutation capability those do
   * rather than staying live next to two disabled controls.
   */
  disabled?: boolean;
  /** Bounded, operator-facing reason shown when `disabled`. */
  disabledReason?: string;
} & Persistence;

export const TraitsChips = memo(function TraitsChips(props: TraitsChipsProps) {
  const setProviderModelOptions = useComposerDraftStore((store) => store.setProviderModelOptions);
  const updateModelOptions = useCallback(
    (nextOptions: ProviderOptions | undefined) => {
      // Fail closed: the chips are already disabled, so this only matters if a
      // change ever reaches here another way.
      if (props.disabled) return;
      if ("onModelOptionsChange" in props && typeof props.onModelOptionsChange === "function") {
        props.onModelOptionsChange(nextOptions);
        return;
      }
      const threadTarget = props.threadRef ?? props.draftId;
      if (!threadTarget) return;
      setProviderModelOptions(threadTarget, props.provider, nextOptions, {
        ...(props.instanceId ? { instanceId: props.instanceId } : {}),
        model: props.model,
        persistSticky: true,
      });
    },
    [props, setProviderModelOptions],
  );

  const caps = getProviderModelCapabilities(props.models, props.model, props.provider);
  const descriptors = getProviderOptionDescriptors({ caps, selections: props.modelOptions });
  if (descriptors.length === 0) return null;

  const primarySelectDescriptor = descriptors.find(
    (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: "select" }> =>
      descriptor.type === "select",
  );

  const ultrathinkPromptControlled =
    (primarySelectDescriptor?.promptInjectedValues?.length ?? 0) > 0 &&
    isClaudeUltrathinkPrompt(props.prompt);
  const ultrathinkInBodyText =
    ultrathinkPromptControlled &&
    isClaudeUltrathinkPrompt(props.prompt.replace(/^Ultrathink:\s*/i, ""));

  const onChangeDescriptors = (next: ReadonlyArray<ProviderOptionDescriptor>) => {
    updateModelOptions(buildProviderOptionSelectionsFromDescriptors(next));
  };

  const findSelect = (id: string) =>
    descriptors.find(
      (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: "select" }> =>
        descriptor.id === id && descriptor.type === "select",
    );
  const findBoolean = (id: string) =>
    descriptors.find(
      (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: "boolean" }> =>
        descriptor.id === id && descriptor.type === "boolean",
    );

  // Reasoning descriptor id varies by provider:
  //   Claude → "effort", Codex → "reasoningEffort", Cursor → "reasoning"
  const effort = descriptors.find(
    (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: "select" }> =>
      descriptor.type === "select" && REASONING_DESCRIPTOR_IDS.has(descriptor.id),
  );
  const fastMode = findBoolean("fastMode");
  const contextWindow = findSelect("contextWindow");
  const thinking = findBoolean("thinking");
  const agent = findSelect("agent");

  // Any select descriptor we don't have a dedicated chip for (e.g.
  // OpenCode's "variant") renders via GenericSelectChip. Booleans without
  // dedicated chips are intentionally skipped — every known provider's
  // booleans are already covered above.
  const extraSelects = descriptors.filter(
    (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: "select" }> =>
      descriptor.type === "select" &&
      !KNOWN_SELECT_IDS.has(descriptor.id) &&
      !REASONING_DESCRIPTOR_IDS.has(descriptor.id),
  );

  const disabled = props.disabled ?? false;
  const reason =
    disabled && props.disabledReason ? boundedDisabledReason(props.disabledReason) : null;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {effort ? (
        <ReasoningChip
          descriptor={effort}
          descriptors={descriptors}
          prompt={props.prompt}
          primarySelectDescriptorId={primarySelectDescriptor?.id}
          ultrathinkInBodyText={ultrathinkInBodyText}
          ultrathinkPromptControlled={ultrathinkPromptControlled}
          onChangeDescriptors={onChangeDescriptors}
          onPromptChange={props.onPromptChange}
          disabled={disabled}
        />
      ) : null}
      {fastMode ? (
        <FastModeChip
          descriptor={fastMode}
          descriptors={descriptors}
          onChangeDescriptors={onChangeDescriptors}
          disabled={disabled}
        />
      ) : null}
      {contextWindow ? (
        <ContextWindowChip
          descriptor={contextWindow}
          descriptors={descriptors}
          onChangeDescriptors={onChangeDescriptors}
          disabled={disabled}
        />
      ) : null}
      {thinking ? (
        <ThinkingChip
          descriptor={thinking}
          descriptors={descriptors}
          onChangeDescriptors={onChangeDescriptors}
          disabled={disabled}
        />
      ) : null}
      {agent ? (
        <AgentChip
          descriptor={agent}
          descriptors={descriptors}
          onChangeDescriptors={onChangeDescriptors}
          disabled={disabled}
        />
      ) : null}
      {extraSelects.map((descriptor) => (
        <GenericSelectChip
          key={descriptor.id}
          descriptor={descriptor}
          descriptors={descriptors}
          onChangeDescriptors={onChangeDescriptors}
          disabled={disabled}
        />
      ))}
      {reason ? (
        <span className="text-muted-foreground/80 text-xs" data-slot="traits-disabled-reason">
          {reason}
        </span>
      ) : null}
    </div>
  );
});
