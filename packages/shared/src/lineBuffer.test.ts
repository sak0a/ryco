import { describe, it, expect } from "vitest";
import { LineBuffer } from "./lineBuffer.ts";

describe("LineBuffer", () => {
  it("appends chunks and yields complete lines on flush", () => {
    const buf = new LineBuffer({ maxLines: 100 });
    buf.write("hello\nworld\n");
    expect(buf.snapshot()).toEqual(["hello", "world"]);
  });

  it("retains incomplete trailing fragment until flush", () => {
    const buf = new LineBuffer({ maxLines: 100 });
    buf.write("hello\nwor");
    buf.write("ld\n");
    expect(buf.snapshot()).toEqual(["hello", "world"]);
  });

  it("trims head when maxLines exceeded", () => {
    const buf = new LineBuffer({ maxLines: 2 });
    buf.write("a\nb\nc\nd\n");
    expect(buf.snapshot()).toEqual(["c", "d"]);
  });

  it("clear() empties the buffer", () => {
    const buf = new LineBuffer({ maxLines: 100 });
    buf.write("a\nb\n");
    buf.clear();
    expect(buf.snapshot()).toEqual([]);
  });

  it("snapshot() returns a defensive copy", () => {
    const buf = new LineBuffer({ maxLines: 100 });
    buf.write("a\n");
    const snap = buf.snapshot();
    snap.push("mutation");
    expect(buf.snapshot()).toEqual(["a"]);
  });
});
