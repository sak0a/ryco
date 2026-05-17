import { Context, DateTime, Duration, Effect, Fiber, Layer, Schema } from "effect";
import pidtree from "pidtree";
import { DetectedServerRegistry } from "../Services/DetectedServerRegistry.ts";
import { SocketProbe } from "./SocketProbe.ts";
import { LivenessHeartbeat } from "./LivenessHeartbeat.ts";
import { StdoutSniffer } from "./StdoutSniffer.ts";
import { hintFromArgv, type PackageJsonShape } from "./ArgvHinter.ts";

class PidtreeError extends Schema.TaggedErrorClass<PidtreeError>("s3/detectedServers/PidtreeError")(
  "PidtreeError",
  { pid: Schema.Int },
) {}

const DEBUGGER_PORTS = new Set([9229, 9230]);

const argvHasInspect = (argv: ReadonlyArray<string>): number[] => {
  const out: number[] = [];
  for (const t of argv) {
    const m = t.match(/--inspect(?:-brk|-wait)?=(?:[^:]*:)?(\d+)/);
    if (m) out.push(Number.parseInt(m[1]!, 10));
  }
  return out;
};

export interface CodexCommandSource {
  threadId: string;
  turnId: string;
  itemId: string;
  argv: ReadonlyArray<string>;
  cwd: string;
}

export interface PtyCommandSource {
  threadId: string;
  terminalId: string;
  pid: number;
  argv: ReadonlyArray<string>;
  cwd: string;
}

export interface CommandTracker {
  feed: (chunk: string) => void;
  end: (result: "success" | "error") => void;
}

export interface PtyTracker {
  feed: (chunk: string) => void;
  feedCommand: (argv: ReadonlyArray<string>, cwd: string) => void;
  end: (exitCode: number | null) => void;
}

export interface DetectedServersIngressShape {
  readonly trackAgentCommand: (
    source: CodexCommandSource,
    sourceKind: "codex" | "acp",
    pkg: PackageJsonShape | undefined,
  ) => Effect.Effect<CommandTracker>;
  readonly trackPty: (
    source: PtyCommandSource,
    pkg: PackageJsonShape | undefined,
  ) => Effect.Effect<PtyTracker>;
}

export class DetectedServersIngress extends Context.Service<
  DetectedServersIngress,
  DetectedServersIngressShape
>()("s3/detectedServers/Layers/DetectedServersIngress") {}

const noopTracker = (): CommandTracker => ({ feed: () => {}, end: () => {} });

