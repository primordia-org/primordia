# Return helpful error on Create Fix Session failure

## Context
When clicking the "Create fix session" button on the Dependency Security page (`/admin/dependencies-security`), the button sets up a background task to upgrade packages by calling the `/api/evolve` endpoint. If `/api/evolve` fails with a non-JSON error (such as when a downstream LLM provider has run out of credits, returned an empty response, or failed with standard gateway/gateway timeouts), the `evolveRes.json()` call in `app/api/admin/dependencies-security/route.ts` would fail with an unhelpful `"Unexpected end of JSON input"` error.

Additionally, on the frontend, `DependenciesSecurityClient` was parsing the overall API response using `res.json()` directly, which would hide the original exception and throw `"Unexpected end of JSON input"` under similar circunstances.

## Changes
- **API route (`app/api/admin/dependencies-security/route.ts`)**: Instead of calling `.json()` directly on the fetch response from `/api/evolve`, we read the body as plain text (`.text()`), parse it inside a `try {} catch {}` block, and handle any parsing failures or empty responses gracefully by exposing the underlying status or error messages.
- **Client component (`app/admin/dependencies-security/DependenciesSecurityClient.tsx`)**: Safe-guarded JSON parsing when communicating with the back-end middleware using `.text()` and `try {} catch {}`.
