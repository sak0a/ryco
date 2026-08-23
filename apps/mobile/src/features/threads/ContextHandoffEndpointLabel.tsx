import type { ContextHandoffEndpointSnapshot } from "@ryco/contracts";
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { ProviderIcon } from "../../components/ProviderIcon";
import {
  contextHandoffEndpointAccessibleLabel,
  contextHandoffModelLabel,
} from "./contextHandoffModel";

export function ContextHandoffEndpointLabel(props: {
  readonly endpoint: ContextHandoffEndpointSnapshot;
  readonly emphasized?: boolean;
}) {
  return (
    <View
      accessibilityLabel={contextHandoffEndpointAccessibleLabel(props.endpoint)}
      className="min-w-0 flex-row items-center gap-1"
    >
      <ProviderIcon provider={props.endpoint.driverKind} size={13} />
      <Text
        className={`shrink text-[11px] ${props.emphasized ? "font-ryco-medium text-foreground" : "text-foreground-muted"}`}
        numberOfLines={1}
      >
        {contextHandoffModelLabel(props.endpoint)}
      </Text>
    </View>
  );
}
