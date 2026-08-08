import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { parseRightPanelRouteSearch } from "../rightPanelRouteSearch";

const LazyDraftChatThreadRouteView = lazy(() =>
  import("../components/routeViews/DraftChatThreadRouteView").then((module) => ({
    default: module.DraftChatThreadRouteView,
  })),
);

function DraftChatThreadRouteLazyView() {
  const { draftId } = Route.useParams();
  const search = Route.useSearch();

  return (
    <Suspense fallback={null}>
      <LazyDraftChatThreadRouteView rawDraftId={draftId} search={search} />
    </Suspense>
  );
}

export const Route = createFileRoute("/_chat/draft/$draftId")({
  validateSearch: (search) => parseRightPanelRouteSearch(search),
  component: DraftChatThreadRouteLazyView,
});
