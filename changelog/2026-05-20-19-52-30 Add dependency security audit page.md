# Add dependency security audit page

Added an admin-only dependency security page that runs and displays `bun audit`, explains Bun's empty `{}` audit result as no known vulnerable installed packages found, highlights structured vulnerability findings, shows check timestamps via a localized timestamp component with caller-configurable date formatting, a server-local placeholder, and browser-local timezone abbreviation after hydration, and provides a one-click action to create an evolve session for updating vulnerable packages.

Also added a daily background scheduler that runs `bun audit --audit-level=high`, stores the latest severe-issue count in git config, and surfaces high/critical dependency alerts in the existing notification bell alongside update and evolve-session notifications.
