# Fix branch graph merge rendering

Adjusted branch graph merge hint rendering so merge connectors are drawn at the correct branch columns instead of falling back to the leftmost columns for adjacent merges. The ASCII branch graph exporter now includes merge connectors as well, using ASCII equivalents for the same graph rows shown in the web UI.

Added unit coverage for aligned merge hints and ASCII merge output so regressions are caught automatically.
