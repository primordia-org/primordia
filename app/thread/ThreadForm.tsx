"use client";

// app/thread/ThreadForm.tsx
// The dedicated "submit a request" page body for creating a thread.

import { NavHeader } from "@/components/NavHeader";
import { HamburgerMenu, buildStandardMenuItems } from "@/components/HamburgerMenu";
import { useSessionUser } from "@/lib/hooks";
import { ThreadRequestForm } from "@/components/ThreadRequestForm";

// ─── Props ────────────────────────────────────────────────────────────────────

interface ThreadFormProps {
  branch?: string | null;
  initialHarness?: string;
  initialModel?: string;
  initialCavemanMode?: boolean;
  initialCavemanIntensity?: import("@/lib/user-prefs").CavemanIntensity;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ThreadForm({ branch, initialHarness, initialModel, initialCavemanMode, initialCavemanIntensity }: ThreadFormProps = {}) {
  const { sessionUser, handleLogout } = useSessionUser();

  return (
    <main className="flex flex-col w-full max-w-3xl mx-auto px-4 py-6 min-h-dvh">
      {/* Header */}
      <header className="flex items-center justify-between mb-8 flex-shrink-0">
        <NavHeader branch={branch} subtitle="Propose a change" />
        <HamburgerMenu
          sessionUser={sessionUser}
          onLogout={handleLogout}
          items={buildStandardMenuItems({
            isAdmin: sessionUser?.isAdmin ?? false,
            currentPath: "/thread",
          })}
        />
      </header>

      {/* Description banner */}
      <div className="mb-6 px-4 py-3 rounded-lg bg-amber-900/40 border border-amber-700/50 text-amber-300 text-sm">
        <strong className="font-semibold">Start a thread</strong> —{" "}
        Describe a change you want to make to this app.
      </div>

      <div className="border border-gray-800 rounded-xl bg-gray-900 p-4">
        <ThreadRequestForm
          draftStorageKey="primordia:thread-draft:initial"
          initialHarness={initialHarness}
          initialModel={initialModel}
          initialCavemanMode={initialCavemanMode}
          initialCavemanIntensity={initialCavemanIntensity}
        />
      </div>
    </main>
  );
}
