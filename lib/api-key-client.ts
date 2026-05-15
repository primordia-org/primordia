"use client";

// lib/api-key-client.ts
// Compatibility shim — delegates to lib/secrets-client.ts.
// New code should import directly from secrets-client.

import {
  setSecret,
  clearSecret,
  encryptSecretForTransmission,
  encryptChatGptSubscriptionForTransmission,
  bustPublicKeyCache,
  type HybridEncryptedSecret,
} from './secrets-client';

export { bustPublicKeyCache, encryptChatGptSubscriptionForTransmission };

export async function setStoredApiKey(key: string | null): Promise<void> {
  if (key === null || key === '') return clearSecret('anthropic-api-key');
  return setSecret('anthropic-api-key', key);
}

export async function encryptStoredApiKey(): Promise<HybridEncryptedSecret | null> {
  return encryptSecretForTransmission('anthropic-api-key');
}

export async function setStoredOpenRouterApiKey(key: string | null): Promise<void> {
  if (key === null || key === '') return clearSecret('openrouter-api-key');
  return setSecret('openrouter-api-key', key);
}

export async function encryptStoredOpenRouterApiKey(): Promise<HybridEncryptedSecret | null> {
  return encryptSecretForTransmission('openrouter-api-key');
}

export async function setStoredGeminiApiKey(key: string | null): Promise<void> {
  if (key === null || key === '') return clearSecret('gemini-api-key');
  return setSecret('gemini-api-key', key);
}

export async function encryptStoredGeminiApiKey(): Promise<HybridEncryptedSecret | null> {
  return encryptSecretForTransmission('gemini-api-key');
}
