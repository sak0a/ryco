import { useNavigation } from "@react-navigation/native";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import type { EnvironmentId } from "@ryco/contracts";

import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { StatusPill } from "../../components/StatusPill";
import { HubNodeSection } from "../hostedHub/HubNodeSection";
import { useConnectionActions, useSavedEnvironments } from "../connection/useConnectionController";

export function NodesScreen(props: { readonly query?: string }) {
  const navigation = useNavigation();
  const { rows } = useSavedEnvironments();
  const actions = useConnectionActions();
  const [busy, setBusy] = useState<EnvironmentId | null>(null);
  const query = props.query?.trim().toLocaleLowerCase() ?? "";
  const visibleRows = query
    ? rows.filter((row) =>
        `${row.record.label} ${row.record.httpBaseUrl}`.toLocaleLowerCase().includes(query),
      )
    : rows;

  const withBusy = async (id: EnvironmentId, run: () => Promise<void>) => {
    setBusy(id);
    try {
      await run();
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="never"
      className="flex-1"
      contentContainerStyle={{ paddingBottom: 40 }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add a direct connection"
        onPress={() => navigation.navigate("ConnectionsNew")}
        className="mx-4 mt-5 h-12 flex-row items-center justify-center rounded-2xl bg-primary px-5 active:opacity-80"
      >
        <Text className="text-base font-ryco-bold text-primary-foreground">Direct connection</Text>
      </Pressable>

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
                : "Scan a QR code, paste a pairing URL, or connect to a LAN or Tailscale address."
            }
          />
        </View>
      ) : (
        <View className="mx-4 overflow-hidden rounded-2xl bg-card">
          {visibleRows.map((row, index) => (
            <View
              key={row.record.environmentId}
              className={`gap-2.5 px-4 py-4 ${index > 0 ? "border-t border-border-subtle" : ""}`}
            >
              <View className="flex-row items-center gap-3">
                <View className="min-w-0 flex-1 gap-1">
                  <Text className="font-ryco-medium text-base text-foreground" numberOfLines={1}>
                    {row.record.label}
                  </Text>
                  <Text className="font-mono text-2xs text-foreground-muted" numberOfLines={1}>
                    {row.record.httpBaseUrl}
                  </Text>
                </View>
                <StatusPill
                  size="compact"
                  label={row.statusLabel}
                  pillClassName={row.tone.pillClassName}
                  textClassName={row.tone.textClassName}
                />
              </View>
              <View className="flex-row gap-2">
                <Pressable
                  accessibilityRole="button"
                  disabled={busy !== null}
                  onPress={() =>
                    void withBusy(row.record.environmentId, () =>
                      actions.reconnectSavedEnvironment(row.record.environmentId),
                    )
                  }
                  className="h-10 justify-center rounded-xl border border-border px-3 active:bg-subtle disabled:opacity-40"
                >
                  <Text className="text-xs font-ryco-bold text-foreground">Reconnect</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy !== null}
                  onPress={() =>
                    void withBusy(row.record.environmentId, () =>
                      actions.removeSavedEnvironment(row.record.environmentId),
                    )
                  }
                  className="h-10 justify-center rounded-xl border border-danger-border px-3 active:bg-danger disabled:opacity-40"
                >
                  <Text className="text-xs font-ryco-bold text-danger-foreground">Remove</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
