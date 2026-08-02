import { describe, expect, it } from "vite-plus/test";

import type { ThreadStatusPill } from "../Sidebar.logic";
import {
  resolveSidebarStatusTextClassName,
  resolveThreadStatusTextClassName,
} from "./sidebarStatusText";

function status(label: ThreadStatusPill["label"], pulse: boolean): ThreadStatusPill {
  return { label, pulse, colorClass: "", dotClass: "" };
}

describe("sidebar status text animation", () => {
  it("shimmers only while a status is actively changing", () => {
    expect(resolveSidebarStatusTextClassName("in_progress")).toContain(
      "sidebar-status-text--shimmer",
    );
    expect(resolveThreadStatusTextClassName(status("Working", true))).toContain(
      "sidebar-status-text--shimmer",
    );
    expect(resolveThreadStatusTextClassName(status("Connecting", true))).toContain(
      "sidebar-status-text--shimmer",
    );
  });

  it("keeps stable attention states static", () => {
    expect(resolveSidebarStatusTextClassName("review")).not.toContain(
      "sidebar-status-text--shimmer",
    );

    for (const label of [
      "Awaiting Input",
      "Pending Approval",
      "Plan Ready",
      "Completed",
    ] as const) {
      expect(resolveThreadStatusTextClassName(status(label, false))).not.toContain(
        "sidebar-status-text--shimmer",
      );
    }
  });
});
