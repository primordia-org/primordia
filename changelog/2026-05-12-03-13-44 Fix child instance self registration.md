# Fix child instance self registration

Child Primordia installs now remember which parent served their `install.sh` script by persisting that URL into the systemd service environment as `PRIMORDIA_PARENT_URL`.

On server startup, Primordia now imports that installer-provided parent URL into instance config if no parent is set. Existing children that missed the new environment variable can also infer their parent from the git `remote.origin.url` that points at the parent's `/api/git` endpoint.

Primordia then performs a best-effort registration once a public canonical URL is known. This also retries registration once per process for instances that already have both URLs configured, helping recover from transient network or parent availability failures.

The registration helper now skips no-op self-registration when the configured parent URL equals the canonical URL.
