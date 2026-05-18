# Remove passkey registration nag

Removed the post-login passkey registration prompt for exe.dev users. Since Primordia now stores the local encryption key in browser localStorage instead of deriving it from the WebAuthn PRF extension, users no longer need to be pushed into creating a passkey immediately after signing in with exe.dev.

The `/register-passkey` prompt page was removed, and exe.dev SSO now redirects directly to the requested destination after creating the session.
