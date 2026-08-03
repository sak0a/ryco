import type { EnvironmentId, ProjectId } from "@ryco/contracts";
import type { ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

import { BRANDED_APP_LOGO_SRC } from "../../brandedLogo";
import type { DraftId } from "../../composerDraftStore";
import { selectProjectsAcrossEnvironments, useStore } from "../../store";
import { ProjectSwitcher } from "../ProjectSwitcher";
import { canSwitchNewThreadProject, resolveNewThreadHeadline } from "./NewThreadHero.logic";

export interface NewThreadHeroProps {
  readonly projectName: string | null;
  readonly activeProjectId: ProjectId | null;
  readonly activeProjectEnvironmentId: EnvironmentId | null;
  readonly routeKind: "draft" | "server";
  readonly envLocked: boolean;
  /** Present only on the draft route; without it the project is fixed. */
  readonly draftId: DraftId | undefined;
  /** The "Work in …" row rendered beneath the headline. */
  readonly workLocation: ReactNode;
}

/**
 * Empty-thread starting screen: the app mark over "What should we do in
 * <project>?". `ChatView` renders this in place of the timeline while a thread
 * has no messages; the composer and `BranchToolbar` sit directly beneath it and
 * the three read as one vertically centered block.
 */
export function NewThreadHero({
  projectName,
  activeProjectId,
  activeProjectEnvironmentId,
  routeKind,
  envLocked,
  draftId,
  workLocation,
}: NewThreadHeroProps) {
  const headline = resolveNewThreadHeadline({ projectName });
  const projectCount = useStore(
    useShallow((store) => selectProjectsAcrossEnvironments(store).length),
  );
  const canSwitchProject =
    headline.projectName !== null &&
    activeProjectId !== null &&
    activeProjectEnvironmentId !== null &&
    draftId !== undefined &&
    canSwitchNewThreadProject({ routeKind, envLocked, projectCount });

  return (
    <div
      className="flex shrink-0 flex-col items-center gap-4 px-6 pb-6 sm:gap-5 sm:pb-8"
      data-testid="new-thread-hero"
    >
      <img
        alt=""
        aria-hidden
        className="size-10 shrink-0 object-contain sm:size-12"
        src={BRANDED_APP_LOGO_SRC}
      />
      <h1 className="max-w-208 text-balance text-center font-medium text-2xl text-foreground tracking-tight sm:text-3xl">
        {headline.projectName === null ? (
          headline.text
        ) : (
          <>
            {headline.prefix}
            {canSwitchProject && activeProjectId && activeProjectEnvironmentId && draftId ? (
              <ProjectSwitcher
                activeProjectId={activeProjectId}
                activeProjectEnvironmentId={activeProjectEnvironmentId}
                appearance="headline"
                draftId={draftId}
                label={headline.projectName}
              />
            ) : (
              <span className="text-foreground">{headline.projectName}</span>
            )}
            {headline.suffix}
          </>
        )}
      </h1>
      {workLocation}
    </div>
  );
}
