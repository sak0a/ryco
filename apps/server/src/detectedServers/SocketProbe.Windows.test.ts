import { describe, it, expect } from "vitest";
import { parseNetstatOutput } from "./Layers/SocketProbe.Windows.ts";

describe("SocketProbe.Windows.parseNetstatOutput", () => {
  it("parses LISTENING rows", () => {
    const output = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1234
  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       9876
  TCP    127.0.0.1:5173         127.0.0.1:54321        ESTABLISHED     9876
`;
    const rows = parseNetstatOutput(output);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ pid: 1234, port: 135, host: "0.0.0.0" });
    expect(rows[1]).toEqual({ pid: 9876, port: 5173, host: "127.0.0.1" });
  });

  it("handles IPv6 brackets", () => {
    const output = `
  TCP    [::]:8080              [::]:0                 LISTENING       4242
`;
    const rows = parseNetstatOutput(output);
    expect(rows).toEqual([{ pid: 4242, port: 8080, host: "::" }]);
  });

  it("returns empty for no LISTENING rows", () => {
    expect(parseNetstatOutput("")).toEqual([]);
  });
});
