# Add web push infrastructure

Implemented the foundation for Web Push notifications and added a dedicated test page for exercising the flow.

## What changed

- Added persistent SQLite storage for instance VAPID keys and per-user browser push subscriptions.
- Added Web Push API endpoints for reading the VAPID public key, creating/listing/deleting subscriptions, and sending a test push to the current user's subscriptions.
- Added Web Push sending through the reputable `web-push` npm package, including VAPID signing and encrypted `aes128gcm` JSON payloads for cross-browser compatibility. Existing PKCS#8 keys from the earlier custom sender are migrated in place to the private-key format expected by the library so existing subscriptions can keep using the same public key.
- Added a service worker at `public/primordia-sw.js` that displays incoming push notifications and focuses/opens Primordia when clicked.
- Added `/test-pages/web-push-test`, a signed-in test bench for enabling push, inspecting saved subscriptions, removing subscriptions, and sending a test notification.
- Expanded the test bench with a manual diagnostics panel showing secure-context status, expected service worker URL/scope, controller and ready registration details, all service worker registrations, browser PushSubscription endpoint matching, raw diagnostics JSON, and per-endpoint send results.
- Linked the Web Push test page from the test pages index.

## Why

Primordia now has the infrastructure needed to register browser push subscriptions and send server-triggered notifications. The test page gives developers a concrete place to validate browser support, permission state, service worker registration, subscription persistence, and the outbound push path before wiring notifications into product features. The extra diagnostics make it easier to troubleshoot cases where a push send is accepted but no browser notification appears, especially service worker registration/scope/controller issues. Cross-browser payload encryption is delegated to the maintained `web-push` package instead of custom crypto code.
