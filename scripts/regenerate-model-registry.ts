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
import { ModelRegistry, AuthStorage } from '@mariozechner/pi-coding-agent';
import type { ModelOption } from '../lib/agent-config';

// ── Providers per harness (mirrors HARNESS_PROVIDERS in pi-model-registry.server.ts) ──
const HARNESS_PROVIDERS: Record<string, string[]> = {
  'claude-code': ['anthropic'],
  'pi': ['anthropic', 'openai'],
};

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

function fmt(n: number): string {
  if (n === 0) return '$0';
  if (n >= 10) return `$${Math.round(n)}`;
  if (n >= 1) return `$${parseFloat(n.toPrecision(2))}`;
  const cents = n * 100;
  if (cents >= 1) return `${parseFloat(cents.toPrecision(2))}¢`;
  return `$${parseFloat(n.toPrecision(2))}`;
}

function formatPricing(cost: RawModel['cost']): { full: string; input: string } | null {
  if (!cost || (cost.input === 0 && cost.output === 0)) return null;
  return { full: `${fmt(cost.input)}→${fmt(cost.output)}/M`, input: `${fmt(cost.input)}/M` };
}

function familyOf(name: string): { key: string; version: number } {
  let s = name.toLowerCase().replace(/\bv\d+\b/g, ' ');
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

const auth = AuthStorage.create();
auth.setRuntimeApiKey('anthropic', 'gateway');
auth.setRuntimeApiKey('openai', 'gateway');
const registry = ModelRegistry.create(auth);
const allModels = (registry as unknown as { getAll(): RawModel[] }).getAll();

const result: Record<string, ModelOption[]> = {};
for (const [harnessId, providers] of Object.entries(HARNESS_PROVIDERS)) {
  const providerModels = allModels.filter(m => providers.includes(m.provider));
  const filtered = filterToLatestVersions(providerModels);
  filtered.sort((a, b) => {
    const pi = providers.indexOf(a.provider), pj = providers.indexOf(b.provider);
    if (pi !== pj) return pi - pj;
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
      id: m.id,
      label: m.name,
      description,
      ...(pricing ? { pricingLabel: pricing.full, inputPriceLabel: pricing.input } : {}),
    };
  });
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
