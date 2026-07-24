import type { StaticScreenProps } from "@react-navigation/native";

import { EnvironmentId, ThreadId } from "@ryco/contracts";

import { ThreadDetailScreen } from "./ThreadDetailScreen";

type ThreadRouteScreenProps = StaticScreenProps<{
  readonly environmentId: string;
  readonly threadId: string;
}>;

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function ThreadRouteScreen(props: ThreadRouteScreenProps) {
  const environmentIdRaw = firstParam(props.route.params.environmentId);
  const threadIdRaw = firstParam(props.route.params.threadId);
  if (!environmentIdRaw || !threadIdRaw) return null;

  return (
    <ThreadDetailScreen
      environmentId={EnvironmentId.make(environmentIdRaw)}
      threadId={ThreadId.make(threadIdRaw)}
    />
  );
}
