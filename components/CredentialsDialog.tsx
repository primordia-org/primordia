"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { KeyRound, X, ExternalLink, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { hasStoredCredentials, setStoredCredentials, clearOrphanedCredentialsKey } from "../lib/credentials-client";
import { withBasePath } from "../lib/base-path";
import { trackEvent } from "../lib/events-client";

type Step =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "awaiting-code"; sessionId: string; url: string }
  | { kind: "submitting" }
  | { kind: "done" }
  | { kind: "error"; message: string };

interface CredentialsDialogProps {
  onClose: () => void;
}

export function CredentialsDialog({ onClose }: CredentialsDialogProps) {
  const [isSet, setIsSet] = useState(false);
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [code, setCode] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [pasteValue, setPasteValue] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [pasteSaved, setPasteSaved] = useState(false);
  const [pasteLoading, setPasteLoading] = useState(false);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    async function checkStatus() {
      if (!hasStoredCredentials()) { setIsSet(false); return; }
      try {
        const res = await fetch(withBasePath('/api/llm-key/encrypted-credentials'));
        if (res.ok) {
          const data = (await res.json()) as { ciphertext: string | null };
          if (!data.ciphertext) { clearOrphanedCredentialsKey(); setIsSet(false); return; }
        }
      } catch {}
      setIsSet(true);
    }
    void checkStatus();
  }, []);

  useEffect(() => {
    return () => {
      const sid = sessionIdRef.current;
      if (sid) {
        void fetch(withBasePath('/api/claude-auth/cancel'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sid }),
        }).catch(() => {});
      }
    };
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);
  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  async function startAuth() {
    setStep({ kind: "starting" });
    try {
      const res = await fetch(withBasePath('/api/claude-auth/start'), { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const { sessionId, url } = (await res.json()) as { sessionId: string; url: string };
      sessionIdRef.current = sessionId;
      setStep({ kind: "awaiting-code", sessionId, url });
      trackEvent("settings/claude-auth-started/v1", {});
    } catch (e) {
      setStep({ kind: "error", message: e instanceof Error ? e.message : "Failed to start authentication." });
    }
  }

  async function submitCode() {
    if (step.kind !== "awaiting-code") return;
    const { sessionId } = step;
    setStep({ kind: "submitting" });
    try {
      const res = await fetch(withBasePath('/api/claude-auth/complete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, code: code.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { credentials } = (await res.json()) as { credentials: string };
      sessionIdRef.current = null;
      await setStoredCredentials(credentials);
      trackEvent("settings/claude-auth-completed/v1", {});
      setIsSet(true);
      setStep({ kind: "done" });
    } catch (e) {
      setStep({ kind: "error", message: e instanceof Error ? e.message : "Failed to complete authentication." });
    }
  }

  function cancelAuth() {
    const sid = sessionIdRef.current;
    if (sid) {
      sessionIdRef.current = null;
      void fetch(withBasePath('/api/claude-auth/cancel'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid }),
      }).catch(() => {});
    }
    setStep({ kind: "idle" });
    setCode("");
  }

  async function clearCredentials() {
    try {
      await setStoredCredentials(null);
      trackEvent("settings/credentials-cleared/v1", {});
      setIsSet(false);
    } catch {}
  }

  function validateJson(raw: string): { ok: true; value: string } | { ok: false; error: string } {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return { ok: false, error: "Not valid JSON." }; }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: "Expected a JSON object." };
    }
    return { ok: true, value: JSON.stringify(parsed) };
  }

  async function handlePasteSave() {
    const trimmed = pasteValue.trim();
    if (!trimmed) { setPasteError("Paste your credentials.json content above."); return; }
    const result = validateJson(trimmed);
    if (!result.ok) { setPasteError(result.error); return; }
    setPasteError(null);
    setPasteLoading(true);
    try {
      await setStoredCredentials(result.value);
      trackEvent("settings/credentials-saved/v1", {});
      setIsSet(true);
      setPasteValue("");
      setPasteSaved(true);
      setStep({ kind: "done" });
      setTimeout(() => setPasteSaved(false), 2000);
    } catch {
      setPasteError("Failed to save credentials. Please try again.");
    } finally {
      setPasteLoading(false);
    }
  }

  const isLoading = step.kind === "starting" || step.kind === "submitting" || pasteLoading;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget && !isLoading) onClose(); }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sky-400">
            <KeyRound size={18} strokeWidth={2} aria-hidden="true" />
            <h2 className="text-base font-semibold">Claude.ai Subscription</h2>
          </div>
          <button
            data-id="credentials/close"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-200 transition-colors"
            aria-label="Close"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {/* Status */}
        <div className={`px-3 py-2 rounded-lg text-sm border ${
          isSet
            ? "bg-green-900/30 border-green-700/50 text-green-300"
            : "bg-gray-800 border-gray-700 text-gray-400"
        }`}>
          {isSet ? (
            <span>
              <span className="font-medium">Active</span>
              <span className="text-green-400/70 text-xs"> — credentials encrypted on your device(s)</span>
            </span>
          ) : (
            <span>No credentials set</span>
          )}
        </div>

        {/* OAuth flow */}
        {step.kind === "idle" && (
          <div className="flex flex-col gap-2">
            <button
              data-id="credentials/start-auth"
              onClick={() => void startAuth()}
              className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-sky-600 hover:bg-sky-500 text-white transition-colors"
            >
              {isSet ? "Sign in again" : "Sign in with Claude.ai"}
            </button>
            {isSet && (
              <button
                data-id="credentials/clear"
                onClick={() => void clearCredentials()}
                className="w-full px-3 py-1.5 rounded-lg text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 border border-red-800/50 transition-colors"
              >
                Clear credentials
              </button>
            )}
          </div>
        )}

        {(step.kind === "starting" || step.kind === "submitting") && (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-gray-400">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            <span>{step.kind === "starting" ? "Starting…" : "Signing in…"}</span>
          </div>
        )}

        {step.kind === "awaiting-code" && (
          <div className="flex flex-col gap-3">
            <a
              href={step.url}
              target="_blank"
              rel="noopener noreferrer"
              data-id="credentials/auth-url"
              className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-sm text-sky-400 hover:text-sky-300 hover:border-sky-700 transition-colors"
            >
              <span>Open authorization page</span>
              <ExternalLink size={14} className="shrink-0" aria-hidden="true" />
            </a>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-gray-400 font-medium" htmlFor="auth-code-input">
                Authorization code
              </label>
              <input
                id="auth-code-input"
                type="text"
                data-id="credentials/auth-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && code.trim()) void submitCode(); }}
                placeholder="Paste code here…"
                className="w-full bg-gray-800 text-sm text-gray-100 placeholder-gray-600 border border-gray-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500/50 font-mono"
                autoFocus
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <button
                data-id="credentials/cancel-auth"
                onClick={cancelAuth}
                className="px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                data-id="credentials/submit-code"
                onClick={() => void submitCode()}
                disabled={!code.trim()}
                className="px-4 py-1.5 rounded-lg text-sm font-medium bg-sky-600 hover:bg-sky-500 disabled:bg-sky-900 text-white transition-colors disabled:cursor-not-allowed"
              >
                Authorize
              </button>
            </div>
          </div>
        )}

        {step.kind === "done" && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-gray-400">Credentials saved.</span>
            <button
              data-id="credentials/close-done"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-sm font-medium bg-sky-600 hover:bg-sky-500 text-white transition-colors"
            >
              Close
            </button>
          </div>
        )}

        {step.kind === "error" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-red-400">{step.message}</p>
            <button
              data-id="credentials/retry"
              onClick={() => { setStep({ kind: "idle" }); setCode(""); }}
              className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {/* Manual paste fallback */}
        <div className="border-t border-gray-800 pt-1 flex flex-col gap-3">
          <button
            data-id="credentials/toggle-paste"
            onClick={() => setShowPaste(!showPaste)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-400 transition-colors w-full text-left"
          >
            {showPaste ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
            Paste credentials file manually
          </button>

          {showPaste && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-gray-500 leading-relaxed">
                Paste the contents of{" "}
                <code className="text-sky-400/80 bg-gray-800 px-1 py-0.5 rounded">~/.claude/.credentials.json</code>.{" "}
                On macOS, credentials are stored in the system keychain and can&apos;t be copied directly — this only works if your machine is running Linux.
              </p>
              <textarea
                data-id="credentials/json-input"
                value={pasteValue}
                onChange={(e) => { setPasteValue(e.target.value); setPasteError(null); setPasteSaved(false); }}
                placeholder={'{\n  "claudeAiOauth": { ... }\n}'}
                rows={5}
                className="w-full bg-gray-800 text-sm text-gray-100 placeholder-gray-600 border border-gray-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500/50 font-mono resize-y"
                autoComplete="off"
                spellCheck={false}
                disabled={pasteLoading}
              />
              {pasteError && <p className="text-xs text-red-400">{pasteError}</p>}
              <div className="flex justify-end">
                <button
                  data-id="credentials/save-paste"
                  onClick={() => void handlePasteSave()}
                  disabled={!pasteValue.trim() || pasteSaved || pasteLoading}
                  className="px-4 py-1.5 rounded-lg text-sm font-medium bg-sky-600 hover:bg-sky-500 disabled:bg-sky-900 text-white transition-colors disabled:cursor-not-allowed"
                >
                  {pasteLoading ? "Saving…" : pasteSaved ? "Saved ✓" : "Save"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
