// components/NavHeader.tsx
// Shared nav header used by /chat, /evolve, /changelog, and /branches pages.
// Displays the "Primordia" title (linked to /), the current git branch name,
// and nav links.

import Link from "next/link";

interface NavHeaderProps {
  /** Current git branch name, passed down from the server component. */
  branch?: string | null;
  /** Short page description shown below the title. Defaults to the app tagline. */
  subtitle?: string;
  /**
   * Which page we're currently on — used to suppress self-referential nav
   * links (e.g. don't show "Changelog" link on the changelog page itself).
   */
  currentPage?: "changelog" | "branches" | "admin";
}

export function NavHeader({
  branch,
  subtitle = "A self-evolving application",
  currentPage,
}: NavHeaderProps) {
  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight text-white flex flex-wrap items-baseline gap-x-2">
        <Link data-id="nav/home" href="/" className="text-white no-underline hover:text-gray-300">
          Primordia
        </Link>
        {branch && (
          <span className="text-sm font-normal text-gray-400 w-full sm:w-auto">
            ({branch})
          </span>
        )}
      </h1>
      <p className="text-xs text-gray-400 mt-0.5">
        {subtitle}
        {currentPage !== "changelog" && (
          <>
            {" "}·{" "}
            <Link data-id="nav/changelog-link" href="/changelog" className="text-blue-400 hover:text-blue-300">
              Changelog
            </Link>
          </>
        )}
        {currentPage !== "branches" && (
          <>
            {" "}·{" "}
            <Link data-id="nav/branches-link" href="/branches" className="text-blue-400 hover:text-blue-300">
              Branches
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
