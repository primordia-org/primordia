"use client";

// app/login/page.tsx — Login and registration page using WebAuthn passkeys.
// Uses @simplewebauthn/browser for the browser-side ceremony.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"register" | "login" | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleRegister() {
    if (!username.trim()) {
      setError("Please enter a username.");
      return;
    }
    setError(null);
    setSuccess(null);
    setLoading("register");
    try {
      const startRes = await fetch("/api/auth/passkey/register/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const startData = (await startRes.json()) as {
        options?: unknown;
        error?: string;
      };
      if (!startRes.ok) {
        setError(startData.error ?? "Failed to start registration.");
        return;
      }

      const attResp = await startRegistration({
        optionsJSON: startData.options as Parameters<
          typeof startRegistration
        >[0]["optionsJSON"],
      });

      const finishRes = await fetch("/api/auth/passkey/register/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attResp),
      });
      const finishData = (await finishRes.json()) as {
        ok?: boolean;
        username?: string;
        error?: string;
      };
      if (!finishRes.ok) {
        setError(finishData.error ?? "Registration failed.");
        return;
      }

      setSuccess(`Welcome, ${finishData.username}! Redirecting\u2026`);
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  async function handleLogin() {
    setError(null);
    setSuccess(null);
    setLoading("login");
    try {
      const startRes = await fetch("/api/auth/passkey/login/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username || undefined }),
      });
      const startData = (await startRes.json()) as {
        options?: unknown;
        error?: string;
      };
      if (!startRes.ok) {
        setError(startData.error ?? "Failed to start sign-in.");
        return;
      }

      const authResp = await startAuthentication({
        optionsJSON: startData.options as Parameters<
          typeof startAuthentication
        >[0]["optionsJSON"],
      });

      const finishRes = await fetch("/api/auth/passkey/login/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authResp),
      });
      const finishData = (await finishRes.json()) as {
        ok?: boolean;
        username?: string;
        error?: string;
      };
      if (!finishRes.ok) {
        setError(finishData.error ?? "Sign-in failed.");
        return;
      }

      setSuccess(`Welcome back, ${finishData.username}! Redirecting\u2026`);
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  const isLoading = !!loading;

  return (
    <main className="flex flex-col items-center justify-center min-h-dvh px-4 py-12 bg-gray-950">
      <div className="w-full max-w-sm space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Sign in to Primordia
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Use a passkey &mdash; Face ID, Touch ID, or your device PIN.
          </p>
        </div>

        {/* Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          {/* Username */}
          <div>
            <label
              htmlFor="username"
              className="block text-sm text-gray-300 mb-1.5"
            >
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleLogin();
              }}
              placeholder="your-name"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={isLoading}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 outline-none focus:border-blue-500 transition-colors disabled:opacity-60"
            />
            <p className="text-xs text-gray-500 mt-1">
              Leave blank to use a saved passkey without typing.
            </p>
          </div>

          {/* Error / success */}
          {error && (
            <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          {success && (
            <p className="text-sm text-green-400 bg-green-900/20 border border-green-800/30 rounded-lg px-3 py-2">
              {success}
            </p>
          )}

          {/* Buttons */}
          <div className="space-y-2 pt-1">
            {/* Sign in */}
            <button
              type="button"
              onClick={handleLogin}
              disabled={isLoading}
              className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 text-white transition-colors flex items-center justify-center gap-2"
            >
              {loading === "login" ? (
                <span className="animate-pulse">Waiting for passkey&hellip;</span>
              ) : (
                <>
                  <KeyIcon />
                  Sign in with passkey
                </>
              )}
            </button>

            {/* Divider */}
            <div className="relative flex items-center gap-3 py-1">
              <div className="flex-1 h-px bg-gray-800" />
              <span className="text-xs text-gray-500">or create an account</span>
              <div className="flex-1 h-px bg-gray-800" />
            </div>

            {/* Register */}
            <button
              type="button"
              onClick={handleRegister}
              disabled={isLoading}
              className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white transition-colors flex items-center justify-center gap-2"
            >
              {loading === "register" ? (
                <span className="animate-pulse">Setting up passkey&hellip;</span>
              ) : (
                <>
                  <KeyIcon />
                  Register with passkey
                </>
              )}
            </button>
          </div>
        </div>

        {/* Back link */}
        <p className="text-center">
          <Link href="/" className="text-sm text-blue-400 hover:text-blue-300">
            &larr; Back to Primordia
          </Link>
        </p>
      </div>
    </main>
  );
}

function KeyIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}
