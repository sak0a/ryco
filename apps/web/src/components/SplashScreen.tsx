import { BRANDED_APP_LOGO_SRC } from "../brandedLogo";

export function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex size-24 items-center justify-center" aria-label="Ryco splash screen">
        <img alt="Ryco" className="size-16 object-contain" src={BRANDED_APP_LOGO_SRC} />
      </div>
    </div>
  );
}
