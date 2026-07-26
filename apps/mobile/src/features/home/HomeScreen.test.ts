import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const navigationMock = vi.hoisted(() => ({ setOptions: vi.fn(), navigate: vi.fn() }));
const dispatchMock = vi.hoisted(() => vi.fn());

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  TextInput: "TextInput",
  View: "View",
}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useLayoutEffect: (effect: () => void) => effect(),
    useMemo: <T>(factory: () => T) => factory(),
    useReducer: <T>(
      _reducer: unknown,
      initial: T,
      initializer: ((input: T) => unknown) | undefined,
    ) => [initializer ? initializer(initial) : initial, dispatchMock] as const,
    useState: <T>(initial: T) => [initial, vi.fn()] as const,
  };
});
vi.mock("@react-navigation/native", () => ({ useNavigation: () => navigationMock }));
vi.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 96 }));
vi.mock("zustand/react/shallow", () => ({ useShallow: (selector: unknown) => selector }));
vi.mock("../../lib/useThemeColor", () => ({ useThemeColor: () => "#ededed" }));
vi.mock("../../components/AppSymbol", () => ({ SymbolView: "SymbolView" }));
vi.mock("../../components/RycoWordmark", () => ({ RycoWordmark: "RycoWordmark" }));
vi.mock("../../components/HomeModeControl", () => ({ HomeModeControl: "HomeModeControl" }));
vi.mock("../../components/NodeScopeControl", () => ({ NodeScopeControl: "NodeScopeControl" }));
vi.mock("../inbox/InboxScreen", () => ({ InboxScreen: "InboxScreen" }));
vi.mock("../nodes/NodesScreen", () => ({ NodesScreen: "NodesScreen" }));
vi.mock("../projects/ProjectsScreen", () => ({ ProjectsScreen: "ProjectsScreen" }));
vi.mock("../connection/useConnectionController", () => ({
  useSavedEnvironments: () => ({ rows: [], isLoading: false }),
}));
vi.mock("../../hostedHub/state", () => ({
  useHostedHubStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      selectedNode: null,
      effectiveRole: null,
      transportStatus: "idle",
      sessionStatus: "closed",
    }),
}));
vi.mock("../../state/homeData", () => ({
  useHomeWorkspaceData: () => ({ projects: [], worktrees: [], threads: [] }),
}));
vi.mock("../../state/threadsRuntime", () => ({
  useStore: Object.assign(() => undefined, {
    getState: () => ({ setActiveEnvironmentId: () => undefined }),
  }),
}));

import { HomeScreen } from "./HomeScreen";

interface HeaderOptions {
  readonly title?: string;
  readonly headerLeft?: () => ReactElement;
  readonly headerRight?: () => ReactElement;
}

function renderHeaderOptions(): HeaderOptions {
  HomeScreen();
  const calls = navigationMock.setOptions.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]?.[0] as HeaderOptions;
}

describe("C1 Home header", () => {
  beforeEach(() => {
    navigationMock.setOptions.mockClear();
    navigationMock.navigate.mockClear();
    dispatchMock.mockClear();
  });

  it("labels the initial workspace Inbox and registers both header sides", () => {
    const options = renderHeaderOptions();
    expect(options.title).toBe("Inbox");
    expect(typeof options.headerLeft).toBe("function");
    expect(typeof options.headerRight).toBe("function");
  });

  it("renders the R-only compact mark in a 44-point Nodes button", () => {
    const element = renderHeaderOptions().headerLeft?.() as ReactElement<{
      accessibilityRole: string;
      accessibilityLabel: string;
      className: string;
      children: ReactElement<{ compact: boolean }>;
    }>;
    expect(element.type).toBe("Pressable");
    expect(element.props.accessibilityRole).toBe("button");
    expect(element.props.accessibilityLabel).toBe("Open Nodes");
    expect(element.props.className).toContain("h-11");
    expect(element.props.className).toContain("w-11");
    expect(element.props.children.type).toBe("RycoWordmark");
    expect(element.props.children.props.compact).toBe(true);
  });

  it("gives Search and New Task separate 44-point targets", () => {
    const element = renderHeaderOptions().headerRight?.() as ReactElement<{
      className: string;
      children: ReadonlyArray<ReactElement<{ className: string; accessibilityLabel: string }>>;
    }>;

    expect(element.props.className).toContain("gap-2");
    expect(element.props.children.map((child) => child.props.accessibilityLabel)).toEqual([
      "Search Inbox",
      "New Task",
    ]);
    for (const action of element.props.children) {
      expect(action.props.className).toContain("h-11");
      expect(action.props.className).toContain("w-11");
    }
  });

  it("switches the R button to Nodes without opening another navigation layer", () => {
    const element = renderHeaderOptions().headerLeft?.() as ReactElement<{
      onPress: () => void;
    }>;
    element.props.onPress();

    expect(dispatchMock).toHaveBeenCalledWith({ type: "select-mode", mode: "nodes" });
    expect(navigationMock.navigate).not.toHaveBeenCalled();
  });
});
