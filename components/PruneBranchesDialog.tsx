"use client";

// components/PruneBranchesDialog.tsx
// Thin wrapper around StreamingDialog for the "Delete merged branches" action —
// deletes all local branches merged into main via /api/prune-branches.

import { StreamingDialog } from "./StreamingDialog";

export function PruneBranchesDialog({ onClose }: { onClose: () => void }) {
  return (
    <StreamingDialog
      onClose={onClose}
      title="Delete merged branches"
      titleIcon={
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-orange-400" aria-hidden="true">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6"/>
          <path d="M14 11v6"/>
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      }
      idleBody={
        <p className="text-sm text-gray-300">
          This will{" "}
          <strong className="text-white">permanently delete</strong> all
          local branches that are already merged into{" "}
          <code className="text-orange-300 bg-gray-800 px-1 rounded">main</code>
          . The{" "}
          <code className="text-orange-300 bg-gray-800 px-1 rounded">main</code>{" "}
          branch itself will never be deleted.
        </p>
      }
      actionLabel="Delete merged branches"
      actionButtonClass="bg-orange-700 hover:bg-orange-600 text-white"
      runningLabel="Deleting…"
      successMessage="✅ Pruning complete!"
      errorMessage="❌ Pruning finished with errors. Check the output above."
      apiEndpoint="/api/prune-branches"
    />
  );
}
