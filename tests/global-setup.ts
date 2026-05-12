/**
 * Playwright global setup: creates a test user session via the exe.dev SSO
 * route (which accepts the x-exedev-email header in local dev without a proxy)
 * and saves the cookies to tests/.auth/session.json for all tests to reuse.
 *
 * Also grants the test user `can_evolve` via the admin API (requires the test
 * user to be the first user / have admin role, which happens automatically on
 * first run against a fresh DB).
 */

import { chromium, type FullConfig } from "@playwright/test";
import path from "path";
import fs from "fs";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const TEST_EMAIL = "playwright-test@example.com";
const AUTH_DIR = path.join(__dirname, ".auth");
const AUTH_FILE = path.join(AUTH_DIR, "session.json");

export default async function globalSetup(config: FullConfig) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // Hit the exe-dev SSO route with the email header injected.
  // In local dev (no exe.dev proxy) the route trusts this header directly.
  // The response sets a session cookie and redirects to /register-passkey
  // (because the test user has no passkeys). We navigate there but then
  // immediately redirect to / — we only care about the cookie.
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (req.url().includes("/api/auth/exe-dev")) {
      await route.continue({
        headers: {
          ...req.headers(),
          "x-exedev-email": TEST_EMAIL,
        },
      });
    } else {
      await route.continue();
    }
  });

  // Navigate to the login route. It will set the cookie and redirect.
  await page.goto(`${BASE_URL}/api/auth/exe-dev?next=/`);
  // End up somewhere — just wait for load regardless of where
  await page.waitForLoadState("load");

  // If landed on /register-passkey, navigate away — we don't need to register.
  if (page.url().includes("register-passkey")) {
    await page.goto(BASE_URL);
    await page.waitForLoadState("load");
  }

  // Verify we have a valid session by checking /api/auth/session
  const sessionResp = await page.request.get(`${BASE_URL}/api/auth/session`);
  const session = await sessionResp.json().catch(() => null);
  if (!session?.user) {
    throw new Error(`Global setup: failed to create session. Response: ${JSON.stringify(session)}`);
  }

  const userId: string = session.user.id;
  console.log(`\n[global-setup] Logged in as ${TEST_EMAIL} (userId: ${userId})`);

  // Admin users have evolve permission via hasEvolvePermission() — no separate grant needed.
  // The session endpoint returns { user: { isAdmin: boolean } }.
  const isAdmin: boolean = session?.user?.isAdmin ?? false;

  if (!isAdmin) {
    throw new Error(
      `[global-setup] Test user ${TEST_EMAIL} is not admin. ` +
        `On a fresh DB the first registered user is automatically admin. ` +
        `If this DB has existing users, ensure ${TEST_EMAIL} is the first user or grant admin directly.`
    );
  }
  console.log(`[global-setup] User is admin — evolve permission confirmed.`);

  // Provision the user's Anthropic API key so evolve sessions can call the API.
  // Reads ANTHROPIC_API_KEY from the test runner env (or .env.local), then runs
  // the same browser-side flow as the UI: generate AES key, encrypt, POST ciphertext.
  const apiKey = readApiKeyFromEnv();
  if (!apiKey) {
    console.warn(
      "[global-setup] No ANTHROPIC_API_KEY found in env or .env.local — " +
        "evolve sessions will fail at the LLM call. Set the key via the UI or env to enable."
    );
  } else {
    // Navigate to a real app page so window.crypto + localStorage + same-origin fetch work.
    await page.goto(BASE_URL);
    await page.waitForLoadState("domcontentloaded");

    await page.evaluate(async (key: string) => {
      // Mirror lib/api-key-client.ts setStoredApiKey() exactly.
      const aesKey = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"],
      );
      const jwk = await crypto.subtle.exportKey("jwk", aesKey);
      localStorage.setItem("primordia_aes_key", JSON.stringify(jwk));

      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        aesKey,
        new TextEncoder().encode(key),
      );
      const ivB64 = btoa(String.fromCharCode(...iv));
      const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ct)));

      const res = await fetch("/api/secrets/anthropic-api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ iv: ivB64, ciphertext: ctB64 }),
      });
      if (!res.ok) throw new Error(`Failed to store key: ${res.status} ${await res.text()}`);
    }, apiKey);
    console.log("[global-setup] Anthropic API key provisioned.");
  }

  // Save cookies + localStorage so tests can load them with storageState.
  await context.storageState({ path: AUTH_FILE });
  console.log(`[global-setup] Session saved to ${AUTH_FILE}`);

  await browser.close();
}

function readApiKeyFromEnv(): string | null {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  // Fall back to .env.local in the project root
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return null;
  const content = fs.readFileSync(envPath, "utf8");
  const match = content.match(/^ANTHROPIC_API_KEY\s*=\s*(.+?)\s*$/m);
  if (!match) return null;
  return match[1].replace(/^["']|["']$/g, "");
}
