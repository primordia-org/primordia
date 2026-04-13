"use client";

// components/EvolveForm.tsx
// The "submit a request" form for Primordia's evolve pipeline.
// Rendered at /evolve — a dedicated page, separate from the main chat interface.
//
// On submit: POSTs to /api/evolve, then redirects to /evolve/session/{id}
// where live Claude Code progress is tracked.

import { useState, useRef, useEffect, FormEvent, useCallback } from "react";
import { useRouter } from "next/navigation";
import { GitSyncDialog } from "./GitSyncDialog";
import { NavHeader } from "./NavHeader";
import { HamburgerMenu, buildStandardMenuItems } from "./HamburgerMenu";
import { useSessionUser } from "../lib/hooks";
import { withBasePath } from "../lib/base-path";
import {
  HARNESS_OPTIONS,
  MODEL_OPTIONS_BY_HARNESS,
  DEFAULT_HARNESS,
  DEFAULT_MODEL,
} from "../lib/agent-config";

// ─── Props ────────────────────────────────────────────────────────────────────

interface EvolveFormProps {
  branch?: string | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EvolveForm({ branch }: EvolveFormProps = {}) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedHarness, setSelectedHarness] = useState(DEFAULT_HARNESS);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const { sessionUser, handleLogout } = useSessionUser();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea as the user types
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [input]);

  // ── Submit ───────────────────────────────────────────────────────────────────

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("request", trimmed);
      formData.append("harness", selectedHarness);
      formData.append("model", selectedModel);
      for (const file of attachedFiles) {
        formData.append("attachments", file);
      }

      const res = await fetch(withBasePath("/api/evolve"), {
        method: "POST",
        body: formData,
      });

      const data = (await res.json()) as { sessionId?: string; error?: string };

      if (!res.ok) {
        throw new Error(data.error ?? `API error: ${res.statusText}`);
      }

      // Redirect to the dedicated session page for live progress tracking.
      router.push(`/evolve/session/${data.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setIsLoading(false);
    }
  }

  const handleFilesAdded = useCallback((newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles);
    setAttachedFiles(prev => {
      // Deduplicate by name+size
      const existing = new Set(prev.map(f => `${f.name}:${f.size}`));
      const added = arr.filter(f => !existing.has(`${f.name}:${f.size}`));
      return [...prev, ...added];
    });
  }, []);

  function handleRemoveFile(index: number) {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    // Only clear when leaving the form itself, not a child element
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleFilesAdded(e.dataTransfer.files);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith("image/"));
    if (files.length > 0) {
      handleFilesAdded(files);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main className="flex flex-col w-full max-w-3xl mx-auto px-4 py-6 min-h-dvh">
      {/* Header */}
      <header className="flex items-center justify-between mb-8 flex-shrink-0">
        <NavHeader branch={branch} subtitle="Propose a change" />
        <HamburgerMenu
          sessionUser={sessionUser}
          onLogout={handleLogout}
          items={buildStandardMenuItems({
            onSyncClick: () => setSyncDialogOpen(true),
            isAdmin: sessionUser?.isAdmin ?? false,
            currentPath: "/evolve",
          })}
        />
        {syncDialogOpen && (
          <GitSyncDialog onClose={() => setSyncDialogOpen(false)} />
        )}
      </header>

      {/* Description banner */}
      <div className="mb-6 px-4 py-3 rounded-lg bg-amber-900/40 border border-amber-700/50 text-amber-300 text-sm">
        <strong className="font-semibold">Evolve Primordia</strong> —{" "}
        Describe a change you want to make to this app.
      </div>

      {/* Error message */}
      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-900/40 border border-red-700/50 text-red-300 text-sm">
          ❌ {error}
        </div>
      )}

      {/* Input form */}
      <form
        onSubmit={handleSubmit}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex flex-col gap-3 border rounded-xl bg-gray-900 p-4 transition-colors ${isDragging ? "border-amber-500/70 bg-amber-950/20" : "border-gray-800"}`}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Describe the change you want to make to this app…"
          rows={4}
          disabled={isLoading}
          className="resize-none bg-transparent text-sm text-gray-100 placeholder-gray-600 outline-none max-h-64 leading-relaxed"
        />
        {/* Attached file chips */}
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {attachedFiles.map((file, i) => (
              <span
                key={i}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-gray-800 border border-gray-700 text-xs text-gray-300"
              >
                <span className="truncate max-w-[180px]">{file.name}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveFile(i)}
                  className="text-gray-500 hover:text-gray-200 ml-1 flex-shrink-0"
                  aria-label={`Remove ${file.name}`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,application/pdf,.txt,.md,.csv,.json,.ts,.tsx,.js,.jsx,.py,.sh,.yaml,.yml"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handleFilesAdded(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 border border-gray-700 transition-colors disabled:opacity-50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
              <path fillRule="evenodd" d="M15.621 4.379a3 3 0 0 0-4.242 0l-7 7a1.5 1.5 0 0 0 2.122 2.121l7-7a.5.5 0 0 1 .707.708l-7 7a2.5 2.5 0 0 1-3.536-3.536l7-7a4.5 4.5 0 0 1 6.364 6.364l-7 7A6.5 6.5 0 0 1 2.45 9.955l7-7a.5.5 0 1 1 .707.708l-7 7A5.5 5.5 0 0 0 10.95 18.92l7-7a3 3 0 0 0 0-4.242Z" clipRule="evenodd" />
            </svg>
            Attach files
          </button>
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-amber-600 hover:bg-amber-500 disabled:bg-amber-900 text-white disabled:cursor-not-allowed"
          >
            {isLoading ? "Submitting…" : "Submit Request"}
          </button>
        </div>

        {/* Advanced options */}
        <div className="border-t border-gray-800 pt-2 mt-1">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors select-none"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
              <path fillRule="evenodd" d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .205 1.251l-1.18 2.044a1 1 0 0 1-1.186.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.205-1.251l1.18-2.044a1 1 0 0 1 1.186-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" />
            </svg>
            Advanced
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`w-3 h-3 transition-transform ${showAdvanced ? "rotate-180" : ""}`}>
              <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
            </svg>
          </button>

          {showAdvanced && (
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-400 w-14 flex-shrink-0">Harness</label>
                <select
                  value={selectedHarness}
                  onChange={(e) => {
                    setSelectedHarness(e.target.value);
                    const models = MODEL_OPTIONS_BY_HARNESS[e.target.value];
                    if (models?.length) setSelectedModel(models[0].id);
                  }}
                  disabled={isLoading}
                  className="flex-1 text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded px-2 py-1.5 focus:outline-none focus:border-gray-500 disabled:opacity-50"
                >
                  {HARNESS_OPTIONS.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.label} — {h.description}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-400 w-14 flex-shrink-0">Model</label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  disabled={isLoading}
                  className="flex-1 text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded px-2 py-1.5 focus:outline-none focus:border-gray-500 disabled:opacity-50"
                >
                  {(MODEL_OPTIONS_BY_HARNESS[selectedHarness] ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} — {m.description}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      </form>
    </main>
  );
}
