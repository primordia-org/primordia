"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCircle2, Copy, ExternalLink, Eye, EyeOff } from "lucide-react";
import { getSecret, setSecret, clearSecret } from "@/lib/secrets-client";
import { withBasePath } from "@/lib/base-path";
import { trackEvent } from "@/lib/events-client";

interface StoredChatGptCredentials {
  authMode: "chatgpt";
  issuer: string;
  clientId: string;
  tokens: {
    idToken: string;
    accessToken: string;
    refreshToken: string;
    accountId: string | null;
    accessTokenExpiresAt: number | null;
  };
  lastRefresh: string;
}

interface DeviceFlowState {
  verificationUrl: string;
  userCode: string;
  deviceAuthId: string;
  interval: number;
}

function parseCredentials(raw: string | null): StoredChatGptCredentials | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredChatGptCredentials;
    if (parsed?.authMode !== "chatgpt") return null;
    return parsed;
  } catch {
    return null;
  }
}

function formatDate(value: string | number | null | undefined): string {
  if (!value) return "Unknown";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "Unknown";
  }
}

export default function ChatGptSubscriptionSettingsClient() {
  const [credentials, setCredentials] = useState<StoredChatGptCredentials | null>(null);
  const [showCredentials, setShowCredentials] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deviceFlow, setDeviceFlow] = useState<DeviceFlowState | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const pollTimer = useRef<number | null>(null);

  const prettyCredentials = useMemo(() => {
    if (!credentials) return "";
    return JSON.stringify(credentials, null, 2);
  }, [credentials]);

  const loadCredentials = useCallback(async () => {
    try {
      const raw = await getSecret("CHATGPT_SUBSCRIPTION_OAUTH");
      setCredentials(parseCredentials(raw));
    } catch {
      setCredentials(null);
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void loadCredentials();
    }, 0);
    return () => {
      window.clearTimeout(id);
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    };
  }, [loadCredentials]);

  async function startAuth() {
    setBusy(true);
    setError(null);
    setDeviceFlow(null);
    setCodeCopied(false);
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
    try {
      const res = await fetch(withBasePath("/api/oauth/chatgpt-subscription"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to start ChatGPT authentication.");
      const next: DeviceFlowState = {
        verificationUrl: data.verificationUrl,
        userCode: data.userCode,
        deviceAuthId: data.deviceAuthId,
        interval: data.interval,
      };
      setDeviceFlow(next);
      trackEvent("settings/subscriptions/chatgpt-started/v1", {});
      pollChatGpt(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start ChatGPT authentication.");
    } finally {
      setBusy(false);
    }
  }

  async function pollChatGpt(flow: DeviceFlowState) {
    try {
      const res = await fetch(withBasePath("/api/oauth/chatgpt-subscription"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete", deviceAuthId: flow.deviceAuthId, userCode: flow.userCode }),
      });
      const data = await res.json();
      if (res.ok && data.status === "connected") {
        const value = JSON.stringify(data.credentials);
        await setSecret("CHATGPT_SUBSCRIPTION_OAUTH", value);
        setCredentials(parseCredentials(value));
        setDeviceFlow(null);
        setCodeCopied(false);
        trackEvent("settings/subscriptions/chatgpt-connected/v1", {});
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "ChatGPT authentication failed.");
      pollTimer.current = window.setTimeout(() => pollChatGpt(flow), Math.max(flow.interval, 3) * 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ChatGPT authentication failed.");
      setDeviceFlow(null);
      setCodeCopied(false);
    }
  }

  async function copyUserCode() {
    if (!deviceFlow) return;
    try {
      await navigator.clipboard.writeText(deviceFlow.userCode);
      setCodeCopied(true);
      window.setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      setError("Could not copy the code. Please copy it manually.");
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
    try {
      await clearSecret("CHATGPT_SUBSCRIPTION_OAUTH");
      setCredentials(null);
      setDeviceFlow(null);
      setCodeCopied(false);
      setShowCredentials(false);
      trackEvent("settings/subscriptions/chatgpt-disconnected/v1", {});
    } catch {
      setError("Failed to disconnect ChatGPT. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900 p-5 flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-400/10 flex items-center justify-center text-sm font-bold text-emerald-400 shrink-0">
            G
          </div>
          <div>
            <p className="text-sm font-medium text-gray-200">ChatGPT</p>
            <p className="text-xs text-gray-500 mt-0.5">Subscription OAuth via device-code sign-in</p>
          </div>
        </div>
        {credentials && (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-900/40 text-green-400 border border-green-800/50">
            <CheckCircle2 size={12} aria-hidden="true" /> Active
          </span>
        )}
      </div>

      <p className="text-sm text-gray-400 leading-relaxed">
        Sign in with your ChatGPT subscription using the Codex device-code OAuth flow. Primordia stores the returned OAuth credentials directly; no Codex or OpenAI CLI process is spawned.
      </p>

      {credentials && (
        <div className="flex flex-col gap-2 rounded-lg border border-gray-800 bg-gray-950/60 p-3 text-xs text-gray-400">
          <p><span className="text-gray-500">Account:</span> {credentials.tokens.accountId ?? "Unknown"}</p>
          <p><span className="text-gray-500">Last refreshed:</span> {formatDate(credentials.lastRefresh)}</p>
          <p><span className="text-gray-500">Access token expires:</span> {formatDate(credentials.tokens.accessTokenExpiresAt)}</p>
          <button
            type="button"
            data-id="chatgpt-subscription/toggle-visibility"
            onClick={() => setShowCredentials((v) => !v)}
            className="mt-1 flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors self-start"
            aria-label={showCredentials ? "Hide stored ChatGPT credentials" : "Show stored ChatGPT credentials"}
          >
            {showCredentials ? <EyeOff size={13} aria-hidden="true" /> : <Eye size={13} aria-hidden="true" />}
            {showCredentials ? "Hide OAuth credentials" : "Show OAuth credentials"}
          </button>
          {showCredentials && (
            <pre className="text-xs font-mono text-gray-300 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
              {prettyCredentials}
            </pre>
          )}
        </div>
      )}

      {deviceFlow && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-gray-400 font-medium" htmlFor="chatgpt-device-code">
              One-time code
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div
                id="chatgpt-device-code"
                className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 font-mono text-lg font-semibold tracking-widest text-gray-100"
              >
                {deviceFlow.userCode}
              </div>
              <button
                type="button"
                data-id="chatgpt-subscription/copy-code"
                onClick={() => void copyUserCode()}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 transition-colors hover:border-emerald-700 hover:text-emerald-300"
              >
                {codeCopied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                {codeCopied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          <a
            href={deviceFlow.verificationUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-emerald-400 transition-colors hover:border-emerald-700 hover:text-emerald-300"
          >
            <span>Open verification page</span>
            <ExternalLink size={14} className="shrink-0" aria-hidden="true" />
          </a>

          <p className="text-xs text-gray-500">Paste the code on the verification page. Primordia will connect automatically after you authorize ChatGPT.</p>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex items-center gap-2">
        {credentials && (
          <button
            data-id="chatgpt-subscription/disconnect"
            onClick={() => void disconnect()}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 border border-red-800/50 transition-colors disabled:opacity-60"
          >
            Disconnect
          </button>
        )}
        <button
          data-id="chatgpt-subscription/start-auth"
          onClick={() => void startAuth()}
          disabled={busy || Boolean(deviceFlow)}
          className={`${credentials ? "flex-1" : "w-full"} px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-900 text-white transition-colors disabled:cursor-not-allowed`}
        >
          {busy ? "Starting…" : credentials ? "Sign in again" : "Sign in with ChatGPT"}
        </button>
      </div>
    </div>
  );
}
