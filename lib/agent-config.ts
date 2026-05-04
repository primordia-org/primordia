// lib/agent-config.ts
// Definitions for supported coding agent harnesses and global defaults.
//
// The per-harness model list is intentionally NOT hard-coded here — it is
// generated at runtime from the pi ModelRegistry so it stays current when the
// pi SDK is updated.  Server code imports from lib/pi-model-registry.server.ts;
// client components fetch from GET /api/evolve/models.

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

// ── Caveman mode ─────────────────────────────────────────────────────────────
// Kept here (not in user-prefs.ts) so client components can import them
// without pulling in server-only modules.

export const CAVEMAN_INTENSITIES = ["lite", "full", "ultra", "wenyan-lite", "wenyan-full", "wenyan-ultra"] as const;
export type CavemanIntensity = typeof CAVEMAN_INTENSITIES[number];
export const DEFAULT_CAVEMAN_INTENSITY: CavemanIntensity = "full";
