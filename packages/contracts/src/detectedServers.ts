import { Schema } from "effect";

export const ServerStatus = Schema.Literals([
  "predicted",
  "candidate",
  "confirmed",
  "live",
  "restarting",
  "exited",
  "crashed",
]);
export type ServerStatus = typeof ServerStatus.Type;

export const ServerSource = Schema.Literals(["codex", "acp", "pty"]);
export type ServerSource = typeof ServerSource.Type;

export const ServerFramework = Schema.Literals([
  "vite",
  "next",
  "nuxt",
  "remix",
  "astro",
  "wrangler",
  "webpack",
  "vitest-ui",
  "storybook",
  "mcp-http",
  "express",
  "unknown",
]);
export type ServerFramework = typeof ServerFramework.Type;

export const ExitReason = Schema.Literals(["stopped", "crashed", "lost-socket"]);
export type ExitReason = typeof ExitReason.Type;

export const DetectedServer = Schema.Struct({
  id: Schema.String.check(Schema.isNonEmpty()),
  threadId: Schema.String.check(Schema.isNonEmpty()),
  source: ServerSource,
  framework: ServerFramework,
  status: ServerStatus,
  url: Schema.optional(Schema.String),
  port: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  host: Schema.optional(Schema.String),
  pid: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  terminalId: Schema.optional(Schema.String),
  argv: Schema.optional(Schema.Array(Schema.String)),
  cwd: Schema.optional(Schema.String),
  startedAt: Schema.DateTimeUtc,
  liveAt: Schema.optional(Schema.DateTimeUtc),
  lastSeenAt: Schema.DateTimeUtc,
  exitedAt: Schema.optional(Schema.DateTimeUtc),
  exitReason: Schema.optional(ExitReason),
});
export type DetectedServer = typeof DetectedServer.Type;

const DetectedServerEventBase = Schema.Struct({
  threadId: Schema.String.check(Schema.isNonEmpty()),
  createdAt: Schema.String,
});

const RegisteredEvent = Schema.Struct({
  ...DetectedServerEventBase.fields,
  type: Schema.Literal("registered"),
  server: DetectedServer,
});

const UpdatedEvent = Schema.Struct({
  ...DetectedServerEventBase.fields,
  type: Schema.Literal("updated"),
  serverId: Schema.String.check(Schema.isNonEmpty()),
  patch: Schema.Struct({
    status: Schema.optional(ServerStatus),
    framework: Schema.optional(ServerFramework),
    url: Schema.optional(Schema.String),
    port: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
    host: Schema.optional(Schema.String),
    pid: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
    terminalId: Schema.optional(Schema.String),
    liveAt: Schema.optional(Schema.DateTimeUtc),
    lastSeenAt: Schema.optional(Schema.DateTimeUtc),
    exitedAt: Schema.optional(Schema.DateTimeUtc),
    exitReason: Schema.optional(ExitReason),
  }),
});

const LogEvent = Schema.Struct({
  ...DetectedServerEventBase.fields,
  type: Schema.Literal("log"),
  serverId: Schema.String.check(Schema.isNonEmpty()),
  data: Schema.String,
});

const RemovedEvent = Schema.Struct({
  ...DetectedServerEventBase.fields,
  type: Schema.Literal("removed"),
  serverId: Schema.String.check(Schema.isNonEmpty()),
});

export const DetectedServerEvent = Schema.Union([
  RegisteredEvent,
  UpdatedEvent,
  LogEvent,
  RemovedEvent,
]);
export type DetectedServerEvent = typeof DetectedServerEvent.Type;

export const DetectedServerStopInput = Schema.Struct({
  serverId: Schema.String.check(Schema.isNonEmpty()),
});
export type DetectedServerStopInput = typeof DetectedServerStopInput.Type;

export const DetectedServerStopResult = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("stopped") }),
  Schema.Struct({
    kind: Schema.Literal("not-stoppable"),
    hint: Schema.Literal("interrupt-turn"),
  }),
]);
export type DetectedServerStopResult = typeof DetectedServerStopResult.Type;

export const DetectedServerOpenInBrowserInput = Schema.Struct({
  serverId: Schema.String.check(Schema.isNonEmpty()),
});
export type DetectedServerOpenInBrowserInput = typeof DetectedServerOpenInBrowserInput.Type;

export const SubscribeDetectedServerEventsInput = Schema.Struct({
  threadId: Schema.String.check(Schema.isNonEmpty()),
});
export type SubscribeDetectedServerEventsInput = typeof SubscribeDetectedServerEventsInput.Type;
