"use client";

// components/PruneBranchesDialog.tsx
// Thin wrapper around StreamingDialog for the "Delete merged branches" action —
// deletes all local branches merged into main via /api/prune-branches.

import { StreamingDialog } from "./StreamingDialog";
import { withBasePath } from "@/lib/base-path";
import { Trash2 } from "lucide-react";

export function PruneBranchesDialog({ onClose }: { onClose: () => void }) {
  return (
    <StreamingDialog
      onClose={onClose}
      title="Delete merged branches"
      titleIcon={<Trash2 size={16} strokeWidth={2} className="text-orange-400" aria-hidden="true" />}
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
      apiEndpoint={withBasePath("/api/prune-branches")}
    />
  );
}
