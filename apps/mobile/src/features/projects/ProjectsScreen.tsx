import { LegendList, type LegendListRenderItemProps } from "@legendapp/list/react-native";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { EmptyState } from "../../components/EmptyState";
import { useThemeColor } from "../../lib/useThemeColor";
import type { ProjectListRow, ProjectNodeGroup } from "./projectsModel";

type ProjectListItem =
  | {
      readonly kind: "node";
      readonly key: string;
      readonly title: string;
      readonly detail: string;
    }
  | { readonly kind: "project"; readonly key: string; readonly row: ProjectListRow };

function flattenGroups(groups: ReadonlyArray<ProjectNodeGroup>): ReadonlyArray<ProjectListItem> {
  return groups.flatMap((group) => [
    {
      kind: "node" as const,
      key: `node:${group.environmentId}`,
      title: group.nodeLabel,
      detail:
        group.connectionState === "connected"
          ? "Connected"
          : group.connectionState === "read-only"
            ? "Read-only"
            : group.connectionState === "reconnecting"
              ? "Reconnecting"
              : "Offline",
    },
    ...group.rows.map((row) => ({ kind: "project" as const, key: row.key, row })),
  ]);
}

function ProjectRow(props: { readonly row: ProjectListRow; readonly onPress?: () => void }) {
  const iconColor = useThemeColor("--color-icon-muted");
  const content = (
    <>
      <View className="h-10 w-10 items-center justify-center rounded-xl bg-subtle">
        <SymbolView
          name="folder.fill"
          size={20}
          tintColor={iconColor as string}
          type="monochrome"
        />
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <Text className="font-ryco-medium text-[17px] text-foreground" numberOfLines={1}>
          {props.row.title}
        </Text>
        <Text className="font-mono text-2xs text-foreground-muted" numberOfLines={1}>
          {props.row.path}
        </Text>
        <Text className="text-xs font-ryco-medium text-foreground-tertiary">
          {props.row.worktreeCount} worktree{props.row.worktreeCount === 1 ? "" : "s"} ·{" "}
          {props.row.activeThreadCount} active
        </Text>
      </View>
      {props.onPress ? (
        <SymbolView
          name="chevron.right"
          size={15}
          tintColor={iconColor as string}
          type="monochrome"
        />
      ) : null}
    </>
  );

  if (!props.onPress) {
    return (
      <View className="mx-4 mb-2.5 flex-row items-center gap-3 rounded-2xl bg-card px-4 py-3.5">
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.row.title}, ${props.row.worktreeCount} worktrees, ${props.row.activeThreadCount} active tasks`}
      onPress={props.onPress}
      className="mx-4 mb-2.5 flex-row items-center gap-3 rounded-2xl bg-card px-4 py-3.5 active:bg-card-alt"
    >
      {content}
    </Pressable>
  );
}

export function ProjectsScreen(props: {
  readonly groups: ReadonlyArray<ProjectNodeGroup>;
  readonly hasConnections: boolean;
  readonly onOpenProject?: (row: ProjectListRow) => void;
  readonly onOpenNodes: () => void;
}) {
  const data = flattenGroups(props.groups);
  const renderItem = ({ item }: LegendListRenderItemProps<ProjectListItem>) => {
    if (item.kind === "node") {
      return (
        <View className="flex-row items-baseline gap-3 px-5 pt-5 pb-2">
          <Text className="flex-1 text-sm font-ryco-medium text-foreground-muted">
            {item.title}
          </Text>
          <Text className="text-xs font-ryco-medium text-foreground-tertiary">{item.detail}</Text>
        </View>
      );
    }
    return (
      <ProjectRow
        row={item.row}
        onPress={props.onOpenProject ? () => props.onOpenProject?.(item.row) : undefined}
      />
    );
  };

  return (
    <LegendList
      data={data}
      renderItem={renderItem}
      keyExtractor={(item) => item.key}
      recycleItems
      maintainVisibleContentPosition
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{ paddingBottom: 40 }}
      ListEmptyComponent={
        <View className="px-2 py-14">
          <EmptyState
            variant="plain"
            title={props.hasConnections ? "No projects yet" : "Connect a node"}
            detail={
              props.hasConnections
                ? "Add a remote workspace on one of your connected nodes to begin."
                : "Use your Hub or pair a node directly before choosing a project."
            }
            actionLabel={props.hasConnections ? undefined : "Open Nodes"}
            onAction={props.hasConnections ? undefined : props.onOpenNodes}
          />
        </View>
      }
    />
  );
}
