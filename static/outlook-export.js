/**
 * Outlook-friendly HTML export builder.
 *
 * Why a separate module?
 * When a user pastes an HTML file into a *new* Outlook email, Outlook's
 * compose surface (the Word HTML renderer on Windows; a sanitized
 * renderer on Mac/Web/Mobile) aggressively strips `<style>` blocks,
 * `[data-ogsc]` selectors, `@media (prefers-color-scheme)` rules, CSS
 * variables, and most class-based selectors. The only things that
 * reliably survive are:
 *   - Inline `style="..."` on every element
 *   - Legacy HTML4 attributes (`bgcolor`, `align`, `valign`, `width`)
 *   - `mso-*` properties inside inline styles
 *
 * So this module emits a table where EVERY cell carries inline colors
 * and a redundant `bgcolor` attribute. It commits to a single high-
 * contrast light palette (Outlook's own dark-mode rendering handles the
 * conversion more reliably than our own dark CSS would).
 *
 * Usage:
 *   const html = window.OutlookExport.buildHtml({
 *     title:    'Power Platform Release Plan',
 *     subtitle: 'Exported … • 35 features',
 *     columns:  ['Product', 'Feature Name', ...],
 *     rows: [
 *       ['Power Apps', 'Improve bulk delete …', ...],
 *       ...
 *     ],
 *   });
 *   window.OutlookExport.download({ ..., filename: 'rpe-2026-06-15.html' });
 */
