type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface BoundedJsonResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly value: unknown;
}

export async function fetchBoundedJson(
  fetchImplementation: FetchLike,
  input: string | URL | Request,
  init: RequestInit,
  fail: () => never,
  options: { readonly timeoutMs?: number; readonly maxResponseBytes?: number } = {},
): Promise<BoundedJsonResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  const maximum = options.maxResponseBytes ?? 16 * 1024;
  let response: Response;
  try {
    response = await fetchImplementation(input, { ...init, signal: controller.signal });
    const declared = response.headers.get("content-length");
    if (declared !== null) {
      const length = Number(declared);
      if (!Number.isSafeInteger(length) || length < 0 || length > maximum) {
        await response.body?.cancel().catch(() => undefined);
        return fail();
      }
    }
    if (response.body === null) return fail();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        total += result.value.byteLength;
        if (total > maximum) {
          await reader.cancel().catch(() => undefined);
          return fail();
        }
        chunks.push(result.value);
      }
    } finally {
      reader.releaseLock();
    }
    let value: unknown;
    try {
      value = JSON.parse(
        Buffer.concat(
          chunks.map((chunk) => Buffer.from(chunk)),
          total,
        ).toString("utf8"),
      ) as unknown;
    } catch {
      return fail();
    }
    return { ok: response.ok, status: response.status, value };
  } catch {
    return fail();
  } finally {
    clearTimeout(timeout);
  }
}
