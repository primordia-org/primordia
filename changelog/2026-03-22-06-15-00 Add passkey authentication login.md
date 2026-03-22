# Add passkey authentication login

## What changed

- Added full WebAuthn passkey authentication (register + login) via `@simplewebauthn/server` and `@simplewebauthn/browser`.
- New `/login` page with a clean dark UI: enter a username to register with a passkey, or sign in with an existing one (supports discoverable credentials / autofill if no username is typed).
- New API routes under `/api/auth/`:
  - `GET /api/auth/session` — returns the current session user (or null)
  - `POST /api/auth/logout` — clears the session cookie and deletes the session from DB
  - `POST /api/auth/passkey/register/start` — generates WebAuthn registration options
  - `POST /api/auth/passkey/register/finish` — verifies the registration, creates the user and passkey record, issues a session
  - `POST /api/auth/passkey/login/start` — generates WebAuthn authentication options
  - `POST /api/auth/passkey/login/finish` — verifies the authentication, updates the passkey counter, issues a session
- Sessions use an httpOnly cookie `primordia-session` with a 30-day TTL stored in the database.
- WebAuthn challenges use an httpOnly cookie `passkey-challenge-id` with a 5-minute TTL.
- Dual-database abstraction layer in `lib/db/`:
  - `bun:sqlite` (built-in, no npm package needed) for local development when `DATABASE_URL` is not set
  - Neon PostgreSQL (`@neondatabase/serverless`) for Vercel production when `DATABASE_URL` is set
  - Tables are created automatically on first run (idempotent `CREATE TABLE IF NOT EXISTS`)
- Added `webpack` config in `next.config.ts` to exclude `bun:sqlite` from Vercel builds.
- Updated the hamburger menu in `ChatInterface.tsx`:
  - Shows "Log in" link to `/login` when not authenticated
  - Shows "Signed in as @username" + "Sign out" button when authenticated
  - Session is fetched on mount via `/api/auth/session`
- Updated `.env.example` with `DATABASE_URL` (commented out — not needed locally).
- Updated `.gitignore` to exclude `*.db`, `*.db-shm`, `*.db-wal` (SQLite files).

## Why

Primordia needed user identity to support personalised features in the future. Passkeys were chosen because they are phishing-resistant, require no passwords, and work natively in modern browsers and operating systems (Face ID, Touch ID, Windows Hello, hardware keys). The minimal-dependency approach (no auth framework, no ORM) keeps the codebase easy for Claude Code to read and modify.
