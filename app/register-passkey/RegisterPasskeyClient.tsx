"use client";

// app/register-passkey/RegisterPasskeyClient.tsx
// Prompts a logged-in user (e.g. after exe.dev login) to register a passkey
// so their account becomes accessible via either login method in future.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startRegistration } from "@simplewebauthn/browser";
import { withBasePath } from "@/lib/base-path";
import { Key } from "lucide-react";

interface Props {
  username: string;
  nextUrl: string;
}

export default function RegisterPasskeyClient({ username, nextUrl }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRegister() {
    setError(null);
    setLoading(true);
    try {
      const startRes = await fetch(withBasePath("/api/auth/passkey/register/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Body is ignored by the server when a session is present, but required
        // by the JSON content-type header.
        body: JSON.stringify({}),
      });
      const startData = (await startRes.json()) as { options?: unknown; error?: string };
      if (!startRes.ok) {
        setError(startData.error ?? "Failed to start passkey registration.");
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
      const finishData = (await finishRes.json()) as { ok?: boolean; error?: string };
      if (!finishRes.ok) {
        setError(finishData.error ?? "Passkey registration failed.");
        return;
      }

      router.push(nextUrl);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function handleSkip() {
    router.push(nextUrl);
  }

  return (
    <main className="flex flex-col items-center justify-center min-h-dvh px-4 py-12 bg-gray-950">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Add a passkey
          </h1>
          <p className="text-sm text-gray-400">
            Signed in as <span className="text-white font-medium">{username}</span>
          </p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          <p className="text-sm text-gray-300">
            Register a passkey so you can sign in to this account with a
            fingerprint, face ID, or security key — without needing exe.dev.
          </p>

          {error && (
            <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="space-y-2 pt-1">
            <button
              type="button"
              onClick={handleRegister}
              disabled={loading}
              className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 text-white transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <span className="animate-pulse">Setting up passkey&hellip;</span>
              ) : (
                <>
                  <Key size={15} strokeWidth={2} aria-hidden="true" />
                  Register passkey
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleSkip}
              disabled={loading}
              className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-400 transition-colors"
            >
              Skip for now
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
