"use client";

// components/QrSignInOtherDeviceDialog.tsx
// Dialog shown to already-authenticated users from the hamburger menu.
//
// Push flow (ECIES — no raw credential keys in the QR code):
//   1. Reads own AES keys from localStorage.
//   2. Generates two ephemeral ECDH P-256 keypairs (A = sender, B = receiver).
//      Derives shared AES key = ECDH(A_priv, B_pub).
//   3. Encrypts credentials with the shared AES key.
//   4. POSTs the encrypted bundle (+ A_pub) to /api/auth/cross-device/push.
//      Server stores it on the pre-approved push token.
//   5. Builds the receive URL:
//        /login/cross-device-receive?token=<id>#priv=<B_priv_pkcs8_b64url>
//      B_priv goes only in the URL fragment — browsers never send it to the server.
//   6. Generates the QR code entirely client-side from the receive URL.
//
//   Device B reads B_priv from the fragment, polls the server, gets the bundle
//   (A_pub + ciphertext), derives ECDH(B_priv, A_pub) = same shared key, decrypts.
//
//   Even if someone photographs the QR and obtains B_priv, they still need A_pub
//   and the server-stored ciphertext. A_pub is not secret, but the ciphertext is
//   deleted from the server after first retrieval — preventing replay attacks.

import { useState, useEffect, useCallback } from "react";
import { QrCode, X, RefreshCw } from "lucide-react";
import { withBasePath, basePath } from "@/lib/base-path";
import QRCode from "qrcode";
import { encryptCredentialsForPush } from "@/lib/cross-device-creds";

interface QrSignInOtherDeviceDialogProps {
  onClose: () => void;
}

type Phase = "loading" | "ready" | "error";

export function QrSignInOtherDeviceDialog({ onClose }: QrSignInOtherDeviceDialogProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [qrImgSrc, setQrImgSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const startPushFlow = useCallback(async () => {
    setPhase("loading");
    setError(null);
    setQrImgSrc(null);

    // Read own AES credential keys from localStorage.
    let k1: string | null = null;
    let k2: string | null = null;
    try {
      k1 = localStorage.getItem("primordia_aes_key");
      k2 = localStorage.getItem("primordia_credentials_aes_key");
    } catch {
      // localStorage unavailable — continue without credential transfer
    }

    try {
      // ECIES: encrypt credentials for the receiver using two ephemeral ECDH keypairs.
      // Returns the receiver's private key (for the QR fragment) and the server bundle.
      const ecies = (k1 || k2) ? await encryptCredentialsForPush(k1, k2) : null;

      // Create a pre-approved push token, storing the encrypted bundle on the server.
      const res = await fetch(withBasePath("/api/auth/cross-device/push"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encryptedCredentials: ecies?.bundle ?? null }),
      });
      const data = (await res.json()) as { tokenId?: string; error?: string };
      if (!res.ok || !data.tokenId) {
        setPhase("error");
        setError(data.error ?? "Failed to generate QR code.");
        return;
      }

      // Build receive URL. The receiver's private key goes in the URL fragment —
      // browsers never send the fragment to the server.
      const origin = window.location.origin;
      const base = `${origin}${basePath}/login/cross-device-receive?token=${data.tokenId}`;
      const receiveUrl = ecies?.receiverPrivB64u
        ? `${base}#priv=${ecies.receiverPrivB64u}`
        : base;

      // Generate the QR code entirely in the browser.
      const svg = await QRCode.toString(receiveUrl, {
        type: "svg",
        margin: 2,
        color: {
          dark: "#ffffff",   // white modules on dark theme
          light: "#111827",  // gray-900 background
        },
      });
      // btoa is safe here: qrcode SVG output is pure ASCII
      const imgSrc = `data:image/svg+xml;base64,${btoa(svg)}`;
      setQrImgSrc(imgSrc);
      setPhase("ready");
    } catch {
      setPhase("error");
      setError("Network error. Please try again.");
    }
  }, []);

  // Start the push flow on mount.
  useEffect(() => {
    startPushFlow();
  }, [startPushFlow]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6 flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-blue-400">
            <QrCode size={18} strokeWidth={2} aria-hidden="true" />
            <h2 className="text-base font-semibold">Sign in on another device</h2>
          </div>
          <button
            data-id="qr-signin-other/close"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-200 transition-colors"
            aria-label="Close"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {/* Description */}
        <p className="text-sm text-gray-400 leading-relaxed">
          Scan this QR code on another device to sign in as you. Your credential
          keys are transferred securely — they are never exposed in the QR code.
        </p>

        {/* QR Code / states */}
        {phase === "loading" && (
          <div className="flex justify-center py-8">
            <span className="text-gray-500 text-sm animate-pulse">
              Generating QR code&hellip;
            </span>
          </div>
        )}

        {phase === "ready" && qrImgSrc && (
          <div className="space-y-3">
            <div className="flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrImgSrc}
                alt="QR code for signing in on another device"
                width={200}
                height={200}
                className="rounded-lg"
              />
            </div>
            <p className="text-xs text-gray-500 text-center">
              QR code expires in 10 minutes.
            </p>
            <button
              type="button"
              onClick={startPushFlow}
              className="w-full flex items-center justify-center gap-2 text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              <RefreshCw size={12} strokeWidth={2} aria-hidden="true" />
              Refresh QR code
            </button>
          </div>
        )}

        {phase === "error" && (
          <div className="space-y-3 text-center">
            <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/30 rounded-lg px-3 py-2">
              {error ?? "Something went wrong."}
            </p>
            <button
              type="button"
              onClick={startPushFlow}
              className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-gray-400 hover:text-gray-200 transition-colors text-center"
        >
          Close
        </button>
      </div>
    </div>
  );
}
