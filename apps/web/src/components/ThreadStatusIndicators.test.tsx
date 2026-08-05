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
  it("keeps the low-duty-cycle pulse on active working and connecting indicators", () => {
    for (const label of ["Working", "Connecting"] as const) {
      const markup = renderToStaticMarkup(<ThreadStatusLabel status={status(label, true)} />);

      expect(markup).toContain("animate-status-pulse");
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

      expect(markup).not.toContain("animate-status-");
      expect(markup).not.toContain("animate-pulse");
      expect(markup).not.toContain("animate-ping");
    }
  });
});
