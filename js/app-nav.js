/**
 * 右侧（移动端底部）统一导航栏
 */
(function (global) {
  'use strict';

  const NAV_ITEMS = [
    { id: 'plan', href: 'plan.html', label: '今日', icon: 'fa-calendar-day' },
    { id: 'mindmap', href: 'mindmap.html', label: '导图', icon: 'fa-diagram-project' },
    { id: 'diary', href: 'diary.html', label: '日记', icon: 'fa-book-journal-whills' },
    { id: 'stats', href: 'stats.html', label: '统计', icon: 'fa-chart-line' },
    { id: 'community', href: 'community.html', label: '社区', icon: 'fa-users' },
  ];

  function currentPageId() {
    const path = (global.location.pathname || '').split('/').pop() || 'plan.html';
    if (path === 'plan.html' || path === '' || path === 'index.html') return 'plan';
    if (path.startsWith('mindmap')) return 'mindmap';
    if (path.startsWith('diary')) return 'diary';
    if (path.startsWith('stats')) return 'stats';
    if (path.startsWith('community')) return 'community';
    return '';
  }

  function renderNav(activeId) {
    const el = document.getElementById('appNavRail');
    if (!el) return;
    const aid = activeId || currentPageId();
    const parts = NAV_ITEMS.map((item) => {
      const active = item.id === aid ? ' is-active' : '';
      return `<a href="${item.href}" class="app-nav-item${active}" title="${item.label}"><i class="fa-solid ${item.icon}"></i><span>${item.label}</span></a>`;
    });
    parts.push('<div class="app-nav-spacer"></div>');
    parts.push(
      `<a href="login1.html" class="app-nav-item" title="退出" onclick="localStorage.removeItem('study-plan-auth');"><i class="fa-solid fa-right-from-bracket"></i><span>退出</span></a>`
    );
    el.innerHTML = parts.join('');
  }

  function mountAppShell(mainSelector, activeId) {
    const main = document.querySelector(mainSelector || 'body > main');
    if (!main || document.querySelector('.app-shell')) return;
    const shell = document.createElement('div');
    shell.className = 'app-shell';
    const nav = document.createElement('nav');
    nav.id = 'appNavRail';
    nav.className = 'app-nav-rail';
    nav.setAttribute('aria-label', '应用导航');
    const wrap = document.createElement('div');
    wrap.className = 'app-shell-main';
    main.parentNode.insertBefore(shell, main);
    shell.appendChild(wrap);
    shell.appendChild(nav);
    wrap.appendChild(main);
    renderNav(activeId);
  }

  global.AppNav = { mountAppShell, renderNav, currentPageId };
})(typeof window !== 'undefined' ? window : global);
