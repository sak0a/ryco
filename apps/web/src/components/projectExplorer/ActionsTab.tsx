import type { EnvironmentId } from "@ryco/contracts";
import { WorkflowRunsSection } from "./WorkflowRunsSection";

interface ActionsTabProps {
  environmentId: EnvironmentId | null;
  cwd: string | null;
}

export function ActionsTab(props: ActionsTabProps) {
  return (
    <WorkflowRunsSection
      environmentId={props.environmentId}
      cwd={props.cwd}
      title="Actions"
      description="Recent GitHub Actions workflow runs grouped by pull request or branch."
      groupRunsBySource
    />
  );
}
