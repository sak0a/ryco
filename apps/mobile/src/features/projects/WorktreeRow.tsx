import { Pressable, View } from "react-native";

import type { SidebarWorktreeSummary } from "@ryco/client-runtime/state/threads";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { useThemeColor } from "../../lib/useThemeColor";

function SmallAction(props: {
  readonly label: string;
  readonly destructive?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      className={`h-11 items-center justify-center rounded-full px-4 active:bg-subtle-strong ${
        props.destructive ? "bg-danger" : "bg-subtle"
      }`}
    >
      <Text
        className={`text-sm font-ryco-bold ${
          props.destructive ? "text-danger-foreground" : "text-foreground"
        }`}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

export function WorktreeRow(props: {
  readonly worktree: SidebarWorktreeSummary;
  readonly threadCount: number;
  readonly onNewTask?: () => void;
  readonly onRename?: () => void;
  readonly onArchive?: () => void;
  readonly onRestore?: () => void;
}) {
  const iconColor = useThemeColor("--color-icon-muted");
  const title = props.worktree.title?.trim() || props.worktree.branch;
  const archived = props.worktree.archivedAt !== null;

  return (
    <View className="rounded-2xl bg-card p-4">
      <View className="flex-row items-start gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-xl bg-subtle">
          <SymbolView
            name="arrow.triangle.branch"
            size={18}
            tintColor={iconColor as string}
            type="monochrome"
          />
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-[17px] font-ryco-bold text-foreground" numberOfLines={1}>
            {title}
          </Text>
          <Text className="font-mono text-xs text-foreground-muted" numberOfLines={1}>
            {props.worktree.branch}
          </Text>
          <Text className="text-xs font-ryco-medium text-foreground-tertiary">
            {props.threadCount} task{props.threadCount === 1 ? "" : "s"}
            {props.worktree.worktreePath ? " · Node workspace ready" : " · Managed by node"}
          </Text>
        </View>
      </View>

      <View className="mt-3 flex-row flex-wrap gap-2 pl-[52px]">
        {archived && props.onRestore ? (
          <SmallAction label="Restore" onPress={props.onRestore} />
        ) : (
          <>
            {props.onNewTask ? <SmallAction label="New task" onPress={props.onNewTask} /> : null}
            {props.onRename ? <SmallAction label="Rename" onPress={props.onRename} /> : null}
            {props.onArchive ? (
              <SmallAction label="Archive" destructive onPress={props.onArchive} />
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}
