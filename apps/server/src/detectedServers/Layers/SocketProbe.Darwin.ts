import { Effect, Layer, Schema } from "effect";
import { spawn } from "node:child_process";
import { SocketProbe, type ProbeResult } from "./SocketProbe.ts";

class SocketProbeError extends Schema.TaggedErrorClass<SocketProbeError>(
  "s3/detectedServers/SocketProbeError",
)("SocketProbeError", { stage: Schema.String }) {}

export const parseLsofOutput = (text: string): ProbeResult[] => {
  if (!text.trim()) return [];
  const lines = text.split("\n").slice(1);
  const out: ProbeResult[] = [];
  for (const line of lines) {
    if (!line.includes("(LISTEN)")) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 9) continue;
    const pid = Number.parseInt(parts[1]!, 10);
    const nameField = parts.slice(8, parts.length - 1).join(" ");
    let host = "0.0.0.0";
    let port = -1;
    const ipv6 = nameField.match(/^\[([^\]]+)\]:(\d+)/);
    const ipv4 = nameField.match(/^([^:]+):(\d+)/);
    if (ipv6) {
      host = ipv6[1]!;
      port = Number.parseInt(ipv6[2]!, 10);
    } else if (ipv4) {
      host = ipv4[1] === "*" ? "0.0.0.0" : ipv4[1]!;
      port = Number.parseInt(ipv4[2]!, 10);
    }
    if (port > 0) out.push({ pid, port, host });
  }
  return out;
};

const runLsof = (pids: ReadonlyArray<number>): Effect.Effect<string> => {
  if (pids.length === 0) return Effect.succeed("");
  return Effect.tryPromise({
    try: () =>
      new Promise<string>((resolve) => {
        const child = spawn("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-a", "-p", pids.join(",")], {
          stdio: ["ignore", "pipe", "ignore"],
        });
        let buf = "";
        child.stdout.on("data", (d: Buffer) => (buf += d.toString("utf8")));
        child.on("error", () => resolve(""));
        child.on("close", () => resolve(buf));
      }),
    catch: () => new SocketProbeError({ stage: "lsof" }),
  }).pipe(Effect.orElseSucceed(() => ""));
};

const probeImpl = (pids: ReadonlyArray<number>): Effect.Effect<ReadonlyArray<ProbeResult>> =>
  Effect.gen(function* () {
    const out = yield* runLsof(pids);
    return parseLsofOutput(out);
  });

export const SocketProbeDarwinLive = Layer.succeed(SocketProbe, { probe: probeImpl });