export const DetectedServersIngressLive = Layer.effect(
  DetectedServersIngress,
  Effect.gen(function* () {
    const registry = yield* DetectedServerRegistry;
    const probe = yield* SocketProbe;
    const heartbeat = yield* LivenessHeartbeat;
    const context = yield* Effect.context<never>();
    const runFork = Effect.runForkWith(context);

    const trackAgentCommand = (
      source: CodexCommandSource,
      sourceKind: "codex" | "acp",
      pkg: PackageJsonShape | undefined,
    ): Effect.Effect<CommandTracker> =>
      Effect.gen(function* () {
        const hint = hintFromArgv(source.argv, pkg);
        if (!hint.isLikelyServer) return noopTracker();

        const identityKey = `${source.threadId}::${sourceKind}::${source.turnId}::${source.itemId}`;
        const server = yield* registry.registerOrUpdate({
          threadId: source.threadId,
          source: sourceKind,
          identityKey,
          patch: {
            framework: hint.framework,
            status: "predicted",
            argv: source.argv,
            cwd: source.cwd,
          },
        });

        const sniffer = new StdoutSniffer();
        const unsubCandidate = sniffer.onCandidate((c) => {
          runFork(
            registry.registerOrUpdate({
              threadId: source.threadId,
              source: sourceKind,
              identityKey,
              patch: {
                status: "candidate",
                framework: c.framework !== "unknown" ? c.framework : hint.framework,
                url: c.url,
                port: c.port,
                host: c.host,
              },
            }),
          );
        });

        return {
          feed: (chunk: string) => {
            sniffer.feed(chunk);
            runFork(registry.publishLog(server.id, chunk));
          },
          end: (result: "success" | "error") => {
            unsubCandidate();
            runFork(
              registry.registerOrUpdate({
                threadId: source.threadId,
                source: sourceKind,
                identityKey,
                patch: {
                  status: "exited",
                  exitedAt: DateTime.fromDateUnsafe(new Date()),
                  exitReason: result === "success" ? "stopped" : "crashed",
                },
              }),
            );
          },
        };
      });

    const trackPty = (
      source: PtyCommandSource,
      pkg: PackageJsonShape | undefined,
    ): Effect.Effect<PtyTracker> =>
      Effect.gen(function* () {
        interface SubTracker {
          serverId: string;
          identityKey: string;
          sniffer: StdoutSniffer;
          unsubCandidate: () => void;
          probeFiber: Fiber.Fiber<void, never>;
        }

        const subTrackers: SubTracker[] = [];
        let commandSeq = 0;

        const startSubTracker = (
          argv: ReadonlyArray<string>,
          cwd: string,
        ): Effect.Effect<SubTracker | null> =>
          Effect.gen(function* () {
            const hint = hintFromArgv(argv, pkg);
            if (!hint.isLikelyServer) return null;

            commandSeq += 1;
            const identityKey = `${source.threadId}::pty::${source.pid}::${commandSeq}`;
            const server = yield* registry.registerOrUpdate({
              threadId: source.threadId,
              source: "pty",
              identityKey,
              patch: {
                framework: hint.framework,
                status: "predicted",
                pid: source.pid,
                terminalId: source.terminalId,
                argv,
                cwd,
              },
            });

            const sniffer = new StdoutSniffer();
            let sniffedPort: number | null = null;
            const unsubCandidate = sniffer.onCandidate((c) => {
              sniffedPort = c.port;
              runFork(
                registry.registerOrUpdate({
                  threadId: source.threadId,
                  source: "pty",
                  identityKey,
                  patch: {
                    status: "candidate",
                    framework: c.framework !== "unknown" ? c.framework : hint.framework,
                    url: c.url,
                    port: c.port,
                    host: c.host,
                  },
                }),
              );
            });

            const denyPorts = new Set<number>([...DEBUGGER_PORTS, ...argvHasInspect(argv)]);

            const probeFiber = runFork(
              Effect.gen(function* () {
                let liveSeenAt: Date | null = null;
                let lastConfirmedPort: number | null = null;
                while (true) {
                  const pids = yield* Effect.tryPromise({
                    try: () => pidtree(source.pid, { root: true }),
                    catch: () => new PidtreeError({ pid: source.pid }),
                  }).pipe(Effect.orElseSucceed(() => [source.pid] as number[]));
                  const rows = yield* probe.probe(pids);
                  const candidates = rows.filter((r) => !denyPorts.has(r.port));
                  if (candidates.length > 0 && !liveSeenAt) {
                    // Probe heartbeat on each candidate, preferring the sniffed
                    // port. The first one that responds wins — this avoids
                    // sticking on a transient port that briefly listened during
                    // startup but isn't the real server.
                    const ordered = sniffedPort
                      ? [
                          ...candidates.filter((r) => r.port === sniffedPort),
                          ...candidates.filter((r) => r.port !== sniffedPort),
                        ]
                      : candidates;
                    let liveCandidate: (typeof candidates)[number] | undefined;
                    for (const c of ordered) {
                      const ok = yield* heartbeat.check(`http://localhost:${c.port}`);
                      if (ok) {
                        liveCandidate = c;
                        break;
                      }
                    }
                    if (liveCandidate) {
                      liveSeenAt = new Date();
                      yield* registry.registerOrUpdate({
                        threadId: source.threadId,
                        source: "pty",
                        identityKey,
                        patch: {
                          status: "live",
                          port: liveCandidate.port,
                          host: liveCandidate.host,
                          url: `http://localhost:${liveCandidate.port}`,
                          liveAt: DateTime.fromDateUnsafe(liveSeenAt),
                        },
                      });
                    } else {
                      const preferred = ordered[0]!;
                      if (lastConfirmedPort !== preferred.port) {
                        lastConfirmedPort = preferred.port;
                        yield* registry.registerOrUpdate({
                          threadId: source.threadId,
                          source: "pty",
                          identityKey,
                          patch: {
                            status: "confirmed",
                            port: preferred.port,
                            host: preferred.host,
                          },
                        });
                      }
                    }
                  }
                  yield* Effect.sleep(liveSeenAt ? Duration.seconds(2) : Duration.millis(250));
                }
              }),
            );

            return { serverId: server.id, identityKey, sniffer, unsubCandidate, probeFiber };
          });

        const initial = yield* startSubTracker(source.argv, source.cwd);
        if (initial) subTrackers.push(initial);

        return {
          feed: (chunk: string) => {
            for (const sub of subTrackers) {
              sub.sniffer.feed(chunk);
              runFork(registry.publishLog(sub.serverId, chunk));
            }
          },
          feedCommand: (argv: ReadonlyArray<string>, cwd: string) => {
            runFork(
              Effect.gen(function* () {
                const sub = yield* startSubTracker(argv, cwd);
                if (sub) subTrackers.push(sub);
              }),
            );
          },
          end: (exitCode: number | null) => {
            const status = exitCode === 0 || exitCode === null ? "exited" : "crashed";
            const exitReason: "stopped" | "crashed" = status === "exited" ? "stopped" : "crashed";
            for (const sub of subTrackers) {
              sub.unsubCandidate();
              runFork(Fiber.interrupt(sub.probeFiber).pipe(Effect.ignore));
              runFork(
                registry.registerOrUpdate({
                  threadId: source.threadId,
                  source: "pty",
                  identityKey: sub.identityKey,
                  patch: {
                    status,
                    exitedAt: DateTime.fromDateUnsafe(new Date()),
                    exitReason,
                  },
                }),
              );
            }
          },
        };
      });

    return { trackAgentCommand, trackPty };
  }),
);
