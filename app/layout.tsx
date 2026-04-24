import type { Metadata } from "next";
import { headers } from "next/headers";
import { getPublicOrigin } from "@/lib/public-origin";
import { ensureCanonicalUrl } from "@/lib/auto-canonical";
import "./globals.css";

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "Primordia",
  description: "A self-modifying web application that evolves based on your instructions.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // On the very first request, auto-detect and persist the canonical URL
  // if the admin hasn't set one yet.
  const hdrs = await headers();
  const origin = getPublicOrigin({ headers: hdrs, url: "http://localhost" } as Request);
  await ensureCanonicalUrl(origin);

  return (
    <html lang="en">
      <body className="font-mono antialiased bg-gray-950 text-gray-100">
        {children}
      </body>
    </html>
  );
}
