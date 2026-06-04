# Return helpful error on Create Fix Session failure

## Context
When clicking the "Create fix session" button on the Dependency Security page (`/admin/dependencies-security`), the button sets up a background task to upgrade packages by calling the `/api/evolve` endpoint. If `/api/evolve` fails, we want the underlying error to be returned cleanly in JSON so the user can easily diagnose the problem (for instance, "The usage limit has been reached").

Previously, if `/api/evolve` threw an uncaught error or timed out, standard error handling might not return a valid JSON error payload, causing JSON-parsing functions to crash with the unhelpful `"Unexpected end of JSON input"` statement.

## Changes
- **API route (`app/api/evolve/route.ts`)**: Structured the `/api/evolve` GET and POST routes so that any uncaught synchronous/asynchronous errors are caught globally in outer `try/catch` wrappers within the route handlers, ensuring we **always** return a valid JSON payload containing `{ error: message }` with appropriate status/error structures, even for unexpected errors.
