"use client";

// components/WebPreviewPanel.tsx
// Inline browser-like preview panel for evolve session pages.
// Shows an iframe with Back, Forward, Refresh buttons and an editable URL bar.
// Supports an element inspector mode that highlights elements on hover,
// detects the React component name, and reports a CSS selector on click.

import React, { useRef, useState, useCallback, useEffect } from "react";
import { ArrowLeft, ArrowRight, RotateCw, ExternalLink, Crosshair } from "lucide-react";

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
  var longPressTimer = null;
  var touchStartX = 0;
  var touchStartY = 0;
  var LONG_PRESS_MS = 600;
  var MOVE_CANCEL_PX = 12; // cancel long-press if finger drifts more than this

  // Inject crosshair cursor style
  var styleEl = document.createElement('style');
  styleEl.id = 'primordia-inspector-style';
  styleEl.textContent = 'body.primordia-inspecting, body.primordia-inspecting * { cursor: crosshair !important; }';
  document.head.appendChild(styleEl);
  document.body.classList.add('primordia-inspecting');

  function getCssSelector(el) {
    if (!(el instanceof Element)) return '';
    var path = [];
    var current = el;
    while (current && current.tagName && current.tagName !== 'HTML' && current.tagName !== 'BODY') {
      var part = current.tagName.toLowerCase();
      if (current.id) {
        path.unshift('#' + current.id);
        break;
      }
      var classes = [];
      for (var i = 0; i < current.classList.length && classes.length < 2; i++) {
        var c = current.classList[i];
        // Skip Tailwind utility classes (contain special chars or are too long) and pseudo-variants
        if (c.length < 25 && !c.includes(':') && !c.includes('/') && !c.includes('[') && !c.includes(']')) {
          classes.push(c);
        }
      }
      if (classes.length > 0) {
        part += '.' + classes.join('.');
      }
      var siblings = current.parentElement
        ? Array.from(current.parentElement.children).filter(function(s) { return s.tagName === current.tagName; })
        : [];
      if (siblings.length > 1) {
        part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
      }
      path.unshift(part);
      if (path.length >= 5) break;
      current = current.parentElement;
    }
    return path.join(' > ');
  }

  function getReactComponentName(el) {
    var keys = Object.keys(el);
    var fiberKey = null;
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].startsWith('__reactFiber$') || keys[i].startsWith('__reactInternalInstance$')) {
        fiberKey = keys[i];
        break;
      }
    }
    if (!fiberKey) return null;
    var fiber = el[fiberKey];
    var limit = 60;
    while (fiber && limit-- > 0) {
      var type = fiber.type;
      if (type && typeof type === 'function') {
        var name = type.displayName || type.name;
        if (name && /^[A-Z]/.test(name) && name.length > 1) return name;
      }
      if (type && typeof type === 'object') {
        var name = type.displayName;
        if (!name && type.render) name = type.render.displayName || type.render.name;
        if (!name && type.type) name = type.type.displayName || type.type.name;
        if (name && /^[A-Z]/.test(name) && name.length > 1) return name;
      }
      fiber = fiber.return;
    }
    return null;
  }

  function setHighlight(el) {
    if (el === hovered) return;
    clearHighlight();
    hovered = el;
    if (hovered && hovered.style) {
      hovered.style.outline = '2px solid #3b82f6';
      hovered.style.outlineOffset = '1px';
    }
  }

  function clearHighlight() {
    if (hovered && hovered.style) {
      hovered.style.outline = '';
      hovered.style.outlineOffset = '';
    }
    hovered = null;
  }

  function selectElement(el) {
    var component = getReactComponentName(el) || 'Unknown';
    var selector = getCssSelector(el);
    window.parent.postMessage({
      type: 'primordia-element-selected',
      component: component,
      selector: selector,
    }, '*');
    deactivate();
  }

  // ── Mouse handlers ──────────────────────────────────────────────────────────

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

  // ── Touch handlers ──────────────────────────────────────────────────────────
  // Drag finger to highlight; hold still for LONG_PRESS_MS to select.

  function cancelLongPress() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function onTouchStart(e) {
    e.preventDefault(); // prevent scroll + default tap while in inspector mode
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
    // Cancel long-press if finger drifted enough (user is scanning, not holding)
    var dx = touch.clientX - touchStartX;
    var dy = touch.clientY - touchStartY;
    if (Math.sqrt(dx * dx + dy * dy) > MOVE_CANCEL_PX) {
      cancelLongPress();
    }
    var el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (el) setHighlight(el);
  }

  function onTouchEnd(e) {
    e.preventDefault();
    cancelLongPress();
  }

  // ── Deactivate ──────────────────────────────────────────────────────────────

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
  // passive: false required so preventDefault() works on touch events
  document.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
  document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
  document.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
})();
`;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ElementSelection {
  component: string;
  selector: string;
}

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
  /**
   * Called when the user selects an element via the inspector tool.
   * Receives the nearest React component name and a CSS path selector.
   */
  onElementSelected?: (info: ElementSelection) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WebPreviewPanel({ src, fullHeight = false, className, onElementSelected }: WebPreviewPanelProps) {
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
        setTimeout(() => setIframeSrc(prev), 0);
        return "";
      });
    }
  };

  const toggleInspector = useCallback(() => {
    setInspectorActive((prev) => {
      if (!prev) {
        injectInspector();
      } else {
        cancelInspector();
      }
      return !prev;
    });
  }, [injectInspector, cancelInspector]);

  // Listen for element selections and inspector-done messages from the iframe.
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.type === 'primordia-element-selected' && inspectorActive) {
        setInspectorActive(false);
        onElementSelected?.({ component: e.data.component, selector: e.data.selector });
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
          className={`p-1.5 hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors flex-shrink-0 ${isLoading ? "animate-spin rounded-full" : "rounded"}`}
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

        {/* Element inspector toggle — only shown when a callback is provided */}
        {onElementSelected && (
          <button
            type="button"
            onClick={toggleInspector}
            className={`p-1.5 rounded transition-colors flex-shrink-0 ${
              inspectorActive
                ? "bg-blue-600 text-white hover:bg-blue-500"
                : "hover:bg-gray-800 text-gray-400 hover:text-gray-200"
            }`}
            title={inspectorActive ? "Cancel element selection (Esc)" : "Pick an element to inspect"}
          >
            <Crosshair size={14} />
          </button>
        )}

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
