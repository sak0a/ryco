import "../../index.css";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { ChangeRequest, EnvironmentId, SourceControlIssueSummary } from "@ryco/contracts";

// ---------------------------------------------------------------------------
// Mock TanStack Query so we can inject test data without a real server
// ---------------------------------------------------------------------------

type UseQueryArgs = {
  queryKey?: ReadonlyArray<unknown>;
  queryFn?: unknown;
  enabled?: boolean;
  staleTime?: number;
};

const issueListData: SourceControlIssueSummary[] = [
  {
    provider: "github",
    number: 42 as never,
    title: "Fix the authentication bug",
    url: "https://github.com/owner/repo/issues/42",
    state: "open",
    updatedAt: { _tag: "None" } as never,
  },
  {
    provider: "github",
    number: 7 as never,
    title: "Update the README with examples",
    url: "https://github.com/owner/repo/issues/7",
    state: "open",
    updatedAt: { _tag: "None" } as never,
  },
];

const prListData: ChangeRequest[] = [
  {
    provider: "github",
    number: 99 as never,
    title: "feat: add dark mode",
    url: "https://github.com/owner/repo/pull/99",
    baseRefName: "main" as never,
    headRefName: "feat/dark-mode" as never,
    state: "open",
    updatedAt: { _tag: "None" } as never,
  },
];

vi.mock("~/lib/sourceControlContextRpc", () => ({
  issueListQueryOptions: vi.fn((input: { environmentId: unknown; cwd: string; state: string }) => ({
    queryKey: [
      "sourceControl",
      "issues",
      input.environmentId,
      input.cwd,
      "list",
      input.state,
      null,
    ],
    queryFn: () => issueListData,
    enabled: true,
    staleTime: 60_000,
  })),
  changeRequestListQueryOptions: vi.fn(
    (input: { environmentId: unknown; cwd: string; state: string }) => ({
      queryKey: [
        "sourceControl",
        "changeRequests",
        input.environmentId,
        input.cwd,
        "list",
        input.state,
        null,
      ],
      queryFn: () => prListData,
      enabled: true,
      staleTime: 60_000,
    }),
  ),
  searchIssuesQueryOptions: vi.fn((input: { query: string; enabled?: boolean }) => ({
    queryKey: ["sourceControl", "issues", null, null, "search", input.query, null],
    queryFn: () => [],
    enabled: input.enabled ?? false,
    staleTime: 30_000,
  })),
  searchChangeRequestsQueryOptions: vi.fn((input: { query: string; enabled?: boolean }) => ({
    queryKey: ["sourceControl", "changeRequests", null, null, "search", input.query, null],
    queryFn: () => [],
    enabled: input.enabled ?? false,
    staleTime: 30_000,
  })),
}));

// ---------------------------------------------------------------------------
// Replace useQuery with a test double that executes the queryFn immediately
// ---------------------------------------------------------------------------

vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");

  const cache = new Map<string, unknown>();

  return {
    ...actual,
    useQuery: (options: UseQueryArgs) => {
      const key = JSON.stringify(options.queryKey);
      if (options.enabled === false) {
        return { data: undefined, isLoading: false, error: null };
      }
      if (!cache.has(key)) {
        // Synchronously run the queryFn so the component has data on first render
        const fn = options.queryFn as (() => unknown) | undefined;
        if (fn) {
          const result = fn();
          if (result instanceof Promise) {
            // store a pending marker; react will re-render once it resolves
            result.then((data) => cache.set(key, data));
          } else {
            cache.set(key, result);
          }
        }
      }
      const data = cache.get(key);
      return {
        data,
        isLoading: data === undefined,
        error: null,
      };
    },
    useQueryClient: () => ({}),
  };
});

// ---------------------------------------------------------------------------
// Import the component under test AFTER mocks are registered
// ---------------------------------------------------------------------------

import { ContextPickerPopup } from "./ContextPickerPopup";

const TEST_ENVIRONMENT_ID = "environment-local" as unknown as EnvironmentId;
const TEST_CWD = "/repo/project";

async function mountPopup(overrides?: {
  onSelectIssue?: (issue: SourceControlIssueSummary) => void;
  onSelectChangeRequest?: (cr: ChangeRequest) => void;
  onAttachFile?: (file: File) => void;
}) {
  const host = document.createElement("div");
  document.body.append(host);

  const onSelectIssue = overrides?.onSelectIssue ?? vi.fn();
  const onSelectChangeRequest = overrides?.onSelectChangeRequest ?? vi.fn();
  const onAttachFile = overrides?.onAttachFile ?? vi.fn();

  const screen = await render(
    <ContextPickerPopup
      environmentId={TEST_ENVIRONMENT_ID}
      cwd={TEST_CWD}
      hasSourceControlRemote={true}
      onSelectIssue={onSelectIssue}
      onSelectChangeRequest={onSelectChangeRequest}
      onAttachFile={onAttachFile}
    />,
    { container: host },
  );

  return {
    onSelectIssue,
    onSelectChangeRequest,
    onAttachFile,
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

describe("ContextPickerPopup", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders GH Issues tab by default and shows issue list", async () => {
    const { cleanup } = await mountPopup();

    try {
      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("#42");
        expect(text).toContain("Fix the authentication bug");
        expect(text).toContain("#7");
        expect(text).toContain("Update the README with examples");
      });
    } finally {
      await cleanup();
    }
  });

  it("filters issues by client-side search when query is typed", async () => {
    const { cleanup } = await mountPopup();

    try {
      // Wait for initial render
      await vi.waitFor(() => {
        expect(document.body.textContent).toContain("#42");
      });

      const searchInput = page.getByPlaceholder("Search…");
      await searchInput.fill("README");

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("#7");
        expect(text).toContain("Update the README with examples");
        expect(text).not.toContain("Fix the authentication bug");
      });
    } finally {
      await cleanup();
    }
  });

  it("switches to GH PRs tab and renders PR list", async () => {
    const { cleanup } = await mountPopup();

    try {
      await vi.waitFor(() => {
        expect(document.body.textContent).toContain("PRs");
      });

      await page.getByRole("tab", { name: "PRs" }).click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("#99");
        expect(text).toContain("feat: add dark mode");
      });
    } finally {
      await cleanup();
    }
  });

  it("calls onSelectIssue with the correct item when an issue is clicked", async () => {
    const onSelectIssue = vi.fn();
    const { cleanup } = await mountPopup({ onSelectIssue });

    try {
      await vi.waitFor(() => {
        expect(document.body.textContent).toContain("Fix the authentication bug");
      });

      await userEvent.click(page.getByRole("button", { name: /Fix the authentication bug/i }));

      await vi.waitFor(() => {
        expect(onSelectIssue).toHaveBeenCalledTimes(1);
        expect(onSelectIssue.mock.calls[0]?.[0]?.number).toBe(42);
      });
    } finally {
      await cleanup();
    }
  });
});
