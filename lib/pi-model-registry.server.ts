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

/**
 * Format a cost object into a concise human-readable pricing string.
 * Costs in the registry are USD per million tokens.
 * Returns null when no cost data is available.
 */
function formatPricing(
  cost: { input: number; output: number } | undefined,
): { full: string; input: string } | null {
  if (!cost) return null;
  const { input, output } = cost;
  if (input === 0 && output === 0) return null;

  function fmt(n: number): string {
    if (n === 0) return '$0';
    // Show up to 2 significant figures, strip trailing zeros
    if (n >= 10) return `$${Math.round(n)}`;
    if (n >= 1) return `$${parseFloat(n.toPrecision(2))}`;
    // sub-dollar: show cents, e.g. 0.08 → "8¢"
    const cents = n * 100;
    if (cents >= 1) return `${parseFloat(cents.toPrecision(2))}¢`;
    return `$${parseFloat(n.toPrecision(2))}`;
  }

  return { full: `${fmt(input)}→${fmt(output)}/M`, input: `${fmt(input)}/M` };
}

// User-facing provider labels used in the model description field.
const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};

type RawModel = {
  id: string;
  name: string;
  provider: string;
  reasoning: boolean;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

/**
 * Reduce a flat list of models down to the most recent, non-redundant entries.
 *
 * Four rules applied in order:
 *
 * R1 — Drop "(latest)" floating aliases and dated snapshots "(YYYY…"
 *       e.g. "Claude Haiku 4.5 (latest)", "GPT-4o (2024-11-20)"
 *
 * R2 — Drop specialised / old-brand variants by keyword:
 *       Chat, research, Turbo, Spark, Max
 *       e.g. "GPT-5 Chat Latest", "GPT-4 Turbo", "o3-deep-research"
 *
 * R3 — Drop oversized or over-specialised tier qualifiers at the end of the name:
 *       nano  ·  pro  ·  -pro   (mini is intentionally kept)
 *       e.g. "GPT-5.4 nano", "GPT-5.4 Pro", "o3-pro"
 *
 * R4 — Per (provider, family) group keep only the highest-versioned entry.
 *       Family key = name with the version number (and any "v2"-style tokens)
 *       stripped out, normalised to lowercase.  A trailing letter glued to a
 *       digit (e.g. the "o" in "GPT-4o") is absorbed into the version token so
 *       "GPT-4o" and "GPT-4.1" map to the same family and the latter wins.
 *       e.g. GPT-4 / GPT-4.1 / GPT-4o / GPT-5 / … / GPT-5.4 → keep GPT-5.4
 *            o1 / o3 → keep o3
 *            o3-mini / o4-mini → keep o4-mini
 */
function filterToLatestVersions(models: RawModel[]): RawModel[] {
  // R1
  let out = models.filter(
    (m) => !m.name.includes('(latest)') && !/\(\d{4}/.test(m.name),
  );

  // R2
  out = out.filter((m) => !/\b(Chat|research|Turbo|Spark|Max)\b/i.test(m.name));

  // R3
  out = out.filter((m) => !/(\bnano\b|\bpro\b|-pro)$/i.test(m.name));

  // R4 — build family key and keep highest version per group
  function familyOf(name: string): { key: string; version: number } {
    let s = name.toLowerCase();
    // Strip standalone v<N> variant tokens (e.g. "v2", "v3")
    s = s.replace(/\bv\d+\b/g, ' ');
    // Extract the first version token: digits with optional decimal point,
    // optionally followed by a single trailing letter (e.g. "4o" → extracts "4").
    const m = s.match(/(\d+(?:\.\d+)?)[a-z]?/);
    const version = m ? parseFloat(m[1]) : -1;
    const key = s
      .replace(/\d+(?:\.\d+)?[a-z]?/, '')  // remove version token
      .replace(/[-\s]+/g, ' ')              // normalise separators
      .trim();
    return { key, version };
  }

  const groups = new Map<string, { model: RawModel; version: number }>();
  for (const model of out) {
    const { key, version } = familyOf(model.name);
    const gk = `${model.provider}::${key}`;
    const existing = groups.get(gk);
    if (!existing || version > existing.version) {
      groups.set(gk, { model, version });
    }
  }

  return Array.from(groups.values()).map((g) => g.model);
}

/**
 * Returns the filtered model list for all harnesses, keyed by harness ID.
 * Models are read from the pi ModelRegistry at call time, so the list stays
 * current when the pi SDK is updated without any code changes.
 */
export function getModelOptionsByHarness(): Record<string, ModelOption[]> {
  // Set placeholder keys so the registry treats each provider as authenticated.
  const auth = AuthStorage.create();
  auth.setRuntimeApiKey('anthropic', 'gateway');
  auth.setRuntimeApiKey('openai', 'gateway');

  const registry = ModelRegistry.create(auth);
  const allModels = (registry as unknown as { getAll(): RawModel[] }).getAll();

  const result: Record<string, ModelOption[]> = {};

  for (const [harnessId, providers] of Object.entries(HARNESS_PROVIDERS)) {
    const providerModels = allModels.filter((m) => providers.includes(m.provider));
    const filtered = filterToLatestVersions(providerModels);

    // Sort: provider order first (anthropic before openai), then alphabetically.
    filtered.sort((a, b) => {
      const pi = providers.indexOf(a.provider);
      const pj = providers.indexOf(b.provider);
      if (pi !== pj) return pi - pj;
      return a.name.localeCompare(b.name);
    });

    result[harnessId] = filtered.map((m) => {
      const providerLabel = PROVIDER_LABELS[m.provider] ?? m.provider;
      const reasoningLabel = m.reasoning ? ' · reasoning' : '';
      const pricing = formatPricing(m.cost);
      const description = pricing
        ? `${providerLabel}${reasoningLabel} · ${pricing.full}`
        : `${providerLabel}${reasoningLabel}`;
      return {
        id: m.id,
        label: m.name,
        description,
        pricingLabel: pricing?.full,
        inputPriceLabel: pricing?.input,
      };
    });
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
