export type StdIoWrite = NodeJS.WriteStream["write"];

type WriteCallback = (error?: Error | null) => void;

interface StdIoStreamTarget {
  readonly destroyed: boolean;
  readonly writable: boolean;
  on(event: "error", listener: (error: Error) => void): unknown;
  off(event: "error", listener: (error: Error) => void): unknown;
}

interface ResilientStdIoWriter {
  readonly write: StdIoWrite;
  readonly dispose: () => void;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

export function isBrokenPipeError(error: unknown): boolean {
  return errorCode(error) === "EPIPE";
}

function writeCallback(
  encodingOrCallback: BufferEncoding | WriteCallback | undefined,
  callback: WriteCallback | undefined,
): WriteCallback | undefined {
  return typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
}

function completeSkippedWrite(callback: WriteCallback | undefined): void {
  if (callback === undefined) return;
  queueMicrotask(() => callback(null));
}

/**
 * Keeps packaged logging useful after the process that launched Electron closes
 * its stdout/stderr pipe. Node reports that normal lifecycle as an asynchronous
 * `EPIPE` event; without a listener it becomes an uncaught main-process error.
 */
export function createResilientStdIoWriter(input: {
  readonly stream: StdIoStreamTarget;
  readonly originalWrite: StdIoWrite;
  readonly capture: (chunk: string | Uint8Array, encoding: BufferEncoding | undefined) => void;
  readonly onUnavailable: (error: Error) => void;
}): ResilientStdIoWriter {
  let unavailable = input.stream.destroyed || !input.stream.writable;

  const markUnavailable = (error: Error): void => {
    if (unavailable) return;
    unavailable = true;
    input.onUnavailable(error);
  };

  input.stream.on("error", markUnavailable);

  const write = ((
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | WriteCallback,
    callback?: WriteCallback,
  ): boolean => {
    const encoding = typeof encodingOrCallback === "string" ? encodingOrCallback : undefined;
    const completion = writeCallback(encodingOrCallback, callback);
    input.capture(chunk, encoding);

    if (unavailable || input.stream.destroyed || !input.stream.writable) {
      unavailable = true;
      completeSkippedWrite(completion);
      return true;
    }

    try {
      if (typeof encodingOrCallback === "function") {
        return input.originalWrite(chunk, encodingOrCallback);
      }
      if (callback !== undefined) {
        return input.originalWrite(chunk, encoding, callback);
      }
      if (encoding !== undefined) {
        return input.originalWrite(chunk, encoding);
      }
      return input.originalWrite(chunk);
    } catch (error) {
      if (!isBrokenPipeError(error)) throw error;
      markUnavailable(error instanceof Error ? error : new Error("stdio pipe closed"));
      completeSkippedWrite(completion);
      return true;
    }
  }) as StdIoWrite;

  return {
    write,
    dispose: () => input.stream.off("error", markUnavailable),
  };
}
