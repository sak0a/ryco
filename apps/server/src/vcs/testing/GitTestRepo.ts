import { Effect } from "effect";

export const TEST_GIT_COMMIT_IDENTITY_CONFIG = [
  ["user.email", "test@test.com"],
  ["user.name", "Test"],
  ["commit.gpgsign", "false"],
] as const;

export const configureTestGitCommitIdentity = <E, R>(
  cwd: string,
  runGit: (cwd: string, args: ReadonlyArray<string>) => Effect.Effect<unknown, E, R>,
): Effect.Effect<void, E, R> =>
  Effect.gen(function* () {
    for (const [key, value] of TEST_GIT_COMMIT_IDENTITY_CONFIG) {
      yield* runGit(cwd, ["config", key, value]);
    }
  });
