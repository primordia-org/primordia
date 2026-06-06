# Fix dependency security session creation connection

## What changed
- Updated the Dependency Security “Create fix session” action to start the evolve session by invoking the evolve route handler directly inside the server process.
- Removed the server-side HTTP self-request back to `/api/evolve` from the dependency security admin route.

## Why
On some deployments, the app server cannot reach its own public URL from inside the server environment. That made “Create fix session” fail with an “Unable to connect” message even though the browser and app were otherwise working. Calling the route handler directly avoids that loopback networking dependency while preserving the existing session creation behavior.
