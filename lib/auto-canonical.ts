// lib/auto-canonical.ts
// On the first request that reaches the server, if no canonical URL has been
// configured yet, derive one from the request's public origin (respecting
// x-forwarded-proto / x-forwarded-host) and persist it to the DB.
// If the installer provided PRIMORDIA_PARENT_URL (or the git origin points at a
// parent instance's /api/git), persist that too and register with the parent once
// this instance has a public canonical URL.
//
// Uses a module-level flag so the DB is only checked once per process.

import { execFileSync } from "child_process";
import { getDb } from "./db";
import { registerWithParent } from "./register-with-parent";
import { validateCanonicalUrl } from "./validate-canonical-url";

let checked = false;

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function parentUrlFromGitRemote(): string {
  try {
    const remoteUrl = execFileSync("git", ["-C", process.cwd(), "config", "--get", "remote.origin.url"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!remoteUrl.startsWith("http")) return "";
    return normalizeUrl(remoteUrl.replace(/\/api\/git\/?$/, ""));
  } catch {
    return "";
  }
}

function getInstallerParentUrl(): string {
  const parentUrl = normalizeUrl(process.env.PRIMORDIA_PARENT_URL ?? "") || parentUrlFromGitRemote();
  if (!parentUrl) return "";
  if (!parentUrl.startsWith("http")) {
    console.warn(`[primordia] auto-canonical: ignoring invalid parent URL: ${parentUrl}`);
    return "";
  }
  return parentUrl;
}

export async function ensureCanonicalUrl(origin: string): Promise<void> {
  if (checked) return;
  checked = true;

  try {
    const db = await getDb();
    const config = await db.getInstanceConfig();
    const normalizedOrigin = normalizeUrl(origin);
    const originIsValid = validateCanonicalUrl(normalizedOrigin) === null;
    const installerParentUrl = getInstallerParentUrl();
    const effectiveCanonicalUrl = normalizeUrl(config.canonicalUrl) || (originIsValid ? normalizedOrigin : "");

    const fields: { canonicalUrl?: string; parentUrl?: string } = {};

    if (!config.canonicalUrl) {
      if (originIsValid) {
        fields.canonicalUrl = normalizedOrigin;
      } else {
        console.log(
          `[primordia] auto-canonical: skipping non-HTTPS or localhost origin: ${normalizedOrigin}`
        );
      }
    }

    if (!config.parentUrl && installerParentUrl && installerParentUrl !== effectiveCanonicalUrl) {
      fields.parentUrl = installerParentUrl;
    }

    const hasChanges = Object.keys(fields).length > 0;
    let updated = config;
    if (hasChanges) {
      await db.setInstanceConfig(fields);
      updated = await db.getInstanceConfig();
    }

    const hasParent = !!normalizeUrl(updated.parentUrl);
    const hasCanonical = !!normalizeUrl(updated.canonicalUrl);

    if (hasParent && hasCanonical) {
      // Best-effort once per process. This repairs children that missed their
      // initial registration and retries after transient parent/network errors.
      const status = await registerWithParent(updated);
      if (status) {
        console.log(`[primordia] Parent registration: ${status}`);
      }
    }

    if (fields.canonicalUrl) {
      console.log(`[primordia] Auto-detected canonical URL: ${fields.canonicalUrl}`);
    }

    if (!hasCanonical) {
      // Try again on the next request; the first request may have been an
      // internal localhost health check before public HTTPS traffic arrived.
      checked = false;
    }
  } catch (err) {
    // Non-fatal — log and move on.
    console.warn("[primordia] auto-canonical: failed to set canonical URL:", err);
    // Reset flag so we try again on the next request.
    checked = false;
  }
}
