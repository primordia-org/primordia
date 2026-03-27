// app/login/page.tsx — Server component: resolves the current session and
// passes it to the client component. No API round-trip on the browser side.

import { headers } from "next/headers";
import type { Metadata } from "next";
import { getSessionUser } from "@/lib/auth";
import LoginClient from "./LoginClient";
import { buildPageTitle } from "@/lib/page-title";

export function generateMetadata(): Metadata {
  return { title: buildPageTitle("Login") };
}

export default async function LoginPage() {
  const user = await getSessionUser();
  const initialUser = user ? { id: user.id, username: user.username } : null;

  // exe.dev's HTTP proxy injects X-ExeDev-Email for authenticated users.
  // Pass it to the client so the exe.dev tab can show which account will be used.
  const headerStore = await headers();
  const exeDevEmail = headerStore.get("x-exedev-email") ?? null;

  return <LoginClient initialUser={initialUser} exeDevEmail={exeDevEmail} />;
}
