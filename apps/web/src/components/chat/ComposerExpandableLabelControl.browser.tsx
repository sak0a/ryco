import "../../index.css";

import { afterEach, describe, expect, it } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { ComposerExpandableLabelControl } from "./ComposerExpandableLabelControl";

describe("ComposerExpandableLabelControl", () => {
  let mounted:
    | (Awaited<ReturnType<typeof render>> & {
        cleanup?: () => Promise<void>;
        unmount?: () => Promise<void>;
      })
    | null = null;

  afterEach(async () => {
    if (mounted) {
      const teardown = mounted.cleanup ?? mounted.unmount;
      await teardown?.call(mounted).catch(() => {});
    }
    mounted = null;
    document.body.innerHTML = "";
  });

  it("keeps collapsed labels in the DOM with hover, focus, and open-state expansion hooks", async () => {
    mounted = await render(
      <button type="button" className="group/composer-label-control">
        <ComposerExpandableLabelControl
          collapsed
          icon={<span aria-hidden="true">I</span>}
          label="Full access"
        />
      </button>,
    );

    const control = document.querySelector('[data-composer-expandable-label-control="true"]');
    const label = document.querySelector('[data-composer-expandable-label="true"]');

    expect(control?.getAttribute("data-collapsed")).toBe("true");
    expect(label?.textContent).toBe("Full access");
    expect(label?.className).toContain("max-w-0");
    expect(label?.className).toContain("group-hover/composer-label-control:max-w-40");
    expect(label?.className).toContain("group-focus-visible/composer-label-control:max-w-40");
    expect(label?.className).toContain("group-focus-within/composer-label-control:max-w-40");
    expect(label?.className).toContain("group-data-[pressed]/composer-label-control:max-w-40");
  });
});
