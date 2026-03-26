# Require login for chat and evolve pages and APIs

## What changed

- **`app/chat/page.tsx`**: The `/chat` page now calls `getSessionUser()` at request time. Unauthenticated visitors are redirected to `/login`.
- **`app/evolve/page.tsx`**: The `/evolve` page applies the same guard — unauthenticated visitors are redirected to `/login`.
- **`app/api/chat/route.ts`**: The `POST /api/chat` endpoint returns `401 Authentication required` if the request has no valid session cookie.
- **`app/api/evolve/route.ts`**: The `POST /api/evolve` endpoint returns `401 Authentication required` if the request has no valid session cookie.
- **`app/api/evolve/local/route.ts`**: Both `POST` and `GET` on `/api/evolve/local` return `401` when unauthenticated.
- **`app/api/evolve/local/manage/route.ts`**: The `POST /api/evolve/local/manage` endpoint (accept/reject local evolve sessions) also returns `401` when unauthenticated.
- **`app/page.tsx`**: Updated landing page copy from "No account needed to start chatting" to "Sign in with a passkey to start chatting and proposing changes" to reflect the new requirement.

## Why

Chat and evolve are privileged operations — chat incurs Anthropic API costs and evolve can trigger code changes. Requiring a login ensures only authenticated users can use these features, preventing abuse by anonymous visitors.
