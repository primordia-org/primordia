"use client";

// app/test-pages/claude-auth-test/page.tsx
//
// Interactive test page for lib/claude-temp-auth.
//
// Steps:
//   1. Click "Start authentication" → the server spawns `claude auth login`
//      in a temp dir and returns the OAuth URL.
//   2. Visit the URL, log in, copy the authorization code.
//   3. Paste the code and click "Submit code".
//   4. The server forwards the code to the waiting claude process, reads
//      .credentials.json, and returns the contents here.
//   5. Copy the credentials JSON and paste it into Primordia's credentials
//      dialog (☰ → Credentials).

import { useState, useCallback } from "react";
import { Copy, Check, ExternalLink, RefreshCw, X } from "lucide-react";
import { withBasePath } from "@/lib/base-path";

// ─── Types ───────────────────────────────────────────────────────────────────

type Step = "idle" | "waiting-for-code" | "submitting" | "done" | "error";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, [text]);
  return { copied, copy };
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const { copied, copy } = useCopy(text);
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
    >
      {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
      {copied ? "Copied!" : label}
    </button>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function ClaudeAuthTestPage() {
  const [step, setStep] = useState<Step>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [credentials, setCredentials] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── Step 1: start ──────────────────────────────────────────────────────────

  async function handleStart() {
    setStep("waiting-for-code");
    setAuthUrl(null);
    setSessionId(null);
    setCredentials(null);
    setErrorMsg(null);
    setCode("");

    try {
      const res = await fetch(withBasePath("/api/claude-auth/start"), { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSessionId(data.sessionId);
      setAuthUrl(data.url);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  }

  // ── Step 2: complete ───────────────────────────────────────────────────────

  async function handleComplete() {
    if (!sessionId || !code.trim()) return;
    setStep("submitting");
    setErrorMsg(null);

    try {
      const res = await fetch(withBasePath("/api/claude-auth/complete"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setCredentials(data.credentials);
      setStep("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  }

  // ── Cancel ─────────────────────────────────────────────────────────────────

  async function handleCancel() {
    if (sessionId) {
      fetch(withBasePath("/api/claude-auth/cancel"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      }).catch(() => {});
    }
    reset();
  }

  function reset() {
    setStep("idle");
    setSessionId(null);
    setAuthUrl(null);
    setCode("");
    setCredentials(null);
    setErrorMsg(null);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold text-gray-100">🔑 Claude Auth Test</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Generates a{" "}
            <code className="font-mono text-gray-400">.credentials.json</code> for Claude Code
            via temporary OAuth session.
          </p>
        </div>
        {step !== "idle" && (
          <button
            onClick={step === "done" ? reset : handleCancel}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
          >
            <RefreshCw size={13} />
            {step === "done" ? "Start over" : "Cancel"}
          </button>
        )}
      </header>

      <main className="flex-1 px-6 py-8 max-w-2xl mx-auto w-full space-y-6">

        {/* ── Step indicator ──────────────────────────────────────────── */}
        <ol className="flex items-center gap-0 text-xs">
          {(["Start", "Visit URL & copy code", "Submit code", "Copy credentials"] as const).map(
            (label, i) => {
              const stepIdx = i + 1;
              const active =
                (stepIdx === 1 && step === "idle") ||
                (stepIdx === 2 && step === "waiting-for-code") ||
                (stepIdx === 3 && step === "submitting") ||
                (stepIdx === 4 && step === "done");
              const done =
                (stepIdx === 1 && step !== "idle") ||
                (stepIdx === 2 && (step === "submitting" || step === "done")) ||
                (stepIdx === 3 && step === "done");
              return (
                <li key={i} className="flex items-center">
                  <span
                    className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold shrink-0 ${
                      done
                        ? "bg-green-600 text-white"
                        : active
                        ? "bg-violet-600 text-white"
                        : "bg-gray-700 text-gray-500"
                    }`}
                  >
                    {done ? "✓" : stepIdx}
                  </span>
                  <span
                    className={`ml-1.5 whitespace-nowrap ${
                      active ? "text-gray-100" : done ? "text-green-400" : "text-gray-600"
                    }`}
                  >
                    {label}
                  </span>
                  {i < 3 && (
                    <span className="mx-2 text-gray-700 select-none">─</span>
                  )}
                </li>
              );
            },
          )}
        </ol>

        {/* ── Error banner ────────────────────────────────────────────── */}
        {step === "error" && errorMsg && (
          <div className="rounded-lg border border-red-700 bg-red-950 px-4 py-3 flex items-start gap-3">
            <X size={15} className="text-red-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-red-300">Error</p>
              <p className="text-xs text-red-400 mt-0.5 break-all">{errorMsg}</p>
            </div>
            <button onClick={reset} className="text-red-500 hover:text-red-300 text-xs shrink-0">
              Retry
            </button>
          </div>
        )}

        {/* ── Step 1: idle — start button ─────────────────────────────── */}
        {step === "idle" && (
          <div className="rounded-xl border border-gray-700 bg-gray-900 px-6 py-8 flex flex-col items-center gap-4 text-center">
            <p className="text-sm text-gray-300 max-w-md">
              Spawns{" "}
              <code className="font-mono text-violet-300">claude auth login</code> in a
              temporary directory. You&apos;ll be given a URL to visit in your browser.
            </p>
            <button
              onClick={handleStart}
              className="px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors"
            >
              Start authentication
            </button>
          </div>
        )}

        {/* ── Waiting for code: show URL + code input ──────────────────── */}
        {(step === "waiting-for-code" || step === "submitting") && (
          <>
            {/* URL card */}
            {authUrl ? (
              <div className="rounded-xl border border-gray-700 bg-gray-900 px-5 py-4 space-y-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  Step 1 — Visit this URL
                </p>
                <div className="flex items-start gap-2">
                  <code className="flex-1 text-xs font-mono text-violet-300 break-all leading-relaxed">
                    {authUrl}
                  </code>
                  <div className="flex gap-2 shrink-0">
                    <CopyButton text={authUrl} label="Copy URL" />
                    <a
                      href={authUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-violet-700 hover:bg-violet-600 text-white transition-colors"
                    >
                      <ExternalLink size={13} />
                      Open
                    </a>
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  Log in with your Anthropic account. After authorizing, copy the code shown in
                  the browser.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-gray-700 bg-gray-900 px-5 py-4 flex items-center gap-3 text-sm text-gray-400">
                <span className="animate-spin text-violet-400">⟳</span>
                Starting claude… waiting for OAuth URL
              </div>
            )}

            {/* Code input */}
            {authUrl && (
              <div className="rounded-xl border border-gray-700 bg-gray-900 px-5 py-4 space-y-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  Step 2 — Paste the authorization code
                </p>
                <textarea
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Paste the code from the browser here…"
                  rows={3}
                  disabled={step === "submitting"}
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:border-violet-500 resize-none disabled:opacity-50"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleComplete}
                    disabled={!code.trim() || step === "submitting"}
                    className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center gap-2"
                  >
                    {step === "submitting" && (
                      <span className="animate-spin text-violet-200">⟳</span>
                    )}
                    {step === "submitting" ? "Submitting…" : "Submit code"}
                  </button>
                  <button
                    onClick={handleCancel}
                    disabled={step === "submitting"}
                    className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-200 text-sm transition-colors flex items-center gap-2"
                  >
                    <X size={14} />
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Done: show credentials ───────────────────────────────────── */}
        {step === "done" && credentials && (
          <div className="rounded-xl border border-green-700 bg-gray-900 px-5 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-green-400 uppercase tracking-wide">
                ✅ .credentials.json
              </p>
              <CopyButton text={credentials} label="Copy JSON" />
            </div>
            <pre className="bg-gray-800 rounded-lg px-4 py-3 text-xs font-mono text-gray-300 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
              {(() => {
                try {
                  return JSON.stringify(JSON.parse(credentials), null, 2);
                } catch {
                  return credentials;
                }
              })()}
            </pre>
            <p className="text-xs text-gray-500">
              Paste this into Primordia via ☰ → <strong className="text-gray-400">Credentials</strong>{" "}
              to use your Claude subscription for agent runs.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
