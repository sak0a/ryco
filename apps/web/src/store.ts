import {
  configureThreadsRuntime,
  setThreadsRuntimeConfigurator,
} from "@ryco/client-runtime/state/threads";

import { resolveEnvironmentHttpUrl } from "./environments/runtime";
import { isHostedHubMode } from "./env";
import { webClock, webFrameScheduler, webObservability } from "./platform";

setThreadsRuntimeConfigurator(() => {
  configureThreadsRuntime({
    clock: { now: () => webClock.now() },
    frameScheduler: { scheduleFrame: (callback) => webFrameScheduler.scheduleFrame(callback) },
    observability: webObservability,
    isHostedHubMode: () => isHostedHubMode(),
    resolveAttachmentPreviewUrl: ({ environmentId, attachmentId }) =>
      resolveEnvironmentHttpUrl({
        environmentId,
        pathname: `/attachments/${encodeURIComponent(attachmentId)}`,
      }),
  });
});

export * from "@ryco/client-runtime/state/threads";
