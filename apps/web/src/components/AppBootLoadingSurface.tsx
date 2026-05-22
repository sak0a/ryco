import { APP_DISPLAY_NAME } from "../branding";

export function AppBootLoadingSurface() {
  return (
    <div
      aria-label={`${APP_DISPLAY_NAME} is starting`}
      className="flex min-h-screen items-center justify-center bg-background text-foreground"
      role="status"
    >
      <div className="grid size-24 place-items-center">
        <img
          alt=""
          className="size-16 animate-pulse object-contain"
          draggable={false}
          src="/apple-touch-icon.png"
        />
      </div>
    </div>
  );
}
