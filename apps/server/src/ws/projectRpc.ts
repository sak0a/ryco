import { Effect, Schema } from "effect";
import {
  FilesystemBrowseError,
  ProjectListEntriesError,
  ProjectReadFileError,
  ProjectSearchEntriesError,
  ProjectStageFileReferenceError,
  ProjectWriteFileError,
  WS_METHODS,
} from "@ryco/contracts";

import { observeRpcEffect } from "../observability/RpcInstrumentation.ts";
import { WorkspacePathOutsideRootError } from "../workspace/Services/WorkspacePaths.ts";
import { defineWsHandlers, type WsRpcContext } from "./context.ts";

export const makeProjectHandlers = (ctx: WsRpcContext) => {
  const { ownerEffect, workspaceEntries, workspaceFileSystem, open } = ctx;

  return defineWsHandlers({
    [WS_METHODS.projectsSearchEntries]: (input) =>
      observeRpcEffect(
        WS_METHODS.projectsSearchEntries,
        ownerEffect(
          WS_METHODS.projectsSearchEntries,
          workspaceEntries.search(input).pipe(
            Effect.mapError(
              (cause) =>
                new ProjectSearchEntriesError({
                  message: `Failed to search workspace entries: ${cause.detail}`,
                  cause,
                }),
            ),
          ),
        ),
        { "rpc.aggregate": "workspace" },
      ),
    [WS_METHODS.projectsListEntries]: (input) =>
      observeRpcEffect(
        WS_METHODS.projectsListEntries,
        ownerEffect(
          WS_METHODS.projectsListEntries,
          workspaceEntries.listEntries(input).pipe(
            Effect.mapError(
              (cause) =>
                new ProjectListEntriesError({
                  message: `Failed to list workspace entries: ${cause.detail}`,
                  cause,
                }),
            ),
          ),
        ),
        { "rpc.aggregate": "workspace" },
      ),
    [WS_METHODS.projectsReadFile]: (input) =>
      observeRpcEffect(
        WS_METHODS.projectsReadFile,
        ownerEffect(
          WS_METHODS.projectsReadFile,
          workspaceFileSystem.readFile(input).pipe(
            Effect.mapError((cause) => {
              const message = Schema.is(WorkspacePathOutsideRootError)(cause)
                ? "Workspace file path must stay within the project root."
                : cause.detail;
              return new ProjectReadFileError({
                message,
                cause,
              });
            }),
          ),
        ),
        { "rpc.aggregate": "workspace" },
      ),
    [WS_METHODS.projectsWriteFile]: (input) =>
      observeRpcEffect(
        WS_METHODS.projectsWriteFile,
        ownerEffect(
          WS_METHODS.projectsWriteFile,
          workspaceFileSystem.writeFile(input).pipe(
            Effect.mapError((cause) => {
              const message = Schema.is(WorkspacePathOutsideRootError)(cause)
                ? "Workspace file path must stay within the project root."
                : "Failed to write workspace file";
              return new ProjectWriteFileError({
                message,
                cause,
              });
            }),
          ),
        ),
        { "rpc.aggregate": "workspace" },
      ),
    [WS_METHODS.projectsStageFileReference]: (input) =>
      observeRpcEffect(
        WS_METHODS.projectsStageFileReference,
        ownerEffect(
          WS_METHODS.projectsStageFileReference,
          workspaceFileSystem.stageFileReference(input).pipe(
            Effect.mapError((cause) => {
              const message = Schema.is(WorkspacePathOutsideRootError)(cause)
                ? "Workspace file path must stay within the project root."
                : cause.detail;
              return new ProjectStageFileReferenceError({
                message,
                cause,
              });
            }),
          ),
        ),
        { "rpc.aggregate": "workspace" },
      ),
    [WS_METHODS.shellOpenInEditor]: (input) =>
      observeRpcEffect(
        WS_METHODS.shellOpenInEditor,
        ownerEffect(WS_METHODS.shellOpenInEditor, open.openInEditor(input)),
        {
          "rpc.aggregate": "workspace",
        },
      ),
    [WS_METHODS.filesystemBrowse]: (input) =>
      observeRpcEffect(
        WS_METHODS.filesystemBrowse,
        ownerEffect(
          WS_METHODS.filesystemBrowse,
          workspaceEntries.browse(input).pipe(
            Effect.mapError(
              (cause) =>
                new FilesystemBrowseError({
                  message: cause.detail,
                  cause,
                }),
            ),
          ),
        ),
        { "rpc.aggregate": "workspace" },
      ),
  });
};
