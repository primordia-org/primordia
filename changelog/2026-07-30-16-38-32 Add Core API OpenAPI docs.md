# Add Core API OpenAPI docs

Added a generated OpenAPI document for Primordia Core route-action endpoints at `/api/core/openapi`. The document is built from the same CLI route metadata used by the existing Core API command-list endpoint, including route paths, path/query parameters, request body shapes, streaming response hints, and web API-key bearer authentication. Its OpenAPI `servers` entry now respects forwarded public origin headers and `NEXT_BASE_PATH`, so preview instances advertise URLs like `/preview/{threadId}` instead of the internal localhost server.

Changed the Core API test page at `/test-pages/core-api-test` to render a Scalar API reference pointed at the new Core OpenAPI endpoint, matching the interactive documentation experience used by `/api-docs`. The Scalar bundle is loaded lazily behind a lightweight page shell so the preview server no longer blocks first response on compiling the full API reference package during development.
