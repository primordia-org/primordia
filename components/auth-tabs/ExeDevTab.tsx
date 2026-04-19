"use client";

// components/auth-tabs/ExeDevTab.tsx
// Login tab for exe.dev SSO authentication.
//
// serverProps shape: { email: string | null }
//   - email: the exe.dev email injected by the proxy, or null if not authenticated.

import { withBasePath } from "@/lib/base-path";
import { ChevronRight } from "lucide-react";
import type { AuthTabProps } from "./types";

export function ExeDevTab({ serverProps, nextUrl }: AuthTabProps) {
  const email = (serverProps.email as string | null) ?? null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-300 text-center">
        Sign in using your{" "}
        <a
          href="https://exe.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 underline"
        >
          exe.dev
        </a>{" "}
        account. Your username will be your exe.dev email address.
      </p>

      {email ? (
        /* exe.dev proxy already injected the email — one-click sign-in */
        <div className="space-y-3">
          <p className="text-xs text-gray-500 text-center">Signed in to exe.dev as</p>
          <p className="text-sm font-medium text-white text-center break-all">{email}</p>
          <a
            href={withBasePath(`/api/auth/exe-dev?next=${encodeURIComponent(nextUrl)}`)}
            className="block w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors text-center"
          >
            <ChevronRight
              size={15}
              strokeWidth={2}
              aria-hidden
              style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }}
            />
            Sign in as {email}
          </a>
        </div>
      ) : (
        /* Not yet authenticated — redirect through exe.dev login */
        <a
          href={`/api/auth/exe-dev?next=${encodeURIComponent(nextUrl)}`}
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors"
        >
          <ChevronRight
            size={15}
            strokeWidth={2}
            aria-hidden
            style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }}
          />
          Sign in with exe.dev
        </a>
      )}
    </div>
  );
}
