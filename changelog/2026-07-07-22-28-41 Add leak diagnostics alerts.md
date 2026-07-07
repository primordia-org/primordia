# Add leak diagnostics alerts

Primordia now runs a scheduled CPU/memory leak detector from the background job runner. When sustained high memory pressure, high load, or high Primordia process CPU usage is detected, it writes a diagnostics bundle under `leak-diagnostics/` with a stable `latest.md` file and timestamped copies.

Admins can subscribe to a new Server Health Alerts push notification category. When diagnostics exist, Primordia sends an actionable notification linking to Admin → Server Health, and the notification bell shows a CPU/memory diagnostics item.

Admin → Server Health now includes a “Diagnose CPU usage / memory leaks” section showing the latest diagnostics and an “Investigate and fix” button that creates an evolve session preloaded with the captured diagnostics so an agent can investigate and repair the leak.
