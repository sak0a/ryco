import { type ProviderOptionDescriptor } from "@ryco/contracts";
import { memo } from "react";
import { BrainIcon, SparklesIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { applyDescriptorSelection } from "./traitsMenuLogic";
import { useUiStateStore } from "../../uiStateStore";
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
  | "ultracode"
  | "ultrathink";

const LEVEL_ABBREVIATION: Record<LevelKey, string> = {
  none: "None",
  minimal: "Min",
  low: "Low",
  medium: "Med",
  high: "High",
  xhigh: "XHi",
  max: "Max",
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
  ultracode:
    "bg-rose-500/15 text-rose-700 ring-1 ring-rose-500/25 dark:bg-rose-500/20 dark:text-rose-300",
  ultrathink:
    "bg-gradient-to-br from-pink-500/20 to-purple-500/25 text-fuchsia-700 ring-1 ring-fuchsia-500/25 dark:text-fuchsia-300",
};

function normalizeLevel(value: string | undefined): LevelKey {
  if (
    value === "none" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max" ||
    value === "ultracode" ||
    value === "ultrathink"
  ) {
    return value;
  }
  return "medium";
}

export interface ReasoningChipProps {
  descriptor: EffortDescriptor;
  descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  prompt: string;
  primarySelectDescriptorId: string | undefined;
  ultrathinkInBodyText: boolean;
  ultrathinkPromptControlled: boolean;
  onChangeDescriptors: (next: ReadonlyArray<ProviderOptionDescriptor>) => void;
  onPromptChange: (prompt: string) => void;
}

export const ReasoningChip = memo(function ReasoningChip(props: ReasoningChipProps) {
  const indicatorStyle = useUiStateStore((state) => state.reasoningIndicatorStyle);
  const effectiveValue = props.ultrathinkPromptControlled
    ? "ultrathink"
    : typeof props.descriptor.currentValue === "string"
      ? props.descriptor.currentValue
      : undefined;
  const level = normalizeLevel(effectiveValue);
  const isUltra = level === "ultrathink";
  const abbreviation = LEVEL_ABBREVIATION[level];

  // Dot scale is derived from the model's actual options so the chip shows
  // exactly as many dots as the model supports. Prompt-injected values
  // (ultrathink) sit outside the linear scale — they get the sparkle.
  const promptInjectedSet = new Set(props.descriptor.promptInjectedValues ?? []);
  const scaleOptions = props.descriptor.options.filter(
    (option) => !promptInjectedSet.has(option.id),
  );
  const totalDots = scaleOptions.length;
  const currentScaleIndex = effectiveValue
    ? scaleOptions.findIndex((option) => option.id === effectiveValue)
    : -1;
  const ordinal = currentScaleIndex >= 0 ? currentScaleIndex + 1 : 0;
  const dotIndicator = (
    <span className="inline-flex items-center gap-0.5">
      {Array.from({ length: totalDots }, (_, index) => {
        const on = index + 1 <= ordinal;
        return (
          <span
            key={index}
            data-testid={on ? "reasoning-dot-on" : "reasoning-dot-off"}
            className={cn("size-[5px] rounded-full bg-current", on ? "opacity-100" : "opacity-30")}
          />
        );
      })}
    </span>
  );

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="xs"
            variant="ghost"
            aria-label={`Reasoning: ${abbreviation}`}
            title={`Reasoning: ${abbreviation}`}
            className={cn("gap-1 rounded-md px-1.5 font-medium", LEVEL_TINT_CLASSES[level])}
          />
        }
      >
        {isUltra ? (
          <>
            <SparklesIcon aria-hidden="true" className="size-3" />
            <span>Ultra</span>
          </>
        ) : indicatorStyle === "text" ? (
          <span>{abbreviation}</span>
        ) : (
          <>
            {indicatorStyle === "icon-dots" ? (
              <BrainIcon aria-hidden="true" className="size-3" />
            ) : null}
            {dotIndicator}
          </>
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
