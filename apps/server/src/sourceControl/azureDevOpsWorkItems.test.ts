import { describe, expect, it } from "vitest";
import { Result } from "effect";
import {
  decodeAzureDevOpsWorkItemDetailJson,
  decodeAzureDevOpsWorkItemListJson,
} from "./azureDevOpsWorkItems.ts";

describe("decodeAzureDevOpsWorkItemListJson", () => {
  it("decodes work-item list with state normalization", () => {
    const raw = JSON.stringify([
      {
        id: 42,
        fields: {
          "System.Title": "Bug",
          "System.State": "Active",
          "System.Tags": "frontend; bug",
          "System.ChangedDate": "2026-03-14T10:00:00Z",
          "System.CreatedBy": { uniqueName: "alice@example.com" },
        },
        url: "https://dev.azure.com/org/proj/_apis/wit/workItems/42",
      },
    ]);
    const result = decodeAzureDevOpsWorkItemListJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success[0]?.number).toBe(42);
    expect(result.success[0]?.title).toBe("Bug");
    expect(result.success[0]?.state).toBe("open");
    expect(result.success[0]?.author).toBe("alice@example.com");
    expect(result.success[0]?.labels).toEqual(["frontend", "bug"]);
  });

  it("treats Closed/Resolved/Removed as 'closed'", () => {
    const raw = JSON.stringify([
      {
        id: 7,
        fields: { "System.Title": "Done", "System.State": "Closed" },
      },
    ]);
    const result = decodeAzureDevOpsWorkItemListJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success[0]?.state).toBe("closed");
  });
});

describe("decodeAzureDevOpsWorkItemDetailJson", () => {
  it("strips HTML tags from description into body", () => {
    const raw = JSON.stringify({
      id: 42,
      fields: {
        "System.Title": "Detailed",
        "System.State": "Active",
        "System.Description": "<p>issue body</p>",
      },
    });
    const result = decodeAzureDevOpsWorkItemDetailJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success.body.trim()).toBe("issue body");
  });
});
