import {
  CheckCircle2Icon,
  ChevronDownIcon,
  Globe2Icon,
  LoaderIcon,
  LogInIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  ServerIcon,
  TerminalIcon,
  Trash2Icon,
  TriangleAlertIcon,
  WrenchIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  McpServerName,
  McpWorkspaceId,
  type McpListServersResult,
  type McpListWorkspacesResult,
  type McpProviderSupport,
  type McpServer,
  type McpWorkspace,
} from "@ryco/contracts";

import { cn } from "../../lib/utils";
import { ensureLocalApi } from "../../localApi";
import {
  configFromMcpServerForm,
  createEmptyMcpServerForm,
  formFromMcpServer,
  summarizeMcpServerConnection,
  validateMcpServerForm,
  type McpServerFormState,
} from "../../mcpServers";
import { formatProviderDriverKindLabel } from "../../providerModels";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { getDriverOption } from "./providerDriverMeta";

type McpApi = NonNullable<ReturnType<typeof ensureLocalApi>["mcp"]>;
const EMPTY_WORKSPACES: readonly McpWorkspace[] = [];
const EMPTY_PROVIDERS: readonly McpProviderSupport[] = [];

function getMcpApi(): McpApi {
  const api = ensureLocalApi().mcp;
  if (!api) {
    throw new Error("MCP settings are unavailable before a backend is paired.");
  }
  return api;
}

