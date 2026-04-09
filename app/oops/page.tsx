// app/oops/page.tsx — Owner-only mobile command shell.
// Lets the admin run occasional system commands (e.g. sudo systemctl restart primordia)
// from a phone without needing SSH access.

import { execSync } from "child_process";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { buildPageTitle } from "@/lib/page-title";
import ForbiddenPage from "@/components/ForbiddenPage";
import OopsShell from "@/components/OopsShell";
import { PageNavBar } from "@/components/PageNavBar";

export function generateMetadata(): Metadata {
  return {
    title: buildPageTitle("Shell"),
    description: "Owner-only shell for running system commands from mobile.",
  };
}

export default async function OopsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const adminCheck = await isAdmin(user.id);

  if (!adminCheck) {
    return (
      <ForbiddenPage
        pageDescription="This page provides a mobile-friendly shell for running occasional system commands (e.g. restarting the Primordia service) without needing SSH access."
        requiredConditions={["Be logged in", 'Have the "Prime" (admin) role']}
        metConditions={["You are logged in"]}
        unmetConditions={['You don\'t have the "Prime" (admin) role']}
        howToFix={[
          'The "Prime" role is automatically held by the first user who registered on this Primordia instance. It cannot be granted by other users.',
        ]}
      />
    );
  }

  const sessionUser = { id: user.id, username: user.username, isAdmin: true };
  let branch: string | null = null;
  try {
    branch = execSync("git branch --show-current", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim() || null;
  } catch { /* ignore */ }

  return (
    <main className="flex flex-col w-full max-w-3xl mx-auto px-4 py-6 min-h-dvh">
      <PageNavBar subtitle="Shell" currentPage="oops" initialSession={sessionUser} branch={branch} />
      <OopsShell />
    </main>
  );
}
