import type { EnvironmentId } from "@ryco/contracts";

export type NodePlane = "hub" | "direct";
export type NodeReadiness = "ready" | "checking" | "reconnecting" | "offline" | "read-only";

export interface NodeModelInput {
  readonly environmentId: EnvironmentId;
  readonly plane: NodePlane;
  readonly label: string;
  readonly role?: string | null;
  readonly presence?: "online" | "offline" | "unknown";
  readonly readiness: NodeReadiness;
  readonly selected: boolean;
  readonly transportLabel?: string | null;
}

export interface NodeSectionModel {
  readonly key: NodePlane;
  readonly title: "Hub nodes" | "Direct connections";
  readonly rows: ReadonlyArray<NodeModelInput>;
}

export function buildNodeSections(input: {
  readonly rows: ReadonlyArray<NodeModelInput>;
  readonly query?: string;
}): ReadonlyArray<NodeSectionModel> {
  const query = input.query?.trim().toLocaleLowerCase() ?? "";
  const filtered = input.rows.filter((row) => {
    if (!query) return true;
    return `${row.label} ${row.role ?? ""} ${row.transportLabel ?? ""}`
      .toLocaleLowerCase()
      .includes(query);
  });
  const hubRows = filtered.filter((row) => row.plane === "hub");
  const directRows = filtered.filter((row) => row.plane === "direct");
  const sections: NodeSectionModel[] = [];
  if (hubRows.length > 0) {
    sections.push({ key: "hub", title: "Hub nodes", rows: hubRows });
  }
  if (directRows.length > 0) {
    sections.push({ key: "direct", title: "Direct connections", rows: directRows });
  }
  return sections;
}

export function canSelectHubNode(input: {
  readonly directoryStatus: "idle" | "loading" | "ready" | "error";
  readonly browserStatus: "idle" | "refreshing" | "current" | "error";
  readonly revokedAt: string | null;
  readonly presence: "online" | "offline" | "unknown";
}): boolean {
  return (
    input.directoryStatus === "ready" &&
    input.browserStatus === "current" &&
    input.revokedAt === null &&
    input.presence === "online"
  );
}
