import { useNavigation } from "@react-navigation/native";
import { Pressable, ScrollView, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { StatusPill, type StatusTone } from "../../components/StatusPill";
import type { SidebarThreadSummary } from "@ryco/client-runtime/state/threads";
import { useHomeThreadGroups } from "../../state/homeData";
import { useStore } from "../../state/threadsRuntime";
import { WorkspaceConnectionStatus } from "./WorkspaceConnectionStatus";

function threadStatus(thread: SidebarThreadSummary): StatusTone {
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) {
    return {
      label: "Needs input",
      pillClassName: "bg-amber-500/12 dark:bg-amber-500/16",
      textClassName: "text-amber-700 dark:text-amber-300",
    };
  }
  const status = thread.session?.status;
  if (thread.latestTurn?.state === "running") {
    return {
      label: "Working",
      pillClassName: "bg-sky-500/12 dark:bg-sky-500/16",
      textClassName: "text-sky-700 dark:text-sky-300",
    };
  }
  if (status === "connecting") {
    return {
      label: "Connecting",
      pillClassName: "bg-sky-500/12 dark:bg-sky-500/16",
      textClassName: "text-sky-700 dark:text-sky-300",
    };
  }
  if (status === "error" || thread.latestTurn?.state === "error") {
    return {
      label: "Error",
      pillClassName: "bg-rose-500/12 dark:bg-rose-500/16",
      textClassName: "text-rose-700 dark:text-rose-300",
    };
  }
  return {
    label: "Idle",
    pillClassName: "bg-subtle",
    textClassName: "text-foreground-muted",
  };
}

// B2 Home. Grouped project/thread list over runtime-A selectors + the workspace
// connection banner. LegendList virtualization is a follow-up (ScrollView is fine
// for MVP list sizes).
export function HomeScreen() {
  const navigation = useNavigation();
  const groups = useHomeThreadGroups();

  const openThread = (thread: SidebarThreadSummary) => {
    useStore.getState().setActiveEnvironmentId(thread.environmentId);
    navigation.navigate("Thread", {
      environmentId: thread.environmentId,
      threadId: thread.id,
    });
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      className="flex-1 bg-screen"
      contentContainerStyle={{ paddingBottom: 32 }}
    >
      <WorkspaceConnectionStatus />
      {groups.length === 0 ? (
        <View className="px-4 py-16">
          <EmptyState
            variant="plain"
            title="No threads yet"
            detail="Pair an environment and start a thread to see it here."
          />
        </View>
      ) : (
        groups.map((group) => (
          <View key={group.key} className="mt-4">
            <Text className="px-5 pb-2 text-xs font-ryco-bold uppercase tracking-wide text-foreground-muted">
              {group.label}
            </Text>
            <View className="mx-4 overflow-hidden rounded-2xl border border-border bg-card">
              {group.threads.map((thread, index) => (
                <Pressable
                  key={thread.id}
                  onPress={() => openThread(thread)}
                  className={`flex-row items-center gap-3 px-4 py-3 active:bg-subtle ${
                    index > 0 ? "border-t border-border" : ""
                  }`}
                >
                  <Text className="flex-1 font-sans text-base text-foreground" numberOfLines={1}>
                    {thread.title || "Untitled thread"}
                  </Text>
                  <StatusPill size="compact" {...threadStatus(thread)} />
                </Pressable>
              ))}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}
