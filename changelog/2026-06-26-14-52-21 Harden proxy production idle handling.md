# Harden proxy production idle handling

Fixed reverse proxy lifecycle handling so the preview inactivity sweeper cannot stop the current production server when an accepted session branch still appears in preview routing state.

The proxy now evicts/refuses preview registry entries that match the configured production branch or upstream port, lazily starts production on HTTP access when it is stopped, and exposes an optional long production idle shutdown setting on the admin server health page. Production idle shutdown is disabled by default; when enabled, the next request starts production again through the existing process-manager path.
