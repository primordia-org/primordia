#!/usr/bin/env bun
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGE_SCOPE_DIR = join(process.cwd(), 'node_modules', '@anthropic-ai');
const PACKAGE_PREFIX = 'claude-agent-sdk-linux';
const SUPPORTED_LINUX_ARCHES = new Set(['x64', 'arm64']);

type ProcessReport = {
  header?: {
    glibcVersionRuntime?: string;
  };
};

function isMuslRuntime(): boolean {
  if (process.platform !== 'linux') return false;
  const report = typeof process.report?.getReport === 'function' ? process.report.getReport() as ProcessReport : null;
  return report?.header?.glibcVersionRuntime === undefined;
}

function removePackage(packageName: string): void {
  const packageDir = join(PACKAGE_SCOPE_DIR, packageName);
  if (!existsSync(packageDir)) return;
  rmSync(packageDir, { recursive: true, force: true });
  console.log(`Removed unused optional package @anthropic-ai/${packageName}`);
}

if (process.platform === 'linux' && SUPPORTED_LINUX_ARCHES.has(process.arch)) {
  const basePackage = `${PACKAGE_PREFIX}-${process.arch}`;
  const muslPackage = `${basePackage}-musl`;

  // Bun 1.4 filters optional native packages by os/cpu, but currently ignores npm's
  // non-standard "libc" package field. The Claude Agent SDK publishes both glibc
  // and musl Linux binaries as optional dependencies; each binary is roughly 200 MB.
  // Keep the package that matches this runtime and remove the incompatible fallback.
  removePackage(isMuslRuntime() ? basePackage : muslPackage);
}
