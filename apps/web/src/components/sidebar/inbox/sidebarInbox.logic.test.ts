import { describe, expect, it } from "vite-plus/test";

import type { ThreadInboxEntry } from "@ryco/client-runtime/state/threads";
import {
  entryActionDisabledReason,
  INBOX_VIRTUALIZATION_THRESHOLD,
  SETTLED_PAGE_SIZE,
  shouldVirtualizeInbox,
  visibleSettledEntries,
} from "./sidebarInbox.logic";

describe("sidebar Inbox presentation logic", () => {
  it("pages settled entries in stable batches", () => {
    const entries = Array.from({ length: 45 }, (_, index) => ({
      key: String(index),
    })) as ThreadInboxEntry[];
    expect(visibleSettledEntries(entries, SETTLED_PAGE_SIZE)).toHaveLength(20);
    expect(visibleSettledEntries(entries, SETTLED_PAGE_SIZE * 2)).toHaveLength(40);
    expect(visibleSettledEntries(entries, SETTLED_PAGE_SIZE * 3)).toHaveLength(45);
  });

  it("prioritizes environment safety over lifecycle eligibility", () => {
    const entry = {
      mutationBlocker: "shell-stale",
      lifecycle: {
        classification: "active",
        eligibility: { canSettle: false, blocker: "pending-approval" },
      },
    } as ThreadInboxEntry;
    expect(entryActionDisabledReason(entry)).toContain("latest thread list");
  });

  it("virtualizes only after the bounded density threshold", () => {
    expect(shouldVirtualizeInbox(INBOX_VIRTUALIZATION_THRESHOLD)).toBe(false);
    expect(shouldVirtualizeInbox(INBOX_VIRTUALIZATION_THRESHOLD + 1)).toBe(true);
  });
});
