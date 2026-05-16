import type { SourceControlIssueSummary } from "@ryco/contracts";

export function searchSourceControlSummaries<T extends SourceControlIssueSummary>(
  items: ReadonlyArray<T>,
  query: string,
): ReadonlyArray<T> {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return items;

  const scored = items.flatMap((item) => {
    const title = item.title.toLowerCase();
    const number = String(item.number);
    if (number === q || number.startsWith(q)) return [{ item, score: 0 }];
    if (title.startsWith(q)) return [{ item, score: 1 }];
    if (title.includes(q)) return [{ item, score: 2 }];
    return [];
  });

  scored.sort((a, b) => a.score - b.score || a.item.title.length - b.item.title.length);
  return scored.map((s) => s.item);
}

export type SourceControlScope = "issues" | "prs" | "jira" | "mixed";

export interface ScopedSourceControlQuery {
  readonly scope: SourceControlScope;
  readonly search: string;
}

const SOURCE_CONTROL_SCOPE_PREFIXES: ReadonlyArray<{
  readonly prefix: string;
  readonly scope: Exclude<SourceControlScope, "mixed">;
}> = [
  { prefix: "jira", scope: "jira" },
  { prefix: "pr", scope: "prs" },
  { prefix: "i", scope: "issues" },
];

export function scopeSourceControlQuery(query: string): ScopedSourceControlQuery {
  for (const { prefix, scope } of SOURCE_CONTROL_SCOPE_PREFIXES) {
    if (query === prefix) {
      return { scope, search: "" };
    }
    if (query.length > prefix.length && query.startsWith(prefix)) {
      const next = query.charAt(prefix.length);
      if (next === " " || next === "\t") {
        return { scope, search: query.slice(prefix.length).replace(/^\s+/, "") };
      }
    }
  }
  return { scope: "mixed", search: query };
}
