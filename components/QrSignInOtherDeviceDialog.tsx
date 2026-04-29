"use client";

// components/QrSignInOtherDeviceDialog.tsx
// Dialog shown to already-authenticated users who want to sign in on a second device.
//
// Flow ("push" mode — initiated by the logged-in device):
//   1. Reads AES encryption key JWKs from localStorage (if any are stored).
//   2. POSTs to /api/auth/cross-device/push to create a pre-approved token
//      that also carries the AES keys.
//   3. Renders a QR code pointing to /login/cross-device-receive?token=<id>
//      on the other device.
//   4. The scanning device immediately gets a session AND has its localStorage
//      populated with the AES keys — so API keys and credentials work there too.

import { useState, useEffect, useCallback } from "react";
import { QrCode, X, RefreshCw } from "lucide-react";
import { withBasePath } from "@/lib/base-path";

interface QrSignInOtherDeviceDialogProps {
  onClose: () => void;
}

type Phase = "loading" | "ready" | "error";

export function QrSignInOtherDeviceDialog({ onClose }: QrSignInOtherDeviceDialogProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [tokenId, setTokenId] = useState<string | null>(null);
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
    setTokenId(null);

    // Read AES key JWKs directly from localStorage — they're stored as raw
    // JSON strings and can be sent to the server to embed in the token.
    let apiKeyJwk: string | null = null;
    let credentialsKeyJwk: string | null = null;
    try {
      apiKeyJwk = localStorage.getItem("primordia_aes_key");
      credentialsKeyJwk = localStorage.getItem("primordia_credentials_aes_key");
    } catch {
      // localStorage unavailable — continue without key transfer
    }

    try {
      const res = await fetch(withBasePath("/api/auth/cross-device/push"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKeyJwk, credentialsKeyJwk }),
      });
      const data = (await res.json()) as { tokenId?: string; error?: string };
      if (!res.ok || !data.tokenId) {
        setPhase("error");
        setError(data.error ?? "Failed to generate QR code.");
        return;
      }
      setTokenId(data.tokenId);
      setPhase("ready");
    } catch {
      setPhase("error");
      setError("Network error. Please try again.");
    }
  }, []);

  // Start the flow on mount.
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
          Scan this QR code on another device to sign in as you. It will also
          copy your API key and credential encryption keys to that device, so
          your stored keys work there too.
        </p>

        {/* QR Code / states */}
        {phase === "loading" && (
          <div className="flex justify-center py-8">
            <span className="text-gray-500 text-sm animate-pulse">
              Generating QR code&hellip;
            </span>
          </div>
        )}

        {phase === "ready" && tokenId && (
          <div className="space-y-3">
            <div className="flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={withBasePath(
                  `/api/auth/cross-device/qr?tokenId=${tokenId}&type=push`
                )}
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
