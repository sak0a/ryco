import type { ReactNode, RefObject } from "react";

import { cn } from "~/lib/utils";
import { usePresentationTier } from "../../../hooks/usePresentationTier";
import { AnchoredToastProvider, ToastProvider } from "../../ui/toast";
import { HubTopBar } from "./HubTopBar";
import { HUB_EDGE_PADDING_CLASS_NAME, HUB_MEASURE_CLASS_NAME, type HubMeasure } from "./hubLayout";

/**
 * The chrome for every signed-in Hub page: the node directory, node detail,
 * account, and the enrollment wizard.
 *
 * The bar is a sibling of the scroll track rather than a `sticky` child of it,
 * so it holds its place without participating in the page's scrolling and the
 * track keeps a clean `overscroll-contain` scroller. `#root` is
 * `overflow-y: hidden`, so this element owns the viewport height and the
 * `<main>` inside it owns the scroll.
 *
 * The toast hosts live here, at the top of the signed-in tree. They are
 * deliberately absent from the signed-out gateway: an authentication error must
 * be inline and next to the control that produced it, and a toast queued
 * against no host never renders.
 */
export function HubShell({
  children,
  nav,
  trailing,
  scrollRef,
  measure = "page",
}: {
  readonly children: ReactNode;
  readonly nav?: ReactNode;
  readonly trailing?: ReactNode;
  readonly scrollRef?: RefObject<HTMLElement | null>;
  readonly measure?: HubMeasure;
}) {
  // The Hub bar is a desktop-tier addition. `apps/mobile` is the intended phone
  // experience and `apps/web`'s phone tier is frozen behind a flag, so this
  // must not extend it: on phone the page keeps the full-bleed, single-column
  // track it already had, and the controls the bar would carry stay in the
  // page's own bottom-anchored action group. The fork lives here, once, rather
  // than in every Hub page.
  const isPhoneTier = usePresentationTier() === "phone";

  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <div className="hub-ambient flex h-dvh flex-col text-foreground">
          {isPhoneTier ? null : <HubTopBar nav={nav} trailing={trailing} />}
          <main
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
          >
            {/* A `section`, and a flex column, because the phone tier's
                bottom-anchored action groups resolve their `mt-auto` against
                this element: it is the growing content column, and the entry
                surface suite asserts exactly that (no border, no radius,
                `display: flex`). */}
            <section
              className={cn(
                "mx-auto flex w-full flex-col",
                isPhoneTier ? "min-h-full py-10" : "pt-8 pb-16",
                HUB_EDGE_PADDING_CLASS_NAME,
                HUB_MEASURE_CLASS_NAME[measure],
              )}
            >
              {children}
            </section>
          </main>
        </div>
      </AnchoredToastProvider>
    </ToastProvider>
  );
}
