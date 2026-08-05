# Separate diagnostics dismiss controls

Server Health now treats captured diagnostics as separate CPU usage and memory leak issues instead of one combined CPU/memory warning. Each active issue gets its own card, notification-bell label, and investigate/fix thread prompt focused on that category.

Admins can also dismiss captured diagnostics from Server Health. Dismiss now deletes the underlying `leak-diagnostics/latest.md` bundle (and its timestamped copy when available) so the alert disappears immediately instead of only marking the category in git config.

CPU diagnostics are less eager: memory pressure still captures after consecutive samples, but CPU/load diagnostics now require roughly one hour of sustained pressure before a diagnostics bundle is written.
