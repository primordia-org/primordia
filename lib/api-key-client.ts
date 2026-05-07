"use client";

// lib/api-key-client.ts
// Compatibility shim — delegates to lib/secrets-client.ts.
// New code should import directly from secrets-client.

import {
  hasSecret,
  setSecret,
  clearSecret,
  encryptSecretForTransmission,
  bustPublicKeyCache,
} from './secrets-client';

export { bustPublicKeyCache };

export function hasStoredApiKey(): boolean {
  return hasSecret('ANTHROPIC_API_KEY');
}

export async function setStoredApiKey(key: string | null): Promise<void> {
  if (key === null || key === '') return clearSecret('ANTHROPIC_API_KEY');
  return setSecret('ANTHROPIC_API_KEY', key);
}

export async function encryptStoredApiKey(): Promise<string | null> {
  return encryptSecretForTransmission('ANTHROPIC_API_KEY');
}

export function hasStoredOpenRouterApiKey(): boolean {
  return hasSecret('OPENROUTER_API_KEY');
}

export async function setStoredOpenRouterApiKey(key: string | null): Promise<void> {
  if (key === null || key === '') return clearSecret('OPENROUTER_API_KEY');
  return setSecret('OPENROUTER_API_KEY', key);
}

export async function encryptStoredOpenRouterApiKey(): Promise<string | null> {
  return encryptSecretForTransmission('OPENROUTER_API_KEY');
}
