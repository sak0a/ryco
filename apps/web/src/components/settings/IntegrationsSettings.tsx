import {
  AGENT_CONTROL_CAPABILITIES,
  type AgentControlCapability,
  type AgentControlExternalClientKind,
  type AgentControlExternalIntegrationCreateInput,
  type AgentControlExternalIntegrationDetail,
  type AgentControlExternalProjectScope,
  ProjectId,
} from "@ryco/contracts";
import {
  applyExternalIntegrationList,
  applyExternalIntegrationPairing,
  emptyExternalIntegrationSettingsState,
  removeExternalIntegration,
} from "@ryco/client-runtime/state/settings";
import {
  CheckIcon,
  ClipboardIcon,
  KeyRoundIcon,
  Link2OffIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { readEnvironmentApi } from "../../environmentApi";
import { usePrimaryEnvironmentId } from "../../environments/primary";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { stackedThreadToast, toastManager } from "../ui/toast";

const CLIENT_LABELS: Record<AgentControlExternalClientKind, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
  "claude-desktop": "Claude Desktop",
  "generic-mcp": "Generic MCP",
};

const CAPABILITY_OPTIONS: ReadonlyArray<{
  readonly capability: AgentControlCapability;
  readonly label: string;
  readonly description: string;
}> = [
  {
    capability: AGENT_CONTROL_CAPABILITIES.externalListProjects,
    label: "List allowed projects",
    description: "Discover only projects inside this integration's scope.",
  },
  {
    capability: AGENT_CONTROL_CAPABILITIES.externalCreateTask,
    label: "Request tasks",
    description: "Submit one task to Ryco's normal approval queue.",
  },
  {
    capability: AGENT_CONTROL_CAPABILITIES.externalReadTask,
    label: "Read own tasks",
    description: "Read or wait only for tasks created by this integration.",
  },
  {
    capability: AGENT_CONTROL_CAPABILITIES.externalSharedCheckout,
    label: "Request shared checkout",
    description: "May request the local checkout; each request still needs approval.",
  },
  {
    capability: AGENT_CONTROL_CAPABILITIES.externalFullAccess,
    label: "Request full access",
    description: "May request a full-access runtime; each request still needs approval.",
  },
];

interface IntegrationForm {
  readonly displayName: string;
  readonly clientKind: AgentControlExternalClientKind;
  readonly scopeKind: "all" | "selected";
  readonly projectIds: string;
  readonly capabilities: ReadonlyArray<AgentControlCapability>;
  readonly expiresAt: string;
  readonly rateLimitPerMinute: string;
  readonly activeTaskLimit: string;
}

const emptyForm = (): IntegrationForm => ({
  displayName: "",
  clientKind: "codex",
  scopeKind: "all",
  projectIds: "",
  capabilities: [
    AGENT_CONTROL_CAPABILITIES.externalListProjects,
    AGENT_CONTROL_CAPABILITIES.externalCreateTask,
    AGENT_CONTROL_CAPABILITIES.externalReadTask,
  ],
  expiresAt: "",
  rateLimitPerMinute: "60",
  activeTaskLimit: "1",
});

function showFailure(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "The request failed.",
    }),
  );
}

function toCommand(command: string, args: ReadonlyArray<string>): string {
  return [command, ...args.map((arg) => JSON.stringify(arg))].join(" ");
}

function formatDate(value: string | null): string {
  return value === null ? "Never" : new Date(value).toLocaleString();
}

function statusFor(detail: AgentControlExternalIntegrationDetail): {
  readonly label: string;
  readonly variant: "success" | "warning" | "error" | "outline";
} {
  const integration = detail.integration;
  if (integration.revokedAt !== null) return { label: "Revoked", variant: "error" };
  if (integration.expiresAt !== null && Date.parse(integration.expiresAt) <= Date.now()) {
    return { label: "Expired", variant: "error" };
  }
  if (integration.pairingState === "paired") return { label: "Paired", variant: "success" };
  if (integration.pairingState === "pending") return { label: "Pairing", variant: "warning" };
  return { label: "Unpaired", variant: "outline" };
}

function formFromDetail(detail: AgentControlExternalIntegrationDetail): IntegrationForm {
  const integration = detail.integration;
  return {
    displayName: integration.displayName,
    clientKind: integration.clientKind,
    scopeKind: integration.projectScope.kind,
    projectIds:
      integration.projectScope.kind === "selected"
        ? integration.projectScope.projectIds.join(", ")
        : "",
    capabilities: integration.capabilities,
    expiresAt:
      integration.expiresAt === null
        ? ""
        : new Date(integration.expiresAt).toISOString().slice(0, 16),
    rateLimitPerMinute: String(integration.rateLimitPerMinute),
    activeTaskLimit: String(integration.activeTaskLimit),
  };
}

