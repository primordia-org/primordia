"use client";

// components/QrSignInOtherDeviceDialog.tsx
// Dialog shown to already-authenticated users from the hamburger menu.
//
// Push flow:
//   1. Reads AES encryption key JWKs from localStorage (if any are stored).
//   2. POSTs to /api/auth/cross-device/push to create a pre-approved token.
//      No keys are sent to the server.
//   3. Builds a receive URL with keys in the URL fragment (#k1=...&k2=...).
//      Fragments are never sent to the server — they exist only in the browser.
//   4. Generates the QR code entirely client-side so the server never sees the
//      fragment, and therefore never sees the AES keys.
//   5. The scanning device reads the keys from the fragment on its own page
//      and stores them in localStorage — keys travel only through the QR code.

import { useState, useEffect, useCallback } from "react";
import { QrCode, X, RefreshCw } from "lucide-react";
import { withBasePath, basePath } from "@/lib/base-path";
import QRCode from "qrcode";

interface QrSignInOtherDeviceDialogProps {
  onClose: () => void;
}

type Phase = "loading" | "ready" | "error";

// URL-safe base64 encoding (no +, /, or = padding) so fragment params stay compact.
function b64uEncode(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

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

    // Read AES key JWK strings from localStorage.
    // These never leave the browser in this flow — they travel only via the QR code.
    let rawApiKeyJwk: string | null = null;
    let rawCredentialsKeyJwk: string | null = null;
    try {
      rawApiKeyJwk = localStorage.getItem("primordia_aes_key");
      rawCredentialsKeyJwk = localStorage.getItem("primordia_credentials_aes_key");
    } catch {
      // localStorage unavailable — continue without key transfer
    }

    try {
      // Create a pre-approved push token on the server (no keys involved).
      const res = await fetch(withBasePath("/api/auth/cross-device/push"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as { tokenId?: string; error?: string };
      if (!res.ok || !data.tokenId) {
        setPhase("error");
        setError(data.error ?? "Failed to generate QR code.");
        return;
      }

      // Build receive URL. Keys go in the fragment — browsers never send the
      // fragment to the server, so the AES keys are invisible to the server.
      const origin = window.location.origin;
      const base = `${origin}${basePath}/login/cross-device-receive?token=${data.tokenId}`;
      const parts: string[] = [];
      if (rawApiKeyJwk) parts.push(`k1=${b64uEncode(rawApiKeyJwk)}`);
      if (rawCredentialsKeyJwk) parts.push(`k2=${b64uEncode(rawCredentialsKeyJwk)}`);
      const receiveUrl = parts.length > 0 ? `${base}#${parts.join("&")}` : base;

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
          Scan this QR code on another device to sign in as you. Your API key
          and credential encryption keys are embedded directly in the QR code —
          they never pass through the server.
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
