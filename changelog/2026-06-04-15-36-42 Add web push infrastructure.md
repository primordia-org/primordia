# Add web push infrastructure

Implemented the foundation for Web Push notifications and added a dedicated test page for exercising the flow.

## What changed

- Added persistent SQLite storage for instance VAPID keys and per-user browser push subscriptions.
- Added Web Push API endpoints for reading the VAPID public key, creating/listing/deleting subscriptions, and sending a test push to the current user's subscriptions.
- Added a minimal VAPID sender implementation in `lib/web-push.ts` without introducing a new dependency.
- Added a service worker at `public/primordia-sw.js` that displays incoming push notifications and focuses/opens Primordia when clicked.
- Added `/test-pages/web-push-test`, a signed-in test bench for enabling push, inspecting saved subscriptions, removing subscriptions, and sending a test notification.
- Linked the Web Push test page from the test pages index.

## Why

Primordia now has the infrastructure needed to register browser push subscriptions and send server-triggered notifications. The test page gives developers a concrete place to validate browser support, permission state, service worker registration, subscription persistence, and the outbound push path before wiring notifications into product features.