(function () {
  'use strict';

  // ── Palette (must work both standalone in a browser AND when pasted into Outlook) ──
  const C = {
    bg:        '#ffffff',
    text:      '#1f2937',
    muted:     '#6b7280',
    headerBg:  '#0078d4',
    headerTxt: '#ffffff',
    headerBd:  '#005a9e',
    rowAlt:    '#f3f6fb',
    border:    '#d1d5db',
    cellBd:    '#e5e7eb',
    link:      '#0067b8',
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(s) { return escapeHtml(s); }

  // Wrap raw HTML/text so it survives both the browser AND Outlook compose.
  // - `escape: true` (default) HTML-escapes; pass false if `value` is already
  //   trusted HTML (e.g. a sanitized `<a>` link).
  // - `nowrap: true` keeps the cell on one line (use for short IDs that have
  //   no break opportunities, e.g. "MC1383792").
  function cell(value, opts) {
    opts = opts || {};
    const isEven = !!opts.even;
    const bg     = isEven ? C.rowAlt : C.bg;
    const align  = opts.align || 'left';
    const valign = opts.valign || 'top';
    const nowrap = !!opts.nowrap;
    const inner  = opts.escape === false ? String(value || '') : escapeHtml(value || '—');
    const style  = [
      'background-color:' + bg,
      'color:' + C.text,
      'border:1px solid ' + C.cellBd,
      'padding:8px 12px',
      'vertical-align:' + valign,
      'text-align:' + align,
      'mso-line-height-rule:exactly',
      'line-height:1.4',
      'font-size:13px',
      "font-family:'Segoe UI',Calibri,Arial,sans-serif",
      nowrap ? 'white-space:nowrap' : 'word-break:break-word',
    ].join(';') + ';';
    const nowrapAttr = nowrap ? ' nowrap="nowrap"' : '';
    return '<td bgcolor="' + bg + '" align="' + align + '" valign="' + valign
      + '"' + nowrapAttr + ' style="' + style + '">' + (inner || '—') + '</td>';
  }

  function headerCell(label) {
    const style = [
      'background-color:' + C.headerBg,
      'color:' + C.headerTxt,
      'border:1px solid ' + C.headerBd,
      'padding:9px 12px',
      'vertical-align:top',
      'text-align:left',
      'font-weight:600',
      'font-size:13px',
      "font-family:'Segoe UI',Calibri,Arial,sans-serif",
      'mso-line-height-rule:exactly',
      'line-height:1.35',
      'white-space:nowrap',
    ].join(';') + ';';
    return '<th bgcolor="' + C.headerBg + '" align="left" valign="top" style="'
      + style + '">' + escapeHtml(label) + '</th>';
  }

  // Build a single anchor that survives Outlook compose.
  function link(href, label) {
    if (!href) return '—';
    const h = escapeAttr(href);
    const l = escapeHtml(label || href);
    return '<a href="' + h + '" target="_blank" rel="noopener noreferrer" '
      + 'style="color:' + C.link + ';text-decoration:underline;">' + l + '</a>';
  }

  function buildHtml(spec) {
    spec = spec || {};
    const title    = spec.title    || 'Export';
    const subtitle = spec.subtitle || '';
    const columns  = spec.columns  || [];
    const rows     = spec.rows     || [];

    const thead = '<tr>' + columns.map(headerCell).join('') + '</tr>';

    const tbody = rows.map((cells, i) => {
      const even = i % 2 === 1;
      const cellsHtml = cells.map(c => {
        // Accept either a plain string (escape it) or { html, align, valign, nowrap }
        // where `html` is pre-escaped trusted markup (e.g. an <a> link).
        if (c && typeof c === 'object' && 'html' in c) {
          return cell(c.html, { even, escape: false, align: c.align, valign: c.valign, nowrap: c.nowrap });
        }
        if (c && typeof c === 'object' && 'value' in c) {
          return cell(c.value, { even, align: c.align, valign: c.valign, nowrap: c.nowrap });
        }
        return cell(c, { even });
      }).join('');
      return '<tr>' + cellsHtml + '</tr>';
    }).join('\n');

    const tableStyle = [
      'border-collapse:collapse',
      'border-spacing:0',
      'width:100%',
      'background-color:' + C.bg,
      'color:' + C.text,
      'border:1px solid ' + C.border,
      'mso-table-lspace:0pt',
      'mso-table-rspace:0pt',
      "font-family:'Segoe UI',Calibri,Arial,sans-serif",
      'font-size:13px',
    ].join(';') + ';';

    const bodyStyle = [
      'margin:0',
      'padding:24px',
      'background-color:' + C.bg,
      'color:' + C.text,
      "font-family:'Segoe UI',Calibri,Arial,sans-serif",
      'font-size:13px',
      'mso-line-height-rule:exactly',
      'line-height:1.45',
    ].join(';') + ';';

    const h2Style = 'font-size:18px;font-weight:600;margin:0 0 4px;color:' + C.text
      + ";font-family:'Segoe UI',Calibri,Arial,sans-serif;";
    const pStyle  = 'font-size:12px;color:' + C.muted + ';margin:0 0 14px;'
      + "font-family:'Segoe UI',Calibri,Arial,sans-serif;";

    return '<!DOCTYPE html>\n'
      + '<html lang="en">\n'
      + '<head>\n'
      + '  <meta charset="UTF-8">\n'
      + '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
      + '  <meta name="color-scheme" content="light only">\n'
      + '  <meta name="supported-color-schemes" content="light">\n'
      + '  <title>' + escapeHtml(title) + '</title>\n'
      + '  <!--[if mso]>\n'
      + '  <style type="text/css">\n'
      + '    table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }\n'
      + '    td,th { mso-line-height-rule:exactly; }\n'
      + '  </style>\n'
      + '  <![endif]-->\n'
      + '  <style>\n'
      + '    /* Standalone browser fallback only — Outlook strips this. */\n'
      + '    body { background:' + C.bg + '; color:' + C.text + "; font-family:'Segoe UI',Calibri,Arial,sans-serif; }\n"
      + '  </style>\n'
      + '</head>\n'
      + '<body bgcolor="' + C.bg + '" style="' + bodyStyle + '">\n'
      + '  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" '
      + 'bgcolor="' + C.bg + '" style="background-color:' + C.bg + ';">\n'
      + '    <tr><td bgcolor="' + C.bg + '" style="background-color:' + C.bg + ';padding:0;">\n'
      + '      <h2 style="' + h2Style + '">' + escapeHtml(title) + '</h2>\n'
      + (subtitle ? '      <p style="' + pStyle + '">' + escapeHtml(subtitle) + '</p>\n' : '')
      + '      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" '
      + 'bgcolor="' + C.bg + '" style="' + tableStyle + '">\n'
      + '        <thead>' + thead + '</thead>\n'
      + '        <tbody>\n' + tbody + '\n        </tbody>\n'
      + '      </table>\n'
      + '    </td></tr>\n'
      + '  </table>\n'
      + '</body>\n'
      + '</html>\n';
  }

  function download(spec) {
    const html = buildHtml(spec);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = spec.filename || ('export-' + new Date().toISOString().slice(0, 10) + '.html');
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return html;
  }

  window.OutlookExport = { buildHtml, download, link, escapeHtml };
})();
