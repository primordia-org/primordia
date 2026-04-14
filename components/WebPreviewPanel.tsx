"use client";

// components/WebPreviewPanel.tsx
// Inline browser-like preview panel for evolve session pages.
// Shows an iframe with Back, Forward, Refresh buttons and an editable URL bar.

import React, { useRef, useState, useCallback } from "react";
import { ArrowLeft, ArrowRight, RotateCw, ExternalLink } from "lucide-react";

interface WebPreviewPanelProps {
  /** Initial URL to load in the iframe. */
  src: string;
  /**
   * When true the panel fills its container vertically (flex-1 on the iframe
   * container) instead of using a fixed 600 px height. Use this when the panel
   * is mounted inside a full-height sidebar.
   */
  fullHeight?: boolean;
  /** Extra classes applied to the outer wrapper element. */
  className?: string;
}

export function WebPreviewPanel({ src, fullHeight = false, className }: WebPreviewPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // The URL shown in the address bar — starts as the initial src.
  const [urlBarValue, setUrlBarValue] = useState(src);
  // The actual src attribute driving the iframe. We update this to navigate.
  const [iframeSrc, setIframeSrc] = useState(src);
  const [isLoading, setIsLoading] = useState(true);

  /** Called whenever the iframe finishes loading a page. */
  const handleLoad = useCallback(() => {
    setIsLoading(false);
    try {
      const href = iframeRef.current?.contentWindow?.location?.href;
      if (href && href !== "about:blank") setUrlBarValue(href);
    } catch {
      // Cross-origin frame — keep last known URL bar value.
    }
  }, []);

  const handleLoadStart = useCallback(() => {
    setIsLoading(true);
  }, []);

  /** Navigate the iframe to a new URL. */
  const navigate = useCallback((url: string) => {
    setIframeSrc(url);
    setUrlBarValue(url);
    setIsLoading(true);
  }, []);

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(urlBarValue);
  };

  const handleBack = () => {
    try {
      iframeRef.current?.contentWindow?.history.back();
    } catch { /* cross-origin */ }
  };

  const handleForward = () => {
    try {
      iframeRef.current?.contentWindow?.history.forward();
    } catch { /* cross-origin */ }
  };

  const handleRefresh = () => {
    try {
      iframeRef.current?.contentWindow?.location.reload();
    } catch {
      // Fallback: reassign the src attribute.
      setIframeSrc((prev) => {
        // Force a re-render by briefly setting empty then restoring.
        setTimeout(() => setIframeSrc(prev), 0);
        return "";
      });
    }
  };

  return (
    <div className={`${fullHeight ? 'flex flex-col h-full' : ''} rounded-lg border border-emerald-700/50 bg-gray-900 overflow-hidden${className ? ` ${className}` : ''}`}>
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-800 bg-gray-950">
        {/* Nav buttons */}
        <button
          type="button"
          onClick={handleBack}
          className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors flex-shrink-0"
          title="Back"
        >
          <ArrowLeft size={14} />
        </button>
        <button
          type="button"
          onClick={handleForward}
          className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors flex-shrink-0"
          title="Forward"
        >
          <ArrowRight size={14} />
        </button>
        <button
          type="button"
          onClick={handleRefresh}
          className={`p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors flex-shrink-0 ${isLoading ? "animate-spin" : ""}`}
          title="Refresh"
        >
          <RotateCw size={14} />
        </button>

        {/* URL bar */}
        <form onSubmit={handleUrlSubmit} className="flex-1 mx-1 min-w-0">
          <input
            type="text"
            value={urlBarValue}
            onChange={(e) => setUrlBarValue(e.target.value)}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            className="w-full px-2.5 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-200 font-mono focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600/30 truncate"
            aria-label="Preview URL"
          />
        </form>

        {/* Open in new tab */}
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors flex-shrink-0"
          title="Open in new tab"
        >
          <ExternalLink size={14} />
        </a>
      </div>

      {/* ── iframe ── */}
      <div className={`relative ${fullHeight ? 'flex-1' : ''}`} style={fullHeight ? undefined : { height: "600px" }}>
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900 z-10 pointer-events-none">
            <span className="text-gray-500 text-xs animate-pulse">Loading preview…</span>
          </div>
        )}
        {iframeSrc ? (
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            onLoad={handleLoad}
            onLoadStart={handleLoadStart as React.ReactEventHandler<HTMLIFrameElement>}
            className="w-full h-full bg-white"
            style={{ border: "none", display: "block" }}
            title="Web preview"
          />
        ) : null}
      </div>
    </div>
  );
}
