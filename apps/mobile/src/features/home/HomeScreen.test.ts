import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

// Task 8 entry point: Home's top-left brand mark opens the environment
// switcher. There is no React renderer in this suite (react-native cannot be
// transformed under node), so the screen is invoked as a plain function with
// its hook dependencies mocked — the pattern established by
// `src/state/homeData.stability.test.ts`.

const navigationMock = vi.hoisted(() => ({ setOptions: vi.fn(), navigate: vi.fn() }));

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  View: "View",
}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useLayoutEffect: (effect: () => void) => effect() };
});
vi.mock("@react-navigation/native", () => ({ useNavigation: () => navigationMock }));
vi.mock("../../lib/useThemeColor", () => ({ useThemeColor: () => "#ededed" }));
vi.mock("../../components/AppSymbol", () => ({ SymbolView: "SymbolView" }));
vi.mock("../../components/RycoWordmark", () => ({ RycoWordmark: "RycoWordmark" }));
vi.mock("../../state/homeData", () => ({ useHomeThreadGroups: () => [] }));
vi.mock("../../state/threadsRuntime", () => ({
  useStore: Object.assign(() => undefined, {
    getState: () => ({ setActiveEnvironmentId: () => undefined }),
  }),
}));
vi.mock("./WorkspaceConnectionStatus", () => ({ WorkspaceConnectionStatus: "Banner" }));

import { HomeScreen } from "./HomeScreen";

interface HeaderOptions {
  readonly headerLeft?: () => ReactElement;
  readonly headerRight?: () => ReactElement;
}

function renderHeaderOptions(): HeaderOptions {
  HomeScreen();
  const calls = navigationMock.setOptions.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]?.[0] as HeaderOptions;
}

describe("Home header brand mark (environment switcher entry point)", () => {
  beforeEach(() => {
    navigationMock.setOptions.mockClear();
    navigationMock.navigate.mockClear();
  });

  it("registers a headerLeft brand mark alongside the existing headerRight actions", () => {
    const options = renderHeaderOptions();
    expect(typeof options.headerLeft).toBe("function");
    expect(typeof options.headerRight).toBe("function");
  });

  it("renders the compact Ryco wordmark as an accessible button with hit slop", () => {
    const element = renderHeaderOptions().headerLeft?.() as ReactElement<{
      accessibilityRole: string;
      accessibilityLabel: string;
      hitSlop: number;
      children: ReactElement<{ compact: boolean }>;
    }>;
    expect(element.type).toBe("Pressable");
    expect(element.props.accessibilityRole).toBe("button");
    expect(element.props.accessibilityLabel.length).toBeGreaterThan(0);
    expect(element.props.hitSlop).toBeGreaterThan(0);
    expect(element.props.children.type).toBe("RycoWordmark");
    expect(element.props.children.props.compact).toBe(true);
  });

  it("opens the Connections switcher sheet when pressed", () => {
    const element = renderHeaderOptions().headerLeft?.() as ReactElement<{
      onPress: () => void;
    }>;
    element.props.onPress();
    expect(navigationMock.navigate).toHaveBeenCalledTimes(1);
    expect(navigationMock.navigate).toHaveBeenCalledWith("Connections");
  });
});
