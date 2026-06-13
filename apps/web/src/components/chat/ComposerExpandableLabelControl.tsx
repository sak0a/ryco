import { memo, type ReactNode } from "react";

import { cn } from "~/lib/utils";

export interface ComposerExpandableLabelControlProps {
  icon: ReactNode;
  label: ReactNode;
  collapsed: boolean;
  expanded?: boolean;
  className?: string;
  labelClassName?: string;
}

export const ComposerExpandableLabelControl = memo(function ComposerExpandableLabelControl(
  props: ComposerExpandableLabelControlProps,
) {
  return (
    <span
      className={cn("inline-flex min-w-0 items-center", props.className)}
      data-composer-expandable-label-control="true"
      data-collapsed={props.collapsed ? "true" : "false"}
    >
      <span className="inline-flex shrink-0 items-center justify-center" aria-hidden="true">
        {props.icon}
      </span>
      <span
        className={cn(
          "block overflow-hidden whitespace-nowrap transition-[margin-left,max-width,opacity] duration-300 ease-out motion-reduce:transition-none",
          props.collapsed
            ? [
                "ml-0 max-w-0 opacity-0",
                "group-hover/composer-label-control:ml-1 group-hover/composer-label-control:max-w-40 group-hover/composer-label-control:opacity-100",
                "group-focus-visible/composer-label-control:ml-1 group-focus-visible/composer-label-control:max-w-40 group-focus-visible/composer-label-control:opacity-100",
                "group-focus-within/composer-label-control:ml-1 group-focus-within/composer-label-control:max-w-40 group-focus-within/composer-label-control:opacity-100",
                "group-data-[pressed]/composer-label-control:ml-1 group-data-[pressed]/composer-label-control:max-w-40 group-data-[pressed]/composer-label-control:opacity-100",
                props.expanded ? "ml-1 max-w-40 opacity-100" : undefined,
              ]
            : "ml-1 max-w-40 opacity-100",
          props.labelClassName,
        )}
        data-composer-expandable-label="true"
      >
        {props.label}
      </span>
    </span>
  );
});
