import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { ThreadStatusPill } from "./Sidebar.logic";
import { ThreadStatusLabel } from "./ThreadStatusIndicators";

function status(label: ThreadStatusPill["label"], pulse: boolean): ThreadStatusPill {
  return {
    label,
    pulse,
    colorClass: "text-current",
    dotClass: "bg-current",
  };
}

describe("ThreadStatusLabel status animation", () => {
  it("keeps a stable core and continuous halo on active indicators", () => {
    for (const label of ["Working", "Connecting", "Monitoring"] as const) {
      const markup = renderToStaticMarkup(<ThreadStatusLabel status={status(label, true)} />);

      expect(markup).toContain("status-activity-signal");
      expect(markup).toContain("bg-current");
      expect(markup).not.toContain("animate-status-pulse");
      expect(markup).not.toContain("animate-pulse");
    }
  });

  it("keeps stable thread indicators free of animation classes", () => {
    for (const label of [
      "Completed",
      "Pending Approval",
      "Awaiting Input",
      "Plan Ready",
    ] as const) {
      const markup = renderToStaticMarkup(<ThreadStatusLabel status={status(label, false)} />);

      expect(markup).not.toContain("status-activity-signal");
      expect(markup).not.toContain("animate-status-");
      expect(markup).not.toContain("animate-pulse");
      expect(markup).not.toContain("animate-ping");
    }
  });
});
