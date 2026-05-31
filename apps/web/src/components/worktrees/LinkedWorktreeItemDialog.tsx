import type { EnvironmentId } from "@ryco/contracts";
import { useCallback, useState } from "react";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { IssueDetail } from "../projectExplorer/IssueDetail";
import { PullRequestDetail } from "../projectExplorer/PullRequestDetail";

export type LinkedWorktreeItem = { kind: "pr"; number: number } | { kind: "issue"; number: number };

export interface LinkedWorktreeItemDialogProps {
  open: boolean;
  item: LinkedWorktreeItem | null;
  environmentId: EnvironmentId | null;
  cwd: string | null;
  onOpenChange: (open: boolean) => void;
}

type Pivot = { kind: "issue"; number: number } | { kind: "pr"; number: number } | null;

export function LinkedWorktreeItemDialog(props: LinkedWorktreeItemDialogProps) {
  const [pivot, setPivot] = useState<Pivot>(null);

  const close = useCallback(() => props.onOpenChange(false), [props]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setPivot(null);
      }
      props.onOpenChange(next);
    },
    [props],
  );

  const handleSelectLinkedIssue = useCallback((issueNumber: number) => {
    setPivot({ kind: "issue", number: issueNumber });
  }, []);

  const handleSelectLinkedChangeRequest = useCallback((number: number) => {
    setPivot({ kind: "pr", number });
  }, []);

  const handleBackFromPivot = useCallback(() => {
    setPivot(null);
  }, []);

  const item = props.item;

  return (
    <Dialog open={props.open} onOpenChange={handleOpenChange}>
      <DialogPopup className="flex h-[88vh] max-h-[1000px] w-full max-w-6xl flex-col p-0 sm:max-w-6xl">
        <DialogTitle className="sr-only">
          {item?.kind === "pr"
            ? `Pull request #${item.number}`
            : item?.kind === "issue"
              ? `Issue #${item.number}`
              : "Linked item"}
        </DialogTitle>

        {item === null ? null : pivot !== null ? (
          pivot.kind === "issue" ? (
            <IssueDetail
              environmentId={props.environmentId}
              cwd={props.cwd}
              issueNumber={pivot.number}
              onBack={handleBackFromPivot}
              onSelectLinkedChangeRequest={handleSelectLinkedChangeRequest}
            />
          ) : (
            <PullRequestDetail
              environmentId={props.environmentId}
              cwd={props.cwd}
              pullRequestNumber={pivot.number}
              onBack={handleBackFromPivot}
              onSelectLinkedIssue={handleSelectLinkedIssue}
            />
          )
        ) : item.kind === "pr" ? (
          <PullRequestDetail
            environmentId={props.environmentId}
            cwd={props.cwd}
            pullRequestNumber={item.number}
            onBack={close}
            onSelectLinkedIssue={handleSelectLinkedIssue}
          />
        ) : (
          <IssueDetail
            environmentId={props.environmentId}
            cwd={props.cwd}
            issueNumber={item.number}
            onBack={close}
            onSelectLinkedChangeRequest={handleSelectLinkedChangeRequest}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}
