// Shared secret type mappings for settings pages and secret API routes.

export type SecretType =
  | 'ANTHROPIC_API_KEY'
  | 'OPENROUTER_API_KEY'
  | 'OPENAI_API_KEY'
  | 'GEMINI_API_KEY'
  | 'CLAUDE_CODE_CREDENTIALS_JSON'
  | 'CHATGPT_SUBSCRIPTION_OAUTH';

export type SecretAuthSource =
  | 'anthropic-api-key'
  | 'openrouter-api-key'
  | 'openai-api-key'
  | 'gemini-api-key'
  | 'claude-subscription'
  | 'chatgpt-subscription';

export type SecretCiphertexts = Partial<Record<SecretType, string | null>>;

export const TYPE_BY_AUTH_SOURCE: Record<SecretAuthSource, SecretType> = {
  'anthropic-api-key': 'ANTHROPIC_API_KEY',
  'openrouter-api-key': 'OPENROUTER_API_KEY',
  'openai-api-key': 'OPENAI_API_KEY',
  'gemini-api-key': 'GEMINI_API_KEY',
  'claude-subscription': 'CLAUDE_CODE_CREDENTIALS_JSON',
  'chatgpt-subscription': 'CHATGPT_SUBSCRIPTION_OAUTH',
};

export const AUTH_SOURCE_BY_TYPE: Record<SecretType, SecretAuthSource> = {
  ANTHROPIC_API_KEY: 'anthropic-api-key',
  OPENROUTER_API_KEY: 'openrouter-api-key',
  OPENAI_API_KEY: 'openai-api-key',
  GEMINI_API_KEY: 'gemini-api-key',
  CLAUDE_CODE_CREDENTIALS_JSON: 'claude-subscription',
  CHATGPT_SUBSCRIPTION_OAUTH: 'chatgpt-subscription',
};

export function isSecretAuthSource(value: string): value is SecretAuthSource {
  return value in TYPE_BY_AUTH_SOURCE;
}

export function isSecretType(value: string): value is SecretType {
  return value in AUTH_SOURCE_BY_TYPE;
}
