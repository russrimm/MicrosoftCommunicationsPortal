/**
 * Multi-format export dispatcher.
 *
 * Formats:
 *   - html : Outlook-friendly HTML table (delegates to window.OutlookExport)
 *   - md   : GitHub-flavored Markdown table
 *   - pdf  : opens a print-optimized version in a new window and triggers
 *            window.print(); user chooses "Save as PDF" from the print dialog
 *   - docx : Word-compatible HTML with Office XML namespaces + .doc filename +
 *            application/msword MIME. Word / LibreOffice open it as a
 *            formatted document. NOTE: this is NOT a true zipped .docx file.
 *            A real .docx would require a ~150 KB library (docx.js, docxtemplater).
 *            We stayed dependency-free per project convention. If you need real
 *            .docx (e.g., for SharePoint metadata, programmatic parsing, or
 *            .docx-only tooling), add a library and swap window.ExportFormats.buildDocx.
 *
 * Usage:
 *   window.ExportFormats.download({
 *     title:    'Azure Roadmap',
 *     subtitle: 'Exported 2026-07-04 • 42 updates',
 *     columns:  ['Product', 'Title', 'Status', ...],
 *     rows:     [ ['Power Apps', 'Improve bulk delete', 'Launched', ...], ... ],
 *     baseFilename: 'azureupdates-export-2026-07-04',
 *     format:   'html' | 'md' | 'pdf' | 'docx',
 *   });
 *
 * Row cells accept:
 *   - a plain string  (HTML-escaped)
 *   - { value: '...' }         (HTML-escaped)
 *   - { html: '<a>...</a>' }   (pre-escaped, trusted markup — HTML/PDF/DOCX only;
 *                               for MD the module falls back to a text extraction)
 */
