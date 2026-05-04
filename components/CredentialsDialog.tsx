"use client";

// components/CredentialsDialog.tsx
// Modal dialog that lets users paste their Claude Code credentials.json and
// store it encrypted — using the same AES-256-GCM + server-ciphertext pattern
// as ApiKeyDialog. The plaintext credentials are never stored or transmitted
// unencrypted.

import { useState, useEffect, useCallback } from "react";
import { FileKey, X, ExternalLink } from "lucide-react";
import { hasStoredCredentials, setStoredCredentials } from "../lib/credentials-client";

interface CredentialsDialogProps {
  onClose: () => void;
}

export function CredentialsDialog({ onClose }: CredentialsDialogProps) {
  const [isSet, setIsSet] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsSet(hasStoredCredentials());
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  function validateJson(raw: string): { ok: true; value: string } | { ok: false; error: string } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: "Not valid JSON. Paste the raw contents of credentials.json." };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: "Expected a JSON object. Check you copied the full file." };
    }
    // Re-serialise to normalise whitespace before storing.
    return { ok: true, value: JSON.stringify(parsed) };
  }

  async function handleSave() {
    const trimmed = inputValue.trim();
    if (!trimmed) {
      setError("Paste your credentials.json content above.");
      return;
    }
    const result = validateJson(trimmed);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await setStoredCredentials(result.value);
      setIsSet(true);
      setInputValue("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Failed to save credentials. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleClear() {
    setLoading(true);
    try {
      await setStoredCredentials(null);
      setIsSet(false);
      setInputValue("");
      setError(null);
    } catch {
      setError("Failed to clear credentials. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6 flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sky-400">
            <FileKey size={18} strokeWidth={2} aria-hidden="true" />
            <h2 className="text-base font-semibold">Claude Credentials</h2>
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

        {/* Description */}
        <p className="text-sm text-gray-400 leading-relaxed">
          Paste the contents of your{" "}
          <code className="text-sky-300 bg-gray-800 px-1 py-0.5 rounded text-xs">
            ~/.claude/.credentials.json
          </code>{" "}
          file to use your Claude Code session for evolve requests. The JSON is
          encrypted in your browser — the encryption key never leaves this
          device, and the decrypted credentials are only kept on the server for the duration of the agent run.{" "}
          <a
            href="https://docs.anthropic.com/en/docs/claude-code/getting-started"
            target="_blank"
            rel="noopener noreferrer"
            data-id="credentials/docs-link"
            className="text-sky-400 hover:text-sky-300 underline inline-flex items-center gap-0.5"
          >
            Claude Code docs
            <ExternalLink size={11} strokeWidth={2} className="inline" aria-hidden="true" />
          </a>
        </p>

        {/* Current status */}
        <div className={`px-3 py-2 rounded-lg text-sm border ${
          isSet
            ? "bg-green-900/30 border-green-700/50 text-green-300"
            : "bg-gray-800 border-gray-700 text-gray-400"
        }`}>
          {isSet ? (
            <span>
              <span className="font-medium">Active</span>{" "}
              <span className="text-green-400/70 text-xs">— credentials encrypted on this device</span>
            </span>
          ) : (
            <span>No credentials set</span>
          )}
        </div>

        {/* Textarea */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-gray-400 font-medium">
            {isSet ? "Replace credentials.json" : "Paste credentials.json"}
          </label>
          <textarea
            data-id="credentials/json-input"
            value={inputValue}
            onChange={(e) => { setInputValue(e.target.value); setError(null); setSaved(false); }}
            placeholder={'{\n  "claudeAiOauth": {\n    "accessToken": "...",\n    ...\n  }\n}'}
            rows={7}
            className="w-full bg-gray-800 text-sm text-gray-100 placeholder-gray-600 border border-gray-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500/50 font-mono resize-y"
            autoComplete="off"
            spellCheck={false}
            disabled={loading}
          />
          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-3 pt-1">
          <div>
            {isSet && (
              <button
                data-id="credentials/clear"
                onClick={handleClear}
                disabled={loading}
                className="px-3 py-1.5 rounded-lg text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 border border-red-800/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Clear credentials
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              data-id="credentials/cancel"
              onClick={onClose}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              data-id="credentials/save"
              onClick={handleSave}
              disabled={!inputValue.trim() || saved || loading}
              className="px-4 py-1.5 rounded-lg text-sm font-medium bg-sky-600 hover:bg-sky-500 disabled:bg-sky-900 text-white transition-colors disabled:cursor-not-allowed"
            >
              {loading ? "Saving…" : saved ? "Saved ✓" : "Save credentials"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
