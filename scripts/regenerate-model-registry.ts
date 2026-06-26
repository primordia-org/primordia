#!/usr/bin/env bun
// scripts/regenerate-model-registry.ts
//
// Reads the current model list from the pi ModelRegistry and writes it to
// lib/models.generated.json.  Run whenever the pi SDK is updated and new
// models need to be reflected in the UI:
//
//   bun run regenerate:model-registry

import { writeFileSync } from 'fs';
import { join } from 'path';
import { ModelRegistry, AuthStorage } from '@earendil-works/pi-coding-agent';
import type { ModelOption } from '@/lib/agent-config';
import { GEMINI_3_5_FLASH_MODEL_ID, OPENROUTER_GEMINI_3_5_FLASH_MODEL_ID } from '@/lib/pi-custom-models';

const PRIMORDIA_DIRECT_GOOGLE_MODEL_OPTIONS: ModelOption[] = [
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    description: 'Google · reasoning · 30¢→$2.5/M',
    pricingLabel: '30¢→$2.5/M',
    inputPriceLabel: '30¢/M',
  },
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    description: 'Google · reasoning · $1.25→$10/M',
    pricingLabel: '$1.25→$10/M',
    inputPriceLabel: '$1.25/M',
  },
  {
    id: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro Preview',
    description: 'Google · reasoning · $2→$12/M',
    pricingLabel: '$2→$12/M',
    inputPriceLabel: '$2/M',
  },
  {
    id: GEMINI_3_5_FLASH_MODEL_ID,
    label: 'Gemini 3.5 Flash',
    description: 'Google · reasoning · 50¢→$3/M',
    pricingLabel: '50¢→$3/M',
    inputPriceLabel: '50¢/M',
  },
  {
    id: 'gemini-2.0-flash',
    label: 'Gemini 2.0 Flash',
    description: 'Google · 10¢→40¢/M',
    pricingLabel: '10¢→40¢/M',
    inputPriceLabel: '10¢/M',
  },
];

const PRIMORDIA_OPENROUTER_MODEL_OPTIONS: ModelOption[] = [
  {
    id: OPENROUTER_GEMINI_3_5_FLASH_MODEL_ID,
    label: 'Google: Gemini 3.5 Flash',
    description: 'OpenRouter · reasoning · 50¢→$3/M',
    pricingLabel: '50¢→$3/M',
    inputPriceLabel: '50¢/M',
  },
];

// ── Providers per harness (mirrors HARNESS_PROVIDERS in pi-model-registry.server.ts) ──
const HARNESS_PROVIDERS: Record<string, string[]> = {
  'claude-code': ['anthropic'],
  'pi': ['anthropic', 'openai-codex', 'openai', 'openrouter'],
  'codex': ['openai-codex', 'openai'],
};

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'openai-codex': 'ChatGPT',
  openrouter: 'OpenRouter',
};

