"use client";

// components/PruneBranchesButton.tsx
// Client-side trigger for the PruneBranchesDialog. Included by the branches
// Server Component page so that only the button itself needs to be a Client
// Component, keeping the rest of the page server-rendered.

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { PruneBranchesDialog } from "./PruneBranchesDialog";

export function PruneBranchesButton() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <button
        data-id="branches/delete-merged-trigger"
        type="button"
        onClick={() => setDialogOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-orange-900/40 hover:bg-orange-800/60 text-orange-300 hover:text-orange-200 border border-orange-800/50 transition-colors"
        title="Delete all local branches already merged into main"
      >
        <Trash2 size={13} strokeWidth={2} aria-hidden="true" />
        Delete merged
      </button>

      {dialogOpen && (
        <PruneBranchesDialog onClose={() => setDialogOpen(false)} />
      )}
    </>
  );
}
