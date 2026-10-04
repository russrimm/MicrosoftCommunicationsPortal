/**
 * Weekly Customer Briefing — Outlook-safe email renderer.
 *
 * Builds the email body from a prepared view model (see weeklybriefing.html).
 * Outlook's compose surface strips <style> blocks, classes, and CSS
 * variables, so every element carries inline styles, layout uses tables, and
 * the palette is a single high-contrast light theme (Outlook converts it for
 * dark mode itself). Images are avoided: product SVGs don't render in Outlook
 * and relative URLs break once pasted.
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
    headerBg: '#0f3d7a',
    headerText: '#ffffff',
    headerSub: '#d6e4f5',
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
    NEW: { bg: '#dcfce7', fg: '#166534' },
    MOVED: { bg: '#fef3c7', fg: '#92400e' },
    Updated: { bg: '#fef3c7', fg: '#92400e' },
    Major: { bg: '#fee2e2', fg: '#991b1b' },
    id: { bg: '#f3f4f6', fg: '#4b5563' }
  };

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

  function chip(label, kind) {
    var c = CHIP[kind || label] || CHIP.id;
    return '<span style="display:inline-block;background-color:' + c.bg + ';color:' + c.fg +
      ';font-size:11px;font-weight:600;line-height:16px;padding:1px 7px;margin:0 4px 2px 0;border-radius:9px;' +
      'font-family:' + FONT + ';white-space:nowrap;">' + esc(label) + '</span>';
  }

  function p(html, style) {
    return '<p style="margin:0 0 10px;font-size:14px;line-height:1.55;color:' + C.text + ';font-family:' + FONT +
      ';mso-line-height-rule:exactly;' + (style || '') + '">' + html + '</p>';
  }

  function sectionHeading(icon, title, note) {
    return '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin:26px 0 10px;">' +
      '<tr><td style="border-bottom:2px solid ' + C.border + ';padding:0 0 6px;font-family:' + FONT + ';">' +
      '<span style="font-size:17px;font-weight:700;color:' + C.strong + ';">' + icon + '&nbsp; ' + esc(title) + '</span>' +
      (note ? '<span style="font-size:12px;color:' + C.soft + ';">&nbsp;&nbsp;' + esc(note) + '</span>' : '') +
      '</td></tr></table>';
  }

  function calloutBox(bg, bar, inner) {
    return '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">' +
      '<tr><td width="4" bgcolor="' + bar + '" style="background-color:' + bar + ';width:4px;font-size:0;line-height:0;">&nbsp;</td>' +
      '<td bgcolor="' + bg + '" style="background-color:' + bg + ';padding:12px 16px;font-family:' + FONT + ';">' + inner +
      '</td></tr></table>';
  }

  function dateChips(item) {
    return (item.keyDates || []).map(function (d) {
      return chip(d.label + ' ' + d.dateLabel, d.label);
    }).join('');
  }

  // ── Sections ────────────────────────────────────────────────────────────
  function renderHeader(m) {
    return '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">' +
      '<tr><td bgcolor="' + C.headerBg + '" style="background-color:' + C.headerBg + ';padding:22px 24px 18px;font-family:' + FONT + ';">' +
      '<div style="font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:' + C.headerSub + ';">' +
      esc(m.dateLabel) + '</div>' +
      '<div style="font-size:24px;font-weight:700;line-height:1.25;color:' + C.headerText + ';margin-top:4px;">' + esc(m.headline) + '</div>' +
      (m.coverageLabel ? '<div style="font-size:12px;color:' + C.headerSub + ';margin-top:6px;">' + esc(m.coverageLabel) + '</div>' : '') +
      '</td></tr>' +
      '<tr><td height="4" bgcolor="' + C.accent + '" style="background-color:' + C.accent + ';height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>' +
      '</table>';
  }

  function renderIntro(m) {
    var html = '';
    if (m.greeting) html += p('<strong>' + esc(m.greeting) + '</strong>', 'margin-top:18px;');
    if (m.intro) {
      String(m.intro).split(/\n{2,}/).forEach(function (para) {
        if (para.trim()) html += p(esc(para.trim()).replace(/\n/g, '<br>'));
      });
    }
    if (m.stats && m.stats.length) {
      var cells = m.stats.map(function (s) {
        return '<td align="center" valign="top" bgcolor="' + C.statBg + '" style="background-color:' + C.statBg +
          ';border:1px solid ' + C.border + ';padding:10px 6px;font-family:' + FONT + ';">' +
          '<div style="font-size:22px;font-weight:700;color:' + (s.color || C.strong) + ';line-height:1.1;">' + esc(s.value) + '</div>' +
          '<div style="font-size:11px;color:' + C.muted + ';margin-top:3px;">' + esc(s.label) + '</div></td>';
      });
      var spaced = [];
      cells.forEach(function (c, i) {
        if (i) spaced.push('<td width="8" style="width:8px;font-size:0;">&nbsp;</td>');
        spaced.push(c);
      });
      html += '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;margin:6px 0 4px;">' +
        '<tr>' + spaced.join('') + '</tr></table>';
    }
    return html;
  }

  function renderActions(m) {
    if (!m.actions || !m.actions.length) return '';
    var rows = m.actions.map(function (item, i) {
      var reason = item.actionReason === 'deadline' ? 'Action required'
        : item.actionReason === 'retirement' ? 'Retirement'
          : item.actionReason === 'pinned' ? 'Recommended' : 'Prepare now';
      return '<tr><td style="padding:' + (i ? '12px' : '2px') + ' 0 2px;' + (i ? 'border-top:1px solid #fed7aa;' : '') + 'font-family:' + FONT + ';">' +
        '<div style="font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:' + C.actionText + ';">' +
        esc(reason) + (item.carried ? ' · Reminder' : '') + (item.areaInfo ? ' · ' + esc(item.areaInfo.label) : '') + '</div>' +
        '<div style="font-size:15px;font-weight:700;color:' + C.strong + ';margin:2px 0 4px;">' + link(item.href, item.cleanTitle || item.title, 'color:' + C.strong + ';') + '</div>' +
        (item.keyDates && item.keyDates.length ? '<div style="margin:0 0 4px;">' + dateChips(item) + '</div>' : '') +
        '<div style="font-size:13px;line-height:1.5;color:' + C.text + ';">' +
        (item.actionText ? '<strong>What to do:</strong> ' + esc(item.actionText) : esc(item.summary)) + '</div>' +
        '</td></tr>';
    }).join('');
    return sectionHeading('⚠️', 'Action required & upcoming retirements', m.actions.length + (m.actions.length === 1 ? ' item' : ' items')) +
      calloutBox(C.actionBg, C.actionBar,
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">' + rows + '</table>');
  }

  function renderHighlights(m) {
    if (!m.highlights || !m.highlights.length) return '';
    var rows = m.highlights.map(function (h) {
      return '<tr><td valign="top" width="18" style="width:18px;padding:3px 0;font-size:14px;color:' + C.highlightBar + ';font-family:' + FONT + ';">★</td>' +
        '<td valign="top" style="padding:3px 0;font-size:14px;line-height:1.5;color:' + C.text + ';font-family:' + FONT + ';">' +
        esc(h.text) + (url(h.href) ? ' ' + link(h.href, 'Details') : '') + '</td></tr>';
    }).join('');
    return sectionHeading('✨', 'Top highlights') +
      calloutBox(C.highlightBg, C.highlightBar,
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">' + rows + '</table>');
  }

  function renderKeyDates(m) {
    if (!m.keyDates || !m.keyDates.length) return '';
    var rows = m.keyDates.map(function (d, i) {
      var bg = i % 2 ? '#f9fafb' : '#ffffff';
      return '<tr>' +
        '<td valign="top" nowrap="nowrap" bgcolor="' + bg + '" style="background-color:' + bg + ';padding:7px 10px;border-bottom:1px solid ' + C.border +
        ';font-size:13px;font-weight:700;color:' + C.strong + ';white-space:nowrap;font-family:' + FONT + ';">' + esc(d.dateLabel) +
        (d.past ? '<div style="font-size:11px;font-weight:400;color:' + C.soft + ';">just passed</div>' : '') + '</td>' +
        '<td valign="top" nowrap="nowrap" bgcolor="' + bg + '" style="background-color:' + bg + ';padding:7px 6px;border-bottom:1px solid ' + C.border + ';font-family:' + FONT + ';">' + chip(d.label) + '</td>' +
        '<td valign="top" bgcolor="' + bg + '" style="background-color:' + bg + ';padding:7px 10px;border-bottom:1px solid ' + C.border +
        ';font-size:13px;line-height:1.45;color:' + C.text + ';font-family:' + FONT + ';">' + link(d.href, d.title) +
        (d.areaInfo ? '<div style="font-size:11px;color:' + C.soft + ';">' + esc(d.areaInfo.label) + '</div>' : '') + '</td></tr>';
    }).join('');
    return sectionHeading('📅', 'Key dates', m.keyDatesNote || '') +
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;border-top:1px solid ' + C.border + ';">' +
      rows + '</table>';
  }

  function renderMessages(m) {
    if (!m.messageGroups || !m.messageGroups.length) {
      if (m.messagesEmptyNote) {
        return sectionHeading('📬', 'New in Message Center') + p(esc(m.messagesEmptyNote), 'color:' + C.muted + ';');
      }
      return '';
    }
    var html = sectionHeading('📬', 'New in Message Center', m.messagesNote || '');
    m.messageGroups.forEach(function (group) {
      html += '<div style="font-size:13px;font-weight:700;color:' + group.area.color + ';margin:14px 0 4px;font-family:' + FONT + ';">' +
        esc(group.area.label) + '</div>';
      html += '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">';
      group.items.forEach(function (item) {
        var chips = '';
        if (item.isMajor) chips += chip('Major', 'Major');
        if (item.updated) chips += chip('Updated', 'Updated');
        chips += dateChips(item);
        chips += item.href ? '<a href="' + esc(url(item.href)) + '" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">' + chip(item.id, 'id') + '</a>' : chip(item.id, 'id');
        html += '<tr><td width="3" bgcolor="' + group.area.color + '" style="background-color:' + group.area.color + ';width:3px;font-size:0;line-height:0;">&nbsp;</td>' +
          '<td style="padding:8px 0 10px 12px;border-bottom:1px solid ' + C.border + ';font-family:' + FONT + ';">' +
          '<div style="font-size:14px;font-weight:600;line-height:1.4;color:' + C.strong + ';">' + link(item.href, item.cleanTitle || item.title, 'color:' + C.strong + ';text-decoration:none;') + '</div>' +
          (item.summary ? '<div style="font-size:13px;line-height:1.5;color:' + C.muted + ';margin:2px 0 5px;">' + esc(item.summary) + '</div>' : '') +
          '<div>' + chips + (url(item.learnUrl) ? '&nbsp;' + link(item.learnUrl, 'Learn more', 'font-size:12px;') : '') + '</div>' +
          '</td></tr>';
      });
      html += '</table>';
    });
    if (m.messagesFootnote) html += p(esc(m.messagesFootnote), 'font-size:12px;color:' + C.soft + ';margin-top:8px;');
    return html;
  }

  function changeList(icon, label, entries) {
    if (!entries || !entries.length) return '';
    var rows = entries.map(function (e) {
      return '<tr><td valign="top" width="22" style="width:22px;padding:3px 0;font-size:13px;font-family:' + FONT + ';">' + icon + '</td>' +
        '<td valign="top" style="padding:3px 0;font-size:13px;line-height:1.45;color:' + C.text + ';font-family:' + FONT + ';">' +
        '<strong>' + esc(label) + ':</strong> ' + link(e.url, e.name) +
        (e.product ? ' <span style="color:' + C.soft + ';">(' + esc(e.product) + ')</span>' : '') +
        (e.detail ? ' — ' + esc(e.detail) : '') + '</td></tr>';
    }).join('');
    return rows;
  }

  function renderChanges(m) {
    var c = m.changes;
    if (!c) return '';
    var html = sectionHeading('🔄', 'What changed in the release plans', c.note || '');
    var rows = changeList('➕', 'New', c.added) + changeList('📅', 'Now scheduled', c.scheduled) +
      changeList('⏳', 'Slipped', c.slipped) + changeList('⏩', 'Pulled in', c.pulledIn) + changeList('✖️', 'Removed', c.removed);
    if (rows) {
      html += '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">' + rows + '</table>';
      if (c.overflowNote) html += p(esc(c.overflowNote), 'font-size:12px;color:' + C.soft + ';margin-top:6px;');
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
      return '<th align="left" valign="top"' + (width ? ' width="' + width + '"' : '') + ' bgcolor="' + C.tableHead + '" style="background-color:' + C.tableHead +
        ';padding:6px 10px;border-bottom:1px solid ' + C.border + ';font-size:12px;font-weight:700;color:' + C.muted + ';text-align:left;font-family:' + FONT + ';">' + esc(label) + '</th>';
    };
    var html = sectionHeading('🗺️', 'Coming soon', m.featuresNote || '');
    m.featureGroups.forEach(function (group) {
      html += '<div style="font-size:13px;font-weight:700;color:' + group.area.color + ';margin:14px 0 6px;font-family:' + FONT + ';">' +
        esc(group.area.label) + '</div>';
      html += '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;border:1px solid ' + C.border + ';">' +
        '<tr>' + th('Feature', '38%') + th('When', '17%') + th('Why it matters') + '</tr>';
      group.items.forEach(function (f, i) {
        var bg = i % 2 ? '#f9fafb' : '#ffffff';
        var td = function (inner, extra) {
          return '<td valign="top" bgcolor="' + bg + '" style="background-color:' + bg + ';padding:7px 10px;border-bottom:1px solid ' + C.border +
            ';font-size:13px;line-height:1.45;color:' + C.text + ';font-family:' + FONT + ';' + (extra || '') + '">' + inner + '</td>';
        };
        html += '<tr>' +
          td((f.badge ? chip(f.badge) : '') + link(f.url, f.name, 'font-weight:600;') +
            (f.productArea ? '<div style="font-size:11px;color:' + C.soft + ';">' + esc(f.productArea) + '</div>' : '')) +
          td(esc(f.phaseLabel), 'white-space:nowrap;') +
          td(esc(f.benefit || '')) +
          '</tr>';
      });
      html += '</table>';
    });
    if (m.featuresFootnote) html += p(esc(m.featuresFootnote), 'font-size:12px;color:' + C.soft + ';margin-top:8px;');
    return html;
  }

  function renderResources(m) {
    var list = (m.resources || []).filter(function (r) { return r.label && url(r.url); });
    if (!list.length) return '';
    var rows = list.map(function (r) {
      return '<tr><td valign="top" width="18" style="width:18px;padding:3px 0;font-size:14px;color:' + C.link + ';font-family:' + FONT + ';">›</td>' +
        '<td style="padding:3px 0;font-size:14px;line-height:1.45;font-family:' + FONT + ';">' + link(r.url, r.label) +
        (r.note ? ' <span style="color:' + C.soft + ';font-size:12px;">— ' + esc(r.note) + '</span>' : '') + '</td></tr>';
    }).join('');
    return sectionHeading('📚', 'Resources') +
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">' + rows + '</table>';
  }

  function button(href, label, bg) {
    var safe = url(href);
    if (!safe) return '';
    return '<td bgcolor="' + bg + '" style="background-color:' + bg + ';border-radius:4px;padding:8px 14px;font-family:' + FONT + ';">' +
      '<a href="' + esc(safe) + '" target="_blank" rel="noopener noreferrer" style="color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;">' +
      esc(label) + '</a></td>';
  }

  function renderSignature(m) {
    var s = m.signature || {};
    var html = '';
    if (s.closing) html += p(esc(s.closing), 'margin-top:24px;');
    if (!s.name && !s.title && !s.email) return html;
    var lines = [];
    if (s.title) lines.push(esc(s.title));
    var contact = [];
    if (s.email) contact.push(link('mailto:' + s.email, s.email));
    if (s.phone) contact.push(link('tel:' + String(s.phone).replace(/[^\d+]/g, ''), s.phone));
    if (s.linkedin) contact.push(link(s.linkedin, 'LinkedIn'));
    if (contact.length) lines.push(contact.join(' &nbsp;·&nbsp; '));
    var buttons = [button(s.bookingUrl, '📅 Book time with me', C.link), button(s.feedbackUrl, '💬 Share feedback', C.accent)]
      .filter(Boolean);
    var buttonRow = '';
    if (buttons.length) {
      buttonRow = '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;margin-top:10px;"><tr>' +
        buttons.join('<td width="8" style="width:8px;font-size:0;">&nbsp;</td>') + '</tr></table>';
    }
    html += '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin-top:8px;">' +
      '<tr><td style="border-top:1px solid ' + C.border + ';padding:14px 0 0;font-family:' + FONT + ';">' +
      (s.name ? '<div style="font-size:15px;font-weight:700;color:' + C.strong + ';">' + esc(s.name) + '</div>' : '') +
      lines.map(function (l) { return '<div style="font-size:13px;line-height:1.5;color:' + C.muted + ';">' + l + '</div>'; }).join('') +
      buttonRow + '</td></tr></table>';
    return html;
  }

  function renderFooter(m) {
    if (!m.footerNote) return '';
    return p(esc(m.footerNote), 'font-size:11px;color:' + C.soft + ';margin-top:20px;');
  }

  var SECTION_RENDERERS = {
    actions: renderActions,
    highlights: renderHighlights,
    keydates: renderKeyDates,
    messages: renderMessages,
    changes: renderChanges,
    releaseplan: renderReleasePlan,
    resources: renderResources
  };

  function buildHtml(m) {
    var body = renderIntro(m);
    (m.sectionOrder || []).forEach(function (key) {
      if (SECTION_RENDERERS[key]) body += SECTION_RENDERERS[key](m);
    });
    body += renderSignature(m) + renderFooter(m);
    return '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="' + C.page +
      '" style="border-collapse:collapse;background-color:' + C.page + ';">' +
      '<tr><td align="center" style="padding:0;">' +
      '<table role="presentation" width="680" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:680px;max-width:680px;background-color:' + C.page + ';">' +
      '<tr><td style="padding:0;">' + renderHeader(m) + '</td></tr>' +
      '<tr><td style="padding:0 24px 24px;font-family:' + FONT + ';color:' + C.text + ';">' + body + '</td></tr>' +
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
