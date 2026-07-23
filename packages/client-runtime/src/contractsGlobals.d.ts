/**
 * This package excludes the DOM lib so browser globals cannot creep into the
 * platform-neutral runtime. The `@ryco/contracts` sources compiled into this
 * program reference three cross-platform web-interop globals; declare them
 * minimally here instead of readmitting the entire DOM lib. These shims are
 * visible only to this package's typecheck program.
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
