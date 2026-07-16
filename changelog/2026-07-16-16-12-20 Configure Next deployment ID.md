# Configure Next deployment ID

Next.js now receives a stable `deploymentId` from configuration, with the app scripts setting `NEXT_DEPLOYMENT_ID` to the current git commit SHA before running `next dev`, `next build`, or `next start`.

This lets Next.js skew protection detect clients that are still running JavaScript from an older deployment and refresh them instead of submitting stale Server Action IDs that produce "Failed to find Server Action" errors in the server logs.
