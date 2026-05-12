# Document instant page data loading strategy

Added a strategy report for eliminating initial page loading flashes caused by client-side data fetches after mount. The report audits current page-load fetch patterns, proposes server-first data loading as the recommended default, compares it with TanStack Query SSR hydration and Suspense streaming alternatives, and estimates token costs for each path.

Updated the project design principles to make server-loaded initial page data the default for future work so users receive complete page content in the initial render whenever practical.
