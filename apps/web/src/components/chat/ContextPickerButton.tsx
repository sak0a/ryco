import type {
  ChangeRequest,
  EnvironmentId,
  ProjectId,
  SourceControlIssueSummary,
  WorkItemSummary,
} from "@ryco/contracts";
import { useState } from "react";
import { PaperclipIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Popover, PopoverTrigger, PopoverPopup } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ContextPickerPopup } from "./ContextPickerPopup";

export function ContextPickerButton(props: {
  environmentId: EnvironmentId | null;
  cwd: string;
  projectId: ProjectId | null;
  hasSourceControlRemote: boolean;
  hasJiraProvider: boolean;
  onSelectIssue: (issue: SourceControlIssueSummary) => void;
  onSelectChangeRequest: (cr: ChangeRequest) => void;
  onSelectWorkItem: (workItem: WorkItemSummary) => void;
  onAttachFile: (file: File) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Add context"
                  className="text-muted-foreground/70 hover:text-foreground/80"
                />
              }
            />
          }
        >
          <PaperclipIcon className="size-4" />
        </TooltipTrigger>
        <TooltipPopup side="top">Add context</TooltipPopup>
      </Tooltip>
      <PopoverPopup align="start" side="top" className="p-0">
        <ContextPickerPopup
          environmentId={props.environmentId}
          cwd={props.cwd}
          projectId={props.projectId}
          hasSourceControlRemote={props.hasSourceControlRemote}
          hasJiraProvider={props.hasJiraProvider}
          onSelectIssue={(issue) => {
            props.onSelectIssue(issue);
            setOpen(false);
          }}
          onSelectChangeRequest={(cr) => {
            props.onSelectChangeRequest(cr);
            setOpen(false);
          }}
          onSelectWorkItem={(workItem) => {
            props.onSelectWorkItem(workItem);
            setOpen(false);
          }}
          onAttachFile={(file) => {
            props.onAttachFile(file);
            setOpen(false);
          }}
        />
      </PopoverPopup>
    </Popover>
  );
}
