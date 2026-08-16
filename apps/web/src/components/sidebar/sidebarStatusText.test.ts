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
  it("flows continuously while a status is actively changing", () => {
    expect(resolveSidebarStatusTextClassName("in_progress")).toContain("sidebar-status-text--flow");
    for (const label of ["Working", "Connecting", "Monitoring"] as const) {
      expect(resolveThreadStatusTextClassName(status(label, true))).toContain(
        "sidebar-status-text--flow",
      );
    }
  });

  it("keeps stable attention states static", () => {
    expect(resolveSidebarStatusTextClassName("review")).not.toContain("sidebar-status-text--flow");

    for (const label of [
      "Awaiting Input",
      "Pending Approval",
      "Plan Ready",
      "Completed",
    ] as const) {
      expect(resolveThreadStatusTextClassName(status(label, false))).not.toContain(
        "sidebar-status-text--flow",
      );
    }
  });
});
