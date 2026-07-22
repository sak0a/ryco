/**
 * AntigravityAdapter — shape type for the Antigravity CLI provider adapter.
 *
 * Antigravity does not expose ACP natively. Ryco drives the `agy` print-mode
 * CLI directly and projects the resulting SQLite conversation output into
 * canonical provider runtime events.
 *
 * @module AntigravityAdapter
 */
import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface AntigravityAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {}
