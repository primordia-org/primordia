"use client";

import { useState, useEffect } from "react";
import { Eye, EyeOff, ExternalLink } from "lucide-react";
import {
  hasStoredApiKey, setStoredApiKey,
  hasStoredOpenRouterApiKey, setStoredOpenRouterApiKey,
} from "@/lib/api-key-client";
import { trackEvent } from "@/lib/events-client";

function ComingSoonCard({ monogram, monogramClass, name, description }: {
  monogram: string;
  monogramClass: string;
  name: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-5 opacity-50 select-none">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${monogramClass}`}>
            {monogram}
          </div>
          <span className="text-sm font-medium text-gray-300">{name}</span>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-500 border border-gray-700">
          Coming soon
        </span>
      </div>
      <p className="text-xs text-gray-500 ml-11">{description}</p>
    </div>
  );
}

export default function ApiKeySettingsClient() {
  // Anthropic key state
  const [isKeySet, setIsKeySet] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // OpenRouter key state
  const [isOrKeySet, setIsOrKeySet] = useState(false);
  const [orInputValue, setOrInputValue] = useState("");
  const [orShowKey, setOrShowKey] = useState(false);
  const [orSaved, setOrSaved] = useState(false);
  const [orLoading, setOrLoading] = useState(false);
  const [orError, setOrError] = useState<string | null>(null);

  useEffect(() => {
    setIsKeySet(hasStoredApiKey());
    setIsOrKeySet(hasStoredOpenRouterApiKey());
  }, []);

  async function handleSave() {
    const trimmed = inputValue.trim();
    if (!trimmed) { setError("Please enter an API key."); return; }
    if (!trimmed.startsWith("sk-ant-")) {
      setError('Anthropic API keys start with "sk-ant-". Please double-check your key.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await setStoredApiKey(trimmed);
      trackEvent("settings/api-key-saved/v1", {});
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
      trackEvent("settings/api-key-cleared/v1", {});
      setIsKeySet(false);
      setInputValue("");
      setError(null);
    } catch {
      setError("Failed to clear key. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleOrSave() {
    const trimmed = orInputValue.trim();
    if (!trimmed) { setOrError("Please enter an API key."); return; }
    if (!trimmed.startsWith("sk-or-")) {
      setOrError('OpenRouter API keys start with "sk-or-". Please double-check your key.');
      return;
    }
    setOrError(null);
    setOrLoading(true);
    try {
      await setStoredOpenRouterApiKey(trimmed);
      trackEvent("settings/openrouter-key-saved/v1", {});
      setIsOrKeySet(true);
      setOrInputValue("");
      setOrSaved(true);
      setTimeout(() => setOrSaved(false), 2000);
    } catch {
      setOrError("Failed to save key. Please try again.");
    } finally {
      setOrLoading(false);
    }
  }

  async function handleOrClear() {
    setOrLoading(true);
    try {
      await setStoredOpenRouterApiKey(null);
      trackEvent("settings/openrouter-key-cleared/v1", {});
      setIsOrKeySet(false);
      setOrInputValue("");
      setOrError(null);
    } catch {
      setOrError("Failed to clear key. Please try again.");
    } finally {
      setOrLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-medium text-gray-200 mb-1">API Keys</h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            Connect your own AI provider keys to use them for evolve requests.
            Keys are encrypted in your browser and never stored in plaintext.
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          <span className="px-1.5 py-0.5 rounded bg-sky-900/30 text-sky-400 border border-sky-800/40">Claude.ai</span>
          <span className="text-gray-600">›</span>
          <span className="px-1.5 py-0.5 rounded bg-amber-900/20 text-amber-500/80 border border-amber-800/30 font-medium">Anthropic API key</span>
          <span className="text-gray-600">›</span>
          <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 border border-gray-700">exe.dev gateway</span>
          <span className="text-gray-600 ml-0.5">— highest priority first (Claude models)</span>
        </div>
      </div>

      {/* Anthropic — fully functional */}
      <div className="rounded-xl border border-gray-700 bg-gray-900 p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-400/10 flex items-center justify-center text-sm font-bold text-amber-400 shrink-0">
              A
            </div>
            <div>
              <p className="text-sm font-medium text-gray-200">Anthropic</p>
              <p className="text-xs text-gray-500 mt-0.5">Claude models — overrides the default exe.dev gateway</p>
            </div>
          </div>
          {isKeySet && (
            <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-green-900/40 text-green-400 border border-green-800/50">
              Active
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-400 font-medium">
              {isKeySet ? "Replace key" : "API key"}
            </label>
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              data-id="api-key/anthropic-console"
              className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-0.5 transition-colors"
            >
              Get a key
              <ExternalLink size={10} strokeWidth={2} aria-hidden="true" />
            </a>
          </div>
          <div className="relative">
            <input
              data-id="api-key/key-input"
              type={showKey ? "text" : "password"}
              value={inputValue}
              onChange={(e) => { setInputValue(e.target.value); setError(null); setSaved(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); }}
              placeholder="sk-ant-api03-…"
              className="w-full bg-gray-800 text-sm text-gray-100 placeholder-gray-500 border border-gray-700 rounded-lg px-3 py-2 pr-9 outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 font-mono"
              autoComplete="off"
              spellCheck={false}
              disabled={loading}
            />
            <button
              type="button"
              data-id="api-key/toggle-visibility"
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
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-3">
          <div>
            {isKeySet && (
              <button
                data-id="api-key/clear-key"
                onClick={() => void handleClear()}
                disabled={loading}
                className="px-3 py-1.5 rounded-lg text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 border border-red-800/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Clear key
              </button>
            )}
          </div>
          <button
            data-id="api-key/save-key"
            onClick={() => void handleSave()}
            disabled={!inputValue.trim() || saved || loading}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-amber-600 hover:bg-amber-500 disabled:bg-amber-900 text-white transition-colors disabled:cursor-not-allowed"
          >
            {loading ? "Saving…" : saved ? "Saved ✓" : "Save key"}
          </button>
        </div>
      </div>

      {/* OpenRouter — fully functional */}
      <div className="rounded-xl border border-gray-700 bg-gray-900 p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-violet-400/10 flex items-center justify-center text-sm font-bold text-violet-400 shrink-0">
              OR
            </div>
            <div>
              <p className="text-sm font-medium text-gray-200">OpenRouter</p>
              <p className="text-xs text-gray-500 mt-0.5">Google Gemini, Meta Llama, DeepSeek, Mistral, and 140+ more via the Pi harness</p>
            </div>
          </div>
          {isOrKeySet && (
            <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-green-900/40 text-green-400 border border-green-800/50">
              Active
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-400 font-medium">
              {isOrKeySet ? "Replace key" : "API key"}
            </label>
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noopener noreferrer"
              data-id="api-key/openrouter-console"
              className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-0.5 transition-colors"
            >
              Get a key
              <ExternalLink size={10} strokeWidth={2} aria-hidden="true" />
            </a>
          </div>
          <div className="relative">
            <input
              data-id="api-key/openrouter-key-input"
              type={orShowKey ? "text" : "password"}
              value={orInputValue}
              onChange={(e) => { setOrInputValue(e.target.value); setOrError(null); setOrSaved(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") void handleOrSave(); }}
              placeholder="sk-or-v1-…"
              className="w-full bg-gray-800 text-sm text-gray-100 placeholder-gray-500 border border-gray-700 rounded-lg px-3 py-2 pr-9 outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 font-mono"
              autoComplete="off"
              spellCheck={false}
              disabled={orLoading}
            />
            <button
              type="button"
              data-id="api-key/openrouter-toggle-visibility"
              onClick={() => setOrShowKey((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
              aria-label={orShowKey ? "Hide key" : "Show key"}
            >
              {orShowKey
                ? <EyeOff size={15} strokeWidth={2} aria-hidden="true" />
                : <Eye size={15} strokeWidth={2} aria-hidden="true" />
              }
            </button>
          </div>
          {orError && <p className="text-xs text-red-400">{orError}</p>}
        </div>

        <div className="flex items-center justify-between gap-3">
          <div>
            {isOrKeySet && (
              <button
                data-id="api-key/openrouter-clear-key"
                onClick={() => void handleOrClear()}
                disabled={orLoading}
                className="px-3 py-1.5 rounded-lg text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 border border-red-800/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Clear key
              </button>
            )}
          </div>
          <button
            data-id="api-key/openrouter-save-key"
            onClick={() => void handleOrSave()}
            disabled={!orInputValue.trim() || orSaved || orLoading}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-violet-700 hover:bg-violet-600 disabled:bg-violet-900 text-white transition-colors disabled:cursor-not-allowed"
          >
            {orLoading ? "Saving…" : orSaved ? "Saved ✓" : "Save key"}
          </button>
        </div>
      </div>

      {/* Coming-soon providers */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ComingSoonCard
          monogram="O"
          monogramClass="bg-emerald-400/10 text-emerald-400"
          name="OpenAI"
          description="GPT-4o and other OpenAI models."
        />
        <ComingSoonCard
          monogram="G"
          monogramClass="bg-blue-400/10 text-blue-400"
          name="Google Gemini"
          description="Gemini 2.0 Flash, Pro, and Ultra."
        />
      </div>
    </div>
  );
}
