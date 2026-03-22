// lib/db/types.ts — shared types for the database abstraction layer

export interface User {
  id: string;
  username: string;
  createdAt: number;
}

export interface Passkey {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  deviceType: string;
  backedUp: boolean;
  transports: string | null; // comma-separated list e.g. "internal,hybrid"
  createdAt: number;
}

export interface Challenge {
  id: string;
  challenge: string;
  userId: string | null;
  username: string | null;
  expiresAt: number;
}

export interface Session {
  id: string;
  userId: string;
  expiresAt: number;
}

export interface DbAdapter {
  // Users
  createUser(user: User): Promise<void>;
  getUserByUsername(username: string): Promise<User | null>;
  getUserById(id: string): Promise<User | null>;

  // Passkeys
  savePasskey(passkey: Passkey): Promise<void>;
  getPasskeysByUserId(userId: string): Promise<Passkey[]>;
  getPasskeyByCredentialId(credentialId: string): Promise<Passkey | null>;
  updatePasskeyCounter(credentialId: string, counter: number): Promise<void>;

  // Challenges
  saveChallenge(challenge: Challenge): Promise<void>;
  getChallenge(id: string): Promise<Challenge | null>;
  deleteChallenge(id: string): Promise<void>;
  deleteExpiredChallenges(): Promise<void>;

  // Sessions
  createSession(session: Session): Promise<void>;
  getSession(id: string): Promise<Session | null>;
  deleteSession(id: string): Promise<void>;
}
