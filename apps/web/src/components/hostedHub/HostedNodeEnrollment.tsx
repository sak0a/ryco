import { AlertTriangleIcon, CheckCircle2Icon, ServerIcon } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { hostedHubApi, HostedHubApiError } from "../../hostedHub/api";
import { hostedHubController } from "../../hostedHub/state";
import type { HostedNodeEnrollment } from "../../hostedHub/types";
import { Button } from "../ui/button";
import { DataList, DataListItem } from "../ui/data-list";
import { Input, TOUCH_INPUT_CLASS_NAME } from "../ui/input";
import { Label } from "../ui/label";

export function HostedNodeEnrollmentFlow({ onClose }: { readonly onClose: () => void }) {
  const [input, setInput] = useState("");
  const [enrollment, setEnrollment] = useState<HostedNodeEnrollment | null>(null);
  const [status, setStatus] = useState<
    "input" | "review" | "confirm-denial" | "approved" | "denied"
  >("input");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const codeRef = useRef("");
  const operationRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      operationRef.current?.abort();
      operationRef.current = null;
      codeRef.current = "";
    },
    [],
  );

  const startOperation = () => {
    operationRef.current?.abort();
    const operation = new AbortController();
    operationRef.current = operation;
    setPending(true);
    setMessage(null);
    return operation;
  };

  const finishOperation = (operation: AbortController) => {
    if (operationRef.current !== operation) return;
    operationRef.current = null;
    setPending(false);
  };

  const handleFailure = async (error: unknown, fallback?: string) => {
    if (error instanceof DOMException && error.name === "AbortError") return;
    if (error instanceof HostedHubApiError && error.status === 401) {
      codeRef.current = "";
      setInput("");
      setEnrollment(null);
      await hostedHubController.expireSession();
      return;
    }
    setMessage(
      fallback ??
        (error instanceof HostedHubApiError ? error.message : "Hub is temporarily unavailable."),
    );
  };

  const lookup = async (event: FormEvent) => {
    event.preventDefault();
    const deviceCode = input.trim();
    setInput("");
    codeRef.current = "";
    const operation = startOperation();
    try {
      const result = await hostedHubApi.lookupNodeEnrollment(deviceCode, operation.signal);
      if (operation.signal.aborted) return;
      codeRef.current = deviceCode;
      setEnrollment(result);
      setStatus("review");
    } catch (error) {
      await handleFailure(error);
    } finally {
      finishOperation(operation);
    }
  };

  const approve = async () => {
    const deviceCode = codeRef.current;
    if (!deviceCode || !enrollment) return;
    const operation = startOperation();
    try {
      await hostedHubApi.approveNodeEnrollment(deviceCode, operation.signal);
      if (operation.signal.aborted) return;
      codeRef.current = "";
      setEnrollment(null);
      setStatus("approved");
      await hostedHubController.refreshDirectory();
    } catch (error) {
      codeRef.current = "";
      setEnrollment(null);
      setStatus("input");
      await handleFailure(
        error,
        "The approval result is unknown. Enter the device code again to verify its current state.",
      );
    } finally {
      finishOperation(operation);
    }
  };

  const deny = async () => {
    const deviceCode = codeRef.current;
    if (!deviceCode || !enrollment) return;
    const operation = startOperation();
    try {
      await hostedHubApi.denyNodeEnrollment(deviceCode, operation.signal);
      if (operation.signal.aborted) return;
      codeRef.current = "";
      setEnrollment(null);
      setStatus("denied");
    } catch (error) {
      await handleFailure(error);
    } finally {
      finishOperation(operation);
    }
  };

  const close = () => {
    operationRef.current?.abort();
    codeRef.current = "";
    setInput("");
    setEnrollment(null);
    onClose();
  };

  if (status === "approved" || status === "denied") {
    return (
      <div>
        <CheckCircle2Icon aria-hidden className="size-8 text-primary" />
        <h1 className="mt-4 text-2xl font-semibold">
          {status === "approved" ? "Node approved" : "Enrollment denied"}
        </h1>
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          {status === "approved"
            ? "The node can now finish enrollment and connect. Online presence may take a few seconds."
            : "This ceremony cannot be reused. Start a new enrollment on the node if needed."}
        </p>
        <Button className="mt-5" onClick={close}>
          Back to nodes
        </Button>
      </div>
    );
  }

  if (enrollment) {
    return (
      <div>
        <ServerIcon aria-hidden className="size-8 text-primary" />
        <h1 className="mt-4 text-2xl font-semibold">Review node enrollment</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Compare every field, especially the fingerprint, with the node or a trusted operator
          channel before approving.
        </p>
        {/* The same primitive the node detail sheet uses. The fingerprint is
            the security-critical comparison, and one shared identifier
            treatment is what keeps it from wrapping differently on the two
            screens a reviewer holds side by side. */}
        <DataList className="mt-5 rounded-xl border border-border bg-background p-4">
          <DataListItem term="Label">
            <span className="font-medium break-words">{enrollment.label}</span>
          </DataListItem>
          <DataListItem term="Platform">
            {`${enrollment.platformOs} · ${enrollment.platformArch}`}
          </DataListItem>
          <DataListItem term="Version" mono>
            {enrollment.clientVersion}
          </DataListItem>
          <DataListItem term="Algorithm">{enrollment.algorithm}</DataListItem>
          <DataListItem term="Fingerprint" mono>
            {enrollment.fingerprint}
          </DataListItem>
          <DataListItem term="Expires">
            {new Date(enrollment.expiresAt).toLocaleString()}
          </DataListItem>
        </DataList>
        {message ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {message}
          </p>
        ) : null}
        {status === "confirm-denial" ? (
          <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <p className="flex gap-2 text-sm">
              <AlertTriangleIcon aria-hidden className="mt-0.5 size-4 shrink-0" /> Denial is
              permanent for this device code.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="destructive" disabled={pending} onClick={() => void deny()}>
                Confirm denial
              </Button>
              <Button variant="outline" disabled={pending} onClick={() => setStatus("review")}>
                Keep reviewing
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-5 flex flex-wrap gap-2">
            <Button disabled={pending} onClick={() => void approve()}>
              {pending ? "Approving…" : "Approve node"}
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setStatus("confirm-denial")}
            >
              Deny
            </Button>
            <Button variant="ghost" disabled={pending} onClick={close}>
              Cancel
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <ServerIcon aria-hidden className="size-8 text-primary" />
      <h1 className="mt-4 text-2xl font-semibold">Enroll a Ryco node</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Start enrollment on the node, then enter the short device code shown there. Codes expire
        after ten minutes.
      </p>
      {message ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {message}
        </p>
      ) : null}
      <form className="mt-5 space-y-4" autoComplete="off" onSubmit={(event) => void lookup(event)}>
        <div className="space-y-1.5">
          <Label htmlFor="hub-node-device-code">Device code</Label>
          <Input
            id="hub-node-device-code"
            required
            autoFocus
            maxLength={16}
            value={input}
            className={`font-mono uppercase ${TOUCH_INPUT_CLASS_NAME}`}
            onChange={(event) => setInput(event.currentTarget.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Looking up…" : "Review node"}
          </Button>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
