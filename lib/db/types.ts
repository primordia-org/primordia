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

/**
 * A short-lived token that coordinates cross-device authentication.
 * The "requester" device (e.g. laptop) creates one and shows a QR code.
 * The "approver" device (e.g. phone, already signed in) scans the QR and
 * approves it; the requester then polls until approved and gets a session.
 */
export interface CrossDeviceToken {
  id: string;
  /** "pending" → created, waiting for approval; "approved" → approver clicked approve */
  status: "pending" | "approved";
  /** Set when the approver approves — the userId of the approving user. */
  userId: string | null;
  expiresAt: number;
}

/**
 * A persisted record of one local evolve session.
 * In-memory sessions also carry a ChildProcess reference (not stored here).
 */
export interface EvolveSession {
  id: string;
  branch: string;
  worktreePath: string;
  /** One of the LocalSessionStatus values serialised as a string. */
  status: string;
  /** The DevServerStatus serialised as a string; e.g. 'none' | 'starting' | 'running' | 'disconnected'. */
  devServerStatus: string;
  /** Accumulated markdown progress text shown in the session UI. */
  progressText: string;
  port: number | null;
  previewUrl: string | null;
  /** The original change request submitted by the user. */
  request: string;
  createdAt: number;
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

  // Cross-device QR tokens
  createCrossDeviceToken(token: CrossDeviceToken): Promise<void>;
  getCrossDeviceToken(id: string): Promise<CrossDeviceToken | null>;
  approveCrossDeviceToken(id: string, userId: string): Promise<void>;
  deleteCrossDeviceToken(id: string): Promise<void>;
  deleteExpiredCrossDeviceTokens(): Promise<void>;

  // Evolve sessions
  createEvolveSession(session: EvolveSession): Promise<void>;
  updateEvolveSession(
    id: string,
    updates: Partial<Pick<EvolveSession, "status" | "devServerStatus" | "progressText" | "port" | "previewUrl">>,
  ): Promise<void>;
  getEvolveSession(id: string): Promise<EvolveSession | null>;
  listEvolveSessions(limit?: number): Promise<EvolveSession[]>;
}
