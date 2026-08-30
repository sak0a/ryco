import { StackActions } from "@react-navigation/native";

interface SettingsNavigation {
  readonly getParent: () =>
    | {
        readonly dispatch: (action: ReturnType<typeof StackActions.replace>) => void;
      }
    | undefined;
}

/**
 * Replace the root Settings route instead of navigating underneath it.
 *
 * Settings is itself a root-stack screen containing a nested stack. A plain
 * parent `navigate("Connections")` changes the route behind Settings while the
 * full-screen Settings route remains visible, which makes the Machines row
 * appear inert. Replacing the root entry closes Settings and presents Machines
 * in one atomic navigation action.
 */
export function openMachinesFromSettings(navigation: SettingsNavigation): void {
  navigation.getParent()?.dispatch(StackActions.replace("Connections"));
}
