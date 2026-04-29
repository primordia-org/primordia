# QR Login Dialog — Credential Sync for Both Flows

## What changed

### New files

- **`lib/cross-device-creds.ts`** — Client-side ECDH P-256 helpers shared by both QR flows. Pull-flow exports: `generateEcdhKeypair`, `exportEcdhPubKeyB64u`, `encryptCredentialsForRequester`, `decryptReceivedCredentials`. Push-flow additions: `PushCredBundle` interface, `encryptCredentialsForPush` (ECIES sender side), `decryptPushCredentials` (ECIES receiver side).

### Modified files

- **`components/QrSignInOtherDeviceDialog.tsx`** — The "Sign in on another device" hamburger dialog is upgraded to ECIES. Instead of embedding raw AES keys in the QR fragment, it generates two ephemeral ECDH P-256 keypairs (A = sender, B = receiver), encrypts credentials with ECDH(A_priv, B_pub), POSTs the encrypted bundle to the push endpoint, and embeds only the receiver's private key (`B_priv`, pkcs8, ~184 chars) in the QR fragment as `#priv=...`.

- **`app/login/cross-device-receive/page.tsx`** — Upgraded to ECIES push flow. Reads `#priv=<pkcs8_b64url>` from the URL fragment into a ref (clearing the fragment immediately), then calls `decryptPushCredentials` after the poll returns an approved bundle.

- **`components/auth-tabs/cross-device/index.tsx`** — The login-page pull-flow QR tab now participates in credential sync. On mount it generates an ephemeral ECDH P-256 keypair; the public key is appended to the QR image URL as `pk=<b64url>`. When the poll returns "approved" with an `encryptedCredentials` bundle, the tab decrypts it with the in-memory private key and saves the keys to localStorage. Description updated to reflect that credentials transfer now also works in the pull flow.

- **`app/login/approve/page.tsx`** — The approval page now reads an optional `pk=<ecdhPubKey>` query param. After the user approves, it reads its own AES keys from localStorage, encrypts them for the requester using ECDH P-256, and sends the encrypted bundle alongside the approval POST. A blue "Your credential keys will also be copied" notice appears before the Approve button when a `pk` is present and the approver has credentials. The success message confirms whether credentials were synced.

- **`lib/db/types.ts`** — Added `encryptedCredentials: string | null` to `CrossDeviceToken`. Updated `approveCrossDeviceToken` signature to accept an optional `encryptedCredentials` argument.

- **`lib/db/sqlite.ts`** — Added migration (`ALTER TABLE cross_device_tokens ADD COLUMN encrypted_credentials TEXT`). Updated `getCrossDeviceToken` to read the new column. Updated `approveCrossDeviceToken` to write it.

- **`app/api/auth/cross-device/approve/route.ts`** — Now accepts optional `encryptedCredentials: EncryptedCredBundle` in the POST body and stores it (as JSON string) on the token.

- **`app/api/auth/cross-device/poll/route.ts`** — When returning an "approved" response, includes the parsed `encryptedCredentials` object if the token carries one. The bundle is read before the token is deleted so it can be returned.

- **`app/api/auth/cross-device/qr/route.ts`** — Forwards an optional `pk=` query parameter to the destination URL so the public key travels through the server-generated QR code.

- **`app/api/auth/cross-device/push/route.ts`** — Now accepts `encryptedCredentials?: PushCredBundle | null` in the POST body, serialises it to JSON, and stores it on the pre-approved push token.

- **`app/api/auth/cross-device/start/route.ts`** — Added `encryptedCredentials: null` to the token creation call to satisfy the updated `CrossDeviceToken` type.

---

## Why

### Credential sync for the pull flow

The push flow (hamburger → "Sign in on another device") already copied credentials via the QR fragment. The pull flow (login page → QR tab) only issued a session — the new device had no API key or credential keys.

The ECDH approach keeps the same security properties as the push flow while routing through the server (since the pull flow QR is server-generated and can't carry secrets in a fragment):

1. **Requester generates an ephemeral ECDH P-256 keypair** on mount. The private key lives only in React state (`useRef`) and never leaves the browser.
2. **The public key is embedded in the QR URL** as `pk=<87-char base64url>`. It travels to the approver device via the QR code image.
3. **The approver encrypts its credentials** (two AES-256-GCM JWK strings) using a derived AES key (ECDH shared secret between approver's ephemeral keypair and the requester's public key). The server stores only the opaque ciphertext — it cannot decrypt it.
4. **The requester decrypts** using its in-memory private key when the poll returns the bundle.

A server compromise, DB dump, or network intercept cannot recover the AES keys: the server only ever sees the ciphertext and neither ECDH private key. The only attack surface is physical (someone observing the QR code while the `pk` key is embedded), and the keys are ephemeral — a new keypair is generated on every page load.

### ECIES upgrade for the push flow

The original push flow embedded raw long-lived AES JWK strings (`#k1=...&k2=...`) in the QR fragment. Anyone who photographed the QR code could immediately use those keys — a record-and-use-later attack. If the QR expired before scanning, the captured fragment could still be replayed.

The ECIES replacement eliminates that risk:

1. **Device A (sender) generates two ephemeral ECDH P-256 keypairs** — one for itself (A) and one for the receiver (B).
2. **Shared AES key = ECDH(A_priv, B_pub)** — same as ECDH(B_priv, A_pub).
3. **Device A encrypts credentials** with the shared key and POSTs the bundle (`{ senderPubKey: A_pub, iv, ciphertext }`) to the server. The server stores the opaque ciphertext; it cannot decrypt it (no private keys).
4. **Device A embeds `#priv=<B_priv_pkcs8_b64url>`** in the QR fragment. B_priv is an ephemeral key specific to this session — it has no value on its own without the server-stored ciphertext.
5. **Device B** reads B_priv from the fragment, clears the fragment from browser history, polls the server, and decrypts using ECDH(B_priv, A_pub) = same shared key.
6. **Ciphertext is deleted from the server** after first retrieval — the poll route deletes the token before returning, preventing replay attacks even if B_priv is later captured.

A captured QR code alone is now worthless: B_priv can only decrypt when combined with the server-stored ciphertext, which is deleted on first use.
