"use client";

// components/ApiKeyDialog.tsx
// Modal dialog that lets users set or clear their personal Anthropic API key.
//
// The key is encrypted with a browser-generated AES-256-GCM key that stays in
// localStorage on this device. The AES-encrypted ciphertext is stored on the
// server, bound to the authenticated user. The plaintext key is never stored
// anywhere and never transmitted in plaintext.

import { useState, useEffect, useCallback } from "react";
import { Key, X, Eye, EyeOff, ExternalLink } from "lucide-react";
import { hasStoredApiKey, setStoredApiKey } from "../lib/api-key-client";

interface ApiKeyDialogProps {
  onClose: () => void;
}

export function ApiKeyDialog({ onClose }: ApiKeyDialogProps) {
  const [isKeySet, setIsKeySet] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check whether a key is configured on this device.
  useEffect(() => {
    setIsKeySet(hasStoredApiKey());
  }, []);

  // Close on Escape key.
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  async function handleSave() {
    const trimmed = inputValue.trim();
    if (!trimmed) {
      setError("Please enter an API key.");
      return;
    }
    if (!trimmed.startsWith("sk-ant-")) {
      setError('Anthropic API keys start with "sk-ant-". Please double-check your key.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await setStoredApiKey(trimmed);
      setIsKeySet(true);
      setInputValue("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Failed to save key. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleClear() {
    setLoading(true);
    try {
      await setStoredApiKey(null);
      setIsKeySet(false);
      setInputValue("");
      setError(null);
    } catch {
      setError("Failed to clear key. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-400">
            <Key size={18} strokeWidth={2} aria-hidden="true" />
            <h2 className="text-base font-semibold">API Key</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-200 transition-colors"
            aria-label="Close"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {/* Description */}
        <p className="text-sm text-gray-400 leading-relaxed">
          Optionally override the exe.dev LLM gateway with your own{" "}
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-400 hover:text-amber-300 underline inline-flex items-center gap-0.5"
          >
            Anthropic API key
            <ExternalLink size={11} strokeWidth={2} className="inline" aria-hidden="true" />
          </a>
          . The key is encrypted in your browser — the encryption key never leaves
          this device, and the plaintext key is never stored or transmitted.
        </p>

        {/* Current status */}
        <div className={`px-3 py-2 rounded-lg text-sm border ${
          isKeySet
            ? "bg-green-900/30 border-green-700/50 text-green-300"
            : "bg-gray-800 border-gray-700 text-gray-400"
        }`}>
          {isKeySet ? (
            <span>
              <span className="font-medium">Active</span>{" "}
              <span className="text-green-400/70 text-xs">— key encrypted on this device</span>
            </span>
          ) : (
            <span>No API key set — using exe.dev gateway</span>
          )}
        </div>

        {/* Input */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-gray-400 font-medium">
            {isKeySet ? "Replace key" : "Enter your API key"}
          </label>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={inputValue}
              onChange={(e) => { setInputValue(e.target.value); setError(null); setSaved(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
              placeholder="sk-ant-api03-…"
              className="w-full bg-gray-800 text-sm text-gray-100 placeholder-gray-500 border border-gray-700 rounded-lg px-3 py-2 pr-9 outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 font-mono"
              autoComplete="off"
              spellCheck={false}
              disabled={loading}
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
              aria-label={showKey ? "Hide key" : "Show key"}
            >
              {showKey
                ? <EyeOff size={15} strokeWidth={2} aria-hidden="true" />
                : <Eye size={15} strokeWidth={2} aria-hidden="true" />
              }
            </button>
          </div>
          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-3 pt-1">
          <div>
            {isKeySet && (
              <button
                onClick={handleClear}
                disabled={loading}
                className="px-3 py-1.5 rounded-lg text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 border border-red-800/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Clear key
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!inputValue.trim() || saved || loading}
              className="px-4 py-1.5 rounded-lg text-sm font-medium bg-amber-600 hover:bg-amber-500 disabled:bg-amber-900 text-white transition-colors disabled:cursor-not-allowed"
            >
              {loading ? "Saving…" : saved ? "Saved ✓" : "Save key"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
