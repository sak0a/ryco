import type { ReactNode, Ref } from "react";

import { cn } from "~/lib/utils";

/**
 * A page inside {@link HubShell}: a real page header — title, supporting line,
 * page-level actions — above its content.
 *
 * This is the piece that stops the Hub reading as a settings card. The surface
 * it replaces put a 2xl heading, a "Signed in as …" line and two icon buttons
 * inside the same bordered box as the content, at the same measure, so a page
 * and a panel were indistinguishable.
 */
export function HubPage({
  children,
  title,
  description,
  actions,
  titleRef,
}: {
  readonly children: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** Page-level actions, aligned with the title on a desktop viewport. */
  readonly actions?: ReactNode;
  /**
   * Focus target for surfaces that move focus to the heading on mount —
   * returning from a node, for instance. Landing focus in the content would
   * drop a screen-reader user past the page's own title.
   */
  readonly titleRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <h1
            ref={titleRef}
            tabIndex={-1}
            className="font-semibold text-2xl tracking-tight outline-none"
          >
            {title}
          </h1>
          {description === undefined ? null : (
            <div className="mt-1.5 text-muted-foreground text-sm">{description}</div>
          )}
        </div>
        {actions === undefined ? null : (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      <div className="mt-8">{children}</div>
    </>
  );
}

/**
 * A content panel within a Hub page.
 *
 * Uses the same `app-surface` material and bezel idiom as the app's dialogs and
 * popovers, so panels read as part of one design language rather than a second
 * card style invented for the Hub.
 */
export function HubPanel({
  children,
  className,
  title,
  description,
  actions,
}: {
  readonly children?: ReactNode;
  readonly className?: string;
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "app-surface relative rounded-2xl border not-dark:bg-clip-padding shadow-lg/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
        className,
      )}
    >
      {title === undefined && actions === undefined ? null : (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-border/60 border-b px-5 py-4">
          <div className="min-w-0 flex-1">
            {title === undefined ? null : <h2 className="font-medium text-base">{title}</h2>}
            {description === undefined ? null : (
              <p className="mt-1 text-muted-foreground text-sm leading-relaxed">{description}</p>
            )}
          </div>
          {actions === undefined ? null : (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          )}
        </header>
      )}
      {children === undefined ? null : <div className="px-5 py-4">{children}</div>}
    </section>
  );
}
