import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Skip type-checking and linting during `next build` — these run manually instead.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },

  // Tell webpack not to bundle bun:sqlite. It's only available at runtime in
  // the Bun environment. The sqlite adapter is always used (no Neon fallback).
  webpack: (config) => {
    config.externals = [...(config.externals ?? []), "bun:sqlite"];
    return config;
  },
};

export default nextConfig;
