// app/evolve/page.tsx — The dedicated "propose a change" page
// Renders the EvolveForm client component. Kept as a thin server component
// to follow Next.js App Router conventions.

import type { Metadata } from "next";
import EvolveForm from "@/components/EvolveForm";

export const metadata: Metadata = {
  title: "Evolve — Primordia",
  description: "Propose a change to this app.",
};

export default function EvolvePage() {
  // Read NODE_ENV here (server component) so EvolveForm stays environment-agnostic.
  return <EvolveForm isLocalDev={process.env.NODE_ENV === "development"} />;
}
