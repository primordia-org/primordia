// lib/presets.ts
// Thread preset definitions: billing source + harness + model + display name.

export const SECRET_AUTH_SOURCES = [
  'claude-subscription',
  'chatgpt-subscription',
  'openrouter-api-key',
  'anthropic-api-key',
  'openai-api-key',
  'gemini-api-key',
] as const;

export type SecretAuthSource = typeof SECRET_AUTH_SOURCES[number];

export type PresetAuthSource = SecretAuthSource | 'exe-dev-gateway';

export type SecretCiphertexts = Partial<Record<SecretAuthSource, string | null>>;

export interface ThreadPreset {
  id: string;
  name: string;
  authSource: PresetAuthSource;
  harness: string;
  model: string;
  builtIn?: boolean;
}

export const BUILT_IN_PRESETS: ThreadPreset[] = [
  {
    id: 'builtin:claude-code-gateway',
    name: 'Claude Code — exe.dev gateway',
    authSource: 'exe-dev-gateway',
    harness: 'claude-code',
    model: 'claude-sonnet-4-6',
    builtIn: true,
  },
  {
    id: 'builtin:claude-code-subscription',
    name: 'Claude Code — subscription',
    authSource: 'claude-subscription',
    harness: 'claude-code',
    model: 'claude-sonnet-4-6',
    builtIn: true,
  },
  {
    id: 'builtin:claude-code-api-key',
    name: 'Claude Code — API key',
    authSource: 'anthropic-api-key',
    harness: 'claude-code',
    model: 'claude-sonnet-4-6',
    builtIn: true,
  },
  {
    id: 'builtin:codex-gateway',
    name: 'Codex — exe.dev gateway',
    authSource: 'exe-dev-gateway',
    harness: 'codex',
    model: 'gpt-5.5',
    builtIn: true,
  },
  {
    id: 'builtin:codex-chatgpt',
    name: 'Codex — ChatGPT subscription',
    authSource: 'chatgpt-subscription',
    harness: 'codex',
    model: 'openai-codex:gpt-5.5',
    builtIn: true,
  },
  {
    id: 'builtin:codex-openai-api-key',
    name: 'Codex — OpenAI API key',
    authSource: 'openai-api-key',
    harness: 'codex',
    model: 'gpt-5.5',
    builtIn: true,
  },
  {
    id: 'builtin:pi-chatgpt-codex-mini',
    name: 'Pi + ChatGPT + GPT 5.5',
    authSource: 'chatgpt-subscription',
    harness: 'pi',
    model: 'openai-codex:gpt-5.5',
    builtIn: true,
  },
  {
    id: 'builtin:pi-openrouter-sonnet',
    name: 'Pi + OpenRouter + Sonnet',
    authSource: 'openrouter-api-key',
    harness: 'pi',
    model: 'anthropic/claude-sonnet-4.6',
    builtIn: true,
  },
  {
    id: 'builtin:pi-openrouter-gemini-flash',
    name: 'Pi + OpenRouter + Gemini 3.5 Flash',
    authSource: 'openrouter-api-key',
    harness: 'pi',
    model: 'google/gemini-3.5-flash',
    builtIn: true,
  },
  {
    id: 'builtin:free-option',
    name: 'Free Option',
    authSource: 'openrouter-api-key',
    harness: 'pi',
    model: 'baidu/cobuddy:free',
    builtIn: true,
  },
  {
    id: 'builtin:pi-gemini-flash',
    name: 'Pi + Gemini 3.5 Flash',
    authSource: 'gemini-api-key',
    harness: 'pi',
    model: 'gemini-3.5-flash',
    builtIn: true,
  },
];

export const PRESET_AUTH_SOURCE_LABELS: Record<PresetAuthSource, string> = {
  'claude-subscription': 'Claude.ai subscription',
  'chatgpt-subscription': 'ChatGPT subscription',
  'exe-dev-gateway': 'exe.dev gateway',
  'openrouter-api-key': 'OpenRouter API key',
  'anthropic-api-key': 'Anthropic API key',
  'openai-api-key': 'OpenAI API key',
  'gemini-api-key': 'Google Gemini API key',
};

export const PREF_CUSTOM_PRESETS = 'evolve:custom-presets';
export const PREF_DISABLED_BUILT_IN_PRESETS = 'evolve:disabled-built-in-presets';
export const PREF_PRESET = 'evolve:preferred-preset';

export function normalizeAuthSource(value: string): PresetAuthSource | null {
  if (value === 'openrouter-key') return 'openrouter-api-key';
  if (value === 'anthropic-key') return 'anthropic-api-key';
  if (value === 'openai-key') return 'openai-api-key';
  const allowed = Object.keys(PRESET_AUTH_SOURCE_LABELS);
  return allowed.includes(value) ? (value as PresetAuthSource) : null;
}

export function isSecretAuthSource(value: string): value is SecretAuthSource {
  return (SECRET_AUTH_SOURCES as readonly string[]).includes(value);
}

export function parseCustomPresets(raw: string | undefined): ThreadPreset[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item, index) => {
      if (!item || typeof item !== 'object') return [];
      const rec = item as Record<string, unknown>;
      const name = typeof rec.name === 'string' ? rec.name.trim() : '';
      const harness = typeof rec.harness === 'string' ? rec.harness.trim() : '';
      const model = typeof rec.model === 'string' ? rec.model.trim() : '';
      const authSource = typeof rec.authSource === 'string' ? normalizeAuthSource(rec.authSource) : null;
      if (!name || !harness || !model || !authSource) return [];
      return [{
        id: typeof rec.id === 'string' && rec.id ? rec.id : `custom:${index}`,
        name,
        authSource,
        harness,
        model,
      } satisfies ThreadPreset];
    });
  } catch {
    return [];
  }
}

export function serializeCustomPresets(presets: ThreadPreset[]): string {
  return JSON.stringify(presets.map((p) => ({
    id: p.id,
    name: p.name,
    authSource: p.authSource,
    harness: p.harness,
    model: p.model,
  })));
}

export function parseDisabledBuiltInPresetIds(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const builtInIds = new Set(BUILT_IN_PRESETS.map((p) => p.id));
    return parsed.filter((id): id is string => typeof id === 'string' && builtInIds.has(id));
  } catch {
    return [];
  }
}

export function serializeDisabledBuiltInPresetIds(ids: string[]): string {
  const builtInIds = new Set(BUILT_IN_PRESETS.map((p) => p.id));
  return JSON.stringify([...new Set(ids)].filter((id) => builtInIds.has(id)));
}
