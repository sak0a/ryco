import type { RepositoryIdentity } from "@ryco/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

export interface RepositoryIdentityResolverShape {
  readonly resolve: (cwd: string) => Effect.Effect<RepositoryIdentity | null>;
}

export class RepositoryIdentityResolver extends Context.Service<
  RepositoryIdentityResolver,
  RepositoryIdentityResolverShape
>()("ryco/project/Services/RepositoryIdentityResolver") {}
