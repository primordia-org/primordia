# Revert faulty JSON refactoring on Dependency Security API & Client

## Context
In a previous commit (`67b14000c7071fe7dbdce9956824fbf85f78d4fa`), error handling was refactored in both the frontend `DependenciesSecurityClient` and backend route `/api/admin/dependencies-security/route.ts` to directly use standard response parsing methods (`res.json()`).

However, if `/api/evolve` is called but aborts or errors out unexpectedly (for example, with a non-JSON gateway error or an empty response), calling `.json()` directly throws an uncaught `"Unexpected end of JSON input"` or similar error message, obscuring the primary cause. This was particularly visible to admins when clicking the "Create fix session" button.

## Changes
- **Client component (`app/admin/dependencies-security/DependenciesSecurityClient.tsx`)**: Restored safe-guarded JSON parsing by retrieving the response payload as plain text (`.text()`) first, checking for non-empty content, and wrapping `JSON.parse` in a `try/catch` block. This guarantees that non-JSON responses are parsed into standard JavaScript errors cleanly without throwing unhandled parsing exceptions.
- **REST route (`app/api/admin/dependencies-security/route.ts`)**: Reverted the unsafe `.json()` call when forwarding the request to the `/api/evolve` downstream handler back to a robust text-fallback parsing sequence.
