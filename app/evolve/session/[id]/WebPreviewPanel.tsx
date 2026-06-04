"use client";

// components/WebPreviewPanel.tsx
// Inline browser-like preview panel for evolve session pages.
// Shows an iframe with Back, Forward, Refresh buttons and an editable URL bar.
// Supports an element inspector mode that highlights the nearest data-component
// element on hover and reports its data-component selector on click.

import React, { useRef, useState, useCallback, useEffect } from "react";
import { ArrowLeft, ArrowRight, RotateCw, ExternalLink, Crosshair } from "lucide-react";
import { trackEvent } from "@/lib/events-client";

// ─── Element Inspector script ─────────────────────────────────────────────────
// Injected into the iframe's document when inspector mode is activated.
// Communicates results back to the parent via postMessage.
// Mouse: hover to highlight, click to select.
// Touch: drag to highlight, long-press (600 ms hold) to select.
const INSPECTOR_SCRIPT = `
(function() {
  if (window.__primordiaInspectorActive) return;
  window.__primordiaInspectorActive = true;

  var hovered = null;
  var highlightEl = null;
  var labelEl = null;
  var longPressTimer = null;
  var touchStartX = 0;
  var touchStartY = 0;
  var LONG_PRESS_MS = 600;
  var MOVE_CANCEL_PX = 12;

  var styleEl = document.createElement('style');
  styleEl.id = 'primordia-inspector-style';
  styleEl.textContent = 'body.primordia-inspecting, body.primordia-inspecting * { cursor: crosshair !important; }';
  document.head.appendChild(styleEl);
  document.body.classList.add('primordia-inspecting');

  function cssString(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function nearestDataComponent(el) {
    var cur = el;
    while (cur && cur !== document.body) {
      if (cur.getAttribute && cur.getAttribute('data-component')) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function getCssSelector(el) {
    var component = el && el.getAttribute && el.getAttribute('data-component');
    return component ? '[data-component="' + cssString(component) + '"]' : '';
  }

  function getDataSourceFile(el) {
    var cur = el;
    while (cur && cur !== document.body) {
      var sf = cur.getAttribute && cur.getAttribute('data-source-file');
      if (sf) return sf;
      cur = cur.parentElement;
    }
    return null;
  }

  function makeLabel() {
    var lbl = document.createElement('div');
    lbl.style.cssText = [
      'position:fixed',
      'z-index:2147483647',
      'background:#3b82f6',
      'color:#fff',
      'font:bold 11px/1.6 monospace',
      'padding:1px 6px',
      'border-radius:3px',
      'pointer-events:none',
      'white-space:nowrap',
      'max-width:60vw',
      'overflow:hidden',
      'text-overflow:ellipsis',
      'box-shadow:0 1px 4px rgba(0,0,0,0.5)',
    ].join(';');
    document.body.appendChild(lbl);
    return lbl;
  }

  function updateLabel(el) {
    if (!labelEl) labelEl = makeLabel();
    labelEl.textContent = '<' + el.getAttribute('data-component') + '>';
    var rect = el.getBoundingClientRect();
    var lblH = labelEl.offsetHeight || 18;
    var top = rect.top - lblH - 7;
    if (top < 2) top = rect.bottom + 3;
    var left = Math.max(2, Math.min(rect.left, window.innerWidth - 200));
    labelEl.style.top = top + 'px';
    labelEl.style.left = left + 'px';
  }

  function removeLabel() {
    if (labelEl) { labelEl.remove(); labelEl = null; }
  }

  function updateHighlight(el) {
    var rect = el.getBoundingClientRect();
    if (!highlightEl) {
      highlightEl = document.createElement('div');
      highlightEl.id = 'primordia-inspector-comp-highlight';
      highlightEl.style.cssText = [
        'position:fixed',
        'z-index:2147483644',
        'pointer-events:none',
        'border:2px solid #3b82f6',
        'background:rgba(59,130,246,0.05)',
      ].join(';');
      document.body.appendChild(highlightEl);
    }
    highlightEl.style.left = (rect.left - 2) + 'px';
    highlightEl.style.top = (rect.top - 2) + 'px';
    highlightEl.style.width = (rect.width + 4) + 'px';
    highlightEl.style.height = (rect.height + 4) + 'px';
  }

  function removeHighlight() {
    if (highlightEl) { highlightEl.remove(); highlightEl = null; }
  }

  function setHighlight(rawEl) {
    var el = nearestDataComponent(rawEl);
    if (el === hovered) return;
    clearHighlight();
    hovered = el;
    if (hovered) {
      updateHighlight(hovered);
      updateLabel(hovered);
    }
  }

  function clearHighlight() {
    hovered = null;
    removeLabel();
    removeHighlight();
  }

  function selectElement(rawEl) {
    var el = nearestDataComponent(rawEl);
    if (!el) return;
    var component = el.getAttribute('data-component');
    var selector = getCssSelector(el);
    var sourceFile = getDataSourceFile(el);
    window.parent.postMessage({
      type: 'primordia-element-selected',
      component: component,
      selector: selector,
      sourceFile: sourceFile || null,
    }, '*');
    deactivate();
  }

  function onMouseOver(e) {
    setHighlight(e.target);
    e.stopPropagation();
  }

  function onMouseOut(e) {
    clearHighlight();
    e.stopPropagation();
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    selectElement(e.target);
  }

  function cancelLongPress() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function onTouchStart(e) {
    e.preventDefault();
    var touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    var el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (el) setHighlight(el);
    cancelLongPress();
    longPressTimer = setTimeout(function() {
      longPressTimer = null;
      if (hovered) selectElement(hovered);
    }, LONG_PRESS_MS);
  }

  function onTouchMove(e) {
    e.preventDefault();
    var touch = e.touches[0];
    var dx = touch.clientX - touchStartX;
    var dy = touch.clientY - touchStartY;
    if (Math.sqrt(dx * dx + dy * dy) > MOVE_CANCEL_PX) cancelLongPress();
    var el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (el) setHighlight(el);
  }

  function onTouchEnd(e) {
    e.preventDefault();
    cancelLongPress();
  }

  function deactivate() {
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('mouseout', onMouseOut, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('touchstart', onTouchStart, true);
    document.removeEventListener('touchmove', onTouchMove, true);
    document.removeEventListener('touchend', onTouchEnd, true);
    cancelLongPress();
    clearHighlight();
    document.body.classList.remove('primordia-inspecting');
    var s = document.getElementById('primordia-inspector-style');
    if (s) s.remove();
    window.__primordiaInspectorActive = false;
  }

  window.addEventListener('message', function onMsg(e) {
    if (e.data && e.data.type === 'primordia-inspector-cancel') {
      deactivate();
      window.removeEventListener('message', onMsg);
    }
  });

  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('mouseout', onMouseOut, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
  document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
  document.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
})();
`;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ElementSelection {
  component: string;
  selector: string;
  /** Source filename from data-source-file attribute, if available. */
  sourceFile?: string | null;
}

