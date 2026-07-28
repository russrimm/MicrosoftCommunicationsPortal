// Subscription Picker — lets users select one or more Azure subscriptions
// as the default scope for Azure-related queries.
// Usage: include this script on any page, then call SubscriptionPicker.open()
// or place a button with id="subscription-picker-btn".

window.SubscriptionPicker = (() => {
  'use strict';

  let _modal = null;
  let _subscriptions = [];
  let _selected = [];
  let _loading = false;

  // ── Fetch subscriptions from server ─────────────────────────────────────
  async function fetchSubscriptions() {
    const res = await fetch('/api/subscriptions');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function fetchSelected() {
    const res = await fetch('/api/subscriptions/selected');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function saveSelected(selected) {
    const res = await fetch('/api/subscriptions/selected', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selected }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // ── Build modal DOM ─────────────────────────────────────────────────────
  function createModal() {
    if (_modal) return _modal;

    const overlay = document.createElement('div');
    overlay.className = 'sp-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Azure Subscription Picker');

    overlay.innerHTML = `
      <div class="sp-dialog">
        <div class="sp-header">
          <h2 class="sp-title">
            <svg viewBox="0 0 16 16" fill="none" width="18" height="18" style="vertical-align: middle; margin-right: 6px;">
              <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7 4.5h2v1H7v-1Zm0 2.5h2v5H7V7Z" fill="currentColor"/>
            </svg>
            Azure Subscriptions
          </h2>
          <button class="sp-close" aria-label="Close" type="button">&times;</button>
        </div>
        <p class="sp-desc">Select one or more subscriptions to scope Azure queries (Resource Health, MCP, etc.).</p>
        <div class="sp-search-row">
          <input class="sp-search" type="search" placeholder="Filter subscriptions..." aria-label="Filter subscriptions" />
        </div>
        <div class="sp-list-container">
          <div class="sp-loading">Loading subscriptions...</div>
          <ul class="sp-list" role="listbox" aria-multiselectable="true"></ul>
          <div class="sp-empty" style="display:none;">No subscriptions found.</div>
          <div class="sp-error" style="display:none;"></div>
        </div>
        <div class="sp-footer">
          <span class="sp-count">0 selected</span>
          <div class="sp-actions">
            <button class="sp-btn sp-btn-secondary sp-select-all" type="button">Select All</button>
            <button class="sp-btn sp-btn-secondary sp-clear-all" type="button">Clear</button>
            <button class="sp-btn sp-btn-primary sp-save" type="button">Save</button>
          </div>
        </div>
      </div>
    `;

    // Inject styles
    if (!document.getElementById('sp-styles')) {
      const style = document.createElement('style');
      style.id = 'sp-styles';
      style.textContent = getStyles();
      document.head.appendChild(style);
    }

    // Wire events
    overlay.querySelector('.sp-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.sp-search').addEventListener('input', onSearch);
    overlay.querySelector('.sp-save').addEventListener('click', onSave);
    overlay.querySelector('.sp-select-all').addEventListener('click', onSelectAll);
    overlay.querySelector('.sp-clear-all').addEventListener('click', onClearAll);

    // Escape key
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });

    document.body.appendChild(overlay);
    _modal = overlay;
    return overlay;
  }

  // ── Render subscription list ────────────────────────────────────────────
  function renderList(filter) {
    const list = _modal.querySelector('.sp-list');
    const empty = _modal.querySelector('.sp-empty');
    const loading = _modal.querySelector('.sp-loading');
    const errorEl = _modal.querySelector('.sp-error');

    if (_loading) {
      loading.style.display = '';
      list.style.display = 'none';
      empty.style.display = 'none';
      errorEl.style.display = 'none';
      return;
    }
    loading.style.display = 'none';
    errorEl.style.display = 'none';

    const filterLower = (filter || '').toLowerCase();
    const filtered = filterLower
      ? _subscriptions.filter(s =>
          s.displayName.toLowerCase().includes(filterLower) ||
          s.id.toLowerCase().includes(filterLower))
      : _subscriptions;

    if (filtered.length === 0) {
      list.style.display = 'none';
      empty.style.display = '';
      return;
    }

    list.style.display = '';
    empty.style.display = 'none';

    const selectedIds = new Set(_selected.map(s => s.id));
    list.innerHTML = filtered.map(s => `
      <li class="sp-item ${selectedIds.has(s.id) ? 'sp-selected' : ''}" 
          data-id="${escHtml(s.id)}" role="option" aria-selected="${selectedIds.has(s.id)}" tabindex="0">
        <label class="sp-item-label">
          <input type="checkbox" class="sp-checkbox" ${selectedIds.has(s.id) ? 'checked' : ''} />
          <div class="sp-item-info">
            <span class="sp-item-name">${escHtml(s.displayName || 'Unnamed')}</span>
            <span class="sp-item-id">${escHtml(s.id)}</span>
          </div>
          <span class="sp-item-state sp-state-${(s.state || '').toLowerCase()}">${escHtml(s.state || '')}</span>
        </label>
      </li>
    `).join('');

    // Wire checkbox clicks
    list.querySelectorAll('.sp-item').forEach(li => {
      li.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return; // let checkbox handle itself
        const cb = li.querySelector('.sp-checkbox');
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      });
      li.querySelector('.sp-checkbox').addEventListener('change', (e) => {
        const id = li.dataset.id;
        if (e.target.checked) {
          if (!_selected.find(s => s.id === id)) {
            const sub = _subscriptions.find(s => s.id === id);
            _selected.push({ id, displayName: sub ? sub.displayName : '' });
          }
          li.classList.add('sp-selected');
          li.setAttribute('aria-selected', 'true');
        } else {
          _selected = _selected.filter(s => s.id !== id);
          li.classList.remove('sp-selected');
          li.setAttribute('aria-selected', 'false');
        }
        updateCount();
      });
    });

    updateCount();
  }

  function updateCount() {
    const countEl = _modal.querySelector('.sp-count');
    const n = _selected.length;
    countEl.textContent = `${n} selected`;
  }

  // ── Event handlers ──────────────────────────────────────────────────────
  function onSearch(e) {
    renderList(e.target.value);
  }

  async function onSave() {
    const saveBtn = _modal.querySelector('.sp-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
      await saveSelected(_selected);
      // Persist to localStorage for client-side quick access
      localStorage.setItem('azure-selected-subscriptions', JSON.stringify(_selected));
      close();
      // Dispatch custom event so other page scripts can react
      window.dispatchEvent(new CustomEvent('subscriptions-changed', { detail: { selected: _selected } }));
    } catch (err) {
      const errorEl = _modal.querySelector('.sp-error');
      errorEl.textContent = `Save failed: ${err.message}`;
      errorEl.style.display = '';
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  }

  function onSelectAll() {
    _selected = _subscriptions.map(s => ({ id: s.id, displayName: s.displayName }));
    renderList(_modal.querySelector('.sp-search').value);
  }

  function onClearAll() {
    _selected = [];
    renderList(_modal.querySelector('.sp-search').value);
  }

  // ── Open / Close ────────────────────────────────────────────────────────
  async function open() {
    const modal = createModal();
    modal.style.display = 'flex';
    modal.querySelector('.sp-search').value = '';
    _loading = true;
    renderList('');

    try {
      const data = await fetchSubscriptions();
      _subscriptions = data.value || [];
      _selected = data.selected || [];
      _loading = false;
      renderList('');
      // Focus the search input
      modal.querySelector('.sp-search').focus();
    } catch (err) {
      _loading = false;
      const loading = modal.querySelector('.sp-loading');
      const errorEl = modal.querySelector('.sp-error');
      loading.style.display = 'none';
      errorEl.textContent = `Failed to load subscriptions: ${err.message}`;
      errorEl.style.display = '';
    }
  }

  function close() {
    if (_modal) _modal.style.display = 'none';
  }

  // ── Get current selection (for other scripts) ───────────────────────────
  function getSelected() {
    const cached = localStorage.getItem('azure-selected-subscriptions');
    if (cached) {
      try { return JSON.parse(cached); } catch (e) { /* ignore */ }
    }
    return _selected;
  }

  function getSelectedIds() {
    return getSelected().map(s => s.id);
  }

  // ── Utility ─────────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Styles ──────────────────────────────────────────────────────────────
  function getStyles() {
    return `
      .sp-overlay {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 10000;
        background: rgba(0,0,0,0.45);
        align-items: center;
        justify-content: center;
        padding: 1rem;
        animation: sp-fade-in 0.15s ease;
      }
      @keyframes sp-fade-in { from { opacity: 0; } to { opacity: 1; } }
      .sp-dialog {
        background: var(--cp-surface, #fff);
        border: 1px solid var(--cp-border, #ddd);
        border-radius: 12px;
        width: 100%;
        max-width: 560px;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 8px 32px rgba(0,0,0,0.18);
        animation: sp-slide-up 0.2s ease;
      }
      @keyframes sp-slide-up { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      .sp-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1.25rem 1.5rem 0.75rem;
      }
      .sp-title {
        font-size: 17px;
        font-weight: 700;
        color: var(--cp-text, #242424);
        display: flex;
        align-items: center;
        margin: 0;
      }
      .sp-close {
        background: none;
        border: none;
        font-size: 22px;
        color: var(--cp-text-muted, #666);
        cursor: pointer;
        padding: 0.25rem 0.5rem;
        border-radius: 6px;
        transition: background 0.15s;
      }
      .sp-close:hover { background: var(--cp-surface-soft, #f5f5f5); }
      .sp-desc {
        font-size: 13px;
        color: var(--cp-text-muted, #666);
        padding: 0 1.5rem 0.75rem;
        margin: 0;
      }
      .sp-search-row {
        padding: 0 1.5rem 0.75rem;
      }
      .sp-search {
        width: 100%;
        padding: 0.5rem 0.75rem;
        border: 1px solid var(--cp-border, #ddd);
        border-radius: 8px;
        font-size: 13px;
        background: var(--cp-surface-soft, #f9f9f9);
        color: var(--cp-text, #242424);
        outline: none;
        transition: border-color 0.15s;
      }
      .sp-search:focus { border-color: var(--cp-accent, #b11f4b); }
      .sp-list-container {
        flex: 1;
        overflow-y: auto;
        padding: 0 1rem;
        min-height: 120px;
        max-height: 400px;
      }
      .sp-loading, .sp-empty, .sp-error {
        padding: 2rem 1rem;
        text-align: center;
        font-size: 13px;
        color: var(--cp-text-muted, #666);
      }
      .sp-error { color: var(--cp-danger, #dc2626); }
      .sp-list {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .sp-item {
        border-radius: 8px;
        margin-bottom: 4px;
        transition: background 0.1s;
        cursor: pointer;
      }
      .sp-item:hover { background: var(--cp-surface-soft, #f5f5f5); }
      .sp-item.sp-selected {
        background: rgba(22,163,74,0.08);
        border: 1px solid var(--cp-success, #16a34a);
      }
      .sp-item:not(.sp-selected) { border: 1px solid transparent; }
      .sp-item-label {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.625rem 0.75rem;
        cursor: pointer;
      }
      .sp-checkbox {
        width: 16px; height: 16px;
        accent-color: var(--cp-success, #16a34a);
        cursor: pointer;
        flex-shrink: 0;
      }
      .sp-item-info {
        flex: 1;
        min-width: 0;
      }
      .sp-item-name {
        display: block;
        font-size: 13px;
        font-weight: 600;
        color: var(--cp-text, #242424);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sp-item-id {
        display: block;
        font-size: 11px;
        color: var(--cp-text-muted, #888);
        font-family: monospace;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sp-item-state {
        font-size: 10px;
        font-weight: 600;
        padding: 2px 6px;
        border-radius: 4px;
        text-transform: uppercase;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .sp-state-enabled { background: rgba(22,163,74,0.12); color: #16a34a; }
      .sp-state-disabled { background: rgba(220,38,38,0.12); color: #dc2626; }
      .sp-state-warned { background: rgba(245,158,11,0.12); color: #d97706; }
      .sp-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.75rem 1.5rem 1.25rem;
        border-top: 1px solid var(--cp-border, #ddd);
        margin-top: 0.5rem;
      }
      .sp-count {
        font-size: 12px;
        font-weight: 600;
        color: var(--cp-text-muted, #666);
      }
      .sp-actions { display: flex; gap: 0.5rem; }
      .sp-btn {
        padding: 0.4rem 0.875rem;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        border: 1px solid var(--cp-border, #ddd);
        font-family: inherit;
        transition: all 0.15s;
      }
      .sp-btn-secondary {
        background: var(--cp-surface-soft, #f5f5f5);
        color: var(--cp-text-muted, #666);
      }
      .sp-btn-secondary:hover { background: var(--cp-surface, #fff); color: var(--cp-text, #242424); }
      .sp-btn-primary {
        background: var(--cp-accent, #b11f4b);
        color: var(--cp-accent-fg, #fff);
        border-color: var(--cp-accent, #b11f4b);
      }
      .sp-btn-primary:hover { background: var(--cp-accent-hover, #9a1a41); }
      .sp-btn:disabled { opacity: 0.5; cursor: not-allowed; }

      /* Subscription badge in nav bar */
      .sp-header-btn {
        position: absolute;
        right: 1.25rem;
        top: 50%;
        transform: translateY(-50%);
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        background: transparent;
        border: 1px solid var(--cp-border, #ddd);
        border-radius: 0.625rem;
        padding: 0.35rem 0.75rem;
        cursor: pointer;
        font-size: 12px;
        color: var(--cp-text-muted, #666);
        font-family: inherit;
        transition: all 0.15s;
        white-space: nowrap;
      }
      .sp-header-btn:hover {
        background: var(--cp-accent-soft, rgba(177,31,75,0.08));
        color: var(--cp-accent, #b11f4b);
        border-color: var(--cp-accent, #b11f4b);
      }
      .sp-header-btn svg { width: 14px; height: 14px; }
      .sp-badge {
        background: var(--cp-accent, #b11f4b);
        color: var(--cp-accent-fg, #fff);
        font-size: 9px;
        font-weight: 700;
        padding: 0 4px;
        border-radius: 8px;
        min-width: 14px;
        height: 14px;
        line-height: 14px;
        text-align: center;
        position: absolute;
        top: -2px;
        right: -4px;
      }
    `;
  }

  // ── Auto-init: add subscription button to the nav bar ────────────────
  function autoInit() {
    const nav = document.querySelector('.page-tabs');
    if (!nav) return;

    // Inject styles early so the button renders correctly
    if (!document.getElementById('sp-styles')) {
      const style = document.createElement('style');
      style.id = 'sp-styles';
      style.textContent = getStyles();
      document.head.appendChild(style);
    }

    // Check if button already exists
    if (nav.querySelector('.sp-header-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'sp-header-btn';
    btn.id = 'subscription-picker-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Azure subscription scope');
    btn.innerHTML = `
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2 3h12v2H2V3Zm0 4h12v2H2V7Zm0 4h8v2H2v-2Z" fill="currentColor" opacity="0.7"/>
      </svg>
      <span class="sp-header-label">Subscriptions</span>
      <span class="sp-badge sp-badge-count" style="display:none;">0</span>
    `;
    btn.addEventListener('click', open);

    nav.appendChild(btn);

    // Update badge with saved selection count
    updateBadge();
  }

  function updateBadge() {
    const badge = document.querySelector('.sp-badge-count');
    if (!badge) return;
    const selected = getSelected();
    if (selected.length > 0) {
      badge.textContent = selected.length;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }

  // Listen for selection changes to update badge
  window.addEventListener('subscriptions-changed', updateBadge);

  // ── Seed client from server if localStorage is empty ────────────────────
  async function seedFromServer() {
    const cached = localStorage.getItem('azure-selected-subscriptions');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return; // already seeded
      } catch (e) { /* fall through */ }
    }
    try {
      // First try the server-side selection
      const data = await fetchSelected();
      let selected = data.selected || [];
      // If server has no selection, fetch all subscriptions and auto-select the first
      if (selected.length === 0) {
        try {
          const allData = await fetchSubscriptions();
          const allSubs = allData.value || [];
          if (allSubs.length > 0) {
            selected = [{ id: allSubs[0].id, displayName: allSubs[0].displayName }];
            // Persist the auto-selection to the server
            await saveSelected(selected);
          }
        } catch (e) { /* ignore — subscriptions endpoint may fail without auth */ }
      }
      if (selected.length > 0) {
        _selected = selected;
        localStorage.setItem('azure-selected-subscriptions', JSON.stringify(selected));
        updateBadge();
        window.dispatchEvent(new CustomEvent('subscriptions-changed', { detail: { selected } }));
      }
    } catch (e) { /* silent — server may not be configured */ }
  }

  // Auto-init on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { autoInit(); seedFromServer(); });
  } else {
    autoInit();
    seedFromServer();
  }

  // ── Public API ──────────────────────────────────────────────────────────
  return { open, close, getSelected, getSelectedIds };
})();
