# Separate diagnostics dismiss controls

Server Health now treats captured diagnostics as separate CPU usage and memory leak issues instead of one combined CPU/memory warning. Each active issue gets its own card, notification-bell label, and investigate/fix thread prompt focused on that category.

Admins can also dismiss each captured diagnostics issue from Server Health. Dismissals are tracked per diagnostics capture and category, so dismissed issues stop appearing in alerts until a newer diagnostics bundle is captured.
