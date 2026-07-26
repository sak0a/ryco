import { useNavigation } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useLayoutEffect, useMemo, useReducer, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useShallow } from "zustand/react/shallow";

import type { EnvironmentId, ThreadId } from "@ryco/contracts";

import { HomeModeControl } from "../../components/HomeModeControl";
import { NodeScopeControl } from "../../components/NodeScopeControl";
import { RycoWordmark } from "../../components/RycoWordmark";
import { SymbolView } from "../../components/AppSymbol";
import { useSavedEnvironments } from "../connection/useConnectionController";
import { useHostedHubStore } from "../../hostedHub/state";
import { useThemeColor } from "../../lib/useThemeColor";
import { useHomeWorkspaceData } from "../../state/homeData";
import { useStore } from "../../state/threadsRuntime";
import { buildInboxSections, resolveInboxEmptyState } from "../inbox/inboxModel";
import { InboxScreen } from "../inbox/InboxScreen";
import { NodesScreen } from "../nodes/NodesScreen";
import { buildProjectNodeGroups } from "../projects/projectsModel";
import { ProjectsScreen } from "../projects/ProjectsScreen";
import { buildHomeEnvironments } from "./homeEnvironmentModel";
import { createHomeModeState, reduceHomeModeState, type HomeMode } from "./homeMode";

const MODE_TITLE: Readonly<Record<HomeMode, string>> = {
  inbox: "Inbox",
  projects: "Projects",
  nodes: "Nodes",
};

