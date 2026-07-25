import type * as React from "react";

import { cn } from "~/lib/utils";

/**
 * A term/value description list on the two-column grid this app already uses
 * for bounded record metadata (node enrollment review, node detail).
 *
 * Not a new visual language: it is the grid `HostedNodeEnrollment` hand-rolled,
 * named, with `data-slot`s so layout rules can key off it like every other
 * primitive. The identifier treatment is the part that matters — a fingerprint
 * that wraps one way on one screen and another way on the next is a
 * security-review finding, not a cosmetic one, so `mono` owns the whole
 * mono/`break-all` decision rather than leaving it to each call site.
 *
 * Deliberately not a `Table`: no table primitive exists in this repository, and
 * these are single-record fields rather than rows of a set.
 */
function DataList({ className, ...props }: React.ComponentProps<"dl">) {
  return (
    <dl
      className={cn("grid grid-cols-[auto_1fr] gap-x-4 gap-y-2", className)}
      data-slot="data-list"
      {...props}
    />
  );
}

function DataListItem({
  term,
  children,
  mono = false,
  action,
  className,
}: {
  readonly term: React.ReactNode;
  readonly children: React.ReactNode;
  /** Data compared character by character — ids, versions, fingerprints. */
  readonly mono?: boolean;
  /** A trailing control for the value, e.g. a copy button. */
  readonly action?: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <>
      <dt className="text-xs text-muted-foreground" data-slot="data-list-term">
        {term}
      </dt>
      <dd
        className={cn(
          "flex min-w-0 items-start gap-2 text-sm",
          // The identifier treatment, in one place: a fingerprint or a node id
          // that wraps one way on one screen and another way on the next is a
          // security-review finding, not a cosmetic one.
          mono && "font-mono text-xs break-all",
          className,
        )}
        data-slot="data-list-detail"
      >
        {/* `min-w-0` without `flex-1`, so an action hugs its value instead of
            being flung to the far edge of the column. */}
        <span className="min-w-0">{children}</span>
        {action ? <span className="shrink-0 font-sans text-sm">{action}</span> : null}
      </dd>
    </>
  );
}

export { DataList, DataListItem };
