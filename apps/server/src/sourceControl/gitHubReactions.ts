import { Cause, Result, Schema } from "effect";
import type { SourceControlCommentReactionContent } from "@ryco/contracts";
import { decodeJsonResult, formatSchemaError } from "@ryco/shared/schemaJson";

export interface NormalizedGitHubReaction {
  readonly content: SourceControlCommentReactionContent;
  readonly count: number;
  readonly viewerHasReacted?: boolean;
}

export interface NormalizedGitHubSubjectReactions {
  readonly id: string;
  readonly reactions: ReadonlyArray<NormalizedGitHubReaction>;
}

export const RawGitHubReactionGroupSchema = Schema.Struct({
  content: Schema.String,
  viewerHasReacted: Schema.optional(Schema.Boolean),
  reactors: Schema.optional(
    Schema.Struct({
      totalCount: Schema.optional(Schema.Number),
    }),
  ),
  users: Schema.optional(
    Schema.Struct({
      totalCount: Schema.optional(Schema.Number),
    }),
  ),
});

type RawGitHubReactionGroup = Schema.Schema.Type<typeof RawGitHubReactionGroupSchema>;

const GitHubReactionGroupsBySubjectSchema = Schema.Struct({
  data: Schema.Struct({
    nodes: Schema.Array(
      Schema.NullOr(
        Schema.Struct({
          id: Schema.String,
          reactionGroups: Schema.Array(RawGitHubReactionGroupSchema),
        }),
      ),
    ),
  }),
});

const decodeReactionGroupsBySubject = decodeJsonResult(GitHubReactionGroupsBySubjectSchema);

function normalizeReactionContent(value: string): SourceControlCommentReactionContent | null {
  switch (value.trim().toUpperCase()) {
    case "THUMBS_UP":
      return "thumbs-up";
    case "THUMBS_DOWN":
      return "thumbs-down";
    case "LAUGH":
      return "laugh";
    case "HOORAY":
      return "hooray";
    case "CONFUSED":
      return "confused";
    case "HEART":
      return "heart";
    case "ROCKET":
      return "rocket";
    case "EYES":
      return "eyes";
    default:
      return null;
  }
}

export function toGitHubReactionContent(content: SourceControlCommentReactionContent): string {
  switch (content) {
    case "thumbs-up":
      return "THUMBS_UP";
    case "thumbs-down":
      return "THUMBS_DOWN";
    case "laugh":
      return "LAUGH";
    case "hooray":
      return "HOORAY";
    case "confused":
      return "CONFUSED";
    case "heart":
      return "HEART";
    case "rocket":
      return "ROCKET";
    case "eyes":
      return "EYES";
  }
}

export function normalizeReactionGroups(
  raw: ReadonlyArray<RawGitHubReactionGroup> | undefined,
): ReadonlyArray<NormalizedGitHubReaction> {
  if (!raw) return [];
  return raw.flatMap((group) => {
    const content = normalizeReactionContent(group.content);
    const count = group.reactors?.totalCount ?? group.users?.totalCount;
    const viewerHasReacted = group.viewerHasReacted;
    if (
      content === null ||
      typeof count !== "number" ||
      (count <= 0 && viewerHasReacted !== true)
    ) {
      return [];
    }
    return [
      {
        content,
        count: Math.max(0, count),
        ...(typeof viewerHasReacted === "boolean" ? { viewerHasReacted } : {}),
      },
    ];
  });
}

export const formatGitHubReactionGroupsDecodeError = formatSchemaError;

export function decodeGitHubReactionGroupsBySubjectJson(
  raw: string,
): Result.Result<ReadonlyArray<NormalizedGitHubSubjectReactions>, Cause.Cause<Schema.SchemaError>> {
  const result = decodeReactionGroupsBySubject(raw);
  if (!Result.isSuccess(result)) return Result.fail(result.failure);
  return Result.succeed(
    result.success.data.nodes.flatMap((node) =>
      node ? [{ id: node.id, reactions: normalizeReactionGroups(node.reactionGroups) }] : [],
    ),
  );
}
