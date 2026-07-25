// The node directory's new surface area: the details affordance, the metadata
// sheet, the empty state, and account settings being reachable at all before a
// node is selected.
//
// What is pinned here is behaviour a user depends on rather than markup:
//
//   * the details control stays operable in exactly the states where connecting
//     does not — a revoked node, a stale directory — because that is the whole
//     reason it exists;
//   * the two nullable timestamps render their own null meaning, asserted
//     separately, because swapping them prints a false negative about a live
//     machine;
//   * exactly one enroll control exists, and none at all for an account that
//     cannot enroll;
//   * account settings is mounted on the directory, and mounted exactly once.
import "../../index.css";

import { EnvironmentId } from "@ryco/contracts";
import { page } from "vite-plus/test/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

const navigate = vi.fn(async () => undefined);
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
  useParams: () => undefined,
}));

import { syncDocumentPresentationTier } from "../../lib/presentationTier";
import { hostedHubController, useHostedHubStore } from "../../hostedHub/state";
import { useSettingsDialogStore } from "../../settingsDialogStore";
import type { HostedHubNode } from "../../hostedHub/types";
import { HostedHubRoot } from "./HostedHubRoot";

const account = {
  id: "acct_aaaaaaaaaaaaaaaaaaaaaa",
  displayName: "Ada",
  role: "owner" as const,
  createdAt: 1,
  disabledAt: null,
};
const session = {
  id: "sess_aaaaaaaaaaaaaaaaaaaaaaa".slice(0, 27),
  accountId: account.id,
  createdAt: 1,
  expiresAt: 2,
  lastSeenAt: 1,
  revokedAt: null,
  revocationReasonCode: null,
};

const NOW = Date.now();

function node(overrides: Partial<HostedHubNode> = {}): HostedHubNode {
  return {
    id: "node_aaaaaaaaaaaaaaaaaaaaaa",
    environmentId: EnvironmentId.make(`env_${"a".repeat(22)}`),
    label: "Studio",
    platformOs: "darwin",
    platformArch: "arm64",
    clientVersion: "0.9.7",
    createdAt: NOW - 10_000_000,
    updatedAt: NOW - 1_000,
    lastAuthenticatedAt: NOW - 3_600_000,
    revokedAt: null,
    revocationReasonCode: null,
    grant: { id: "grant_aaaaaaaaaaaaaaaaaaaaaa", role: "operator" },
    effectiveRole: "operator",
    presence: { online: true, lastHeartbeatAt: NOW - 5_000 },
    ...overrides,
  };
}

function seedDirectory(nodes: ReadonlyArray<HostedHubNode>, overrides: object = {}): void {
  useHostedHubStore.setState({
    accountStatus: "authenticated",
    account,
    session,
    directoryStatus: "ready",
    browserStatus: "current",
    nodes: [...nodes],
    ...overrides,
  });
}

syncDocumentPresentationTier();

let mounted: Awaited<ReturnType<typeof render>> | null = null;

