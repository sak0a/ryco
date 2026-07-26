import { useNavigation } from "@react-navigation/native";
import { useState } from "react";
import { Modal, Pressable, ScrollView, TextInput, View } from "react-native";

import type { EnvironmentId } from "@ryco/contracts";

import { AppText as Text } from "../../components/AppText";
import { showConfirmDialog } from "../../components/ConfirmDialogHost";
import { EmptyState } from "../../components/EmptyState";
import { ErrorBanner } from "../../components/ErrorBanner";
import { useThemeColor } from "../../lib/useThemeColor";
import { useStore } from "../../state/threadsRuntime";
import {
  type ConnectionRow,
  useConnectionActions,
  useSavedEnvironments,
} from "../connection/useConnectionController";
import { HubNodeSection } from "../hostedHub/HubNodeSection";
import { NodeRow, type NodeRowAction } from "./NodeRow";
import { directRoleLabel, directTransportLabel } from "./nodesModel";

interface RenameTarget {
  readonly environmentId: EnvironmentId;
}

function endpointLabel(httpBaseUrl: string): string {
  try {
    return new URL(httpBaseUrl).host;
  } catch {
    return "Saved endpoint";
  }
}

function RenameNodeSheet(props: {
  readonly target: RenameTarget | null;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onClose: () => void;
  readonly onSave: () => void;
}) {
  const placeholderColor = useThemeColor("--color-placeholder");
  const textColor = useThemeColor("--color-foreground");
  if (!props.target) return null;
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={props.onClose}
    >
      <View className="flex-1 gap-5 bg-screen px-5 pt-5">
        <View className="flex-row items-center">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel rename"
            onPress={props.onClose}
            className="h-11 min-w-16 items-center justify-center rounded-full active:bg-subtle"
          >
            <Text className="text-base font-ryco-medium text-foreground">Cancel</Text>
          </Pressable>
          <Text className="flex-1 text-center text-lg font-ryco-bold text-foreground">
            Rename node
          </Text>
          <View className="h-11 min-w-16" />
        </View>
        <Text className="font-sans text-base text-foreground-muted">
          Choose the name shown on this device. The node and its credentials do not change.
        </Text>
        <TextInput
          autoFocus
          value={props.value}
          onChangeText={props.onChange}
          placeholder="Node name"
          placeholderTextColor={placeholderColor as string}
          className="min-h-14 rounded-2xl border border-border bg-card px-4 py-3 font-sans text-base"
          style={{ color: textColor as string }}
          returnKeyType="done"
          onSubmitEditing={props.onSave}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save node name"
          disabled={!props.value.trim()}
          onPress={props.onSave}
          className="h-12 items-center justify-center rounded-full bg-primary px-5 active:opacity-80 disabled:opacity-40"
        >
          <Text className="text-base font-ryco-bold text-primary-foreground">Save</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

export function NodesScreen(props: {
  readonly query?: string;
  readonly initialScrollOffset?: number;
  readonly onScrollOffset?: (offset: number) => void;
}) {
  const navigation = useNavigation();
  const { rows } = useSavedEnvironments();
  const actions = useConnectionActions();
  const activeEnvironmentId = useStore((state) => state.activeEnvironmentId);
  const [busy, setBusy] = useState<EnvironmentId | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const query = props.query?.trim().toLocaleLowerCase() ?? "";
  const visibleRows = query
    ? rows.filter((row) =>
        `${row.record.label} ${row.record.httpBaseUrl} ${directTransportLabel(row.record.httpBaseUrl)}`
          .toLocaleLowerCase()
          .includes(query),
      )
    : rows;

  const withBusy = async (id: EnvironmentId, run: () => Promise<void>) => {
    setBusy(id);
    setActionError(null);
    try {
      await run();
    } catch {
      setActionError("The direct connection could not be updated. Check the node and try again.");
    } finally {
      setBusy(null);
    }
  };

  const directActionsFor = (row: ConnectionRow): ReadonlyArray<NodeRowAction> => {
    const id = row.record.environmentId;
    const isConnected = row.runtime.connectionState === "connected";
    const isConnecting = row.runtime.connectionState === "connecting";
    const isSelected = activeEnvironmentId === id;
    const disabled = busy !== null;
    const rowActions: NodeRowAction[] = [];

    if (!isSelected || !isConnected) {
      rowActions.push({
        label: isConnected ? "Use" : row.runtime.connectionState === "error" ? "Retry" : "Connect",
        disabled,
        onPress: () =>
          void withBusy(id, async () => {
            useStore.getState().setActiveEnvironmentId(id);
            if (!isConnected) await actions.reconnectSavedEnvironment(id);
          }),
      });
    }
    if (isConnected || isConnecting) {
      rowActions.push({
        label: "Disconnect",
        disabled,
        onPress: () => void withBusy(id, () => actions.disconnectSavedEnvironment(id)),
      });
    }
    rowActions.push(
      {
        label: "Rename",
        disabled,
        onPress: () => {
          setRenameTarget({ environmentId: id });
          setRenameValue(row.record.label);
        },
      },
      {
        label: "Forget",
        destructive: true,
        disabled,
        onPress: () =>
          showConfirmDialog({
            title: `Forget ${row.record.label}?`,
            message:
              "This removes the saved direct connection and its local credential. You can pair the node again later.",
            confirmText: "Forget",
            destructive: true,
            onConfirm: () =>
              void withBusy(id, () => actions.removeSavedEnvironment(row.record.environmentId)),
          }),
      },
    );
    return rowActions;
  };

  const saveRename = () => {
    if (!renameTarget || !renameValue.trim()) return;
    actions.renameSavedEnvironment(renameTarget.environmentId, renameValue.trim());
    setRenameTarget(null);
  };

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 40 }}
        contentOffset={{ x: 0, y: props.initialScrollOffset ?? 0 }}
        onScroll={(event) => props.onScrollOffset?.(event.nativeEvent.contentOffset.y)}
        scrollEventThrottle={32}
      >
        <View className="mx-4 mt-5 flex-row gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a direct connection"
            onPress={() => navigation.navigate("ConnectionsNew")}
            className="h-12 flex-1 flex-row items-center justify-center rounded-2xl bg-primary px-5 active:opacity-80"
          >
            <Text className="text-base font-ryco-bold text-primary-foreground">
              Direct connection
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            onPress={() => navigation.navigate("SettingsSheet")}
            className="h-12 items-center justify-center rounded-2xl bg-card px-4 active:bg-card-alt"
          >
            <Text className="text-sm font-ryco-bold text-foreground">Settings</Text>
          </Pressable>
        </View>

        {actionError ? <ErrorBanner message={actionError} /> : null}

        <HubNodeSection query={query} />

        <Text className="px-5 pt-7 pb-2.5 text-sm font-ryco-medium text-foreground-muted">
          Direct connections
        </Text>

        {visibleRows.length === 0 ? (
          <View className="px-5 py-6">
            <EmptyState
              variant="plain"
              title={query ? "No matching direct nodes" : "No direct nodes"}
              detail={
                query
                  ? "Change the search to see other direct connections."
                  : "Pair with a QR code, pairing URL, LAN address, or Tailscale address."
              }
            />
          </View>
        ) : (
          <View className="mx-4 overflow-hidden rounded-2xl border border-border bg-card">
            {visibleRows.map((row, index) => (
              <NodeRow
                key={row.record.environmentId}
                label={row.record.label}
                detail={`${directRoleLabel(row.runtime.role)} · ${endpointLabel(row.record.httpBaseUrl)}`}
                transportLabel={directTransportLabel(row.record.httpBaseUrl)}
                statusTone={{ ...row.tone, label: row.statusLabel }}
                selected={activeEnvironmentId === row.record.environmentId}
                showDivider={index > 0}
                actions={directActionsFor(row)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <RenameNodeSheet
        target={renameTarget}
        value={renameValue}
        onChange={setRenameValue}
        onClose={() => setRenameTarget(null)}
        onSave={saveRename}
      />
    </>
  );
}
