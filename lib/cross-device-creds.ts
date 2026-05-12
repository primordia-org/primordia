// lib/cross-device-creds.ts
// Client-side ECDH P-256 helpers for credential transfer in both QR flows.
//
// Primordia has exactly one browser credential AES key: localStorage
// `primordia_aes_key`. Cross-device auth transfers only that key.

/** URL-safe base64 encode (no padding). */
export function b64uEncodeAb(ab: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(ab)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/** URL-safe base64 decode to ArrayBuffer. */
export function b64uDecodeAb(s: string): ArrayBuffer {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

/** Generate an ephemeral ECDH P-256 keypair for the requester (no-session) device. */
export async function generateEcdhKeypair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"]
  );
}

/**
 * Export a P-256 ECDH public key as URL-safe base64 (raw, 65 bytes → ~87 chars).
 * Small enough to embed as a URL query parameter in the QR code.
 */
export async function exportEcdhPubKeyB64u(publicKey: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", publicKey);
  return b64uEncodeAb(raw);
}

/** The encrypted credential bundle stored on the server and returned by the poll route. */
export interface EncryptedCredBundle {
  /** Approver's ephemeral ECDH public key (base64url, raw P-256 = 65 bytes). */
  bPubKey: string;
  /** AES-GCM IV (base64url, 12 bytes). */
  iv: string;
  /** AES-GCM ciphertext of JSON `{ aesKey: string }` (base64url). */
  ciphertext: string;
}

/**
 * Called on the approver device. Encrypts its Primordia AES key for the
 * requester device using ECDH P-256 key exchange.
 */
export async function encryptCredentialsForRequester(
  requesterPubB64u: string,
  aesKeyJwk: string | null,
): Promise<EncryptedCredBundle | null> {
  if (!aesKeyJwk) return null;

  const requesterPubKey = await crypto.subtle.importKey(
    "raw",
    b64uDecodeAb(requesterPubB64u),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  const bPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"]
  );

  const sharedKey = await crypto.subtle.deriveKey(
    { name: "ECDH", public: requesterPubKey },
    bPair.privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify({ aesKey: aesKeyJwk }));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, sharedKey, plaintext);
  const bPubRaw = await crypto.subtle.exportKey("raw", bPair.publicKey);

  return {
    bPubKey: b64uEncodeAb(bPubRaw),
    iv: b64uEncodeAb(iv.buffer),
    ciphertext: b64uEncodeAb(ciphertext),
  };
}

/**
 * Called on the requester device after the poll returns an encrypted bundle.
 * Decrypts using the ephemeral private key kept in memory.
 */
export async function decryptReceivedCredentials(
  privateKey: CryptoKey,
  bundle: EncryptedCredBundle
): Promise<string | null> {
  const bPubKey = await crypto.subtle.importKey(
    "raw",
    b64uDecodeAb(bundle.bPubKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  const sharedKey = await crypto.subtle.deriveKey(
    { name: "ECDH", public: bPubKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  const iv = new Uint8Array(b64uDecodeAb(bundle.iv));
  const ciphertext = b64uDecodeAb(bundle.ciphertext);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, sharedKey, ciphertext);
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as { aesKey?: string | null };
  return parsed.aesKey ?? null;
}

// ── Push flow (ECIES) ────────────────────────────────────────────────────────

/**
 * Encrypted credential bundle for the push flow.
 * Stored on the server; returned by the poll route when the push token is approved.
 */
export interface PushCredBundle {
  /** Sender's (Device A's) ephemeral ECDH P-256 public key (base64url, raw, 65 bytes). */
  senderPubKey: string;
  /** AES-GCM IV (base64url, 12 bytes). */
  iv: string;
  /** AES-GCM ciphertext of JSON `{ aesKey: string }` (base64url). */
  ciphertext: string;
}

/**
 * Called on Device A (the sender, already signed in).
 * Encrypts its Primordia AES key for Device B.
 */
export async function encryptCredentialsForPush(
  aesKeyJwk: string | null,
): Promise<{ receiverPrivB64u: string; bundle: PushCredBundle } | null> {
  if (!aesKeyJwk) return null;

  const aPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"]
  );
  const bPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"]
  );

  const sharedKey = await crypto.subtle.deriveKey(
    { name: "ECDH", public: bPair.publicKey },
    aPair.privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify({ aesKey: aesKeyJwk }));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, sharedKey, plaintext);
  const aPubRaw = await crypto.subtle.exportKey("raw", aPair.publicKey);
  const bPrivPkcs8 = await crypto.subtle.exportKey("pkcs8", bPair.privateKey);

  return {
    receiverPrivB64u: b64uEncodeAb(bPrivPkcs8),
    bundle: {
      senderPubKey: b64uEncodeAb(aPubRaw),
      iv: b64uEncodeAb(iv.buffer),
      ciphertext: b64uEncodeAb(ciphertext),
    },
  };
}

/**
 * Called on Device B (the receiver) after reading its private key from the QR fragment.
 */
export async function decryptPushCredentials(
  receiverPrivB64u: string,
  bundle: PushCredBundle
): Promise<string | null> {
  const bPriv = await crypto.subtle.importKey(
    "pkcs8",
    b64uDecodeAb(receiverPrivB64u),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveKey"]
  );

  const aPub = await crypto.subtle.importKey(
    "raw",
    b64uDecodeAb(bundle.senderPubKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  const sharedKey = await crypto.subtle.deriveKey(
    { name: "ECDH", public: aPub },
    bPriv,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  const iv = new Uint8Array(b64uDecodeAb(bundle.iv));
  const ciphertext = b64uDecodeAb(bundle.ciphertext);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, sharedKey, ciphertext);
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as { aesKey?: string | null };
  return parsed.aesKey ?? null;
}