export function HomeScreen() {
  const navigation = useNavigation();
  const headerHeight = useHeaderHeight();
  const [home, dispatch] = useReducer(reduceHomeModeState, undefined, () => createHomeModeState());
  const [searchVisible, setSearchVisible] = useState(false);
  const iconColor = useThemeColor("--color-icon");
  const placeholderColor = useThemeColor("--color-placeholder");
  const textColor = useThemeColor("--color-foreground");
  const { projects, worktrees, threads } = useHomeWorkspaceData();
  const { rows: directRows } = useSavedEnvironments();
  const hosted = useHostedHubStore(
    useShallow((state) => ({
      selectedNode: state.selectedNode,
      effectiveRole: state.effectiveRole,
      transportStatus: state.transportStatus,
      sessionStatus: state.sessionStatus,
    })),
  );

  const environments = useMemo(
    () =>
      buildHomeEnvironments({
        direct: directRows.map((row) => ({
          environmentId: row.record.environmentId,
          label: row.record.label,
          connectionState: row.runtime.connectionState,
          role: row.runtime.role,
        })),
        hosted: hosted.selectedNode
          ? {
              environmentId: hosted.selectedNode.environmentId,
              label: hosted.selectedNode.label,
              transportStatus: hosted.transportStatus,
              sessionStatus: hosted.sessionStatus,
              role: hosted.effectiveRole,
            }
          : null,
      }),
    [directRows, hosted],
  );

  const currentQuery = home.queryByMode[home.mode];
  const currentNodeScope = home.nodeScopeByMode[home.mode];
  const inboxSections = useMemo(
    () =>
      buildInboxSections({
        projects,
        worktrees,
        threads,
        environments,
        query: home.queryByMode.inbox,
        nodeScope: home.nodeScopeByMode.inbox,
      }),
    [
      environments,
      home.nodeScopeByMode.inbox,
      home.queryByMode.inbox,
      projects,
      threads,
      worktrees,
    ],
  );
  const projectGroups = useMemo(
    () =>
      buildProjectNodeGroups({
        projects,
        worktrees,
        threads,
        environments,
        query: home.queryByMode.projects,
        nodeScope: home.nodeScopeByMode.projects,
      }),
    [
      environments,
      home.nodeScopeByMode.projects,
      home.queryByMode.projects,
      projects,
      threads,
      worktrees,
    ],
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      title: MODE_TITLE[home.mode],
      headerLeft: () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Nodes"
          className="h-11 w-11 items-center justify-center rounded-full active:bg-subtle-strong"
          onPress={() => dispatch({ type: "select-mode", mode: "nodes" })}
        >
          <RycoWordmark compact />
        </Pressable>
      ),
      headerRight: () => (
        <View className="flex-row items-center gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={searchVisible ? "Hide search" : `Search ${MODE_TITLE[home.mode]}`}
            accessibilityState={{ expanded: searchVisible }}
            className="h-11 w-11 items-center justify-center rounded-full active:bg-subtle-strong"
            onPress={() => setSearchVisible((visible) => !visible)}
          >
            <SymbolView name="magnifyingglass" size={20} tintColor={iconColor} type="monochrome" />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            className="h-11 w-11 items-center justify-center rounded-full active:bg-subtle-strong"
            onPress={() => navigation.navigate("SettingsSheet")}
          >
            <SymbolView name="gearshape" size={21} tintColor={iconColor} type="monochrome" />
          </Pressable>
        </View>
      ),
    });
  }, [home.mode, iconColor, navigation, searchVisible]);

  const selectMode = (mode: HomeMode) => {
    dispatch({ type: "select-mode", mode });
  };

  const openThread = (thread: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
  }) => {
    useStore.getState().setActiveEnvironmentId(thread.environmentId);
    navigation.navigate("Thread", {
      environmentId: thread.environmentId,
      threadId: thread.threadId,
    });
  };

  const clearFilters = () => {
    dispatch({ type: "set-query", mode: home.mode, query: "" });
    dispatch({ type: "set-node-scope", mode: home.mode, environmentId: null });
  };

  const inboxEmptyState = resolveInboxEmptyState({
    environmentCount: environments.length,
    projectCount: projects.length,
    threadCount: threads.filter((thread) => thread.archivedAt === null).length,
    hasFilter: home.queryByMode.inbox.length > 0 || home.nodeScopeByMode.inbox !== null,
  });

  return (
    <View className="flex-1 bg-screen" style={{ paddingTop: headerHeight }}>
      <HomeModeControl mode={home.mode} onSelect={selectMode} />
      {searchVisible ? (
        <View className="mx-4 mt-3 flex-row items-center rounded-2xl bg-sidebar-search px-4">
          <SymbolView
            name="magnifyingglass"
            size={16}
            tintColor={placeholderColor as string}
            type="monochrome"
          />
          <TextInput
            autoFocus
            accessibilityLabel={`Search ${MODE_TITLE[home.mode]}`}
            value={currentQuery}
            onChangeText={(query) => dispatch({ type: "set-query", mode: home.mode, query })}
            placeholder={`Search ${MODE_TITLE[home.mode].toLocaleLowerCase()}`}
            placeholderTextColor={placeholderColor as string}
            className="h-11 flex-1 px-3 font-sans text-base"
            style={{ color: textColor as string }}
            returnKeyType="search"
          />
          {currentQuery ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => dispatch({ type: "set-query", mode: home.mode, query: "" })}
              className="h-11 w-11 items-center justify-center"
            >
              <SymbolView
                name="xmark.circle.fill"
                size={17}
                tintColor={placeholderColor as string}
                type="monochrome"
              />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {home.mode !== "nodes" ? (
        <NodeScopeControl
          options={environments}
          selected={currentNodeScope}
          onSelect={(environmentId) =>
            dispatch({
              type: "set-node-scope",
              mode: home.mode,
              environmentId,
            })
          }
        />
      ) : null}
      <View className="min-h-0 flex-1">
        <View
          className="min-h-0 flex-1"
          style={{ display: home.mode === "inbox" ? "flex" : "none" }}
        >
          <InboxScreen
            sections={inboxSections}
            emptyState={inboxEmptyState}
            onOpenThread={(row) => openThread(row)}
            onEmptyAction={(state) => {
              if (state === "connect-node") {
                selectMode("nodes");
              } else if (state === "clear-filter") {
                clearFilters();
              } else {
                selectMode("projects");
              }
            }}
          />
        </View>
        <View
          className="min-h-0 flex-1"
          style={{ display: home.mode === "projects" ? "flex" : "none" }}
        >
          <ProjectsScreen
            groups={projectGroups}
            hasConnections={environments.length > 0}
            onOpenNodes={() => selectMode("nodes")}
          />
        </View>
        <View
          className="min-h-0 flex-1"
          style={{ display: home.mode === "nodes" ? "flex" : "none" }}
        >
          <NodesScreen query={home.queryByMode.nodes} />
        </View>
      </View>
    </View>
  );
}
