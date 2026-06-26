# Harden proxy production idle handling

Fixed reverse proxy lifecycle handling so the preview inactivity sweeper cannot stop the current production server when an accepted session branch still appears in preview routing state.

The proxy now evicts/refuses preview registry entries that match the configured production branch or upstream port, and lazily starts production on HTTP access when it is stopped. Production and preview startup now share the same managed-server lifecycle path where practical, with production differing only in prod-mode startup and no preview idle timeout. The production idle shutdown option was intentionally left out for now to keep the surface area smaller.
