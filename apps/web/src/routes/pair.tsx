import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { AppBootLoadingSurface } from "../components/AppBootLoadingSurface";

const LazyHostedPairingRouteSurface = lazy(() =>
  import("../components/auth/PairingRouteSurface").then((module) => ({
    default: module.HostedPairingRouteSurface,
  })),
);
const LazyPairingRouteSurface = lazy(() =>
  import("../components/auth/PairingRouteSurface").then((module) => ({
    default: module.PairingRouteSurface,
  })),
);

export const Route = createFileRoute("/pair")({
  beforeLoad: async ({ context }) => {
    const { authGateState } = context;
    if (authGateState.status === "hosted-pairing") {
      return {
        authGateState,
      };
    }

    if (
      authGateState.status === "authenticated" ||
      authGateState.status === "hosted-static" ||
      authGateState.status === "hosted-hub"
    ) {
      throw redirect({ to: "/", replace: true });
    }
    return {
      authGateState,
    };
  },
  component: PairRouteView,
  pendingComponent: PairRoutePendingView,
});

function PairRouteView() {
  const { authGateState } = Route.useRouteContext();
  const navigate = useNavigate();

  if (!authGateState) {
    return null;
  }

  if (authGateState.status === "hosted-pairing") {
    return (
      <Suspense fallback={<AppBootLoadingSurface />}>
        <LazyHostedPairingRouteSurface />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<AppBootLoadingSurface />}>
      <LazyPairingRouteSurface
        auth={authGateState.auth}
        onAuthenticated={() => {
          void navigate({ to: "/", replace: true });
        }}
        {...(authGateState.errorMessage ? { initialErrorMessage: authGateState.errorMessage } : {})}
      />
    </Suspense>
  );
}

function PairRoutePendingView() {
  return <AppBootLoadingSurface />;
}
