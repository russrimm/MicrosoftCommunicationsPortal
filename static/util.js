// Shared client-side utilities for the Microsoft Communications Portal.
// Loaded synchronously in <head> by every page, so its globals are available
// to inline page scripts.
//
// Exposes:
//   window.escapeHtml(value)        — string -> HTML-safe string
//   window.toggleTheme()            — flip data-theme, persist, update button label
//   window.applyThemeButtonLabel()  — set the #theme-btn label from current theme
//
// Theme is also persisted in localStorage so reloads keep the user's choice.
(function () {
  'use strict';

  var THEME_KEY = 'mcp.theme';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Hardened URL guard ─────────────────────────────────────────────────────
  // Allow only http(s), mailto, and tel schemes. Protocol-relative URLs (//host)
  // are rejected so they cannot inherit an attacker-controlled scheme.
  function safeUrl(value) {
    if (!value) return '#';
    var trimmed = String(value).trim();
    if (/^\/\//.test(trimmed)) return '#';               // protocol-relative
    if (/[\u0000-\u001f]/.test(trimmed)) return '#';     // control chars used to smuggle schemes
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
      if (!/^(https?|mailto|tel):/i.test(trimmed)) return '#';
    }
    return trimmed;
  }

  // ── Hardened allow-list HTML sanitizer ─────────────────────────────────────
  // Replaces the per-page deny-list sanitizers. Parses untrusted feed/Graph HTML
  // with DOMParser (no script execution), then keeps ONLY an explicit allow-list
  // of tags/attributes. Unknown-but-benign tags are unwrapped (their text is
  // preserved); known-dangerous tags are dropped entirely. This resists mutation
  // XSS far better than a blacklist because anything not on the list cannot survive.
  var ALLOWED_TAGS = {
    A: 1, ABBR: 1, B: 1, BLOCKQUOTE: 1, BR: 1, CAPTION: 1, CODE: 1, DD: 1,
    DIV: 1, DL: 1, DT: 1, EM: 1, FIGCAPTION: 1, FIGURE: 1, H1: 1, H2: 1, H3: 1,
    H4: 1, H5: 1, H6: 1, HR: 1, I: 1, IMG: 1, LI: 1, OL: 1, P: 1, PRE: 1,
    SMALL: 1, SPAN: 1, STRONG: 1, SUB: 1, SUP: 1, TABLE: 1, TBODY: 1, TD: 1,
    TFOOT: 1, TH: 1, THEAD: 1, TR: 1, U: 1, UL: 1
  };
  var ALLOWED_ATTRS = {
    href: 1, src: 1, alt: 1, title: 1, colspan: 1, rowspan: 1,
    lang: 1, dir: 1, width: 1, height: 1
  };
  // Dropped entirely (element + subtree) because their content is executable or
  // can re-introduce script through parser mutation.
  var DANGEROUS_TAGS = {
    SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, FORM: 1, INPUT: 1,
    BUTTON: 1, TEXTAREA: 1, SELECT: 1, OPTION: 1, BASE: 1, META: 1, LINK: 1,
    SVG: 1, MATH: 1, TEMPLATE: 1, NOSCRIPT: 1, VIDEO: 1, AUDIO: 1, SOURCE: 1,
    TRACK: 1, CANVAS: 1, FRAME: 1, FRAMESET: 1, APPLET: 1, PORTAL: 1
  };

  function sanitizeHtml(html) {
    if (!html) return '';
    var doc;
    try {
      doc = new DOMParser().parseFromString(String(html), 'text/html');
    } catch (_e) {
      return '';
    }
    var els = doc.body ? doc.body.querySelectorAll('*') : [];
    var toRemove = [];
    var toUnwrap = [];
    for (var i = 0; i < els.length; i++) {
      var node = els[i];
      var tag = node.tagName;
      if (!ALLOWED_TAGS[tag]) {
        if (DANGEROUS_TAGS[tag]) toRemove.push(node);
        else toUnwrap.push(node);
        continue;
      }
      // Strip every attribute not explicitly allowed (kills on*, style, srcdoc, etc.).
      for (var a = node.attributes.length - 1; a >= 0; a--) {
        var attr = node.attributes[a];
        var name = attr.name.toLowerCase();
        if (!ALLOWED_ATTRS[name]) { node.removeAttribute(attr.name); continue; }
        if (name === 'href' || name === 'src') {
          var cleaned = safeUrl(attr.value);
          // src must be http(s) only — no mailto/tel and no data:/blob: images.
          if (cleaned === '#' || (name === 'src' && !/^https?:/i.test(cleaned))) {
            node.removeAttribute(attr.name);
          } else {
            node.setAttribute(name, cleaned);
          }
        }
      }
      if (tag === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
      if (tag === 'IMG') {
        node.setAttribute('referrerpolicy', 'no-referrer');
        node.setAttribute('loading', 'lazy');
        if (!node.getAttribute('src')) toRemove.push(node);
      }
    }
    for (var r = 0; r < toRemove.length; r++) {
      var rem = toRemove[r];
      if (rem.parentNode) rem.parentNode.removeChild(rem);
    }
    for (var u = 0; u < toUnwrap.length; u++) {
      var un = toUnwrap[u];
      if (!un.parentNode) continue;
      while (un.firstChild) un.parentNode.insertBefore(un.firstChild, un);
      un.parentNode.removeChild(un);
    }
    return doc.body ? doc.body.innerHTML : '';
  }

  function applyThemeButtonLabel() {
    var btn = document.getElementById('theme-btn');
    if (!btn) return;
    var theme = document.documentElement.getAttribute('data-theme');
    btn.textContent = theme === 'dark' ? '\u2600\uFE0F Light' : '\uD83C\uDF19 Dark';
  }

  function toggleTheme() {
    var html = document.documentElement;
    var next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch (_) { /* private mode, ignore */ }
    applyThemeButtonLabel();
  }

  // Reapply persisted theme (only if the URL didn't override it).
  // The FOUC-prevention IIFE in each <head> already set data-theme based on
  // ?clawpilotTheme=… or prefers-color-scheme. If localStorage has a saved
  // choice and no URL override, prefer the saved value.
  try {
    var urlOverride = new URLSearchParams(window.location.search).get('clawpilotTheme');
    if (!urlOverride) {
      var saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') {
        document.documentElement.setAttribute('data-theme', saved);
      }
    }
  } catch (_) { /* ignore */ }

  // Set the initial button label once the DOM has the button rendered.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyThemeButtonLabel, { once: true });
  } else {
    applyThemeButtonLabel();
  }

  // Export globals.
  window.escapeHtml = escapeHtml;
  window.safeUrl = safeUrl;
  window.sanitizeHtml = sanitizeHtml;
  window.toggleTheme = toggleTheme;
  window.applyThemeButtonLabel = applyThemeButtonLabel;
  // Namespaced accessors — safe to call even when a page defines its own
  // top-level function named sanitizeHtml/safeUrl (which would otherwise shadow
  // the window globals above and cause recursion).
  window.CPUtil = {
    escapeHtml: escapeHtml,
    safeUrl: safeUrl,
    sanitizeHtml: sanitizeHtml
  };

  // ── Event delegation (replaces inline on* handlers for CSP compliance) ──────
  // Elements declare data-act="actionName" (and optional data-on="click|change|
  // input"; default "click"). Actions resolve first from an explicitly registered
  // map, then fall back to a same-named global function. Handlers are invoked as
  // fn.call(element, event, element). This lets us drop script-src 'unsafe-inline'.
  var CP_ACTIONS = Object.create(null);
  function registerActions(map) {
    if (!map) return;
    for (var k in map) {
      if (Object.prototype.hasOwnProperty.call(map, k)) CP_ACTIONS[k] = map[k];
    }
  }
  function runAction(el, e) {
    if (!el) return;
    var act = el.getAttribute('data-act');
    if (!act) return;
    var fn = CP_ACTIONS[act] || (typeof window[act] === 'function' ? window[act] : null);
    if (fn) fn.call(el, e, el);
  }
  function delegatedHandler(e) {
    var el = (e.target && e.target.closest) ? e.target.closest('[data-act]') : null;
    if (!el) return;
    var on = el.getAttribute('data-on') || 'click';
    if (on !== e.type) return;
    runAction(el, e);
  }
  document.addEventListener('click', delegatedHandler, false);
  document.addEventListener('change', delegatedHandler, false);
  document.addEventListener('input', delegatedHandler, false);
  // Keyboard activation (Enter/Space) for non-native controls (role="button").
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    var el = (e.target && e.target.closest) ? e.target.closest('[data-act]') : null;
    if (!el) return;
    var tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if ((el.getAttribute('data-on') || 'click') !== 'click') return;
    e.preventDefault();
    runAction(el, e);
  }, false);
  window.CPActions = { register: registerActions, run: runAction };
})();
