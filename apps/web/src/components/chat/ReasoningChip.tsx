import { type ProviderOptionDescriptor } from "@ryco/contracts";
import { memo } from "react";
import { SparklesIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { applyDescriptorSelection } from "./traitsMenuLogic";
import { cn } from "~/lib/utils";

type EffortDescriptor = Extract<ProviderOptionDescriptor, { type: "select" }>;

type LevelKey =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultra"
  | "ultracode"
  | "ultrathink";

const LEVEL_ABBREVIATION: Record<LevelKey, string> = {
  none: "None",
  minimal: "Min",
  low: "Low",
  medium: "Med",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
  ultra: "Ultra",
  ultracode: "UCode",
  ultrathink: "Ultra",
};

const SLATE_TINT = "bg-slate-400/15 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300";

const LEVEL_TINT_CLASSES: Record<LevelKey, string> = {
  none: SLATE_TINT,
  minimal: SLATE_TINT,
  low: SLATE_TINT,
  medium: "bg-blue-500/15 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  high: "bg-indigo-500/15 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300",
  xhigh: "bg-violet-500/15 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300",
  max: "bg-fuchsia-500/15 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300",
  ultra:
    "bg-gradient-to-br from-pink-500/20 to-purple-500/25 text-fuchsia-700 ring-1 ring-fuchsia-500/25 dark:text-fuchsia-300",
  ultracode:
    "bg-rose-500/15 text-rose-700 ring-1 ring-rose-500/25 dark:bg-rose-500/20 dark:text-rose-300",
  ultrathink:
    "bg-gradient-to-br from-pink-500/20 to-purple-500/25 text-fuchsia-700 ring-1 ring-fuchsia-500/25 dark:text-fuchsia-300",
};

const LEVEL_MENU_TEXT_CLASSES: Record<LevelKey, string> = {
  none: "text-slate-600 dark:text-slate-300",
  minimal: "text-slate-600 dark:text-slate-300",
  low: "text-slate-600 dark:text-slate-300",
  medium: "text-blue-600 dark:text-blue-300",
  high: "text-indigo-600 dark:text-indigo-300",
  xhigh: "text-violet-600 dark:text-violet-300",
  max: "text-fuchsia-600 dark:text-fuchsia-300",
  ultra: "text-fuchsia-600 dark:text-fuchsia-300",
  ultracode: "text-rose-600 dark:text-rose-300",
  ultrathink: "text-fuchsia-600 dark:text-fuchsia-300",
};

function getKnownLevel(value: string | undefined): LevelKey | undefined {
  if (
    value === "none" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max" ||
    value === "ultra" ||
    value === "ultracode" ||
    value === "ultrathink"
  ) {
    return value;
  }
  return undefined;
}

export function getReasoningLevelMenuClassName(value: string): string | undefined {
  const level = getKnownLevel(value);
  return level ? LEVEL_MENU_TEXT_CLASSES[level] : undefined;
}

export interface ReasoningChipProps {
  descriptor: EffortDescriptor;
  descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  prompt: string;
  primarySelectDescriptorId: string | undefined;
  ultrathinkInBodyText: boolean;
  ultrathinkPromptControlled: boolean;
  onChangeDescriptors: (next: ReadonlyArray<ProviderOptionDescriptor>) => void;
  /** Gated by mutation capability at the call site. */
  disabled?: boolean;
  onPromptChange: (prompt: string) => void;
}

export const ReasoningChip = memo(function ReasoningChip(props: ReasoningChipProps) {
  const effectiveValue = props.ultrathinkPromptControlled
    ? "ultrathink"
    : typeof props.descriptor.currentValue === "string"
      ? props.descriptor.currentValue
      : undefined;
  const level = effectiveValue === undefined ? "medium" : getKnownLevel(effectiveValue);
  const isUltra = level === "ultra" || level === "ultrathink";
  const displayLabel =
    level === undefined
      ? (props.descriptor.options.find((option) => option.id === effectiveValue)?.label ??
        effectiveValue ??
        LEVEL_ABBREVIATION.medium)
      : LEVEL_ABBREVIATION[level];
  const tintClasses = level === undefined ? SLATE_TINT : LEVEL_TINT_CLASSES[level];

  return (
    <Menu>
      <MenuTrigger
        openOnHover
        delay={150}
        closeDelay={200}
        render={
          <Button
            size="xs"
            disabled={props.disabled ?? false}
            variant="ghost"
            aria-label={`Reasoning: ${displayLabel}`}
            title={`Reasoning: ${displayLabel}`}
            className={cn("gap-1 rounded-md px-1.5 font-medium", tintClasses)}
          />
        }
      >
        {isUltra ? (
          <>
            <SparklesIcon aria-hidden="true" className="size-3" />
            <span>Ultra</span>
          </>
        ) : (
          <span>{displayLabel}</span>
        )}
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuRadioGroup
          value={effectiveValue ?? ""}
          onValueChange={(value) => {
            applyDescriptorSelection({
              descriptors: props.descriptors,
              descriptor: props.descriptor,
              value,
              prompt: props.prompt,
              primarySelectDescriptorId: props.primarySelectDescriptorId,
              ultrathinkInBodyText: props.ultrathinkInBodyText,
              ultrathinkPromptControlled: props.ultrathinkPromptControlled,
              onChangeDescriptors: props.onChangeDescriptors,
              onPromptChange: props.onPromptChange,
            });
          }}
        >
          {props.descriptor.options.map((option) => (
            <MenuRadioItem
              key={option.id}
              value={option.id}
              className={getReasoningLevelMenuClassName(option.id)}
              data-reasoning-level={option.id}
              disabled={
                props.ultrathinkInBodyText &&
                props.descriptor.id === props.primarySelectDescriptorId
              }
            >
              {option.label}
              {option.isDefault ? " (default)" : ""}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
});
