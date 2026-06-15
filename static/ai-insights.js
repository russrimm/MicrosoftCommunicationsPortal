/* Microsoft Communications Portal — shared AI helper
 * Loaded as <script src="/static/ai-insights.js" defer></script> from each feed page.
 * Each page exposes a CportalAi.init({...}) call that wires the UI to the page's data array.
 */
(function () {
  'use strict';

  const STATE = { enabled: null, provider: null, model: null, checked: false };

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    }
    if (children) for (const c of [].concat(children)) {
      if (c == null) continue;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function injectStyles() {
    if (document.getElementById('cp-ai-styles')) return;
    const css = `
      .cp-ai-panel { background: var(--cp-bg-elevated, #fcfbf8); border: 1px solid var(--cp-border, #dedede);
        border-radius: 8px; padding: 1rem 1.125rem; margin: 0 0 1rem; position: relative; }
      .cp-ai-panel[hidden] { display: none; }
      .cp-ai-header { display: flex; align-items: center; gap: 0.625rem; margin-bottom: 0.625rem; flex-wrap: wrap; }
      .cp-ai-title { font-size: 14px; font-weight: 700; color: var(--cp-text, #242424);
        display: inline-flex; align-items: center; gap: 0.4rem; }
      .cp-ai-badge { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
        background: var(--cp-accent-soft, rgba(177,31,75,0.08)); color: var(--cp-accent, #b11f4b);
        padding: 0.15rem 0.5rem; border-radius: 999px; }
      .cp-ai-meta { font-size: 11px; color: var(--cp-text-muted, #5c5c5c); margin-left: auto; }
      .cp-ai-actions { display: flex; gap: 0.5rem; align-items: center; }
      .cp-ai-btn { font-size: 12px; padding: 0.35rem 0.75rem; border-radius: 5px;
        border: 1px solid var(--cp-border, #dedede); background: var(--cp-surface, #fff);
        color: var(--cp-text, #242424); cursor: pointer; font-weight: 600; }
      .cp-ai-btn:hover:not(:disabled) { border-color: var(--cp-accent, #b11f4b); color: var(--cp-accent, #b11f4b); }
      .cp-ai-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .cp-ai-btn.primary { background: var(--cp-accent, #b11f4b); color: var(--cp-accent-fg, #fff); border-color: var(--cp-accent, #b11f4b); }
      .cp-ai-btn.primary:hover:not(:disabled) { background: var(--cp-accent-hover, #9a1a41); color: var(--cp-accent-fg, #fff); }
      .cp-ai-headline { font-size: 13px; color: var(--cp-text, #242424); margin: 0.25rem 0 0.625rem; line-height: 1.5; }
      .cp-ai-themes { display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0.25rem 0 0.625rem; }
      .cp-ai-theme { font-size: 11px; padding: 0.15rem 0.5rem; border-radius: 999px;
        background: var(--cp-surface-soft, #f5f5f5); color: var(--cp-text-muted, #5c5c5c); border: 1px solid var(--cp-border, #dedede); }
      .cp-ai-top { display: flex; flex-direction: column; gap: 0.5rem; }
      .cp-ai-top-item { display: flex; gap: 0.625rem; padding: 0.5rem 0.625rem; border-radius: 6px;
        background: var(--cp-surface, #fff); border: 1px solid var(--cp-border, #dedede); }
      .cp-ai-top-item:hover { border-color: var(--cp-accent, #b11f4b); cursor: pointer; }
      .cp-ai-rank { font-weight: 700; color: var(--cp-text-muted, #5c5c5c); width: 1.5rem; flex-shrink: 0; font-size: 13px; }
      .cp-ai-top-body { flex: 1; min-width: 0; }
      .cp-ai-top-title { font-size: 13px; font-weight: 600; color: var(--cp-text, #242424); margin-bottom: 0.2rem; }
      .cp-ai-top-summary { font-size: 12px; color: var(--cp-text-muted, #5c5c5c); line-height: 1.45; }
      .cp-ai-top-reason { font-size: 11px; color: var(--cp-text-soft, #6f6f6f); margin-top: 0.25rem; font-style: italic; }
      .cp-impact { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
        padding: 0.15rem 0.45rem; border-radius: 4px; flex-shrink: 0; align-self: flex-start; }
      .cp-impact.high   { background: rgba(220,38,38,0.12); color: var(--cp-danger, #dc2626); }
      .cp-impact.medium { background: rgba(245,158,11,0.14); color: var(--cp-warning, #f59e0b); }
      .cp-impact.low    { background: rgba(22,163,74,0.12); color: var(--cp-success, #16a34a); }
      .cp-ai-action-flag { display: inline-block; font-size: 10px; font-weight: 700; padding: 0.1rem 0.4rem;
        border-radius: 3px; background: rgba(245,158,11,0.18); color: var(--cp-warning, #f59e0b); margin-left: 0.4rem;
        text-transform: uppercase; letter-spacing: 0.04em; }
      .cp-ai-error { color: var(--cp-danger, #dc2626); font-size: 12px; margin-top: 0.5rem; }
      .cp-ai-spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid var(--cp-border, #dedede);
        border-top-color: var(--cp-accent, #b11f4b); border-radius: 50%; animation: cp-spin 0.8s linear infinite;
        vertical-align: middle; margin-right: 0.4rem; }
      @keyframes cp-spin { to { transform: rotate(360deg); } }
      .cp-ai-disabled-note { font-size: 11px; color: var(--cp-text-muted, #5c5c5c); margin-top: 0.4rem; line-height: 1.5; }
      .cp-ai-disabled-note code { font-size: 10px; background: var(--cp-surface-soft, #f5f5f5); padding: 0.1rem 0.3rem; border-radius: 3px; }
      .cp-item-summary { background: var(--cp-surface-soft, #f5f5f5); border-left: 3px solid var(--cp-accent, #b11f4b);
        padding: 0.625rem 0.75rem; margin-top: 0.5rem; border-radius: 0 4px 4px 0; font-size: 12px; line-height: 1.5; }
      .cp-item-summary-row { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; margin-top: 0.35rem; font-size: 11px; }
      .cp-item-summary-audience { color: var(--cp-text-muted, #5c5c5c); }
    `;
    document.head.appendChild(el('style', { id: 'cp-ai-styles', html: css }));
  }

  async function checkStatus() {
    if (STATE.checked) return STATE;
    try {
      const r = await fetch('/api/ai-status', { headers: { Accept: 'application/json' } });
      const j = await r.json();
      STATE.enabled = !!j.enabled;
      STATE.provider = j.provider;
      STATE.model = j.model;
    } catch (_e) {
      STATE.enabled = false;
    }
    STATE.checked = true;
    return STATE;
  }

  function renderDisabledPanel(panel, hostName) {
    panel.innerHTML = '';
    panel.appendChild(el('div', { class: 'cp-ai-header' }, [
      el('span', { class: 'cp-ai-title' }, ['✨ AI Insights']),
      el('span', { class: 'cp-ai-badge' }, ['Off']),
    ]));
    panel.appendChild(el('div', { class: 'cp-ai-disabled-note', html:
      'AI summarization is not configured. To enable, set one of these in <code>.env</code> and restart the server: ' +
      '<code>AZURE_OPENAI_ENDPOINT</code>+<code>AZURE_OPENAI_API_KEY</code>+<code>AZURE_OPENAI_DEPLOYMENT</code>, ' +
      'or <code>OPENAI_API_KEY</code>, or <code>GITHUB_TOKEN</code>. See <code>.env.example</code>.'
    }));
    panel.hidden = false;
  }

  function renderDigest(panel, source, status) {
    panel.innerHTML = '';
    const header = el('div', { class: 'cp-ai-header' }, [
      el('span', { class: 'cp-ai-title' }, ['✨ AI Insights']),
      el('span', { class: 'cp-ai-badge' }, ['Top impactful changes']),
      el('span', { class: 'cp-ai-meta' }, [`${status.provider || 'AI'} · ${status.model || ''}`]),
    ]);
    panel.appendChild(header);
    const body = el('div', { class: 'cp-ai-top' });
    panel.appendChild(body);
    body.appendChild(el('div', { class: 'cp-ai-headline' }, [
      el('span', { class: 'cp-ai-spinner', 'aria-hidden': 'true' }),
      'Analyzing the latest changes…',
    ]));
    const actions = el('div', { class: 'cp-ai-actions', style: 'margin-top:0.5rem' }, [
      el('button', { class: 'cp-ai-btn', type: 'button',
        onclick: () => loadDigest(panel, source, status, true) }, ['↻ Regenerate']),
    ]);
    panel.appendChild(actions);
    panel.hidden = false;
  }

  function impactBadge(impact) {
    const lvl = (impact || 'low').toLowerCase();
    const safe = ['high', 'medium', 'low'].includes(lvl) ? lvl : 'low';
    return `<span class="cp-impact ${safe}">${safe}</span>`;
  }

  async function loadDigest(panel, source, status, force) {
    const body = panel.querySelector('.cp-ai-top');
    if (!body) return;
    body.innerHTML = '<div class="cp-ai-headline"><span class="cp-ai-spinner" aria-hidden="true"></span>Analyzing the latest changes…</div>';
    try {
      const url = `/api/impact-digest?source=${encodeURIComponent(source)}&limit=5&windowDays=14${force ? '&_t=' + Date.now() : ''}`;
      const r = await fetch(url);
      if (!r.ok) {
        const errBody = await r.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP ${r.status}`);
      }
      const data = await r.json();
      body.innerHTML = '';
      if (data.headline) {
        body.insertAdjacentHTML('beforeend', `<div class="cp-ai-headline">${esc(data.headline)}</div>`);
      }
      if (Array.isArray(data.themes) && data.themes.length) {
        const themes = data.themes.map(t => `<span class="cp-ai-theme">${esc(t)}</span>`).join('');
        body.insertAdjacentHTML('beforeend', `<div class="cp-ai-themes">${themes}</div>`);
      }
      if (!Array.isArray(data.topItems) || !data.topItems.length) {
        body.insertAdjacentHTML('beforeend', '<div class="cp-ai-headline">No impactful items in the selected window.</div>');
        return;
      }
      data.topItems.forEach((it, i) => {
        const actionFlag = it.actionRequired ? '<span class="cp-ai-action-flag">Action</span>' : '';
        const reason = it.impactReason ? `<div class="cp-ai-top-reason">${esc(it.impactReason)}</div>` : '';
        const html = `
          <div class="cp-ai-top-item" data-item-id="${esc(it.id)}">
            <div class="cp-ai-rank">#${i + 1}</div>
            <div class="cp-ai-top-body">
              <div class="cp-ai-top-title">${esc(it.title || '')}${actionFlag}</div>
              <div class="cp-ai-top-summary">${esc(it.summary || '')}</div>
              ${reason}
            </div>
            ${impactBadge(it.impact)}
          </div>`;
        body.insertAdjacentHTML('beforeend', html);
      });
      // Allow caller to wire clicks → existing modal open.
      if (typeof window.__cpAiOnTopItemClick === 'function') {
        body.querySelectorAll('.cp-ai-top-item').forEach((node) => {
          node.addEventListener('click', () => window.__cpAiOnTopItemClick(node.dataset.itemId));
        });
      }
    } catch (e) {
      body.innerHTML = `<div class="cp-ai-error">⚠️ Could not generate digest: ${esc(e.message)}</div>`;
    }
  }

  // Public: summarize one item (called from the per-item Summarize button).
  // Returns the summary object: {summary, impact, impactReason, audience, actionRequired}.
  async function summarizeOne(source, item) {
    const r = await fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, items: [item] }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || `HTTP ${r.status}`);
    }
    const data = await r.json();
    return (data.summaries && data.summaries[0]) || null;
  }

  function renderSummaryBlock(s) {
    if (!s) return '';
    const actionFlag = s.actionRequired ? '<span class="cp-ai-action-flag">Action required</span>' : '';
    const audience = Array.isArray(s.audience) && s.audience.length
      ? `<span class="cp-item-summary-audience">Audience: ${s.audience.map(esc).join(', ')}</span>` : '';
    const reason = s.impactReason ? `<span class="cp-item-summary-audience">· ${esc(s.impactReason)}</span>` : '';
    return `
      <div class="cp-item-summary">
        <div><strong>✨ AI summary:</strong> ${esc(s.summary || '(empty)')}</div>
        <div class="cp-item-summary-row">${impactBadge(s.impact)}${actionFlag}${audience}${reason}</div>
      </div>`;
  }

  // Public: inject a "✨ Summarize with AI" button into a modal body. On click,
  // call /api/summarize for the single item and replace the button with the summary block.
  function attachToModal(modalBodyEl, source, item) {
    if (!modalBodyEl || !STATE.enabled || !item) return;
    if (modalBodyEl.querySelector('.cp-ai-modal-slot')) return;
    const slot = document.createElement('div');
    slot.className = 'cp-ai-modal-slot';
    slot.style.cssText = 'margin: 0 0 0.875rem; display:flex; gap:0.5rem; align-items:center;';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cp-ai-btn primary';
    btn.textContent = '✨ Summarize with AI';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.innerHTML = '<span class="cp-ai-spinner" aria-hidden="true"></span>Summarizing…';
      try {
        const s = await summarizeOne(source, item);
        slot.outerHTML = renderSummaryBlock(s);
      } catch (e) {
        slot.innerHTML = `<div class="cp-ai-error">⚠️ ${esc(e.message)}</div>`;
      }
    });
    slot.appendChild(btn);
    modalBodyEl.insertBefore(slot, modalBodyEl.firstChild);
  }

  // Public init — pages call CportalAi.init({source, panelMountSelector, ...})
  async function init(opts) {
    injectStyles();
    const status = await checkStatus();
    const panel = document.createElement('section');
    panel.className = 'cp-ai-panel';
    panel.id = 'cp-ai-panel';
    panel.hidden = true;
    panel.setAttribute('aria-label', 'AI insights');
    const mount = document.querySelector(opts.panelMountSelector);
    if (!mount) return;
    mount.parentNode.insertBefore(panel, mount);
    if (!status.enabled) {
      renderDisabledPanel(panel, opts.source);
      return;
    }
    renderDigest(panel, opts.source, status);
    loadDigest(panel, opts.source, status, false);
    if (typeof opts.onTopItemClick === 'function') {
      window.__cpAiOnTopItemClick = opts.onTopItemClick;
    }
  }

  window.CportalAi = {
    init,
    summarizeOne,
    renderSummaryBlock,
    impactBadge,
    attachToModal,
    isEnabled: () => STATE.enabled === true,
    status: () => Object.assign({}, STATE),
  };
})();
