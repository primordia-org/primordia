"use client";

import { useState, useEffect, useRef } from "react";
import { Check, ChevronDown, ChevronRight, Copy, ExternalLink, Loader2, Key, EyeOff } from "lucide-react";
import { AuthSourceIcon } from "@/components/AgentIdentity";
import { setStoredCredentials } from "@/lib/credentials-client";
import { getSecret } from "@/lib/secrets-client";
import { withBasePath } from "@/lib/base-path";
import { trackEvent } from "@/lib/events-client";
import { useDecryptEffect, generateScramble } from "@/lib/use-decrypt-effect";

type Step =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "awaiting-code"; sessionId: string; url: string }
  | { kind: "submitting" }
  | { kind: "done" }
  | { kind: "error"; message: string };

export default function CredentialsSettingsClient() {
  const [isSet, setIsSet] = useState(false);
  const [storedValue, setStoredValue] = useState<string | null>(null);
  const [credRevealed, setCredRevealed] = useState(false);
  const [credScrambled, setCredScrambled] = useState("");
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [code, setCode] = useState("");
  const [pasteValue, setPasteValue] = useState("");
  const [credsDirty, setCredsDirty] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [pasteSaved, setPasteSaved] = useState(false);
  const [pasteLoading, setPasteLoading] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [copiedCredentials, setCopiedCredentials] = useState(false);
  const sessionIdRef = useRef<string | null>(null);

  const { displayValue: decryptDisplay, isDecrypting, decrypt } = useDecryptEffect({
    duration: 1000,
    onComplete: () => setCredRevealed(true),
  });

  function prettyCredentials(): string {
    if (!storedValue) return "";
    try {
      return JSON.stringify(JSON.parse(storedValue), null, 2);
    } catch {
      return storedValue;
    }
  }

  useEffect(() => {
    async function checkStatus() {
      try {
        const res = await fetch(withBasePath('/api/secrets/CLAUDE_CODE_CREDENTIALS_JSON'));
        if (res.ok) {
          const data = (await res.json()) as { ciphertext: string | null };
          if (data.ciphertext) {
            setIsSet(true);
            const val = await getSecret('CLAUDE_CODE_CREDENTIALS_JSON');
            setStoredValue(val);
          }
        }
      } catch {}
    }
    void checkStatus();
  }, []);

  // When storedValue loads or changes, regenerate the scrambled display
  useEffect(() => {
    if (storedValue) {
      const pretty = (() => {
        try { return JSON.stringify(JSON.parse(storedValue), null, 2); } catch { return storedValue; }
      })();
      setCredScrambled(generateScramble(pretty));
      setCredRevealed(false);
      setCredsDirty(false);
      setPasteValue("");
    }
  }, [storedValue]);

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
      setStoredValue(credentials);
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

  async function copyCredentials() {
    try {
      await navigator.clipboard.writeText(prettyCredentials());
      setCopiedCredentials(true);
      setTimeout(() => setCopiedCredentials(false), 2000);
    } catch {}
  }

  async function clearCredentials() {
    try {
      await setStoredCredentials(null);
      trackEvent("settings/credentials-cleared/v1", {});
      setIsSet(false);
      setStoredValue(null);
      setCredRevealed(false);
      setCredScrambled("");
      setCredsDirty(false);
      setPasteValue("");
      setStep({ kind: "idle" });
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
      setStoredValue(result.value);
      setPasteSaved(true);
      setStep({ kind: "done" });
      setTimeout(() => setPasteSaved(false), 2000);
    } catch {
      setPasteError("Failed to save credentials. Please try again.");
    } finally {
      setPasteLoading(false);
    }
  }

  const storedCredentialsDisplay = isDecrypting
    ? decryptDisplay
    : credRevealed
    ? prettyCredentials()
    : credScrambled;
  const showStoredCredentials = isDecrypting || credRevealed;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-medium text-gray-200 mb-1">Claude.ai Subscription</h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            Sign in with your Claude.ai account to use your subscription for evolve requests.
            Credentials are encrypted in your browser — the encryption key never leaves your device(s).
          </p>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed">
          Saved subscription credentials become billing sources you can choose explicitly in Evolve presets.
        </p>
      </div>

      {/* Main card */}
      <div className="rounded-xl border border-gray-700 bg-gray-900 p-5 flex flex-col gap-5">
        {/* Card header with status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center shrink-0">
              <AuthSourceIcon source="claude-subscription" size={20} />
            </div>
            <p className="text-sm font-medium text-gray-200">Claude.ai</p>
          </div>
          {isSet && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/40 text-green-400 border border-green-800/50">
              Active
            </span>
          )}
        </div>

        {isSet && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-gray-400 font-medium">Stored credentials</span>
              <div className="flex items-center gap-3">
                {credRevealed && (
                  <button
                    type="button"
                    data-id="credentials/copy"
                    onClick={() => void copyCredentials()}
                    className="flex items-center gap-1 text-xs text-sky-500/70 hover:text-sky-400 transition-colors"
                    aria-label="Copy credentials"
                  >
                    {copiedCredentials ? <Check size={13} strokeWidth={2} aria-hidden="true" /> : <Copy size={13} strokeWidth={2} aria-hidden="true" />}
                    <span>{copiedCredentials ? "Copied" : "Copy"}</span>
                  </button>
                )}
                <button
                  type="button"
                  data-id="credentials/toggle-visibility"
                  onClick={() => {
                    if (credRevealed) {
                      setCredRevealed(false);
                      setPasteError(null);
                      if (storedValue) {
                        const pretty = (() => { try { return JSON.stringify(JSON.parse(storedValue), null, 2); } catch { return storedValue; } })();
                        setCredScrambled(generateScramble(pretty));
                      }
                    } else if (!isDecrypting) {
                      decrypt(prettyCredentials());
                    }
                  }}
                  disabled={isDecrypting}
                  className="flex items-center gap-1 text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label={credRevealed ? "Hide credentials" : "Reveal credentials"}
                >
                  {credRevealed ? (
                    <><EyeOff size={13} strokeWidth={2} aria-hidden="true" className="text-gray-500 hover:text-gray-300 transition-colors" /><span className="text-gray-500 hover:text-gray-300 transition-colors">Hide</span></>
                  ) : (
                    <><Key size={13} strokeWidth={2} aria-hidden="true" className={isDecrypting ? "text-sky-400 animate-pulse" : "text-sky-500/70 hover:text-sky-400 transition-colors"} /><span className={isDecrypting ? "text-sky-400" : "text-sky-500/70 hover:text-sky-400 transition-colors"}>Reveal</span></>
                  )}
                </button>
              </div>
            </div>
            {showStoredCredentials && (
              <textarea
                data-id="credentials/json-display"
                value={storedCredentialsDisplay}
                readOnly
                rows={8}
                className={`w-full bg-gray-800 text-sm border border-gray-700 rounded-lg px-3 py-2 outline-none font-mono resize-y ${
                  credRevealed
                    ? "text-gray-100"
                    : "text-sky-300/40 select-none cursor-default"
                }`}
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </div>
        )}

        {/* OAuth flow */}
        {(step.kind === "idle" || step.kind === "done") && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              {isSet && (
                <button
                  data-id="credentials/clear"
                  onClick={() => void clearCredentials()}
                  className="px-3 py-1.5 rounded-lg text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 border border-red-800/50 transition-colors"
                >
                  Clear
                </button>
              )}
              <button
                data-id="credentials/start-auth"
                onClick={() => void startAuth()}
                className={`${isSet ? "flex-1" : "w-full"} px-4 py-2 rounded-lg text-sm font-medium bg-sky-600 hover:bg-sky-500 text-white transition-colors`}
              >
                {isSet ? "Sign in again" : "Sign in with Claude.ai"}
              </button>
            </div>
            {step.kind === "done" && (
              <p className="text-xs text-center text-gray-500">Credentials saved successfully.</p>
            )}
          </div>
        )}

        {(step.kind === "idle" || step.kind === "done") && (
          <div className="border-t border-gray-800 pt-3 flex flex-col gap-3">
            <button
              type="button"
              data-id="credentials/manual-toggle"
              onClick={() => setManualOpen((open) => !open)}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-400 transition-colors w-full text-left"
            >
              {manualOpen ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
              <span>Paste credentials file manually</span>
            </button>
            {manualOpen && (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-gray-500 leading-relaxed">
                  Paste the contents of <code className="text-sky-400/80 bg-gray-800 px-1 py-0.5 rounded">~/.claude/.credentials.json</code>. On macOS, credentials are stored in the system keychain and can&apos;t be copied directly — this only works if your machine is running Linux.
                </p>
                <textarea
                  data-id="credentials/json-input"
                  value={pasteValue}
                  onChange={(e) => {
                    setPasteValue(e.target.value);
                    setCredsDirty(true);
                    setPasteError(null);
                    setPasteSaved(false);
                  }}
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
      </div>
    </div>
  );
}
