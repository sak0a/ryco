import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { XIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";

const DISMISS_TRANSITION_MS = 220;
const frontExitStyle = {
  opacity: 0,
  transform: "translate3d(0, 4rem, 0)",
} satisfies CSSProperties;
const stackedExitStyle = {
  opacity: 0,
  transform: "translate3d(0, 7rem, 0)",
} satisfies CSSProperties;
const restingStyle = {
  opacity: 1,
  transform: "translate3d(0, 0, 0)",
} satisfies CSSProperties;
const exitTransitionStyle = {
  transition: `transform ${DISMISS_TRANSITION_MS}ms ease-in, opacity ${DISMISS_TRANSITION_MS}ms ease-in`,
  willChange: "transform, opacity",
} satisfies CSSProperties;

export interface ComposerBannerStackItem {
  readonly id: string;
  readonly variant: "error" | "info" | "success" | "warning";
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly dismissLabel?: string;
  readonly onDismiss?: () => void;
}

interface ComposerBannerStackProps {
  readonly className?: string;
  readonly items: ReadonlyArray<ComposerBannerStackItem>;
}

export function ComposerBannerStack({ className, items }: ComposerBannerStackProps) {
  const [exitingItemId, setExitingItemId] = useState<string | null>(null);
  // Touch path for the hover-revealed stack: tapping the stack cap expands the
  // hidden banners; desktop hover/focus reveal is unchanged.
  const [isStackExpanded, setIsStackExpanded] = useState(false);
  const dismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (exitingItemId && !items.some((item) => item.id === exitingItemId)) {
      setExitingItemId(null);
    }
  }, [exitingItemId, items]);

  useEffect(() => {
    if (items.length <= 1) {
      setIsStackExpanded(false);
    }
  }, [items.length]);

  useEffect(() => {
    return () => {
      if (dismissTimeoutRef.current) {
        clearTimeout(dismissTimeoutRef.current);
      }
    };
  }, []);

  if (items.length === 0) {
    return null;
  }

  const frontItem = items[0];
  if (!frontItem) {
    return null;
  }
  const stackedItems = items.slice(1);
  const hasStack = stackedItems.length > 0;
  const showCollapsedStackCap = hasStack && exitingItemId !== frontItem.id;

  const requestDismiss = (item: ComposerBannerStackItem) => {
    if (!item.onDismiss || exitingItemId) {
      return;
    }
    setExitingItemId(item.id);
    if (dismissTimeoutRef.current) {
      clearTimeout(dismissTimeoutRef.current);
    }
    dismissTimeoutRef.current = setTimeout(() => {
      dismissTimeoutRef.current = null;
      item.onDismiss?.();
    }, DISMISS_TRANSITION_MS);
  };

  return (
    <div className={cn("group/banner-stack mx-auto mb-2 max-w-208", className)}>
      <div
        className={cn(
          "relative",
          hasStack ? "group-hover/banner-stack:z-50 group-focus-within/banner-stack:z-50" : null,
          hasStack && isStackExpanded ? "z-50" : null,
        )}
      >
        {showCollapsedStackCap ? (
          <button
            type="button"
            aria-expanded={isStackExpanded}
            aria-label={
              isStackExpanded
                ? "Hide stacked notifications"
                : `Show ${stackedItems.length} more ${
                    stackedItems.length === 1 ? "notification" : "notifications"
                  }`
            }
            className={cn(
              "absolute inset-x-0 -top-3 mx-auto h-3 cursor-pointer rounded-t-xl outline-none",
              isStackExpanded ? "z-30" : "z-0",
              "border border-b-0 border-warning/24 bg-background/96 shadow-[0_6px_18px_rgba(0,0,0,0.06)]",
              "transition-opacity duration-150 ease-out",
              isStackExpanded
                ? null
                : "group-hover/banner-stack:opacity-0 group-focus-within/banner-stack:opacity-0",
            )}
            style={{ width: "96%" }}
            onClick={() => setIsStackExpanded((expanded) => !expanded)}
          />
        ) : null}
        <div
          className={cn(
            "relative z-10",
            exitingItemId === frontItem.id ? "pointer-events-none" : null,
          )}
          style={{
            ...exitTransitionStyle,
            ...(exitingItemId === frontItem.id ? frontExitStyle : restingStyle),
          }}
        >
          <ComposerBannerStackAlert
            item={frontItem}
            exiting={exitingItemId === frontItem.id}
            onDismissRequest={() => requestDismiss(frontItem)}
          />
        </div>
        {hasStack ? (
          <div
            data-composer-banner-stack-rest="true"
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-[calc(100%+0.5rem)] z-20 space-y-2 opacity-0",
              "transition-[opacity,transform] duration-150 ease-out",
              "translate-y-1",
              "group-hover/banner-stack:pointer-events-auto group-hover/banner-stack:translate-y-0 group-hover/banner-stack:opacity-100",
              "group-focus-within/banner-stack:pointer-events-auto group-focus-within/banner-stack:translate-y-0 group-focus-within/banner-stack:opacity-100",
              isStackExpanded ? "pointer-events-auto translate-y-0 opacity-100" : null,
            )}
          >
            {stackedItems.map((item) => (
              <div
                key={item.id}
                className={cn(exitingItemId === item.id ? "pointer-events-none" : null)}
                style={{
                  ...exitTransitionStyle,
                  ...(exitingItemId === item.id ? stackedExitStyle : restingStyle),
                }}
              >
                <ComposerBannerStackAlert
                  item={item}
                  exiting={exitingItemId === item.id}
                  onDismissRequest={() => requestDismiss(item)}
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ComposerBannerStackAlert({
  item,
  exiting,
  onDismissRequest,
}: {
  readonly item: ComposerBannerStackItem;
  readonly exiting: boolean;
  readonly onDismissRequest: () => void;
}) {
  const dismissOnly = item.onDismiss && !item.actions;

  return (
    <Alert variant={item.variant}>
      {item.icon}
      <AlertTitle>{item.title}</AlertTitle>
      {item.description ? <AlertDescription>{item.description}</AlertDescription> : null}
      {item.actions || item.onDismiss ? (
        <AlertAction
          className={
            dismissOnly
              ? "max-sm:col-start-3 max-sm:row-start-1 max-sm:mt-0 max-sm:self-start"
              : undefined
          }
        >
          {item.actions}
          {item.onDismiss ? (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={item.dismissLabel ?? "Dismiss warning"}
              disabled={exiting}
              onClick={onDismissRequest}
            >
              <XIcon className="size-3.5" />
            </Button>
          ) : null}
        </AlertAction>
      ) : null}
    </Alert>
  );
}
