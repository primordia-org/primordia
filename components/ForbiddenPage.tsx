// components/ForbiddenPage.tsx
// Rendered by protected server components when a logged-in user lacks the
// required role(s) to access the page. Explains what the page does, what
// conditions are required, which ones the user meets/doesn't meet, and how
// to gain access.

interface Props {
  /** One or two sentences describing the purpose of this page. */
  pageDescription: string;
  /** Bullet list of all conditions required to access the page. */
  requiredConditions: string[];
  /** Conditions the current user already satisfies (shown in green). */
  metConditions: string[];
  /** Conditions the current user does NOT satisfy (shown in red). */
  unmetConditions: string[];
  /** Optional instructions on how to gain the missing access. */
  howToFix?: string[];
}

export default function ForbiddenPage({
  pageDescription,
  requiredConditions,
  metConditions,
  unmetConditions,
  howToFix,
}: Props) {
  return (
    <main className="flex flex-col w-full max-w-2xl mx-auto px-4 py-16 min-h-dvh">
      <div className="rounded-xl border border-red-800/50 bg-red-950/20 p-6 flex flex-col gap-5">
        <div>
          <h1 className="text-lg font-semibold text-red-400 mb-1">Access denied</h1>
          <p className="text-sm text-gray-400">{pageDescription}</p>
        </div>

        <div>
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Required to access this page
          </h2>
          <ul className="flex flex-col gap-1">
            {requiredConditions.map((c, i) => (
              <li key={i} className="text-sm text-gray-300">
                {c}
              </li>
            ))}
          </ul>
        </div>

        {metConditions.length > 0 && (
          <div>
            <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              You meet
            </h2>
            <ul className="flex flex-col gap-1">
              {metConditions.map((c, i) => (
                <li key={i} className="text-sm text-green-400">
                  ✓ {c}
                </li>
              ))}
            </ul>
          </div>
        )}

        {unmetConditions.length > 0 && (
          <div>
            <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              You don&apos;t meet
            </h2>
            <ul className="flex flex-col gap-1">
              {unmetConditions.map((c, i) => (
                <li key={i} className="text-sm text-red-400">
                  ✗ {c}
                </li>
              ))}
            </ul>
          </div>
        )}

        {howToFix && howToFix.length > 0 && (
          <div>
            <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              How to get access
            </h2>
            <ul className="flex flex-col gap-1">
              {howToFix.map((c, i) => (
                <li key={i} className="text-sm text-gray-300">
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-4">
        <a
          href="/chat"
          className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
        >
          ← Back to chat
        </a>
      </div>
    </main>
  );
}
