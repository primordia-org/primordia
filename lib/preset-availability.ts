// lib/preset-availability.ts
// Shared preset availability helpers. Availability is based on whether the
// preset's explicit billing source is usable, not on a global credential order.

import { MODEL_OPTIONS } from './agent-config';
import { isModelAllowedForAuthSource } from './preset-options';
import type { EvolvePreset, PresetAuthSource } from './presets';

export type EvolvePresetWithAvailability = EvolvePreset & {
  available: boolean;
  unavailableReason?: string;
};

export const SECRET_AUTH_SOURCES: PresetAuthSource[] = [
  'claude-subscription',
  'chatgpt-subscription',
  'openrouter-api-key',
  'anthropic-api-key',
  'openai-api-key',
];

export const MISSING_BILLING_SOURCE_MESSAGE = 'Billing source not configured';

export function isExeDevGatewayAvailable(): boolean {
  // Gateway needs no user secret. In exe.dev prod it exists; local dev may still
  // proxy it. Allow opt-out for installs that know gateway is unavailable.
  return process.env.EXE_DEV_GATEWAY_DISABLED !== '1';
}

export function withPresetAvailability(
  preset: EvolvePreset,
  storedAuthSources: Set<string>,
): EvolvePresetWithAvailability {
  if (!isModelAllowedForAuthSource(MODEL_OPTIONS, preset.authSource, preset.harness, preset.model)) {
    return { ...preset, available: false, unavailableReason: 'Model not supported for this billing source' };
  }

  if (preset.authSource === 'exe-dev-gateway') {
    const available = isExeDevGatewayAvailable();
    return available ? { ...preset, available } : { ...preset, available, unavailableReason: 'exe.dev gateway unavailable' };
  }

  const available = storedAuthSources.has(preset.authSource);
  return available
    ? { ...preset, available }
    : { ...preset, available, unavailableReason: MISSING_BILLING_SOURCE_MESSAGE };
}
