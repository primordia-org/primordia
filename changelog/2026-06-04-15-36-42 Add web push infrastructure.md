# Add web push infrastructure

Implemented the foundation for Web Push notifications and added a dedicated test page for exercising the flow.

## What changed

- Added persistent SQLite storage for instance VAPID keys, per-user browser push subscriptions, and per-category push notification preferences.
- Added Web Push API endpoints for reading the VAPID public key, creating/listing/deleting browser subscriptions, subscribing/unsubscribing notification categories, and sending test pushes to the current user's subscriptions.
- Added Web Push sending through the reputable `web-push` npm package, including VAPID signing and encrypted `aes128gcm` JSON payloads for cross-browser compatibility. Existing experimental subscriptions are cleared once so the old custom-crypto migration path can be removed.
- Added a service worker at `public/primordia-sw.js` that displays incoming push notifications and focuses/opens Primordia when clicked.
- Added `/settings/notifications`, where users with evolve access can subscribe or unsubscribe from Security Vulnerabilities and Primordia Updates push notification categories.
- Added subscribe/unsubscribe buttons on `/admin/dependencies-security` and `/admin/updates` for their respective notification categories.
- Wired scheduled dependency audits to send actionable Security Vulnerabilities notifications when high/critical issues are found.
- Wired scheduled update-source fetches to send actionable Primordia Updates notifications when upstream commits are available.
- Added `/test-pages/web-push-test`, a signed-in test bench for enabling push, inspecting saved subscriptions, removing subscriptions, sending a test notification, and simulating Security Vulnerabilities or Primordia Updates notifications. Simulated category notifications use the same stable per-category tags as real scheduled notifications, while generic test pushes use unique tags so they do not overwrite category notifications.
- Expanded the test bench with a manual diagnostics panel showing secure-context status, expected service worker URL/scope, controller and ready registration details, all service worker registrations, browser PushSubscription endpoint matching, raw diagnostics JSON, and per-endpoint send results.
- Linked the Web Push test page from the test pages index.

## Why

Primordia now has the infrastructure needed to register browser push subscriptions and send server-triggered notifications. Users can opt into specific actionable categories instead of receiving every possible notification. Security Vulnerabilities and Primordia Updates are tied to existing scheduled jobs so notifications arrive when there is something concrete to review or fix. Each category has its own stable notification tag, so newer notifications supersede older notifications in that same category without replacing notifications from other categories. The test page gives developers a concrete place to validate browser support, permission state, service worker registration, subscription persistence, the outbound push path, and category-specific notification copy. The extra diagnostics make it easier to troubleshoot cases where a push send is accepted but no browser notification appears, especially service worker registration/scope/controller issues. Cross-browser payload encryption is delegated to the maintained `web-push` package instead of custom crypto code.
