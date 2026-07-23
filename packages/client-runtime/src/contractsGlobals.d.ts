/**
 * This package excludes the DOM lib so browser globals cannot creep into the
 * platform-neutral runtime. The `@ryco/contracts` sources compiled into this
 * program and the runtime's own transport modules reference a small set of
 * cross-platform web-interop globals (File/TextEncoder/TextDecoder for
 * contracts; URL, timers, console, and structural WebSocket/CloseEvent shapes
 * for the transport); declare them minimally here instead of readmitting the
 * entire DOM lib. The WebSocket interface deliberately has no constructor —
 * sockets can only enter through the platform Socket contract. These shims
 * are visible only to this package's typecheck program.
 */

interface File extends Blob {
  readonly lastModified: number;
  readonly name: string;
}

declare class Blob {
  readonly size: number;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
  bytes(): Promise<Uint8Array>;
  slice(start?: number, end?: number, contentType?: string): Blob;
  text(): Promise<string>;
}

declare class TextEncoder {
  readonly encoding: string;
  encode(input?: string): Uint8Array;
}

declare class TextDecoder {
  readonly encoding: string;
  constructor(label?: string, options?: { readonly fatal?: boolean; readonly ignoreBOM?: boolean });
  decode(input?: ArrayBuffer | ArrayBufferView, options?: { readonly stream?: boolean }): string;
}

declare class URL {
  constructor(url: string, base?: string | URL);
  host: string;
  hostname: string;
  pathname: string;
  protocol: string;
  origin: string;
  search: string;
  hash: string;
  searchParams: {
    set(name: string, value: string): void;
  };
  toString(): string;
}

interface CloseEvent {
  readonly code: number;
  readonly reason: string;
}

interface WebSocket {
  addEventListener(type: string, listener: (event: CloseEvent) => void, options?: unknown): void;
}

declare function setTimeout(
  callback: (...args: ReadonlyArray<unknown>) => void,
  delay?: number,
): number;
declare function clearTimeout(timeoutId: number): void;

declare const console: {
  warn(...data: ReadonlyArray<unknown>): void;
  error(...data: ReadonlyArray<unknown>): void;
};

/**
 * Cross-platform runtimes provide the standard base64 primitives (or a
 * compatible polyfill). Keeping these narrow declarations avoids importing
 * the DOM library into the neutral runtime.
 */
declare function atob(value: string): string;
declare function btoa(value: string): string;

interface AbortSignal {
  readonly aborted: boolean;
}

declare class AbortController {
  readonly signal: AbortSignal;
  abort(): void;
}
