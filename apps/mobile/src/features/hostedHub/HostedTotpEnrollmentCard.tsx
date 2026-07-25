import { useMemo } from "react";
import { View } from "react-native";
import { Path, Rect, Svg } from "react-native-svg";

import { AppText as Text } from "../../components/AppText";
import { CopyTextButton } from "../../components/CopyTextButton";
import { useThemeColor } from "../../lib/useThemeColor";
import type { HostedTotpEnrollmentView } from "./hostedAccountModel";
import { deriveHostedQrMatrix, hostedQrPath, hostedQrViewBoxSize } from "./hostedTotpQr";

/**
 * The TOTP enrolment secret, shown once.
 *
 * The QR code and the manual-entry key are the same secret in two forms, and
 * this is the only component in the app allowed to render either. It holds
 * neither: both come in as props read live from the runtime's transient
 * `totpEnrollment` slot on each render, so the moment the prompt calls
 * `dismissTotpEnrollment()` this subtree has nothing left to display and
 * unmounts. Nothing here writes to storage, the clipboard (except by an
 * explicit copy press), a log, or an analytics sink.
 *
 * The QR is drawn as a single SVG path from `@ryco/shared/qrCode` — the same
 * encoder the CLI renders pairing codes with — so no image is fetched and the
 * URI never leaves the process.
 *
 * Both colours are fixed tokens rather than theme-reactive ones: a scanner
 * needs dark modules on a light field, and an inverted symbol in dark mode is a
 * failure to scan rather than a style.
 */
export function HostedTotpEnrollmentCard(props: { readonly enrollment: HostedTotpEnrollmentView }) {
  const surface = useThemeColor("--color-qr-surface");
  const module = useThemeColor("--color-qr-module");
  const iconColor = useThemeColor("--color-icon-muted");
  const borderColor = useThemeColor("--color-border");

  const { provisioningUri, secretBase32 } = props.enrollment;
  const matrix = useMemo(() => deriveHostedQrMatrix(provisioningUri), [provisioningUri]);
  const path = useMemo(() => (matrix ? hostedQrPath(matrix) : null), [matrix]);

  return (
    <View className="mt-4">
      {matrix && path ? (
        <View className="items-center">
          <View className="overflow-hidden rounded-2xl border border-border">
            <Svg
              accessibilityRole="image"
              accessibilityLabel="Two-factor setup QR code"
              width={220}
              height={220}
              viewBox={`0 0 ${hostedQrViewBoxSize(matrix)} ${hostedQrViewBoxSize(matrix)}`}
            >
              <Rect
                x={0}
                y={0}
                width={hostedQrViewBoxSize(matrix)}
                height={hostedQrViewBoxSize(matrix)}
                fill={surface}
              />
              <Path d={path} fill={module} />
            </Svg>
          </View>
        </View>
      ) : (
        <Text className="font-sans text-sm leading-relaxed text-foreground-muted">
          This setup key could not be drawn as a code. Enter it by hand instead.
        </Text>
      )}

      <Text className="mt-4 text-xs font-ryco-medium text-foreground-muted">Setup key</Text>
      <View className="mt-1.5 flex-row items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
        <Text className="flex-1 font-mono text-sm text-foreground" selectable>
          {secretBase32}
        </Text>
        <CopyTextButton
          accessibilityLabel="Copy setup key"
          text={secretBase32}
          tintColor={iconColor}
          borderColor={borderColor}
        />
      </View>
    </View>
  );
}
