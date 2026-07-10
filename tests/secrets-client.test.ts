// tests/secrets-client.test.ts
// Unit tests for lib/secrets-client.ts using bun:test.
//
// Bun provides WebCrypto X25519/Ed25519/AES-GCM, so these tests exercise the
// real browser crypto path. localStorage and fetch are simulated in memory.
//
// Run: bun test tests/secrets-client.test.ts

import { describe, test, expect, beforeEach } from "bun:test";

const _ls: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => _ls[k] ?? null,
  setItem: (k: string, v: string) => { _ls[k] = v; },
  removeItem: (k: string) => { delete _ls[k]; },
};

(globalThis as Record<string, unknown>).window = globalThis;
(globalThis as Record<string, unknown>).localStorage = mockLocalStorage;

const _serverStore: Map<string, string> = new Map(); // source → JSON ciphertext blob
const _serverKeys: Map<string, JsonWebKey> = new Map(); // source → X25519 public JWK
const _nonces: Map<string, string> = new Map(); // source → nonce

function bytesToBase64Url(bytes: Uint8Array): string {
  return (bytes as Uint8Array & { toBase64(options?: { alphabet?: "base64url"; omitPadding?: boolean }): string })
    .toBase64({ alphabet: "base64url", omitPadding: true });
}

function base64UrlToBytes(value: string): Uint8Array {
  return (Uint8Array as typeof Uint8Array & { fromBase64(encoded: string, options?: { alphabet?: "base64url" }): Uint8Array })
    .fromBase64(value, { alphabet: "base64url" });
}

async function getServerPublicKey(source: string): Promise<JsonWebKey> {
  const existing = _serverKeys.get(source);
  if (existing) return existing;
  const pair = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]) as CryptoKeyPair;
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  _serverKeys.set(source, publicJwk);
  return publicJwk;
}

function makeFetch() {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(typeof input === "object" && "url" in input ? (input as Request).url : input);
    const method = (init?.method ?? "GET").toUpperCase();

    const keyMatch = url.match(/\/api\/secrets\/([a-z-]+)\/server-public-key$/);
    if (keyMatch && method === "GET") {
      const source = keyMatch[1];
      const nonce = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
      _nonces.set(source, nonce);
      return Response.json({ publicKey: await getServerPublicKey(source), nonce });
    }

    if (/\/api\/secrets$/.test(url) && method === "GET") {
      return Response.json({ sources: Array.from(_serverStore.keys()) });
    }

    const m = url.match(/\/api\/secrets\/([a-z-]+)$/);
    if (m) {
      const source = m[1];
      if (method === "GET") return Response.json({ ciphertext: _serverStore.get(source) ?? null });
      if (method === "POST") {
        const body = JSON.parse(init?.body as string) as { iv: string; ciphertext: string };
        _serverStore.set(source, JSON.stringify(body));
        return Response.json({ ok: true });
      }
      if (method === "DELETE") {
        _serverStore.delete(source);
        return Response.json({ ok: true });
      }
    }

    return new Response("not found", { status: 404 });
  };
}

import { setSecret, getSecret, clearSecret, getCredentialProofForServer, clearOrphanedSecretsKey } from "@/lib/secrets-client";

describe("secrets-client", () => {
  beforeEach(() => {
    _serverStore.clear();
    _serverKeys.clear();
    _nonces.clear();
    for (const k of Object.keys(_ls)) delete _ls[k];
    (globalThis as Record<string, unknown>).fetch = makeFetch();
    clearOrphanedSecretsKey();
  });

  test("getSecret returns null when server has no ciphertext", async () => {
    expect(await getSecret("anthropic-api-key")).toBeNull();
  });

  test("setSecret + getSecret round-trips plaintext correctly", async () => {
    const plaintext = "sk-ant-api03-my-test-key-abc123";
    await setSecret("anthropic-api-key", plaintext);
    expect(_serverStore.has("anthropic-api-key")).toBe(true);
    expect(await getSecret("anthropic-api-key")).toBe(plaintext);
  });

  test("getSecret returns null when local secret is absent but ciphertext exists", async () => {
    _serverStore.set("openrouter-api-key", JSON.stringify({ iv: "AAAAAAAAAAAAAAAA", ciphertext: "AAAAAAAAAA" }));
    expect(await getSecret("openrouter-api-key")).toBeNull();
  });

  test("multiple secret sources are encrypted independently", async () => {
    await setSecret("anthropic-api-key", "sk-ant-key");
    await setSecret("openrouter-api-key", "sk-or-key");

    expect(await getSecret("anthropic-api-key")).toBe("sk-ant-key");
    expect(await getSecret("openrouter-api-key")).toBe("sk-or-key");

    const antPayload = JSON.parse(_serverStore.get("anthropic-api-key") ?? "{}") as { serverPublicKey?: JsonWebKey };
    const orPayload = JSON.parse(_serverStore.get("openrouter-api-key") ?? "{}") as { serverPublicKey?: JsonWebKey };
    expect(antPayload.serverPublicKey?.x).not.toBe(orPayload.serverPublicKey?.x);
  });

  test("clearSecret removes the secret from the server", async () => {
    await setSecret("anthropic-api-key", "sk-ant-to-be-deleted");
    await clearSecret("anthropic-api-key");
    expect(_serverStore.has("anthropic-api-key")).toBe(false);
    expect(await getSecret("anthropic-api-key")).toBeNull();
  });

  test("clearSecret does not affect other stored secrets", async () => {
    await setSecret("anthropic-api-key", "sk-ant-key");
    await setSecret("openrouter-api-key", "sk-or-key");
    await clearSecret("anthropic-api-key");
    expect(await getSecret("anthropic-api-key")).toBeNull();
    expect(await getSecret("openrouter-api-key")).toBe("sk-or-key");
  });

  test("credential proof signs the server nonce with an auth-source-specific Ed25519 key", async () => {
    const proof = await getCredentialProofForServer("anthropic-api-key");
    expect(proof).not.toBeNull();
    const nonce = _nonces.get("anthropic-api-key");
    expect(proof?.nonce).toBe(nonce);

    const verifyKey = await crypto.subtle.importKey("jwk", proof!.signingPublicKey, { name: "Ed25519" }, false, ["verify"]);
    const ok = await crypto.subtle.verify(
      { name: "Ed25519" },
      verifyKey,
      base64UrlToBytes(proof!.signature),
      new TextEncoder().encode(`anthropic-api-key:${proof!.nonce}:${proof!.secretPublicKey.x ?? ""}`),
    );
    expect(ok).toBe(true);

    const otherProof = await getCredentialProofForServer("openrouter-api-key");
    expect(otherProof?.secretPublicKey.x).not.toBe(proof?.secretPublicKey.x);
    expect(otherProof?.signingPublicKey.x).not.toBe(proof?.signingPublicKey.x);
  });
});
