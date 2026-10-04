// Feed toolkit shared by the roadmap and Message Center pages.
//
// Exposes window.FeedKit:
//   createLenses({ container, lenses, param, label, onChange })
//     Quick views ("lenses") answer "what matters to me?" before any filter.
//     lenses: [{ id, label, title?, test?(item) }]; the first lens is the
//     unfiltered default. Returns { apply(items) -> items, activeId() }.
//     apply() also refreshes the per-lens counts for the current result set.
//   createFilterToggle({ button, panel, activeCount })
//     Collapses the advanced filter row behind a "Filters" button with an
//     active-filter badge. Returns { refresh() }.
//   renderPaged(container, items, renderItem, { pageSize, emptyHtml })
//     Renders the first page of cards and appends more on scroll or on
//     "Show more", so a 1,900-item feed doesn't build 1,900 cards up front.
(function () {
  'use strict';

  var nf = new Intl.NumberFormat('en-US');
  function esc(v) {
    return window.CPUtil ? window.CPUtil.escapeHtml(v) : String(v == null ? '' : v);
  }
  function byId(target) {
    return typeof target === 'string' ? document.getElementById(target) : target;
  }

  function createLenses(opts) {
    var el = byId(opts.container);
    var lenses = opts.lenses || [];
    var param = opts.param || 'view';
    var initial = window.CPUtil ? window.CPUtil.queryValue(param) : '';
    var activeId = lenses.some(function (l) { return l.id === initial; }) ? initial : lenses[0].id;

    el.classList.add('fk-lenses');
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', opts.label || 'Quick views');
    el.innerHTML = lenses.map(function (l) {
      return '<button type="button" class="fk-lens" data-lens="' + esc(l.id) + '"' +
        ' aria-pressed="' + (l.id === activeId) + '"' +
        (l.title ? ' title="' + esc(l.title) + '"' : '') + '>' +
        '<span class="fk-lens-label">' + esc(l.label) + '</span>' +
        '<span class="fk-lens-count" aria-hidden="true"></span>' +
        '<span class="sr-only fk-lens-sr"></span>' +
        '</button>';
    }).join('');

    function syncPressed() {
      el.querySelectorAll('.fk-lens').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.dataset.lens === activeId));
      });
      if (window.CPUtil) {
        var state = {};
        state[param] = activeId === lenses[0].id ? null : activeId;
        window.CPUtil.replaceQueryState(state);
      }
    }

    el.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.fk-lens');
      if (!b || b.dataset.lens === activeId) return;
      activeId = b.dataset.lens;
      syncPressed();
      if (typeof opts.onChange === 'function') opts.onChange(activeId);
    });

    function apply(items) {
      var active = null;
      lenses.forEach(function (l) {
        var n = l.test ? items.filter(l.test).length : items.length;
        var btn = el.querySelector('.fk-lens[data-lens="' + l.id + '"]');
        if (btn) {
          btn.querySelector('.fk-lens-count').textContent = nf.format(n);
          btn.querySelector('.fk-lens-sr').textContent = ', ' + nf.format(n) + (n === 1 ? ' item' : ' items');
        }
        if (l.id === activeId) active = l;
      });
      return active && active.test ? items.filter(active.test) : items;
    }

    return {
      apply: apply,
      activeId: function () { return activeId; },
      isDefault: function () { return activeId === lenses[0].id; },
      reset: function () { activeId = lenses[0].id; syncPressed(); }
    };
  }

  function createFilterToggle(opts) {
    var button = byId(opts.button);
    var panel = byId(opts.panel);
    if (!button || !panel) return { refresh: function () {} };
    var badge = button.querySelector('.fk-filter-badge');
    button.setAttribute('aria-controls', panel.id);
    button.setAttribute('aria-expanded', 'false');
    panel.hidden = true;

    button.addEventListener('click', function () {
      var open = panel.hidden;
      panel.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
    });

    function refresh() {
      var n = typeof opts.activeCount === 'function' ? opts.activeCount() : 0;
      if (badge) {
        badge.textContent = n ? String(n) : '';
        badge.hidden = !n;
      }
      button.classList.toggle('has-active', !!n);
      button.setAttribute('aria-label', n ? 'Filters, ' + n + ' active' : 'Filters');
    }
    refresh();
    return { refresh: refresh };
  }

  function scrollRootFor(el) {
    var node = el;
    while (node && node !== document.body && node !== document.documentElement) {
      var oy = getComputedStyle(node).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) return node;
      node = node.parentElement;
    }
    return null;
  }

  function renderPaged(container, items, renderItem, opts) {
    opts = opts || {};
    var size = opts.pageSize || 60;
    if (container._fkObserver) {
      container._fkObserver.disconnect();
      container._fkObserver = null;
    }
    if (!items.length) {
      container.innerHTML = opts.emptyHtml || '';
      return;
    }
    var shown = 0;
    var first = items.slice(0, size);
    shown = first.length;
    container.innerHTML = first.map(renderItem).join('');
    if (shown >= items.length) return;

    var footer = document.createElement('div');
    footer.className = 'fk-more';
    footer.innerHTML =
      '<span class="fk-more-status" role="status" aria-live="polite"></span>' +
      '<button type="button" class="fk-more-btn"></button>';
    var status = footer.querySelector('.fk-more-status');
    var btn = footer.querySelector('.fk-more-btn');
    container.appendChild(footer);

    function updateFooter() {
      var remaining = items.length - shown;
      if (remaining <= 0) {
        if (container._fkObserver) container._fkObserver.disconnect();
        container._fkObserver = null;
        footer.remove();
        return;
      }
      status.textContent = 'Showing ' + nf.format(shown) + ' of ' + nf.format(items.length);
      btn.textContent = 'Show ' + nf.format(Math.min(size, remaining)) + ' more';
    }
    function more() {
      var next = items.slice(shown, shown + size);
      if (!next.length) return;
      footer.insertAdjacentHTML('beforebegin', next.map(renderItem).join(''));
      shown += next.length;
      updateFooter();
    }
    btn.addEventListener('click', function () {
      more();
      if (footer.isConnected) btn.focus();
    });
    updateFooter();

    if ('IntersectionObserver' in window) {
      var obs = new IntersectionObserver(function (entries) {
        if (entries.some(function (en) { return en.isIntersecting; })) more();
      }, { root: scrollRootFor(container), rootMargin: '0px 0px 600px 0px' });
      obs.observe(footer);
      container._fkObserver = obs;
    }
  }

  window.FeedKit = {
    createLenses: createLenses,
    createFilterToggle: createFilterToggle,
    renderPaged: renderPaged
  };
})();
