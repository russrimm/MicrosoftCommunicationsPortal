/**
 * Weekly Customer Briefing — data model helpers (browser).
 *
 * Pure functions that turn raw Message Center posts and normalized Release
 * Planner features into the prioritized structure rendered by
 * static/briefing-email.js. No DOM access, so scripts/test-briefing.js can
 * exercise it in a Node `vm` context.
 */
(function (root) {
  'use strict';

  var DAY_MS = 24 * 60 * 60 * 1000;

  // Product areas shared by Message Center and Release Planner content, in
  // reader priority order. `color` is used for the area pill in the email.
  var AREAS = [
    { key: 'copilotstudio', label: 'Copilot Studio', color: '#6d28d9', defaultOn: true },
    { key: 'governance', label: 'Governance & admin', color: '#0f6cbd', defaultOn: true },
    { key: 'dataverse', label: 'Dataverse', color: '#0e7a6a', defaultOn: true },
    { key: 'powerautomate', label: 'Power Automate', color: '#0b5cad', defaultOn: true },
    { key: 'powerapps', label: 'Power Apps', color: '#742774', defaultOn: true },
    { key: 'powerpages', label: 'Power Pages', color: '#9a3412', defaultOn: true },
    { key: 'prodev', label: 'Pro development', color: '#374151', defaultOn: true },
    { key: 'other', label: 'Other Copilot & business apps', color: '#4b5563', defaultOn: true },
    { key: 'powerbi', label: 'Power BI', color: '#8a6100', defaultOn: false }
  ];
  var AREA_BY_KEY = {};
  AREAS.forEach(function (a, i) { a.order = i; AREA_BY_KEY[a.key] = a; });

  var MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
    'august', 'september', 'october', 'november', 'december'];
  var MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DATE_PHRASE = '((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.? \\d{1,2}, \\d{4})';

  var IN_SCOPE_SERVICE_RE = /power platform|power automate|power apps|dataverse|copilot \(power platform\)|copilot studio|power pages|power bi/i;
  var IN_SCOPE_TITLE_RE = /copilot studio|power platform|power automate|power apps|power pages|dataverse/i;
  var ROUTINE_RE = /\bversion \d+(?:\.\d+){2,}\b.*\brelease\b|\bplanned maintenance\b/i;
  var RETIRE_RE = /\bretir(?:e|es|ed|ing|ement)\b|\bdeprecat|\bend of support\b|\bno longer (?:be )?(?:available|supported)\b/i;
  var NO_ACTION_RE = /no action is required|for awareness/i;
  var TITLE_PREFIX_RE = /^(?:(?:Microsoft )?Copilot Studio|Power Platform governance and administration|Power Platform admin center|(?:Microsoft )?Power Platform|(?:Microsoft )?Power Automate|(?:Microsoft )?Power Apps|Power Pages|(?:Microsoft )?Dataverse)\s*[-–—:]\s*/i;
  var SECTION_HEADINGS = [
    { key: 'affect', re: /^(?:how does this affect me\??|\[?how this will affect your organization:?\]?|\[?what and why:?\]?)$/i },
    { key: 'action', re: /^(?:what (?:action )?do i need to (?:do to prepare|take)\??|\[?what you need to do to prepare:?\]?|what do i need to do\??)$/i },
    { key: 'timing', re: /^(?:\[?when this will happen:?\]?|\[?rollout schedule:?\]?|timing)$/i }
  ];

  // ── Dates ────────────────────────────────────────────────────────────────
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function isoDate(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function parseIso(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function addDays(iso, days) {
    var d = parseIso(iso);
    if (!d) return '';
    d.setDate(d.getDate() + days);
    return isoDate(d);
  }

  function mondayOf(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var dow = d.getDay();
    d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
    return isoDate(d);
  }

  // The briefing goes out on Monday: prepping on a weekend targets the
  // coming Monday, otherwise the current week's Monday.
  function defaultBriefingDate(now) {
    var d = now || new Date();
    var dow = d.getDay();
    if (dow === 6 || dow === 0) {
      var next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (dow === 6 ? 2 : 1));
      return isoDate(next);
    }
    return mondayOf(d);
  }

  function parseDatePhrase(text) {
    var m = /^([A-Za-z]+)\.? (\d{1,2}), (\d{4})$/.exec(String(text || '').trim());
    if (!m) return '';
    var key = m[1].toLowerCase();
    var month = -1;
    for (var i = 0; i < MONTHS.length; i++) {
      if (MONTHS[i] === key || MONTHS[i].slice(0, 3) === key.slice(0, 3)) { month = i; break; }
    }
    var day = Number(m[2]);
    if (month < 0 || day < 1 || day > 31) return '';
    return m[3] + '-' + pad(month + 1) + '-' + pad(day);
  }

  function formatDate(iso, style) {
    var d = parseIso(iso);
    if (!d) return '';
    if (style === 'month') return MONTH_SHORT[d.getMonth()] + ' ' + d.getFullYear();
    if (style === 'short') return MONTH_SHORT[d.getMonth()] + ' ' + d.getDate();
    if (style === 'long') {
      return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }
    return MONTH_SHORT[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  // Release Planner window: whole calendar months starting with the
  // briefing's month. Returns inclusive start / exclusive end ISO dates.
  function monthWindow(briefingIso, months) {
    var d = parseIso(briefingIso) || new Date();
    var start = new Date(d.getFullYear(), d.getMonth(), 1);
    var end = new Date(d.getFullYear(), d.getMonth() + Math.max(1, months || 2), 1);
    return { start: isoDate(start), end: isoDate(end) };
  }

  function monthRangeLabel(win) {
    var s = parseIso(win.start);
    var e = parseIso(addDays(win.end, -1));
    if (!s || !e) return '';
    var sl = MONTH_SHORT[s.getMonth()];
    var el = MONTH_SHORT[e.getMonth()];
    if (s.getFullYear() !== e.getFullYear()) return sl + ' ' + s.getFullYear() + ' – ' + el + ' ' + e.getFullYear();
    if (sl === el) return sl + ' ' + s.getFullYear();
    return sl + ' – ' + el + ' ' + e.getFullYear();
  }

  // ── Text helpers ────────────────────────────────────────────────────────
  function decodeEntities(s) {
    return String(s)
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); })
      .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }

  // Convert Graph's HTML body to text blocks, keeping block boundaries so
  // section headings ("How does this affect me?") can be detected. Bold text
  // only becomes its own block when it is one of those headings; inline bold
  // (dates, product names) stays part of its sentence.
  function isSectionHeading(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    return SECTION_HEADINGS.some(function (h) { return h.re.test(t); });
  }

  function htmlToBlocks(html) {
    var text = String(html || '')
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<(?:br|\/p|\/div|\/li|\/h\d|\/tr|\/ul|\/ol)\b[^>]*>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n• ')
      .replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, function (_, _tag, inner) {
        var plainInner = decodeEntities(inner.replace(/<[^>]+>/g, ' '));
        return isSectionHeading(plainInner) ? '\n' + plainInner + '\n' : inner;
      })
      .replace(/<[^>]+>/g, ' ');
    return decodeEntities(text)
      .split('\n')
      .map(function (s) { return s.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])(?=\s|$)/g, '$1').trim(); })
      .filter(Boolean);
  }

  function splitSections(blocks) {
    var sections = { intro: [] };
    var current = 'intro';
    blocks.forEach(function (block) {
      for (var i = 0; i < SECTION_HEADINGS.length; i++) {
        if (SECTION_HEADINGS[i].re.test(block)) {
          current = SECTION_HEADINGS[i].key;
          if (!sections[current]) sections[current] = [];
          return;
        }
      }
      if (!sections[current]) sections[current] = [];
      sections[current].push(block);
    });
    return sections;
  }

  // Split on sentence-ending punctuation followed by whitespace and a likely
  // sentence start, so "GPT-5.5" or "v9.8.9" never split mid-token.
  function splitSentences(text) {
    var out = [];
    var re = /[.!?]+["”’)]?(?=\s+(?:[A-Z0-9"“‘(•]|$))|[.!?]+["”’)]?$/g;
    var last = 0;
    var m;
    while ((m = re.exec(text)) !== null) {
      out.push(text.slice(last, m.index + m[0].length).trim());
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last).trim());
    return out.filter(Boolean);
  }

  function sentences(text, count, maxLen) {
    var clean = String(text || '').replace(/\s+/g, ' ').replace(/\s+([,.;:!?])(?=\s|$)/g, '$1').trim();
    if (!clean) return '';
    var parts = splitSentences(clean);
    var out = parts.slice(0, count || 1).join(' ');
    var limit = maxLen || 260;
    if (out.length > limit) out = out.slice(0, limit - 1).replace(/\s+\S*$/, '') + '…';
    return out;
  }

  function firstLearnLink(html) {
    var re = /href\s*=\s*["'](https:\/\/(?:learn|aka)\.(?:microsoft\.com|ms)\/[^"'\s<>]+)["']/gi;
    var m = re.exec(String(html || ''));
    return m ? decodeEntities(m[1]) : '';
  }

  function serviceNames(msg) {
    return (msg.services || []).map(function (s) {
      if (typeof s === 'string') return s;
      return (s && (s.displayName || s.serviceName || s.name)) || '';
    }).filter(Boolean);
  }

  // ── Message Center ──────────────────────────────────────────────────────
  function isInScopeMessage(msg) {
    var services = serviceNames(msg).join(' | ');
    return IN_SCOPE_SERVICE_RE.test(services) || IN_SCOPE_TITLE_RE.test(msg.title || '');
  }

  function areaForMessage(msg) {
    var title = String(msg.title || '');
    var services = serviceNames(msg).join(' | ');
    if (/copilot studio/i.test(title)) return 'copilotstudio';
    if (/power pages/i.test(title)) return 'powerpages';
    if (/power bi/i.test(title)) return 'powerbi';
    if (/sales in microsoft 365 copilot|dynamics 365|work iq|copilot cowork/i.test(title)) return 'other';
    if (/governance|admin center|managed environment|environment group/i.test(title)) return 'governance';
    if (/power automate|process (?:mining|intelligence)|desktop flow|cloud flow/i.test(title)) return 'powerautomate';
    if (/power apps|canvas app|model-driven/i.test(title)) return 'powerapps';
    if (/dataverse|prompt column/i.test(title)) return 'dataverse';
    if (/copilot \(power platform\)/i.test(services)) return 'copilotstudio';
    if (/power bi/i.test(services)) return 'powerbi';
    if (/power automate/i.test(services)) return 'powerautomate';
    if (/power apps/i.test(services)) return 'powerapps';
    if (/dataverse/i.test(services)) return 'dataverse';
    if (/power platform/i.test(services)) return 'governance';
    return 'other';
  }

  function extractKeyDates(text, msg, isRetirement) {
    var found = [];
    function add(label, iso) {
      if (!iso) return;
      for (var i = 0; i < found.length; i++) {
        if (found[i].date === iso) return;
      }
      found.push({ label: label, date: iso });
    }
    if (msg.actionRequiredByDateTime) {
      add('Act by', String(msg.actionRequiredByDateTime).slice(0, 10));
    }
    var patterns = [
      { label: 'GA', re: new RegExp('reach(?:ed|es)? general availability(?: \\(GA\\))? on ' + DATE_PHRASE, 'i') },
      { label: 'GA', re: new RegExp('generally available (?:on|starting|beginning) ' + DATE_PHRASE, 'i') },
      { label: 'Preview', re: new RegExp('reach(?:ed|es)? (?:public )?preview on ' + DATE_PHRASE, 'i') },
      { label: 'Rollout', re: new RegExp('(?:complete|finish)(?:d|s)? (?:the )?(?:rollout|deployment) by (?:the week of )?' + DATE_PHRASE, 'i') },
      { label: 'Rollout', re: new RegExp('(?:rollout|roll out|rolling out)[^.]{0,60}?(?:begin|begins|beginning|start|starts|starting|on)\\s+(?:on |in )?(?:the week of )?' + DATE_PHRASE, 'i') },
      { label: isRetirement ? 'Retires' : 'Starts', re: new RegExp('(?:starting|beginning|effective) (?:on )?' + DATE_PHRASE, 'i') },
      { label: 'Retires', re: new RegExp('(?:retire[sd]?|end of support|no longer (?:be )?(?:available|supported))[^.]{0,60}?(?:on|by|after) ' + DATE_PHRASE, 'i') }
    ];
    patterns.forEach(function (p) {
      var m = p.re.exec(text);
      if (m) add(p.label, parseDatePhrase(m[1]));
    });
    found.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return found.slice(0, 3);
  }

  // Same destination the rest of the portal uses for Message Center posts
  // (see mspulse360MessageUrl in runtime-utils.js). Customers reading the
  // email usually can't open admin center links.
  function messageLink(id) {
    return /^MC\d+$/i.test(String(id || ''))
      ? 'https://www.mspulse360.app/message/' + encodeURIComponent(String(id).toUpperCase())
      : '';
  }

  function parseMessage(msg) {
    var title = String(msg.title || '').trim();
    var updated = /^\[updated[^\]]*\]\s*/i.test(title);
    var cleanTitle = title.replace(/^\[[^\]]+\]\s*/, '').replace(TITLE_PREFIX_RE, '').trim() || title;
    var html = (msg.body && msg.body.content) || '';
    var blocks = htmlToBlocks(html);
    var sections = splitSections(blocks);
    var fullText = blocks.join(' ');
    var tags = (msg.tags || []).map(function (t) { return String(t); });
    var tagText = tags.join(' ').toLowerCase();

    var summarySource = (sections.affect && sections.affect.join(' ')) || sections.intro.join(' ') || fullText;
    var summary = sentences(summarySource, 2, 280);
    var actionRaw = sections.action ? sections.action.join(' ') : '';
    var actionText = actionRaw && !NO_ACTION_RE.test(actionRaw) ? sentences(actionRaw, 3, 320) : '';
    var isRetirement = tagText.indexOf('retirement') !== -1 || RETIRE_RE.test(title);
    var hasDeadline = !!msg.actionRequiredByDateTime;

    var actionReason = '';
    if (hasDeadline) actionReason = 'deadline';
    else if (actionText) actionReason = 'prepare';
    else if (isRetirement) actionReason = 'retirement';

    return {
      key: 'mc:' + msg.id,
      kind: 'mc',
      id: String(msg.id || ''),
      title: title,
      cleanTitle: cleanTitle,
      updated: updated || tagText.indexOf('updated message') !== -1,
      area: areaForMessage(msg),
      services: serviceNames(msg),
      tags: tags,
      summary: summary,
      actionText: actionText,
      isAction: !!actionReason,
      actionReason: actionReason,
      isRetirement: isRetirement,
      isMajor: !!msg.isMajorChange,
      isRoutine: ROUTINE_RE.test(title),
      keyDates: extractKeyDates(fullText, msg, isRetirement),
      published: String(msg.startDateTime || '').slice(0, 10),
      modified: String(msg.lastModifiedDateTime || '').slice(0, 10),
      link: messageLink(msg.id),
      learnUrl: firstLearnLink(html)
    };
  }

  // Posts first published in [start, end), plus posts re-issued as
  // "Updated message" in the window.
  function messageInWindow(parsed, startIso, endIso) {
    if (parsed.published >= startIso && parsed.published < endIso) return true;
    return parsed.updated && parsed.modified >= startIso && parsed.modified < endIso;
  }

  // ── Release Planner ─────────────────────────────────────────────────────
  function inRange(iso, win) {
    return !!iso && iso >= win.start && iso < win.end;
  }

  function featurePhase(f, win, briefingIso) {
    var year = (parseIso(briefingIso) || new Date()).getFullYear();
    function month(iso) {
      var d = parseIso(iso);
      if (!d) return '';
      return MONTH_SHORT[d.getMonth()] + (d.getFullYear() !== year ? ' ' + d.getFullYear() : '');
    }
    var parts = [];
    if (f.previewDate && f.gaDate && f.previewDate.slice(0, 7) === f.gaDate.slice(0, 7)) {
      parts.push({ phase: 'Preview & GA', when: month(f.gaDate) });
    } else {
      if (f.previewDate && f.previewDate >= win.start) {
        parts.push({ phase: 'Preview', when: month(f.previewDate) });
      }
      if (f.gaDate) parts.push({ phase: 'GA', when: month(f.gaDate) });
    }
    return {
      inWindow: inRange(f.previewDate, win) || inRange(f.gaDate, win),
      isGa: inRange(f.gaDate, win),
      label: parts.map(function (p) { return p.phase + ' ' + p.when; }).join(' · '),
      sortKey: [f.gaDate, f.previewDate].filter(function (d) { return inRange(d, win); }).sort()[0] || '9999'
    };
  }

  function describeChange(change, briefingIso) {
    var year = (parseIso(briefingIso) || new Date()).getFullYear();
    function month(iso) {
      if (!iso) return 'TBD';
      var d = parseIso(iso);
      return MONTH_SHORT[d.getMonth()] + (d.getFullYear() !== year ? ' ' + d.getFullYear() : '');
    }
    var phase = change.field === 'gaDate' ? 'GA' : 'Preview';
    return phase + ' ' + month(change.from) + ' → ' + month(change.to);
  }

  // ── Prioritization ──────────────────────────────────────────────────────
  function compareMessages(a, b) {
    if (a.isAction !== b.isAction) return a.isAction ? -1 : 1;
    if (a.isMajor !== b.isMajor) return a.isMajor ? -1 : 1;
    return a.published < b.published ? 1 : a.published > b.published ? -1 : 0;
  }

  function soonestDate(item) {
    var dates = (item.keyDates || []).map(function (d) { return d.date; }).sort();
    return dates[0] || '9999-12-31';
  }

  function groupByArea(items) {
    var groups = {};
    items.forEach(function (item) {
      (groups[item.area] = groups[item.area] || []).push(item);
    });
    return AREAS
      .filter(function (a) { return groups[a.key] && groups[a.key].length; })
      .map(function (a) { return { area: a, items: groups[a.key] }; });
  }

  function keyDateEntries(items, startIso, endIso) {
    var entries = [];
    items.forEach(function (item) {
      (item.keyDates || []).forEach(function (d) {
        if (d.date >= startIso && d.date < endIso) entries.push({ date: d.date, label: d.label, item: item });
      });
    });
    entries.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return entries;
  }

  // Deterministic draft used when no AI provider is configured (or the
  // author prefers not to use it). Mirrors the AI output shape.
  function fallbackDraft(model) {
    var actions = model.actionItems || [];
    var mc = model.messages || [];
    var rpCount = model.featureCount || 0;
    var areas = [];
    mc.concat(model.features || []).forEach(function (item) {
      var label = AREA_BY_KEY[item.area] ? AREA_BY_KEY[item.area].label : '';
      if (label && areas.indexOf(label) === -1 && areas.length < 3) areas.push(label);
    });
    var parts = [];
    parts.push('This week brings ' + mc.length + ' new Message Center announcement' + (mc.length === 1 ? '' : 's') +
      (areas.length ? ', led by updates to ' + joinList(areas) : '') + '.');
    if (actions.length) {
      parts.push(actions.length + ' item' + (actions.length === 1 ? ' needs' : 's need') +
        ' your attention, starting with “' + actions[0].cleanTitle + '.”');
    }
    if (rpCount) {
      parts.push(rpCount + ' release plan feature' + (rpCount === 1 ? ' is' : 's are') +
        ' scheduled to reach preview or general availability in ' + (model.windowLabel || 'the coming weeks') + '.');
    }
    var ranked = actions.concat(mc.filter(function (m) { return actions.indexOf(m) === -1; }));
    var highlights = ranked.slice(0, 5).map(function (item) {
      var date = (item.keyDates || [])[0];
      return {
        itemId: item.key,
        text: item.cleanTitle + (date ? ' (' + date.label + ' ' + formatDate(date.date, 'short') + ')' : '')
      };
    });
    return { intro: parts.join(' '), highlights: highlights };
  }

  function joinList(list) {
    if (list.length <= 1) return list.join('');
    if (list.length === 2) return list[0] + ' and ' + list[1];
    return list.slice(0, -1).join(', ') + ', and ' + list[list.length - 1];
  }

  root.BriefingModel = {
    AREAS: AREAS,
    AREA_BY_KEY: AREA_BY_KEY,
    DAY_MS: DAY_MS,
    addDays: addDays,
    areaForMessage: areaForMessage,
    compareMessages: compareMessages,
    defaultBriefingDate: defaultBriefingDate,
    describeChange: describeChange,
    extractKeyDates: extractKeyDates,
    fallbackDraft: fallbackDraft,
    featurePhase: featurePhase,
    formatDate: formatDate,
    groupByArea: groupByArea,
    htmlToBlocks: htmlToBlocks,
    isInScopeMessage: isInScopeMessage,
    isoDate: isoDate,
    keyDateEntries: keyDateEntries,
    messageInWindow: messageInWindow,
    mondayOf: mondayOf,
    monthRangeLabel: monthRangeLabel,
    monthWindow: monthWindow,
    parseDatePhrase: parseDatePhrase,
    parseMessage: parseMessage,
    soonestDate: soonestDate
  };
})(typeof window !== 'undefined' ? window : globalThis);
