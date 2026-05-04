"use client";

// components/auth-tabs/cross-device/index.tsx
// Login tab for cross-device QR-code sign-in (pull flow).
//
// The "requester" device (no session) shows a QR code.  An already-authenticated
// "approver" device scans it and approves, granting the requester a session.
//
// Credential sync: on mount we generate an ephemeral ECDH P-256 keypair. The
// public key is embedded as `pk=<b64url>` in the QR URL. The approver encrypts
// its own AES credentials with this key and stores the ciphertext on the token.
// When the poll returns "approved", we decrypt the bundle (if present) and save
// the credentials to localStorage — same result as the push flow.

import { useState, useRef, useEffect, useCallback } from "react";
import { withBasePath } from "@/lib/base-path";
import type { AuthTabProps } from "@/lib/auth-providers/types";
import {
  generateEcdhKeypair,
  exportEcdhPubKeyB64u,
  decryptReceivedCredentials,
  type EncryptedCredBundle,
} from "@/lib/cross-device-creds";

type QrPhase = "idle" | "loading" | "polling" | "approved" | "expired" | "error";

export default function CrossDeviceTab({ onSuccess }: AuthTabProps) {
  const [phase, setPhase] = useState<QrPhase>("idle");
  const [tokenId, setTokenId] = useState<string | null>(null);
  const [pkB64u, setPkB64u] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Keep private key in a ref so the polling closure can always see the latest value.
  const ecdhPrivKeyRef = useRef<CryptoKey | null>(null);

  // Generate ephemeral ECDH keypair on mount — private key stays in memory only.
  useEffect(() => {
    generateEcdhKeypair()
      .then(async (pair) => {
        ecdhPrivKeyRef.current = pair.privateKey;
        const pub = await exportEcdhPubKeyB64u(pair.publicKey);
        setPkB64u(pub);
      })
      .catch(() => {
        // WebCrypto unavailable — proceed without credential sync
        setPkB64u(""); // empty string signals "no pk" to startQrFlow
      });

    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start the QR flow once the public key is ready.
  useEffect(() => {
    if (pkB64u !== null) startQrFlow(pkB64u || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkB64u]);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  const startQrFlow = useCallback(async (pk: string | null) => {
    stopPolling();
    setPhase("loading");
    setQrError(null);
    setTokenId(null);
    try {
      const res = await fetch(withBasePath("/api/auth/cross-device/start"), { method: "POST" });
      const data = (await res.json()) as { tokenId?: string; error?: string };
      if (!res.ok || !data.tokenId) {
        setPhase("error");
        setQrError(data.error ?? "Failed to start QR flow.");
        return;
      }
      setTokenId(data.tokenId);
      setPhase("polling");

      pollRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch(
            withBasePath(`/api/auth/cross-device/poll?tokenId=${data.tokenId}`)
          );
          const pollData = (await pollRes.json()) as {
            status?: string;
            username?: string;
            encryptedCredentials?: EncryptedCredBundle;
          };

          if (pollData.status === "approved") {
            stopPolling();

            // Decrypt and save credentials if the approver sent them.
            if (pollData.encryptedCredentials && ecdhPrivKeyRef.current) {
              try {
                const { k1, k2 } = await decryptReceivedCredentials(
                  ecdhPrivKeyRef.current,
                  pollData.encryptedCredentials
                );
                if (k1) localStorage.setItem("primordia_aes_key", k1);
                if (k2) localStorage.setItem("primordia_credentials_aes_key", k2);
              } catch {
                // Decryption failed — sign-in still succeeds; credentials just won't transfer
              }
            }

            setPhase("approved");
            onSuccess(pollData.username ?? "");
          } else if (pollData.status === "expired" || pollData.status === "not_found") {
            stopPolling();
            setPhase("expired");
          }
          // "pending" → keep polling
        } catch {
          // Transient network error — keep polling
        }
      }, 2000);
    } catch {
      setPhase("error");
      setQrError("Network error. Please try again.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSuccess]);

  function handleRefresh() {
    startQrFlow(pkB64u || null);
  }

  // Build the QR image URL, appending the ECDH public key if available.
  function qrSrc(tid: string): string {
    const base = withBasePath(`/api/auth/cross-device/qr?tokenId=${tid}`);
    return pkB64u ? `${base}&pk=${encodeURIComponent(pkB64u)}` : base;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-300 text-center">
        Show this QR code to a device where you&apos;re already signed in, then scan
        it with that device&apos;s camera. You&apos;ll be taken to an approval screen.
        Your credential keys will also be copied to this device.
      </p>

      {phase === "loading" && (
        <div className="flex justify-center py-8">
          <span className="text-gray-500 text-sm animate-pulse">Generating QR code&hellip;</span>
        </div>
      )}

      {phase === "polling" && tokenId && (
        <div className="space-y-3">
          <div className="flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrSrc(tokenId)}
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
            onClick={handleRefresh}
            className="w-full text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Refresh QR code
          </button>
        </div>
      )}

      {phase === "approved" && (
        <p className="text-sm text-green-400 bg-green-900/20 border border-green-800/30 rounded-lg px-3 py-2 text-center">
          Approved! Redirecting&hellip;
        </p>
      )}

      {phase === "expired" && (
        <div className="space-y-3 text-center">
          <p className="text-sm text-yellow-400 bg-yellow-900/20 border border-yellow-800/30 rounded-lg px-3 py-2">
            QR code expired.
          </p>
          <button
            type="button"
            onClick={handleRefresh}
            className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            Generate a new one
          </button>
        </div>
      )}

      {phase === "error" && (
        <div className="space-y-3 text-center">
          <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/30 rounded-lg px-3 py-2">
            {qrError ?? "Something went wrong."}
          </p>
          <button
            type="button"
            onClick={handleRefresh}
            className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
