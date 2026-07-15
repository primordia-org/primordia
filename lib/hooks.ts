// lib/hooks.ts
// Shared React hooks for Primordia client components.

import { useState, useEffect, useCallback, useRef } from "react";
import { withBasePath } from "./base-path";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SessionUser {
  id: string;
  username: string;
  isAdmin: boolean;
  canStartThreads?: boolean;
}

interface StoredDraft {
  text: string;
  updatedAt: number;
}

interface ParsedStoredDraft extends StoredDraft {
  isLegacy: boolean;
}

const DRAFT_STORAGE_PREFIX = "primordia:thread-draft:";
const DRAFT_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

let hasGarbageCollectedDrafts = false;

function parseStoredDraft(raw: string): ParsedStoredDraft | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { text?: unknown }).text === "string" &&
      typeof (parsed as { updatedAt?: unknown }).updatedAt === "number"
    ) {
      return { ...(parsed as StoredDraft), isLegacy: false };
    }
  } catch {
    // Backward compatibility: pre-timestamp drafts were stored as plain text.
    return { text: raw, updatedAt: Date.now(), isLegacy: true };
  }
  return null;
}

function isExpiredDraft(draft: StoredDraft, now = Date.now()): boolean {
  return now - draft.updatedAt > DRAFT_MAX_AGE_MS;
}

function serializeDraft(text: string): string {
  return JSON.stringify({ text, updatedAt: Date.now() } satisfies StoredDraft);
}

function garbageCollectOldDrafts() {
  if (hasGarbageCollectedDrafts || typeof window === "undefined") return;
  hasGarbageCollectedDrafts = true;
  const now = Date.now();
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith(DRAFT_STORAGE_PREFIX) && !key?.startsWith("primordia:evolve-draft:")) continue;
      const raw = window.localStorage.getItem(key);
      if (raw === null) continue;
      const draft = parseStoredDraft(raw);
      if (draft && isExpiredDraft(draft, now)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Ignore storage privacy/quota errors; draft persistence is best-effort.
  }
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

/**
 * Fetches the current auth session on mount and provides a logout handler.
 * For use in "use client" components. Initial value is null (not yet fetched).
 */
export function useSessionUser() {
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    fetch(withBasePath("/api/auth/session"))
      .then((res) => res.json())
      .then((data: { user: SessionUser | null }) => setSessionUser(data.user))
      .catch(() => {});
  }, []);

  async function handleLogout() {
    await fetch(withBasePath("/api/auth/logout"), { method: "POST" });
    setSessionUser(null);
  }

  return { sessionUser, handleLogout };
}

/**
 * Persists a text draft to localStorage, storing both the text and an updatedAt
 * timestamp. Old Primordia draft keys older than one year are garbage collected
 * the first time this hook runs in a browser process.
 */
export function useLocalStorageDraft(storageKey?: string) {
  const [draft, setDraftState] = useState("");
  const hydratedKeyRef = useRef<string | null>(null);
  const skipNextPersistRef = useRef(false);

  useEffect(() => {
    if (!storageKey) {
      hydratedKeyRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraftState("");
      return;
    }

    garbageCollectOldDrafts();

    let nextDraft = "";
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw !== null) {
        const stored = parseStoredDraft(raw);
        if (stored && !isExpiredDraft(stored)) {
          nextDraft = stored.text;
          // Upgrade legacy plain-text drafts to the timestamped format.
          if (stored.isLegacy) {
            window.localStorage.setItem(storageKey, serializeDraft(stored.text));
          }
        } else {
          window.localStorage.removeItem(storageKey);
        }
      }
    } catch {
      // localStorage can be unavailable in private/incognito contexts.
    }

    hydratedKeyRef.current = storageKey;
    skipNextPersistRef.current = true;
    setDraftState(nextDraft);
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || hydratedKeyRef.current !== storageKey) return;
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    try {
      if (draft.length > 0) {
        window.localStorage.setItem(storageKey, serializeDraft(draft));
      } else {
        window.localStorage.removeItem(storageKey);
      }
    } catch {
      // Ignore storage quota/privacy errors; the form still works normally.
    }
  }, [storageKey, draft]);

  const setDraft = useCallback((nextDraft: string) => {
    setDraftState(nextDraft);
  }, []);

  const clearDraft = useCallback(() => {
    setDraftState("");
    if (!storageKey) return;
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Ignore storage errors.
    }
  }, [storageKey]);

  return { draft, setDraft, clearDraft };
}
