"use client";

// app/login/cross-device-receive/page.tsx
// Visited by Device B after scanning the QR code shown on Device A's
// "Sign in on another device" dialog (push flow).
//
// Flow:
//   1. Page reads ?token=<tokenId> from the URL query string.
//   2. Reads the receiver's ephemeral ECDH private key from the URL fragment
//      (#priv=<pkcs8_b64url>) — embedded by Device A client-side, never sent
//      to the server. Clears the fragment immediately to keep keys out of
//      browser history.
//   3. Polls /api/auth/cross-device/poll (push tokens are pre-approved, so
//      the first poll returns "approved" and sets the session cookie).
//   4. If the poll response includes an encryptedCredentials bundle, decrypts
//      it using ECDH(B_priv, A_pub) and saves the credential keys to localStorage.
//   5. Redirects to the home page.

import { Suspense, useEffect, useState, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle, Loader2 } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import { decryptPushCredentials, type PushCredBundle } from "@/lib/cross-device-creds";

type Phase = "loading" | "approved" | "expired" | "error";

function ReceivePageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tokenId = searchParams.get("token");

  const [phase, setPhase] = useState<Phase>(() =>
    tokenId ? "loading" : "error"
  );
  const [username, setUsername] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(() =>
    tokenId ? null : "No token found in URL. This QR code may be invalid."
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Receiver's ephemeral ECDH private key extracted from the QR fragment.
  // Kept in a ref so the polling closure can always access the latest value.
  const receiverPrivRef = useRef<string | null>(null);

  // Extract the receiver's private key from the URL fragment.
  // Runs once on mount, before polling, and clears the fragment immediately.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.slice(1); // strip leading #
    if (hash) {
      const params = new URLSearchParams(hash);
      const priv = params.get("priv");
      if (priv) receiverPrivRef.current = priv;
      // Remove the fragment from the URL bar so the private key doesn't
      // persist in browser history or get accidentally shared.
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  useEffect(() => {
    if (!tokenId) return;

    async function poll() {
      try {
        const res = await fetch(
          withBasePath(`/api/auth/cross-device/poll?tokenId=${tokenId}`)
        );
        const data = (await res.json()) as {
          status?: string;
          username?: string;
          encryptedCredentials?: PushCredBundle;
        };

        if (data.status === "approved") {
          // Stop polling.
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }

          // Decrypt and save credential keys if the push bundle is present.
          if (data.encryptedCredentials && receiverPrivRef.current) {
            try {
              const { k1, k2 } = await decryptPushCredentials(
                receiverPrivRef.current,
                data.encryptedCredentials
              );
              if (k1) localStorage.setItem("primordia_aes_key", k1);
              if (k2) localStorage.setItem("primordia_credentials_aes_key", k2);
            } catch {
              // Decryption failed — sign-in still succeeds; credentials just won't transfer
            }
          }

          setUsername(data.username ?? null);
          setPhase("approved");

          // Redirect to home after a brief moment so the success state is visible.
          setTimeout(() => router.push("/"), 1800);
        } else if (data.status === "expired" || data.status === "not_found") {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          setPhase("expired");
        }
        // "pending" → keep polling (unexpected for push tokens, but handled gracefully)
      } catch {
        // Transient network error — keep polling
      }
    }

    // Poll immediately, then every 2 seconds.
    poll();
    pollRef.current = setInterval(poll, 2000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [tokenId, router]);

  return (
    <main className="flex flex-col items-center justify-center min-h-dvh px-4 py-12 bg-gray-950">
      <div className="w-full max-w-sm space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Signing you in…
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Completing cross-device sign-in.
          </p>
        </div>

        {/* Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          {phase === "loading" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2
                size={32}
                strokeWidth={1.5}
                className="text-blue-400 animate-spin"
                aria-hidden="true"
              />
              <p className="text-sm text-gray-400 animate-pulse">
                Completing sign-in&hellip;
              </p>
            </div>
          )}

          {phase === "approved" && (
            <div className="flex flex-col items-center gap-3 text-center">
              <CheckCircle
                size={32}
                strokeWidth={1.5}
                className="text-green-400"
                aria-hidden="true"
              />
              <div className="space-y-1">
                <p className="text-sm text-green-400 font-medium">
                  Signed in{username ? ` as @${username}` : ""}!
                </p>
                <p className="text-xs text-gray-500">
                  Redirecting you now&hellip;
                </p>
              </div>
            </div>
          )}

          {phase === "expired" && (
            <div className="space-y-3 text-center">
              <p className="text-sm text-yellow-400 bg-yellow-900/20 border border-yellow-800/30 rounded-lg px-3 py-2">
                This QR code has expired. Ask the other device to generate a new one.
              </p>
              <Link
                href={withBasePath("/login")}
                className="inline-block text-sm text-blue-400 hover:text-blue-300 transition-colors"
              >
                Go to sign-in &rarr;
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

export default function CrossDeviceReceivePage() {
  return (
    <Suspense>
      <ReceivePageInner />
    </Suspense>
  );
}
