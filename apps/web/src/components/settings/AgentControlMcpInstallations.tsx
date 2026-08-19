import {
  type AgentControlExternalClientKind,
  type AgentControlMcpInstallation,
  type McpProviderSupport,
  type McpWorkspace,
} from "@ryco/contracts";
import {
  applyMcpInstallationList,
  applyMcpInstallationMutation,
  emptyMcpInstallationSettingsState,
} from "@ryco/client-runtime/state/settings";
import {
  BotIcon,
  CableIcon,
  CheckCircle2Icon,
  LoaderIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  UnplugIcon,
  WrenchIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { readEnvironmentApi } from "../../environmentApi";
import { usePrimaryEnvironmentId } from "../../environments/primary";
import { formatProviderDriverKindLabel } from "../../providerModels";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  AgentControlIntegrationFormFields,
  createAgentControlIntegrationForm,
  parseAgentControlIntegrationForm,
  type AgentControlIntegrationForm,
} from "./IntegrationsSettings";
import { getDriverOption } from "./providerDriverMeta";

const EMPTY_PROVIDERS: readonly McpProviderSupport[] = [];
const EMPTY_WORKSPACES: readonly McpWorkspace[] = [];

function providerLabel(provider: McpProviderSupport): string {
  return (
    provider.displayName ??
    getDriverOption(provider.driver)?.label ??
    formatProviderDriverKindLabel(provider.driver)
  );
}

function workspaceLabel(workspace: McpWorkspace): string {
  return (
    workspace.providerDisplayName ??
    getDriverOption(workspace.driver)?.label ??
    formatProviderDriverKindLabel(workspace.driver)
  );
}

function clientKindFor(workspace: McpWorkspace): AgentControlExternalClientKind {
  if (workspace.driver === "codex") return "codex";
  if (workspace.driver === "claudeAgent") return "claude-code";
  return "generic-mcp";
}

function formFor(workspace: McpWorkspace): AgentControlIntegrationForm {
  return {
    ...createAgentControlIntegrationForm(),
    displayName: `${workspaceLabel(workspace)} Agent Control`,
    clientKind: clientKindFor(workspace),
  };
}

function latestInstallation(
  installations: ReadonlyArray<AgentControlMcpInstallation>,
  workspaceId: McpWorkspace["id"],
): AgentControlMcpInstallation | undefined {
  return installations
    .filter((entry) => entry.workspaceId === workspaceId)
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

function installationStatus(installation: AgentControlMcpInstallation | undefined): {
  readonly label: string;
  readonly variant: "success" | "warning" | "error" | "outline";
} {
  if (!installation) return { label: "Not connected", variant: "outline" };
  switch (installation.state) {
    case "connected":
      return { label: "Connected", variant: "success" };
    case "repair-needed":
      return { label: "Needs repair", variant: "error" };
    case "disconnected":
    case "revoked":
      return { label: "Disconnected", variant: "outline" };
    case "disconnecting":
      return { label: "Disconnecting", variant: "warning" };
    case "planned":
    case "credential-written":
    case "provider-written":
    case "verifying":
      return { label: "Connecting", variant: "warning" };
  }
}

function successToast(title: string, description?: string) {
  toastManager.add(stackedThreadToast({ type: "success", title, description }));
}

function failureToast(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "The request failed.",
    }),
  );
}

