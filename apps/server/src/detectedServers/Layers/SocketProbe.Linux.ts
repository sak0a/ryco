import { Effect, Layer, Schema } from "effect";
import { readFile, readdir, readlink } from "node:fs/promises";
import { SocketProbe, type ProbeResult } from "./SocketProbe.ts";

class SocketProbeError extends Schema.TaggedErrorClass<SocketProbeError>(
  "s3/detectedServers/SocketProbeError",
)("SocketProbeError", { stage: Schema.String }) {}

export interface ProcTcpRow {
  inode: number;
  port: number;
  host: string;
  state: "LISTEN" | string;
}

const STATE_MAP: Record<string, "LISTEN"> = { "0A": "LISTEN" };

const hexToIpv4 = (hex: string): string => {
  // /proc reverses byte order: "0100007F" → "127.0.0.1"
  const bytes = [hex.slice(6, 8), hex.slice(4, 6), hex.slice(2, 4), hex.slice(0, 2)];
  return bytes.map((b) => Number.parseInt(b, 16)).join(".");
};

const hexToIpv6 = (hex: string): string => {
  if (hex === "00000000000000000000000000000000") return "::";
  const groups: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    const start = i * 4;
    groups.push(hex.slice(start, start + 4).toLowerCase());
  }
  return groups.join(":");
};

export const parseProcTcpRows = (text: string): ProcTcpRow[] => {
  const lines = text
    .split("\n")
    .slice(1)
    .filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const parts = line.trim().split(/\s+/);
    const [hostHex, portHex] = parts[1]!.split(":");
    const state = STATE_MAP[parts[3]!] ?? parts[3]!;
    return {
      inode: Number.parseInt(parts[9]!, 10),
      port: Number.parseInt(portHex!, 16),
      host: hexToIpv4(hostHex!),
      state,
    };
  });
};

export const parseProcTcp6Rows = (text: string): ProcTcpRow[] => {
  const lines = text
    .split("\n")
    .slice(1)
    .filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const parts = line.trim().split(/\s+/);
    const [hostHex, portHex] = parts[1]!.split(":");
    const state = STATE_MAP[parts[3]!] ?? parts[3]!;
    return {
      inode: Number.parseInt(parts[9]!, 10),
      port: Number.parseInt(portHex!, 16),
      host: hostHex === "00000000000000000000000000000000" ? "::" : hexToIpv6(hostHex!),
      state,
    };
  });
};

const inodesForPid = (pid: number): Effect.Effect<ReadonlySet<number>> =>
  Effect.tryPromise({
    try: async () => {
      const fdDir = `/proc/${pid}/fd`;
      const entries = await readdir(fdDir);
      const inodes = new Set<number>();
      await Promise.all(
        entries.map(async (e) => {
          try {
            const target = await readlink(`${fdDir}/${e}`);
            const m = target.match(/^socket:\[(\d+)\]$/);
            if (m) inodes.add(Number.parseInt(m[1]!, 10));
          } catch {
            // fd may have closed between readdir and readlink — ignore
          }
        }),
      );
      return inodes;
    },
    catch: () => new SocketProbeError({ stage: "inodes" }),
  }).pipe(Effect.orElseSucceed(() => new Set<number>()));

const probeImpl = (pids: ReadonlyArray<number>): Effect.Effect<ReadonlyArray<ProbeResult>> =>
  Effect.gen(function* () {
    const pidInodes = yield* Effect.all(
      pids.map((pid) => Effect.map(inodesForPid(pid), (inodes) => ({ pid, inodes }))),
    );
    const inodeToPid = new Map<number, number>();
    for (const { pid, inodes } of pidInodes) {
      for (const inode of inodes) inodeToPid.set(inode, pid);
    }

    const tcpText = yield* Effect.tryPromise({
      try: () => readFile("/proc/net/tcp", "utf8"),
      catch: () => new SocketProbeError({ stage: "tcp" }),
    }).pipe(Effect.orElseSucceed(() => ""));
    const tcp6Text = yield* Effect.tryPromise({
      try: () => readFile("/proc/net/tcp6", "utf8"),
      catch: () => new SocketProbeError({ stage: "tcp6" }),
    }).pipe(Effect.orElseSucceed(() => ""));

    const rows = [...parseProcTcpRows(tcpText), ...parseProcTcp6Rows(tcp6Text)];
    return rows
      .filter((r) => r.state === "LISTEN" && inodeToPid.has(r.inode))
      .map((r) => ({ pid: inodeToPid.get(r.inode)!, port: r.port, host: r.host }));
  });

export const SocketProbeLinuxLive = Layer.succeed(SocketProbe, { probe: probeImpl });
