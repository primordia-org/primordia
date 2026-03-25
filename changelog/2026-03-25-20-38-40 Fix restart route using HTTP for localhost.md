# Fix restart route using HTTP for localhost

## What

Changed `app/api/evolve/local/restart/route.ts` to use `http://` instead of `https://` when the request origin is `localhost` or `127.0.0.1`.

## Why

The `/__nextjs_restart_dev` call was failing with "Unable to connect" because the `origin` derived from `request.url` used `https://localhost:3001`, but the local dev server only listens on plain HTTP. By detecting a localhost hostname and forcing `http://`, the fetch can actually reach the Next.js dev server endpoint.
