// app/thread/[id]/page.tsx
// Dedicated thread page shell for a single local thread run.
// Thread details and logs are loaded by the client through Primordia Core.

import type { Metadata } from "next";
import { buildPageTitle } from "@/lib/page-title";
import { ThreadViewClient } from "./ThreadViewClient";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;

  return {
    title: buildPageTitle(id),
    description: "Live progress for a thread.",
  };
}

export interface DiffFileSummary {
  file: string;
  diffPath?: string;
  oldPath?: string;
  additions: number;
  deletions: number;
}

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <ThreadViewClient sessionId={id} isProduction={process.env.NODE_ENV === "production"} />;
}