(function () {
  'use strict';

  const EXT = { html: 'html', md: 'md', pdf: 'pdf', docx: 'doc' };
  const MIME = {
    html: 'text/html;charset=utf-8',
    md:   'text/markdown;charset=utf-8',
    docx: 'application/msword',
  };

  function cellText(c) {
    if (c == null) return '';
    if (typeof c === 'string' || typeof c === 'number') return String(c);
    if (typeof c === 'object') {
      if ('value' in c) return String(c.value == null ? '' : c.value);
      if ('html'  in c) {
        // Strip tags for text-only formats.
        const tmp = document.createElement('div');
        tmp.innerHTML = String(c.html || '');
        return (tmp.textContent || '').trim();
      }
    }
    return String(c);
  }

  function cellHref(c) {
    if (c && typeof c === 'object' && 'html' in c) {
      const m = /href\s*=\s*"([^"]+)"/i.exec(String(c.html || ''));
      if (m) return m[1];
    }
    return null;
  }

  // ── Markdown ──────────────────────────────────────────────────────────────
  function mdEscape(s) {
    return String(s == null ? '' : s)
      .replace(/\|/g, '\\|')
      .replace(/\r?\n+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function buildMarkdown(spec) {
    spec = spec || {};
    const title    = spec.title    || 'Export';
    const subtitle = spec.subtitle || '';
    const columns  = spec.columns  || [];
    const rows     = spec.rows     || [];

    const lines = [];
    lines.push('# ' + mdEscape(title));
    if (subtitle) lines.push('', '_' + mdEscape(subtitle) + '_');
    lines.push('');

    if (columns.length) {
      lines.push('| ' + columns.map(mdEscape).join(' | ') + ' |');
      lines.push('|' + columns.map(() => '---').join('|') + '|');
    }

    rows.forEach(r => {
      const cells = (r || []).map((c, i) => {
        const text = mdEscape(cellText(c));
        const href = cellHref(c);
        if (href) {
          const label = text || 'link';
          return '[' + label + '](' + href.replace(/\)/g, '%29') + ')';
        }
        return text || '—';
      });
      lines.push('| ' + cells.join(' | ') + ' |');
    });

    lines.push('');
    return lines.join('\n');
  }

  // ── Print / PDF ───────────────────────────────────────────────────────────
  // Wraps the OutlookExport HTML in a print-optimized shell and triggers the
  // browser's print dialog. Users pick "Save as PDF" (or a real printer).
  function buildPrintPage(spec) {
    if (!window.OutlookExport) {
      throw new Error('OutlookExport helper is required for PDF export.');
    }
    // Full Outlook-friendly document, then augment with print CSS.
    const doc = window.OutlookExport.buildHtml(spec);
    const printCss = ''
      + '<style>\n'
      + '  @page { size: A4 landscape; margin: 12mm; }\n'
      + '  @media print {\n'
      + '    body { padding: 0 !important; }\n'
      + '    table { page-break-inside: auto; }\n'
      + '    tr    { page-break-inside: avoid; page-break-after: auto; }\n'
      + '    thead { display: table-header-group; }\n'
      + '    tfoot { display: table-footer-group; }\n'
      + '    a { color: #0067b8 !important; text-decoration: underline; }\n'
      + '  }\n'
      + '  @media screen {\n'
      + '    body::before {\n'
      + '      content: "Use your browser\'s print dialog to save as PDF (Ctrl+P / Cmd+P).";\n'
      + '      display: block; padding: 8px 12px; margin: 0 0 16px;\n'
      + '      background: #fff3cd; color: #664d03; border: 1px solid #ffecb5;\n'
      + '      border-radius: 6px; font: 13px/1.4 "Segoe UI",Calibri,Arial,sans-serif;\n'
      + '    }\n'
      + '  }\n'
      + '</style>\n';
    return doc.replace('</head>', printCss + '</head>');
  }

  function printPdf(spec) {
    const html = buildPrintPage(spec);
    // Note: do NOT use 'noopener' or 'noreferrer' here — they cause
    // window.open() to return null, which we need to write content and
    // trigger print(). This is safe: we open about:blank (no URL leak).
    const w = window.open('', '_blank', 'width=1024,height=768');
    if (!w) {
      alert('Pop-up blocked. Allow pop-ups for this site to use PDF export, then try again.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    // Sever the opener reference after writing for defense-in-depth.
    try { w.opener = null; } catch (_) { /* sandboxed */ }
    // Wait for layout, then invoke print. Some browsers need a small delay.
    const trigger = () => { try { w.focus(); w.print(); } catch (e) { /* user closed */ } };
    if (w.document.readyState === 'complete') setTimeout(trigger, 200);
    else w.addEventListener('load', () => setTimeout(trigger, 200));
    return html;
  }

  // ── Word-compatible HTML (.doc) ───────────────────────────────────────────
  // Uses Office XML namespaces so Word treats the file as a Word document
  // instead of a plain web page. Preserves the OutlookExport table structure.
  function buildDocx(spec) {
    if (!window.OutlookExport) {
      throw new Error('OutlookExport helper is required for Word export.');
    }
    const body = window.OutlookExport.buildHtml(spec);
    // Strip the outer <!doctype html>...<html>...<head> shell — Word wants a
    // very specific opener. Extract everything inside <body>...</body>.
    const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(body);
    const bodyInner = bodyMatch ? bodyMatch[1] : body;
    const title = (spec && spec.title) || 'Export';
    const titleEscaped = title
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    return ''
      + '<html xmlns:o="urn:schemas-microsoft-com:office:office" '
      + 'xmlns:w="urn:schemas-microsoft-com:office:word" '
      + 'xmlns="http://www.w3.org/TR/REC-html40">\n'
      + '<head>\n'
      + '  <meta charset="UTF-8">\n'
      + '  <meta name="ProgId" content="Word.Document">\n'
      + '  <meta name="Generator" content="Microsoft Word 15">\n'
      + '  <meta name="Originator" content="Microsoft Word 15">\n'
      + '  <title>' + titleEscaped + '</title>\n'
      + '  <!--[if gte mso 9]>\n'
      + '  <xml>\n'
      + '    <w:WordDocument>\n'
      + '      <w:View>Print</w:View>\n'
      + '      <w:Zoom>100</w:Zoom>\n'
      + '      <w:DoNotOptimizeForBrowser/>\n'
      + '    </w:WordDocument>\n'
      + '  </xml>\n'
      + '  <![endif]-->\n'
      + '  <style>\n'
      + '    @page WordSection1 { size: 11.0in 8.5in; margin: 0.5in 0.5in 0.5in 0.5in; mso-page-orientation: landscape; }\n'
      + '    div.WordSection1 { page: WordSection1; }\n'
      + '    body { font-family: "Segoe UI", Calibri, Arial, sans-serif; font-size: 11pt; }\n'
      + '    table { border-collapse: collapse; }\n'
      + '  </style>\n'
      + '</head>\n'
      + '<body>\n'
      + '  <div class="WordSection1">\n'
      +      bodyInner + '\n'
      + '  </div>\n'
      + '</body>\n'
      + '</html>\n';
  }

  // ── Blob download ─────────────────────────────────────────────────────────
  function downloadBlob(text, mime, filename) {
    const blob = new Blob([text], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ── Public API ────────────────────────────────────────────────────────────
  function download(spec) {
    spec = spec || {};
    const format = String(spec.format || 'html').toLowerCase();
    const base   = spec.baseFilename
      || (spec.filename ? spec.filename.replace(/\.[^./]+$/, '') : 'export-' + new Date().toISOString().slice(0, 10));

    if (format === 'pdf') {
      return printPdf(spec);
    }

    let text, mime, ext;
    if (format === 'md' || format === 'markdown') {
      text = buildMarkdown(spec);
      mime = MIME.md;
      ext  = EXT.md;
    } else if (format === 'docx' || format === 'doc') {
      text = buildDocx(spec);
      mime = MIME.docx;
      ext  = EXT.docx;
    } else {
      // Default: html
      if (!window.OutlookExport) {
        alert('Export helper still loading. Please try again in a moment.');
        return;
      }
      text = window.OutlookExport.buildHtml(spec);
      mime = MIME.html;
      ext  = EXT.html;
    }

    downloadBlob(text, mime, base + '.' + ext);
    return text;
  }

  window.ExportFormats = {
    download,
    buildMarkdown,
    buildPrintPage,
    buildDocx,
    printPdf,
  };
})();
