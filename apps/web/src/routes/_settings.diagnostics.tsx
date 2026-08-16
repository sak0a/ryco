import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { lazy, Suspense } from "react";

import { HostedConnectionControl } from "../components/hostedHub/HostedConnectionControls";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import { SidebarInset } from "../components/ui/sidebar";
import { APP_DISPLAY_NAME } from "~/branding";

const LazyDiagnosticsSettings = lazy(() =>
  import("../components/settings/DiagnosticsSettings").then((module) => ({
    default: module.DiagnosticsSettings,
  })),
);

function DiagnosticsRouteView() {
  const router = useRouter();

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <header className="flex items-center gap-2 border-b border-border px-3 py-2 sm:px-5 sm:py-3 phone:pt-[calc(env(safe-area-inset-top)+0.5rem)] phone:pl-[calc(env(safe-area-inset-left)+0.75rem)] phone:pr-[calc(env(safe-area-inset-right)+0.75rem)]">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              if (router.history.canGoBack()) {
                router.history.back();
                return;
              }
              void router.navigate({ to: "/" });
            }}
          >
            <ArrowLeftIcon className="size-3.5" />
            Back
          </Button>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {APP_DISPLAY_NAME} · Diagnostics
          </span>
          {/* The connection controls used to float over every routed surface;
              with the overlay removed, hosted users keep status, switching,
              and sign-out reachable from this header. Renders nothing outside
              hosted-hub sessions. */}
          <HostedConnectionControl />
        </header>

        <ScrollArea className="min-h-0 flex-1">
          <Suspense fallback={null}>
            <LazyDiagnosticsSettings />
          </Suspense>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_settings/diagnostics")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: DiagnosticsRouteView,
});
