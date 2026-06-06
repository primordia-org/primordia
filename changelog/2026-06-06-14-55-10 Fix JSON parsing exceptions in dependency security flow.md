# Fix empty JSON responses in Dependency Security flow

## Context
In a previous commit (`67b14000c7071fe7dbdce9956824fbf85f78d4fa`), error handling was refactored in both the frontend `DependenciesSecurityClient` and backend route `/api/admin/dependencies-security/route.ts` to directly use standard response parsing methods (`res.json()`).

The visible symptom was the browser error shown when admins clicked "Create fix session":

> `JSON.parse: unexpected end of data at line 1 column 1 of the JSON data`

The first fix restored safe client/downstream response parsing, but that only addressed the symptom. The root cause was that `app/api/admin/dependencies-security/route.ts` itself could still throw before returning a `Response`. When an App Router route throws uncaught, Next.js can send a plain empty `500` response body. The frontend then tries to parse that empty body as JSON, producing the confusing parse error instead of the actual failure.

Possible throw sites in this route included request-body parsing, `bun audit` notification writes, the server-side self-fetch to `/api/evolve`, and downstream response handling.

## Changes
- **Client component (`app/admin/dependencies-security/DependenciesSecurityClient.tsx`)**: Safely reads response payloads as text first and only parses non-empty JSON bodies, so unexpected empty/non-JSON responses show a clearer status-based error.
- **REST route (`app/api/admin/dependencies-security/route.ts`)**: Safely reads the downstream `/api/evolve` response as text before parsing, preserving the underlying status/error instead of throwing while parsing.
- **Root-cause guard (`app/api/admin/dependencies-security/route.ts`)**: Added top-level `try/catch` wrappers for GET and POST so uncaught route exceptions are converted into structured JSON `{ error }` responses instead of Next.js empty `500` bodies.
- **Request validation (`app/api/admin/dependencies-security/route.ts`)**: Invalid POST JSON now returns a structured `400` response (`Request body must be valid JSON.`) instead of being allowed to throw.
