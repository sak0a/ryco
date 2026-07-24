import { useNavigation } from "@react-navigation/native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { ErrorBanner } from "../../components/ErrorBanner";
import { useThemeColor } from "../../lib/useThemeColor";
import { extractPairingUrlFromQrPayload } from "./pairing";
import { useConnectionActions } from "./useConnectionController";

type Mode = "url" | "host";

// B2 pairing surface — replaces B1's PairingScreen. QR scan (expo-camera) folds
// the scanned payload into the URL field; URL and host+code both pair through the
// tested environmentActions.addSavedEnvironment. Direct-node only.
export function ConnectionsNewRouteScreen() {
  const navigation = useNavigation();
  const actions = useConnectionActions();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<Mode>("url");
  const [scanning, setScanning] = useState(false);
  const [pairingUrl, setPairingUrl] = useState("");
  const [host, setHost] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);

  const placeholderColor = useThemeColor("--color-placeholder");
  const textColor = useThemeColor("--color-foreground");

  const onScan = useCallback((payload: string) => {
    setScanning(false);
    try {
      setPairingUrl(extractPairingUrlFromQrPayload(payload));
      setMode("url");
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Could not read the QR code.");
    }
  }, []);

  const openScanner = useCallback(async () => {
    setError(null);
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setError("Camera permission is needed to scan a pairing QR code.");
        return;
      }
    }
    setScanning(true);
  }, [permission, requestPermission]);

  const pair = useCallback(async () => {
    setError(null);
    setPairing(true);
    try {
      await actions.addSavedEnvironment(
        mode === "url"
          ? { label: "", pairingUrl: pairingUrl.trim() }
          : { label: "", host: host.trim(), pairingCode: code.trim() },
      );
      navigation.goBack();
    } catch (pairError) {
      setError(pairError instanceof Error ? pairError.message : "Pairing failed.");
    } finally {
      setPairing(false);
    }
  }, [actions, mode, pairingUrl, host, code, navigation]);

  const canPair =
    !pairing && (mode === "url" ? pairingUrl.trim().length > 0 : host.trim().length > 0);

  const inputStyle = { color: textColor as string };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      className="flex-1 bg-screen"
      contentContainerStyle={{ padding: 20, gap: 14 }}
    >
      <Text className="font-sans text-base text-foreground-muted">
        Pair with a local or staging node. Scan its QR code, or enter the pairing URL / host + code.
      </Text>
      {error ? <ErrorBanner message={error} /> : null}

      {scanning ? (
        <View className="overflow-hidden rounded-2xl border border-border" style={{ height: 260 }}>
          <CameraView
            style={{ flex: 1 }}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={(result) => onScan(result.data)}
          />
          <Pressable
            onPress={() => setScanning(false)}
            className="absolute bottom-3 self-center rounded-full bg-primary px-4 py-2 active:opacity-70"
          >
            <Text className="text-sm font-ryco-bold text-primary-foreground">Cancel scan</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => void openScanner()}
          className="items-center rounded-2xl border border-border bg-card px-4 py-3 active:opacity-70"
        >
          <Text className="text-sm font-ryco-bold text-foreground">Scan QR code</Text>
        </Pressable>
      )}

      <View className="flex-row gap-2">
        {(["url", "host"] as const).map((value) => (
          <Pressable
            key={value}
            onPress={() => setMode(value)}
            className={`flex-1 items-center rounded-full px-3 py-2 ${
              mode === value ? "bg-primary" : "border border-border"
            }`}
          >
            <Text
              className={`text-xs font-ryco-bold ${mode === value ? "text-primary-foreground" : "text-foreground"}`}
            >
              {value === "url" ? "Pairing URL" : "Host + code"}
            </Text>
          </Pressable>
        ))}
      </View>

      {mode === "url" ? (
        <TextInput
          value={pairingUrl}
          onChangeText={setPairingUrl}
          placeholder="ryco://pair?host=…#token=…"
          placeholderTextColor={placeholderColor as string}
          autoCapitalize="none"
          autoCorrect={false}
          className="rounded-2xl border border-border bg-card px-4 py-3 font-mono text-sm"
          style={inputStyle}
        />
      ) : (
        <View className="gap-2">
          <TextInput
            value={host}
            onChangeText={setHost}
            placeholder="node.local:44342"
            placeholderTextColor={placeholderColor as string}
            autoCapitalize="none"
            autoCorrect={false}
            className="rounded-2xl border border-border bg-card px-4 py-3 font-mono text-sm"
            style={inputStyle}
          />
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="pairing code"
            placeholderTextColor={placeholderColor as string}
            autoCapitalize="none"
            autoCorrect={false}
            className="rounded-2xl border border-border bg-card px-4 py-3 font-mono text-sm"
            style={inputStyle}
          />
        </View>
      )}

      <Pressable
        disabled={!canPair}
        onPress={() => void pair()}
        className="items-center rounded-full bg-primary px-5 py-3.5 active:opacity-80 disabled:opacity-40"
      >
        <Text className="text-base font-ryco-bold text-primary-foreground">
          {pairing ? "Pairing…" : "Pair and connect"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