export function AgentControlMcpInstallations() {
  const environmentId = usePrimaryEnvironmentId();
  const [providers, setProviders] = useState(EMPTY_PROVIDERS);
  const [workspaces, setWorkspaces] = useState(EMPTY_WORKSPACES);
  const [installations, setInstallations] = useState(emptyMcpInstallationSettingsState);
  const [topology, setTopology] = useState<{ available: boolean; reason: string | null } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [customizingId, setCustomizingId] = useState<string | null>(null);
  const [customForm, setCustomForm] = useState(createAgentControlIntegrationForm);

  const environmentApi = useMemo(
    () => (environmentId === null ? undefined : readEnvironmentApi(environmentId)),
    [environmentId],
  );
  const agentControlApi = environmentApi?.agentControl;
  const mcpApi = environmentApi?.mcp;

  const refresh = useCallback(async () => {
    if (!agentControlApi || !mcpApi) {
      setLoading(false);
      return;
    }
    try {
      const [workspaceResult, installationResult, integrationResult] = await Promise.all([
        mcpApi.listWorkspaces(),
        agentControlApi.listMcpInstallations(),
        agentControlApi.listIntegrations(),
      ]);
      setProviders(workspaceResult.providers);
      setWorkspaces(workspaceResult.workspaces);
      setInstallations((current) => applyMcpInstallationList(current, installationResult));
      setTopology(integrationResult.topology);
    } catch (error) {
      failureToast("Failed to load Agent Control providers", error);
    } finally {
      setLoading(false);
    }
  }, [agentControlApi, mcpApi]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connect = async (workspace: McpWorkspace, customized: boolean) => {
    if (!agentControlApi) return;
    try {
      setBusyId(workspace.id);
      const input = customized
        ? (() => {
            const { clientKind: _clientKind, ...settings } =
              parseAgentControlIntegrationForm(customForm);
            return { workspaceId: workspace.id, ...settings };
          })()
        : { workspaceId: workspace.id };
      const result = await agentControlApi.connectMcpInstallation(input);
      setInstallations((current) => applyMcpInstallationMutation(current, result));
      setCustomizingId(null);
      successToast(
        `${workspaceLabel(workspace)} connected`,
        "The credential was stored locally and was not shown to the browser.",
      );
    } catch (error) {
      failureToast(`Failed to connect ${workspaceLabel(workspace)}`, error);
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  const repair = async (workspace: McpWorkspace, installation: AgentControlMcpInstallation) => {
    if (!agentControlApi) return;
    try {
      setBusyId(workspace.id);
      const result = await agentControlApi.repairMcpInstallation({
        installationId: installation.installationId,
      });
      setInstallations((current) => applyMcpInstallationMutation(current, result));
      successToast(`${workspaceLabel(workspace)} repaired`);
    } catch (error) {
      failureToast(`Failed to repair ${workspaceLabel(workspace)}`, error);
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  const disconnect = async (workspace: McpWorkspace, installation: AgentControlMcpInstallation) => {
    if (!agentControlApi) return;
    if (!window.confirm(`Disconnect Agent Control from ${workspaceLabel(workspace)}?`)) return;
    try {
      setBusyId(workspace.id);
      const result = await agentControlApi.disconnectMcpInstallation({
        installationId: installation.installationId,
      });
      setInstallations((current) => applyMcpInstallationMutation(current, result));
      successToast(`${workspaceLabel(workspace)} disconnected`);
    } catch (error) {
      failureToast(`Failed to disconnect ${workspaceLabel(workspace)}`, error);
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  const installableWorkspaces = workspaces.filter(
    (workspace) => workspace.capabilities.externalAgentControl === "available",
  );

  return (
    <section
      data-testid="agent-control-mcp-installations"
      className="border-b bg-muted/10 p-6 sm:p-8"
    >
      <div className="mx-auto grid w-full max-w-4xl gap-8">
        <section className="grid gap-4">
          <header>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <BotIcon className="size-3.5" />
              Ryco sessions
            </div>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.01em]">Automatic inside Ryco</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground/80">
              Supported sessions started by Ryco receive Agent Control automatically. There is
              nothing to install in those provider profiles.
            </p>
          </header>

          {loading ? (
            <div className="flex items-center gap-2 rounded-xl border p-4 text-sm text-muted-foreground">
              <LoaderIcon className="size-4 animate-spin" /> Loading providers…
            </div>
          ) : providers.length === 0 ? (
            <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              No configured provider instances were found.
            </div>
          ) : (
            <div className="divide-y overflow-hidden rounded-xl border bg-card">
              {providers.map((provider) => {
                const driver = getDriverOption(provider.driver);
                const Icon = driver?.icon ?? BotIcon;
                const automatic =
                  provider.enabled && provider.capabilities.automaticAgentControl === "available";
                return (
                  <div
                    key={provider.instanceId}
                    className="flex items-start justify-between gap-4 px-4 py-3"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background">
                        <Icon className="size-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{providerLabel(provider)}</p>
                        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                          {provider.instanceId}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {automatic
                            ? "Available in every new Ryco-managed session."
                            : provider.enabled
                              ? "This provider does not expose automatic Agent Control yet."
                              : "This provider instance is disabled."}
                        </p>
                      </div>
                    </div>
                    <Badge variant={automatic ? "success" : "outline"}>
                      {automatic ? "Automatic" : provider.enabled ? "Unavailable" : "Disabled"}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="grid gap-4">
          <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                <CableIcon className="size-3.5" />
                External agents
              </div>
              <h2 className="mt-1 text-lg font-semibold tracking-[-0.01em]">
                Connect an installed provider
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground/80">
                Ryco detects local provider profiles and writes their native MCP configuration. The
                default grants project listing and task request/read access, limited to 60 requests
                per minute and one active task. Every task still requires approval.
              </p>
            </div>
            <Button
              size="icon"
              variant="outline"
              aria-label="Refresh Agent Control providers"
              disabled={loading}
              onClick={() => void refresh()}
            >
              <RefreshCwIcon />
            </Button>
          </header>

          {topology && !topology.available ? (
            <div className="flex gap-3 rounded-xl border border-warning/30 bg-warning/8 p-4 text-sm">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
              <div>
                <p className="font-medium">Local installation is unavailable</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {topology.reason ?? "Ryco could not prove a direct loopback-only topology."}
                </p>
              </div>
            </div>
          ) : null}

          {!loading && (!agentControlApi || !mcpApi) ? (
            <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              This Ryco environment does not expose provider MCP installation yet.
            </div>
          ) : !loading && installableWorkspaces.length === 0 ? (
            <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              No installable provider profiles were detected. Configure a supported provider
              instance first, then refresh.
            </div>
          ) : (
            <div className="grid gap-3">
              {installableWorkspaces.map((workspace) => {
                const installation = latestInstallation(installations.installations, workspace.id);
                const status = installationStatus(installation);
                const connected = installation?.state === "connected";
                const repairNeeded = installation?.state === "repair-needed";
                const working = busyId === workspace.id;
                const customizable = customizingId === workspace.id;
                const driver = getDriverOption(workspace.driver);
                const Icon = driver?.icon ?? CableIcon;

                return (
                  <article key={workspace.id} className="grid gap-4 rounded-xl border bg-card p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background">
                          <Icon className="size-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-semibold">{workspaceLabel(workspace)}</h3>
                            <Badge variant={status.variant}>{status.label}</Badge>
                          </div>
                          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                            {workspace.displayPath}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {workspace.providerInstances.length} configured provider
                            {workspace.providerInstances.length === 1 ? " instance" : " instances"}
                            {installation ? ` · MCP name ${installation.serverName}` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                        {repairNeeded && installation ? (
                          <Button
                            size="sm"
                            disabled={working || topology?.available === false}
                            onClick={() => void repair(workspace, installation)}
                          >
                            {working ? <LoaderIcon className="animate-spin" /> : <WrenchIcon />}
                            Repair
                          </Button>
                        ) : connected && installation ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={working}
                            onClick={() => void disconnect(workspace, installation)}
                          >
                            {working ? <LoaderIcon className="animate-spin" /> : <UnplugIcon />}
                            Disconnect
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={working || topology?.available === false}
                              onClick={() => {
                                if (customizable) {
                                  setCustomizingId(null);
                                } else {
                                  setCustomForm(formFor(workspace));
                                  setCustomizingId(workspace.id);
                                }
                              }}
                            >
                              {customizable ? "Close" : "Customize"}
                            </Button>
                            <Button
                              size="sm"
                              disabled={working || topology?.available === false}
                              onClick={() => void connect(workspace, false)}
                            >
                              {working ? (
                                <LoaderIcon className="animate-spin" />
                              ) : (
                                <CheckCircle2Icon />
                              )}
                              Connect
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    {installation?.lastError ? (
                      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                        {installation.lastError}
                      </div>
                    ) : null}
                    {installation?.preservedUserChanges ? (
                      <div className="rounded-lg border border-warning/30 bg-warning/8 p-3 text-xs text-warning-foreground">
                        Ryco left this provider&apos;s MCP entry untouched because it had been
                        edited after installation.
                      </div>
                    ) : null}

                    {customizable ? (
                      <div className="grid gap-4 border-t pt-4">
                        <p className="text-xs text-muted-foreground">
                          Customize the credential scope and limits before Ryco installs it. The
                          provider profile is fixed to this detected workspace.
                        </p>
                        <AgentControlIntegrationFormFields
                          form={customForm}
                          onChange={setCustomForm}
                          clientLocked
                        />
                        <div className="flex justify-end">
                          <Button
                            disabled={working || topology?.available === false}
                            onClick={() => void connect(workspace, true)}
                          >
                            {working ? <LoaderIcon className="animate-spin" /> : <CableIcon />}
                            Connect with these permissions
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
