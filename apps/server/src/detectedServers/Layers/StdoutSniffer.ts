import type { ServerFramework } from "@ryco/contracts";

export interface UrlCandidate {
  url: string;
  port: number;
  host: string;
  framework: ServerFramework;
}

const ANSI_REGEX = /\x1b\[[0-9;?]*[a-zA-Z]/g;
const URL_REGEX_GENERIC =
  /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::(\d+))?(?:\/\S*)?/i;

interface FrameworkPattern {
  framework: ServerFramework;
  lineHint: RegExp;
}

const FRAMEWORK_PATTERNS: ReadonlyArray<FrameworkPattern> = [
  { framework: "vite", lineHint: /\bVITE\b/i },
  { framework: "next", lineHint: /Next\.js|^\s*-?\s*Local:\s+http.*localhost:3000/i },
  { framework: "nuxt", lineHint: /Nuxt\s+\d/i },
  { framework: "astro", lineHint: /astro\s+v\d/i },
  { framework: "remix", lineHint: /remix dev|serving HTTP on/i },
  { framework: "wrangler", lineHint: /wrangler|\[mf:inf\] Ready on/i },
  { framework: "webpack", lineHint: /\[webpack-dev-server\] (?:Loopback|Project is running)/i },
];

const PORT_ONLY_REGEX = /\b(?:listening|server (?:listening|running))\b[^\d]*?\b(\d{2,5})\b/i;

export class StdoutSniffer {
  private fragment = "";
  private listeners = new Set<(c: UrlCandidate) => void>();
  private contextLines: { framework: ServerFramework | null; lines: string[] } = {
    framework: null,
    lines: [],
  };

  onCandidate(cb: (c: UrlCandidate) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  feed(chunk: string): void {
    if (chunk.length === 0) return;
    const combined = this.fragment + chunk;
    const parts = combined.split("\n");
    this.fragment = parts.pop() ?? "";
    for (const raw of parts) this.consumeLine(raw);
  }

  private consumeLine(raw: string): void {
    const line = raw.replace(ANSI_REGEX, "").replace(/\s+/g, " ").trim();
    if (!line) return;

    // Detect framework hint from any recent line; carry it forward
    for (const pattern of FRAMEWORK_PATTERNS) {
      if (pattern.lineHint.test(line)) {
        this.contextLines.framework = pattern.framework;
        break;
      }
    }

    // Try to extract URL on this line
    const urlMatch = line.match(URL_REGEX_GENERIC);
    if (urlMatch) {
      const url = urlMatch[0];
      const host = this.extractHost(url);
      const port = this.extractPort(url);
      if (port !== null) {
        this.emit({
          url,
          port,
          host,
          framework: this.contextLines.framework ?? "unknown",
        });
        return;
      }
    }

    // Fallback: port-only Express-style line
    const portMatch = line.match(PORT_ONLY_REGEX);
    if (portMatch) {
      const port = Number.parseInt(portMatch[1]!, 10);
      this.emit({
        url: `http://localhost:${port}`,
        port,
        host: "localhost",
        framework: this.contextLines.framework ?? "express",
      });
    }
  }

  private extractHost(url: string): string {
    const m = url.match(/https?:\/\/(\[[^\]]+\]|[^/:]+)/i);
    return m?.[1] ?? "localhost";
  }

  private extractPort(url: string): number | null {
    const m = url.match(/:(\d+)(?:\/|$)/);
    if (m) return Number.parseInt(m[1]!, 10);
    if (url.startsWith("https://")) return 443;
    if (url.startsWith("http://")) return 80;
    return null;
  }

  private emit(c: UrlCandidate): void {
    for (const l of this.listeners) l(c);
  }
}
