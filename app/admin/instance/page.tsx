// app/admin/instance/page.tsx — Instance identity + social graph admin panel.
// Admin only.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { buildPageTitle } from "@/lib/page-title";
import ForbiddenPage from "@/components/ForbiddenPage";
import { PageNavBar } from "@/components/PageNavBar";
import AdminSubNav from "@/components/AdminSubNav";
import InstanceConfigClient from "./InstanceConfigClient";

export function generateMetadata(): Metadata {
  return {
    title: buildPageTitle("Instance"),
    description: "Manage instance identity and social graph.",
  };
}

export default async function AdminInstancePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const adminCheck = await isAdmin(user.id);
  if (!adminCheck) {
    return (
      <ForbiddenPage
        pageDescription="Manage this instance's identity (name, description, UUID) and view the social graph of known peer instances."
        requiredConditions={["Be logged in", "Have the admin role"]}
        metConditions={["You are logged in"]}
        unmetConditions={["You don't have the admin role"]}
        howToFix={["The admin role is automatically held by the first user who registered."]}
      />
    );
  }

  const db = await getDb();
  const [config, nodes, edges] = await Promise.all([
    db.getInstanceConfig(),
    db.getGraphNodes(),
    db.getGraphEdges(),
  ]);

  return (
    <div className="min-h-screen bg-black text-white">
      <PageNavBar currentPage="admin" />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-white mb-6">Admin</h1>
        <AdminSubNav currentTab="instance" />
        <InstanceConfigClient
          config={config}
          nodes={nodes}
          edges={edges}
        />
      </div>
    </div>
  );
}
