"use client";

// lib/credentials-client.ts
// Compatibility shim — delegates to lib/secrets-client.ts.
// New code should import directly from secrets-client.

import {
  setSecret,
  clearSecret,
  updateSecret,
  bustPublicKeyCache,
  encryptCredentialsForTransmission,
} from './secrets-client';

export async function setStoredCredentials(credentials: string | null): Promise<void> {
  if (credentials === null || credentials === '') return clearSecret('CLAUDE_CODE_CREDENTIALS_JSON');
  return setSecret('CLAUDE_CODE_CREDENTIALS_JSON', credentials);
}

export async function updateStoredCredentials(credentials: string): Promise<void> {
  return updateSecret('CLAUDE_CODE_CREDENTIALS_JSON', credentials);
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
