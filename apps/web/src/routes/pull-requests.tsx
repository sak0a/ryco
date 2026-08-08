import { createFileRoute, redirect } from "@tanstack/react-router";

import { PullRequestsPage } from "~/components/pullRequests/PullRequestsPage";
import { SidebarInset } from "~/components/ui/sidebar";
import { parsePullRequestRouteSearch } from "~/pullRequestRouteSearch";

function PullRequestsRouteView() {
  const search = Route.useSearch();
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <PullRequestsPage search={search} />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/pull-requests")({
  validateSearch: (search) => parsePullRequestRouteSearch(search),
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static" &&
      context.authGateState.status !== "hosted-hub"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: PullRequestsRouteView,
});
