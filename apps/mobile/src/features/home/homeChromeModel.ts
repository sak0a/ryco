import type { HomeMode } from "./homeMode";

// Pure description of the Home screen's chrome — title, both header sides, and
// the floating new-task button. `HomeScreen.tsx` is layout only; every decision
// about what appears and what it is called lives here so it can be tested
// without a React Native renderer (program status §1.1).

export const HOME_MODE_TITLE: Readonly<Record<HomeMode, string>> = {
  inbox: "Inbox",
  projects: "Projects",
};

/**
 * Bottom clearance every scrollable Home list needs so its last row is not
 * covered by the floating new-task button.
 *
 * The button is `NEW_TASK_FAB_DIAMETER` (56) tall and sits 16pt above the home
 * indicator, and `HomeScreen` applies no bottom safe-area inset of its own — so
 * this single number carries the whole clearance: 34 (typical home indicator) +
 * 16 (gap below) + 56 (button) + 18 (gap above the last row) = 124.
 */
export const HOME_LIST_PADDING_BOTTOM = 124;

export type HomeChromeButtonId = "home-mark" | "search" | "settings" | "new-task";

export interface HomeChromeButton {
  readonly id: HomeChromeButtonId;
  readonly accessibilityLabel: string;
}

export interface HomeChromeModel {
  readonly title: string;
  /**
   * The mark is a *mode switch*, not a route push — it dispatches
   * `select-mode` and never opens another navigation layer.
   */
  readonly headerLeft: HomeChromeButton;
  readonly headerLeftTargetMode: HomeMode;
  readonly headerRight: readonly [HomeChromeButton, HomeChromeButton];
  readonly newTask: HomeChromeButton;
  readonly searchExpanded: boolean;
}

export function buildHomeChromeModel(input: {
  readonly mode: HomeMode;
  readonly searchVisible: boolean;
}): HomeChromeModel {
  const title = HOME_MODE_TITLE[input.mode];

  return {
    title,
    // Always Inbox, from every mode. The mark is the app's "take me home"
    // affordance, so its target — and therefore its label — stays constant
    // rather than changing under the user.
    headerLeft: { id: "home-mark", accessibilityLabel: "Open Inbox" },
    headerLeftTargetMode: "inbox",
    headerRight: [
      {
        id: "search",
        accessibilityLabel: input.searchVisible ? "Hide search" : `Search ${title}`,
      },
      { id: "settings", accessibilityLabel: "Settings" },
    ],
    // Shown in every mode, matching the reach of the header "+" it replaces.
    newTask: { id: "new-task", accessibilityLabel: "New Task" },
    searchExpanded: input.searchVisible,
  };
}
