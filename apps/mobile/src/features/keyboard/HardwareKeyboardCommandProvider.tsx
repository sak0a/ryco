import { StackActions, useNavigation } from "@react-navigation/native";
import { useCallback, useMemo, useSyncExternalStore, type PropsWithChildren } from "react";

import { KeyboardCommands } from "../../native/KeyboardCommands";
import {
  dispatchHardwareKeyboardCommand,
  getHardwareKeyboardCommandRegistrationVersion,
  getRegisteredHardwareKeyboardCommands,
  parseActiveThreadPath,
  subscribeToHardwareKeyboardCommandRegistrations,
  type HardwareKeyboardCommand,
} from "./hardwareKeyboardCommands";

// Pruned to the MVP command set: `back` + `review` + whatever screens register
// dynamically. Upstream also wired `newTask`/`files`/`terminal` — all dropped
// (NewTask flow is a non-goal; files/terminal are v1.1).
export function HardwareKeyboardCommandProvider({
  children,
  pathname,
}: PropsWithChildren<{ readonly pathname: string }>) {
  const navigation = useNavigation();
  const registrationVersion = useSyncExternalStore(
    subscribeToHardwareKeyboardCommandRegistrations,
    getHardwareKeyboardCommandRegistrationVersion,
    getHardwareKeyboardCommandRegistrationVersion,
  );
  const enabledCommands = useMemo(() => {
    const commands = new Set<HardwareKeyboardCommand>(getRegisteredHardwareKeyboardCommands());
    if (pathname !== "/" || navigation.canGoBack()) commands.add("back");
    if (parseActiveThreadPath(pathname)) {
      commands.add("review");
    }
    return [...commands];
  }, [pathname, registrationVersion, navigation]);

  const onCommand = useCallback(
    (command: HardwareKeyboardCommand) => {
      if (dispatchHardwareKeyboardCommand(command)) return;

      if (command === "back") {
        if (navigation.canGoBack()) {
          navigation.goBack();
        } else {
          navigation.dispatch(StackActions.replace("Home"));
        }
        return;
      }

      const thread = parseActiveThreadPath(pathname);
      if (!thread) return;
      if (command === "review" && !/\/review(?:\/|$)/.test(pathname)) {
        navigation.navigate("ThreadReview", thread);
      }
    },
    [pathname, navigation],
  );

  return (
    <KeyboardCommands enabledCommands={enabledCommands} onCommand={onCommand}>
      {children}
    </KeyboardCommands>
  );
}
