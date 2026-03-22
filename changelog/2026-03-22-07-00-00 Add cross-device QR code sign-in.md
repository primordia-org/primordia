# Add cross-device QR code sign-in

## What changed

Added a complete cross-device authentication flow so users can sign in on a new device (e.g. a laptop) by having an already-authenticated device (e.g. a phone) scan a QR code and approve the login.

### New files

- **`app/api/auth/cross-device/start/route.ts`** — `POST` endpoint that creates a short-lived (10-minute) cross-device token and returns its `tokenId`.
- **`app/api/auth/cross-device/poll/route.ts`** — `GET` endpoint polled by the requester device every 2 seconds. When the token is approved it creates a session, sets the session cookie in the response, and returns `{ status: "approved", username }`.
- **`app/api/auth/cross-device/approve/route.ts`** — `POST` endpoint called by the approver device (must be authenticated). Marks the token as approved with the approving user's ID.
- **`app/api/auth/cross-device/qr/route.ts`** — `GET` endpoint that returns an SVG QR code encoding the approval URL (`/login/approve?token=<tokenId>`). Generating QR codes server-side avoids leaking the token to any third-party QR service and keeps the client bundle clean.
- **`app/login/approve/page.tsx`** — Page visited by the authenticated approver device after scanning the QR code. Shows the current username and Approve / Reject buttons. If not signed in, shows a prompt to sign in first.

### Modified files

- **`lib/db/types.ts`** — Added `CrossDeviceToken` type and five new `DbAdapter` methods (`createCrossDeviceToken`, `getCrossDeviceToken`, `approveCrossDeviceToken`, `deleteCrossDeviceToken`, `deleteExpiredCrossDeviceTokens`).
- **`lib/db/sqlite.ts`** — Added `cross_device_tokens` table and all five CRUD implementations.
- **`lib/db/neon.ts`** — Same table and CRUD implementations for the Neon/PostgreSQL adapter.
- **`app/login/page.tsx`** — Added a **QR Code** tab alongside the existing Passkey tab. The QR tab automatically starts the cross-device flow, shows the server-generated QR image, polls for approval, and redirects on success. Also added `?next=<url>` redirect support so the approval page can deep-link back after a sign-in.
- **`PRIMORDIA.md`** — Updated the file map and features table.

### Dependency

Added `qrcode` + `@types/qrcode` for server-side SVG QR code generation.

## Why

WebAuthn passkeys are device-bound by default unless the platform backs them up (e.g. iCloud Keychain, Google Password Manager). Users who set up a passkey on their phone and then open Primordia on a laptop may not have a passkey available there. The QR flow gives them a frictionless path: the laptop shows a QR code, the phone (where the passkey lives and the session is active) scans it and taps Approve, and the laptop instantly gets a session — no password, no passkey ceremony on the new device.

The token is single-use (deleted on first successful poll) and expires after 10 minutes, so there is no persistent security risk from an unscanned code.
