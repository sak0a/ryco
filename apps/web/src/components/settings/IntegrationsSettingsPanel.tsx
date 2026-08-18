import { useSettings } from "../../hooks/useSettings";
import { ExternalIntegrationsSettings } from "./IntegrationsSettings";
import { McpServersSettings } from "./McpServersSettings";

export function IntegrationsSettingsPanel() {
  const enabled = useSettings((settings) => settings.agentControl.enabled);
  return (
    <div className="flex-1 overflow-y-auto">
      {enabled ? <ExternalIntegrationsSettings /> : null}
      <McpServersSettings />
    </div>
  );
}
