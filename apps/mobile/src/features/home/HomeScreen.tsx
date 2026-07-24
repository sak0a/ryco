import { useNavigation } from "@react-navigation/native";
import { useLayoutEffect } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { GlassIconButton } from "../../components/GlassIconButton";
import { cn } from "../../lib/cn";
import type { SidebarThreadSummary } from "@ryco/client-runtime/state/threads";
import { useHomeThreadGroups } from "../../state/homeData";
import { useStore } from "../../state/threadsRuntime";
import { WorkspaceConnectionStatus } from "./WorkspaceConnectionStatus";

type StatusDotKind = "accent" | "success" | "warning" | "danger" | "idle";

interface ThreadStatus {
  readonly label: string;
  readonly dot: StatusDotKind;
  /** Semantic text color for the quiet trailing status label. */
  readonly textClassName: string;
}

// Status is never color-alone (§6): the dot's fill/hollow shape and the trailing
// label both encode state. Colors resolve through the semantic accent tokens.
function threadStatus(thread: SidebarThreadSummary): ThreadStatus {
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) {
    return { label: "Needs input", dot: "warning", textClassName: "text-warning" };
  }
  const status = thread.session?.status;
  if (thread.latestTurn?.state === "running") {
    return { label: "Working", dot: "accent", textClassName: "text-accent-strong" };
  }
  if (status === "connecting") {
    return { label: "Connecting", dot: "accent", textClassName: "text-accent-strong" };
  }
  if (status === "error" || thread.latestTurn?.state === "error") {
    return { label: "Error", dot: "danger", textClassName: "text-danger-foreground" };
  }
  return { label: "Idle", dot: "idle", textClassName: "text-foreground-tertiary" };
}

function StatusDot({ kind }: { readonly kind: StatusDotKind }) {
  if (kind === "idle") {
    return <View className="h-2.5 w-2.5 rounded-full border border-foreground-tertiary" />;
  }
  const fill = cn(
    "h-2.5 w-2.5 rounded-full",
    kind === "accent" && "bg-accent",
    kind === "success" && "bg-success",
    kind === "warning" && "bg-warning",
    kind === "danger" && "bg-danger-foreground",
  );
  return <View className={fill} />;
}

// B2 Home. Grouped project/thread list over runtime-A selectors + the workspace
// connection banner. Cursor rhythm: airy 20pt gutters, thin inset hairlines, a
// leading status dot, quiet trailing metadata, white-capsule CTA.
export function HomeScreen() {
  const navigation = useNavigation();
  const groups = useHomeThreadGroups();

  // Home is the initial route; the pairing/settings surfaces are only reachable
  // from here. Floating glass icon circles (Connect + Settings) let a paired user
  // add an environment or open settings; the empty-state CTA covers first run.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View className="flex-row items-center gap-2.5">
          <GlassIconButton
            icon="link"
            accessibilityLabel="Pair a device"
            onPress={() => navigation.navigate("ConnectionsNew")}
          />
          <GlassIconButton
            icon="gearshape"
            accessibilityLabel="Settings"
            onPress={() => navigation.navigate("SettingsSheet")}
          />
        </View>
      ),
    });
  }, [navigation]);

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
      contentContainerStyle={{ paddingBottom: 40 }}
    >
      <WorkspaceConnectionStatus />
      {groups.length === 0 ? (
        <View className="items-center gap-7 px-5 py-20">
          <EmptyState
            variant="plain"
            title="No threads yet"
            detail="Pair an environment and start a thread to see it here."
          />
          <Pressable
            onPress={() => navigation.navigate("ConnectionsNew")}
            className="rounded-full bg-primary px-7 py-3.5 active:opacity-80"
          >
            <Text className="text-base font-ryco-bold text-primary-foreground">Pair a device</Text>
          </Pressable>
        </View>
      ) : (
        groups.map((group) => (
          <View key={group.key} className="mt-6">
            <Text className="px-5 pb-2.5 text-sm font-ryco-medium text-foreground-muted">
              {group.label}
            </Text>
            <View className="mx-5 overflow-hidden rounded-2xl border border-border bg-card">
              {group.threads.map((thread, index) => {
                const status = threadStatus(thread);
                return (
                  <Pressable
                    key={thread.id}
                    onPress={() => openThread(thread)}
                    className="flex-row items-center px-5 active:bg-subtle"
                  >
                    <View className="w-3 items-center justify-center">
                      <StatusDot kind={status.dot} />
                    </View>
                    <View
                      className={cn(
                        "ml-3 flex-1 flex-row items-center gap-3 py-4",
                        index > 0 && "border-t border-border-subtle",
                      )}
                    >
                      <Text
                        className="flex-1 font-sans text-[17px] leading-[22px] text-foreground"
                        numberOfLines={1}
                      >
                        {thread.title || "Untitled thread"}
                      </Text>
                      <Text className={cn("text-xs font-ryco-medium", status.textClassName)}>
                        {status.label}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}
