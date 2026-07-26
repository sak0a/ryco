import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { HostedHubState } from "@ryco/client-runtime/authorization";

// The Nodes compatibility route. The screen is invoked as a plain
// function with react-native mocked (no React renderer exists in this suite);
// the hosted section below it renders for real, so the hosted controller spies
// are a genuine tripwire on device-row interactions.

const navigationMock = vi.hoisted(() => ({ navigate: vi.fn() }));
const actionsMock = vi.hoisted(() => ({
  reconnectSavedEnvironment: vi.fn(() => Promise.resolve()),
  removeSavedEnvironment: vi.fn(() => Promise.resolve()),
}));
const rowsMock = vi.hoisted(() => ({
  rows: [] as ReadonlyArray<unknown>,
}));
const hostedMock = vi.hoisted(() => ({
  available: false,
  ensureMobileHostedSession: vi.fn(() => Promise.resolve()),
  controller: {
    selectNode: vi.fn(),
    returnToDirectory: vi.fn(),
    refreshDirectory: vi.fn(),
    retrySelectedNode: vi.fn(),
  },
}));
const mountEffects = vi.hoisted(() => [] as Array<() => void>);

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  View: "View",
  Text: "Text",
  TextInput: "TextInput",
}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    // Supports React's lazy-initializer form, which `useHostedModeAvailable`
    // uses — the hosted section below the device rows renders for real here.
    useState: <T>(initial: T | (() => T)) =>
      [typeof initial === "function" ? (initial as () => T)() : initial, () => undefined] as const,
    useEffect: (effect: () => void) => mountEffects.push(effect),
  };
});
vi.mock("@react-navigation/native", () => ({ useNavigation: () => navigationMock }));
vi.mock("./useConnectionController", () => ({
  useSavedEnvironments: () => ({ rows: rowsMock.rows, isLoading: false }),
  useConnectionActions: () => actionsMock,
}));
vi.mock("../../hostedHub/state", () => ({
  ensureMobileHostedSession: hostedMock.ensureMobileHostedSession,
  isMobileHostedModeAvailable: () => hostedMock.available,
  hostedHubController: hostedMock.controller,
  useHostedHubStore: (selector: (state: HostedHubState) => unknown) =>
    selector(hostedState as HostedHubState),
}));

const hostedState: HostedHubState = {
  bootstrapAvailable: false,
  accountStatus: "signed-out",
  account: null,
  session: null,
  directoryStatus: "idle",
  nodes: [],
  selectedNode: null,
  selectionStatus: "none",
  effectiveRole: null,
  transportStatus: "idle",
  sessionStatus: "closed",
  sessionEstablished: false,
  sessionRecoveredAfterUnknown: false,
  browserStatus: "current",
  recoveryCodes: [],
  errorMessage: null,
  generation: 0,
};

import { ConnectionsRouteScreen } from "./ConnectionsRouteScreen";

function savedRow(environmentId: string, label: string) {
  return {
    record: { environmentId, label },
    runtime: { connectionState: "connected", authState: "authenticated" },
    tone: { label: "Connected", pillClassName: "bg-success-bg", textClassName: "text-success" },
    statusLabel: "Connected",
  };
}

function render(element: unknown): ReadonlyArray<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(element)) return element.flatMap(render);
  if (typeof element !== "object" || element === null) return [];
  const node = element as ReactElement<Record<string, unknown>>;
  if (!("props" in node)) return [];
  if (typeof node.type === "function") {
    const component = node.type as (props: Record<string, unknown>) => unknown;
    return render(component(node.props));
  }
  return [node, ...render(node.props?.children)];
}

function texts(element: unknown): ReadonlyArray<string> {
  return render(element)
    .filter((candidate) => candidate.type === "Text")
    .map((candidate) => String(candidate.props.children));
}

/** Every tappable host element, paired with the text it renders. */
function buttons(element: unknown): ReadonlyArray<{ label: string; press: () => void }> {
  return render(element)
    .filter((candidate) => candidate.type === "Pressable" && candidate.props.onPress !== undefined)
    .map((candidate) => ({
      label: texts(candidate.props.children).join(" ").trim(),
      press: candidate.props.onPress as () => void,
    }));
}

beforeEach(() => {
  navigationMock.navigate.mockClear();
  actionsMock.reconnectSavedEnvironment.mockClear();
  actionsMock.removeSavedEnvironment.mockClear();
  hostedMock.ensureMobileHostedSession.mockClear();
  hostedMock.controller.selectNode.mockClear();
  hostedMock.controller.returnToDirectory.mockClear();
  hostedMock.controller.refreshDirectory.mockClear();
  hostedMock.controller.retrySelectedNode.mockClear();
  mountEffects.length = 0;
  hostedMock.available = false;
  rowsMock.rows = [savedRow("env-1", "Studio Mac")];
});

describe("Nodes — direct plane", () => {
  it("labels both planes as separate sections", () => {
    const rendered = texts(ConnectionsRouteScreen());
    expect(rendered).toContain("Direct connections");
    expect(rendered).toContain("Hub nodes");
  });

  it("keeps the direct connection CTA", () => {
    buttons(ConnectionsRouteScreen())
      .find((button) => button.label === "Direct connection")
      ?.press();
    expect(navigationMock.navigate).toHaveBeenCalledWith("ConnectionsNew");
  });

  it("reconnects and removes a saved environment through the direct actions", () => {
    const tree = ConnectionsRouteScreen();
    buttons(tree)
      .find((button) => button.label === "Reconnect")
      ?.press();
    buttons(tree)
      .find((button) => button.label === "Remove")
      ?.press();
    expect(actionsMock.reconnectSavedEnvironment).toHaveBeenCalledWith("env-1");
    expect(actionsMock.removeSavedEnvironment).toHaveBeenCalledWith("env-1");
  });

  it("still renders the empty state with no saved environments", () => {
    rowsMock.rows = [];
    const rendered = texts(ConnectionsRouteScreen());
    expect(rendered).toContain("No direct nodes");
    expect(rendered).toContain("Direct connection");
  });
});

describe("Nodes — hosted mode absent", () => {
  it("keeps direct actions isolated from the unavailable Hub section", () => {
    const tree = ConnectionsRouteScreen();
    expect(texts(tree)).toContain("Studio Mac");
    const labels = buttons(tree).map((button) => button.label);
    expect(labels).toEqual(["Direct connection", "Reconnect", "Remove"]);
    expect(texts(tree)).toContain("Hub nodes unavailable");
  });
});

describe("two-plane isolation (direct → hosted)", () => {
  it("never calls a hosted controller method while using the Devices section", () => {
    for (const available of [false, true]) {
      hostedMock.available = available;
      const tree = ConnectionsRouteScreen();
      for (const label of ["Direct connection", "Reconnect", "Remove"]) {
        buttons(tree)
          .find((button) => button.label === label)
          ?.press();
      }
    }
    expect(actionsMock.reconnectSavedEnvironment).toHaveBeenCalledTimes(2);
    expect(hostedMock.controller.selectNode).not.toHaveBeenCalled();
    expect(hostedMock.controller.returnToDirectory).not.toHaveBeenCalled();
    expect(hostedMock.controller.refreshDirectory).not.toHaveBeenCalled();
    expect(hostedMock.controller.retrySelectedNode).not.toHaveBeenCalled();
  });
});
