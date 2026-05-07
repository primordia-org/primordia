"use client";

// lib/credentials-client.ts
// Compatibility shim — delegates to lib/secrets-client.ts.
// New code should import directly from secrets-client.

import {
  hasSecret,
  setSecret,
  clearSecret,
  updateSecret,
  clearOrphanedSecretsKey,
  bustPublicKeyCache,
  encryptCredentialsForTransmission,
} from './secrets-client';

export function hasStoredCredentials(): boolean {
  return hasSecret('CLAUDE_CODE_CREDENTIALS_JSON');
}

export async function setStoredCredentials(credentials: string | null): Promise<void> {
  if (credentials === null || credentials === '') return clearSecret('CLAUDE_CODE_CREDENTIALS_JSON');
  return setSecret('CLAUDE_CODE_CREDENTIALS_JSON', credentials);
}

export async function updateStoredCredentials(credentials: string): Promise<void> {
  return updateSecret('CLAUDE_CODE_CREDENTIALS_JSON', credentials);
}

export async function clearOrphanedCredentialsKey(): Promise<void> {
  // Use clearSecret so the shared AES key is only removed if credentials
  // were the last remaining secret — not if other keys are still stored.
  return clearSecret('CLAUDE_CODE_CREDENTIALS_JSON');
}

export function bustCredentialsPublicKeyCache(): void {
  bustPublicKeyCache();
}

export async function encryptStoredCredentials(): Promise<{
  wrappedKey: string;
  iv: string;
  ciphertext: string;
} | null> {
  return encryptCredentialsForTransmission();
}
