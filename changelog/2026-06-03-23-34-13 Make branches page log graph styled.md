# Make branches page log graph styled

Updated the `/branches` page so branch history reads more like `git log --graph` output instead of a filesystem tree. Branch rows now use log-style graph markers, show each branch tip's short commit hash, and include the latest commit subject alongside the existing branch/session controls.

This makes the page feel closer to Git history while preserving production/current/session labels, preview links, and the ability to create sessions from existing branches.
