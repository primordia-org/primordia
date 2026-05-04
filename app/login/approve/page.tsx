"use client";

// app/login/approve/page.tsx
// Visited by the "approver" device (e.g. phone already signed in) after
// scanning the QR code shown on the "requester" device (e.g. laptop).
//
// Flow:
//   1. Page reads ?token=<tokenId> and optional ?pk=<ecdhPubKey> from the URL.
//   2. Checks if the visitor is currently signed in via /api/auth/session.
//   3. If signed in: shows an "Approve sign-in?" card with Approve / Reject.
//   4. On Approve: if pk is present, encrypts own AES credentials for the requester
//      using ECDH P-256, then POSTs { tokenId, encryptedCredentials } together.
//   5. If not signed in: prompts the user to sign in first.

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Check, KeyRound } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import { encryptCredentialsForRequester } from "@/lib/cross-device-creds";

type Phase =
  | "loading"       // checking session
  | "not_signed_in" // no active session
  | "ready"         // session found, waiting for user action
  | "approving"     // POST in flight
  | "done"          // approval confirmed
  | "error";        // something went wrong

function ApprovePageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tokenId = searchParams.get("token");
  // Requester's ephemeral ECDH public key (base64url). Present only in the pull flow.
  const pk = searchParams.get("pk");

  const [phase, setPhase] = useState<Phase>(() =>
    tokenId ? "loading" : "error"
  );
  const [username, setUsername] = useState<string | null>(null);
  const [credsSynced, setCredsSynced] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(() =>
    tokenId
      ? null
      : "No token found in URL. This QR code may be invalid."
  );

  // On mount: check session status (only if we have a token).
  useEffect(() => {
    if (!tokenId) return;

    fetch(withBasePath("/api/auth/session"))
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
      // If the requester embedded an ECDH public key in the QR URL, encrypt
      // our own credentials for it so it can save them on sign-in.
      let encryptedCredentials = null;
      if (pk) {
        try {
          const k1 = localStorage.getItem("primordia_aes_key");
          const k2 = localStorage.getItem("primordia_credentials_aes_key");
          encryptedCredentials = await encryptCredentialsForRequester(pk, k1, k2);
        } catch {
          // Encryption failed — proceed with approval without credential sync
        }
      }

      const res = await fetch(withBasePath("/api/auth/cross-device/approve"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenId, encryptedCredentials }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setPhase("error");
        setErrorMsg(data.error ?? "Approval failed.");
        return;
      }
      setCredsSynced(!!encryptedCredentials);
      setPhase("done");
    } catch {
      setPhase("error");
      setErrorMsg("Network error. Please try again.");
    }
  }

  // Detect whether this approver has any credentials worth syncing.
  const hasCredentials = (() => {
    try {
      return (
        !!localStorage.getItem("primordia_aes_key") ||
        !!localStorage.getItem("primordia_credentials_aes_key")
      );
    } catch {
      return false;
    }
  })();

  return (
    <main className="flex flex-col items-center justify-center min-h-dvh px-4 py-12 bg-gray-950">
      <div className="w-full max-w-sm space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Approve this login
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
                href={withBasePath(`/login?next=${encodeURIComponent(`/login/approve?token=${tokenId}${pk ? `&pk=${pk}` : ""}`)}`)}
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

              {pk && hasCredentials && (
                <div className="flex items-start gap-2 bg-blue-900/20 border border-blue-800/30 rounded-lg px-3 py-2">
                  <KeyRound size={14} strokeWidth={2} className="text-blue-400 mt-0.5 shrink-0" aria-hidden="true" />
                  <p className="text-xs text-blue-300">
                    Your credential keys will also be copied to the other device.
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={handleApprove}
                className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors flex items-center justify-center gap-2"
              >
                <Check size={15} strokeWidth={2} aria-hidden="true" />
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
                {credsSynced && " Credentials were also copied."}
              </p>
              <Link href={withBasePath("/")} className="text-sm text-blue-400 hover:text-blue-300">
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
          <Link href={withBasePath("/")} className="text-sm text-blue-400 hover:text-blue-300">
            &larr; Back to Primordia
          </Link>
        </p>
      </div>
    </main>
  );
}

export default function ApprovePage() {
  return (
    <Suspense>
      <ApprovePageInner />
    </Suspense>
  );
}
