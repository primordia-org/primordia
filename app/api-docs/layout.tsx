// app/api-docs/layout.tsx
// Provides page metadata for the API Docs section.
// Metadata must be exported from a server component; the page itself is a
// client component, so we export metadata here in a thin layout wrapper.

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { buildPageTitle } from "@/lib/page-title";

export async function generateMetadata(): Promise<Metadata> {
  return { title: buildPageTitle("API Docs") };
}

export default function ApiDocsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
