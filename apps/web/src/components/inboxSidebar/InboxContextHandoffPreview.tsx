import type { EnvironmentId, ModelSelection, ThreadId } from "@ryco/contracts";
import { ArrowRightIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { readEnvironmentApi } from "../../environmentApi";
import { ContextHandoffEndpointLabel } from "../chat/ContextHandoffEndpointLabel";
import { loadInboxContextHandoff, type InboxContextHandoff } from "./inboxContextHandoff";

export function InboxContextHandoffPreview(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  selection: ModelSelection;
}) {
  const [handoff, setHandoff] = useState<InboxContextHandoff | null>(null);
  const { environmentId, threadId, selection } = props;
  useEffect(() => {
    let cancelled = false;
    const api = readEnvironmentApi(environmentId);
    if (api) {
      void loadInboxContextHandoff(api, threadId, selection, () => cancelled)
        .then((result) => {
          if (!cancelled) setHandoff(result);
        })
        .catch(() => {
          /* Optional preview detail must not interrupt navigation. */
        });
    }
    return () => {
      cancelled = true;
    };
  }, [environmentId, threadId, selection]);
  if (!handoff) return null;
  return (
    <div className="space-y-1 border-t border-border/60 pt-1.5" data-testid="inbox-context-handoff">
      <div className="text-[10px] text-muted-foreground/70">Context handoff</div>
      <div className="flex min-w-0 items-center gap-1.5">
        <ContextHandoffEndpointLabel endpoint={handoff.source} className="shrink min-w-0" />
        <ArrowRightIcon aria-label="to" className="size-3 shrink-0 text-muted-foreground/60" />
        <ContextHandoffEndpointLabel endpoint={handoff.target} className="shrink min-w-0" />
      </div>
    </div>
  );
}
