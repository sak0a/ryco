import { RycoLetterMark } from "./RycoLetterMark";

export function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <div className="flex size-24 items-center justify-center" aria-label="Ryco splash screen">
        <RycoLetterMark className="h-16" />
      </div>
    </div>
  );
}
