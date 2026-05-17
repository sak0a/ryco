import { randomUUID } from "node:crypto";
import { DateTime } from "effect";
import type {
  DetectedServer,
  DetectedServerEvent,
  ExitReason,
  ServerFramework,
  ServerSource,
  ServerStatus,
} from "@ryco/contracts";

const ALLOWED_TRANSITIONS: Record<ServerStatus, ReadonlyArray<ServerStatus>> = {
  predicted: ["candidate", "confirmed", "exited", "crashed"],
  candidate: ["confirmed", "live", "exited", "crashed"],
  confirmed: ["live", "exited", "crashed"],
  live: ["restarting", "exited", "crashed"],
  restarting: ["live", "exited", "crashed"],
  exited: [],
  crashed: [],
};

export interface RegistryPatch {
  framework?: ServerFramework;
  status?: ServerStatus;
  url?: string;
  port?: number;
  host?: string;
  pid?: number;
  terminalId?: string;
  argv?: ReadonlyArray<string>;
  cwd?: string;
  liveAt?: DateTime.Utc;
  lastSeenAt?: DateTime.Utc;
  exitedAt?: DateTime.Utc;
  exitReason?: ExitReason;
}

export interface RegistryRegisterInput {
  threadId: string;
  source: ServerSource;
  identityKey: string;
  patch: RegistryPatch;
}

type Listener = (e: DetectedServerEvent) => void;

const cloneServer = (s: DetectedServer): DetectedServer =>
  s.argv ? { ...s, argv: [...s.argv] } : { ...s };

export class Registry {
  private byThread = new Map<string, Map<string, DetectedServer>>();
  private idByIdentity = new Map<string, string>();
  private listeners = new Map<string, Set<Listener>>();

  subscribe(threadId: string, listener: Listener): () => void {
    const set = this.listeners.get(threadId) ?? new Set();
    set.add(listener);
    this.listeners.set(threadId, set);
    return () => {
      const cur = this.listeners.get(threadId);
      cur?.delete(listener);
    };
  }

  getCurrent(threadId: string): DetectedServer[] {
    const m = this.byThread.get(threadId);
    return m ? [...m.values()].map(cloneServer) : [];
  }

  findById(serverId: string): DetectedServer | undefined {
    for (const m of this.byThread.values()) {
      const s = m.get(serverId);
      if (s) return cloneServer(s);
    }
    return undefined;
  }

  registerOrUpdate(input: RegistryRegisterInput): DetectedServer {
    const existingId = this.idByIdentity.get(input.identityKey);
    if (existingId) return this.updateExisting(input, existingId);
    return this.registerNew(input);
  }

  publishLog(serverId: string, data: string): void {
    const threadId = this.findThreadOf(serverId);
    if (!threadId) return;
    this.publish(threadId, {
      type: "log",
      threadId,
      serverId,
      data,
      createdAt: new Date().toISOString(),
    });
  }

  remove(serverId: string): void {
    const threadId = this.findThreadOf(serverId);
    if (!threadId) return;
    const m = this.byThread.get(threadId);
    const server = m?.get(serverId);
    if (!server || !m) return;
    m.delete(serverId);
    this.idByIdentity.forEach((id, key) => {
      if (id === serverId) this.idByIdentity.delete(key);
    });
    this.publish(threadId, {
      type: "removed",
      threadId,
      serverId,
      createdAt: new Date().toISOString(),
    });
  }

  private registerNew(input: RegistryRegisterInput): DetectedServer {
    const id = randomUUID();
    const now = DateTime.fromDateUnsafe(new Date());
    const status = input.patch.status ?? "predicted";
    const server: DetectedServer = {
      id,
      threadId: input.threadId,
      source: input.source,
      framework: input.patch.framework ?? "unknown",
      status,
      url: input.patch.url,
      port: input.patch.port,
      host: input.patch.host,
      pid: input.patch.pid,
      terminalId: input.patch.terminalId,
      argv: input.patch.argv,
      cwd: input.patch.cwd,
      startedAt: now,
      liveAt: input.patch.liveAt,
      lastSeenAt: now,
      exitedAt: input.patch.exitedAt,
      exitReason: input.patch.exitReason,
    };
    const m = this.byThread.get(input.threadId) ?? new Map();
    m.set(id, server);
    this.byThread.set(input.threadId, m);
    this.idByIdentity.set(input.identityKey, id);
    this.publish(input.threadId, {
      type: "registered",
      threadId: input.threadId,
      server,
      createdAt: new Date().toISOString(),
    });
    return server;
  }

  private updateExisting(input: RegistryRegisterInput, serverId: string): DetectedServer {
    const m = this.byThread.get(input.threadId);
    const cur = m?.get(serverId);
    if (!cur || !m) throw new Error(`Registry inconsistency: missing server ${serverId}`);

    if (input.patch.status && input.patch.status !== cur.status) {
      const legal = ALLOWED_TRANSITIONS[cur.status];
      if (!legal.includes(input.patch.status)) {
        throw new Error(`illegal transition ${cur.status} → ${input.patch.status} for ${serverId}`);
      }
    }

    const next: DetectedServer = {
      ...cur,
      ...input.patch,
      lastSeenAt: input.patch.lastSeenAt ?? DateTime.fromDateUnsafe(new Date()),
    };
    m.set(serverId, next);
    this.publish(input.threadId, {
      type: "updated",
      threadId: input.threadId,
      serverId,
      patch: input.patch,
      createdAt: new Date().toISOString(),
    });
    return next;
  }

  private findThreadOf(serverId: string): string | undefined {
    for (const [threadId, m] of this.byThread) {
      if (m.has(serverId)) return threadId;
    }
    return undefined;
  }

  private publish(threadId: string, event: DetectedServerEvent): void {
    const set = this.listeners.get(threadId);
    if (!set) return;
    for (const l of set) {
      try {
        l(event);
      } catch (err) {
        console.error("DetectedServerRegistry listener threw", { threadId, err });
      }
    }
  }
}
