import {
  isProviderDriverKind,
  type ProviderDriverKind,
  type ProviderInstanceConfig,
  type ServerProvider,
} from "@ryco/contracts";

import { normalizeProviderAccentColor } from "../../providerInstances";
import type { DriverOption } from "./providerDriverMeta";
import { getProviderSummary, type ProviderStatusKey } from "./providerStatus";

export function deriveProviderInstancePresentation(input: {
  readonly instance: ProviderInstanceConfig;
  readonly driverOption: DriverOption | undefined;
  readonly liveProvider: ServerProvider | undefined;
}) {
  const enabled = input.instance.enabled ?? true;
  const statusKey: ProviderStatusKey =
    (input.liveProvider?.status as ProviderStatusKey | undefined) ??
    (enabled ? "warning" : "disabled");
  const displayName =
    input.instance.displayName?.trim() ||
    input.driverOption?.label ||
    String(input.instance.driver);
  const driverKind: ProviderDriverKind | null = isProviderDriverKind(input.instance.driver)
    ? input.instance.driver
    : null;

  return {
    enabled,
    statusKey,
    displayName,
    driverKind,
    accentColor: normalizeProviderAccentColor(input.instance.accentColor),
    summary: getProviderSummary(input.liveProvider),
  };
}
