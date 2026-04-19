"use client";

// components/auth-tabs/PasskeyTab.tsx
// Login tab for WebAuthn passkey authentication.
// Handles both sign-in (login) and new account registration.

import { useState } from "react";
import { startRegistration, startAuthentication } from "@simplewebauthn/browser";
import { withBasePath } from "@/lib/base-path";
import { Key } from "lucide-react";
import type { AuthTabProps } from "./types";

export function PasskeyTab({ nextUrl, onSuccess }: AuthTabProps) {
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"register" | "login" | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isLoading = !!loading;

  async function handleRegister() {
    if (!username.trim()) {
      setError("Please enter a username.");
      return;
    }
    setError(null);
    setSuccess(null);
    setLoading("register");
    try {
      const startRes = await fetch(withBasePath("/api/auth/passkey/register/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const startData = (await startRes.json()) as { options?: unknown; error?: string };
      if (!startRes.ok) {
        setError(startData.error ?? "Failed to start registration.");
        return;
      }

      const attResp = await startRegistration({
        optionsJSON: startData.options as Parameters<typeof startRegistration>[0]["optionsJSON"],
      });

      const finishRes = await fetch(withBasePath("/api/auth/passkey/register/finish"), {
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
      onSuccess(finishData.username ?? username);
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
      const startRes = await fetch(withBasePath("/api/auth/passkey/login/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username || undefined }),
      });
      const startData = (await startRes.json()) as { options?: unknown; error?: string };
      if (!startRes.ok) {
        setError(startData.error ?? "Failed to start sign-in.");
        return;
      }

      const authResp = await startAuthentication({
        optionsJSON: startData.options as Parameters<typeof startAuthentication>[0]["optionsJSON"],
      });

      const finishRes = await fetch(withBasePath("/api/auth/passkey/login/finish"), {
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
      onSuccess(finishData.username ?? username);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  void nextUrl; // nextUrl used by onSuccess caller; not needed directly here

  return (
    <>
      {/* Username */}
      <div>
        <label htmlFor="passkey-username" className="block text-sm text-gray-300 mb-1.5">
          Username
        </label>
        <input
          id="passkey-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleLogin(); }}
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
              <Key size={15} strokeWidth={2} aria-hidden="true" />
              Sign in with passkey
            </>
          )}
        </button>

        <div className="relative flex items-center gap-3 py-1">
          <div className="flex-1 h-px bg-gray-800" />
          <span className="text-xs text-gray-500">or create an account</span>
          <div className="flex-1 h-px bg-gray-800" />
        </div>

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
              <Key size={15} strokeWidth={2} aria-hidden="true" />
              Register with passkey
            </>
          )}
        </button>
      </div>
    </>
  );
}
