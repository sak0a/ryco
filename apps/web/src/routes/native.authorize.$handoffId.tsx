import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { AppBootLoadingSurface } from "../components/AppBootLoadingSurface";

const LazyHostedNativeAuthorizationRoute = lazy(() =>
  import("../components/hostedHub/HostedNativeAuthorizationRoute").then((module) => ({
    default: module.HostedNativeAuthorizationRoute,
  })),
);

export const Route = createFileRoute("/native/authorize/$handoffId")({
  component: NativeAuthorizationRouteView,
});

function NativeAuthorizationRouteView() {
  const { handoffId } = Route.useParams();
  return (
    <Suspense fallback={<AppBootLoadingSurface />}>
      <LazyHostedNativeAuthorizationRoute handoffId={handoffId} />
    </Suspense>
  );
}
