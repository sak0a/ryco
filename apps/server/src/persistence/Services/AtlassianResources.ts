import {
  AtlassianCapability,
  AtlassianConnectionId,
  AtlassianProduct,
  AtlassianResourceId,
  IsoDateTime,
} from "@ryco/contracts";
import { Context, Schema } from "effect";
import type { Effect } from "effect";

import type { AtlassianResourceRepositoryError } from "../Errors.ts";

export const AtlassianResourceRecord = Schema.Struct({
  resourceId: AtlassianResourceId,
  connectionId: AtlassianConnectionId,
  product: AtlassianProduct,
  name: Schema.String,
  url: Schema.String,
  capabilities: Schema.Array(AtlassianCapability),
  cloudId: Schema.NullOr(Schema.String),
  workspaceSlug: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String),
  updatedAt: IsoDateTime,
});
export type AtlassianResourceRecord = typeof AtlassianResourceRecord.Type;

export const UpsertAtlassianResourcesInput = Schema.Struct({
  connectionId: AtlassianConnectionId,
  resources: Schema.Array(AtlassianResourceRecord),
});
export type UpsertAtlassianResourcesInput = typeof UpsertAtlassianResourcesInput.Type;

export const ListAtlassianResourcesInput = Schema.Struct({
  connectionId: Schema.optional(AtlassianConnectionId),
  product: Schema.optional(AtlassianProduct),
});
export type ListAtlassianResourcesInput = typeof ListAtlassianResourcesInput.Type;

export const DeleteAtlassianResourcesForConnectionInput = Schema.Struct({
  connectionId: AtlassianConnectionId,
});
export type DeleteAtlassianResourcesForConnectionInput =
  typeof DeleteAtlassianResourcesForConnectionInput.Type;

export interface AtlassianResourceRepositoryShape {
  readonly upsertForConnection: (
    input: UpsertAtlassianResourcesInput,
  ) => Effect.Effect<void, AtlassianResourceRepositoryError>;
  readonly list: (
    input?: ListAtlassianResourcesInput,
  ) => Effect.Effect<ReadonlyArray<AtlassianResourceRecord>, AtlassianResourceRepositoryError>;
  readonly deleteForConnection: (
    input: DeleteAtlassianResourcesForConnectionInput,
  ) => Effect.Effect<void, AtlassianResourceRepositoryError>;
}

export class AtlassianResourceRepository extends Context.Service<
  AtlassianResourceRepository,
  AtlassianResourceRepositoryShape
>()("ryco/persistence/Services/AtlassianResources/AtlassianResourceRepository") {}
