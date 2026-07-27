// lib/pi-auth-storage.ts
// Small in-memory CredentialStore adapter for Primordia's server-side pi SDK use.

import type { Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai';

export class InMemoryPiCredentialStore implements CredentialStore {
  private readonly credentials = new Map<string, Credential>();
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(initial?: Record<string, Credential>) {
    if (initial) {
      for (const [providerId, credential] of Object.entries(initial)) {
        this.credentials.set(providerId, credential);
      }
    }
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return this.credentials.get(providerId);
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return Array.from(this.credentials.entries()).map(([providerId, credential]) => ({
      providerId,
      type: credential.type,
    }));
  }

  async modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined> {
    const previousLock = this.locks.get(providerId) ?? Promise.resolve();
    let release!: () => void;
    const nextLock = new Promise<void>((resolve) => { release = resolve; });
    const chainedLock = previousLock.then(() => nextLock);
    this.locks.set(providerId, chainedLock);

    await previousLock;
    try {
      const next = await fn(this.credentials.get(providerId));
      if (next) this.credentials.set(providerId, next);
      return this.credentials.get(providerId);
    } finally {
      release();
      if (this.locks.get(providerId) === chainedLock) this.locks.delete(providerId);
    }
  }

  async delete(providerId: string): Promise<void> {
    const previousLock = this.locks.get(providerId) ?? Promise.resolve();
    let release!: () => void;
    const nextLock = new Promise<void>((resolve) => { release = resolve; });
    const chainedLock = previousLock.then(() => nextLock);
    this.locks.set(providerId, chainedLock);

    await previousLock;
    try {
      this.credentials.delete(providerId);
    } finally {
      release();
      if (this.locks.get(providerId) === chainedLock) this.locks.delete(providerId);
    }
  }

  async set(providerId: string, credential: Credential): Promise<void> {
    await this.modify(providerId, async () => credential);
  }

  get(providerId: string): Credential | undefined {
    return this.credentials.get(providerId);
  }
}
