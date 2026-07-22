// Production CSS is part of the behavior under test: the phone tier variants
// drive the app bar's density.
import "../../../index.css";

import { EnvironmentId, type ThreadId } from "@ryco/contracts";
import { page } from "vite-plus/test/browser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

const navigate = vi.fn(async () => undefined);
const routerStub = { navigate, state: { matches: [] } };
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
  useRouter: () => routerStub,
}));

vi.mock("../../../lib/gitStatusState", () => ({
  useGitStatus: () => ({ data: null, error: null, cause: null, isPending: false }),
  useGitStatuses: () => new Map(),
  refreshGitStatus: () => Promise.resolve(null),
  resetGitStatusStateForTests: () => undefined,
}));

import { syncDocumentPresentationTier } from "../../../lib/presentationTier";
import { SidebarProvider } from "../../ui/sidebar";
import { PhoneThreadAppBar } from "./PhoneThreadAppBar";

const ENV_ID = EnvironmentId.make("environment-local");
const THREAD_ID = "thread-draft-1" as ThreadId;

let mounted: Awaited<ReturnType<typeof render>> | null = null;

describe("PhoneThreadAppBar", () => {
  beforeAll(() => {
    syncDocumentPresentationTier();
  });

  beforeEach(async () => {
    await page.viewport(390, 844);
    localStorage.clear();
    navigate.mockClear();
  });

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    await page.viewport(1_280, 720);
  });

  it("reduces to back, title, and the connection indicator", async () => {
    mounted = await render(
      <SidebarProvider>
        <PhoneThreadAppBar environmentId={ENV_ID} threadId={THREAD_ID} title="Empty Session" />
      </SidebarProvider>,
    );

    await expect.element(page.getByRole("button", { name: "Back to threads" })).toBeVisible();
    await expect.element(page.getByText("Empty Session")).toBeVisible();

    // The two controls the audit found in the top-right corner are gone from
    // the bar. They live in `PhoneThreadDock` at the bottom of the screen now,
    // which is what `PhoneThreadDock.browser.tsx` asserts.
    expect(document.querySelector('button[aria-label="Toggle workspace panel"]')).toBeNull();
    expect(document.querySelector('button[aria-label="Thread actions"]')).toBeNull();

    // Back is top-anchored chrome by design, and stays a 44px target.
    const back = page.getByRole("button", { name: "Back to threads" }).element() as HTMLElement;
    const rect = back.getBoundingClientRect();
    expect(Math.min(rect.width, rect.height)).toBeGreaterThan(0);
    back.click();
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: "/" }));
  });
});
