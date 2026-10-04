// Shared navigation component for the Microsoft Communications Portal.
// Injects the header + nav bar into every page, replacing ~40 lines of
// copy-pasted HTML per file. Depends on util.js (loaded before this file).
(function () {
  'use strict';

  var HEADER_HTML =
    '<header class="header">' +
      '<div class="header-logo" role="img" aria-label="Microsoft">' +
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 23 23" aria-hidden="true" focusable="false">' +
          '<path fill="#F25022" d="M0 0h11v11H0z"/>' +
          '<path fill="#7FBA00" d="M12 0h11v11H12z"/>' +
          '<path fill="#00A4EF" d="M0 12h11v11H0z"/>' +
          '<path fill="#FFB900" d="M12 12h11v11H12z"/>' +
        '</svg>' +
      '</div>' +
      '<div>' +
        '<div class="header-title">Microsoft Communications Portal</div>' +
        '<div class="header-subtitle">A tool not officially supported by Microsoft, but officially created by ' +
          '<a href="https://www.linkedin.com/in/russrimm" target="_blank" rel="noopener noreferrer">Russ Rimmerman</a>' +
          ', Microsoft Cloud Solution Architect, to help customers keep up with the pace of change.</div>' +
      '</div>' +
      '<button class="theme-btn" id="theme-btn" type="button" aria-label="Toggle dark or light theme" data-act="toggleTheme">\uD83C\uDF19 Dark</button>' +
      '<button class="nav-menu-btn" id="nav-menu-btn" type="button" aria-expanded="false" aria-controls="primary-nav">' +
        '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">' +
          '<path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>' +
        '</svg>' +
        '<span>Menu</span>' +
      '</button>' +
    '</header>';

  // Nav tab definitions. Each entry is either a simple link { label, href }
  // or a dropdown { label, items: [{ label, href }] }.
  var NAV_ITEMS = [
    { label: 'Home', href: '/home' },
    { label: 'Roadmaps', items: [
      { label: 'Power Platform & Dynamics 365', href: '/powerplatform' },
      { label: 'Regional Release Plans', href: '/featuregeo', sub: true },
      { label: 'Fabric',         href: '/fabricroadmap' },
      { label: 'Azure',          href: '/azureupdates' },
      { label: 'Microsoft 365',  href: '/m365updates' }
    ]},
    { label: 'Microsoft 365', items: [
      { label: 'Message Center', href: '/messagecenter' }
    ]},
    { label: 'Service Health', items: [
      { label: 'Microsoft 365', href: '/servicehealth' },
      { label: 'Azure',         href: '/azureservicehealth' }
    ]},
    { label: 'Guided Report', href: '/guidedreport' }
  ];

  function buildNav(path) {
    var html = '<nav class="page-tabs" id="primary-nav" aria-label="Primary">';
    for (var i = 0; i < NAV_ITEMS.length; i++) {
      var item = NAV_ITEMS[i];
      if (item.items) {
        // Dropdown
        var dropdownActive = false;
        var menuHtml = '';
        for (var j = 0; j < item.items.length; j++) {
          var sub = item.items[j];
          var isItemActive = path === sub.href;
          if (isItemActive) dropdownActive = true;
          menuHtml += '<a class="nav-dropdown-item' + (isItemActive ? ' active' : '') +
            (sub.sub ? ' nav-dropdown-subitem' : '') + '"' +
            ' href="' + sub.href + '"' +
            (isItemActive ? ' aria-current="page"' : '') + '>' +
            sub.label + '</a>';
        }
        html += '<div class="nav-dropdown">' +
          '<button class="nav-tab nav-dropdown-toggle' + (dropdownActive ? ' active' : '') + '"' +
          ' type="button" aria-expanded="false" aria-haspopup="true">' +
          item.label + ' <span class="nav-dropdown-caret" aria-hidden="true">\u25BE</span></button>' +
          '<div class="nav-dropdown-menu">' + menuHtml + '</div></div>';
      } else {
        // Simple link
        var isActive = path === item.href;
        html += '<a class="nav-tab' + (isActive ? ' active' : '') + '"' +
          ' href="' + item.href + '"' +
          (isActive ? ' aria-current="page"' : '') + '>' +
          item.label + '</a>';
      }
    }
    html += '</nav>';
    return html;
  }

  function wireDropdowns() {
    var toggles = document.querySelectorAll('.nav-dropdown-toggle');
    for (var i = 0; i < toggles.length; i++) {
      toggles[i].addEventListener('click', function (e) {
        e.stopPropagation();
        var dd = this.closest('.nav-dropdown');
        var allOpen = document.querySelectorAll('.nav-dropdown.open');
        for (var k = 0; k < allOpen.length; k++) {
          if (allOpen[k] !== dd) {
            allOpen[k].classList.remove('open');
            allOpen[k].querySelector('.nav-dropdown-toggle').setAttribute('aria-expanded', 'false');
          }
        }
        var isOpen = dd.classList.toggle('open');
        this.setAttribute('aria-expanded', isOpen);
      });
    }
    document.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('#nav-menu-btn')) return;
      var allOpen = document.querySelectorAll('.nav-dropdown.open');
      for (var k = 0; k < allOpen.length; k++) {
        allOpen[k].classList.remove('open');
        allOpen[k].querySelector('.nav-dropdown-toggle').setAttribute('aria-expanded', 'false');
      }
    });
    // Escape closes any open dropdown and returns focus to its toggle button,
    // matching standard menu-button keyboard behavior (WAI-ARIA APG).
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var allOpen = document.querySelectorAll('.nav-dropdown.open');
      if (!allOpen.length) return;
      for (var k = 0; k < allOpen.length; k++) {
        var toggle = allOpen[k].querySelector('.nav-dropdown-toggle');
        allOpen[k].classList.remove('open');
        if (toggle) {
          toggle.setAttribute('aria-expanded', 'false');
          if (allOpen[k].contains(document.activeElement)) toggle.focus();
        }
      }
    });
  }

  // Below 768px the tab bar collapses behind a Menu button and opens as a
  // full-width panel; dropdown groups expand inline instead of floating.
  function wireMobileMenu() {
    var btn = document.getElementById('nav-menu-btn');
    var nav = document.getElementById('primary-nav');
    if (!btn || !nav) return;

    function setOpen(open) {
      nav.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
      document.body.classList.toggle('nav-menu-open', open);
      if (open) {
        // Expand the group that holds the current page so it's one tap away.
        var activeGroup = nav.querySelector('.nav-dropdown-toggle.active');
        if (activeGroup) {
          activeGroup.closest('.nav-dropdown').classList.add('open');
          activeGroup.setAttribute('aria-expanded', 'true');
        }
        var first = nav.querySelector('.nav-tab');
        if (first) first.focus();
      }
    }

    btn.addEventListener('click', function () {
      setOpen(!nav.classList.contains('is-open'));
    });
    document.addEventListener('click', function (e) {
      if (!nav.classList.contains('is-open')) return;
      if (nav.contains(e.target) || btn.contains(e.target)) return;
      setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !nav.classList.contains('is-open')) return;
      setOpen(false);
      btn.focus();
    });
    window.matchMedia('(min-width: 769px)').addEventListener('change', function (mq) {
      if (mq.matches) setOpen(false);
    });
  }

  function init() {
    var path = window.location.pathname.replace(/\/+$/, '') || '/home';
    var markup = HEADER_HTML + buildNav(path);
    document.body.insertAdjacentHTML('afterbegin', markup);
    wireDropdowns();
    wireMobileMenu();
    // Update the theme button label now that the button is in the DOM.
    if (typeof window.applyThemeButtonLabel === 'function') {
      window.applyThemeButtonLabel();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
