import {
  AtlassianCapability,
  AtlassianConnectionId,
  AtlassianConnectionKind,
  AtlassianConnectionStatus,
  AtlassianProduct,
  IsoDateTime,
} from "@ryco/contracts";
import { Context, Option, Schema } from "effect";
import type { Effect } from "effect";

import type { AtlassianConnectionRepositoryError } from "../Errors.ts";

export const AtlassianConnectionRecord = Schema.Struct({
  connectionId: AtlassianConnectionId,
  kind: AtlassianConnectionKind,
  label: Schema.String,
  status: AtlassianConnectionStatus,
  products: Schema.Array(AtlassianProduct),
  capabilities: Schema.Array(AtlassianCapability),
  accountName: Schema.NullOr(Schema.String),
  accountEmail: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String),
  baseUrl: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(IsoDateTime),
  lastVerifiedAt: Schema.NullOr(IsoDateTime),
  readonly: Schema.Boolean,
  isDefault: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AtlassianConnectionRecord = typeof AtlassianConnectionRecord.Type;

export const UpsertAtlassianConnectionInput = AtlassianConnectionRecord;
export type UpsertAtlassianConnectionInput = typeof UpsertAtlassianConnectionInput.Type;

export const GetAtlassianConnectionInput = Schema.Struct({
  connectionId: AtlassianConnectionId,
});
export type GetAtlassianConnectionInput = typeof GetAtlassianConnectionInput.Type;

export const ListAtlassianConnectionsInput = Schema.Struct({
  status: Schema.optional(AtlassianConnectionStatus),
});
export type ListAtlassianConnectionsInput = typeof ListAtlassianConnectionsInput.Type;

export const DisconnectAtlassianConnectionInput = Schema.Struct({
  connectionId: AtlassianConnectionId,
  updatedAt: IsoDateTime,
});
export type DisconnectAtlassianConnectionInput = typeof DisconnectAtlassianConnectionInput.Type;

export interface AtlassianConnectionRepositoryShape {
  readonly upsert: (
    input: UpsertAtlassianConnectionInput,
  ) => Effect.Effect<void, AtlassianConnectionRepositoryError>;
  readonly getById: (
    input: GetAtlassianConnectionInput,
  ) => Effect.Effect<Option.Option<AtlassianConnectionRecord>, AtlassianConnectionRepositoryError>;
  readonly list: (
    input?: ListAtlassianConnectionsInput,
  ) => Effect.Effect<ReadonlyArray<AtlassianConnectionRecord>, AtlassianConnectionRepositoryError>;
  readonly disconnect: (
    input: DisconnectAtlassianConnectionInput,
  ) => Effect.Effect<boolean, AtlassianConnectionRepositoryError>;
  readonly deleteById: (
    input: GetAtlassianConnectionInput,
  ) => Effect.Effect<void, AtlassianConnectionRepositoryError>;
}

export class AtlassianConnectionRepository extends Context.Service<
  AtlassianConnectionRepository,
  AtlassianConnectionRepositoryShape
>()("ryco/persistence/Services/AtlassianConnections/AtlassianConnectionRepository") {}
