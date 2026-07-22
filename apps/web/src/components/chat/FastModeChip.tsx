import { type ProviderOptionDescriptor } from "@ryco/contracts";
import { memo } from "react";
import { ZapIcon } from "lucide-react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { replaceDescriptorCurrentValue } from "./traitsMenuLogic";
import { cn } from "~/lib/utils";

type FastDescriptor = Extract<ProviderOptionDescriptor, { type: "boolean" }>;

export interface FastModeChipProps {
  descriptor: FastDescriptor;
  descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  onChangeDescriptors: (next: ReadonlyArray<ProviderOptionDescriptor>) => void;
  /** Gated by mutation capability at the call site. */
  disabled?: boolean;
}

export const FastModeChip = memo(function FastModeChip(props: FastModeChipProps) {
  const isOn = props.descriptor.currentValue === true;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="Fast mode"
            aria-pressed={isOn}
            disabled={props.disabled ?? false}
            onClick={() => {
              if (props.disabled) return;
              props.onChangeDescriptors(
                replaceDescriptorCurrentValue(props.descriptors, props.descriptor.id, !isOn),
              );
            }}
            className={cn(
              "inline-flex h-7 cursor-pointer items-center justify-center gap-1 rounded-md px-1.5 font-medium text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 sm:h-6 sm:text-[11px]",
              isOn
                ? "bg-yellow-500/15 text-yellow-800 hover:bg-yellow-500/25 dark:bg-yellow-500/20 dark:text-yellow-300 dark:hover:bg-yellow-500/30"
                : "text-muted-foreground/60 ring-1 ring-border ring-inset hover:bg-accent hover:text-foreground",
            )}
          >
            <ZapIcon
              aria-hidden="true"
              className={cn("size-3", isOn ? "fill-current" : undefined)}
            />
          </button>
        }
      />
      <TooltipPopup side="top">
        {isOn ? "Fast mode on — click to disable" : "Fast mode off — click to enable"}
      </TooltipPopup>
    </Tooltip>
  );
});
