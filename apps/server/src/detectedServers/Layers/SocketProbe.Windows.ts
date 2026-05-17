import { Effect, Layer, Schema } from "effect";
import { spawn } from "node:child_process";
import { SocketProbe, type ProbeResult } from "./SocketProbe.ts";

class SocketProbeError extends Schema.TaggedErrorClass<SocketProbeError>(
  "s3/detectedServers/SocketProbeError",
)("SocketProbeError", { stage: Schema.String }) {}

export const parseNetstatOutput = (text: string): ProbeResult[] => {
  if (!text.trim()) return [];
  const out: ProbeResult[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("TCP")) continue;
    if (!line.includes("LISTENING")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 5) continue;
    const local = parts[1]!;
    const pid = Number.parseInt(parts[4]!, 10);
    let host: string;
    let port: number;
    if (local.startsWith("[")) {
      const m = local.match(/^\[([^\]]+)\]:(\d+)$/);
      if (!m) continue;
      host = m[1]!;
      port = Number.parseInt(m[2]!, 10);
    } else {
      const idx = local.lastIndexOf(":");
      if (idx < 0) continue;
      host = local.slice(0, idx);
      port = Number.parseInt(local.slice(idx + 1), 10);
    }
    if (Number.isFinite(pid) && Number.isFinite(port)) out.push({ pid, port, host });
  }
  return out;
};

const runNetstat = (): Effect.Effect<string> =>
  Effect.tryPromise({
    try: () =>
      new Promise<string>((resolve) => {
        const child = spawn("netstat", ["-ano"], { stdio: ["ignore", "pipe", "ignore"] });
        let buf = "";
        child.stdout.on("data", (d: Buffer) => (buf += d.toString("utf8")));
        child.on("error", () => resolve(""));
        child.on("close", () => resolve(buf));
      }),
    catch: () => new SocketProbeError({ stage: "netstat" }),
  }).pipe(Effect.orElseSucceed(() => ""));

const probeImpl = (pids: ReadonlyArray<number>): Effect.Effect<ReadonlyArray<ProbeResult>> =>
  Effect.gen(function* () {
    if (pids.length === 0) return [];
    const out = yield* runNetstat();
    const pidSet = new Set(pids);
    return parseNetstatOutput(out).filter((r) => pidSet.has(r.pid));
  });

export const SocketProbeWindowsLive = Layer.succeed(SocketProbe, { probe: probeImpl });
