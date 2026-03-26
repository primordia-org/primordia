"use client";

// app/login/LoginClient.tsx — Interactive login UI (client component).
// Receives the server-resolved session user as a prop — no fetch on mount.

import { Suspense, useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";

type Tab = "passkey" | "qr";

// --- QR flow state ---
type QrPhase =
  | "idle"      // not started
  | "loading"   // waiting for tokenId from server
  | "polling"   // showing QR code, polling for approval
  | "approved"  // approved — redirecting
  | "expired"   // token expired
  | "error";

interface LoginClientProps {
  initialUser: { id: string; username: string } | null;
}

export default function LoginClient({ initialUser }: LoginClientProps) {
  return (
    <Suspense>
      <LoginPageInner initialUser={initialUser} />
    </Suspense>
  );
}

function LoginPageInner({ initialUser }: LoginClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // After login, redirect to ?next= if present, otherwise "/".
  const nextUrl = searchParams.get("next") ?? "/";

  // If user dismisses the "already logged in" banner, show the normal form.
  const [ignoringSession, setIgnoringSession] = useState(false);

  const [tab, setTab] = useState<Tab>("passkey");

  // --- Passkey state ---
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"register" | "login" | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // --- QR state ---
  const [qrPhase, setQrPhase] = useState<QrPhase>("idle");
  const [qrTokenId, setQrTokenId] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up poll interval when leaving QR tab or unmounting.
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  function stopPolling() {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }

  async function startQrFlow() {
    stopPolling();
    setQrPhase("loading");
    setQrError(null);
    setQrTokenId(null);
    try {
      const res = await fetch("/api/auth/cross-device/start", { method: "POST" });
      const data = (await res.json()) as { tokenId?: string; error?: string };
      if (!res.ok || !data.tokenId) {
        setQrPhase("error");
        setQrError(data.error ?? "Failed to start QR flow.");
        return;
      }
      setQrTokenId(data.tokenId);
      setQrPhase("polling");

      // Poll every 2 seconds for approval.
      pollIntervalRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch(
            `/api/auth/cross-device/poll?tokenId=${data.tokenId}`
          );
          const pollData = (await pollRes.json()) as {
            status?: string;
            username?: string;
            error?: string;
          };

          if (pollData.status === "approved") {
            stopPolling();
            setQrPhase("approved");
            // Session cookie has been set by the poll response.
            // Redirect to the intended destination.
            router.push(nextUrl);
            router.refresh();
          } else if (
            pollData.status === "expired" ||
            pollData.status === "not_found"
          ) {
            stopPolling();
            setQrPhase("expired");
          }
          // "pending" → keep polling
        } catch {
          // Network hiccup — keep polling (don't abort on transient errors)
        }
      }, 2000);
    } catch {
      setQrPhase("error");
      setQrError("Network error. Please try again.");
    }
  }

  // When switching to the QR tab, auto-start the flow.
  function switchToQr() {
    setTab("qr");
    if (qrPhase === "idle" || qrPhase === "expired" || qrPhase === "error") {
      startQrFlow();
    }
  }

  function switchToPasskey() {
    stopPolling();
    setTab("passkey");
  }

  // --- Passkey handlers ---
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
      router.push(nextUrl);
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
      router.push(nextUrl);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  const isLoading = !!loading;

  // Show "already logged in" banner when a session was found server-side and
  // the user hasn't dismissed it.
  const showLoggedInBanner = initialUser !== null && !ignoringSession;

  return (
    <main className="flex flex-col items-center justify-center min-h-dvh px-4 py-12 bg-gray-950">
      <div className="w-full max-w-sm space-y-6">

        {/* ── Already-logged-in banner ── */}
        {showLoggedInBanner && (
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 space-y-4 text-center">
            <div className="space-y-1">
              <p className="text-sm text-gray-400">You&apos;re currently signed in as</p>
              <p className="text-lg font-semibold text-white">
                {initialUser!.username}
              </p>
            </div>
            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => router.push(nextUrl)}
                className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                Proceed to Primordia &rarr;
              </button>
              <button
                type="button"
                onClick={() => setIgnoringSession(true)}
                className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
              >
                Log in as a different user
              </button>
            </div>
          </div>
        )}

        {/* Header (hidden when showing the already-logged-in banner) */}
        {!showLoggedInBanner && (
          <div className="text-center">
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Sign in to Primordia
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              Use a passkey or scan a QR code from another device.
            </p>
          </div>
        )}

        {/* Tab switcher + form (hidden when showing the already-logged-in banner) */}
        {!showLoggedInBanner && (<>
        <div className="flex rounded-lg bg-gray-800 p-1 gap-1">
          <button
            type="button"
            onClick={switchToPasskey}
            className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === "passkey"
                ? "bg-gray-700 text-white"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            Passkey
          </button>
          <button
            type="button"
            onClick={switchToQr}
            className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === "qr"
                ? "bg-gray-700 text-white"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            QR Code
          </button>
        </div>

        {/* Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">

          {/* ── Passkey tab ── */}
          {tab === "passkey" && (
            <>
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
            </>
          )}

          {/* ── QR tab ── */}
          {tab === "qr" && (
            <div className="space-y-4">
              <p className="text-sm text-gray-300 text-center">
                Open Primordia on a device where you&apos;re already signed in,
                then scan this code to sign in here.
              </p>

              {qrPhase === "loading" && (
                <div className="flex justify-center py-8">
                  <span className="text-gray-500 text-sm animate-pulse">
                    Generating QR code&hellip;
                  </span>
                </div>
              )}

              {qrPhase === "polling" && qrTokenId && (
                <div className="space-y-3">
                  {/* QR code image from the server */}
                  <div className="flex justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/auth/cross-device/qr?tokenId=${qrTokenId}`}
                      alt="QR code for cross-device sign-in"
                      width={200}
                      height={200}
                      className="rounded-lg"
                    />
                  </div>
                  <p className="text-xs text-gray-500 text-center animate-pulse">
                    Waiting for approval&hellip;
                  </p>
                  <button
                    type="button"
                    onClick={startQrFlow}
                    className="w-full text-xs text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    Refresh QR code
                  </button>
                </div>
              )}

              {qrPhase === "approved" && (
                <p className="text-sm text-green-400 bg-green-900/20 border border-green-800/30 rounded-lg px-3 py-2 text-center">
                  Approved! Redirecting&hellip;
                </p>
              )}

              {qrPhase === "expired" && (
                <div className="space-y-3 text-center">
                  <p className="text-sm text-yellow-400 bg-yellow-900/20 border border-yellow-800/30 rounded-lg px-3 py-2">
                    QR code expired.
                  </p>
                  <button
                    type="button"
                    onClick={startQrFlow}
                    className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    Generate a new one
                  </button>
                </div>
              )}

              {qrPhase === "error" && (
                <div className="space-y-3 text-center">
                  <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/30 rounded-lg px-3 py-2">
                    {qrError ?? "Something went wrong."}
                  </p>
                  <button
                    type="button"
                    onClick={startQrFlow}
                    className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    Try again
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Back link */}
        <p className="text-center">
          <Link href="/" className="text-sm text-blue-400 hover:text-blue-300">
            &larr; Back to Primordia
          </Link>
        </p>
        </>)}
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