beforeEach(async () => {
  // Desktop by default: the tier fork decides which account entry point and
  // which settings presentation exist, so it must be asserted rather than
  // inherited from whatever size the harness iframe happens to be.
  await page.viewport(1_280, 720);
  await vi.waitFor(() => {
    expect(document.documentElement.getAttribute("data-tier")).toBe("desktop");
  });
  localStorage.clear();
  sessionStorage.clear();
  hostedHubController.resetForTests();
  useSettingsDialogStore.setState({ open: false, section: "general" });
  navigate.mockClear();
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  hostedHubController.resetForTests();
  useSettingsDialogStore.setState({ open: false, section: "general" });
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("hosted node directory", () => {
  it("keeps node details reachable in exactly the states where connecting is not", async () => {
    // The metadata is needed *most* when the row will not connect: a revoked
    // grant and a stale directory are the two states whose explanation lives
    // behind this control. Disabling it would hide the explanation behind the
    // symptom.
    seedDirectory([node({ revokedAt: NOW, revocationReasonCode: "administrative" })], {
      directoryStatus: "stale",
    });
    mounted = await render(<HostedHubRoot />);

    await expect.element(page.getByRole("button", { name: /Studio/ })).toBeDisabled();
    const details = page.getByRole("button", { name: "Node details" });
    await expect.element(details).toBeEnabled();

    await details.click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-slot="sheet-popup"]')).not.toBeNull();
    });
    // And it says why connecting is unavailable, in the words the connection
    // sheet already uses, rather than inventing a second vocabulary.
    await expect.element(page.getByText("Access to this node was revoked.")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Connect" })).toBeDisabled();
  });

  it("names the details control after the action and the node after the description", async () => {
    // A per-node name like "Details for Studio" would make every label query in
    // the directory ambiguous — the fixture labels contain the presence words —
    // and it reads worse: the name is the action, the object is the description.
    seedDirectory([node()]);
    mounted = await render(<HostedHubRoot />);

    const details = document.querySelector<HTMLElement>('button[aria-label="Node details"]');
    expect(details).not.toBeNull();
    const describedBy = details!.getAttribute("aria-describedby");
    expect(describedBy, "node identity must reach the reader as a description").not.toBeNull();
    expect(document.getElementById(describedBy!)?.textContent).toBe("Studio");

    // The connect control remains the unique match for the node's own label.
    await expect.element(page.getByRole("button", { name: /^Studio/ })).toBeVisible();
  });

  it("renders each nullable timestamp with its own meaning", async () => {
    // Asserted separately on purpose. `lastAuthenticatedAt === null` genuinely
    // means the node has never authenticated. `lastHeartbeatAt === null` does
    // NOT mean it never sent a heartbeat — the contract permits null while the
    // node is online — so rendering "Never" there is a false negative about a
    // machine that is up.
    seedDirectory([
      node({
        presence: { online: true, lastHeartbeatAt: null },
        lastAuthenticatedAt: null,
      }),
    ]);
    mounted = await render(<HostedHubRoot />);
    await page.getByRole("button", { name: "Node details" }).click();

    await expect.element(page.getByText("Not reported")).toBeVisible();
    await expect.element(page.getByText("Never", { exact: true })).toBeVisible();
  });

  it("does not render the heartbeat's null as 'Never'", async () => {
    seedDirectory([
      node({
        presence: { online: true, lastHeartbeatAt: null },
        lastAuthenticatedAt: NOW - 3_600_000,
      }),
    ]);
    mounted = await render(<HostedHubRoot />);
    await page.getByRole("button", { name: "Node details" }).click();

    await expect.element(page.getByText("Not reported")).toBeVisible();
    await expect.element(page.getByText("Never", { exact: true })).not.toBeInTheDocument();
  });

  it("surfaces the node metadata the directory row cannot carry", async () => {
    seedDirectory([node()]);
    mounted = await render(<HostedHubRoot />);

    // The client version renders nowhere in the directory today, and it is the
    // only diagnostic for an `incompatible` selection.
    await expect.element(page.getByText("0.9.7")).not.toBeInTheDocument();
    await page.getByRole("button", { name: "Node details" }).click();
    await expect.element(page.getByText("0.9.7")).toBeVisible();
    await expect.element(page.getByText("node_aaaaaaaaaaaaaaaaaaaaaa")).toBeVisible();
  });

  it("reports a grant role only when it differs from the role in effect", async () => {
    seedDirectory([node({ grant: { id: "grant_a", role: "owner" }, effectiveRole: "operator" })]);
    mounted = await render(<HostedHubRoot />);
    await page.getByRole("button", { name: "Node details" }).click();
    await expect.element(page.getByText("Granted role")).toBeVisible();

    await mounted.unmount();
    mounted = null;
    hostedHubController.resetForTests();
    seedDirectory([
      node({ grant: { id: "grant_a", role: "operator" }, effectiveRole: "operator" }),
    ]);
    mounted = await render(<HostedHubRoot />);
    await page.getByRole("button", { name: "Node details" }).click();
    await expect.element(page.getByText("Your role")).toBeVisible();
    await expect.element(page.getByText("Granted role")).not.toBeInTheDocument();
  });

  it("offers an owner exactly one enroll control when no node exists", async () => {
    seedDirectory([]);
    mounted = await render(<HostedHubRoot />);

    await expect.element(page.getByText("No nodes yet")).toBeVisible();
    const enroll = [...document.querySelectorAll<HTMLElement>("button")].filter(
      (button) => button.textContent?.trim() === "Enroll node",
    );
    expect(enroll, "the empty state and the action group must not both offer it").toHaveLength(1);
  });

  it("offers a non-owner no enroll control at all, not even a disabled one", async () => {
    // A greyed control implies the capability is coming. It is not: the client
    // has no node write endpoints beyond enrollment approval, and enrollment is
    // owner-only.
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      account: { ...account, role: "operator" },
      session,
      directoryStatus: "ready",
      browserStatus: "current",
      nodes: [],
    });
    mounted = await render(<HostedHubRoot />);

    await expect.element(page.getByText("No nodes yet")).toBeVisible();
    expect(
      [...document.querySelectorAll<HTMLElement>("button")].filter((button) =>
        button.textContent?.includes("Enroll"),
      ),
    ).toHaveLength(0);
  });

  it("orders the list revoked-last and does not reorder it when presence changes", async () => {
    // Presence is polled every 20 seconds and pauses with tab visibility, so a
    // presence sort reorders the list under the user's pointer on a cadence
    // they cannot predict.
    seedDirectory([
      node({ id: "node_b", label: "Bravo", presence: { online: false, lastHeartbeatAt: null } }),
      node({ id: "node_a", label: "Alpha", revokedAt: NOW }),
      node({ id: "node_c", label: "Charlie" }),
    ]);
    mounted = await render(<HostedHubRoot />);

    const labels = () =>
      [...document.querySelectorAll<HTMLElement>("li button[aria-describedby]")].map(
        (button) => document.getElementById(button.getAttribute("aria-describedby")!)?.textContent,
      );
    await vi.waitFor(() => {
      expect(labels()).toEqual(["Bravo", "Charlie", "Alpha"]);
    });

    useHostedHubStore.setState({
      nodes: [
        node({ id: "node_b", label: "Bravo", presence: { online: true, lastHeartbeatAt: NOW } }),
        node({ id: "node_a", label: "Alpha", revokedAt: NOW }),
        node({
          id: "node_c",
          label: "Charlie",
          presence: { online: false, lastHeartbeatAt: null },
        }),
      ],
    });
    await vi.waitFor(() => {
      expect(document.querySelectorAll("li button[aria-describedby]")).toHaveLength(3);
    });
    expect(labels(), "presence must not be a sort key").toEqual(["Bravo", "Charlie", "Alpha"]);
  });

  it("states the presence poll interval rather than animating a live indicator", async () => {
    // An "Online" pill can be twenty seconds stale, and longer while the tab is
    // backgrounded. Saying so costs one line; a pulsing dot would claim the
    // opposite.
    seedDirectory([node()]);
    mounted = await render(<HostedHubRoot />);
    await expect.element(page.getByText(/Presence refreshes about every 20 seconds/)).toBeVisible();
  });
});

