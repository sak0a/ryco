import type { ResourceTelemetryProcess } from "@ryco/contracts";

export function visibleTelemetryProcesses(
  processes: ReadonlyArray<ResourceTelemetryProcess>,
  collapsed: ReadonlySet<string>,
): ReadonlyArray<ResourceTelemetryProcess> {
  const byPid = new Map(processes.map((process) => [process.identity.pid, process]));
  return processes.filter((process) => {
    const visited = new Set([process.identity.pid]);
    let parent = byPid.get(process.ppid);
    while (parent && !visited.has(parent.identity.pid)) {
      if (collapsed.has(`${parent.identity.pid}:${parent.identity.startTimeMs}`)) return false;
      visited.add(parent.identity.pid);
      parent = byPid.get(parent.ppid);
    }
    return true;
  });
}
