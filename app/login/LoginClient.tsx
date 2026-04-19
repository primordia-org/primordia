"use client";

// app/login/LoginClient.tsx — Interactive login UI (client component).
// Renders one tab per installed auth plugin; delegates tab content to the
// plugin's tab component from components/auth-tabs/.

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { InstalledPlugin } from "@/lib/auth-plugins/types";
import { TAB_COMPONENT_MAP } from "@/components/auth-tabs";

interface LoginClientProps {
  initialUser: { id: string; username: string } | null;
  /** Resolved list of installed plugins with their server props. */
  plugins: InstalledPlugin[];
}

export default function LoginClient(props: LoginClientProps) {
  return (
    <Suspense>
      <LoginPageInner {...props} />
    </Suspense>
  );
}

function LoginPageInner({ initialUser, plugins }: LoginClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextUrl = searchParams.get("next") ?? "/";

  const [ignoringSession, setIgnoringSession] = useState(false);
  // Default to the first installed plugin's id.
  const [activeTab, setActiveTab] = useState<string>(plugins[0]?.id ?? "");

  const showLoggedInBanner = initialUser !== null && !ignoringSession;

  function handleSuccess(username: string) {
    void username; // available for future use (e.g. analytics, welcome toast)
    router.push(nextUrl);
    router.refresh();
  }

  return (
    <main className="flex flex-col items-center justify-center min-h-dvh px-4 py-12 bg-gray-950">
      <div className="w-full max-w-sm space-y-6">

        {/* ── Already-logged-in banner ── */}
        {showLoggedInBanner && (
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 space-y-4 text-center">
            <div className="space-y-1">
              <p className="text-sm text-gray-400">You&apos;re currently signed in as</p>
              <p className="text-lg font-semibold text-white">{initialUser!.username}</p>
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

        {/* Header */}
        {!showLoggedInBanner && (
          <div className="text-center">
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Sign in to Primordia
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              {plugins.length === 1
                ? `Use ${plugins[0].label} to sign in.`
                : `Use ${plugins.map((p) => p.label).join(", ")} to sign in.`}
            </p>
          </div>
        )}

        {/* Tab switcher + content */}
        {!showLoggedInBanner && plugins.length > 0 && (
          <>
            {/* Only show the tab bar when there are multiple plugins. */}
            {plugins.length > 1 && (
              <div className="flex rounded-lg bg-gray-800 p-1 gap-1">
                {plugins.map((plugin) => (
                  <button
                    key={plugin.id}
                    type="button"
                    onClick={() => setActiveTab(plugin.id)}
                    className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      activeTab === plugin.id
                        ? "bg-gray-700 text-white"
                        : "text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    {plugin.label}
                  </button>
                ))}
              </div>
            )}

            {/* Active plugin tab content */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
              {plugins.map((plugin) => {
                const TabComponent = TAB_COMPONENT_MAP[plugin.id];
                if (!TabComponent) {
                  // Plugin registered server-side but no client component found.
                  return activeTab === plugin.id ? (
                    <p key={plugin.id} className="text-sm text-red-400 text-center">
                      Tab component not found for plugin &quot;{plugin.id}&quot;.
                      Add it to components/auth-tabs/index.tsx.
                    </p>
                  ) : null;
                }
                // Render all tab components but hide inactive ones with CSS so
                // their internal state (e.g. QR polling) is preserved on tab switch.
                return (
                  <div key={plugin.id} className={activeTab === plugin.id ? "" : "hidden"}>
                    <TabComponent
                      serverProps={plugin.serverProps}
                      nextUrl={nextUrl}
                      onSuccess={handleSuccess}
                    />
                  </div>
                );
              })}
            </div>

            {/* Back link */}
            <p className="text-center">
              <Link href="/" className="text-sm text-blue-400 hover:text-blue-300">
                &larr; Back to Primordia
              </Link>
            </p>
          </>
        )}

        {/* Edge case: no plugins installed */}
        {!showLoggedInBanner && plugins.length === 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-sm text-gray-400">
            No authentication methods are configured.
            Add plugins to <code className="text-gray-300">lib/auth-plugins/registry.ts</code>.
          </div>
        )}
      </div>
    </main>
  );
}
