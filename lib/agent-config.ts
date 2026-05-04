// lib/agent-config.ts
// Definitions for supported coding agent harnesses, models, and global defaults.
//
// The model list lives in lib/models.generated.json so both server and client
// components can import it without pulling in @mariozechner/pi-coding-agent.
// Regenerate it with: bun run regenerate:model-registry

export interface HarnessOption {
  id: string;
  label: string;
  description: string;
}

export interface ModelOption {
  id: string;
  label: string;
  description: string;
  /** Full concise price string, e.g. "$3→$15/M" — shown as a hint after selection */
  pricingLabel?: string;
  /** Input-only price label, e.g. "$3/M" — shown inline in the dropdown */
  inputPriceLabel?: string;
}

export const HARNESS_OPTIONS: HarnessOption[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    description: "Anthropic's agentic coding tool",
  },
  {
    id: 'pi',
    label: 'Pi',
    description: "Mario Zechner's pi coding agent",
  },
];

export const DEFAULT_HARNESS = 'pi';
export const DEFAULT_MODEL = 'claude-sonnet-4-6';

import _modelOptions from './models.generated.json';

/** Model options per harness, loaded from lib/models.generated.json. */
export const MODEL_OPTIONS: Record<string, ModelOption[]> = _modelOptions as Record<string, ModelOption[]>;

// ── Caveman mode ─────────────────────────────────────────────────────────────
// Kept here (not in user-prefs.ts) so client components can import them
// without pulling in server-only modules.

export const CAVEMAN_INTENSITIES = ["lite", "full", "ultra", "wenyan-lite", "wenyan-full", "wenyan-ultra"] as const;
export type CavemanIntensity = typeof CAVEMAN_INTENSITIES[number];
export const DEFAULT_CAVEMAN_INTENSITY: CavemanIntensity = "full";
