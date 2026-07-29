import { ArrowUpRightIcon, ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import type {
  DesktopHubLaunchConfig,
  HubConnectorStatus,
  HubIdentitySummary,
} from "@ryco/contracts";

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";

export function canChangeHubFileSecretStore(
  config: DesktopHubLaunchConfig | null,
  identity: HubIdentitySummary | null,
): boolean {
  if (config === null || identity === null || !config.fileSecretStoreFallbackSupported) {
    return false;
  }
  if (identity.enrolled === "none") return true;
  return identity.enrolled === "unknown" && !config.allowFileSecretStore;
}

function fallbackDescription(
  config: DesktopHubLaunchConfig | null,
  identity: HubIdentitySummary | null,
): string {
  if (config === null || identity === null) {
    return "Loading local launch configuration and identity state.";
  }
  if (!config.fileSecretStoreFallbackSupported) {
    return "Unavailable on Windows. Ryco requires the system credential store on this host.";
  }
  if (identity.enrolled === "active" || identity.enrolled === "pending") {
    return "Locked while this machine holds Hub identity material. Leave the Hub before changing it.";
  }
  if (identity.enrolled === "unknown") {
    return config.allowFileSecretStore
      ? "Identity custody is unreadable, so an enabled fallback cannot be turned off."
      : "Enable this only as a recovery action when an existing file-backed identity cannot be read.";
  }
  return "Ryco still prefers the system credential store. This only permits the hardened POSIX file fallback when that store is unavailable.";
}

function formatQueuedBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
}

function diagnosticValues(
  status: HubConnectorStatus | null,
  nowMs: number,
): ReadonlyArray<{ readonly label: string; readonly value: string }> {
  if (status === null) {
    return [
      { label: "Protocol", value: "Loading" },
      { label: "Channels", value: "Loading" },
      { label: "Relay queue", value: "Loading" },
      { label: "Reconnect", value: "Loading" },
    ];
  }
  const protocol =
    status.state === "online" &&
    status.protocolMajor !== undefined &&
    status.protocolMinor !== undefined
      ? `${status.protocolMajor}.${status.protocolMinor}`
      : "Not negotiated";
  const reconnect =
    status.nextRetryAt !== undefined
      ? `Attempt ${status.reconnectAttempt ?? 0}, ${Math.max(
          0,
          Math.ceil((Date.parse(status.nextRetryAt) - nowMs) / 1000),
        )}s`
      : status.reconnectAttempt !== undefined
        ? `Attempt ${status.reconnectAttempt}`
        : "Not scheduled";
  return [
    { label: "Protocol", value: protocol },
    { label: "Channels", value: String(status.activeChannels) },
    { label: "Relay queue", value: formatQueuedBytes(status.queuedBytes) },
    { label: "Reconnect", value: reconnect },
  ];
}

export function HubAdvancedOptions({
  config,
  identity,
  status,
  nowMs,
  savingFileFallback,
  configError,
  onFileFallbackChange,
  onOpenGuide,
}: {
  readonly config: DesktopHubLaunchConfig | null;
  readonly identity: HubIdentitySummary | null;
  readonly status: HubConnectorStatus | null;
  readonly nowMs: number;
  readonly savingFileFallback: boolean;
  readonly configError: string | null;
  readonly onFileFallbackChange: (enabled: boolean) => void;
  readonly onOpenGuide: () => void;
}) {
  const [open, setOpen] = useState(false);
  const canChangeFallback = canChangeHubFileSecretStore(config, identity);
  const diagnostics = diagnosticValues(status, nowMs);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-4 border-t border-border/60 px-4 py-3.5 text-left transition-colors hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5">
        <span>
          <span className="block text-[13px] font-semibold tracking-[-0.01em] text-foreground">
            {open ? "Hide advanced options" : "Show advanced options"}
          </span>
          <span className="mt-1 block text-xs text-muted-foreground/80">
            Key custody, startup ownership, CLI flags, and bounded relay diagnostics.
          </span>
          {configError ? (
            <span className="mt-1 block text-[11px] text-destructive">{configError}</span>
          ) : null}
        </span>
        <ChevronDownIcon
          className={`size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </CollapsibleTrigger>

      <CollapsiblePanel className="motion-reduce:transition-none">
        <div className="border-t border-border/60 bg-muted/10">
          <SettingsRow
            title="Protected key fallback"
            description={fallbackDescription(config, identity)}
            status="Changing this launch setting restarts Ryco. It never moves or exports an existing key."
            control={
              <Switch
                checked={config?.allowFileSecretStore ?? false}
                disabled={!canChangeFallback || savingFileFallback}
                onCheckedChange={(checked) => onFileFallbackChange(Boolean(checked))}
                aria-label="Allow permissioned-file Hub key storage"
              />
            }
          />

          <SettingsRow
            title="Who owns startup"
            description="The desktop app owns Hub launch values for its bundled server and restarts that server to apply them. Exported Hub environment variables do not override this panel."
            status="The Hub address stays outside ordinary server settings, diagnostics, and support output."
          />

          <SettingsRow
            title="CLI equivalents"
            description="Use these flags for a headless Ryco node. Explicit flags override matching environment variables."
            status="Boolean flags also support canonical --no-... forms. --restrict-to-cwd is separate workspace confinement, not a relay setting."
          >
            <div className="pb-3.5 pt-3">
              <pre className="overflow-x-auto rounded-lg border border-border/60 bg-background/70 px-3 py-2.5 font-mono text-[11px] leading-5 text-foreground">
                <code>
                  {
                    "ryco serve \\\n  --hub-connector-enabled \\\n  --hub-origin https://staging.ryco.space\n\n# Optional on supported POSIX hosts\nryco serve --hub-allow-file-secret-store"
                  }
                </code>
              </pre>
            </div>
          </SettingsRow>

          <SettingsRow
            title="Relay diagnostics"
            description="Bounded local counters only. No Hub address, key, ticket, project, path, or payload is exposed here."
            control={
              <Button size="xs" variant="outline" onClick={onOpenGuide}>
                Open relay guide
                <ArrowUpRightIcon className="size-3" />
              </Button>
            }
          >
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 pb-3.5 pt-3 sm:grid-cols-4">
              {diagnostics.map((item) => (
                <div key={item.label} className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/65">
                    {item.label}
                  </dt>
                  <dd className="mt-1 truncate font-mono text-[11px] text-foreground">
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
          </SettingsRow>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
