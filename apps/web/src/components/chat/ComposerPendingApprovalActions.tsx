import {
  ORCHESTRATION_WS_METHODS,
  type ApprovalRequestId,
  type ProviderApprovalDecision,
} from "@ryco/contracts";
import { memo } from "react";
import { useHostedRpcCapability } from "../../hostedHub/capabilities";
import { Button } from "../ui/button";

interface ComposerPendingApprovalActionsProps {
  requestId: ApprovalRequestId;
  isResponding: boolean;
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<void>;
}

export const ComposerPendingApprovalActions = memo(function ComposerPendingApprovalActions({
  requestId,
  isResponding,
  onRespondToApproval,
}: ComposerPendingApprovalActionsProps) {
  const capability = useHostedRpcCapability(ORCHESTRATION_WS_METHODS.dispatchCommand);
  const disabled = isResponding || !capability.allowed;
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        title={capability.reason ?? undefined}
        onClick={() => void onRespondToApproval(requestId, "cancel")}
      >
        Cancel turn
      </Button>
      <Button
        size="sm"
        variant="destructive-outline"
        disabled={disabled}
        title={capability.reason ?? undefined}
        onClick={() => void onRespondToApproval(requestId, "decline")}
      >
        Decline
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        title={capability.reason ?? undefined}
        onClick={() => void onRespondToApproval(requestId, "acceptForSession")}
      >
        Always allow this session
      </Button>
      <Button
        size="sm"
        variant="default"
        disabled={disabled}
        title={capability.reason ?? undefined}
        onClick={() => void onRespondToApproval(requestId, "accept")}
      >
        Approve once
      </Button>
    </>
  );
});
