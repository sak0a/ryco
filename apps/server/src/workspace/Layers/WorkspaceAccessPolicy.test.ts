import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer, Path } from "effect";

import { WorkspaceAccessPolicy } from "../Services/WorkspaceAccessPolicy.ts";
import { WorkspaceAccessPolicyLayer } from "./WorkspaceAccessPolicy.ts";

const makePolicyLayer = (root: string) =>
  WorkspaceAccessPolicyLayer(root).pipe(Layer.provideMerge(NodeServices.layer));

it.layer(NodeServices.layer)("WorkspaceAccessPolicy", (it) => {
  it.effect("accepts the canonical root and its descendants", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "ryco-access-root-" });
      const child = path.join(root, "project");
      yield* fileSystem.makeDirectory(child);

      const result = yield* Effect.gen(function* () {
        const policy = yield* WorkspaceAccessPolicy;
        expect(yield* policy.assertExistingPath({ path: root, operation: "test.root" })).toBe(
          yield* fileSystem.realPath(root),
        );
        expect(yield* policy.assertExistingPath({ path: child, operation: "test.child" })).toBe(
          yield* fileSystem.realPath(child),
        );
      }).pipe(Effect.provide(makePolicyLayer(root)));

      return result;
    }),
  );

  it.effect("rejects parent traversal and sibling prefix collisions", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const parent = yield* fileSystem.makeTempDirectoryScoped({ prefix: "ryco-access-parent-" });
      const root = path.join(parent, "workspace");
      const sibling = path.join(parent, "workspace-other");
      yield* fileSystem.makeDirectory(root);
      yield* fileSystem.makeDirectory(sibling);

      yield* Effect.gen(function* () {
        const policy = yield* WorkspaceAccessPolicy;
        const parentError = yield* policy
          .assertPath({ path: path.join(root, ".."), operation: "test.parent" })
          .pipe(Effect.flip);
        const siblingError = yield* policy
          .assertExistingPath({ path: sibling, operation: "test.sibling" })
          .pipe(Effect.flip);

        expect(parentError.reason).toBe("outsideRoot");
        expect(siblingError.reason).toBe("outsideRoot");
      }).pipe(Effect.provide(makePolicyLayer(root)));
    }),
  );

  it.effect("rejects existing symlinks and missing descendants that escape the root", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const parent = yield* fileSystem.makeTempDirectoryScoped({ prefix: "ryco-access-links-" });
      const root = path.join(parent, "workspace");
      const outside = path.join(parent, "outside");
      const link = path.join(root, "escape");
      yield* fileSystem.makeDirectory(root);
      yield* fileSystem.makeDirectory(outside);
      yield* fileSystem.symlink(outside, link);

      yield* Effect.gen(function* () {
        const policy = yield* WorkspaceAccessPolicy;
        const existingError = yield* policy
          .assertExistingPath({ path: link, operation: "test.link" })
          .pipe(Effect.flip);
        const missingError = yield* policy
          .assertPath({ path: path.join(link, "new-project"), operation: "test.missing" })
          .pipe(Effect.flip);

        expect(existingError.reason).toBe("outsideRoot");
        expect(missingError.reason).toBe("outsideRoot");
      }).pipe(Effect.provide(makePolicyLayer(root)));
    }),
  );

  it.effect("preserves normalized paths in unrestricted mode", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      yield* Effect.gen(function* () {
        const policy = yield* WorkspaceAccessPolicy;
        expect(policy.isRestricted).toBe(false);
        expect(
          yield* policy.assertPath({
            path: "../unrestricted-project",
            operation: "test.unrestricted",
          }),
        ).toBe(path.resolve("../unrestricted-project"));
      }).pipe(
        Effect.provide(
          WorkspaceAccessPolicyLayer(undefined).pipe(Layer.provideMerge(NodeServices.layer)),
        ),
      );
    }),
  );
});
