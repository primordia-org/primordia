import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    swcPlugins: [["swc-plugin-component-annotate", {}]],
  },
  // Optional base path — set NEXT_BASE_PATH=/my-prefix to serve the app at a sub-path.
  // Leave unset (or empty) to serve from the root (default behaviour).
  basePath: process.env.NEXT_BASE_PATH ?? "",

  // Expose the base path to client-side code so fetch() calls can prefix API routes.
  // Next.js <Link>, router.push(), and redirect() are basePath-aware automatically;
  // plain fetch() calls are not, so they import withBasePath() from lib/base-path.ts.
  env: {
    NEXT_PUBLIC_BASE_PATH: process.env.NEXT_BASE_PATH ?? "",
  },

  // Skip type-checking during `next build` — these run manually instead.
  // Note: ESLint config was removed in Next.js 16; ESLint is no longer run during builds.
  typescript: { ignoreBuildErrors: true },

  // Map /.well-known/primordia.json → /api/instance/primordia-json
  async rewrites() {
    return [
      {
        source: "/.well-known/primordia.json",
        destination: "/api/instance/primordia-json",
      },
    ];
  },

  // Allow HMR WebSocket connections from exe.dev reverse-proxy hostnames.
  // Next.js 16 blocks cross-origin requests to dev resources by default.
  allowedDevOrigins: ["*.exe.xyz"],

  // Tell Next.js not to bundle the pi coding agent SDK. It uses native modules
  // (e.g. @mariozechner/clipboard) that can't be processed by Turbopack/webpack.
  // Keeping it external means it runs in the Node.js server process as-is.
  serverExternalPackages: ['@mariozechner/pi-coding-agent', '@mariozechner/pi-ai', '@mariozechner/clipboard'],

  // Tell webpack not to bundle bun:sqlite. It's only available at runtime in
  // the Bun environment. The sqlite adapter is always used (no Neon fallback).
  // (webpack is used for `next build`; turbopack is used for `next dev --turbopack`)
  webpack: (config) => {
    config.externals = [...(config.externals ?? []), "bun:sqlite"];
    return config;
  },

  // Tell Turbopack not to bundle bun:sqlite either — same reason as above.
  turbopack: {
    resolveAlias: {
      "bun:sqlite": "bun:sqlite",
    },
  },
};

export default nextConfig;
