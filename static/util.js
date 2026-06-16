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
  window.toggleTheme = toggleTheme;
  window.applyThemeButtonLabel = applyThemeButtonLabel;
})();
