# Remove nested Suspense test page

Removed the `/test-pages/nested-suspense-stream` developer page and its reusable recursive Suspense log-streaming component.

We chose not to keep this approach despite its elegance and the appeal of streaming without a dedicated endpoint. In practice, the browser treats the response as forever loading: the Reload Page button can remain a Stop Loading Page button and require two presses (one to stop loading, one to reload), and command-line clients such as `curl` may never finish. That behavior makes the pattern confusing for diagnostics and unsuitable as the preferred log-streaming approach.
