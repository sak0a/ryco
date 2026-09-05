import { type ProviderOptionDescriptor } from "@ryco/contracts";
import { memo } from "react";

import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { replaceDescriptorCurrentValue } from "./traitsMenuLogic";
import { cn } from "~/lib/utils";

type SelectDescriptor = Extract<ProviderOptionDescriptor, { type: "select" }>;

export interface GenericSelectChipProps {
  descriptor: SelectDescriptor;
  descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  onChangeDescriptors: (next: ReadonlyArray<ProviderOptionDescriptor>) => void;
  /** Gated by mutation capability at the call site. */
  disabled?: boolean;
}

// Fallback chip for any select descriptor that doesn't have a dedicated
// component (e.g. OpenCode's "variant", future provider-specific selects).
// Renders the current option's label and opens a radio menu on hover or click.
export const GenericSelectChip = memo(function GenericSelectChip(props: GenericSelectChipProps) {
  const value =
    typeof props.descriptor.currentValue === "string" ? props.descriptor.currentValue : "";
  const label = props.descriptor.options.find((option) => option.id === value)?.label ?? value;
  const ariaLabel = `${props.descriptor.label}: ${label}`;
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
            aria-label={ariaLabel}
            title={props.descriptor.label}
            className={cn(
              "gap-1 rounded-md px-1.5 font-medium",
              "bg-muted/40 text-muted-foreground",
            )}
          />
        }
      >
        <span>{label}</span>
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (!next || next === value) return;
            props.onChangeDescriptors(
              replaceDescriptorCurrentValue(props.descriptors, props.descriptor.id, next),
            );
          }}
        >
          {props.descriptor.options.map((option) => (
            <MenuRadioItem key={option.id} value={option.id}>
              {option.label}
              {option.isDefault ? " (default)" : ""}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
});
