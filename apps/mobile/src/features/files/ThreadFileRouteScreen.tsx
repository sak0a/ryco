import type { StaticScreenProps } from "@react-navigation/native";

import { routeFilePathParam, routeLineParam } from "@ryco/client-runtime/state/files";
import { EnvironmentId, ThreadId } from "@ryco/contracts";

import { ThreadFileScreen } from "./ThreadFileScreen";

/**
 * `path` arrives as the `:path*` segment array (already percent-decoded) on a
 * deep link and as the array the browser pushed on an in-app navigation, so it
 * is rejoined and re-normalized rather than trusted. `line` is a query param and
 * only means anything as a positive integer.
 */
type ThreadFileRouteScreenProps = StaticScreenProps<{
  readonly environmentId: string;
  readonly threadId: string;
  readonly path: string | readonly string[];
  readonly line?: string;
}>;

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function ThreadFileRouteScreen(props: ThreadFileRouteScreenProps) {
  const environmentIdRaw = firstParam(props.route.params.environmentId);
  const threadIdRaw = firstParam(props.route.params.threadId);
  if (!environmentIdRaw || !threadIdRaw) return null;

  return (
    <ThreadFileScreen
      environmentId={EnvironmentId.make(environmentIdRaw)}
      threadId={ThreadId.make(threadIdRaw)}
      path={routeFilePathParam(props.route.params.path)}
      line={routeLineParam(props.route.params.line)}
    />
  );
}
