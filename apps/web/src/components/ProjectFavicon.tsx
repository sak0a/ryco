import type { EnvironmentId, ProjectId } from "@ryco/contracts";
import { FolderIcon } from "lucide-react";
import { useState } from "react";
import { resolveEnvironmentHttpUrl } from "../environments/runtime";
import { isHostedHubMode } from "../env";
import { cn } from "../lib/utils";

const loadedProjectFaviconSrcs = new Set<string>();

export function ProjectFavicon(input: {
  environmentId: EnvironmentId;
  cwd: string;
  projectId?: ProjectId;
  customAvatarContentHash?: string | null;
  className?: string;
  fillContainer?: boolean;
}) {
  const src = (() => {
    if (isHostedHubMode()) return null;
    try {
      if (input.customAvatarContentHash && input.projectId) {
        return resolveEnvironmentHttpUrl({
          environmentId: input.environmentId,
          pathname: "/api/project-avatar",
          searchParams: { projectId: input.projectId, v: input.customAvatarContentHash },
        });
      }
      return resolveEnvironmentHttpUrl({
        environmentId: input.environmentId,
        pathname: "/api/project-favicon",
        searchParams: { cwd: input.cwd },
      });
    } catch {
      return null;
    }
  })();
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(() =>
    src && loadedProjectFaviconSrcs.has(src) ? "loaded" : "loading",
  );

  const fallbackClass = input.fillContainer
    ? cn("size-full text-muted-foreground/50", input.className)
    : cn("size-3.5 shrink-0 text-muted-foreground/50", input.className);

  if (!src || status === "error") {
    return <FolderIcon className={fallbackClass} />;
  }

  const imgClass = input.fillContainer
    ? cn("size-full object-cover", status === "loaded" ? "" : "hidden", input.className)
    : cn(
        "size-3.5 shrink-0 rounded-sm object-contain",
        status === "loaded" ? "" : "hidden",
        input.className,
      );

  return (
    <>
      {status !== "loaded" ? <FolderIcon className={fallbackClass} /> : null}
      <img
        src={src}
        alt=""
        className={imgClass}
        onLoad={() => {
          loadedProjectFaviconSrcs.add(src);
          setStatus("loaded");
        }}
        onError={() => setStatus("error")}
      />
    </>
  );
}
