import { WS_METHODS } from "@ryco/contracts";

import { useHostedRpcCapability } from "../../hostedHub/capabilities";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { Switch } from "../ui/switch";
import { ExternalIntegrationsSettings } from "./IntegrationsSettings";
import { McpServersSettings } from "./McpServersSettings";

export function IntegrationsSettingsPanel() {
  const enabled = useSettings((settings) => settings.agentControl.enabled);
  const { updateSettings } = useUpdateSettings();
  const settingsCapability = useHostedRpcCapability(WS_METHODS.serverUpdateSettings);

  return (
    <div className="flex-1 overflow-y-auto">
      <section className="border-b bg-muted/10 p-6 sm:p-8">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Agent Control
            </div>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.01em]">Private agent MCP</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground/80">
              Give supported provider sessions Ryco&apos;s private control tools. Every requested
              change still waits for explicit approval.
            </p>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              {enabled
                ? "Enabled. Start a new supported provider session to receive the tools."
                : "Disabled. The private endpoint is not exposed to browsers, remote connections, or external clients."}
            </p>
            {!settingsCapability.allowed && settingsCapability.reason ? (
              <p className="mt-2 max-w-2xl text-xs leading-relaxed text-destructive">
                {settingsCapability.reason}
              </p>
            ) : null}
          </div>
          <Switch
            checked={enabled}
            disabled={!settingsCapability.allowed}
            onCheckedChange={(checked) =>
              updateSettings({ agentControl: { enabled: Boolean(checked) } })
            }
            aria-label="Enable Agent Control"
          />
        </div>
      </section>
      {enabled ? <ExternalIntegrationsSettings /> : null}
      <McpServersSettings />
    </div>
  );
}
