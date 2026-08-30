import "../../index.css";

import { page } from "vite-plus/test/browser";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { AutoSettleSettingsSection } from "./AiFocusSettings";

describe("AutoSettleSettingsSection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("starts Off, explains the safeguards, and offers every supported preset", async () => {
    const onChange = vi.fn();
    await render(<AutoSettleSettingsSection value={null} onChange={onChange} />);

    await expect
      .element(page.getByText("Auto-settle inactive tasks", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(page.getByText(/Running work, queued messages, pending input, open pull requests/))
      .toBeInTheDocument();

    await page.getByLabelText("Auto-settle inactive tasks").click();
    for (const label of [
      "Off",
      "After 1 day",
      "After 3 days",
      "After 7 days",
      "After 14 days",
      "After 30 days",
      "After 90 days",
    ]) {
      await expect.element(page.getByText(label, { exact: true }).last()).toBeInTheDocument();
    }

    await page.getByText("After 14 days", { exact: true }).last().click();
    expect(onChange).toHaveBeenCalledWith(14);
  });
});
