# Add dependency security audit page

Added an admin-only dependency security page that runs and displays `bun audit`, highlights structured vulnerability findings, shows check timestamps via a client-only localized timestamp component with a UTC server placeholder and local timezone abbreviation after hydration, and provides a one-click action to create an evolve session for updating vulnerable packages.

Also added a daily background scheduler that runs `bun audit --audit-level=high`, stores the latest severe-issue count in git config, and surfaces high/critical dependency alerts in the existing notification bell alongside update and evolve-session notifications.
