import { LegendList, type LegendListRenderItemProps } from "@legendapp/list/react-native";
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import type { InboxEmptyState, InboxSection, InboxThreadRow } from "./inboxModel";
import { InboxThreadRow as ThreadRow } from "./InboxThreadRow";
import { WorkspaceConnectionStatus } from "../home/WorkspaceConnectionStatus";

type InboxListItem =
  | { readonly kind: "section"; readonly key: string; readonly title: string }
  | { readonly kind: "thread"; readonly key: string; readonly row: InboxThreadRow };

function flattenSections(sections: ReadonlyArray<InboxSection>): ReadonlyArray<InboxListItem> {
  return sections.flatMap((section) => [
    { kind: "section" as const, key: `section:${section.key}`, title: section.title },
    ...section.rows.map((row) => ({ kind: "thread" as const, key: row.key, row })),
  ]);
}

const EMPTY_COPY: Readonly<
  Record<
    Exclude<InboxEmptyState, null>,
    { readonly title: string; readonly detail: string; readonly actionLabel: string }
  >
> = {
  "connect-node": {
    title: "Connect a node",
    detail: "Use your Hub or pair a node directly to bring its work into Ryco.",
    actionLabel: "Open Nodes",
  },
  "add-project": {
    title: "No projects yet",
    detail: "Add a remote workspace on a connected node to start working.",
    actionLabel: "Open Projects",
  },
  "new-task": {
    title: "No tasks yet",
    detail: "Start a task inside one of your projects.",
    actionLabel: "Open Projects",
  },
  "clear-filter": {
    title: "Nothing matches",
    detail: "Change the search or return to all nodes.",
    actionLabel: "Clear filters",
  },
};

export function InboxScreen(props: {
  readonly sections: ReadonlyArray<InboxSection>;
  readonly emptyState: InboxEmptyState;
  readonly initialScrollOffset?: number;
  readonly onOpenThread: (row: InboxThreadRow) => void;
  readonly onEmptyAction: (state: Exclude<InboxEmptyState, null>) => void;
  readonly onScrollOffset?: (offset: number) => void;
}) {
  const data = flattenSections(props.sections);
  const empty = props.emptyState ? EMPTY_COPY[props.emptyState] : null;

  const renderItem = ({ item }: LegendListRenderItemProps<InboxListItem>) => {
    if (item.kind === "section") {
      return (
        <Text className="px-5 pt-5 pb-2 text-sm font-ryco-medium text-foreground-muted">
          {item.title}
        </Text>
      );
    }
    return <ThreadRow row={item.row} onPress={() => props.onOpenThread(item.row)} />;
  };

  return (
    <LegendList
      data={data}
      renderItem={renderItem}
      keyExtractor={(item) => item.key}
      recycleItems
      maintainVisibleContentPosition
      initialScrollOffset={props.initialScrollOffset}
      onScroll={(event) => props.onScrollOffset?.(event.nativeEvent.contentOffset.y)}
      scrollEventThrottle={32}
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{ paddingBottom: 40 }}
      ListHeaderComponent={<WorkspaceConnectionStatus />}
      ListEmptyComponent={
        empty ? (
          <View className="px-2 py-12">
            <EmptyState
              variant="plain"
              title={empty.title}
              detail={empty.detail}
              actionLabel={empty.actionLabel}
              onAction={() => props.onEmptyAction(props.emptyState!)}
            />
          </View>
        ) : null
      }
    />
  );
}
