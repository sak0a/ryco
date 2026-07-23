import {
  NOOP_OBSERVABILITY,
  type ClockService,
  type FrameSchedulerService,
  type ObservabilityService,
} from "../../platform/index.ts";
import type { EnvironmentId } from "@ryco/contracts";

export interface ThreadsRuntimeConfiguration {
  readonly clock: ClockService;
  readonly frameScheduler: FrameSchedulerService;
  readonly observability: ObservabilityService;
  readonly isHostedHubMode: () => boolean;
  readonly resolveAttachmentPreviewUrl: (input: {
    readonly environmentId: EnvironmentId;
    readonly attachmentId: string;
  }) => string;
}

const defaultConfiguration: ThreadsRuntimeConfiguration = {
  clock: { now: () => Date.now() },
  frameScheduler: { scheduleFrame: (callback) => void Promise.resolve().then(callback) },
  observability: NOOP_OBSERVABILITY,
  isHostedHubMode: () => false,
  resolveAttachmentPreviewUrl: ({ attachmentId }) => attachmentId,
};

let configuration = defaultConfiguration;
let lazyConfigurator: (() => void) | null = null;

/** Registers app wiring without importing platform adapters into runtime code. */
export function setThreadsRuntimeConfigurator(configure: () => void): void {
  lazyConfigurator = configure;
}

export function configureThreadsRuntime(next: ThreadsRuntimeConfiguration): void {
  lazyConfigurator = null;
  configuration = next;
}

export function getThreadsRuntimeConfiguration(): ThreadsRuntimeConfiguration {
  if (lazyConfigurator) {
    const configure = lazyConfigurator;
    lazyConfigurator = null;
    configure();
  }
  return configuration;
}
