// lib/pi-model-registry.server.ts
// SERVER-ONLY — the `server-only` import below causes Next.js to throw a build
// error if this module is ever imported into a client bundle.
import 'server-only';

import type { ModelOption } from './agent-config';
import _modelOptions from './models.generated.json';

/**
 * Returns the generated model list for all harnesses, keyed by harness ID.
 * Regenerate lib/models.generated.json with `bun run regenerate:model-registry`
 * after updating the pi SDK.
 */
export function getModelOptionsByHarness(): Record<string, ModelOption[]> {
  return _modelOptions as Record<string, ModelOption[]>;
}

/**
 * Look up the human-readable label for a model ID within a given harness.
 * Falls back to the raw model ID if not found.
 */
export function getModelLabel(harnessId: string, modelId: string): string {
  const byHarness = getModelOptionsByHarness();
  return byHarness[harnessId]?.find((m) => m.id === modelId)?.label ?? modelId;
}

/**
 * Validate a saved model preference: returns the model ID if it still exists
 * in the registry for the given harness, otherwise returns the first available
 * model ID for that harness (or the provided fallback).
 */
export function validateModelPreference(
  harnessId: string,
  modelId: string | undefined,
  fallbackModelId: string,
): string {
  const byHarness = getModelOptionsByHarness();
  const models = byHarness[harnessId] ?? [];
  if (modelId && models.some((m) => m.id === modelId)) return modelId;
  return models[0]?.id ?? fallbackModelId;
}
