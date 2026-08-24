#!/usr/bin/env bun
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

type ProcessReport = {
  header?: {
    glibcVersionRuntime?: string;
  };
};

type LinuxLibcPackagePair = {
  scopeDir: string;
  gnuPackage: string;
  muslPackage: string;
};

const SUPPORTED_LINUX_ARCHES = new Set(['x64', 'arm64']);

function isMuslRuntime(): boolean {
  if (process.platform !== 'linux') return false;
  const report = typeof process.report?.getReport === 'function' ? process.report.getReport() as ProcessReport : null;
  return report?.header?.glibcVersionRuntime === undefined;
}

function removePackage(scopeDir: string, packageName: string): void {
  const packageDir = join(scopeDir, packageName);
  if (!existsSync(packageDir)) return;
  rmSync(packageDir, { recursive: true, force: true });
  console.log(`Removed unused optional package ${scopeDirLabel(scopeDir)}/${packageName}`);
}

function scopeDirLabel(scopeDir: string): string {
  return scopeDir.slice(join(process.cwd(), 'node_modules').length + 1);
}

function pruneLinuxLibcPackagePairs(pairs: LinuxLibcPackagePair[]): void {
  const muslRuntime = isMuslRuntime();
  for (const pair of pairs) {
    removePackage(pair.scopeDir, muslRuntime ? pair.gnuPackage : pair.muslPackage);
  }
}

if (process.platform === 'linux' && SUPPORTED_LINUX_ARCHES.has(process.arch)) {
  const anthropicScopeDir = join(process.cwd(), 'node_modules', '@anthropic-ai');
  const nextScopeDir = join(process.cwd(), 'node_modules', '@next');

  // Workaround: Bun 1.4 filters optional native packages by os/cpu, but currently
  // ignores libc-specific package metadata/naming. Some packages publish both glibc
  // and musl Linux binaries as optional dependencies; each binary can exceed 100 MB.
  //
  // Ideal scenario: the package manager would install exactly one libc variant
  // during dependency resolution, either by honoring package metadata such as a
  // libc field or by recognizing the established -gnu/-musl package split. Once
  // Bun does that, this postinstall prune should be removed so installs are fully
  // handled by normal dependency resolution instead of a cleanup step.
  //
  // Until then, keep the package that matches this runtime and remove the
  // incompatible fallback.
  pruneLinuxLibcPackagePairs([
    {
      scopeDir: anthropicScopeDir,
      gnuPackage: `claude-agent-sdk-linux-${process.arch}`,
      muslPackage: `claude-agent-sdk-linux-${process.arch}-musl`,
    },
    {
      scopeDir: nextScopeDir,
      gnuPackage: `swc-linux-${process.arch}-gnu`,
      muslPackage: `swc-linux-${process.arch}-musl`,
    },
  ]);
}
