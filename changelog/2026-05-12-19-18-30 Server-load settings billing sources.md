# Server-load settings billing sources

Updated the `/settings` billing sources page to follow the instant page data loading strategy. The page now loads the user's stored secret types and ciphertext payloads in the Server Component, then passes them into the settings client UI as initial props.

This removes the initial mount-time `/api/secrets` fetches from the billing sources page, individual credential cards, and shared settings subnav. Stored secret plaintext still decrypts only in the browser using the user's local AES key; the server provides ciphertext presence and payload data for first render without gaining decryption access.

The secrets API now reuses the same shared server data helper for listing user secret types, keeping API behavior and server-rendered page data aligned.
