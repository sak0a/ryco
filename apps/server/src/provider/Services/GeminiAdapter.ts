/**
 * GeminiAdapter - shape type for the Gemini provider adapter.
 *
 * The driver model bundles one adapter per configured provider instance, so
 * this module only retains the shape interface as a naming anchor.
 *
 * @module GeminiAdapter
 */
import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface GeminiAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {}