type RawModel = {
  id: string;
  name: string;
  provider: string;
  reasoning: boolean;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

const UNSUPPORTED_CHATGPT_SUBSCRIPTION_MODEL_IDS = new Set<string>([
  // ChatGPT subscription OAuth rejects this model for Codex runs.
  'gpt-5.1-codex-mini',
]);

function fmt(n: number): string {
  if (n === 0) return '$0';
  if (n >= 10) return `$${Math.round(n)}`;
  if (n >= 1) return `$${parseFloat(n.toPrecision(2))}`;
  const cents = n * 100;
  if (cents >= 1) return `${parseFloat(cents.toPrecision(2))}¢`;
  return `$${parseFloat(n.toPrecision(2))}`;
}

function formatPricing(cost: RawModel['cost']): { full: string; input: string } | null {
  if (!cost) return null;
  if (cost.input === 0 && cost.output === 0) return { full: 'free', input: 'free' };
  return { full: `${fmt(cost.input)}→${fmt(cost.output)}/M`, input: `${fmt(cost.input)}/M` };
}

function familyOf(name: string): { key: string; version: number } {
  const s = name.toLowerCase().replace(/\bv\d+\b/g, ' ');
  const m = s.match(/(\d+(?:\.\d+)?)[a-z]?/);
  const version = m ? parseFloat(m[1]) : -1;
  const key = s
    .replace(/\d+(?:\.\d+)?[a-z]?/, '')
    .replace(/[-\s]+/g, ' ')
    .trim();
  return { key, version };
}

function filterToLatestVersions(models: RawModel[]): RawModel[] {
  // R1 — drop (latest) / dated snapshots
  let out = models.filter(m => !m.name.includes('(latest)') && !/\(\d{4}/.test(m.name));
  // R2 — drop specialised variants
  out = out.filter(m => !/\b(Chat|research|Turbo|Spark|Max)\b/i.test(m.name));
  // R3 — drop oversized tier qualifiers
  out = out.filter(m => !/(\bnano\b|\bpro\b|-pro)$/i.test(m.name));
  // R5 — drop model IDs with variant suffix tags (:extended, :thinking) but keep :free
  out = out.filter(m => !m.id.includes(':') || m.id.endsWith(':free'));
  // R6 — drop meta-router / auto-router model IDs
  out = out.filter(m => m.id !== 'auto' && !m.id.startsWith('openrouter/'));
  // R7 — drop non-coding / non-text-generation models by name/id patterns
  const NON_CODING = /\b(audio|vision|\bvl\b|embed|rerank|guard|safeguard|whisper|tts|dall|moderat|ocr|transcri|image.gen|image-gen|\bsearch\b)\b/i;
  out = out.filter(m => !NON_CODING.test(m.name) && !NON_CODING.test(m.id));
  // R8 — drop alias / "latest" router IDs (contain ~ in provider or are routing aliases)
  out = out.filter(m => !m.id.startsWith('~') && !m.provider.startsWith('~'));
  // R9 — drop creative-writing fine-tunes and known non-coding niche models
  const NICHE_NAMES = /euryale|unslopnemo|rocinante|ernie.*vl|cobuddy.*vl/i;
  const NICHE_PROVIDERS = new Set(['sao10k', 'thedrummer', 'relace']);
  out = out.filter(m => !NICHE_NAMES.test(m.name) && !NICHE_NAMES.test(m.id) && !NICHE_PROVIDERS.has(m.provider));
  // R4 — keep highest version per (provider, family)
  const groups = new Map<string, { model: RawModel; version: number }>();
  for (const model of out) {
    const { key, version } = familyOf(model.name);
    const gk = `${model.provider}::${key}`;
    const existing = groups.get(gk);
    if (!existing || version > existing.version) groups.set(gk, { model, version });
  }
  return Array.from(groups.values()).map(g => g.model);
}

const auth = AuthStorage.inMemory();
auth.setRuntimeApiKey('anthropic', 'gateway');
auth.setRuntimeApiKey('openai', 'gateway');
auth.set('openai-codex', { type: 'oauth', access: 'placeholder', refresh: 'placeholder', expires: Date.now() + 60_000 });
auth.setRuntimeApiKey('openrouter', 'placeholder');
const registry = ModelRegistry.create(auth);
const allModels = (registry as unknown as { getAll(): RawModel[] }).getAll();

const result: Record<string, ModelOption[]> = {};
for (const [harnessId, providers] of Object.entries(HARNESS_PROVIDERS)) {
  const providerModels = allModels.filter(m => {
    if (!providers.includes(m.provider)) return false;
    if (m.provider === 'openai-codex' && UNSUPPORTED_CHATGPT_SUBSCRIPTION_MODEL_IDS.has(m.id)) return false;
    return true;
  });
  const filtered = filterToLatestVersions(providerModels);
  filtered.sort((a, b) => {
    const pi = providers.indexOf(a.provider), pj = providers.indexOf(b.provider);
    if (pi !== pj) return pi - pj;
    // Within same provider-tier: free models last, then sort by input price ascending
    const aFree = a.id.endsWith(':free'), bFree = b.id.endsWith(':free');
    if (aFree !== bFree) return aFree ? 1 : -1;
    const aPrice = a.cost?.input ?? 0, bPrice = b.cost?.input ?? 0;
    if (aPrice !== bPrice) return aPrice - bPrice;
    return a.name.localeCompare(b.name);
  });
  result[harnessId] = filtered.map(m => {
    const pricing = formatPricing(m.cost);
    const providerLabel = PROVIDER_LABELS[m.provider] ?? m.provider;
    const reasoningLabel = m.reasoning ? ' · reasoning' : '';
    const description = pricing
      ? `${providerLabel}${reasoningLabel} · ${pricing.full}`
      : `${providerLabel}${reasoningLabel}`;
    return {
      id: m.provider === 'openai-codex' ? `openai-codex:${m.id}` : m.id,
      label: m.name,
      description,
      ...(pricing ? { pricingLabel: pricing.full, inputPriceLabel: pricing.input } : {}),
    };
  });
}

for (const [offset, modelOption] of PRIMORDIA_DIRECT_GOOGLE_MODEL_OPTIONS.entries()) {
  if (!result.pi.some((model) => model.id === modelOption.id)) {
    result.pi.splice(3 + offset, 0, modelOption);
  }
}
for (const modelOption of PRIMORDIA_OPENROUTER_MODEL_OPTIONS) {
  if (!result.pi.some((model) => model.id === modelOption.id)) {
    const insertAfter = result.pi.findIndex((model) => model.id === 'google/gemini-3-flash-preview');
    result.pi.splice(insertAfter >= 0 ? insertAfter + 1 : result.pi.length, 0, modelOption);
  }
}

const outPath = join(import.meta.dir, '../lib/models.generated.json');
writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');

console.log(`Wrote ${outPath}`);
for (const [harness, list] of Object.entries(result)) {
  console.log(`  ${harness}: ${list.length} model${list.length !== 1 ? 's' : ''}`);
  for (const m of list) {
    console.log(`    ${m.id.padEnd(35)} ${m.label}  ${m.inputPriceLabel ?? ''}`);
  }
}
