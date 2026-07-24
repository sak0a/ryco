import { useNavigation } from "@react-navigation/native";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import type { EnvironmentId } from "@ryco/contracts";

import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { StatusPill } from "../../components/StatusPill";
import { useConnectionActions, useSavedEnvironments } from "./useConnectionController";

export function ConnectionsRouteScreen() {
  const navigation = useNavigation();
  const { rows } = useSavedEnvironments();
  const actions = useConnectionActions();
  const [busy, setBusy] = useState<EnvironmentId | null>(null);

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
      contentInsetAdjustmentBehavior="automatic"
      className="flex-1 bg-screen"
      contentContainerStyle={{ paddingVertical: 12 }}
    >
      <Pressable
        onPress={() => navigation.navigate("ConnectionsNew")}
        className="mx-4 mb-2 items-center rounded-2xl bg-primary px-4 py-3 active:opacity-70"
      >
        <Text className="text-sm font-ryco-bold text-primary-foreground">Pair a device</Text>
      </Pressable>

      {rows.length === 0 ? (
        <View className="px-4 py-16">
          <EmptyState
            variant="plain"
            title="No environments"
            detail="Pair a Ryco node to connect."
          />
        </View>
      ) : (
        <View className="mx-4 overflow-hidden rounded-2xl border border-border bg-card">
          {rows.map((row, index) => (
            <View
              key={row.record.environmentId}
              className={`gap-2 px-4 py-3 ${index > 0 ? "border-t border-border" : ""}`}
            >
              <View className="flex-row items-center gap-3">
                <Text className="flex-1 font-sans text-base text-foreground" numberOfLines={1}>
                  {row.record.label}
                </Text>
                <StatusPill
                  size="compact"
                  label={row.statusLabel}
                  pillClassName={row.tone.pillClassName}
                  textClassName={row.tone.textClassName}
                />
              </View>
              <View className="flex-row gap-2">
                <Pressable
                  disabled={busy !== null}
                  onPress={() =>
                    void withBusy(row.record.environmentId, () =>
                      actions.reconnectSavedEnvironment(row.record.environmentId),
                    )
                  }
                  className="rounded-full border border-border px-3 py-1.5 active:opacity-70 disabled:opacity-40"
                >
                  <Text className="text-xs font-ryco-bold text-foreground">Reconnect</Text>
                </Pressable>
                <Pressable
                  disabled={busy !== null}
                  onPress={() =>
                    void withBusy(row.record.environmentId, () =>
                      actions.removeSavedEnvironment(row.record.environmentId),
                    )
                  }
                  className="rounded-full border border-rose-500/40 px-3 py-1.5 active:opacity-70 disabled:opacity-40"
                >
                  <Text className="text-xs font-ryco-bold text-rose-700 dark:text-rose-300">
                    Remove
                  </Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
