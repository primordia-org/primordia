"use client";

// app/login/approve/page.tsx
// Visited by the "approver" device (e.g. phone already signed in) after
// scanning the QR code shown on the "requester" device (e.g. laptop).
//
// Flow:
//   1. Page reads ?token=<tokenId> from the URL.
//   2. Checks if the visitor is currently signed in via /api/auth/session.
//   3. If signed in: shows an "Approve sign-in?" card with Approve / Reject.
//   4. If not signed in: prompts the user to sign in first.

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

type Phase =
  | "loading"       // checking session
  | "not_signed_in" // no active session
  | "ready"         // session found, waiting for user action
  | "approving"     // POST in flight
  | "done"          // approval confirmed
  | "error";        // something went wrong

export default function ApprovePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tokenId = searchParams.get("token");

  const [phase, setPhase] = useState<Phase>("loading");
  const [username, setUsername] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // On mount: check session status.
  useEffect(() => {
    if (!tokenId) {
      setPhase("error");
      setErrorMsg("No token found in URL. This QR code may be invalid.");
      return;
    }

    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((data: { user?: { username: string } | null }) => {
        if (data.user) {
          setUsername(data.user.username);
          setPhase("ready");
        } else {
          setPhase("not_signed_in");
        }
      })
      .catch(() => {
        setPhase("error");
        setErrorMsg("Could not check session. Please try again.");
      });
  }, [tokenId]);

  async function handleApprove() {
    if (!tokenId) return;
    setPhase("approving");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/auth/cross-device/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenId }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setPhase("error");
        setErrorMsg(data.error ?? "Approval failed.");
        return;
      }
      setPhase("done");
    } catch {
      setPhase("error");
      setErrorMsg("Network error. Please try again.");
    }
  }

  return (
    <main className="flex flex-col items-center justify-center min-h-dvh px-4 py-12 bg-gray-950">
      <div className="w-full max-w-sm space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Sign in on another device
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            A device is waiting to be signed in.
          </p>
        </div>

        {/* Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          {phase === "loading" && (
            <p className="text-sm text-gray-400 text-center animate-pulse">
              Checking your session&hellip;
            </p>
          )}

          {phase === "not_signed_in" && (
            <div className="space-y-3 text-center">
              <p className="text-sm text-gray-300">
                You need to be signed in to approve a login request.
              </p>
              <Link
                href={`/login?next=${encodeURIComponent(`/login/approve?token=${tokenId}`)}`}
                className="inline-block w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white text-center transition-colors"
              >
                Sign in first
              </Link>
            </div>
          )}

          {phase === "ready" && (
            <div className="space-y-4">
              <div className="text-center space-y-1">
                <p className="text-sm text-gray-300">
                  Signed in as{" "}
                  <span className="text-white font-medium">{username}</span>
                </p>
                <p className="text-sm text-gray-400">
                  Allow another device to sign in as you?
                </p>
              </div>
              <button
                type="button"
                onClick={handleApprove}
                className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors flex items-center justify-center gap-2"
              >
                <CheckIcon />
                Approve sign-in
              </button>
              <button
                type="button"
                onClick={() => router.push("/")}
                className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-gray-700 hover:bg-gray-600 text-white transition-colors"
              >
                Reject
              </button>
            </div>
          )}

          {phase === "approving" && (
            <p className="text-sm text-gray-400 text-center animate-pulse">
              Approving&hellip;
            </p>
          )}

          {phase === "done" && (
            <div className="text-center space-y-3">
              <p className="text-sm text-green-400 bg-green-900/20 border border-green-800/30 rounded-lg px-3 py-2">
                Done! The other device is now signed in.
              </p>
              <Link href="/" className="text-sm text-blue-400 hover:text-blue-300">
                Go to Primordia &rarr;
              </Link>
            </div>
          )}

          {phase === "error" && (
            <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/30 rounded-lg px-3 py-2">
              {errorMsg ?? "Something went wrong."}
            </p>
          )}
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

function CheckIcon() {
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
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
