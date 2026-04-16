// app/register-passkey/page.tsx — Server component.
// Shown after exe.dev login when the user has no passkeys yet.
// Prompts them to register a passkey so the account is accessible via either
// login method in the future.

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSessionUser } from "@/lib/auth";
import { buildPageTitle } from "@/lib/page-title";
import RegisterPasskeyClient from "./RegisterPasskeyClient";

export function generateMetadata(): Metadata {
  return { title: buildPageTitle("Register Passkey") };
}

interface Props {
  searchParams: Promise<{ next?: string }>;
}

export default async function RegisterPasskeyPage({ searchParams }: Props) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  const { next = "/" } = await searchParams;

  return (
    <RegisterPasskeyClient
      username={user.username}
      nextUrl={next}
    />
  );
}
