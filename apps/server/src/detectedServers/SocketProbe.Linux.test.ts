import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { parseProcTcpRows, parseProcTcp6Rows } from "./Layers/SocketProbe.Linux.ts";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "__fixtures__/proc", `${name}.txt`), "utf8");

describe("SocketProbe.Linux parsers", () => {
  it("parses LISTEN sockets from /proc/<pid>/net/tcp", () => {
    const rows = parseProcTcpRows(fixture("tcp"));
    const listening = rows.filter((r) => r.state === "LISTEN");
    expect(listening).toHaveLength(2);
    expect(listening[0]!.port).toBe(5201);
    expect(listening[0]!.host).toBe("127.0.0.1");
    expect(listening[1]!.port).toBe(5301);
    expect(listening[1]!.host).toBe("0.0.0.0");
  });

  it("excludes non-LISTEN rows", () => {
    const rows = parseProcTcpRows(fixture("tcp"));
    const established = rows.find((r) => r.state !== "LISTEN");
    expect(established?.port).toBe(5202);
  });

  it("parses LISTEN sockets from /proc/<pid>/net/tcp6", () => {
    const rows = parseProcTcp6Rows(fixture("tcp6"));
    const listening = rows.filter((r) => r.state === "LISTEN");
    expect(listening).toHaveLength(1);
    expect(listening[0]!.port).toBe(8080);
  });
});
