import type { HostedNativeDeviceSecurityStatus } from "@ryco/client-runtime/authorization";
import { useSyncExternalStore } from "react";

import {
  getMobileNativeE2eeEnrollmentState,
  subscribeMobileNativeE2eeEnrollment,
} from "../../hostedHub/e2eeEnrollment";

export function useMobileNativeE2eeEnrollmentStatus(): HostedNativeDeviceSecurityStatus {
  const state = useSyncExternalStore(
    subscribeMobileNativeE2eeEnrollment,
    getMobileNativeE2eeEnrollmentState,
    getMobileNativeE2eeEnrollmentState,
  );
  switch (state.status) {
    case "ready":
    case "idle":
      return "ready";
    case "revoked":
      return "revoked";
    case "unavailable":
      return "unavailable";
    case "securing":
    case "retrying":
      return "securing";
  }
}
