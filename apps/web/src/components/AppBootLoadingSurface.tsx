import { APP_DISPLAY_NAME } from "../branding";
import { RycoLetterMark } from "./RycoLetterMark";

export function AppBootLoadingSurface() {
  return (
    <div
      aria-label={`${APP_DISPLAY_NAME} is starting`}
      className="flex min-h-screen items-center justify-center bg-background text-foreground"
      role="status"
    >
      {/* Deliberately the same mark, size, and pulse as the pre-React boot
          shell in `index.html`, so handing over from the static shell to React
          is invisible rather than a swap between two different logos. */}
      <div className="grid size-24 place-items-center">
        <RycoLetterMark className="h-16 animate-boot-logo-pulse motion-reduce:animate-none" />
      </div>
    </div>
  );
}
