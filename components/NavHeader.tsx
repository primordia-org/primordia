// components/NavHeader.tsx
// Shared nav header used by /chat, /evolve, /changelog, and /branches pages.
// Displays the "Primordia" title (linked to /), optional PR link (Vercel
// preview deployments), the current git branch name, and nav links.

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
  currentPage?: "changelog" | "branches";
}

export function NavHeader({
  branch,
  subtitle = "A self-evolving application",
  currentPage,
}: NavHeaderProps) {
  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight text-white flex flex-wrap items-baseline gap-x-2">
        <Link href="/" className="text-white no-underline hover:text-gray-300">
          Primordia
        </Link>
        {process.env.VERCEL_ENV === "preview" &&
          process.env.VERCEL_GIT_PULL_REQUEST_ID && (
            <a
              href={`https://github.com/${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}/pull/${process.env.VERCEL_GIT_PULL_REQUEST_ID}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-normal text-blue-400 hover:text-blue-300"
            >
              #{process.env.VERCEL_GIT_PULL_REQUEST_ID}
            </a>
          )}
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
            <Link href="/changelog" className="text-blue-400 hover:text-blue-300">
              Changelog
            </Link>
          </>
        )}
        {process.env.NODE_ENV === "development" && currentPage !== "branches" && (
          <>
            {" "}·{" "}
            <Link href="/branches" className="text-blue-400 hover:text-blue-300">
              Branches
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
