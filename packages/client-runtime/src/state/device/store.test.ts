import {
  DeviceUdid,
  EnvironmentId,
  ThreadId,
  type DeviceDescriptor,
  type ThreadDeviceState,
} from "@ryco/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  selectEnvironmentDeviceState,
  selectThreadDeviceState,
  useDeviceStateStore,
} from "./store.ts";

const environmentId = EnvironmentId.make("environment-device-test");
const threadId = ThreadId.make("thread-device-test");
const udid = DeviceUdid.make("DEVICE-0001");
const device: DeviceDescriptor = {
  platform: "ios-simulator",
  udid,
  name: "iPhone 17 Pro",
  runtime: "iOS 26.0",
  state: "booted",
  bootSource: "ryco",
};

function snapshot(version: number, lastError: string | null = null): ThreadDeviceState {
  return {
    threadId,
    version,
    attachedDeviceUdid: udid,
    attachPhase: null,
    devices: [device],
    agentActive: false,
    availability: { kind: "available" },
    lastError,
  };
}

beforeEach(() => {
  useDeviceStateStore.setState({
    environmentById: {},
    threadByKey: {},
    pendingOpenByThreadKey: {},
  });
});

describe("device state generation fencing", () => {
  it("ignores inventory and snapshots from an old connection generation", () => {
    const first = useDeviceStateStore.getState().beginConnection(environmentId);
    const second = useDeviceStateStore.getState().beginConnection(environmentId);

    useDeviceStateStore
      .getState()
      .applyInventory(environmentId, first, [device], { kind: "available" });
    useDeviceStateStore.getState().applyThreadSnapshot(environmentId, first, snapshot(1));

    expect(selectEnvironmentDeviceState(environmentId).status).toBe("connecting");
    expect(selectThreadDeviceState(environmentId, threadId)).toBeNull();

    useDeviceStateStore
      .getState()
      .applyInventory(environmentId, second, [device], { kind: "available" });
    useDeviceStateStore.getState().applyThreadSnapshot(environmentId, second, snapshot(1));

    expect(selectEnvironmentDeviceState(environmentId).status).toBe("connected");
    expect(selectThreadDeviceState(environmentId, threadId)?.version).toBe(1);
  });

  it("only accepts a strictly newer thread version", () => {
    const generation = useDeviceStateStore.getState().beginConnection(environmentId);
    useDeviceStateStore.getState().applyThreadSnapshot(environmentId, generation, snapshot(3));
    useDeviceStateStore
      .getState()
      .applyThreadSnapshot(environmentId, generation, snapshot(3, "same-version replacement"));
    useDeviceStateStore
      .getState()
      .applyThreadSnapshot(environmentId, generation, snapshot(2, "older replacement"));

    expect(selectThreadDeviceState(environmentId, threadId)?.lastError).toBeNull();

    useDeviceStateStore
      .getState()
      .applyThreadSnapshot(environmentId, generation, snapshot(4, "new version"));
    expect(selectThreadDeviceState(environmentId, threadId)?.lastError).toBe("new version");
  });

  it("stores active-thread pane requests once and rejects stale requests", () => {
    const first = useDeviceStateStore.getState().beginConnection(environmentId);
    const second = useDeviceStateStore.getState().beginConnection(environmentId);
    const event = {
      type: "device.open-pane-requested",
      threadId,
      udid,
      reason: "agent-tool",
    } as const;

    useDeviceStateStore.getState().applyEvent(environmentId, first, event);
    expect(useDeviceStateStore.getState().consumeOpenRequest(environmentId, threadId)).toBeNull();

    useDeviceStateStore.getState().applyEvent(environmentId, second, event);
    expect(useDeviceStateStore.getState().consumeOpenRequest(environmentId, threadId)).toEqual(
      event,
    );
    expect(useDeviceStateStore.getState().consumeOpenRequest(environmentId, threadId)).toBeNull();
  });

  it("never reuses a generation after cleanup", () => {
    const first = useDeviceStateStore.getState().beginConnection(environmentId);
    useDeviceStateStore.getState().clearEnvironment(environmentId, first);
    expect(useDeviceStateStore.getState().beginConnection(environmentId)).toBe(first + 1);
  });
});
