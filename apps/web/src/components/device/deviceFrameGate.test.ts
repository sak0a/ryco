import { describe, expect, it } from "vitest";

import {
  canvasPointToDevicePoint,
  createDeviceFrameGateState,
  deviceHidUsageForKey,
  stepDeviceFrameGate,
} from "./deviceFrameGate";

const DEVICE = "00000000-0000-0000-0000-000000000001";

describe("device frame gate", () => {
  it("waits for config and a keyframe", () => {
    let state = createDeviceFrameGateState();
    const delta = stepDeviceFrameGate(
      state,
      { deviceId: DEVICE, sequence: 1, keyframe: false, codecConfig: false },
      DEVICE,
    );
    expect(delta.action.kind).toBe("drop");

    const configured = stepDeviceFrameGate(
      delta.state,
      { deviceId: DEVICE, sequence: 2, keyframe: false, codecConfig: true },
      DEVICE,
    );
    state = configured.state;
    expect(configured.action.kind).toBe("configure");

    const keyframe = stepDeviceFrameGate(
      state,
      { deviceId: DEVICE, sequence: 3, keyframe: true, codecConfig: false },
      DEVICE,
    );
    expect(keyframe.action).toEqual({ kind: "decode", keyframe: true });
    expect(keyframe.state.phase).toBe("streaming");
  });

  it("requests a keyframe after a mid-GOP sequence gap", () => {
    let state = stepDeviceFrameGate(
      createDeviceFrameGateState(),
      { deviceId: DEVICE, sequence: 8, keyframe: false, codecConfig: true },
      DEVICE,
    ).state;
    state = stepDeviceFrameGate(
      state,
      { deviceId: DEVICE, sequence: 9, keyframe: true, codecConfig: false },
      DEVICE,
    ).state;
    const gap = stepDeviceFrameGate(
      state,
      { deviceId: DEVICE, sequence: 11, keyframe: false, codecConfig: false },
      DEVICE,
    );
    expect(gap.requestKeyframe).toBe(true);
    expect(gap.state.phase).toBe("awaiting-keyframe");
  });
});

describe("simulator input mapping", () => {
  it("maps Retina pixels and letterboxing to device points", () => {
    expect(
      canvasPointToDevicePoint(
        {
          frameWidth: 1_206,
          frameHeight: 2_622,
          displayWidth: 460,
          displayHeight: 874,
          pointWidth: 402,
          pointHeight: 874,
        },
        230,
        437,
      ),
    ).toEqual({ x: 201, y: 437 });
    expect(
      canvasPointToDevicePoint(
        {
          frameWidth: 1_206,
          frameHeight: 2_622,
          displayWidth: 600,
          displayHeight: 874,
          pointWidth: 402,
          pointHeight: 874,
        },
        10,
        437,
      ),
    ).toBeNull();
  });

  it("maps common keyboard keys to HID usage codes", () => {
    expect(deviceHidUsageForKey("a")).toBe(0x04);
    expect(deviceHidUsageForKey("0")).toBe(0x27);
    expect(deviceHidUsageForKey("Enter")).toBe(0x28);
    expect(deviceHidUsageForKey("F12")).toBeNull();
  });
});
