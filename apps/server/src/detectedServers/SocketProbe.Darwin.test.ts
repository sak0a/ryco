import { describe, it, expect } from "vitest";
import { parseLsofOutput } from "./Layers/SocketProbe.Darwin.ts";

describe("SocketProbe.Darwin.parseLsofOutput", () => {
  it("parses lsof TCP LISTEN rows", () => {
    const output = `COMMAND   PID USER   FD  TYPE             DEVICE SIZE/OFF NODE NAME
node    12345 alice   23u  IPv4  0xabc12345abc1234      0t0  TCP 127.0.0.1:5173 (LISTEN)
node    12345 alice   24u  IPv6  0xabc12345abc1235      0t0  TCP [::1]:5173 (LISTEN)
node    99999 alice   25u  IPv4  0xabc12345abc1236      0t0  TCP *:3000 (LISTEN)
`;
    const rows = parseLsofOutput(output);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ pid: 12345, port: 5173, host: "127.0.0.1" });
    expect(rows[1]).toEqual({ pid: 12345, port: 5173, host: "::1" });
    expect(rows[2]).toEqual({ pid: 99999, port: 3000, host: "0.0.0.0" });
  });

  it("returns empty array for empty output", () => {
    expect(parseLsofOutput("")).toEqual([]);
  });

  it("ignores rows not in LISTEN state", () => {
    const output = `COMMAND   PID USER   FD  TYPE             DEVICE SIZE/OFF NODE NAME
node    12345 alice   23u  IPv4  0xabc12345abc1234      0t0  TCP 127.0.0.1:5173->127.0.0.1:99 (ESTABLISHED)
`;
    expect(parseLsofOutput(output)).toEqual([]);
  });
});
