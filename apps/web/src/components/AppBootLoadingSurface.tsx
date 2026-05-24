import { APP_DISPLAY_NAME } from "../branding";
import { BRANDED_APP_LOGO_SRC } from "../brandedLogo";

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
          className="size-16 animate-boot-logo-pulse object-contain motion-reduce:animate-none"
          draggable={false}
          src={BRANDED_APP_LOGO_SRC}
        />
      </div>
    </div>
  );
}
