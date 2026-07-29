/**
 * WorkspaceAccessPolicy - Process-wide boundary for Ryco-managed workspace paths.
 *
 * This service constrains paths accepted by Ryco RPCs. It does not sandbox child
 * processes such as terminals or coding-agent runtimes.
 *
 * @module WorkspaceAccessPolicy
 */
import { Context, Schema, type Effect } from "effect";

export class WorkspaceAccessDeniedError extends Schema.TaggedErrorClass<WorkspaceAccessDeniedError>()(
  "WorkspaceAccessDeniedError",
  {
    operation: Schema.String,
    requestedPath: Schema.String,
    accessRoot: Schema.String,
    reason: Schema.Literals(["outsideRoot", "unresolvable"]),
  },
) {
  override get message(): string {
    return `Workspace path is not available for ${this.operation}; access is restricted to '${this.accessRoot}'.`;
  }
}

export interface WorkspaceAccessPathInput {
  readonly path: string;
  readonly operation: string;
}

export interface WorkspaceAccessPolicyShape {
  readonly accessRoot: string | undefined;
  readonly isRestricted: boolean;

  /**
   * Validate a path that may not exist yet.
   *
   * The returned value is absolute and normalized. In restricted mode its
   * nearest existing ancestor is also checked by realpath.
   */
  readonly assertPath: (
    input: WorkspaceAccessPathInput,
  ) => Effect.Effect<string, WorkspaceAccessDeniedError>;

  /**
   * Validate an existing path by its canonical realpath.
   */
  readonly assertExistingPath: (
    input: WorkspaceAccessPathInput,
  ) => Effect.Effect<string, WorkspaceAccessDeniedError>;
}

export class WorkspaceAccessPolicy extends Context.Service<
  WorkspaceAccessPolicy,
  WorkspaceAccessPolicyShape
>()("ryco/workspace/Services/WorkspaceAccessPolicy") {}
