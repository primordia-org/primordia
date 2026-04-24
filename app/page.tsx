// app/page.tsx — Landing page for Primordia
// Server component: reads headers() to build the setup URL, then renders
// section components so the Pick tool sees real names.

import type { Metadata } from "next";
import { headers } from "next/headers";
import { execSync } from "child_process";
import { buildPageTitle } from "@/lib/page-title";
import { basePath } from "@/lib/base-path";
import { LandingNav } from "./LandingNav";
import {
  HeroSection,
  FeaturesSection,
  HowItWorksSection,
  CTABannerSection,
  LandingFooter,
} from "./LandingSections";
import { createNameId } from "mnemonic-id";

export function generateMetadata(): Metadata {
  return { title: buildPageTitle() };
}

function getCurrentBranch(): string | null {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim() || null;
  } catch {
    return null;
  }
}

export default async function LandingPage() {
  const headerStore = await headers();
  const proto = headerStore.get("x-forwarded-proto") ?? "https";
  const host =
    headerStore.get("x-forwarded-host") ??
    headerStore.get("host") ??
    "primordia.exe.xyz";
  // On a preview deploy, NEXT_BASE_PATH is /preview/{sessionId}. Append the
  // branch name so the curl-pipe command installs that specific branch.
  const isPreview = basePath.startsWith("/preview/");
  const branch = isPreview ? getCurrentBranch() : null;
  const installUrl = `${proto}://${host}${basePath}/install.sh`;
  const defaultVmName = createNameId();
  return (
    <div className="min-h-dvh bg-gray-950 text-gray-100 overflow-x-hidden">
      <LandingNav />
      <HeroSection installUrl={installUrl} defaultVmName={defaultVmName} installBranch={branch} />
      <FeaturesSection />
      <HowItWorksSection />
      <CTABannerSection installUrl={installUrl} defaultVmName={defaultVmName} installBranch={branch} />
      <LandingFooter />
    </div>
  );
}
