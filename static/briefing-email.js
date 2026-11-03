/**
 * Weekly Customer Briefing — Outlook-safe email renderer.
 *
 * Builds the email body from a prepared view model (see weeklybriefing.html).
 * Outlook's compose surface strips <style> blocks, classes, and CSS
 * variables, and drops font size and color from <div>/<span> (and often from
 * everything but table cells), so:
 *   - every element carries inline styles and layout uses tables,
 *   - each block of text is its own table row, so styles sit on a cell,
 *   - a cell holds at most one nested table (Outlook adds a blank line
 *     between sibling tables),
 *   - the header and buttons are light with dark text, so they stay readable
 *     even when text color is dropped.
 * Images are avoided: product SVGs don't render in Outlook and relative URLs
 * break once pasted.
 */
(function (root) {
  'use strict';

  var FONT = "'Segoe UI',Aptos,Calibri,Arial,sans-serif";
  var C = {
    page: '#ffffff',
    text: '#1f2937',
    strong: '#111827',
    muted: '#4b5563',
    soft: '#6b7280',
    border: '#e5e7eb',
    link: '#0f6cbd',
    headerBg: '#dbe8f8',
    headerBar: '#0f3d7a',
    headerText: '#0b2a55',
    headerSub: '#2f4a73',
    accent: '#6d28d9',
    actionBg: '#fff7ed',
    actionBar: '#c2410c',
    actionText: '#9a3412',
    highlightBg: '#f0f6ff',
    highlightBar: '#0f6cbd',
    tableHead: '#f3f4f6',
    statBg: '#f8fafc'
  };
  var CHIP = {
    'Act by': { bg: '#fee2e2', fg: '#991b1b' },
    Retires: { bg: '#fee2e2', fg: '#991b1b' },
    GA: { bg: '#dcfce7', fg: '#166534' },
    'Preview & GA': { bg: '#dcfce7', fg: '#166534' },
    Preview: { bg: '#ede9fe', fg: '#5b21b6' },
    Rollout: { bg: '#e0f2fe', fg: '#075985' },
    Starts: { bg: '#e0f2fe', fg: '#075985' },
    Date: { bg: '#e0f2fe', fg: '#075985' },
    NEW: { bg: '#dcfce7', fg: '#166534' },
    MOVED: { bg: '#fef3c7', fg: '#92400e' },
    Updated: { bg: '#fef3c7', fg: '#92400e' },
    Major: { bg: '#fee2e2', fg: '#991b1b' },
    id: { bg: '#f3f4f6', fg: '#4b5563' }
  };
  var BASE = 'font-family:' + FONT + ';mso-line-height-rule:exactly;';
  var TABLE = 'role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"';

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Only absolute https, mailto, and tel links survive into the email.
  function url(value) {
    var v = String(value || '').trim();
    if (/[\u0000-\u001f\s]/.test(v)) return '';
    return /^(https:\/\/|mailto:|tel:)/i.test(v) ? v : '';
  }

  function link(href, label, extraStyle) {
    var safe = url(href);
    if (!safe) return esc(label);
    return '<a href="' + esc(safe) + '" target="_blank" rel="noopener noreferrer" style="color:' + C.link +
      ';text-decoration:underline;' + (extraStyle || '') + '">' + esc(label) + '</a>';
  }

  // ── Building blocks ─────────────────────────────────────────────────────
  function fontColor(css, inner) {
    var all = String(css).match(/(?:^|;)\s*color:\s*(#[0-9a-f]{3,6})/gi);
    if (!all) return inner;
    var hex = /#[0-9a-f]{3,6}/i.exec(all[all.length - 1])[0];
    return '<font color="' + hex + '">' + inner + '</font>';
  }

  // One row of text. Styles live on the cell, color is repeated in <font>.
  function trow(css, inner, attrs) {
    return '<tr><td' + (attrs || '') + ' style="' + BASE + css + '">' + fontColor(css, inner) + '</td></tr>';
  }

  // A row whose single cell holds one nested block (a table).
  function wrap(block, css) {
    return '<tr><td style="' + BASE + (css || 'padding:0;') + '">' + block + '</td></tr>';
  }

  function tbl(rows, extra) {
    return '<table ' + TABLE + ' style="border-collapse:collapse;' + (extra || '') + '">' + rows + '</table>';
  }

  function chip(label, kind, href) {
    var c = CHIP[kind || label] || CHIP.id;
    var text = esc(label);
    if (href && url(href)) {
      text = '<a href="' + esc(url(href)) + '" target="_blank" rel="noopener noreferrer" style="color:' + c.fg + ';text-decoration:none;">' + text + '</a>';
    }
    return '<td align="center" nowrap="nowrap" bgcolor="' + c.bg + '" style="' + BASE + 'background-color:' + c.bg +
      ';color:' + c.fg + ';font-size:11px;font-weight:600;line-height:16px;padding:1px 8px;white-space:nowrap;">' +
      fontColor('color:' + c.fg, text) + '</td>' +
      '<td width="4" style="width:4px;font-size:0;line-height:0;">&nbsp;</td>';
  }

  function chipRow(cells) {
    if (!cells) return '';
    return '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;"><tr>' + cells + '</tr></table>';
  }

  function dateChips(item) {
    return (item.keyDates || []).map(function (d) {
      return chip(d.label + ' ' + d.dateLabel, d.label);
    }).join('');
  }

  function p(html, style) {
    return trow('padding:0 0 10px;font-size:14px;line-height:22px;color:' + C.text + ';' + (style || ''), html);
  }

  function sectionHeading(icon, title, note) {
    var edge = 'border-bottom:2px solid ' + C.border + ';padding:24px 0 6px;';
    return wrap(tbl('<tr><td nowrap="nowrap" style="' + BASE + edge + 'font-size:17px;font-weight:700;color:' + C.strong + ';">' +
      fontColor('color:' + C.strong, icon + '&nbsp; ' + esc(title)) + '</td>' +
      '<td width="100%" style="' + BASE + edge + 'padding-left:10px;font-size:12px;color:' + C.soft + ';">' +
      (note ? fontColor('color:' + C.soft, esc(note)) : '&nbsp;') + '</td></tr>')) +
      '<tr><td height="8" style="height:8px;font-size:0;line-height:0;">&nbsp;</td></tr>';
  }

  function calloutBox(bg, bar, inner) {
    return tbl('<tr><td width="4" bgcolor="' + bar + '" style="background-color:' + bar + ';width:4px;font-size:0;line-height:0;">&nbsp;</td>' +
      '<td bgcolor="' + bg + '" style="background-color:' + bg + ';padding:12px 16px;font-family:' + FONT + ';">' + inner + '</td></tr>');
  }

  // ── Sections (each returns table rows for the single body table) ────────
  // The header is light with dark text on purpose: when a mail client drops
  // text color on paste, default dark text must still be readable on it.
  function renderHeader(m) {
    return tbl(
      '<tr><td height="6" bgcolor="' + C.headerBar + '" style="background-color:' + C.headerBar + ';height:6px;font-size:0;line-height:0;">&nbsp;</td></tr>' +
      '<tr><td bgcolor="' + C.headerBg + '" style="background-color:' + C.headerBg + ';padding:20px 24px 18px;font-family:' + FONT + ';">' +
      tbl(
        trow('font-size:12px;font-weight:600;color:' + C.headerSub + ';', esc(String(m.dateLabel).toUpperCase())) +
        trow('font-size:24px;font-weight:700;line-height:30px;color:' + C.headerText + ';padding-top:4px;', esc(m.headline)) +
        (m.coverageLabel ? trow('font-size:12px;color:' + C.headerSub + ';padding-top:6px;', esc(m.coverageLabel)) : '')
      ) + '</td></tr>' +
      '<tr><td height="4" bgcolor="' + C.accent + '" style="background-color:' + C.accent + ';height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>');
  }

  function renderIntro(m) {
    var rows = '';
    if (m.greeting) rows += p('<strong>' + esc(m.greeting) + '</strong>', 'padding-top:18px;');
    if (m.intro) {
      String(m.intro).split(/\n{2,}/).forEach(function (para) {
        if (para.trim()) rows += p(esc(para.trim()).replace(/\n/g, '<br>'));
      });
    }
    if (m.stats && m.stats.length) {
      var cells = [];
      m.stats.forEach(function (s, i) {
        if (i) cells.push('<td width="8" style="width:8px;font-size:0;">&nbsp;</td>');
        cells.push('<td align="center" valign="top" bgcolor="' + C.statBg + '" style="background-color:' + C.statBg +
          ';border:1px solid ' + C.border + ';padding:10px 6px;font-family:' + FONT + ';">' +
          tbl(
            trow('text-align:center;font-size:22px;font-weight:700;line-height:26px;color:' + (s.color || C.strong) + ';', esc(s.value), ' align="center"') +
            trow('text-align:center;font-size:11px;color:' + C.muted + ';padding-top:3px;', esc(s.label), ' align="center"')
          ) + '</td>');
      });
      rows += wrap('<table ' + TABLE + ' style="border-collapse:separate;"><tr>' + cells.join('') + '</tr></table>', 'padding:4px 0 0;');
    }
    return rows;
  }

  function renderActions(m) {
    if (!m.actions || !m.actions.length) return '';
    var rows = m.actions.map(function (item, i) {
      var reason = item.actionReason === 'deadline' ? 'Action required'
        : item.actionReason === 'retirement' ? 'Retirement'
          : item.actionReason === 'pinned' ? 'Recommended' : 'Prepare now';
      var label = reason + (item.carried ? ' · Reminder' : '') + (item.areaInfo ? ' · ' + item.areaInfo.label : '');
      return wrap(tbl(
        trow('font-size:11px;font-weight:700;color:' + C.actionText + ';', esc(label.toUpperCase())) +
        trow('font-size:15px;font-weight:700;line-height:20px;color:' + C.strong + ';padding:2px 0 4px;', link(item.href, item.cleanTitle || item.title, 'color:' + C.strong + ';')) +
        (item.keyDates && item.keyDates.length ? wrap(chipRow(dateChips(item)), 'padding:0 0 4px;') : '') +
        trow('font-size:13px;line-height:20px;color:' + C.text + ';',
          item.actionText ? '<strong>What to do:</strong> ' + esc(item.actionText) : esc(item.summary))
      ), 'padding:' + (i ? '10px' : '0') + ' 0 2px;' + (i ? 'border-top:1px solid #fed7aa;' : ''));
    }).join('');
    return sectionHeading('⚠️', 'Action required & upcoming retirements', m.actions.length + (m.actions.length === 1 ? ' item' : ' items')) +
      wrap(calloutBox(C.actionBg, C.actionBar, tbl(rows)));
  }

  function renderHighlights(m) {
    if (!m.highlights || !m.highlights.length) return '';
    var rows = m.highlights.map(function (h) {
      return '<tr><td valign="top" width="18" style="' + BASE + 'width:18px;padding:3px 0;font-size:14px;color:' + C.highlightBar + ';">' +
        fontColor('color:' + C.highlightBar, '★') + '</td>' +
        '<td valign="top" style="' + BASE + 'padding:3px 0;font-size:14px;line-height:21px;color:' + C.text + ';">' +
        fontColor('color:' + C.text, esc(h.text) + (url(h.href) ? ' ' + link(h.href, 'Details') : '')) + '</td></tr>';
    }).join('');
    return sectionHeading('✨', 'Top highlights') +
      wrap(calloutBox(C.highlightBg, C.highlightBar, tbl(rows)));
  }

  function renderKeyDates(m) {
    if (!m.keyDates || !m.keyDates.length) return '';
    var rows = m.keyDates.map(function (d, i) {
      var bg = i % 2 ? '#f9fafb' : '#ffffff';
      var td = 'background-color:' + bg + ';border-bottom:1px solid ' + C.border + ';' + BASE;
      return '<tr>' +
        '<td valign="top" nowrap="nowrap" bgcolor="' + bg + '" style="' + td + 'padding:7px 10px;font-size:13px;font-weight:700;color:' + C.strong + ';white-space:nowrap;">' +
        (d.past
          ? tbl(trow('font-size:13px;font-weight:700;color:' + C.strong + ';', esc(d.dateLabel)) +
            trow('font-size:11px;color:' + C.soft + ';', 'just passed'))
          : fontColor('color:' + C.strong, esc(d.dateLabel))) + '</td>' +
        '<td valign="top" nowrap="nowrap" bgcolor="' + bg + '" style="' + td + 'padding:7px 6px;">' + chipRow(chip(d.label)) + '</td>' +
        '<td valign="top" bgcolor="' + bg + '" style="' + td + 'padding:7px 10px;font-size:13px;line-height:19px;color:' + C.text + ';">' +
        (d.areaInfo
          ? tbl(trow('font-size:13px;line-height:19px;color:' + C.text + ';', link(d.href, d.title)) +
            trow('font-size:11px;color:' + C.soft + ';', esc(d.areaInfo.label)))
          : fontColor('color:' + C.text, link(d.href, d.title))) + '</td></tr>';
    }).join('');
    return sectionHeading('📅', 'Key dates', m.keyDatesNote || '') +
      wrap(tbl(rows, 'border-top:1px solid ' + C.border + ';'));
  }

  function renderMessageGroups(groups) {
    var html = '';
    groups.forEach(function (group) {
      html += trow('font-size:13px;font-weight:700;color:' + group.area.color + ';padding:12px 0 4px;', esc(group.area.label));
      var items = group.items.map(function (item) {
        var chips = '';
        if (item.isMajor) chips += chip('Major', 'Major');
        if (item.updated) chips += chip('Updated', 'Updated');
        chips += dateChips(item);
        chips += chip(item.id, 'id', item.href);
        if (url(item.learnUrl)) {
          chips += '<td nowrap="nowrap" style="' + BASE + 'font-size:12px;padding-left:4px;">' + link(item.learnUrl, 'Learn more', 'font-size:12px;') + '</td>';
        }
        return '<tr><td width="3" bgcolor="' + group.area.color + '" style="background-color:' + group.area.color + ';width:3px;font-size:0;line-height:0;">&nbsp;</td>' +
          '<td style="' + BASE + 'padding:7px 0 8px 12px;border-bottom:1px solid ' + C.border + ';">' +
          tbl(
            trow('font-size:14px;font-weight:600;line-height:20px;color:' + C.strong + ';', link(item.href, item.cleanTitle || item.title, 'color:' + C.strong + ';text-decoration:none;')) +
            (item.summary ? trow('font-size:13px;line-height:19px;color:' + C.muted + ';padding:1px 0 4px;', esc(item.summary)) : '') +
            wrap(chipRow(chips))
          ) + '</td></tr>';
      }).join('');
      html += wrap(tbl(items));
    });
    return html;
  }

  function renderMessages(m) {
    if (!m.messageGroups || !m.messageGroups.length) {
      if (m.messagesEmptyNote) {
        return sectionHeading('📬', 'New in Message Center') + p(esc(m.messagesEmptyNote), 'color:' + C.muted + ';');
      }
      return '';
    }
    var html = sectionHeading('📬', 'New in Message Center', m.messagesNote || '') + renderMessageGroups(m.messageGroups);
    if (m.messagesFootnote) html += p(esc(m.messagesFootnote), 'font-size:12px;color:' + C.soft + ';padding-top:8px;');
    return html;
  }

  function renderUpcoming(m) {
    if (!m.upcomingGroups || !m.upcomingGroups.length) return '';
    var html = sectionHeading('🔭', 'Impact in the coming weeks', m.upcomingNote || '') + renderMessageGroups(m.upcomingGroups);
    if (m.upcomingFootnote) html += p(esc(m.upcomingFootnote), 'font-size:12px;color:' + C.soft + ';padding-top:8px;');
    return html;
  }

  function changeList(icon, label, entries) {
    if (!entries || !entries.length) return '';
    return entries.map(function (e) {
      return '<tr><td valign="top" width="22" style="' + BASE + 'width:22px;padding:3px 0;font-size:13px;">' + icon + '</td>' +
        '<td valign="top" style="' + BASE + 'padding:3px 0;font-size:13px;line-height:19px;color:' + C.text + ';">' +
        fontColor('color:' + C.text, '<strong>' + esc(label) + ':</strong> ' + link(e.url, e.name) +
          (e.product ? ' <font color="' + C.soft + '">(' + esc(e.product) + ')</font>' : '') +
          (e.detail ? ' — ' + esc(e.detail) : '')) + '</td></tr>';
    }).join('');
  }

  function renderChanges(m) {
    var c = m.changes;
    if (!c) return '';
    var html = sectionHeading('🔄', 'What changed in the release plans', c.note || '');
    var rows = changeList('➕', 'New', c.added) + changeList('📅', 'Now scheduled', c.scheduled) +
      changeList('⏳', 'Slipped', c.slipped) + changeList('⏩', 'Pulled in', c.pulledIn) + changeList('✖️', 'Removed', c.removed);
    if (rows) {
      html += wrap(tbl(rows));
      if (c.overflowNote) html += p(esc(c.overflowNote), 'font-size:12px;color:' + C.soft + ';padding-top:6px;');
    } else {
      html += p(esc(c.emptyNote || 'No changes to the tracked release plans since last week.'), 'color:' + C.muted + ';');
    }
    return html;
  }

  function renderReleasePlan(m) {
    if (!m.featureGroups || !m.featureGroups.length) {
      if (m.featuresEmptyNote) {
        return sectionHeading('🗺️', 'Coming soon', m.featuresNote || '') + p(esc(m.featuresEmptyNote), 'color:' + C.muted + ';');
      }
      return '';
    }
    var th = function (label, width) {
      return '<th align="left" valign="top"' + (width ? ' width="' + width + '"' : '') + ' bgcolor="' + C.tableHead + '" style="' + BASE + 'background-color:' + C.tableHead +
        ';padding:6px 10px;border-bottom:1px solid ' + C.border + ';font-size:12px;font-weight:700;color:' + C.muted + ';text-align:left;">' + fontColor('color:' + C.muted, esc(label)) + '</th>';
    };
    var html = sectionHeading('🗺️', 'Coming soon', m.featuresNote || '');
    m.featureGroups.forEach(function (group) {
      html += trow('font-size:13px;font-weight:700;color:' + group.area.color + ';padding:12px 0 6px;', esc(group.area.label));
      var body = '<tr>' + th('Feature', '38%') + th('When', '17%') + th('Why it matters') + '</tr>';
      group.items.forEach(function (f, i) {
        var bg = i % 2 ? '#f9fafb' : '#ffffff';
        var td = function (inner, extra) {
          return '<td valign="top" bgcolor="' + bg + '" style="' + BASE + 'background-color:' + bg + ';padding:7px 10px;border-bottom:1px solid ' + C.border +
            ';font-size:13px;line-height:19px;color:' + C.text + ';' + (extra || '') + '">' + inner + '</td>';
        };
        var name = tbl(
          (f.badge ? wrap(chipRow(chip(f.badge)), 'padding:0 0 3px;') : '') +
          trow('font-size:13px;font-weight:600;line-height:19px;color:' + C.text + ';', link(f.url, f.name, 'font-weight:600;')) +
          (f.productArea ? trow('font-size:11px;color:' + C.soft + ';', esc(f.productArea)) : ''));
        body += '<tr>' + td(name) + td(fontColor('color:' + C.text, esc(f.phaseLabel)), 'white-space:nowrap;') +
          td(fontColor('color:' + C.text, esc(f.benefit || ''))) + '</tr>';
      });
      html += wrap(tbl(body, 'border:1px solid ' + C.border + ';'));
    });
    if (m.featuresFootnote) html += p(esc(m.featuresFootnote), 'font-size:12px;color:' + C.soft + ';padding-top:8px;');
    return html;
  }

  function renderResources(m) {
    var list = (m.resources || []).filter(function (r) { return r.label && url(r.url); });
    if (!list.length) return '';
    var rows = list.map(function (r) {
      return '<tr><td valign="top" width="18" style="' + BASE + 'width:18px;padding:3px 0;font-size:14px;color:' + C.link + ';">' + fontColor('color:' + C.link, '›') + '</td>' +
        '<td style="' + BASE + 'padding:3px 0;font-size:14px;line-height:20px;">' + link(r.url, r.label) +
        (r.note ? ' <font color="' + C.soft + '">— ' + esc(r.note) + '</font>' : '') + '</td></tr>';
    }).join('');
    return sectionHeading('📚', 'Resources') + wrap(tbl(rows));
  }

  // Buttons are light with dark text for the same reason as the header.
  function button(href, label, bg, edge) {
    var safe = url(href);
    if (!safe) return '';
    return '<td bgcolor="' + bg + '" style="' + BASE + 'background-color:' + bg + ';border:1px solid ' + edge + ';padding:8px 14px;">' +
      '<a href="' + esc(safe) + '" target="_blank" rel="noopener noreferrer" style="color:' + C.strong + ';text-decoration:none;font-size:13px;font-weight:600;">' +
      esc(label) + '</a></td>';
  }

  function renderSignature(m) {
    var s = m.signature || {};
    var rows = '';
    if (s.closing) rows += p(esc(s.closing), 'padding-top:20px;');
    if (!s.name && !s.title && !s.email) return rows;
    var lines = [];
    if (s.title) lines.push(esc(s.title));
    var contact = [];
    if (s.email) contact.push(link('mailto:' + s.email, s.email));
    if (s.phone) contact.push(link('tel:' + String(s.phone).replace(/[^\d+]/g, ''), s.phone));
    if (s.linkedin) contact.push(link(s.linkedin, 'LinkedIn'));
    if (contact.length) lines.push(contact.join(' &nbsp;·&nbsp; '));
    var buttons = [button(s.bookingUrl, '📅 Book time with me', '#dbe8f8', C.link), button(s.feedbackUrl, '💬 Share feedback', '#ede9fe', C.accent)]
      .filter(Boolean);
    var buttonRow = '';
    if (buttons.length) {
      buttonRow = wrap('<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;"><tr>' +
        buttons.join('<td width="8" style="width:8px;font-size:0;">&nbsp;</td>') + '</tr></table>', 'padding:10px 0 0;');
    }
    var card = (s.name ? trow('font-size:15px;font-weight:700;color:' + C.strong + ';padding-top:14px;border-top:1px solid ' + C.border + ';', esc(s.name)) : '') +
      lines.map(function (l) { return trow('font-size:13px;line-height:20px;color:' + C.muted + ';', l); }).join('') +
      buttonRow;
    return rows + wrap(tbl(card));
  }

  function renderFooter(m) {
    if (!m.footerNote) return '';
    return p(esc(m.footerNote), 'font-size:11px;color:' + C.soft + ';padding-top:16px;');
  }

  var SECTION_RENDERERS = {
    actions: renderActions,
    highlights: renderHighlights,
    keydates: renderKeyDates,
    messages: renderMessages,
    upcoming: renderUpcoming,
    changes: renderChanges,
    releaseplan: renderReleasePlan,
    resources: renderResources
  };

  function buildHtml(m) {
    var rows = renderIntro(m);
    (m.sectionOrder || []).forEach(function (key) {
      if (SECTION_RENDERERS[key]) rows += SECTION_RENDERERS[key](m);
    });
    rows += renderSignature(m) + renderFooter(m);
    return '<table ' + TABLE + ' bgcolor="' + C.page + '" style="border-collapse:collapse;background-color:' + C.page + ';">' +
      '<tr><td align="center" style="padding:0;">' +
      '<table ' + TABLE + ' style="border-collapse:collapse;width:100%;background-color:' + C.page + ';">' +
      '<tr><td style="padding:0;">' + renderHeader(m) + '</td></tr>' +
      '<tr><td style="padding:0 24px 24px;font-family:' + FONT + ';color:' + C.text + ';">' + tbl(rows) + '</td></tr>' +
      '</table></td></tr></table>';
  }

  // ── Plain-text alternative (clipboard text/plain) ───────────────────────
  function buildText(m) {
    var out = [];
    var rule = function (title) { out.push('', title.toUpperCase(), new Array(title.length + 1).join('-')); };
    out.push(m.headline + ' — ' + m.dateLabel);
    if (m.coverageLabel) out.push(m.coverageLabel);
    out.push('');
    if (m.greeting) out.push(m.greeting, '');
    if (m.intro) out.push(m.intro);
    if (m.stats && m.stats.length) {
      out.push('', m.stats.map(function (s) { return s.value + ' ' + s.label; }).join(' | '));
    }
    var dates = function (item) {
      return (item.keyDates || []).map(function (d) { return d.label + ' ' + d.dateLabel; }).join('; ');
    };
    (m.sectionOrder || []).forEach(function (key) {
      if (key === 'actions' && m.actions && m.actions.length) {
        rule('Action required & upcoming retirements');
        m.actions.forEach(function (a) {
          out.push('* ' + (a.cleanTitle || a.title) + (dates(a) ? ' [' + dates(a) + ']' : ''));
          out.push('  ' + (a.actionText ? 'What to do: ' + a.actionText : a.summary));
          if (a.href) out.push('  ' + a.href);
        });
      } else if (key === 'highlights' && m.highlights && m.highlights.length) {
        rule('Top highlights');
        m.highlights.forEach(function (h) { out.push('* ' + h.text + (h.href ? ' (' + h.href + ')' : '')); });
      } else if (key === 'keydates' && m.keyDates && m.keyDates.length) {
        rule('Key dates');
        m.keyDates.forEach(function (d) { out.push('* ' + d.dateLabel + ' — ' + d.label + ': ' + d.title); });
      } else if (key === 'messages' && m.messageGroups && m.messageGroups.length) {
        rule('New in Message Center');
        m.messageGroups.forEach(function (g) {
          out.push('', g.area.label);
          g.items.forEach(function (item) {
            out.push('* ' + (item.cleanTitle || item.title) + ' (' + item.id + ')' + (dates(item) ? ' [' + dates(item) + ']' : ''));
            if (item.summary) out.push('  ' + item.summary);
          });
        });
      } else if (key === 'upcoming' && m.upcomingGroups && m.upcomingGroups.length) {
        rule('Impact in the coming weeks' + (m.upcomingNote ? ' (' + m.upcomingNote + ')' : ''));
        m.upcomingGroups.forEach(function (g) {
          out.push('', g.area.label);
          g.items.forEach(function (item) {
            out.push('* ' + (item.cleanTitle || item.title) + ' (' + item.id + ')' + (dates(item) ? ' [' + dates(item) + ']' : ''));
            if (item.summary) out.push('  ' + item.summary);
          });
        });
      } else if (key === 'changes' && m.changes) {
        rule('What changed in the release plans');
        var any = false;
        [['New', m.changes.added], ['Now scheduled', m.changes.scheduled], ['Slipped', m.changes.slipped],
          ['Pulled in', m.changes.pulledIn], ['Removed', m.changes.removed]]
          .forEach(function (pair) {
            (pair[1] || []).forEach(function (e) {
              any = true;
              out.push('* ' + pair[0] + ': ' + e.name + (e.product ? ' (' + e.product + ')' : '') + (e.detail ? ' — ' + e.detail : ''));
            });
          });
        if (!any) out.push(m.changes.emptyNote || 'No changes since last week.');
      } else if (key === 'releaseplan' && m.featureGroups && m.featureGroups.length) {
        rule('Coming soon' + (m.featuresNote ? ' (' + m.featuresNote + ')' : ''));
        m.featureGroups.forEach(function (g) {
          out.push('', g.area.label);
          g.items.forEach(function (f) {
            out.push('* ' + f.name + ' — ' + f.phaseLabel + (f.benefit ? ': ' + f.benefit : ''));
          });
        });
      } else if (key === 'resources' && m.resources && m.resources.length) {
        rule('Resources');
        m.resources.forEach(function (r) { if (r.label && url(r.url)) out.push('* ' + r.label + ': ' + r.url); });
      }
    });
    var s = m.signature || {};
    out.push('');
    if (s.closing) out.push(s.closing, '');
    [s.name, s.title, s.email, s.phone, s.linkedin, s.bookingUrl ? 'Book time: ' + s.bookingUrl : '',
      s.feedbackUrl ? 'Feedback: ' + s.feedbackUrl : ''].forEach(function (l) { if (l) out.push(l); });
    if (m.footerNote) out.push('', m.footerNote);
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  root.BriefingEmail = { buildHtml: buildHtml, buildText: buildText, safeEmailUrl: url };
})(typeof window !== 'undefined' ? window : globalThis);