interface WebPreviewPanelProps {
  /** Initial URL to load in the iframe. */
  src: string;
  /** Session ID for event tracking. */
  sessionId?: string;
  /**
   * When true the panel fills its container vertically (flex-1 on the iframe
   * container) instead of using a fixed 600 px height. Use this when the panel
   * is mounted inside a full-height sidebar.
   */
  fullHeight?: boolean;
  /** Extra classes applied to the outer wrapper element. */
  className?: string;
  /** Whether the preview iframe should be loaded. Toolbar stays visible either way. */
  serverRunning?: boolean;
  /** Content shown below the toolbar when the preview server is not running. */
  offlineContent?: React.ReactNode;
  /**
   * Called when the user selects an element via the inspector tool.
   * Receives the nearest data-component name and data-component selector.
   */
  onElementSelected?: (info: ElementSelection) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WebPreviewPanel({
  src,
  sessionId,
  fullHeight = false,
  className,
  serverRunning = true,
  offlineContent,
  onElementSelected,
}: WebPreviewPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // The URL shown in the address bar — starts as the initial src.
  const [urlBarValue, setUrlBarValue] = useState(src);
  // The actual src attribute driving the iframe. We update this to navigate.
  const [iframeSrc, setIframeSrc] = useState(src);
  const [isLoading, setIsLoading] = useState(true);
  const [inspectorActive, setInspectorActive] = useState(false);
  // Ref so handleLoad can read the latest inspector state without stale closure.
  const inspectorActiveRef = useRef(false);
  useEffect(() => { inspectorActiveRef.current = inspectorActive; }, [inspectorActive]);

  const browserButtonClass = "p-1.5 rounded text-gray-400 transition-colors flex-shrink-0 enabled:hover:bg-gray-800 enabled:hover:text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed";

  const injectInspector = useCallback(() => {
    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc || !doc.head) return;
      // Remove stale instance if present
      doc.getElementById('primordia-inspector-script')?.remove();
      const script = doc.createElement('script');
      script.id = 'primordia-inspector-script';
      script.textContent = INSPECTOR_SCRIPT;
      doc.head.appendChild(script);
    } catch {
      // Cross-origin — inspector not available
    }
  }, []);

  const cancelInspector = useCallback(() => {
    try {
      iframeRef.current?.contentWindow?.postMessage({ type: 'primordia-inspector-cancel' }, '*');
    } catch { /* cross-origin */ }
  }, []);

  useEffect(() => {
    if (serverRunning) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(false);
    setInspectorActive(false);
    cancelInspector();
  }, [serverRunning, cancelInspector]);

  /** Called whenever the iframe finishes loading a page. */
  const handleLoad = useCallback(() => {
    setIsLoading(false);
    try {
      const href = iframeRef.current?.contentWindow?.location?.href;
      if (href && href !== "about:blank") setUrlBarValue(href);
    } catch {
      // Cross-origin frame — keep last known URL bar value.
    }
    // Re-inject inspector if it was active before the page reloaded.
    if (inspectorActiveRef.current) {
      setTimeout(() => injectInspector(), 50);
    }
  }, [injectInspector]);

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
    if (!serverRunning) return;
    trackEvent("preview/url-navigated/v1", { sessionId, url: urlBarValue });
    navigate(urlBarValue);
  };

  const handleBack = () => {
    if (!serverRunning) return;
    trackEvent("preview/back-clicked/v1", { sessionId });
    try {
      iframeRef.current?.contentWindow?.history.back();
    } catch { /* cross-origin */ }
  };

  const handleForward = () => {
    if (!serverRunning) return;
    trackEvent("preview/forward-clicked/v1", { sessionId });
    try {
      iframeRef.current?.contentWindow?.history.forward();
    } catch { /* cross-origin */ }
  };

  const handleRefresh = () => {
    if (!serverRunning) return;
    trackEvent("preview/refresh-clicked/v1", { sessionId });
    try {
      iframeRef.current?.contentWindow?.location.reload();
    } catch {
      // Fallback: reassign the src attribute.
      setIframeSrc((prev) => {
        setTimeout(() => setIframeSrc(prev), 0);
        return "";
      });
    }
  };

  const toggleInspector = useCallback(() => {
    if (!serverRunning) return;
    setInspectorActive((prev) => {
      const next = !prev;
      trackEvent("preview/inspector-toggled/v1", { sessionId, active: next });
      if (next) {
        injectInspector();
      } else {
        cancelInspector();
      }
      return next;
    });
  }, [injectInspector, cancelInspector, serverRunning, sessionId]);

  // Listen for element selections and inspector-done messages from the iframe.
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.type === 'primordia-element-selected' && inspectorActive) {
        setInspectorActive(false);
        onElementSelected?.({
          component: e.data.component,
          selector: e.data.selector,
          sourceFile: e.data.sourceFile ?? null,
        });
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [inspectorActive, onElementSelected]);

  // Cancel inspector on Escape key.
  useEffect(() => {
    if (!inspectorActive) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        cancelInspector();
        setInspectorActive(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [inspectorActive, cancelInspector]);

  return (
    <div className={`${fullHeight ? 'flex flex-col h-full' : ''} overflow-hidden${className ? ` ${className}` : ''}`}>
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-800 bg-gray-950">
        {/* Nav buttons */}
        <button
          data-id="preview/back"
          type="button"
          onClick={handleBack}
          disabled={!serverRunning}
          className={browserButtonClass}
          title={serverRunning ? "Back" : "Preview server is not running"}
        >
          <ArrowLeft size={14} />
        </button>
        <button
          data-id="preview/forward"
          type="button"
          onClick={handleForward}
          disabled={!serverRunning}
          className={browserButtonClass}
          title={serverRunning ? "Forward" : "Preview server is not running"}
        >
          <ArrowRight size={14} />
        </button>
        <button
          data-id="preview/refresh"
          type="button"
          onClick={handleRefresh}
          disabled={!serverRunning}
          className={`${browserButtonClass} ${serverRunning && isLoading ? "animate-spin rounded-full" : ""}`}
          title={serverRunning ? "Refresh" : "Preview server is not running"}
        >
          <RotateCw size={14} />
        </button>

        {/* URL bar */}
        <form onSubmit={handleUrlSubmit} className="flex-1 mx-1 min-w-0">
          <input
            data-id="preview/url-bar"
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

        {/* Element inspector toggle — only shown when a callback is provided */}
        {onElementSelected && (
          <button
            data-id="preview/inspector-toggle"
            type="button"
            onClick={toggleInspector}
            disabled={!serverRunning}
            className={`p-1.5 rounded transition-colors flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
              inspectorActive
                ? "bg-blue-600 text-white enabled:hover:bg-blue-500"
                : "text-gray-400 enabled:hover:bg-gray-800 enabled:hover:text-gray-200"
            }`}
            title={!serverRunning ? "Preview server is not running" : inspectorActive ? "Cancel element selection (Esc)" : "Pick an element to inspect"}
          >
            <Crosshair size={14} />
          </button>
        )}

        {/* Open in new tab */}
        <a
          data-id="preview/open-in-new-tab"
          href={urlBarValue || src}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackEvent("preview/open-in-new-tab/v1", { sessionId })}
          className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors flex-shrink-0"
          title="Open in new tab"
        >
          <ExternalLink size={14} />
        </a>
      </div>

      {/* Inspector active hint */}
      {inspectorActive && (
        <div className="px-3 py-1.5 bg-blue-950/60 border-b border-blue-700/40 text-xs text-blue-300 flex items-center gap-2">
          <Crosshair size={11} className="flex-shrink-0" />
          <span className="hidden sm:inline">Click an element to capture it. On touch: drag to highlight, hold to select.</span>
          <span className="sm:hidden">Drag to highlight · Hold to select</span>
          <span className="hidden sm:inline text-blue-500 ml-1">Esc to cancel.</span>
        </div>
      )}

      {/* ── iframe ── */}
      <div className={`relative ${fullHeight ? 'flex-1' : ''}`} style={fullHeight ? undefined : { height: "600px" }}>
        {serverRunning ? (
          <>
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
          </>
        ) : offlineContent}
      </div>
    </div>
  );
}
