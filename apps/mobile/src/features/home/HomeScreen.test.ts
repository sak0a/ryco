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
    useEffect: () => undefined,
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
// The FAB reads useSafeAreaInsets, which the three-export react-native stub
// cannot provide — it has to be mockable at the module boundary.
vi.mock("../../components/NewTaskFab", () => ({ NewTaskFab: "NewTaskFab" }));
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
vi.mock("../../state/messageQueueStore", () => ({
  useMessageQueueStore: (selector: (state: { queuesByThreadKey: object }) => unknown) =>
    selector({ queuesByThreadKey: {} }),
}));
vi.mock("../../state/threadsRuntime", () => ({
  useStore: Object.assign(() => undefined, {
    getState: () => ({ setActiveEnvironmentId: () => undefined }),
  }),
}));
vi.mock("./useHomeEnvironments", () => ({ useHomeEnvironments: () => [] }));

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

  it("renders the R-only compact mark in a 44-point Inbox button", () => {
    const element = renderHeaderOptions().headerLeft?.() as ReactElement<{
      accessibilityRole: string;
      accessibilityLabel: string;
      className: string;
      children: ReactElement<{ compact: boolean }>;
    }>;
    expect(element.type).toBe("Pressable");
    expect(element.props.accessibilityRole).toBe("button");
    expect(element.props.accessibilityLabel).toBe("Open Inbox");
    expect(element.props.className).toContain("h-11");
    expect(element.props.className).toContain("w-11");
    expect(element.props.children.type).toBe("RycoWordmark");
    expect(element.props.children.props.compact).toBe(true);
  });

  it("gives Search and Settings separate 44-point targets", () => {
    const element = renderHeaderOptions().headerRight?.() as ReactElement<{
      className: string;
      children: ReadonlyArray<ReactElement<{ className: string; accessibilityLabel: string }>>;
    }>;

    expect(element.props.className).toContain("gap-2");
    expect(element.props.children.map((child) => child.props.accessibilityLabel)).toEqual([
      "Search Inbox",
      "Settings",
    ]);
    for (const action of element.props.children) {
      expect(action.props.className).toContain("h-11");
      expect(action.props.className).toContain("w-11");
    }
  });

  it("switches the R button to Inbox without opening another navigation layer", () => {
    const element = renderHeaderOptions().headerLeft?.() as ReactElement<{
      onPress: () => void;
    }>;
    element.props.onPress();

    expect(dispatchMock).toHaveBeenCalledWith({ type: "select-mode", mode: "inbox" });
    expect(navigationMock.navigate).not.toHaveBeenCalled();
  });

  it("opens Settings straight from the header instead of routing through Nodes", () => {
    const element = renderHeaderOptions().headerRight?.() as ReactElement<{
      children: ReadonlyArray<ReactElement<{ onPress: () => void }>>;
    }>;
    element.props.children[1]?.props.onPress();

    expect(navigationMock.navigate).toHaveBeenCalledWith("SettingsSheet");
  });

  it("moves New Task out of the header and onto the floating button", () => {
    const tree = HomeScreen() as ReactElement<{
      children: ReadonlyArray<ReactElement<{ accessibilityLabel?: string }> | null | false>;
    }>;
    const fab = tree.props.children.find(
      (child) => child && typeof child === "object" && child.type === "NewTaskFab",
    ) as ReactElement<{ accessibilityLabel: string; onPress: () => void }> | undefined;

    expect(fab).toBeDefined();
    expect(fab?.props.accessibilityLabel).toBe("New Task");

    fab?.props.onPress();
    expect(navigationMock.navigate).toHaveBeenCalledWith("NewTask", { environmentId: undefined });
  });
});
