# Turn notification bell into session+updates dropdown menu

## What changed

The notification bell (shown to admins and evolvers in the top-right nav) has been converted from a plain link into a dropdown menu, similar to the hamburger menu.

**Bell menu contents:**
- **Updates available** row (amber, admin-only) — links to `/admin/updates` when upstream update sources have new commits.
- **Active session rows** — one row per non-terminal evolve session (status: starting, running, fixing-types, accepting, ready), showing the truncated request text and a colour-coded status badge. Each row links directly to `/evolve/session/<id>`.

**Behaviour:**
- Bell fetches sessions + updates on mount (to decide whether to render at all) and re-fetches on every open.
- Skeleton rows are shown while data loads.
- Click-outside closes the menu (same pattern as hamburger menu).
- Bell pulses amber only when sessions are actively in-flight (starting/running/fixing-types/accepting); white and non-animated when only ready sessions or updates are present.

**Visibility:** Previously admin-only. Now shown to any user with `can_evolve` or `admin` role.

## Why

Users had to flip between the Branches page and session pages to switch between open sessions. The bell now gives a one-click shortcut to any active session directly from the nav bar.

## Files changed

- `components/AdminUpdatesBell.tsx` — full rewrite as dropdown menu component
- `app/api/evolve/sessions/route.ts` — new endpoint: returns non-terminal sessions for any logged-in user
- `lib/hooks.ts` — added `canEvolve: boolean` to `SessionUser` type
- `app/api/auth/session/route.ts` — added `canEvolve` field to session response
- `components/HamburgerMenu.tsx` — pass full `sessionUser` to bell instead of just `isAdmin`
