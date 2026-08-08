import type { ReactNode } from "react";
import { AlertCircleIcon, ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";

export function SourceControlDetailToolbar(props: {
  onBack: () => void;
  githubUrl?: string | undefined;
  githubLabel?: string | undefined;
  children?: ReactNode | undefined;
}) {
  return (
    <div className="flex min-h-12 items-center gap-2 border-border/60 border-b bg-background/55 py-2 pr-14 pl-4">
      <Button type="button" size="sm" variant="ghost" onClick={props.onBack}>
        <ArrowLeftIcon className="size-3.5" />
        Back
      </Button>
      <div className="ml-auto flex items-center gap-1">
        {props.children}
        {props.githubUrl ? (
          <a
            href={props.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-muted-foreground text-xs hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ExternalLinkIcon className="size-3.5" />
            {props.githubLabel ?? "Open on GitHub"}
          </a>
        ) : null}
      </div>
    </div>
  );
}

export function SourceControlDetailLayout(props: {
  children: ReactNode;
  sidebar: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        "grid h-full min-h-0 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_18rem] lg:grid-rows-1 lg:overflow-hidden",
        props.className,
      )}
    >
      <div className="min-w-0 lg:min-h-0 lg:overflow-hidden">{props.children}</div>
      {props.sidebar}
    </div>
  );
}

export function SourceControlDetailLoadingState(props: { label: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="grid h-full min-h-0 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_18rem]"
    >
      <span className="sr-only">Loading {props.label}...</span>
      <div className="flex min-h-0 flex-col">
        <div className="border-border/60 border-b px-5 py-4 lg:px-6">
          <Skeleton className="h-5 w-3/4 rounded-md" />
          <div className="mt-3 flex gap-2">
            <Skeleton className="h-4 w-24 rounded" />
            <Skeleton className="h-4 w-32 rounded" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden bg-muted/8 px-5 py-5 lg:px-6">
          <div className="mx-auto w-full max-w-[960px] space-y-4">
            {[0, 1, 2].map((index) => (
              <div key={index} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
                <Skeleton className="size-8 rounded-lg" />
                <div className="rounded-lg border border-border/60 bg-background/50 p-3">
                  <Skeleton className="h-4 w-40 rounded" />
                  <Skeleton className="mt-3 h-3 w-full rounded" />
                  <Skeleton className="mt-2 h-3 w-5/6 rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <aside
        aria-hidden="true"
        className="hidden border-border/60 border-l bg-muted/12 px-4 py-4 lg:block"
      >
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <Spinner className="size-3.5" />
          Loading {props.label}...
        </div>
      </aside>
    </div>
  );
}

export function SourceControlDetailErrorState(props: { message: string }) {
  return (
    <div className="flex h-full min-h-0 items-start justify-center bg-muted/8 px-5 py-8">
      <div
        role="alert"
        className="flex w-full max-w-2xl items-start gap-3 rounded-lg border border-destructive/25 bg-destructive/6 px-4 py-3 text-destructive text-sm"
      >
        <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
        <p className="min-w-0">{props.message}</p>
      </div>
    </div>
  );
}

export function SourceControlMetricStrip(props: {
  items: ReadonlyArray<{
    label: string;
    value: ReactNode;
    tone?: "default" | "success" | "danger" | "warning" | undefined;
  }>;
  className?: string | undefined;
}) {
  if (props.items.length === 0) return null;
  return (
    <dl className={cn("grid gap-2 sm:grid-cols-2 xl:grid-cols-4", props.className)}>
      {props.items.map((item) => (
        <div
          key={item.label}
          className="min-w-0 rounded-lg border border-border/60 bg-muted/16 px-3 py-2"
        >
          <dt className="text-muted-foreground text-xs">{item.label}</dt>
          <dd className={cn("mt-0.5 truncate font-medium text-sm", metricToneClassName(item.tone))}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function metricToneClassName(tone: "default" | "success" | "danger" | "warning" | undefined) {
  switch (tone) {
    case "success":
      return "text-emerald-700 dark:text-emerald-300";
    case "danger":
      return "text-rose-700 dark:text-rose-300";
    case "warning":
      return "text-amber-700 dark:text-amber-300";
    case "default":
    case undefined:
      return "text-foreground/90";
  }
}
