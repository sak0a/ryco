import { type ProviderOptionDescriptor } from "@ryco/contracts";
import { memo } from "react";
import { BrainIcon } from "lucide-react";

import { Button } from "../ui/button";
import { replaceDescriptorCurrentValue } from "./traitsMenuLogic";
import { cn } from "~/lib/utils";

type ThinkingDescriptor = Extract<ProviderOptionDescriptor, { type: "boolean" }>;

export interface ThinkingChipProps {
  descriptor: ThinkingDescriptor;
  descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  onChangeDescriptors: (next: ReadonlyArray<ProviderOptionDescriptor>) => void;
  /** Gated by mutation capability at the call site. */
  disabled?: boolean;
}

export const ThinkingChip = memo(function ThinkingChip(props: ThinkingChipProps) {
  const isOn = props.descriptor.currentValue === true;
  return (
    <Button
      size="xs"
      disabled={props.disabled ?? false}
      variant="ghost"
      aria-label="Thinking"
      aria-pressed={isOn}
      title={isOn ? "Thinking: on (click to disable)" : "Thinking: off (click to enable)"}
      className={cn(
        "gap-1 rounded-md px-1.5 font-medium",
        isOn
          ? "bg-sky-500/15 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300"
          : "text-muted-foreground/60 ring-1 ring-border ring-inset hover:text-foreground",
      )}
      onClick={() => {
        props.onChangeDescriptors(
          replaceDescriptorCurrentValue(props.descriptors, props.descriptor.id, !isOn),
        );
      }}
    >
      <BrainIcon aria-hidden="true" className="size-3" />
    </Button>
  );
});
