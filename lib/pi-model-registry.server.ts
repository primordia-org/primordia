// lib/pi-model-registry.server.ts
// SERVER-ONLY — the `server-only` import below causes Next.js to throw a build
// error if this module is ever imported into a client bundle.
import 'server-only';

// Uses the pi ModelRegistry (which reads from the filesystem) to
// build the model option list at request time rather than hard-coding it.
//
// Supported providers per harness:
//   claude-code  →  anthropic only (the Claude Code SDK is Anthropic-only)
//   pi           →  anthropic + openai (both are routed via the LLM gateway)

import { ModelRegistry, AuthStorage } from '@mariozechner/pi-coding-agent';
import type { ModelOption } from './agent-config';

// The providers that each harness can access through the exe.dev LLM gateway.
const HARNESS_PROVIDERS: Record<string, string[]> = {
  'claude-code': ['anthropic'],
  'pi': ['anthropic', 'openai'],
};

// User-facing provider labels used in the model description field.
const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};

/**
 * Returns the full model list for all harnesses, keyed by harness ID.
 * Models are read from the pi ModelRegistry at call time, so the list stays
 * current when the pi SDK is updated without any code changes.
 */
export function getModelOptionsByHarness(): Record<string, ModelOption[]> {
  // Set placeholder keys so the registry treats each provider as authenticated.
  const auth = AuthStorage.create();
  auth.setRuntimeApiKey('anthropic', 'gateway');
  auth.setRuntimeApiKey('openai', 'gateway');

  const registry = ModelRegistry.create(auth);
  // getAll() returns every built-in + custom model the registry knows about.
  const allModels = (registry as unknown as { getAll(): Array<{ id: string; name: string; provider: string; reasoning: boolean }> }).getAll();

  const result: Record<string, ModelOption[]> = {};

  for (const [harnessId, providers] of Object.entries(HARNESS_PROVIDERS)) {
    // Build enriched list retaining provider index for sorting, then strip it.
    const enriched = allModels
      .filter((m) => providers.includes(m.provider))
      .map((m) => ({
        id: m.id,
        label: m.name,
        description: `${PROVIDER_LABELS[m.provider] ?? m.provider}${m.reasoning ? ' · reasoning' : ''}`,
        _providerIndex: providers.indexOf(m.provider),
      }));

    // Stable sort: by provider order first (anthropic before openai), then alphabetically by label.
    enriched.sort((a, b) => {
      if (a._providerIndex !== b._providerIndex) return a._providerIndex - b._providerIndex;
      return a.label.localeCompare(b.label);
    });

    result[harnessId] = enriched.map(({ _providerIndex: _p, ...rest }) => rest);
  }

  return result;
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
export function resolveValidModel(
  harnessId: string,
  modelId: string | undefined,
  fallback: string,
): string {
  if (!modelId) return fallback;
  const byHarness = getModelOptionsByHarness();
  const models = byHarness[harnessId] ?? [];
  if (models.find((m) => m.id === modelId)) return modelId;
  return models[0]?.id ?? fallback;
}
