import { type DiffRouteSearch, parseDiffRouteSearch } from "./diffRouteSearch";
import { type PreviewRouteSearch, parsePreviewRouteSearch } from "./previewRouteSearch";
import { type WorkspaceRouteSearch, parseWorkspaceRouteSearch } from "./workspaceRouteSearch";

export type RightPanelMode = "review" | "files" | "terminal" | "agent";

export type RightPanelRouteSearch = DiffRouteSearch & PreviewRouteSearch & WorkspaceRouteSearch;

export function parseRightPanelRouteSearch(search: Record<string, unknown>): RightPanelRouteSearch {
  const workspaceSearch = parseWorkspaceRouteSearch(search);
  const diffSearch = parseDiffRouteSearch(search);
  const previewSearch = parsePreviewRouteSearch(search);

  if (workspaceSearch.workspaceTab === "agent" && workspaceSearch.workspaceAgentKey) {
    return workspaceSearch;
  }
  if (workspaceSearch.workspaceTab === "review") {
    return {
      ...diffSearch,
      workspaceOpen: "1",
      workspaceTab: "review",
      diff: "1",
    };
  }
  if (workspaceSearch.workspaceTab === "files") {
    return {
      ...previewSearch,
      workspaceOpen: "1",
      workspaceTab: "files",
      preview: "1",
    };
  }
  if (workspaceSearch.workspaceTab === "terminal") {
    return {
      workspaceOpen: "1",
      workspaceTab: "terminal",
    };
  }

  if (diffSearch.diff === "1") {
    return {
      ...diffSearch,
      workspaceOpen: "1",
      workspaceTab: "review",
    };
  }
  if (previewSearch.preview === "1") {
    return {
      ...previewSearch,
      workspaceOpen: "1",
      workspaceTab: "files",
    };
  }
  if (workspaceSearch.workspaceOpen === "1") {
    return workspaceSearch;
  }
  return {};
}

export function getRightPanelMode(search: RightPanelRouteSearch): RightPanelMode | null {
  if (search.workspaceTab === "agent" && search.workspaceAgentKey) return "agent";
  if (search.workspaceTab === "review" || search.diff === "1") return "review";
  if (search.workspaceTab === "files" || search.preview === "1") return "files";
  if (search.workspaceTab === "terminal") return "terminal";
  return null;
}

export function isRightPanelOpen(search: RightPanelRouteSearch): boolean {
  return search.workspaceOpen === "1" || getRightPanelMode(search) !== null;
}
