"use client";

// components/auth-tabs/CrossDeviceTab.tsx
// Login tab for cross-device QR-code sign-in.
//
// The "requester" device shows a QR code; an already-authenticated
// "approver" device scans it and approves, granting the requester a session.

import { useState, useRef, useEffect } from "react";
import { withBasePath } from "@/lib/base-path";
import type { AuthTabProps } from "./types";

type QrPhase = "idle" | "loading" | "polling" | "approved" | "expired" | "error";

export function CrossDeviceTab({ onSuccess }: AuthTabProps) {
  const [phase, setPhase] = useState<QrPhase>("idle");
  const [tokenId, setTokenId] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Start flow automatically when tab mounts (or when re-triggered).
  useEffect(() => {
    startQrFlow();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function startQrFlow() {
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
          };

          if (pollData.status === "approved") {
            stopPolling();
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
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-300 text-center">
        Open Primordia on a device where you&apos;re already signed in, then scan this
        code to sign in here.
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
              src={withBasePath(`/api/auth/cross-device/qr?tokenId=${tokenId}`)}
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
            onClick={startQrFlow}
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
            onClick={startQrFlow}
            className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
