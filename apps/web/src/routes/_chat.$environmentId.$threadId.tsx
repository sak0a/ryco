import { createFileRoute, retainSearchParams } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { parseRightPanelRouteSearch, type RightPanelRouteSearch } from "../rightPanelRouteSearch";
import { resolveThreadRouteRef } from "../threadRoutes";

const LazyChatThreadRouteView = lazy(() =>
  import("../components/routeViews/ChatThreadRouteView").then((module) => ({
    default: module.ChatThreadRouteView,
  })),
);

function ChatThreadRouteLazyView() {
  const threadRef = Route.useParams({
    select: (params) => resolveThreadRouteRef(params),
  });
  const search = Route.useSearch();

  return (
    <Suspense fallback={null}>
      <LazyChatThreadRouteView threadRef={threadRef} search={search} />
    </Suspense>
  );
}

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  validateSearch: (search) => parseRightPanelRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<RightPanelRouteSearch>(["diff", "preview"])],
  },
  component: ChatThreadRouteLazyView,
});
