import { createFileRoute, redirect } from "@tanstack/react-router";

import { StatisticsPage } from "../components/statistics/StatisticsPage";
import {
  parseStatisticsSearch,
  type StatisticsSearch,
} from "../components/statistics/statisticsSearch";
import { getPresentationTier } from "../lib/presentationTier";

function StatisticsRouteView() {
  // The generated file-route registration validates this shape at runtime.
  // The assertion breaks the component/Route declaration inference cycle.
  const search = Route.useSearch() as StatisticsSearch;
  const navigate = Route.useNavigate();
  return (
    <StatisticsPage
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
    />
  );
}

export const Route = createFileRoute("/statistics")({
  beforeLoad: ({ context }) => {
    if (getPresentationTier() === "phone") {
      throw redirect({ to: "/", replace: true });
    }
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static" &&
      context.authGateState.status !== "hosted-hub"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  validateSearch: (search) => parseStatisticsSearch(search),
  component: StatisticsRouteView,
});
