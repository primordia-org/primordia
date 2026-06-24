"use client";

// components/WebPreviewPanel.tsx
// Inline browser-like preview panel for evolve session pages.
// Shows an iframe with Back, Forward, Refresh buttons and an editable URL bar.
// Supports an element inspector mode that highlights nearest data-component
// and data-id elements on hover and reports both selectors on click.

import React, { useRef, useState, useCallback, useEffect } from "react";
import { ArrowLeft, ArrowRight, RotateCw, ExternalLink, Crosshair, ShieldAlert } from "lucide-react";
import { trackEvent } from "@/lib/events-client";

// ─── Element Inspector script ─────────────────────────────────────────────────
// Injected into the iframe's document when inspector mode is activated.
// Communicates results back to the parent via postMessage.
// Mouse: hover to highlight, click to select.
// Touch: drag to highlight, long-press (600 ms hold) to select.
function hasSamePathnameAsCurrentPage(url: string): boolean {
  if (typeof window === "undefined") return false;

  try {
    return new URL(url, window.location.href).pathname === window.location.pathname;
  } catch {
    return false;
  }
}

const INSPECTOR_SCRIPT = `
(function() {
  if (window.__primordiaInspectorActive) return;
  window.__primordiaInspectorActive = true;

  var hovered = null;
  var componentHighlightEl = null;
  var dataIdHighlightEl = null;
  var labelElComponent = null;
  var labelElDataId = null;
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

  function nearestNamed(el, attr) {
    var cur = el;
    while (cur && cur !== document.body) {
      if (cur.getAttribute && cur.getAttribute(attr)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function resolveTarget(rawEl) {
    var componentEl = nearestNamed(rawEl, 'data-component');
    var dataIdEl = nearestNamed(rawEl, 'data-id');
    var selectedEl = dataIdEl || componentEl;
    return selectedEl ? { componentEl: componentEl, dataIdEl: dataIdEl, selectedEl: selectedEl } : null;
  }

  function attrSelector(el, attr) {
    var value = el && el.getAttribute && el.getAttribute(attr);
    return value ? '[' + attr + '="' + cssString(value) + '"]' : null;
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

  function makeLabel(bgColor) {
    var lbl = document.createElement('div');
    lbl.style.cssText = [
      'position:fixed',
      'z-index:2147483647',
      'background:' + bgColor,
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

  function updateLabels(target) {
    var component = target.componentEl && target.componentEl.getAttribute('data-component');
    var dataId = target.dataIdEl && target.dataIdEl.getAttribute('data-id');
    var anchorEl = target.dataIdEl || target.componentEl;
    var rect = anchorEl.getBoundingClientRect();
    var labelCount = component && dataId ? 2 : 1;
    if (component && !labelElComponent) labelElComponent = makeLabel('#3b82f6');
    if (dataId && !labelElDataId) labelElDataId = makeLabel('#16a34a');
    if (labelElComponent) labelElComponent.textContent = '<' + component + '>';
    if (labelElDataId) labelElDataId.textContent = '[' + dataId + ']';
    var lblH = (labelElComponent || labelElDataId).offsetHeight || 18;
    var gap = 3;
    var top = rect.top - lblH * labelCount - gap * (labelCount - 1) - 4;
    if (top < 2) top = rect.bottom + 3;
    var left = Math.max(2, Math.min(rect.left, window.innerWidth - 240));
    if (labelElComponent) {
      labelElComponent.style.top = top + 'px';
      labelElComponent.style.left = left + 'px';
    }
    if (labelElDataId) {
      labelElDataId.style.top = (top + (component ? lblH + gap : 0)) + 'px';
      labelElDataId.style.left = left + 'px';
    }
  }

  function removeLabels() {
    if (labelElComponent) { labelElComponent.remove(); labelElComponent = null; }
    if (labelElDataId) { labelElDataId.remove(); labelElDataId = null; }
  }

  function updateHighlight(el, kind) {
    if (!el) return;
    var rect = el.getBoundingClientRect();
    var isComponent = kind === 'component';
    var highlightEl = isComponent ? componentHighlightEl : dataIdHighlightEl;
    if (!highlightEl) {
      highlightEl = document.createElement('div');
      highlightEl.id = isComponent ? 'primordia-inspector-comp-highlight' : 'primordia-inspector-data-id-highlight';
      highlightEl.style.cssText = [
        'position:fixed',
        'z-index:' + (isComponent ? '2147483644' : '2147483645'),
        'pointer-events:none',
        'border:2px solid ' + (isComponent ? '#3b82f6' : '#22c55e'),
        'background:' + (isComponent ? 'rgba(59,130,246,0.05)' : 'rgba(34,197,94,0.08)'),
      ].join(';');
      document.body.appendChild(highlightEl);
      if (isComponent) componentHighlightEl = highlightEl;
      else dataIdHighlightEl = highlightEl;
    }
    highlightEl.style.left = (rect.left - 2) + 'px';
    highlightEl.style.top = (rect.top - 2) + 'px';
    highlightEl.style.width = (rect.width + 4) + 'px';
    highlightEl.style.height = (rect.height + 4) + 'px';
  }

  function removeHighlights() {
    if (componentHighlightEl) { componentHighlightEl.remove(); componentHighlightEl = null; }
    if (dataIdHighlightEl) { dataIdHighlightEl.remove(); dataIdHighlightEl = null; }
  }

  function sameTarget(a, b) {
    return a && b && a.selectedEl === b.selectedEl && a.componentEl === b.componentEl && a.dataIdEl === b.dataIdEl;
  }

  function setHighlight(rawEl) {
    var target = resolveTarget(rawEl);
    if (sameTarget(target, hovered)) return;
    clearHighlight();
    hovered = target;
    if (hovered) {
      updateHighlight(hovered.componentEl, 'component');
      updateHighlight(hovered.dataIdEl, 'data-id');
      updateLabels(hovered);
    }
  }

  function clearHighlight() {
    hovered = null;
    removeLabels();
    removeHighlights();
  }

  function selectElement(rawEl) {
    var target = resolveTarget(rawEl);
    if (!target) return;
    var component = target.componentEl && target.componentEl.getAttribute('data-component');
    var dataId = target.dataIdEl && target.dataIdEl.getAttribute('data-id');
    var selector = attrSelector(target.componentEl, 'data-component') || attrSelector(target.dataIdEl, 'data-id') || '';
    var dataIdSelector = attrSelector(target.dataIdEl, 'data-id');
    var sourceFile = getDataSourceFile(target.selectedEl);
    window.parent.postMessage({
      type: 'primordia-element-selected',
      component: component || 'UnnamedComponent',
      selector: selector,
      dataId: dataId || null,
      dataIdSelector: dataIdSelector || null,
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
      if (hovered) selectElement(hovered.selectedEl);
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
  /** Nearest data-id label, when available. */
  dataId?: string | null;
  /** CSS selector for the nearest data-id element, when available. */
  dataIdSelector?: string | null;
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
   * Receives nearest data-component and data-id names/selectors.
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
  const initialBlockedUrl = hasSamePathnameAsCurrentPage(src) ? src : null;
  // The URL shown in the address bar — starts as the initial src.
  const [urlBarValue, setUrlBarValue] = useState(src);
  // The actual src attribute driving the iframe. We update this to navigate.
  const [iframeSrc, setIframeSrc] = useState(() => initialBlockedUrl ? "" : src);
  const [blockedRecursiveUrl, setBlockedRecursiveUrl] = useState<string | null>(initialBlockedUrl);
  const [isLoading, setIsLoading] = useState(() => !initialBlockedUrl);
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
      const iframeLocation = iframeRef.current?.contentWindow?.location;
      const href = iframeLocation?.href;
      if (href && href !== "about:blank") setUrlBarValue(href);
      if (iframeLocation?.pathname === window.location.pathname) {
        setIframeSrc("");
        setBlockedRecursiveUrl(href ?? urlBarValue);
        setInspectorActive(false);
        cancelInspector();
        return;
      }
    } catch {
      // Cross-origin frame — keep last known URL bar value.
    }
    // Re-inject inspector if it was active before the page reloaded.
    if (inspectorActiveRef.current) {
      setTimeout(() => injectInspector(), 50);
    }
  }, [cancelInspector, injectInspector, urlBarValue]);

  const handleLoadStart = useCallback(() => {
    setIsLoading(true);
  }, []);

  /** Navigate the iframe to a new URL. */
  const navigate = useCallback((url: string) => {
    setUrlBarValue(url);
    if (hasSamePathnameAsCurrentPage(url)) {
      setIframeSrc("");
      setBlockedRecursiveUrl(url);
      setIsLoading(false);
      setInspectorActive(false);
      cancelInspector();
      return;
    }

    setBlockedRecursiveUrl(null);
    setIframeSrc(url);
    setIsLoading(true);
  }, [cancelInspector]);

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
          dataId: e.data.dataId ?? null,
          dataIdSelector: e.data.dataIdSelector ?? null,
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
          blockedRecursiveUrl ? (
            <div className="h-full flex items-center justify-center bg-gray-900 px-6 text-center">
              <div className="max-w-md rounded-xl border border-amber-700/50 bg-amber-950/30 p-5 text-amber-100 shadow-lg">
                <ShieldAlert className="mx-auto mb-3 text-amber-300" size={28} aria-hidden="true" />
                <p className="font-semibold">Preview not loaded</p>
                <p className="mt-2 text-sm text-amber-200/80">
                  The iframe is already pointed at this session page, so loading it here would create an infinite nested preview.
                </p>
                <p className="mt-3 break-all font-mono text-xs text-amber-300/80">{blockedRecursiveUrl}</p>
              </div>
            </div>
          ) : (
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
          )
        ) : offlineContent}
      </div>
    </div>
  );
}
