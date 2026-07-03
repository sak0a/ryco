export const BROWSER_CONSOLE_BUFFER_LIMIT = 200;
export const BROWSER_NETWORK_BUFFER_LIMIT = 200;
export const BROWSER_DOM_NODE_LIMIT = 400;
export const BROWSER_MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

export const BROWSER_DOM_SNAPSHOT_SCRIPT = `(() => {
  const MAX_NODES = ${BROWSER_DOM_NODE_LIMIT};
  let nodeCount = 0;
  let truncated = false;
  let nextRef = 1;

  const isVisible = (element) => {
    if (!(element instanceof Element)) return false;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  };

  const implicitRole = (element) => {
    const tag = element.tagName.toLowerCase();
    switch (tag) {
      case "a":
        return element.hasAttribute("href") ? "link" : "generic";
      case "button":
        return "button";
      case "input": {
        const type = (element.getAttribute("type") || "text").toLowerCase();
        if (type === "button" || type === "submit" || type === "reset") return "button";
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        return "textbox";
      }
      case "select":
        return "combobox";
      case "textarea":
        return "textbox";
      case "img":
        return "img";
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        return "heading";
      case "ul":
      case "ol":
        return "list";
      case "li":
        return "listitem";
      case "nav":
        return "navigation";
      case "main":
        return "main";
      case "form":
        return "form";
      default:
        return tag;
    }
  };

  const nodeName = (element) => {
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim().slice(0, 200);
    const title = element.getAttribute("title");
    if (title && title.trim()) return title.trim().slice(0, 200);
    const alt = element.getAttribute("alt");
    if (alt && alt.trim()) return alt.trim().slice(0, 200);
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const value = element.value?.trim();
      if (value) return value.slice(0, 200);
      const placeholder = element.getAttribute("placeholder");
      if (placeholder && placeholder.trim()) return placeholder.trim().slice(0, 200);
    }
    const text = (element.innerText || element.textContent || "").trim();
    if (text) return text.slice(0, 200);
    return undefined;
  };

  const buildNode = (element) => {
    if (!(element instanceof Element) || !isVisible(element)) return null;
    if (nodeCount >= MAX_NODES) {
      truncated = true;
      return null;
    }
    nodeCount += 1;
    const ref = "e" + nextRef++;
    const rect = element.getBoundingClientRect();
    const node = {
      ref,
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role") || implicitRole(element),
      name: nodeName(element),
      bounds: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      children: [],
    };
    for (const child of element.children) {
      if (nodeCount >= MAX_NODES) {
        truncated = true;
        break;
      }
      const childNode = buildNode(child);
      if (childNode) node.children.push(childNode);
    }
    if (node.children.length === 0) delete node.children;
    return node;
  };

  const roots = [];
  const body = document.body;
  if (body) {
    for (const child of body.children) {
      const built = buildNode(child);
      if (built) roots.push(built);
    }
  }

  return {
    url: location.href,
    title: document.title || "",
    viewport: {
      width: Math.max(1, Math.round(window.innerWidth || 0)),
      height: Math.max(1, Math.round(window.innerHeight || 0)),
    },
    tree: roots,
    truncated,
    nodeCount,
  };
})()`;

export type BrowserConsoleLevel = "debug" | "info" | "warning" | "error" | "verbose";

export interface BufferedConsoleEntry {
  readonly level: BrowserConsoleLevel;
  readonly message: string;
  readonly timestamp: string;
  readonly source?: string;
  readonly line?: number;
}

export interface BufferedNetworkEntry {
  readonly requestId: string;
  readonly url: string;
  readonly method: string;
  readonly status?: number;
  readonly resourceType?: string;
  readonly startedAt: string;
  readonly completedAt?: string;
}

export function mapConsoleLevel(level: number | string): BrowserConsoleLevel {
  if (typeof level === "string") {
    const normalized = level.toLowerCase();
    if (
      normalized === "debug" ||
      normalized === "info" ||
      normalized === "warning" ||
      normalized === "error" ||
      normalized === "verbose"
    ) {
      return normalized;
    }
  }
  switch (level) {
    case 0:
      return "debug";
    case 1:
      return "info";
    case 2:
      return "warning";
    case 3:
      return "error";
    default:
      return "verbose";
  }
}

export function parseConsoleMessage(args: ReadonlyArray<unknown>): BufferedConsoleEntry | null {
  const timestamp = new Date().toISOString();
  if (args.length === 1 && typeof args[0] === "object" && args[0] !== null) {
    const event = args[0] as {
      readonly level?: number | string;
      readonly message?: string;
      readonly lineNumber?: number;
      readonly sourceId?: string;
    };
    if (typeof event.message !== "string") return null;
    return {
      level: mapConsoleLevel(event.level ?? 1),
      message: event.message.slice(0, 16_384),
      timestamp,
      ...(typeof event.sourceId === "string" ? { source: event.sourceId.slice(0, 4_096) } : {}),
      ...(typeof event.lineNumber === "number" ? { line: event.lineNumber } : {}),
    };
  }
  if (args.length >= 3 && typeof args[2] === "string") {
    const level = typeof args[1] === "number" ? args[1] : 1;
    const message = args[2];
    const line = typeof args[3] === "number" ? args[3] : undefined;
    const source = typeof args[4] === "string" ? args[4] : undefined;
    return {
      level: mapConsoleLevel(level),
      message: message.slice(0, 16_384),
      timestamp,
      ...(source ? { source: source.slice(0, 4_096) } : {}),
      ...(line !== undefined ? { line } : {}),
    };
  }
  return null;
}

export function pushBounded<T>(buffer: T[], entry: T, limit: number): void {
  buffer.push(entry);
  if (buffer.length > limit) {
    buffer.splice(0, buffer.length - limit);
  }
}
