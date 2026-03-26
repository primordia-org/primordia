# Login page reads session in server component

## What changed

- `app/login/page.tsx` is now an **async React Server Component**. It calls `getSessionUser()` directly (a DB lookup via `lib/auth.ts`) and passes the result as an `initialUser` prop to the new client component.
- `app/login/LoginClient.tsx` is a new **`"use client"` component** containing all the interactive login UI (passkey flow, QR flow, already-logged-in banner). It replaces the former single-file `"use client"` page.
- The `useEffect` that previously called `fetch("/api/auth/session")` on mount has been **removed entirely**.

## Why

The old approach made an extra HTTP round-trip to `/api/auth/session` every time the login page loaded, purely to discover whether the user was already signed in. Because Next.js App Router supports async server components, this information can be read from the database (via the session cookie) during server-side rendering — before any JavaScript runs in the browser. This eliminates a waterfall request, removes the transient `null` loading state, and makes the already-logged-in banner appear instantly with the initial HTML rather than after a client-side fetch.
