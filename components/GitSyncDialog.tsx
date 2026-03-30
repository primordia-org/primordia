"use client";

// components/GitSyncDialog.tsx
// Thin wrapper around StreamingDialog for the "Sync with GitHub" action —
// pulls then pushes the current branch via /api/git-sync.

import { StreamingDialog } from "./StreamingDialog";

export function GitSyncDialog({ onClose }: { onClose: () => void }) {
  return (
    <StreamingDialog
      onClose={onClose}
      title="Synchronise branch with GitHub"
      titleIcon={
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400" aria-hidden="true">
          <polyline points="16 16 12 12 8 16"/>
          <line x1="12" y1="12" x2="12" y2="21"/>
          <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
        </svg>
      }
      idleBody={
        <p className="text-sm text-gray-300">
          This will <strong className="text-white">pull</strong> the latest
          changes from GitHub (merge strategy) and then{" "}
          <strong className="text-white">push</strong> your local commits.
          Merge conflicts, if any, will be resolved automatically by Claude
          Code.
        </p>
      }
      actionLabel="Sync"
      actionButtonClass="bg-green-700 hover:bg-green-600 text-white"
      runningLabel="Syncing…"
      successMessage="✅ Sync complete!"
      errorMessage="❌ Sync finished with errors. Check the output above."
      apiEndpoint="/api/git-sync"
    />
  );
}
