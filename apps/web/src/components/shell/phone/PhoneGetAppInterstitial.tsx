import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { BRANDED_APP_LOGO_SRC } from "../../../brandedLogo";
import { glassSurfaceClassName } from "../../mobile/GlassSurface";

export interface PhoneGetAppInterstitialProps {
  readonly appUrl: string;
  readonly onDismiss: () => void;
}

export function PhoneGetAppInterstitial({ appUrl, onDismiss }: PhoneGetAppInterstitialProps) {
  const getAppRef = useRef<HTMLAnchorElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const root = document.getElementById("root");
    root?.setAttribute("inert", "");
    getAppRef.current?.focus();

    return () => root?.removeAttribute("inert");
  }, []);

  return createPortal(
    <div
      aria-labelledby="phone-get-app-interstitial-heading"
      aria-modal="true"
      className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-background/72 px-[max(1rem,env(safe-area-inset-left),env(safe-area-inset-right))] pt-[max(1.5rem,calc(env(safe-area-inset-top)+1rem))] pb-[max(1.5rem,calc(env(safe-area-inset-bottom)+1rem))] text-popover-foreground backdrop-blur-sm transition-opacity duration-[var(--app-motion-duration-sheet)] motion-reduce:transition-none"
      role="dialog"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onDismiss();
          return;
        }
        if (event.key !== "Tab") {
          return;
        }

        const first = getAppRef.current;
        const last = continueRef.current;
        if (!first || !last) {
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <section
        className={`${glassSurfaceClassName("sheet")} w-full max-w-sm rounded-3xl border border-border/70 p-6 shadow-xl shadow-black/15`}
      >
        <img
          alt=""
          className="size-14 object-contain"
          draggable={false}
          src={BRANDED_APP_LOGO_SRC}
        />
        <h1
          id="phone-get-app-interstitial-heading"
          className="mt-6 font-heading text-3xl font-semibold tracking-tight"
        >
          Ryco is better as an app
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Pick up where you left off with a native experience built for your phone.
        </p>
        <div className="mt-8 grid gap-3">
          <a
            ref={getAppRef}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
            href={appUrl}
            rel="noreferrer"
            target="_blank"
          >
            Get the app
          </a>
          <button
            ref={continueRef}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            type="button"
            onClick={onDismiss}
          >
            Continue in browser
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