describe("account settings reachability", () => {
  it("mounts the settings host on the node directory", async () => {
    // Regression: `LazySettingsDialogMount` was rendered from exactly one place
    // — inside `RootAppShell`, which the hosted root only reaches once a relay
    // session is live. An account with zero nodes, only offline nodes, or only
    // revoked nodes could not open account settings at all: `openSettings` is a
    // global singleton and flipped silently against no mount.
    seedDirectory([]);
    mounted = await render(<HostedHubRoot />);

    await page.getByRole("button", { name: "Account settings" }).click();
    expect(useSettingsDialogStore.getState().open).toBe(true);
    expect(useSettingsDialogStore.getState().section).toBe("account");

    // The host actually renders, rather than the store flipping into a void.
    await vi.waitFor(() => {
      expect(document.querySelector('[data-slot="dialog-popup"]')).not.toBeNull();
    });
  });

  it("mounts exactly one settings host, never one per surface", async () => {
    seedDirectory([node()]);
    mounted = await render(<HostedHubRoot />);
    useSettingsDialogStore.setState({ open: true, section: "account" });

    await vi.waitFor(() => {
      expect(document.querySelector('[data-slot="dialog-popup"]')).not.toBeNull();
    });
    expect(
      document.querySelectorAll('[data-slot="dialog-popup"]'),
      "the wrapped entry surfaces and the app shell are opposite branches of one switch",
    ).toHaveLength(1);
  });

  it("keeps settings reachable from the surface a terminal relay failure lands on", async () => {
    // The state where a user most needs to check their credentials is the one
    // where their node stopped answering.
    const selected = node();
    seedDirectory([selected], {
      selectedNode: selected,
      transportStatus: "terminal-failure",
      errorMessage: "The relay authentication attempt expired or was rejected.",
    });
    mounted = await render(<HostedHubRoot />);
    await expect.element(page.getByRole("heading", { name: /Unable to connect/ })).toBeVisible();

    // The desktop connection control is a `<details>` disclosure; its contents
    // are the bounded control set, and Account now sits with Refresh and Sign
    // out inside it.
    document.querySelector<HTMLElement>("summary")?.click();
    await page.getByRole("button", { name: "Account" }).click();
    expect(useSettingsDialogStore.getState().open).toBe(true);
    expect(useSettingsDialogStore.getState().section).toBe("account");
  });
});
