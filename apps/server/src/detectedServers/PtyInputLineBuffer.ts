/**
 * Tracks user input written into a PTY and emits whole command lines on Enter.
 *
 * V1 limitations: cursor keys / arrow editing leak escape characters into the
 * buffer (the bracket and trailing letter survive the printable filter), and
 * we do not interpret &&, |, or ; chains — the whole line is treated as a
 * single command. ArgvHinter classifies that garbage as "unknown" and skips
 * registration, which is acceptable.
 */

const BACKSPACE_DEL = "\x7f";
const BACKSPACE_BS = "\b";
const CTRL_C = "\x03";
const CTRL_U = "\x15";

export class PtyInputLineBuffer {
  private buffer = "";
  private readonly onLine: (line: string) => void;

  constructor(onLine: (line: string) => void) {
    this.onLine = onLine;
  }

  write(chunk: string): void {
    for (const ch of chunk) {
      if (ch === "\r" || ch === "\n") {
        this.flush();
      } else if (ch === BACKSPACE_DEL || ch === BACKSPACE_BS) {
        this.buffer = this.buffer.slice(0, -1);
      } else if (ch === CTRL_C || ch === CTRL_U) {
        this.buffer = "";
      } else if (ch >= " ") {
        this.buffer += ch;
      } else if (ch === "\t") {
        this.buffer += " ";
      }
    }
  }

  private flush(): void {
    const line = this.buffer;
    this.buffer = "";
    if (line.trim().length === 0) return;
    this.onLine(line);
  }
}

export const tokenizeShellLine = (line: string): string[] =>
  line.trim().split(/\s+/).filter(Boolean);
