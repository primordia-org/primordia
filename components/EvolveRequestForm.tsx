"use client";

// components/EvolveRequestForm.tsx
// Shared evolve request form body used by the /evolve page, the floating
// dialog, and the follow-up panel on session detail pages.

import { useState, useRef, useEffect, useCallback, FormEvent, memo } from "react";
import { useRouter } from "next/navigation";
import { withBasePath } from "../lib/base-path";
import {
  HARNESS_OPTIONS,
  MODEL_OPTIONS_BY_HARNESS,
  DEFAULT_HARNESS,
  DEFAULT_MODEL,
} from "../lib/agent-config";

// ─── ImagePreview ─────────────────────────────────────────────────────────────

/** Renders a tiny thumbnail for a local File, managing its object URL lifetime. */
const ImagePreview = memo(function ImagePreview({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  if (!url) return null;
  return <img src={url} alt="" className="h-4 w-4 rounded object-cover flex-shrink-0" />;
});

// ─── Props ────────────────────────────────────────────────────────────────────

interface EvolveRequestFormProps {
  /**
   * Compact mode for the floating dialog: smaller padding, flex-1 textarea,
   * and tighter button sizing. Defaults to false (page layout).
   */
  compact?: boolean;
  /** Textarea placeholder text. */
  placeholder?: string;
  /** Submit button label. */
  submitLabel?: string;
  /**
   * When provided, called on submit instead of POSTing to /api/evolve and
   * navigating to the new session. Should throw on error (message shown in the
   * form). On success the form resets automatically.
   */
  onSubmit?: (data: {
    request: string;
    harness: string;
    model: string;
    files: File[];
  }) => Promise<void>;
  /**
   * Extra disabled condition (e.g. Claude is already running in the session).
   * When true the submit button is disabled and shows `disabledLabel`.
   */
  disabled?: boolean;
  /** Label to show on the submit button when `disabled` is true. */
  disabledLabel?: string;
  /** Auto-focus the textarea on mount. */
  autoFocus?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EvolveRequestForm({
  compact = false,
  placeholder = "Describe the change you want to make to this app…",
  submitLabel = "Submit Request",
  onSubmit,
  disabled = false,
  disabledLabel,
  autoFocus = false,
}: EvolveRequestFormProps) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedHarness, setSelectedHarness] = useState(DEFAULT_HARNESS);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea height in page (non-compact) mode.
  useEffect(() => {
    if (compact) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [input, compact]);

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading || disabled) return;

    setIsLoading(true);
    setError(null);

    try {
      if (onSubmit) {
        await onSubmit({
          request: trimmed,
          harness: selectedHarness,
          model: selectedModel,
          files: attachedFiles,
        });
        // Reset form on success.
        setInput("");
        setAttachedFiles([]);
        setShowAdvanced(false);
        setSelectedHarness(DEFAULT_HARNESS);
        setSelectedModel(DEFAULT_MODEL);
      } else {
        const formData = new FormData();
        formData.append("request", trimmed);
        formData.append("harness", selectedHarness);
        formData.append("model", selectedModel);
        for (const file of attachedFiles) {
          formData.append("attachments", file);
        }

        const res = await fetch(withBasePath("/api/evolve"), { method: "POST", body: formData });
        const data = (await res.json()) as { sessionId?: string; error?: string };

        if (!res.ok) {
          throw new Error(data.error ?? `API error: ${res.statusText}`);
        }

        router.push(`/evolve/session/${data.sessionId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  }

  // ── File handling ─────────────────────────────────────────────────────────

  const handleFilesAdded = useCallback((newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles);
    setAttachedFiles((prev) => {
      const existing = new Set(prev.map((f) => `${f.name}:${f.size}`));
      return [...prev, ...arr.filter((f) => !existing.has(`${f.name}:${f.size}`))];
    });
  }, []);

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) handleFilesAdded(e.dataTransfer.files);
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const imageFiles = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    // Rename clipboard images to clipboard.png / clipboard_2.png / etc.
    // Browsers assign generic names like "image.png"; give them something meaningful.
    const usedNames = new Set(attachedFiles.map((f) => f.name));
    const renamed = imageFiles.map((file) => {
      const ext = file.type === "image/jpeg" ? ".jpg" : file.type === "image/gif" ? ".gif" : file.type === "image/webp" ? ".webp" : ".png";
      let name = `clipboard${ext}`;
      if (usedNames.has(name)) {
        let counter = 2;
        while (usedNames.has(`clipboard_${counter}${ext}`)) counter++;
        name = `clipboard_${counter}${ext}`;
      }
      usedNames.add(name);
      return new File([file], name, { type: file.type });
    });
    handleFilesAdded(renamed);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const isSubmitDisabled = isLoading || disabled || !input.trim();
  const buttonLabel =
    disabled && disabledLabel ? disabledLabel : isLoading ? "Submitting…" : submitLabel;

  return (
    <div className={`flex flex-col gap-2${compact ? " flex-1 min-h-0" : ""}`}>
      {error && (
        <div className={`px-3 py-2 rounded-lg bg-red-900/40 border border-red-700/50 text-red-300 ${compact ? "text-xs" : "text-sm"}`}>
          ❌ {error}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex flex-col gap-3 rounded-lg ${compact ? "flex-1 min-h-0" : ""} transition-all ${isDragging ? "bg-amber-950/10 ring-2 ring-amber-500/60 ring-offset-4 ring-offset-gray-950" : ""}`}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          rows={compact ? undefined : 4}
          disabled={isLoading}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={autoFocus}
          className={`w-full resize-none bg-gray-800 text-sm text-gray-100 placeholder-gray-500 border border-gray-700 rounded-lg px-3 py-2 leading-relaxed outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50${compact ? " flex-1 min-h-0" : " max-h-64"}`}
        />

        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {attachedFiles.map((file, i) => (
              <span
                key={i}
                className={`flex items-center gap-1.5 px-2 py-1 ${compact ? "rounded" : "rounded-md"} bg-gray-800 border border-gray-700 text-xs text-gray-300`}
              >
                {file.type.startsWith("image/") && <ImagePreview file={file} />}
                <span className={`truncate ${compact ? "max-w-[140px]" : "max-w-[180px]"}`}>{file.name}</span>
                <button
                  type="button"
                  onClick={() => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="text-gray-500 hover:text-gray-200 ml-0.5 flex-shrink-0"
                  aria-label={`Remove ${file.name}`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
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
            className={`flex items-center gap-1.5 ${compact ? "px-2.5" : "px-3"} py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 border border-gray-700 transition-colors disabled:opacity-50`}
          >
            {/* Lucide paperclip — matches the navbar menu icon style */}
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
            </svg>
            {compact ? "Attach" : "Attach files"}
          </button>
          <button
            type="submit"
            disabled={isSubmitDisabled}
            className={`px-4 ${compact ? "py-1.5 text-xs" : "py-2 text-sm"} rounded-lg font-medium transition-colors bg-amber-600 hover:bg-amber-500 disabled:bg-amber-900 text-white disabled:cursor-not-allowed`}
          >
            {buttonLabel}
          </button>
        </div>

        {/* Advanced options */}
        <div className="border-t border-gray-800 pt-2 mt-1">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors select-none"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5" aria-hidden="true">
              <path fillRule="evenodd" d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .205 1.251l-1.18 2.044a1 1 0 0 1-1.186.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.205-1.251l1.18-2.044a1 1 0 0 1 1.186-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" />
            </svg>
            Advanced
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`w-3 h-3 transition-transform${showAdvanced ? " rotate-180" : ""}`} aria-hidden="true">
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
                    <option key={h.id} value={h.id}>{h.label}</option>
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
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
