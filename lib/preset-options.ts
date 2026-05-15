// lib/preset-options.ts
// Client-safe helpers for limiting preset harness/model choices by auth source.

import { HARNESS_OPTIONS, type HarnessOption, type ModelOption } from './agent-config';
import type { PresetAuthSource } from './presets';

function isAnthropicModel(id: string): boolean {
  return id.startsWith('claude-');
}

function isOpenAiModel(id: string): boolean {
  return id.startsWith('gpt-') || id.startsWith('codex-') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4') || id.startsWith('o5');
}

export const UNSUPPORTED_CHATGPT_SUBSCRIPTION_MODELS = new Set<string>([
  // ChatGPT subscription OAuth rejects this model for Codex runs:
  // "The 'gpt-5.1-codex-mini' model is not supported when using Codex with a ChatGPT account."
  'openai-codex:gpt-5.1-codex-mini',
]);

function isChatGptSubscriptionModel(id: string): boolean {
  return id.startsWith('openai-codex:') && !UNSUPPORTED_CHATGPT_SUBSCRIPTION_MODELS.has(id);
}

function isOpenRouterModel(id: string): boolean {
  return id.includes('/');
}

function isGeminiModel(id: string): boolean {
  return id.startsWith('gemini-');
}

export function getHarnessesForAuthSource(authSource: PresetAuthSource): HarnessOption[] {
  const allowed = new Set<string>();
  if (authSource === 'claude-subscription') allowed.add('claude-code');
  if (authSource === 'chatgpt-subscription') { allowed.add('pi'); allowed.add('codex'); }
  if (authSource === 'exe-dev-gateway') { allowed.add('claude-code'); allowed.add('pi'); allowed.add('codex'); }
  if (authSource === 'openrouter-api-key') allowed.add('pi');
  if (authSource === 'anthropic-api-key') { allowed.add('claude-code'); allowed.add('pi'); }
  if (authSource === 'openai-api-key') { allowed.add('pi'); allowed.add('codex'); }
  if (authSource === 'gemini-api-key') allowed.add('pi');
  return HARNESS_OPTIONS.filter((h) => allowed.has(h.id));
}

export function filterModelsForAuthSource(
  models: ModelOption[],
  authSource: PresetAuthSource | undefined,
  harness: string,
): ModelOption[] {
  if (!authSource) return models;
  if (harness === 'claude-code') {
    return models.filter((m) => isAnthropicModel(m.id));
  }
  if (harness === 'codex') {
    if (authSource === 'chatgpt-subscription') return models.filter((m) => isChatGptSubscriptionModel(m.id));
    if (authSource === 'openai-api-key' || authSource === 'exe-dev-gateway') return models.filter((m) => isOpenAiModel(m.id));
    return [];
  }
  if (authSource === 'chatgpt-subscription') return models.filter((m) => isChatGptSubscriptionModel(m.id));
  if (authSource === 'openrouter-api-key') return models.filter((m) => isOpenRouterModel(m.id));
  if (authSource === 'anthropic-api-key') return models.filter((m) => isAnthropicModel(m.id));
  if (authSource === 'openai-api-key') return models.filter((m) => isOpenAiModel(m.id));
  if (authSource === 'gemini-api-key') return models.filter((m) => isGeminiModel(m.id));
  if (authSource === 'exe-dev-gateway') return models.filter((m) => isAnthropicModel(m.id) || isOpenAiModel(m.id));
  if (authSource === 'claude-subscription') return models.filter((m) => isAnthropicModel(m.id));
  return models;
}

export function firstModelForAuthSource(
  modelOptionsByHarness: Record<string, ModelOption[]>,
  authSource: PresetAuthSource,
  harness: string,
): string {
  return filterModelsForAuthSource(modelOptionsByHarness[harness] ?? [], authSource, harness)[0]?.id ?? '';
}

export function isModelAllowedForAuthSource(
  modelOptionsByHarness: Record<string, ModelOption[]>,
  authSource: PresetAuthSource,
  harness: string,
  model: string,
): boolean {
  return filterModelsForAuthSource(modelOptionsByHarness[harness] ?? [], authSource, harness)
    .some((option) => option.id === model);
}