function parseForm(form: IntegrationForm): AgentControlExternalIntegrationCreateInput {
  const projectIds = form.projectIds
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => ProjectId.make(value));
  const projectScope: AgentControlExternalProjectScope =
    form.scopeKind === "all" ? { kind: "all" } : { kind: "selected", projectIds };
  const rateLimitPerMinute = Number(form.rateLimitPerMinute);
  const activeTaskLimit = Number(form.activeTaskLimit);
  if (!form.displayName.trim()) throw new Error("A display name is required.");
  if (form.scopeKind === "selected" && projectIds.length === 0) {
    throw new Error("Enter at least one project ID for selected-project scope.");
  }
  if (!Number.isInteger(rateLimitPerMinute) || rateLimitPerMinute < 1) {
    throw new Error("Rate limit must be a positive whole number.");
  }
  if (!Number.isInteger(activeTaskLimit) || activeTaskLimit < 1) {
    throw new Error("Active-task limit must be a positive whole number.");
  }
  return {
    displayName: form.displayName.trim(),
    clientKind: form.clientKind,
    projectScope,
    capabilities: form.capabilities,
    expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
    rateLimitPerMinute,
    activeTaskLimit,
  };
}

function IntegrationFormFields({
  form,
  onChange,
}: {
  readonly form: IntegrationForm;
  readonly onChange: (next: IntegrationForm) => void;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-xs font-medium">
          Display name
          <Input
            value={form.displayName}
            placeholder="Local Codex"
            onChange={(event) => onChange({ ...form, displayName: event.target.value })}
          />
        </label>
        <label className="grid gap-1.5 text-xs font-medium">
          Client
          <select
            className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
            value={form.clientKind}
            onChange={(event) =>
              onChange({
                ...form,
                clientKind: event.target.value as AgentControlExternalClientKind,
              })
            }
          >
            {Object.entries(CLIENT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="grid gap-2">
        <legend className="text-xs font-medium">Project scope</legend>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            checked={form.scopeKind === "all"}
            onChange={() => onChange({ ...form, scopeKind: "all" })}
          />
          <span>
            All current and future projects
            <span className="block text-xs text-muted-foreground">
              The client can discover every project on this local Ryco instance.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            checked={form.scopeKind === "selected"}
            onChange={() => onChange({ ...form, scopeKind: "selected" })}
          />
          <span className="min-w-0 flex-1">
            Selected projects
            <Input
              className="mt-1.5"
              value={form.projectIds}
              disabled={form.scopeKind !== "selected"}
              placeholder="project-id-1, project-id-2"
              aria-label="Selected project IDs"
              onChange={(event) => onChange({ ...form, projectIds: event.target.value })}
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              Comma-separated stable project IDs. Unknown IDs remain inaccessible.
            </span>
          </span>
        </label>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="text-xs font-medium">Capability grants</legend>
        {CAPABILITY_OPTIONS.map((option) => (
          <label key={option.capability} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.capabilities.includes(option.capability)}
              onChange={(event) =>
                onChange({
                  ...form,
                  capabilities: event.target.checked
                    ? [...form.capabilities, option.capability]
                    : form.capabilities.filter((value) => value !== option.capability),
                })
              }
            />
            <span>
              {option.label}
              <span className="block text-xs text-muted-foreground">{option.description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1.5 text-xs font-medium">
          Expires
          <Input
            type="datetime-local"
            value={form.expiresAt}
            onChange={(event) => onChange({ ...form, expiresAt: event.target.value })}
          />
          <span className="font-normal text-muted-foreground">Empty means no expiry.</span>
        </label>
        <label className="grid gap-1.5 text-xs font-medium">
          Requests per minute
          <Input
            type="number"
            min={1}
            max={600}
            value={form.rateLimitPerMinute}
            onChange={(event) => onChange({ ...form, rateLimitPerMinute: event.target.value })}
          />
        </label>
        <label className="grid gap-1.5 text-xs font-medium">
          Concurrent active tasks
          <Input
            type="number"
            min={1}
            max={32}
            value={form.activeTaskLimit}
            onChange={(event) => onChange({ ...form, activeTaskLimit: event.target.value })}
          />
        </label>
      </div>
    </div>
  );
}

export function ExternalIntegrationsSettings() {
  const environmentId = usePrimaryEnvironmentId();
  const [state, setState] = useState(emptyExternalIntegrationSettingsState);
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const api = useMemo(
    () => (environmentId === null ? undefined : readEnvironmentApi(environmentId)?.agentControl),
    [environmentId],
  );

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const result = await api.listIntegrations();
      setState((current) => applyExternalIntegrationList(current, result));
    } catch (error) {
      showFailure("Failed to load external integrations", error);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const copy = useCallback(async (label: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied((current) => (current === label ? null : current)), 1_500);
  }, []);

  const create = async () => {
    if (!api) return;
    try {
      setBusyId("new");
      const result = await api.createIntegration(parseForm(form));
      setState((current) => applyExternalIntegrationPairing(current, result));
      setForm(emptyForm());
      setCreating(false);
    } catch (error) {
      showFailure("Failed to create integration", error);
    } finally {
      setBusyId(null);
    }
  };

  const save = async (detail: AgentControlExternalIntegrationDetail) => {
    if (!api) return;
    try {
      setBusyId(detail.integration.integrationId);
      const values = parseForm(form);
      await api.updateIntegration({
        integrationId: detail.integration.integrationId,
        ...values,
      });
      setEditingId(null);
      await refresh();
    } catch (error) {
      showFailure("Failed to update integration", error);
    } finally {
      setBusyId(null);
    }
  };

  const resume = async (detail: AgentControlExternalIntegrationDetail) => {
    if (!api) return;
    const integrationId = detail.integration.integrationId;
    try {
      setBusyId(integrationId);
      const result = await api.resumeIntegrationPairing({ integrationId });
      setState((current) => applyExternalIntegrationPairing(current, result));
    } catch (error) {
      showFailure("Failed to resume pairing", error);
    } finally {
      setBusyId(null);
    }
  };

  const revoke = async (detail: AgentControlExternalIntegrationDetail) => {
    if (!api) return;
    const integrationId = detail.integration.integrationId;
    try {
      setBusyId(integrationId);
      await api.revokeIntegration({ integrationId });
      await refresh();
    } catch (error) {
      showFailure("Failed to revoke integration", error);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (detail: AgentControlExternalIntegrationDetail) => {
    if (!api) return;
    const integrationId = detail.integration.integrationId;
    if (!window.confirm(`Delete ${detail.integration.displayName}? This cannot be undone.`)) return;
    try {
      setBusyId(integrationId);
      const result = await api.deleteIntegration({ integrationId });
      if (result.deleted) setState((current) => removeExternalIntegration(current, integrationId));
    } catch (error) {
      showFailure("Failed to delete integration", error);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section data-testid="external-integrations" className="border-b bg-muted/10 p-6 sm:p-8">
      <div className="mx-auto grid w-full max-w-4xl gap-5">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <ShieldCheckIcon className="size-3.5" />
              Agent Control
            </div>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.01em]">External integrations</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground/80">
              Pair a local MCP client with a revocable identity. Every task request waits in Ryco
              for explicit user approval before a thread is created.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="icon"
              variant="outline"
              aria-label="Refresh integrations"
              onClick={() => void refresh()}
            >
              <RefreshCwIcon />
            </Button>
            <Button
              disabled={!api || !state.topology.available}
              onClick={() => {
                setEditingId(null);
                setForm(emptyForm());
                setCreating((value) => !value);
              }}
            >
              <PlusIcon />
              New integration
            </Button>
          </div>
        </header>

        {!state.topology.available ? (
          <div className="flex gap-3 rounded-xl border border-warning/30 bg-warning/8 p-4 text-sm">
            <Link2OffIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
            <div>
              <p className="font-medium">Local pairing is unavailable</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {state.topology.reason ?? "Ryco could not prove a direct loopback-only topology."}{" "}
                External setup fails closed while Ryco is remotely exposed or Hub-connected.
              </p>
            </div>
          </div>
        ) : null}

        {creating ? (
          <div className="grid gap-4 rounded-xl border bg-card p-4">
            <IntegrationFormFields form={form} onChange={setForm} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button disabled={busyId === "new"} onClick={() => void create()}>
                <KeyRoundIcon />
                Create and pair
              </Button>
            </div>
          </div>
        ) : null}

        {state.integrations.length === 0 && !creating ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No external integrations are configured.
          </div>
        ) : null}

        {state.integrations.map((detail) => {
          const integration = detail.integration;
          const status = statusFor(detail);
          const pairingCode = state.pairingCodes[integration.integrationId];
          const pairCommand = toCommand(
            detail.setup.pairCommand.command,
            detail.setup.pairCommand.args,
          );
          const isEditing = editingId === integration.integrationId;
          return (
            <article
              key={integration.integrationId}
              className="grid gap-4 rounded-xl border bg-card p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{integration.displayName}</h3>
                    <Badge variant={status.variant}>{status.label}</Badge>
                    <Badge variant="outline">{CLIENT_LABELS[integration.clientKind]}</Badge>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {integration.integrationId}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditingId(isEditing ? null : integration.integrationId);
                      setForm(formFromDetail(detail));
                    }}
                  >
                    {isEditing ? "Close editor" : "Edit"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      !state.topology.available ||
                      busyId === integration.integrationId ||
                      integration.revokedAt !== null
                    }
                    onClick={() => void resume(detail)}
                  >
                    <KeyRoundIcon />
                    Pair again
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      busyId === integration.integrationId || integration.revokedAt !== null
                    }
                    onClick={() => void revoke(detail)}
                  >
                    Revoke
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${integration.displayName}`}
                    disabled={busyId === integration.integrationId}
                    onClick={() => void remove(detail)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </div>

              {isEditing ? (
                <div className="grid gap-4 border-t pt-4">
                  <IntegrationFormFields form={form} onChange={setForm} />
                  <div className="flex justify-end">
                    <Button
                      disabled={busyId === integration.integrationId}
                      onClick={() => void save(detail)}
                    >
                      <SaveIcon />
                      Save changes
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid gap-3 text-xs sm:grid-cols-2">
                  <div>
                    <span className="text-muted-foreground">Project scope</span>
                    <p className="mt-0.5 break-words font-medium">
                      {integration.projectScope.kind === "all"
                        ? "All current and future projects"
                        : integration.projectScope.projectIds.join(", ")}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Limits</span>
                    <p className="mt-0.5 font-medium">
                      {integration.rateLimitPerMinute}/minute · {integration.activeTaskCount}/
                      {integration.activeTaskLimit} active
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Expiry</span>
                    <p className="mt-0.5 font-medium">{formatDate(integration.expiresAt)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Last used</span>
                    <p className="mt-0.5 font-medium">{formatDate(integration.lastUsedAt)}</p>
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-muted-foreground">Capabilities</span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {integration.capabilities.map((capability) => (
                        <Badge key={capability} variant="outline">
                          {capability}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {integration.pairingState === "pending" ? (
                <div className="grid gap-3 rounded-lg border bg-muted/20 p-3">
                  <div>
                    <p className="text-sm font-medium">Finish pairing locally</p>
                    <p className="text-xs text-muted-foreground">
                      Pairing code expires {formatDate(integration.pairingCodeExpiresAt)}. The code
                      is shown only for this ceremony; the generated MCP configuration never
                      contains it.
                    </p>
                  </div>
                  {pairingCode ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <code
                        data-testid="external-pairing-code"
                        className="rounded bg-background px-3 py-2 font-mono text-sm tracking-[0.18em]"
                      >
                        {pairingCode}
                      </code>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void copy(`code-${integration.integrationId}`, pairingCode)}
                      >
                        {copied === `code-${integration.integrationId}` ? (
                          <CheckIcon />
                        ) : (
                          <ClipboardIcon />
                        )}
                        Copy code
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-warning-foreground">
                      The pairing code is no longer displayed. Choose Pair again to generate a new
                      one.
                    </p>
                  )}
                  <div className="grid gap-1.5">
                    <span className="text-xs font-medium">
                      Run this bridge command, then enter the code
                    </span>
                    <div className="flex min-w-0 gap-2">
                      <code className="min-w-0 flex-1 overflow-x-auto rounded bg-background p-2 text-[11px]">
                        {pairCommand}
                      </code>
                      <Button
                        size="icon-sm"
                        variant="outline"
                        aria-label="Copy pairing command"
                        onClick={() => void copy(`pair-${integration.integrationId}`, pairCommand)}
                      >
                        {copied === `pair-${integration.integrationId}` ? (
                          <CheckIcon />
                        ) : (
                          <ClipboardIcon />
                        )}
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-1.5">
                    <span className="text-xs font-medium">MCP configuration</span>
                    <pre
                      data-testid="external-mcp-configuration"
                      className="max-h-48 overflow-auto rounded bg-background p-3 text-[11px] leading-relaxed"
                    >
                      {detail.setup.configuration}
                    </pre>
                    <Button
                      className="justify-self-start"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void copy(`config-${integration.integrationId}`, detail.setup.configuration)
                      }
                    >
                      {copied === `config-${integration.integrationId}` ? (
                        <CheckIcon />
                      ) : (
                        <ClipboardIcon />
                      )}
                      Copy configuration
                    </Button>
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
