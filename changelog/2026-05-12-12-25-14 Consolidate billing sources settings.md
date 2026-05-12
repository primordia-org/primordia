# Consolidate billing sources settings

API Keys and Subscriptions now live together under a single Billing sources settings section. The page starts with the built-in exe.dev LLM gateway as the default billing source, then lets users add only the specific API key or subscription source they want through a dashed "Add another billing source" row, matching the extendable-list pattern used by Presets and Update sources. Unused standalone headers and all-provider API key rendering paths were removed so each billing source entry owns only the UI it needs.

The old `/settings/subscriptions` page now redirects to `/settings` so existing links continue to work while users land on the consolidated settings experience.