function showErrorToast(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

function sourceLabel(source: McpServer["source"]): string {
  switch (source) {
    case "user":
      return "User config";
    case "project":
      return "Project";
    case "system":
      return "System";
    case "managed":
      return "Managed";
    case "mixed":
      return "Mixed";
    case "unknown":
      return "Unknown";
  }
}

function statusVariant(server: McpServer): "success" | "warning" | "error" | "outline" {
  if (server.startupStatus === "failed") return "error";
  if (server.startupStatus === "disabled") return "outline";
  if (server.authStatus === "notLoggedIn") return "warning";
  if (server.startupStatus === "ready") return "success";
  return "outline";
}

function statusLabel(server: McpServer): string {
  if (server.startupStatus === "disabled") return "Disabled";
  if (server.startupStatus === "failed") return "Failed";
  if (server.authStatus === "notLoggedIn") return "Login needed";
  if (server.startupStatus === "ready") return "Ready";
  return "Unknown";
}

function providerSupportVariant(provider: McpProviderSupport): "success" | "warning" | "outline" {
  if (!provider.enabled) return "outline";
  if (provider.status === "managed") return "success";
  if (provider.status === "external") return "warning";
  return "outline";
}

function providerSupportLabel(provider: McpProviderSupport): string {
  if (!provider.enabled) return "Disabled";
  switch (provider.status) {
    case "managed":
      return "Managed";
    case "external":
      return "External config";
    case "unsupported":
      return "Not wired";
  }
}

function providerDisplayName(provider: McpProviderSupport): string {
  return (
    provider.displayName ??
    getDriverOption(provider.driver)?.label ??
    formatProviderDriverKindLabel(provider.driver)
  );
}

function FieldLabel(props: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-xs font-medium text-foreground/80">
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

function TextareaHelp({ children }: { readonly children: React.ReactNode }) {
  return <p className="text-[11px] leading-relaxed text-muted-foreground/70">{children}</p>;
}

function TransportToggle({
  value,
  onChange,
}: {
  readonly value: "stdio" | "http";
  readonly onChange: (value: "stdio" | "http") => void;
}) {
  return (
    <div className="grid grid-cols-2 rounded-lg border bg-muted/30 p-1">
      {[
        { value: "stdio" as const, label: "Stdio", icon: TerminalIcon },
        { value: "http" as const, label: "HTTP", icon: Globe2Icon },
      ].map((option) => {
        const Icon = option.icon;
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "flex h-8 items-center justify-center gap-2 rounded-md text-xs font-medium transition-colors",
              active ? "bg-background text-foreground shadow-xs" : "text-muted-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function McpServerDialog({
  open,
  server,
  onOpenChange,
  onSubmit,
}: {
  readonly open: boolean;
  readonly server: McpServer | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (form: McpServerFormState) => Promise<void>;
}) {
  const [form, setForm] = useState<McpServerFormState>(() => createEmptyMcpServerForm());
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editing = server !== null;

  useEffect(() => {
    if (!open) return;
    setForm(server ? formFromMcpServer(server) : createEmptyMcpServerForm());
    setValidationError(null);
  }, [open, server]);

  const setField = <K extends keyof McpServerFormState>(key: K, value: McpServerFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = async () => {
    const error = validateMcpServerForm(form);
    if (error) {
      setValidationError(error);
      return;
    }
    setSaving(true);
    try {
      await onSubmit(form);
      onOpenChange(false);
    } catch (cause) {
      showErrorToast("Failed to save MCP server", cause);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-2xl" bottomStickOnMobile={false}>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit MCP server" : "Add MCP server"}</DialogTitle>
          <DialogDescription>
            Configuration is written to the selected Codex config and reloaded after save.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
            <FieldLabel label="Server name">
              <Input
                value={form.name}
                disabled={editing}
                onChange={(event) => setField("name", event.target.value)}
                placeholder="github"
                spellCheck={false}
              />
            </FieldLabel>
            <FieldLabel label="Transport">
              <TransportToggle
                value={form.transport}
                onChange={(value) => setField("transport", value)}
              />
            </FieldLabel>
          </div>

          {form.transport === "stdio" ? (
            <div className="grid gap-4">
              <FieldLabel label="Command">
                <Input
                  value={form.command}
                  onChange={(event) => setField("command", event.target.value)}
                  placeholder="npx"
                  spellCheck={false}
                />
              </FieldLabel>
              <FieldLabel label="Arguments">
                <Textarea
                  value={form.argsText}
                  onChange={(event) => setField("argsText", event.target.value)}
                  placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/tmp/project"}
                  spellCheck={false}
                />
                <TextareaHelp>One argument per line.</TextareaHelp>
              </FieldLabel>
              <FieldLabel label="Working directory">
                <Input
                  value={form.cwd}
                  onChange={(event) => setField("cwd", event.target.value)}
                  placeholder="/path/to/project"
                  spellCheck={false}
                />
              </FieldLabel>
            </div>
          ) : (
            <div className="grid gap-4">
              <FieldLabel label="URL">
                <Input
                  value={form.url}
                  onChange={(event) => setField("url", event.target.value)}
                  placeholder="https://mcp.example.com/mcp"
                  spellCheck={false}
                />
              </FieldLabel>
              <FieldLabel label="Bearer token env var">
                <Input
                  value={form.bearerTokenEnvVar}
                  onChange={(event) => setField("bearerTokenEnvVar", event.target.value)}
                  placeholder="MCP_TOKEN"
                  spellCheck={false}
                />
              </FieldLabel>
              <FieldLabel label="HTTP headers">
                <Textarea
                  value={form.httpHeadersText}
                  onChange={(event) => setField("httpHeadersText", event.target.value)}
                  placeholder="X-Client=ryco"
                  spellCheck={false}
                />
                <TextareaHelp>Static headers as KEY=VALUE lines.</TextareaHelp>
              </FieldLabel>
              <FieldLabel label="Env-backed HTTP headers">
                <Textarea
                  value={form.envHttpHeadersText}
                  onChange={(event) => setField("envHttpHeadersText", event.target.value)}
                  placeholder="Authorization=GITHUB_TOKEN"
                  spellCheck={false}
                />
                <TextareaHelp>Header name to environment variable name, one per line.</TextareaHelp>
              </FieldLabel>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <FieldLabel label="Environment values">
              <Textarea
                value={form.envText}
                onChange={(event) => setField("envText", event.target.value)}
                placeholder="API_BASE=https://example.com"
                spellCheck={false}
              />
              <TextareaHelp>KEY=VALUE lines stored in Codex config.</TextareaHelp>
            </FieldLabel>
            <FieldLabel label="Environment allow-list">
              <Textarea
                value={form.envVarsText}
                onChange={(event) => setField("envVarsText", event.target.value)}
                placeholder={"GITHUB_TOKEN\nSENTRY_AUTH_TOKEN"}
                spellCheck={false}
              />
              <TextareaHelp>One env var name per line.</TextareaHelp>
            </FieldLabel>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FieldLabel label="Startup timeout seconds">
              <Input
                value={form.startupTimeoutSec}
                onChange={(event) => setField("startupTimeoutSec", event.target.value)}
                inputMode="decimal"
                placeholder="10"
              />
            </FieldLabel>
            <FieldLabel label="Tool timeout seconds">
              <Input
                value={form.toolTimeoutSec}
                onChange={(event) => setField("toolTimeoutSec", event.target.value)}
                inputMode="decimal"
                placeholder="60"
              />
            </FieldLabel>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <FieldLabel label="Enabled tools">
              <Textarea
                value={form.enabledToolsText}
                onChange={(event) => setField("enabledToolsText", event.target.value)}
                spellCheck={false}
              />
            </FieldLabel>
            <FieldLabel label="Disabled tools">
              <Textarea
                value={form.disabledToolsText}
                onChange={(event) => setField("disabledToolsText", event.target.value)}
                spellCheck={false}
              />
            </FieldLabel>
            <FieldLabel label="OAuth scopes">
              <Textarea
                value={form.oauthScopesText}
                onChange={(event) => setField("oauthScopesText", event.target.value)}
                spellCheck={false}
              />
            </FieldLabel>
          </div>

          <div className="flex flex-wrap items-center gap-5 border-t pt-4">
            <label className="flex items-center gap-2 text-xs font-medium text-foreground/80">
              <Switch
                checked={form.enabled}
                onCheckedChange={(value) => setField("enabled", Boolean(value))}
              />
              Enabled
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-foreground/80">
              <Switch
                checked={form.required}
                onCheckedChange={(value) => setField("required", Boolean(value))}
              />
              Required
            </label>
          </div>

          {validationError ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/6 px-3 py-2 text-xs text-destructive-foreground">
              <TriangleAlertIcon className="mt-0.5 size-3.5" />
              <span>{validationError}</span>
            </div>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? <LoaderIcon className="animate-spin" /> : <SaveIcon />}
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function WorkspaceSelect({
  workspaces,
  selectedWorkspaceId,
  onChange,
}: {
  readonly workspaces: readonly McpWorkspace[];
  readonly selectedWorkspaceId: string | null;
  readonly onChange: (workspaceId: string) => void;
}) {
  if (workspaces.length <= 1 || !selectedWorkspaceId) return null;
  const selected = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);

  return (
    <Select
      value={selectedWorkspaceId}
      onValueChange={(workspaceId) => {
        if (workspaceId) onChange(workspaceId);
      }}
    >
      <SelectTrigger className="w-full sm:w-72" aria-label="MCP workspace">
        <SelectValue>{selected?.displayPath ?? "Select workspace"}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {workspaces.map((workspace) => (
          <SelectItem hideIndicator key={workspace.id} value={workspace.id}>
            <span className="truncate">{workspace.displayPath}</span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function ProviderSupportSection({
  providers,
  selectedWorkspaceId,
  onSelectWorkspace,
}: {
  readonly providers: readonly McpProviderSupport[];
  readonly selectedWorkspaceId: string | null;
  readonly onSelectWorkspace: (workspaceId: string) => void;
}) {
  if (providers.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm/4">
      <div className="border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Provider MCP support</h3>
      </div>
      <div className="divide-y">
        {providers.map((provider) => {
          const driverOption = getDriverOption(provider.driver);
          const Icon = driverOption?.icon ?? ServerIcon;
          const workspaceSelected =
            provider.workspaceId !== undefined && provider.workspaceId === selectedWorkspaceId;
          const canSelectWorkspace = provider.workspaceId !== undefined && !workspaceSelected;

          return (
            <div
              key={provider.instanceId}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-3">
                <div className="relative mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background">
                  <Icon className="size-4 text-muted-foreground" />
                  {provider.accentColor ? (
                    <span
                      className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border border-background"
                      style={{ backgroundColor: provider.accentColor }}
                    />
                  ) : null}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium">{providerDisplayName(provider)}</span>
                    <span className="font-mono text-[11px] text-muted-foreground/70">
                      {provider.instanceId}
                    </span>
                  </div>
                  <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground/80">
                    {provider.message}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                <Badge variant={providerSupportVariant(provider)}>
                  {providerSupportLabel(provider)}
                </Badge>
                {provider.workspaceId ? (
                  <Button
                    size="xs"
                    variant={workspaceSelected ? "secondary" : "outline"}
                    disabled={!canSelectWorkspace}
                    onClick={() => {
                      if (provider.workspaceId) onSelectWorkspace(provider.workspaceId);
                    }}
                  >
                    Codex workspace
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function InventoryList({ server }: { readonly server: McpServer }) {
  if (
    server.tools.length === 0 &&
    server.resources.length === 0 &&
    server.resourceTemplates.length === 0
  ) {
    return <p className="text-xs text-muted-foreground/70">No tools or resources reported.</p>;
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div>
        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Tools
        </h4>
        <div className="space-y-1">
          {server.tools.slice(0, 12).map((tool) => (
            <div key={tool.name} className="rounded-md border bg-background/60 px-2 py-1.5">
              <div className="truncate text-xs font-medium">{tool.title ?? tool.name}</div>
              {tool.description ? (
                <div className="line-clamp-2 text-[11px] text-muted-foreground/75">
                  {tool.description}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <div>
        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Resources
        </h4>
        <div className="space-y-1">
          {server.resources.slice(0, 10).map((resource) => (
            <div key={resource.uri} className="rounded-md border bg-background/60 px-2 py-1.5">
              <div className="truncate text-xs font-medium">{resource.title ?? resource.name}</div>
              <div className="truncate text-[11px] text-muted-foreground/75">{resource.uri}</div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Templates
        </h4>
        <div className="space-y-1">
          {server.resourceTemplates.slice(0, 10).map((template) => (
            <div
              key={template.uriTemplate}
              className="rounded-md border bg-background/60 px-2 py-1.5"
            >
              <div className="truncate text-xs font-medium">{template.title ?? template.name}</div>
              <div className="truncate text-[11px] text-muted-foreground/75">
                {template.uriTemplate}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function McpServerCard({
  server,
  mutating,
  onToggleEnabled,
  onEdit,
  onRemove,
  onOauthLogin,
}: {
  readonly server: McpServer;
  readonly mutating: boolean;
  readonly onToggleEnabled: (server: McpServer, enabled: boolean) => void;
  readonly onEdit: (server: McpServer) => void;
  readonly onRemove: (server: McpServer) => void;
  readonly onOauthLogin: (server: McpServer) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const connection = summarizeMcpServerConnection(server);
  const inventoryLabel = `${server.tools.length} tools · ${server.resources.length + server.resourceTemplates.length} resources`;

  return (
    <article className="rounded-lg border bg-card text-card-foreground shadow-sm/4">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {server.config.transport === "http" ? (
                <Globe2Icon className="size-4 text-muted-foreground" />
              ) : (
                <TerminalIcon className="size-4 text-muted-foreground" />
              )}
              <h3 className="truncate text-sm font-semibold">{server.name}</h3>
            </div>
            <Badge variant={statusVariant(server)}>{statusLabel(server)}</Badge>
            <Badge variant="outline">{sourceLabel(server.source)}</Badge>
          </div>
          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground/80">
            {connection}
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <span>{server.config.transport.toUpperCase()}</span>
            <span>{inventoryLabel}</span>
            <span>Auth: {server.authStatus}</span>
          </div>
          {server.error ? <p className="mt-2 text-xs text-destructive">{server.error}</p> : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {server.authStatus === "notLoggedIn" ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="outline"
                    disabled={mutating}
                    onClick={() => onOauthLogin(server)}
                    aria-label={`Log in to ${server.name}`}
                  >
                    <LogInIcon />
                  </Button>
                }
              />
              <TooltipPopup>Start OAuth login</TooltipPopup>
            </Tooltip>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => onEdit(server)} disabled={mutating}>
            Edit
          </Button>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="destructive-outline"
                  disabled={mutating}
                  onClick={() => onRemove(server)}
                  aria-label={`Remove ${server.name}`}
                >
                  <Trash2Icon />
                </Button>
              }
            />
            <TooltipPopup>Remove server</TooltipPopup>
          </Tooltip>
          <Switch
            checked={server.config.enabled}
            disabled={mutating}
            onCheckedChange={(checked) => onToggleEnabled(server, Boolean(checked))}
            aria-label={`Enable ${server.name}`}
          />
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => setExpanded((current) => !current)}
            aria-label={`Toggle ${server.name} inventory`}
          >
            <ChevronDownIcon className={cn("transition-transform", expanded && "rotate-180")} />
          </Button>
        </div>
      </div>

      {expanded ? (
        <div className="border-t bg-muted/20 p-4">
          <InventoryList server={server} />
        </div>
      ) : null}
    </article>
  );
}

export function McpServersSettings() {
  const [workspacesResult, setWorkspacesResult] = useState<McpListWorkspacesResult | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<McpListServersResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mutatingName, setMutatingName] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const workspaces = workspacesResult?.workspaces ?? EMPTY_WORKSPACES;
  const providers = workspacesResult?.providers ?? EMPTY_PROVIDERS;
  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces],
  );

  const loadServers = useCallback(async (workspaceId: string, options?: { quiet?: boolean }) => {
    if (!options?.quiet) setRefreshing(true);
    setError(null);
    try {
      const result = await getMcpApi().listServers({
        workspaceId: McpWorkspaceId.make(workspaceId),
        detail: "full",
      });
      setSnapshot(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load MCP servers.");
      showErrorToast("Failed to load MCP servers", cause);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const loadWorkspaces = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getMcpApi().listWorkspaces();
      setWorkspacesResult(result);
      const nextSelected =
        result.workspaces.find((workspace) => workspace.id === selectedWorkspaceId)?.id ??
        result.workspaces[0]?.id ??
        null;
      setSelectedWorkspaceId(nextSelected);
      if (nextSelected) {
        await loadServers(nextSelected, { quiet: true });
      } else {
        setSnapshot(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load MCP workspaces.");
      showErrorToast("Failed to load MCP workspaces", cause);
    } finally {
      setLoading(false);
    }
  }, [loadServers, selectedWorkspaceId]);

  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  const refresh = async () => {
    if (!selectedWorkspaceId) {
      await loadWorkspaces();
      return;
    }
    await loadServers(selectedWorkspaceId);
  };

  const reload = async () => {
    if (!selectedWorkspaceId) return;
    setRefreshing(true);
    try {
      const result = await getMcpApi().reloadServers({
        workspaceId: McpWorkspaceId.make(selectedWorkspaceId),
      });
      setSnapshot(result);
      toastManager.add(stackedThreadToast({ type: "success", title: "MCP servers reloaded" }));
    } catch (cause) {
      showErrorToast("Failed to reload MCP servers", cause);
    } finally {
      setRefreshing(false);
    }
  };

  const submitForm = async (form: McpServerFormState) => {
    if (!selectedWorkspaceId) return;
    const result = await getMcpApi().upsertServer({
      workspaceId: McpWorkspaceId.make(selectedWorkspaceId),
      name: McpServerName.make(form.name.trim()),
      config: configFromMcpServerForm(form),
    });
    setSnapshot(result);
    toastManager.add(stackedThreadToast({ type: "success", title: "MCP server saved" }));
  };

  const toggleEnabled = async (server: McpServer, enabled: boolean) => {
    if (!selectedWorkspaceId) return;
    setMutatingName(server.name);
    try {
      const result = await getMcpApi().setServerEnabled({
        workspaceId: McpWorkspaceId.make(selectedWorkspaceId),
        name: server.name,
        enabled,
      });
      setSnapshot(result);
    } catch (cause) {
      showErrorToast("Failed to update MCP server", cause);
    } finally {
      setMutatingName(null);
    }
  };

  const removeServer = async (server: McpServer) => {
    if (!selectedWorkspaceId) return;
    const confirmed = await ensureLocalApi().dialogs.confirm(`Remove MCP server "${server.name}"?`);
    if (!confirmed) return;
    setMutatingName(server.name);
    try {
      const result = await getMcpApi().removeServer({
        workspaceId: McpWorkspaceId.make(selectedWorkspaceId),
        name: server.name,
      });
      setSnapshot(result);
      toastManager.add(stackedThreadToast({ type: "success", title: "MCP server removed" }));
    } catch (cause) {
      showErrorToast("Failed to remove MCP server", cause);
    } finally {
      setMutatingName(null);
    }
  };

  const startOauthLogin = async (server: McpServer) => {
    if (!selectedWorkspaceId) return;
    setMutatingName(server.name);
    try {
      const result = await getMcpApi().startOauthLogin({
        workspaceId: McpWorkspaceId.make(selectedWorkspaceId),
        serverName: server.name,
        scopes: server.config.oauthScopes,
      });
      await ensureLocalApi().shell.openExternal(result.authorizationUrl);
      toastManager.add(stackedThreadToast({ type: "success", title: "OAuth login opened" }));
    } catch (cause) {
      showErrorToast("Failed to start OAuth login", cause);
    } finally {
      setMutatingName(null);
    }
  };

  const openAddDialog = () => {
    setEditingServer(null);
    setDialogOpen(true);
  };

  const openEditDialog = (server: McpServer) => {
    setEditingServer(server);
    setDialogOpen(true);
  };

  return (
    <div className="flex-1 p-6 sm:p-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <ServerIcon className="size-3.5" />
              Provider MCP
            </div>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.01em]">MCP Servers</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground/80">
              Manage Codex MCP servers and inspect how other provider instances currently expose MCP
              support.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <WorkspaceSelect
              workspaces={workspaces}
              selectedWorkspaceId={selectedWorkspaceId}
              onChange={(workspaceId) => {
                setSelectedWorkspaceId(workspaceId);
                void loadServers(workspaceId);
              }}
            />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => void refresh()}
                    disabled={loading || refreshing}
                    aria-label="Refresh MCP servers"
                  >
                    <RefreshCwIcon className={cn((loading || refreshing) && "animate-spin")} />
                  </Button>
                }
              />
              <TooltipPopup>Refresh</TooltipPopup>
            </Tooltip>
            <Button
              variant="outline"
              disabled={!selectedWorkspaceId || refreshing}
              onClick={() => void reload()}
            >
              <WrenchIcon />
              Reload
            </Button>
            <Button disabled={!selectedWorkspaceId} onClick={openAddDialog}>
              <PlusIcon />
              Add server
            </Button>
          </div>
        </header>

        <ProviderSupportSection
          providers={providers}
          selectedWorkspaceId={selectedWorkspaceId}
          onSelectWorkspace={(workspaceId) => {
            setSelectedWorkspaceId(workspaceId);
            void loadServers(workspaceId);
          }}
        />

        {selectedWorkspace ? (
          <div className="rounded-lg border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="min-w-0 break-all font-mono">{selectedWorkspace.displayPath}</span>
              <span>
                {selectedWorkspace.mode === "authOverlay" ? "Auth overlay" : "Direct home"}
              </span>
              <span>
                Used by{" "}
                {selectedWorkspace.providerInstances
                  .map((instance) => instance.displayName ?? instance.instanceId)
                  .join(", ")}
              </span>
            </div>
            {snapshot?.configPath ? (
              <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground/70">
                {snapshot.configPath}
              </div>
            ) : null}
          </div>
        ) : null}

        {workspacesResult?.issues.length ? (
          <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/6 p-3">
            {workspacesResult.issues.map((issue) => (
              <div key={`${issue.instanceId}:${issue.message}`} className="flex gap-2 text-xs">
                <TriangleAlertIcon className="mt-0.5 size-3.5 text-warning-foreground" />
                <span>
                  <span className="font-medium">{issue.instanceId}</span>: {issue.message}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/6 p-3 text-sm text-destructive-foreground">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed">
            <LoaderIcon className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : workspaces.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <ServerIcon className="mx-auto size-7 text-muted-foreground/60" />
            <h3 className="mt-3 text-sm font-semibold">No Codex workspaces</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground/80">
              Add or enable a Codex provider instance before managing MCP servers.
            </p>
          </div>
        ) : snapshot?.servers.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <CheckCircle2Icon className="mx-auto size-7 text-muted-foreground/60" />
            <h3 className="mt-3 text-sm font-semibold">No MCP servers configured</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground/80">
              Add a stdio or HTTP server to make its tools available to Codex sessions.
            </p>
            <Button className="mt-4" onClick={openAddDialog}>
              <PlusIcon />
              Add server
            </Button>
          </div>
        ) : (
          <div className="grid gap-3">
            {snapshot?.servers.map((server) => (
              <McpServerCard
                key={server.name}
                server={server}
                mutating={mutatingName === server.name}
                onToggleEnabled={(target, enabled) => void toggleEnabled(target, enabled)}
                onEdit={openEditDialog}
                onRemove={(target) => void removeServer(target)}
                onOauthLogin={(target) => void startOauthLogin(target)}
              />
            ))}
          </div>
        )}
      </div>

      <McpServerDialog
        open={dialogOpen}
        server={editingServer}
        onOpenChange={setDialogOpen}
        onSubmit={submitForm}
      />
    </div>
  );
}
