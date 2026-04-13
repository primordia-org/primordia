// lib/agent-config.ts
// Definitions for supported coding agent harnesses and the models they support.
// Add new harnesses here as they become available.

export interface HarnessOption {
  id: string;
  label: string;
  description: string;
}

export interface ModelOption {
  id: string;
  label: string;
  description: string;
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

export const MODEL_OPTIONS_BY_HARNESS: Record<string, ModelOption[]> = {
  'claude-code': [
    {
      id: 'claude-sonnet-4-6',
      label: 'Claude Sonnet 4',
      description: 'Balanced — default',
    },
    {
      id: 'claude-opus-4-6',
      label: 'Claude Opus 4',
      description: 'Most capable',
    },
    {
      id: 'claude-haiku-4-5-20251001',
      label: 'Claude Haiku 4',
      description: 'Fastest',
    },
  ],
  'pi': [
    {
      id: 'claude-sonnet-4-6',
      label: 'Claude Sonnet 4',
      description: 'Balanced — default',
    },
    {
      id: 'claude-opus-4-6',
      label: 'Claude Opus 4',
      description: 'Most capable',
    },
    {
      id: 'claude-haiku-4-5-20251001',
      label: 'Claude Haiku 4',
      description: 'Fastest',
    },
  ],
};

export const DEFAULT_HARNESS = 'claude-code';
export const DEFAULT_MODEL = 'claude-sonnet-4-6';
