# Fix QR code login URL missing path prefix in preview environments

## What changed

The QR code generated for cross-device login now includes the `NEXT_BASE_PATH` prefix in the encoded URL.

**File:** `app/api/auth/cross-device/qr/route.ts`

Previously the approval URL was constructed as:
```
https://host/login/approve?token=<id>
```

Now it is constructed as:
```
https://host/<basePath>/login/approve?token=<id>
```

## Why

In preview server environments the app is served under a path prefix (e.g. `/primordia`) configured via `NEXT_BASE_PATH`. The QR code was hardcoding the path without this prefix, so scanning the QR code on a phone would navigate to a non-existent route (`/login/approve`) instead of the correct prefixed route (`/primordia/login/approve`).

The fix imports `basePath` from `lib/base-path.ts` (which reads `NEXT_PUBLIC_BASE_PATH` at build time) and interpolates it into the approval URL, consistent with how other parts of the app handle base-path-aware URL construction.
