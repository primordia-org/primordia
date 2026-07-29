# Fix dependency security thread billing key

The Dependency Security page now includes the browser-held Primordia AES key when the admin clicks **Create fix thread**. The matching admin API endpoint forwards that key into the shared thread creation helper, just like the normal thread form does.

This fixes false billing-source failures for admins whose preferred thread preset uses an encrypted billing source, while preserving the existing behavior for gateway-backed presets that do not need the key.
