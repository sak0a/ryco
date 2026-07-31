import { LegendList, type LegendListRenderItemProps } from "@legendapp/list/react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { EmptyState } from "../../components/EmptyState";
import type { InboxEmptyState, InboxSection, InboxThreadRow } from "./inboxModel";
import {
  flattenInboxSections,
  MOBILE_SETTLED_PAGE_SIZE,
  type InboxListItem,
} from "./inboxListModel";
import { InboxThreadRow as ThreadRow } from "./InboxThreadRow";
import { HOME_LIST_PADDING_BOTTOM } from "../home/homeChromeModel";
import { WorkspaceConnectionStatus } from "../home/WorkspaceConnectionStatus";

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
  const [settledOpen, setSettledOpen] = useState(false);
  const [settledVisibleCount, setSettledVisibleCount] = useState(MOBILE_SETTLED_PAGE_SIZE);
  const data = flattenInboxSections({
    sections: props.sections,
    settledOpen,
    settledVisibleCount,
  });
  const empty = props.emptyState ? EMPTY_COPY[props.emptyState] : null;

  const renderItem = ({ item }: LegendListRenderItemProps<InboxListItem>) => {
    if (item.kind === "section") {
      if (item.sectionKey === "settled") {
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Settled, ${item.count} tasks`}
            accessibilityState={{ expanded: item.expanded }}
            className="min-h-11 flex-row items-center gap-2 px-5 pt-4 pb-2 active:opacity-70"
            onPress={() => setSettledOpen((open) => !open)}
          >
            <SymbolView
              name={item.expanded ? "chevron.down" : "chevron.right"}
              size={13}
              type="monochrome"
            />
            <Text className="text-sm font-ryco-medium text-foreground-muted">{item.title}</Text>
            <Text className="ml-auto rounded-full bg-subtle px-2 py-0.5 font-mono text-2xs text-foreground-tertiary">
              {item.count}
            </Text>
          </Pressable>
        );
      }
      return (
        <Text className="px-5 pt-5 pb-2 text-sm font-ryco-medium text-foreground-muted">
          {item.title} · {item.count}
        </Text>
      );
    }
    if (item.kind === "show-more") {
      return (
        <Pressable
          accessibilityRole="button"
          className="mx-4 mb-2 min-h-11 items-center justify-center rounded-2xl bg-subtle active:bg-subtle-strong"
          onPress={() => setSettledVisibleCount((count) => count + MOBILE_SETTLED_PAGE_SIZE)}
        >
          <Text className="text-sm font-ryco-medium text-foreground-muted">
            Show {Math.min(MOBILE_SETTLED_PAGE_SIZE, item.remaining)} more
          </Text>
        </Pressable>
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
      contentContainerStyle={{ paddingBottom: HOME_LIST_PADDING_BOTTOM }}
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
