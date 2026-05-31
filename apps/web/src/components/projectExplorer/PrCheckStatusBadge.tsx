import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  Clock3Icon,
  LoaderCircleIcon,
  PauseCircleIcon,
  SkipForwardIcon,
  XCircleIcon,
} from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "~/lib/utils";
import type { PrCheckStatusIconKey, PrCheckStatusView } from "./prCheckStatus";

interface PrCheckStatusBadgeProps {
  view: PrCheckStatusView;
  className?: string | undefined;
  mode?: "full" | "compact" | "icon";
  onClick?: (() => void) | undefined;
  title?: string | undefined;
}

function CheckStatusIcon(props: { icon: PrCheckStatusIconKey; className?: string | undefined }) {
  const className = cn("size-3.5 shrink-0", props.className);
  switch (props.icon) {
    case "check":
      return <CheckCircle2Icon className={className} />;
    case "clock":
      return <Clock3Icon className={className} />;
    case "error":
      return <AlertTriangleIcon className={className} />;
    case "loader":
      return <LoaderCircleIcon className={cn(className, "animate-spin")} />;
    case "pause":
      return <PauseCircleIcon className={className} />;
    case "skip":
      return <SkipForwardIcon className={className} />;
    case "unavailable":
      return <CircleDashedIcon className={className} />;
    case "x":
      return <XCircleIcon className={className} />;
  }
}

export function PrCheckStatusBadge(props: PrCheckStatusBadgeProps) {
  const mode = props.mode ?? "full";
  const label = mode === "compact" ? props.view.shortLabel : props.view.label;
  const className = cn(
    "inline-flex shrink-0 items-center rounded-md border font-medium leading-none",
    mode === "icon" ? "size-6 justify-center p-0" : "gap-1 px-1.5 py-0.5 text-[11px]",
    props.view.className,
    props.className,
  );
  const title = props.title ?? props.view.ariaLabel;
  const children = (
    <>
      <CheckStatusIcon icon={props.view.icon} className={props.view.iconClassName} />
      {mode === "icon" ? <span className="sr-only">{props.view.label}</span> : label}
    </>
  );

  if (props.onClick) {
    const buttonProps: ButtonHTMLAttributes<HTMLButtonElement> = {
      type: "button",
      className: cn(className, "cursor-pointer transition-colors hover:brightness-95"),
      "aria-label": props.view.ariaLabel,
      title,
      onClick: props.onClick,
    };
    return <button {...buttonProps}>{children}</button>;
  }

  return (
    <span className={className} aria-label={props.view.ariaLabel} title={title}>
      {children}
    </span>
  );
}
