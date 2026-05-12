// lib/preset-credentials-client.ts
// Client-side helpers for attaching exactly the credential selected by an evolve preset.

import { encryptChatGptSubscriptionForTransmission, encryptStoredApiKey, encryptStoredOpenRouterApiKey } from './api-key-client';
import { encryptSecretForTransmission } from './secrets-client';
import { encryptStoredCredentials } from './credentials-client';
import type { PresetAuthSource } from './presets';

export type PresetCredentialFields = Partial<{
  encryptedCredentials: string;
  encryptedChatGptOAuth: string;
  encryptedApiKey: string;
}>;

export async function getCredentialFieldsForAuthSource(authSource: PresetAuthSource | null | undefined): Promise<PresetCredentialFields> {
  if (authSource === 'claude-subscription') {
    const encryptedCredentials = await encryptStoredCredentials();
    return encryptedCredentials ? { encryptedCredentials: JSON.stringify(encryptedCredentials) } : {};
  }

  if (authSource === 'chatgpt-subscription') {
    const encryptedChatGptOAuth = await encryptChatGptSubscriptionForTransmission();
    return encryptedChatGptOAuth ? { encryptedChatGptOAuth: JSON.stringify(encryptedChatGptOAuth) } : {};
  }

  if (authSource === 'openrouter-api-key') {
    const encryptedApiKey = await encryptStoredOpenRouterApiKey();
    return encryptedApiKey ? { encryptedApiKey: JSON.stringify(encryptedApiKey) } : {};
  }

  if (authSource === 'openai-api-key') {
    const encryptedApiKey = await encryptSecretForTransmission('openai-api-key');
    return encryptedApiKey ? { encryptedApiKey: JSON.stringify(encryptedApiKey) } : {};
  }

  if (authSource === 'anthropic-api-key') {
    const encryptedApiKey = await encryptStoredApiKey();
    return encryptedApiKey ? { encryptedApiKey: JSON.stringify(encryptedApiKey) } : {};
  }

  // exe.dev gateway, unknown, or legacy sessions: no user credential is needed.
  return {};
}

export async function appendCredentialFieldsForAuthSource(formData: FormData, authSource: PresetAuthSource | null | undefined): Promise<void> {
  const fields = await getCredentialFieldsForAuthSource(authSource);
  for (const [key, value] of Object.entries(fields)) {
    if (value) formData.append(key, value);
  }
}
