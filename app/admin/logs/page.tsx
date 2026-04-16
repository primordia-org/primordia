// app/admin/logs/page.tsx — Server logs viewer.
// Streams production server logs in real time.
// Admin only.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { getEvolvePrefs } from "@/lib/user-prefs";
import { getDb } from "@/lib/db";
import { buildPageTitle } from "@/lib/page-title";
import ForbiddenPage from "@/components/ForbiddenPage";
import { PageNavBar } from "@/components/PageNavBar";
import AdminSubNav from "@/components/AdminSubNav";
import ServerLogsClient from "@/components/ServerLogsClient";

export function generateMetadata(): Metadata {
  return {
    title: buildPageTitle("Server Logs"),
    description: "Tail the primordia systemd service journal.",
  };
}

export default async function AdminLogsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const db = await getDb();
  const [adminCheck, allRoles] = await Promise.all([
    isAdmin(user.id),
    db.getAllRoles(),
  ]);

  const adminRoleName = allRoles.find((r) => r.name === "admin")?.displayName ?? "admin";

  if (!adminCheck) {
    return (
      <ForbiddenPage
        pageDescription="This page streams live output from the primordia systemd service journal."
        requiredConditions={["Be logged in", `Have the "${adminRoleName}" role`]}
        metConditions={["You are logged in"]}
        unmetConditions={[`You don't have the "${adminRoleName}" role`]}
        howToFix={[
          `The "${adminRoleName}" role is automatically held by the first user who registered on this Primordia instance.`,
        ]}
      />
    );
  }

  const [sessionUser, evolvePrefs] = await Promise.all([
    Promise.resolve({ id: user.id, username: user.username, isAdmin: true }),
    getEvolvePrefs(user.id),
  ]);

  // Pre-fetch the initial log buffer for a useful first paint even if JS is broken.
  // Read the first SSE event from /_proxy/prod/logs, which contains the full
  // ring-buffer snapshot captured by the reverse proxy.
  const proxyPort = process.env.REVERSE_PROXY_PORT!;
  let initialLogs = "";

  // Fetch the proxy SSE stream and read just the first event (the snapshot).
  // Abort after 2 s in case the buffer is empty and no event arrives.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 2000);
  try {
    const res = await fetch(`http://localhost:${proxyPort}/_proxy/prod/logs`, {
      signal: ac.signal,
    });
    if (res.ok && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = "";
      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        // SSE events are delimited by \n\n
        const end = raw.indexOf("\n\n");
        if (end !== -1) {
          const eventText = raw.slice(0, end);
          reader.cancel();
          for (const line of eventText.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const parsed = JSON.parse(line.slice(6)) as { text?: string };
              if (parsed.text) { initialLogs = parsed.text; }
            } catch { /* ignore malformed */ }
          }
          break outer;
        }
      }
    }
  } catch {
    // timeout or network error — leave initialLogs as ""
  } finally {
    clearTimeout(timer);
  }

  return (
    <main className="flex flex-col w-full max-w-3xl mx-auto px-4 py-6 min-h-dvh">
      <PageNavBar subtitle="Admin" currentPage="admin" initialSession={sessionUser} initialHarness={evolvePrefs.initialHarness} initialModel={evolvePrefs.initialModel} initialCavemanMode={evolvePrefs.initialCavemanMode} initialCavemanIntensity={evolvePrefs.initialCavemanIntensity} />
      <AdminSubNav currentTab="logs" />
      <ServerLogsClient initialOutput={initialLogs} />
    </main>
  );
}
