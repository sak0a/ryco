import { GitBranchPlusIcon, MonitorIcon } from "lucide-react";
import { memo } from "react";

import type { EnvMode } from "./BranchToolbar.logic";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

interface BranchToolbarEnvModeSelectorProps {
  value: EnvMode;
  onChange: (envMode: EnvMode) => void;
}

const ENV_MODE_ITEMS = [
  { value: "local" as const, label: "Local" },
  { value: "worktree" as const, label: "New worktree" },
];

/**
 * Chooses whether the next turn runs against the project checkout or a fresh
 * worktree. In `worktree` mode the branch selector beside this one picks the
 * *base* branch and the worktree is materialized on the first send — see
 * `resolveChatSendWorktreePlan` in `ChatView.logic.ts`.
 *
 * Only rendered for unlocked draft threads: once a thread has messages or a
 * live session its execution location is fixed.
 */
export const BranchToolbarEnvModeSelector = memo(function BranchToolbarEnvModeSelector({
  value,
  onChange,
}: BranchToolbarEnvModeSelectorProps) {
  return (
    <Select
      modal={false}
      value={value}
      onValueChange={(next) => onChange(next as EnvMode)}
      items={ENV_MODE_ITEMS}
    >
      <SelectTrigger variant="ghost" size="xs" className="font-medium" aria-label="Run in">
        {value === "worktree" ? (
          <GitBranchPlusIcon className="size-3" />
        ) : (
          <MonitorIcon className="size-3" />
        )}
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        <SelectGroup>
          <SelectGroupLabel>Run in</SelectGroupLabel>
          {ENV_MODE_ITEMS.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              <span className="inline-flex items-center gap-1.5">
                {item.value === "worktree" ? (
                  <GitBranchPlusIcon className="size-3" />
                ) : (
                  <MonitorIcon className="size-3" />
                )}
                {item.label}
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectPopup>
    </Select>
  );
});
