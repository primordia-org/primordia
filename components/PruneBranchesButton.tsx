"use client";

// components/PruneBranchesButton.tsx
// Client-side trigger for the PruneBranchesDialog. Included by the branches
// Server Component page so that only the button itself needs to be a Client
// Component, keeping the rest of the page server-rendered.

import { useState } from "react";
import { PruneBranchesDialog } from "./PruneBranchesDialog";

export function PruneBranchesButton() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-orange-900/40 hover:bg-orange-800/60 text-orange-300 hover:text-orange-200 border border-orange-800/50 transition-colors"
        title="Delete all local branches already merged into main"
      >
        {/* Trash icon */}
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6"/>
          <path d="M14 11v6"/>
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
        Delete merged
      </button>

      {dialogOpen && (
        <PruneBranchesDialog onClose={() => setDialogOpen(false)} />
      )}
    </>
  );
}
