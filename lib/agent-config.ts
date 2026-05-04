// lib/agent-config.ts
// Definitions for supported coding agent harnesses, models, and global defaults.
//
// The model list is hard-coded here so that both server and client components
// can import it without pulling in @mariozechner/pi-coding-agent.  Update this
// list manually when new models are released.  The old pi-model-registry.server.ts
// module (which read the list dynamically from the pi SDK) is kept for reference
// but is no longer imported anywhere.

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

/**
 * Hard-coded model options per harness.
 * claude-code  → Anthropic only (Claude Code SDK is Anthropic-only)
 * pi           → Anthropic + OpenAI (both routed via the exe.dev LLM gateway)
 *
 * Pricing format: "$N→$M/M" (input→output per million tokens).
 * Update when new models ship.
 */
export const MODEL_OPTIONS: Record<string, ModelOption[]> = {
  'claude-code': [
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', description: 'Anthropic · reasoning · $1→$5/M',   pricingLabel: '$1→$5/M',    inputPriceLabel: '$1/M' },
    { id: 'claude-opus-4-6',           label: 'Claude Opus 4.6',  description: 'Anthropic · reasoning · $5→$25/M',  pricingLabel: '$5→$25/M',   inputPriceLabel: '$5/M' },
    { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6',description: 'Anthropic · reasoning · $3→$15/M',  pricingLabel: '$3→$15/M',   inputPriceLabel: '$3/M' },
  ],
  'pi': [
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5',    description: 'Anthropic · reasoning · $1→$5/M',       pricingLabel: '$1→$5/M',      inputPriceLabel: '$1/M' },
    { id: 'claude-opus-4-6',           label: 'Claude Opus 4.6',     description: 'Anthropic · reasoning · $5→$25/M',      pricingLabel: '$5→$25/M',     inputPriceLabel: '$5/M' },
    { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6',   description: 'Anthropic · reasoning · $3→$15/M',      pricingLabel: '$3→$15/M',     inputPriceLabel: '$3/M' },
    { id: 'codex-mini-latest',         label: 'Codex Mini',          description: 'OpenAI · reasoning · $1.5→$6/M',       pricingLabel: '$1.5→$6/M',    inputPriceLabel: '$1.5/M' },
    { id: 'gpt-5.1-codex-mini',        label: 'GPT-5.1 Codex mini', description: 'OpenAI · reasoning · 25¢→$2/M',        pricingLabel: '25¢→$2/M',     inputPriceLabel: '25¢/M' },
    { id: 'gpt-5.3-codex',            label: 'GPT-5.3 Codex',       description: 'OpenAI · reasoning · $1.8→$14/M',      pricingLabel: '$1.8→$14/M',   inputPriceLabel: '$1.8/M' },
    { id: 'gpt-5.4',                   label: 'GPT-5.4',             description: 'OpenAI · reasoning · $2.5→$15/M',      pricingLabel: '$2.5→$15/M',   inputPriceLabel: '$2.5/M' },
    { id: 'gpt-5.4-mini',              label: 'GPT-5.4 mini',        description: 'OpenAI · reasoning · 75¢→$4.5/M',      pricingLabel: '75¢→$4.5/M',   inputPriceLabel: '75¢/M' },
    { id: 'o3',                        label: 'o3',                  description: 'OpenAI · reasoning · $2→$8/M',         pricingLabel: '$2→$8/M',      inputPriceLabel: '$2/M' },
    { id: 'o4-mini',                   label: 'o4-mini',             description: 'OpenAI · reasoning · $1.1→$4.4/M',     pricingLabel: '$1.1→$4.4/M',  inputPriceLabel: '$1.1/M' },
  ],
};

// ── Caveman mode ─────────────────────────────────────────────────────────────
// Kept here (not in user-prefs.ts) so client components can import them
// without pulling in server-only modules.

export const CAVEMAN_INTENSITIES = ["lite", "full", "ultra", "wenyan-lite", "wenyan-full", "wenyan-ultra"] as const;
export type CavemanIntensity = typeof CAVEMAN_INTENSITIES[number];
export const DEFAULT_CAVEMAN_INTENSITY: CavemanIntensity = "full";
