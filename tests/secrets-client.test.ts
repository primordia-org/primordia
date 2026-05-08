// tests/secrets-client.test.ts
// Unit tests for lib/secrets-client.ts using bun:test.
//
// Bun provides crypto.subtle natively so real AES-GCM operations run without
// mocking. localStorage and fetch are simulated via in-memory stubs.
//
// Run: bun test tests/secrets-client.test.ts

import { describe, test, expect, beforeEach } from "bun:test";

// ── Browser environment stubs ────────────────────────────────────────────────
// secrets-client.ts guards every export with `typeof window === 'undefined'`
// and reads/writes `localStorage`. We supply minimal stubs before the module
// is imported so those guards pass and storage works.

const _ls: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => _ls[k] ?? null,
  setItem: (k: string, v: string) => { _ls[k] = v; },
  removeItem: (k: string) => { delete _ls[k]; },
};

// Setting these on globalThis before any test callback runs is enough — the
// module-level code in secrets-client.ts only defines constants and functions;
// it never calls window/localStorage at import time.
(globalThis as Record<string, unknown>).window = globalThis;
(globalThis as Record<string, unknown>).localStorage = mockLocalStorage;

// ── In-memory mock server ────────────────────────────────────────────────────
// Mirrors what /api/secrets/[type] and /api/secrets do.

const _serverStore: Map<string, string> = new Map(); // type → JSON ciphertext blob

function makeFetch() {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(typeof input === "object" && "url" in input ? (input as Request).url : input);
    const method = (init?.method ?? "GET").toUpperCase();

    // GET /api/secrets  →  { types: [...] }
    if (/\/api\/secrets$/.test(url) && method === "GET") {
      return new Response(
        JSON.stringify({ types: Array.from(_serverStore.keys()) }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // /api/secrets/:type
    const m = url.match(/\/api\/secrets\/([A-Z_]+)$/);
    if (m) {
      const type = m[1];
      if (method === "GET") {
        const blob = _serverStore.get(type) ?? null;
        return new Response(
          JSON.stringify({ ciphertext: blob }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (method === "POST") {
        const body = JSON.parse(init?.body as string) as { iv: string; ciphertext: string };
        _serverStore.set(type, JSON.stringify(body));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (method === "DELETE") {
        _serverStore.delete(type);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
    }

    return new Response("not found", { status: 404 });
  };
}

// Import after globals are set up so the module's guards work on first call.
// ESM imports are hoisted, but guards only run when functions are *called*.
import { setSecret, getSecret, clearSecret } from "../lib/secrets-client";

// ── Test suite ───────────────────────────────────────────────────────────────

describe("secrets-client", () => {
  beforeEach(() => {
    // Clear server store and localStorage between tests.
    _serverStore.clear();
    for (const k of Object.keys(_ls)) delete _ls[k];
    // Install a fresh fetch mock.
    (globalThis as Record<string, unknown>).fetch = makeFetch();
  });

  test("getSecret returns null when server has no ciphertext", async () => {
    // Server store is empty. Even if an AES key existed, there is nothing to decrypt.
    // setSecret has not been called yet, so no AES key in localStorage either.
    const result = await getSecret("ANTHROPIC_API_KEY");
    expect(result).toBeNull();
  });

  test("setSecret + getSecret round-trips plaintext correctly", async () => {
    const plaintext = "sk-ant-api03-my-test-key-abc123";
    await setSecret("ANTHROPIC_API_KEY", plaintext);

    // Server store should now hold an encrypted blob.
    expect(_serverStore.has("ANTHROPIC_API_KEY")).toBe(true);

    // getSecret should decrypt it back to the original value.
    const result = await getSecret("ANTHROPIC_API_KEY");
    expect(result).toBe(plaintext);
  });

  test("getSecret returns null when AES key is absent but ciphertext exists", async () => {
    // Manually put a dummy blob in the server store (as if stored by another device)
    // but do NOT put any AES key in localStorage on this "device".
    _serverStore.set(
      "OPENROUTER_API_KEY",
      JSON.stringify({ iv: "AAAAAAAAAAAAAAAA", ciphertext: "AAAAAAAAAA" }),
    );

    // No AES key → loadAesKey() returns null → getSecret returns null.
    const result = await getSecret("OPENROUTER_API_KEY");
    expect(result).toBeNull();
  });

  test("multiple secret types are independent", async () => {
    const anthropicKey = "sk-ant-api03-anthro-key";
    const openrouterKey = "sk-or-v1-openrouter-key";

    await setSecret("ANTHROPIC_API_KEY", anthropicKey);
    await setSecret("OPENROUTER_API_KEY", openrouterKey);

    expect(await getSecret("ANTHROPIC_API_KEY")).toBe(anthropicKey);
    expect(await getSecret("OPENROUTER_API_KEY")).toBe(openrouterKey);
  });

  test("clearSecret removes the secret from the server", async () => {
    await setSecret("ANTHROPIC_API_KEY", "sk-ant-to-be-deleted");
    expect(_serverStore.has("ANTHROPIC_API_KEY")).toBe(true);

    await clearSecret("ANTHROPIC_API_KEY");

    // Server store should no longer hold the secret.
    expect(_serverStore.has("ANTHROPIC_API_KEY")).toBe(false);

    // getSecret returns null when the server has nothing to decrypt.
    expect(await getSecret("ANTHROPIC_API_KEY")).toBeNull();
  });

  test("clearSecret does not affect other stored secrets", async () => {
    await setSecret("ANTHROPIC_API_KEY", "sk-ant-key");
    await setSecret("OPENROUTER_API_KEY", "sk-or-key");

    await clearSecret("ANTHROPIC_API_KEY");

    // Anthropic key is gone; OpenRouter key is still decryptable.
    expect(await getSecret("ANTHROPIC_API_KEY")).toBeNull();
    expect(await getSecret("OPENROUTER_API_KEY")).toBe("sk-or-key");
  });
});
