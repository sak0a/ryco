/**
 * Floating switcher pinned to every version so reviewers can hop between the
 * five art directions (/1 … /5) and back to the index. Intentionally neutral
 * so it reads on any palette.
 */
import { Link, useLocation } from "react-router-dom";
import { VERSIONS } from "@/data/content";
import { cn } from "@/lib/cn";

export function VersionSwitcher() {
  const { pathname } = useLocation();
  return (
    <div className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2">
      <nav className="flex items-center gap-1 rounded-full border border-white/15 bg-black/70 px-1.5 py-1.5 text-xs text-white shadow-2xl backdrop-blur-xl">
        <Link
          to="/"
          className="grid size-7 place-items-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white"
          title="Overview"
          aria-label="Overview"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z" />
          </svg>
        </Link>
        <span className="mx-0.5 h-4 w-px bg-white/15" />
        {VERSIONS.map((v) => {
          const active = pathname === v.path;
          return (
            <Link
              key={v.id}
              to={v.path}
              title={`${v.name} — ${v.desc}`}
              className={cn(
                "grid size-7 place-items-center rounded-full font-semibold transition",
                active ? "bg-white text-black" : "text-white/70 hover:bg-white/10 hover:text-white",
              )}
            >
              {v.id}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
