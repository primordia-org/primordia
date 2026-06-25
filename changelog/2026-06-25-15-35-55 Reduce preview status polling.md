# Reduce preview status polling

The Evolve session page no longer continuously calls the preview process status server action from the browser. That polling was used to refresh whether the preview server was running, but it created frequent Next.js request logs that made the in-page server log stream noisy.

The page now reads the initial preview process status once during server rendering and only updates it after an explicit preview restart/start action. The embedded preview is allowed to load for any non-stopped state, so the page does not need repeated status checks just to show a running preview.
