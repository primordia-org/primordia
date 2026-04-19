// app/login/page.tsx — Server component: resolves session + gathers per-plugin
// server props, then delegates to the client-side login UI.

import { headers } from "next/headers";
import type { Metadata } from "next";
import { getSessionUser } from "@/lib/auth";
import { getInstalledPluginsWithProps } from "@/lib/auth-plugins/registry";
import LoginClient from "./LoginClient";
import { buildPageTitle } from "@/lib/page-title";

export function generateMetadata(): Metadata {
  return { title: buildPageTitle("Login") };
}

export default async function LoginPage() {
  const user = await getSessionUser();
  const initialUser = user ? { id: user.id, username: user.username } : null;

  // Collect server-side data for each installed auth plugin (e.g. exe.dev email header).
  const headerStore = await headers();
  const plugins = await getInstalledPluginsWithProps({ headers: headerStore });

  return <LoginClient initialUser={initialUser} plugins={plugins} />;
}
