export interface LineBufferOptions {
  readonly maxLines: number;
}

/**
 * Rolling line buffer. Appends arbitrary chunks, splits on \n, retains an
 * incomplete trailing fragment for the next write, and trims from the head
 * when maxLines is exceeded.
 */
export class LineBuffer {
  private lines: string[] = [];
  private fragment = "";
  private readonly maxLines: number;

  constructor(options: LineBufferOptions) {
    this.maxLines = options.maxLines;
  }

  write(chunk: string): void {
    if (chunk.length === 0) return;
    const combined = this.fragment + chunk;
    const parts = combined.split("\n");
    this.fragment = parts.pop() ?? "";
    if (parts.length === 0) return;
    this.lines.push(...parts);
    if (this.lines.length > this.maxLines) {
      this.lines.splice(0, this.lines.length - this.maxLines);
    }
  }

  snapshot(): string[] {
    return this.lines.slice();
  }

  clear(): void {
    this.lines = [];
    this.fragment = "";
  }
}
