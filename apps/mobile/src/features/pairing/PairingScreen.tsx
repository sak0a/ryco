import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { extractPairingToken } from "../../platform";
import type { MobileConnectionRegistry } from "../../runtime/bootstrap";
import { resolveRemotePairingTarget } from "../../connection/remoteApi";
import { getMobileEndpoint } from "../../connection/runtimeConfig";
import { useWsConnectionStatus } from "../../rpc/wsConnectionState";
import {
  selectBootstrapCompleteForActiveEnvironment,
  selectSidebarThreadsAcrossEnvironments,
  useStore,
} from "../../state/threadsRuntime";

type PairingStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "pairing" }
  | { readonly kind: "paired"; readonly label: string }
  | { readonly kind: "error"; readonly message: string };

const PAIRING_BASE_ORIGIN_FALLBACK = "https://app.ryco.dev";

/**
 * B1 direct-node pairing surface (not the full Connections UI — B2). It runs the
 * bearer pairing loop end to end: resolve a pairing URL, exchange the credential
 * for a bearer session token, store the token in SecretKV and the environment in
 * the catalog, and issue the authenticated WebSocket URL. Connection status and
 * the sidebar thread list read runtime-A state.
 */
export function PairingScreen({ registry }: { readonly registry: MobileConnectionRegistry }) {
  const [pairingUrl, setPairingUrl] = useState("");
  const [status, setStatus] = useState<PairingStatus>({ kind: "idle" });

  const wsStatus = useWsConnectionStatus();
  const threads = useStore(selectSidebarThreadsAcrossEnvironments);
  const bootstrapComplete = useStore(selectBootstrapCompleteForActiveEnvironment);

  const onConnect = useCallback(async () => {
    const trimmed = pairingUrl.trim();
    if (!trimmed) {
      setStatus({ kind: "error", message: "Enter a pairing URL." });
      return;
    }
    setStatus({ kind: "pairing" });
    try {
      const baseOrigin = getMobileEndpoint().origin() || PAIRING_BASE_ORIGIN_FALLBACK;
      const target = resolvePairingTarget(trimmed, baseOrigin);

      // 1. Exchange the pairing credential for a bearer session token.
      const bootstrap = await registry.remoteApi.bootstrapRemoteBearerSession({
        httpBaseUrl: target.httpBaseUrl,
        credential: target.credential,
      });

      // 2. Identify the node so the token and record are keyed by EnvironmentId.
      const descriptor = await registry.remoteApi.fetchRemoteEnvironmentDescriptor({
        httpBaseUrl: target.httpBaseUrl,
      });

      // 3. Persist the bearer token in SecretKV, then upsert the environment
      //    into the catalog registry. The upsert fires the registry
      //    subscription the supervisor started, so the environment auto-connects
      //    (opens the live socket and streams the node into state/threads).
      await registry.catalog.writeBearerToken(descriptor.environmentId, bootstrap.sessionToken);
      registry.catalog.registryStore.getState().upsert({
        environmentId: descriptor.environmentId,
        label: descriptor.label,
        httpBaseUrl: target.httpBaseUrl,
        wsBaseUrl: target.wsBaseUrl,
        createdAt: new Date().toISOString(),
        lastConnectedAt: null,
      });

      setStatus({ kind: "paired", label: descriptor.label });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [pairingUrl, registry]);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Connect to a Ryco node</Text>
      <Text style={styles.subheading}>
        Paste a pairing URL from a local or staging node (Settings -&gt; Pair a device).
      </Text>

      <TextInput
        style={styles.input}
        placeholder="ryco://pair?host=…#token=…"
        autoCapitalize="none"
        autoCorrect={false}
        value={pairingUrl}
        onChangeText={setPairingUrl}
      />

      <Pressable
        style={[styles.button, status.kind === "pairing" && styles.buttonDisabled]}
        disabled={status.kind === "pairing"}
        onPress={() => {
          void onConnect();
        }}
      >
        {status.kind === "pairing" ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.buttonLabel}>Pair and connect</Text>
        )}
      </Pressable>

      <View style={styles.statusBlock}>
        <StatusRow label="Pairing" value={describePairing(status)} />
        <StatusRow
          label="Socket"
          value={`${wsStatus.phase}${wsStatus.online ? "" : " · offline"}`}
        />
        <StatusRow label="Bootstrap" value={bootstrapComplete ? "complete" : "pending"} />
      </View>

      {status.kind === "error" ? <Text style={styles.error}>{status.message}</Text> : null}

      <Text style={styles.sectionHeading}>Threads ({threads.length})</Text>
      {threads.length === 0 ? (
        <Text style={styles.empty}>No threads yet. They load once the node stream syncs.</Text>
      ) : (
        threads.map((thread) => (
          <Text key={thread.id} style={styles.threadRow} numberOfLines={1}>
            {thread.title || "Untitled thread"}
          </Text>
        ))
      )}
    </ScrollView>
  );
}

function resolvePairingTarget(pairingUrlValue: string, baseOrigin: string) {
  return resolveRemotePairingTarget({ pairingUrl: pairingUrlValue }, baseOrigin, {
    readPairingToken: (url) => extractPairingToken(url.toString()),
    // Hosted pairing requests belong to the hosted plane (workstream C); B1
    // handles direct-node pairing only.
    readHostedPairingRequest: () => null,
  });
}

function StatusRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.statusRow}>
      <Text style={styles.statusLabel}>{label}</Text>
      <Text style={styles.statusValue}>{value}</Text>
    </View>
  );
}

function describePairing(status: PairingStatus): string {
  switch (status.kind) {
    case "idle":
      return "not started";
    case "pairing":
      return "pairing…";
    case "paired":
      return `paired to ${status.label}`;
    case "error":
      return "error";
  }
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 12 },
  heading: { fontSize: 22, fontWeight: "700" },
  subheading: { fontSize: 14, opacity: 0.7 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8e8e93",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
  },
  button: {
    backgroundColor: "#0a84ff",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonLabel: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
  statusBlock: { gap: 6, paddingVertical: 8 },
  statusRow: { flexDirection: "row", justifyContent: "space-between" },
  statusLabel: { fontSize: 14, opacity: 0.6 },
  statusValue: { fontSize: 14, fontWeight: "600" },
  error: { color: "#dc2626", fontSize: 14 },
  sectionHeading: { fontSize: 16, fontWeight: "700", marginTop: 8 },
  empty: { fontSize: 14, opacity: 0.6 },
  threadRow: { fontSize: 15, paddingVertical: 6 },
});
