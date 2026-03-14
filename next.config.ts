import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Expose Vercel system env vars to client components.
  // Next.js inlines `env` values at build time, so they work in "use client" code.
  env: {
    VERCEL_ENV: process.env.VERCEL_ENV ?? "",
    VERCEL_GIT_PULL_REQUEST_NUMBER: process.env.VERCEL_GIT_PULL_REQUEST_NUMBER ?? "",
    VERCEL_GIT_REPO_OWNER: process.env.VERCEL_GIT_REPO_OWNER ?? "",
    VERCEL_GIT_REPO_SLUG: process.env.VERCEL_GIT_REPO_SLUG ?? "",
  },
};

export default nextConfig;
