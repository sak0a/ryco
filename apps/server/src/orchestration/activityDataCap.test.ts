import { assert, describe, it } from "@effect/vitest";

import { ACTIVITY_DATA_STRING_CAP, capActivityData } from "./activityDataCap.ts";

describe("capActivityData", () => {
  it("returns the same reference when nothing needs truncation", () => {
    const data = { item: { command: "ls", aggregatedOutput: "short output" } };
    assert.equal(capActivityData("command_execution", data), data);
  });

  it("truncates oversized strings to a bounded head and tail", () => {
    const output = `${"h".repeat(12_000)}${"m".repeat(200_000)}${"t".repeat(12_000)}`;
    const data = { item: { command: "cat big-file", aggregatedOutput: output } };
    const capped = capActivityData("command_execution", data) as {
      item: { command: string; aggregatedOutput: string };
    };

    assert.notEqual(capped, data);
    assert.equal(capped.item.command, "cat big-file");
    const cappedOutput = capped.item.aggregatedOutput;
    assert.equal(cappedOutput.length < ACTIVITY_DATA_STRING_CAP + 100, true);
    assert.equal(cappedOutput.startsWith("hhhh"), true);
    assert.equal(cappedOutput.endsWith("tttt"), true);
    assert.equal(cappedOutput.includes("chars truncated"), true);
  });

  it("caps nested strings inside arrays and objects", () => {
    const big = "x".repeat(ACTIVITY_DATA_STRING_CAP + 1);
    const data = { item: { result: { content: [{ text: big }, { text: "small" }] } } };
    const capped = capActivityData("mcp_tool_call", data) as {
      item: { result: { content: Array<{ text: string }> } };
    };

    assert.equal(capped.item.result.content[0]!.text.includes("chars truncated"), true);
    assert.equal(capped.item.result.content[1]!.text, "small");
  });

  it("leaves image_view payloads intact", () => {
    const data = { item: { result: "A".repeat(500_000) } };
    assert.equal(capActivityData("image_view", data), data);
  });

  it("leaves file_change payloads intact", () => {
    const data = { item: { changes: [{ diff: "+".repeat(500_000) }] } };
    assert.equal(capActivityData("file_change", data), data);
  });

  it("handles non-object data", () => {
    assert.equal(capActivityData("command_execution", null), null);
    assert.equal(capActivityData("command_execution", 42), 42);
    const big = "y".repeat(ACTIVITY_DATA_STRING_CAP + 1);
    assert.equal(
      (capActivityData("command_execution", big) as string).includes("chars truncated"),
      true,
    );
  });
});
