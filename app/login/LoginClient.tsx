"use client";

// app/login/LoginClient.tsx — Interactive login UI (client component).
// Renders one tab per installed auth provider. Tab components are loaded via
// next/dynamic using the provider's id — no static import map required.
//
// Webpack creates a context module for the @/components/auth-tabs/*/index
// pattern at build time, bundling every installed tab component automatically.

import { Suspense, useState, useEffect, type ComponentType } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { InstalledPlugin, AuthTabProps } from "@/lib/auth-providers/types";

interface LoginClientProps {
  initialUser: { id: string; username: string } | null;
  plugins: InstalledPlugin[];
}

// Module-level cache so each dynamic component is only created once, not on
// every render. Keys are provider ids (e.g. "passkey", "exe-dev").
const tabCache = new Map<string, ComponentType<AuthTabProps>>();

function getTabComponent(pluginId: string): ComponentType<AuthTabProps> {
  if (!tabCache.has(pluginId)) {
    tabCache.set(
      pluginId,
      // Webpack resolves this template literal to a context module containing
      // all files matching components/auth-tabs/*/index at build time.
      // The correct component is selected at runtime by pluginId.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dynamic<AuthTabProps>(() => import(`@/components/auth-tabs/${pluginId}/index`) as Promise<any>)
    );
  }
  return tabCache.get(pluginId)!;
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
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("primordia:lastLoginTab");
      if (saved && plugins.some((p) => p.id === saved)) return saved;
    }
    return plugins[0]?.id ?? "";
  });

  useEffect(() => {
    if (activeTab) localStorage.setItem("primordia:lastLoginTab", activeTab);
  }, [activeTab]);

  const showLoggedInBanner = initialUser !== null && !ignoringSession;

  function handleSuccess(_username: string) {
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
            {/* Tab bar — hidden when only one provider is installed */}
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
                const TabComponent = getTabComponent(plugin.id);
                // Render all tabs; hide inactive ones with CSS to preserve
                // internal state (e.g. QR polling timers).
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

            <p className="text-center">
              <Link href="/" className="text-sm text-blue-400 hover:text-blue-300">
                &larr; Back to Primordia
              </Link>
            </p>
          </>
        )}

        {/* Edge case: no providers discovered */}
        {!showLoggedInBanner && plugins.length === 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-sm text-gray-400">
            No authentication providers are configured. Create a directory under{" "}
            <code className="text-gray-300">lib/auth-providers/</code> to add one.
          </div>
        )}
      </div>
    </main>
  );
}
