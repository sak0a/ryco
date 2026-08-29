import type { SettingsSectionId } from "../../settingsDialogStore";

/**
 * Which settings sections a reader can actually open, as one predicate.
 *
 * IT LIVES HERE RATHER THAN IN `SettingsDialog.tsx` BECAUSE IT HAS A THIRD
 * CALLER. The desktop dialog and the phone surface filter their navs with it,
 * and `HostedE2eeVerification` now asks the same question before it draws a
 * sentence that sends a reader to Settings → Security (docs/relay-e2ee-protocol
 * §13.5's accompanying text). That component sits in the eagerly loaded shell
 * and the settings dialog is deliberately behind a dynamic import
 * (`perf/webBundleSplitting.test.ts`), so importing the predicate from the
 * dialog would have pulled the dialog into the app entry to answer a question
 * about copy. This module imports nothing but a type.
 */

/** The role a hosted grant carries, or `null` when no fresh snapshot exists. */
export type HostedSettingsRole = "viewer" | "operator" | "owner" | null;
export type SettingsScope = "browser" | "device" | "account" | "node";

const SETTINGS_SCOPE_BY_SECTION = {
  account: "account",
  general: "browser",
  inbox: "browser",
  providers: "node",
  "opinionated-plugins": "node",
  "mcp-servers": "node",
  appearance: "browser",
  keybindings: "node",
  "source-control": "node",
  connections: "device",
  security: "node",
  diagnostics: "node",
  statistics: "node",
  archived: "node",
} as const satisfies Record<SettingsSectionId, SettingsScope>;

export function settingsSectionScope(section: SettingsSectionId): SettingsScope {
  return SETTINGS_SCOPE_BY_SECTION[section];
}

/**
 * Sections that exist only in the hosted client. Account management is one:
 * there is no Hub account to manage in the standard (local-server) mode, so the
 * section is filtered out entirely rather than rendered empty.
 *
 * Still hosted-only even though the hosted client no longer opens this dialog on
 * it — see `hostedSettingsSectionAllowed`. The two gates answer different
 * questions: this one is "does the section exist in this build", which has not
 * changed, and that one is "does the hosted client route here", which has.
 */
const HOSTED_ONLY_SECTIONS: ReadonlySet<SettingsSectionId> = new Set(["account"]);

const HOSTED_OWNER_SECTIONS = new Set<SettingsSectionId>([
  "general",
  "inbox",
  "providers",
  "opinionated-plugins",
  "mcp-servers",
  "keybindings",
  "source-control",
  // Node-scoped and owner-only, like the rest of this set. In hosted mode the
  // node's operator routes are unreachable anyway (the relay carries `ryco.rpc`
  // and there is no HTTP tunnel), so the section renders this browser's own
  // channel and says where the node-side state lives — but the gate stays
  // closed for non-owners rather than relying on that.
  "security",
  "diagnostics",
  "statistics",
]);

export function settingsSectionAvailable(section: SettingsSectionId, hosted: boolean): boolean {
  return hosted || !HOSTED_ONLY_SECTIONS.has(section);
}

export function hostedSettingsSectionAllowed(
  section: SettingsSectionId,
  role: HostedSettingsRole,
): boolean {
  if (section === "connections") return false;
  if (section === "appearance") return true;
  // Account management is a Hub page now, not a tab of this dialog, so the
  // hosted client never opens the dialog on it. Kept closed rather than
  // deleted: `SettingsSectionId` still carries the id, and a stale caller
  // asking for it must not be answered with a section this dialog no longer
  // renders in hosted mode.
  if (section === "account") return false;
  if (section === "archived") return role !== null;
  return role === "owner" && HOSTED_OWNER_SECTIONS.has(section);
}

/**
 * Whether the hosted role snapshot is current enough to gate on.
 *
 * A hosted grant's role is read from the directory over the transport, so
 * between a reconnect and a fresh directory it is a stale value rather than an
 * unknown one — and stale is the dangerous kind, because it is a value the gates
 * would happily act on.
 */
export function hostedSettingsRoleFresh(directoryStatus: string, transportStatus: string): boolean {
  return directoryStatus === "ready" && transportStatus === "online";
}

/**
 * The role snapshot, or `null` while it cannot be trusted.
 *
 * Every caller of {@link settingsSectionReachable} passes the role through this,
 * so "not fresh" and "no role" fail closed identically and no surface has to
 * remember the ternary.
 */
export function hostedSettingsRoleSnapshot(
  role: HostedSettingsRole,
  directoryStatus: string,
  transportStatus: string,
): HostedSettingsRole {
  return hostedSettingsRoleFresh(directoryStatus, transportStatus) ? role : null;
}

/**
 * Whether this build, in this mode, for this role, can open a section at all.
 *
 * The one composition every nav filter and every pointer at a section shares.
 * Written out at each call site it was three copies of the same two clauses,
 * and copy that names a destination ("Settings → Security explains what else
 * this tab cannot check") is exactly the kind of caller that drifts from a gate
 * it does not share.
 */
export function settingsSectionReachable(
  section: SettingsSectionId,
  { hosted, role }: { readonly hosted: boolean; readonly role: HostedSettingsRole },
): boolean {
  return (
    settingsSectionAvailable(section, hosted) &&
    (!hosted || hostedSettingsSectionAllowed(section, role))
  );
}
