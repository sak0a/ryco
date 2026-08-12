import { useEffect, useRef, useState } from "react";

const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  readonly render: (
    container: HTMLElement,
    options: {
      readonly sitekey: string;
      readonly theme: "auto";
      readonly callback: (token: string) => void;
      readonly "expired-callback": () => void;
      readonly "error-callback": () => void;
    },
  ) => string;
  readonly remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileScriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileScriptPromise) return turnstileScriptPromise;
  turnstileScriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${TURNSTILE_SCRIPT_URL}"]`,
    );
    const script = existing ?? document.createElement("script");
    const loaded = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("Turnstile did not initialize"));
    };
    const failed = () => reject(new Error("Turnstile could not be loaded"));
    script.addEventListener("load", loaded, { once: true });
    script.addEventListener("error", failed, { once: true });
    if (!existing) {
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.append(script);
    }
  }).catch((error: unknown) => {
    turnstileScriptPromise = null;
    throw error;
  });
  return turnstileScriptPromise;
}

export function TurnstileWidget({
  siteKey,
  onToken,
}: {
  readonly siteKey: string;
  readonly onToken: (token: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let widget: { readonly api: TurnstileApi; readonly id: string } | null = null;
    onToken(null);
    setFailed(false);
    void loadTurnstile()
      .then((api) => {
        if (disposed || containerRef.current === null) return;
        const id = api.render(containerRef.current, {
          sitekey: siteKey,
          theme: "auto",
          callback: (token) => {
            if (!disposed) onToken(token);
          },
          "expired-callback": () => {
            if (!disposed) onToken(null);
          },
          "error-callback": () => {
            if (!disposed) {
              onToken(null);
              setFailed(true);
            }
          },
        });
        widget = { api, id };
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      onToken(null);
      if (widget) widget.api.remove(widget.id);
    };
  }, [onToken, siteKey]);

  return (
    <div className="space-y-2">
      <div ref={containerRef} aria-label="Anti-bot verification" />
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          Verification could not load. Check your connection and try again.
        </p>
      ) : null}
    </div>
  );
}
