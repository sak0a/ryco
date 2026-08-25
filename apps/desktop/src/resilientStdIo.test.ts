import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vite-plus/test";

import { createResilientStdIoWriter, type StdIoWrite } from "./resilientStdIo.ts";

class FakeStdIoStream extends EventEmitter {
  destroyed = false;
  writable = true;
}

function codedError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe("createResilientStdIoWriter", () => {
  it("captures output but stops writing to a pipe after an asynchronous EPIPE", async () => {
    const stream = new FakeStdIoStream();
    const originalWrite = vi.fn(() => true) as unknown as StdIoWrite;
    const capture = vi.fn();
    const onUnavailable = vi.fn();
    const writer = createResilientStdIoWriter({ stream, originalWrite, capture, onUnavailable });

    expect(writer.write("before")).toBe(true);
    stream.emit("error", codedError("EPIPE"));

    const callback = vi.fn();
    expect(writer.write("after", callback)).toBe(true);
    await Promise.resolve();

    expect(originalWrite).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(null);
    writer.dispose();
  });

  it("absorbs a synchronous EPIPE and avoids retrying the unavailable stream", () => {
    const stream = new FakeStdIoStream();
    const originalWrite = vi.fn(() => {
      throw codedError("EPIPE");
    }) as unknown as StdIoWrite;
    const onUnavailable = vi.fn();
    const writer = createResilientStdIoWriter({
      stream,
      originalWrite,
      capture: vi.fn(),
      onUnavailable,
    });

    expect(writer.write("first")).toBe(true);
    expect(writer.write("second")).toBe(true);
    expect(originalWrite).toHaveBeenCalledTimes(1);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    writer.dispose();
  });

  it("does not hide synchronous errors unrelated to a closed pipe", () => {
    const stream = new FakeStdIoStream();
    const originalWrite = vi.fn(() => {
      throw codedError("EINVAL");
    }) as unknown as StdIoWrite;
    const writer = createResilientStdIoWriter({
      stream,
      originalWrite,
      capture: vi.fn(),
      onUnavailable: vi.fn(),
    });

    expect(() => writer.write("broken")).toThrow("EINVAL");
    writer.dispose();
  });
});
