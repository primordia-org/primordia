"use client";

// components/EvolveRequestForm.tsx
// Shared evolve request form body used by the /evolve page, the floating
// dialog, and the follow-up panel on session detail pages.
//
// The Crosshair button (in the action row) activates a full-screen element
// inspector.  When the user clicks a page element, a screenshot + Markdown
// details file are generated and shown as a blue "element chip" alongside any
// file attachments.  Both types of attachment are included in the request on
// submit.

import { useState, useRef, useEffect, useCallback, FormEvent, memo } from "react";
import { Paperclip, Settings, ChevronDown, Crosshair, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { withBasePath } from "../lib/base-path";
import { encryptStoredApiKey } from "../lib/api-key-client";
import {
  HARNESS_OPTIONS,
  MODEL_OPTIONS_BY_HARNESS,
  DEFAULT_HARNESS,
  DEFAULT_MODEL,
} from "../lib/agent-config";
import { PageElementInspector, PageElementInfo, captureElementFiles } from "./PageElementInspector";

// ─── Types ────────────────────────────────────────────────────────────────────

/** One element selection that the user has "attached" to their request. */
interface ElementAttachmentDraft {
  id: string;
  /** Display label, e.g. "<NavHeader>" */
  label: string;
  /** CSS selector shown in tooltip */
  selector: string;
  status: "generating" | "ready" | "failed";
  /** Generated files (screenshot PNG + details Markdown) */
  files: File[];
}

// ─── ImagePreview ─────────────────────────────────────────────────────────────

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
   * When provided, called with the new sessionId instead of navigating to the
   * session page. The form resets automatically on success.
   */
  onSessionCreated?: (sessionId: string) => void;
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
  /**
   * Override the initial harness/model with the session's last-used agent
   * config. Used by the follow-up form so it inherits the previous run's
   * harness without triggering preference persistence on submit.
   * Takes priority over `initialHarness` / `initialModel`.
   */
  defaultHarness?: string;
  /** Works in tandem with `defaultHarness`. */
  defaultModel?: string;
  /**
   * Sticky preference loaded server-side at page render time.
   * Used by the /evolve page and the floating Propose-a-Change dialog.
   * Ignored when `defaultHarness` is also supplied.
   * The preference is saved back to the DB when the form is submitted
   * (handled server-side in POST /api/evolve — not by this component).
   */
  initialHarness?: string;
  /** Works in tandem with `initialHarness`. */
  initialModel?: string;
  /**
   * When the Crosshair element inspector is activated, this element (and all
   * its descendants) will be excluded from selection — typically the dialog or
   * panel that contains the form so the user doesn't accidentally pick UI
   * chrome instead of page content.
   */
  inspectorSkipElement?: HTMLElement | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EvolveRequestForm({
  compact = false,
  placeholder = "Describe the change you want to make to this app…",
  submitLabel = "Submit Request",
  onSubmit,
  onSessionCreated,
  disabled = false,
  disabledLabel,
  autoFocus = false,
  defaultHarness,
  defaultModel,
  initialHarness,
  initialModel,
  inspectorSkipElement,
}: EvolveRequestFormProps) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Priority: follow-up session default > server-loaded sticky preference > compile-time default.
  const [selectedHarness, setSelectedHarness] = useState(
    defaultHarness ?? initialHarness ?? DEFAULT_HARNESS,
  );
  const [selectedModel, setSelectedModel] = useState(
    defaultModel ?? initialModel ?? DEFAULT_MODEL,
  );
  const [cavemanMode, setCavemanMode] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Element inspector ─────────────────────────────────────────────────────

  const [inspectorActive, setInspectorActive] = useState(false);
  const [elementAttachments, setElementAttachments] = useState<ElementAttachmentDraft[]>([]);

  async function handleElementSelected(info: PageElementInfo) {
    setInspectorActive(false);
    const id = `elem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const label = `<${info.component}>`;

    // Show "generating" chip immediately so the user gets instant feedback.
    setElementAttachments((prev) => [
      ...prev,
      { id, label, selector: info.selector, status: "generating", files: [] },
    ]);

    try {
      const files = await captureElementFiles(info.element, info);
      setElementAttachments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: "ready", files } : a)),
      );
    } catch {
      setElementAttachments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: "failed" } : a)),
      );
    }
  }

  // ── Auto-resize textarea (page/non-compact mode) ──────────────────────────

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

    const effectiveRequest = cavemanMode ? `/caveman\n\n${trimmed}` : trimmed;

    // Merge regular files + all ready element attachment files.
    const allFiles: File[] = [
      ...attachedFiles,
      ...elementAttachments
        .filter((a) => a.status === "ready")
        .flatMap((a) => a.files),
    ];

    try {
      if (onSubmit) {
        await onSubmit({
          request: effectiveRequest,
          harness: selectedHarness,
          model: selectedModel,
          files: allFiles,
        });
        // Reset form on success.
        setInput("");
        setAttachedFiles([]);
        setElementAttachments([]);
        setShowAdvanced(false);
        setCavemanMode(false);
      } else {
        const formData = new FormData();
        formData.append("request", effectiveRequest);
        formData.append("harness", selectedHarness);
        formData.append("model", selectedModel);
        for (const file of allFiles) {
          formData.append("attachments", file);
        }
        const encryptedApiKey = await encryptStoredApiKey();
        if (encryptedApiKey) formData.append("encryptedApiKey", encryptedApiKey);

        const res = await fetch(withBasePath("/api/evolve"), { method: "POST", body: formData });
        const data = (await res.json()) as { sessionId?: string; error?: string };

        if (!res.ok) {
          throw new Error(data.error ?? `API error: ${res.statusText}`);
        }

        if (onSessionCreated) {
          setInput("");
          setAttachedFiles([]);
          setElementAttachments([]);
          setShowAdvanced(false);
          setSelectedHarness(DEFAULT_HARNESS);
          setSelectedModel(DEFAULT_MODEL);
          setCavemanMode(false);
          onSessionCreated(data.sessionId!);
        } else {
          router.push(`/evolve/session/${data.sessionId}`);
        }
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
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) handleFilesAdded(e.dataTransfer.files);
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const imageFiles = Array.from(e.clipboardData.files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (imageFiles.length === 0) return;
    const usedNames = new Set(attachedFiles.map((f) => f.name));
    const renamed = imageFiles.map((file) => {
      const ext =
        file.type === "image/jpeg"
          ? ".jpg"
          : file.type === "image/gif"
            ? ".gif"
            : file.type === "image/webp"
              ? ".webp"
              : ".png";
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

  const hasAttachments = attachedFiles.length > 0 || elementAttachments.length > 0;

  return (
    <div className={`flex flex-col gap-2${compact ? " flex-1 min-h-0" : ""}`}>
      {/* Page element inspector portal */}
      {inspectorActive && (
        <PageElementInspector
          onSelect={handleElementSelected}
          onCancel={() => setInspectorActive(false)}
          skipElement={inspectorSkipElement}
        />
      )}

      {error && (
        <div
          className={`px-3 py-2 rounded-lg bg-red-900/40 border border-red-700/50 text-red-300 ${compact ? "text-xs" : "text-sm"}`}
        >
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

        {/* Attachment chips — file attachments (gray) + element attachments (blue) */}
        {hasAttachments && (
          <div className="flex flex-wrap gap-1.5">
            {/* Regular file chips */}
            {attachedFiles.map((file, i) => (
              <span
                key={i}
                className={`flex items-center gap-1.5 px-2 py-1 ${compact ? "rounded" : "rounded-md"} bg-gray-800 border border-gray-700 text-xs text-gray-300`}
              >
                {file.type.startsWith("image/") && <ImagePreview file={file} />}
                <span className={`truncate ${compact ? "max-w-[140px]" : "max-w-[180px]"}`}>
                  {file.name}
                </span>
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

            {/* Element attachment chips */}
            {elementAttachments.map((attachment) => (
              <span
                key={attachment.id}
                title={
                  attachment.status === "ready"
                    ? `${attachment.selector}\n${attachment.files.map((f) => f.name).join(", ")}`
                    : attachment.status === "generating"
                      ? "Capturing element…"
                      : "Capture failed — element info may be incomplete"
                }
                className={`flex items-center gap-1.5 px-2 py-1 ${compact ? "rounded" : "rounded-md"} border text-xs ${
                  attachment.status === "failed"
                    ? "bg-red-950 border-red-700/60 text-red-300"
                    : "bg-blue-950 border-blue-700/60 text-blue-300"
                }`}
              >
                {attachment.status === "generating" ? (
                  <Loader2 size={11} className="animate-spin flex-shrink-0" aria-hidden="true" />
                ) : (
                  <Crosshair size={11} className="flex-shrink-0" aria-hidden="true" />
                )}
                <span className={`truncate ${compact ? "max-w-[120px]" : "max-w-[160px]"}`}>
                  {attachment.label}
                </span>
                {attachment.status === "generating" && (
                  <span className="text-blue-500 text-[10px]">…</span>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setElementAttachments((prev) => prev.filter((a) => a.id !== attachment.id))
                  }
                  className="text-blue-500 hover:text-blue-200 ml-0.5 flex-shrink-0"
                  aria-label={`Remove element ${attachment.label}`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Action row */}
        <div className="flex items-center gap-2">
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

          {/* File attach button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className={`flex items-center gap-1.5 ${compact ? "px-2.5" : "px-3"} py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 border border-gray-700 transition-colors disabled:opacity-50`}
          >
            <Paperclip size={14} strokeWidth={2} aria-hidden="true" />
            {compact ? "Attach" : "Attach files"}
          </button>

          {/* Element inspector (crosshair) button */}
          <button
            type="button"
            onClick={() => setInspectorActive(true)}
            disabled={isLoading || inspectorActive}
            title="Pick an element on the page to attach its details to this request"
            className={`flex items-center gap-1.5 ${compact ? "px-2.5" : "px-3"} py-1.5 rounded-lg text-xs transition-colors border disabled:opacity-50 ${
              inspectorActive
                ? "bg-blue-600/20 border-blue-600 text-blue-300"
                : "text-gray-400 hover:text-gray-200 hover:bg-gray-800 border-gray-700"
            }`}
          >
            <Crosshair size={14} strokeWidth={2} aria-hidden="true" />
            {compact ? "Pick" : "Pick element"}
          </button>

          {/* Spacer pushes submit to the right */}
          <div className="flex-1" />

          {/* Submit button */}
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
            <Settings size={14} strokeWidth={2} aria-hidden="true" />
            Advanced
            <ChevronDown
              size={12}
              strokeWidth={2}
              className={`transition-transform${showAdvanced ? " rotate-180" : ""}`}
              aria-hidden="true"
            />
          </button>

          {showAdvanced && (
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-400 w-14 flex-shrink-0">Harness</label>
                <select
                  value={selectedHarness}
                  onChange={(e) => {
                    const harness = e.target.value;
                    const models = MODEL_OPTIONS_BY_HARNESS[harness];
                    const newModel = models?.[0]?.id ?? DEFAULT_MODEL;
                    setSelectedHarness(harness);
                    setSelectedModel(newModel);
                  }}
                  disabled={isLoading}
                  className="flex-1 text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded px-2 py-1.5 focus:outline-none focus:border-gray-500 disabled:opacity-50"
                >
                  {HARNESS_OPTIONS.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.label}
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
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-14 flex-shrink-0">Caveman</span>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={cavemanMode}
                    onChange={(e) => setCavemanMode(e.target.checked)}
                    disabled={isLoading}
                    className="accent-amber-500 disabled:opacity-50"
                  />
                  <span className="text-xs text-gray-400">
                    Caveman mode — cuts ~75% output tokens
                  </span>
                </label>
              </div>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
