"use client";

import { useState, useEffect } from "react";
import { Check, Copy, Key, EyeOff, ExternalLink } from "lucide-react";
import {
  setStoredApiKey,
  setStoredOpenRouterApiKey,
} from "@/lib/api-key-client";
import { getSecret } from "@/lib/secrets-client";
import { withBasePath } from "@/lib/base-path";
import { trackEvent } from "@/lib/events-client";
import { useDecryptEffect } from "@/lib/use-decrypt-effect";
import { AuthSourceIcon } from "@/components/AgentIdentity";

function ComingSoonCard({ source, name, description }: {
  source: "openai-api-key";
  name: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-5 opacity-50 select-none">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center shrink-0">
            <AuthSourceIcon source={source} size={20} />
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

export default function ApiKeySettingsClient({
  hideHeader = false,
  provider = "all",
}: {
  hideHeader?: boolean;
  provider?: "all" | "anthropic" | "openrouter";
} = {}) {
  // Anthropic key state
  const [isKeySet, setIsKeySet] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [keyDirty, setKeyDirty] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  // OpenRouter key state
  const [isOrKeySet, setIsOrKeySet] = useState(false);
  const [orInputValue, setOrInputValue] = useState("");
  const [orKeyDirty, setOrKeyDirty] = useState(false);
  const [orShowKey, setOrShowKey] = useState(false);
  const [orSaved, setOrSaved] = useState(false);
  const [orLoading, setOrLoading] = useState(false);
  const [orError, setOrError] = useState<string | null>(null);
  const [orCopiedKey, setOrCopiedKey] = useState(false);

  const { displayValue: decryptDisplay, isDecrypting, decrypt } = useDecryptEffect({
    duration: 1000,
    onComplete: () => setShowKey(true),
  });
  const { displayValue: orDecryptDisplay, isDecrypting: orIsDecrypting, decrypt: orDecrypt } = useDecryptEffect({
    duration: 1000,
    onComplete: () => setOrShowKey(true),
  });

  useEffect(() => {
    async function check() {
      try {
        const res = await fetch(withBasePath('/api/secrets'));
        if (!res.ok) return;
        const { types } = (await res.json()) as { types: string[] };
        if (types.includes('ANTHROPIC_API_KEY')) {
          setIsKeySet(true);
          const val = await getSecret('ANTHROPIC_API_KEY');
          if (val) { setInputValue(val); setKeyDirty(false); }
        }
        if (types.includes('OPENROUTER_API_KEY')) {
          setIsOrKeySet(true);
          const val = await getSecret('OPENROUTER_API_KEY');
          if (val) { setOrInputValue(val); setOrKeyDirty(false); }
        }
      } catch {}
    }
    void check();
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
      setKeyDirty(false);
      setShowKey(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Failed to save key. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function copyKey(value: string, setter: (copied: boolean) => void) {
    try {
      await navigator.clipboard.writeText(value);
      setter(true);
      setTimeout(() => setter(false), 2000);
    } catch {}
  }

  async function handleClear() {
    setLoading(true);
    try {
      await setStoredApiKey(null);
      trackEvent("settings/api-key-cleared/v1", {});
      setIsKeySet(false);
      setInputValue("");
      setKeyDirty(false);
      setShowKey(false);
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
      setOrKeyDirty(false);
      setOrShowKey(false);
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
      setOrKeyDirty(false);
      setOrShowKey(false);
      setOrError(null);
    } catch {
      setOrError("Failed to clear key. Please try again.");
    } finally {
      setOrLoading(false);
    }
  }

  const showKeyInput = !isKeySet || showKey || isDecrypting;
  const showOrKeyInput = !isOrKeySet || orShowKey || orIsDecrypting;

  return (
    <div className="flex flex-col gap-6">
      {!hideHeader && (
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-base font-medium text-gray-200 mb-1">API Keys</h2>
            <p className="text-sm text-gray-400 leading-relaxed">
              Connect your own AI provider keys to use them for evolve requests.
              Keys are encrypted in your browser and never stored in plaintext.
            </p>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            Saved keys become billing sources you can choose explicitly in Evolve presets.
          </p>
        </div>
      )}

      {/* Anthropic — fully functional */}
      {(provider === "all" || provider === "anthropic") && (
      <div className="rounded-xl border border-gray-700 bg-gray-900 p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center shrink-0">
              <AuthSourceIcon source="anthropic-api-key" size={20} />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-200">Anthropic</p>
              <p className="text-xs text-gray-500 mt-0.5">Claude models — selectable from Evolve presets</p>
            </div>
          </div>
          {isKeySet && (
            <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-green-900/40 text-green-400 border border-green-800/50">
              Active
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs text-gray-400 font-medium">
              {isKeySet ? "Stored API key" : "API key"}
            </label>
            <div className="flex items-center gap-3">
              {showKey && (
                <button
                  type="button"
                  data-id="api-key/copy-key"
                  onClick={() => void copyKey(inputValue, setCopiedKey)}
                  className="flex items-center gap-1 text-xs text-amber-500/70 hover:text-amber-400 transition-colors"
                  aria-label="Copy API key"
                >
                  {copiedKey ? <Check size={13} strokeWidth={2} aria-hidden="true" /> : <Copy size={13} strokeWidth={2} aria-hidden="true" />}
                  <span>{copiedKey ? "Copied" : "Copy"}</span>
                </button>
              )}
              {isKeySet && (
                <button
                  type="button"
                  data-id="api-key/toggle-visibility"
                  onClick={() => {
                    if (showKey) {
                      setShowKey(false);
                    } else if (!isDecrypting) {
                      decrypt(inputValue);
                    }
                  }}
                  disabled={isDecrypting}
                  className="flex items-center gap-1 text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label={showKey ? "Hide key" : "Reveal key"}
                >
                  {showKey ? (
                    <><EyeOff size={13} strokeWidth={2} aria-hidden="true" className="text-gray-500 hover:text-gray-300 transition-colors" /><span className="text-gray-500 hover:text-gray-300 transition-colors">Hide</span></>
                  ) : (
                    <><Key size={13} strokeWidth={2} aria-hidden="true" className={isDecrypting ? "text-amber-400 animate-pulse" : "text-amber-500/70 hover:text-amber-400 transition-colors"} /><span className={isDecrypting ? "text-amber-400" : "text-amber-500/70 hover:text-amber-400 transition-colors"}>Reveal</span></>
                  )}
                </button>
              )}
              {!isKeySet && (
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
              )}
            </div>
          </div>
          {showKeyInput && (
            <input
              data-id="api-key/key-input"
              type={showKey || isDecrypting ? "text" : "password"}
              value={isDecrypting ? decryptDisplay : inputValue}
              readOnly={isDecrypting}
              onChange={(e) => { setInputValue(e.target.value); setKeyDirty(true); setError(null); setSaved(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); }}
              placeholder="sk-ant-api03-…"
              className={`w-full sm:w-96 max-w-full bg-gray-800 text-sm placeholder-gray-500 border border-gray-700 rounded-lg px-3 py-2 outline-none font-mono ${
                isDecrypting
                  ? "text-amber-300/50 select-none cursor-default"
                  : "text-gray-100 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50"
              }`}
              autoComplete="off"
              spellCheck={false}
              disabled={loading}
            />
          )}
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
            disabled={!inputValue.trim() || !keyDirty || saved || loading}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-amber-600 hover:bg-amber-500 disabled:bg-amber-900 text-white transition-colors disabled:cursor-not-allowed"
          >
            {loading ? "Saving…" : saved ? "Saved ✓" : "Save key"}
          </button>
        </div>
      </div>
      )}

      {/* OpenRouter — fully functional */}
      {(provider === "all" || provider === "openrouter") && (
      <div className="rounded-xl border border-gray-700 bg-gray-900 p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center shrink-0">
              <AuthSourceIcon source="openrouter-api-key" size={20} />
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
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs text-gray-400 font-medium">
              {isOrKeySet ? "Stored API key" : "API key"}
            </label>
            <div className="flex items-center gap-3">
              {orShowKey && (
                <button
                  type="button"
                  data-id="api-key/openrouter-copy-key"
                  onClick={() => void copyKey(orInputValue, setOrCopiedKey)}
                  className="flex items-center gap-1 text-xs text-violet-500/70 hover:text-violet-400 transition-colors"
                  aria-label="Copy OpenRouter API key"
                >
                  {orCopiedKey ? <Check size={13} strokeWidth={2} aria-hidden="true" /> : <Copy size={13} strokeWidth={2} aria-hidden="true" />}
                  <span>{orCopiedKey ? "Copied" : "Copy"}</span>
                </button>
              )}
              {isOrKeySet && (
                <button
                  type="button"
                  data-id="api-key/openrouter-toggle-visibility"
                  onClick={() => {
                    if (orShowKey) {
                      setOrShowKey(false);
                    } else if (!orIsDecrypting) {
                      orDecrypt(orInputValue);
                    }
                  }}
                  disabled={orIsDecrypting}
                  className="flex items-center gap-1 text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label={orShowKey ? "Hide key" : "Reveal key"}
                >
                  {orShowKey ? (
                    <><EyeOff size={13} strokeWidth={2} aria-hidden="true" className="text-gray-500 hover:text-gray-300 transition-colors" /><span className="text-gray-500 hover:text-gray-300 transition-colors">Hide</span></>
                  ) : (
                    <><Key size={13} strokeWidth={2} aria-hidden="true" className={orIsDecrypting ? "text-violet-400 animate-pulse" : "text-violet-500/70 hover:text-violet-400 transition-colors"} /><span className={orIsDecrypting ? "text-violet-400" : "text-violet-500/70 hover:text-violet-400 transition-colors"}>Reveal</span></>
                  )}
                </button>
              )}
              {!isOrKeySet && (
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
              )}
            </div>
          </div>
          {showOrKeyInput && (
            <input
              data-id="api-key/openrouter-key-input"
              type={orShowKey || orIsDecrypting ? "text" : "password"}
              value={orIsDecrypting ? orDecryptDisplay : orInputValue}
              readOnly={orIsDecrypting}
              onChange={(e) => { setOrInputValue(e.target.value); setOrKeyDirty(true); setOrError(null); setOrSaved(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") void handleOrSave(); }}
              placeholder="sk-or-v1-…"
              className={`w-full sm:w-96 max-w-full bg-gray-800 text-sm placeholder-gray-500 border border-gray-700 rounded-lg px-3 py-2 outline-none font-mono ${
                orIsDecrypting
                  ? "text-violet-300/50 select-none cursor-default"
                  : "text-gray-100 focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50"
              }`}
              autoComplete="off"
              spellCheck={false}
              disabled={orLoading}
            />
          )}
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
            disabled={!orInputValue.trim() || !orKeyDirty || orSaved || orLoading}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-violet-700 hover:bg-violet-600 disabled:bg-violet-900 text-white transition-colors disabled:cursor-not-allowed"
          >
            {orLoading ? "Saving…" : orSaved ? "Saved ✓" : "Save key"}
          </button>
        </div>
      </div>
      )}

      {/* Coming-soon providers */}
      {provider === "all" && (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ComingSoonCard
          source="openai-api-key"
          name="OpenAI"
          description="GPT-4o and other OpenAI models."
        />
      </div>
      )}
    </div>
  );
}
