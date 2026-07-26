import { createFileRoute } from "@tanstack/react-router";

import { HostedNativeAuthorizationRoute } from "../components/hostedHub/HostedNativeAuthorizationRoute";

export const Route = createFileRoute("/native/authorize/$handoffId")({
  component: NativeAuthorizationRouteView,
});

function NativeAuthorizationRouteView() {
  const { handoffId } = Route.useParams();
  return <HostedNativeAuthorizationRoute handoffId={handoffId} />;
}
