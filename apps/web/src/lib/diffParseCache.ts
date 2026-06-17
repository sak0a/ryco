import { LRUCache } from "./lruCache";

/**
 * Small LRU cache for parsed diff payloads.
 *
 * Diff parsing (`parsePatchFiles` + sorting) is the most expensive synchronous
 * step before the worker pool highlights a diff. Re-opening a turn/file that
 * was already viewed should not re-run that work, and rapid switching between
 * turns should not keep re-parsing identical content. This cache is keyed by
 * the tuple that uniquely identifies a parsed diff payload:
 * `(turnId, filePath, blobSha)`.
 *
 * Eviction (least-recently-used) is delegated to the shared {@link LRUCache};
 * this layer only adds composite-key building and an entry-count bound. Do not
 * store `null`/`undefined` values — those are reserved to signal a cache miss.
 */

export interface DiffParseCacheKey {
  /** Turn (or conversation scope) the parsed diff belongs to. */
  readonly turnId: string;
  /**
   * File scope for the parsed payload. Use a concrete path for per-file
   * payloads, or a stable sentinel (e.g. `"*"`) for whole-turn payloads.
   */
  readonly filePath: string;
  /**
   * Content identity for the payload — a blob sha when available, otherwise a
   * content hash. Distinct content under the same `(turnId, filePath)` must
   * produce a distinct `blobSha`.
   */
  readonly blobSha: string;
}

/** Default capacity for diff parse caches (~50 parsed payloads). */
export const DEFAULT_DIFF_PARSE_CACHE_MAX_ENTRIES = 50;

const KEY_SEPARATOR = "\u0000";

// This cache bounds purely by entry count, so the shared cache's memory budget
// is disabled and every entry contributes a uniform weight.
const UNBOUNDED_MEMORY_BYTES = Number.POSITIVE_INFINITY;
const UNIT_ENTRY_WEIGHT = 1;

/**
 * Builds a collision-resistant string key from a {@link DiffParseCacheKey}.
 * Components are joined by a NUL separator that does not appear in turn ids,
 * file paths, or content hashes.
 */
export function buildDiffParseCacheKey(key: DiffParseCacheKey): string {
  return `${key.turnId}${KEY_SEPARATOR}${key.filePath}${KEY_SEPARATOR}${key.blobSha}`;
}

export class DiffParseCache<V> {
  readonly #cache: LRUCache<V>;
  readonly #maxEntries: number;

  constructor(maxEntries: number = DEFAULT_DIFF_PARSE_CACHE_MAX_ENTRIES) {
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
      throw new RangeError(
        `DiffParseCache maxEntries must be a positive integer, received ${String(maxEntries)}`,
      );
    }
    this.#maxEntries = maxEntries;
    this.#cache = new LRUCache<V>(maxEntries, UNBOUNDED_MEMORY_BYTES);
  }

  get maxEntries(): number {
    return this.#maxEntries;
  }

  /** Returns the cached value (if any) and marks it most-recently-used. */
  get(key: DiffParseCacheKey): V | undefined {
    return this.#cache.get(buildDiffParseCacheKey(key)) ?? undefined;
  }

  /** Stores a value, marking it most-recently-used and evicting LRU overflow. */
  set(key: DiffParseCacheKey, value: V): void {
    this.#cache.set(buildDiffParseCacheKey(key), value, UNIT_ENTRY_WEIGHT);
  }

  /** Returns the cached value, computing and storing it on a cache miss. */
  getOrCompute(key: DiffParseCacheKey, compute: () => V): V {
    const existing = this.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const value = compute();
    this.set(key, value);
    return value;
  }

  clear(): void {
    this.#cache.clear();
  }
}
