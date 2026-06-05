/**
 * 左侧固定侧栏导航（桌面）/ 抽屉（移动端）
 */
(function (global) {
  'use strict';

  const NAV_GROUPS = [
    {
      label: '常用',
      items: [
        { id: 'plan', href: 'plan.html', label: '今日计划', icon: 'fa-calendar-day' },
        { id: 'mindmap', href: 'mindmap.html', label: '思维导图', icon: 'fa-diagram-project' },
      ],
    },
    {
      label: '记录',
      items: [
        { id: 'diary', href: 'diary.html', label: '我的日记', icon: 'fa-book-journal-whills' },
        { id: 'stats', href: 'stats.html', label: '数据统计', icon: 'fa-chart-line' },
      ],
    },
    {
      label: '社区',
      items: [{ id: 'community', href: 'community.html', label: '社区留言', icon: 'fa-users' }],
    },
  ];

  const PAGE_TITLES = {
    plan: '今日计划',
    mindmap: '思维导图',
    diary: '我的日记',
    stats: '数据统计',
    community: '社区留言',
  };

  function currentPageId() {
    const path = (global.location.pathname || '').split('/').pop() || 'plan.html';
    if (path === 'plan.html' || path === '' || path === 'index.html') return 'plan';
    if (path.startsWith('mindmap')) return 'mindmap';
    if (path.startsWith('diary')) return 'diary';
    if (path.startsWith('stats')) return 'stats';
    if (path.startsWith('community')) return 'community';
    return '';
  }

  function isAdminUser() {
    try {
      const auth = JSON.parse(localStorage.getItem('study-plan-auth') || 'null');
      return String(auth?.user?.role || '') === 'admin';
    } catch {
      return false;
    }
  }

  function renderNavLinks(activeId) {
    const aid = activeId || currentPageId();
    const parts = [];
    NAV_GROUPS.forEach((group) => {
      parts.push(`<p class="app-nav-group-label">${group.label}</p>`);
      group.items.forEach((item) => {
        const active = item.id === aid ? ' is-active' : '';
        parts.push(
          `<a href="${item.href}" class="app-nav-item${active}" data-nav-link><i class="fa-solid ${item.icon}"></i><span>${item.label}</span></a>`
        );
      });
    });
    if (isAdminUser()) {
      parts.push('<p class="app-nav-group-label">管理</p>');
      parts.push(
        '<a href="admin.html" class="app-nav-item" data-nav-link><i class="fa-solid fa-user-shield"></i><span>后台管理</span></a>'
      );
    }
    return parts.join('');
  }

  function renderTopbar(activeId) {
    const aid = activeId || currentPageId();
    const title = PAGE_TITLES[aid] || 'Study Plan';
    return `<div class="app-topbar">
      <button type="button" class="app-topbar-toggle" id="appNavToggle" aria-label="打开菜单"><i class="fa-solid fa-bars"></i></button>
      <div class="app-topbar-breadcrumb">首页 / <strong>${title}</strong></div>
    </div>`;
  }

  function renderNav(activeId) {
    const rail = document.getElementById('appNavRail');
    if (!rail) return;
    rail.innerHTML = `
      <div class="app-nav-brand">
        <div class="app-nav-brand-title"><i class="fa-solid fa-graduation-cap app-nav-brand-accent mr-1.5"></i>Study Plan</div>
        <span class="app-nav-brand-tag">学习计划</span>
      </div>
      <div class="app-nav-links">${renderNavLinks(activeId)}</div>
      <div class="app-nav-footer">
        <a href="login1.html" class="app-nav-item" onclick="localStorage.removeItem('study-plan-auth');">
          <i class="fa-solid fa-right-from-bracket"></i><span>退出登录</span>
        </a>
      </div>`;
    rail.querySelectorAll('[data-nav-link]').forEach((a) => {
      a.addEventListener('click', () => closeMobileNav());
    });
  }

  function closeMobileNav() {
    document.getElementById('appNavRail')?.classList.remove('is-open');
    document.getElementById('appNavBackdrop')?.classList.remove('is-open');
  }

  function openMobileNav() {
    document.getElementById('appNavRail')?.classList.add('is-open');
    document.getElementById('appNavBackdrop')?.classList.add('is-open');
  }

  function bindMobileToggle() {
    document.getElementById('appNavToggle')?.addEventListener('click', () => {
      const rail = document.getElementById('appNavRail');
      if (rail?.classList.contains('is-open')) closeMobileNav();
      else openMobileNav();
    });
    document.getElementById('appNavBackdrop')?.addEventListener('click', closeMobileNav);
  }

  function mountAppShell(mainSelector, activeId) {
    const main = document.querySelector(mainSelector || 'body > main');
    if (!main || document.querySelector('.app-shell')) return;

    const shell = document.createElement('div');
    shell.className = 'app-shell';

    const backdrop = document.createElement('div');
    backdrop.id = 'appNavBackdrop';
    backdrop.className = 'app-nav-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');

    const nav = document.createElement('nav');
    nav.id = 'appNavRail';
    nav.className = 'app-nav-rail';
    nav.setAttribute('aria-label', '应用导航');

    const wrap = document.createElement('div');
    wrap.className = 'app-shell-main';

    const topbar = document.createElement('div');
    topbar.id = 'appTopbar';
    topbar.innerHTML = renderTopbar(activeId);

    main.parentNode.insertBefore(shell, main);
    document.body.insertBefore(backdrop, shell);
    shell.appendChild(nav);
    shell.appendChild(wrap);
    wrap.appendChild(topbar);
    wrap.appendChild(main);

    renderNav(activeId);
    bindMobileToggle();

    global.addEventListener('resize', () => {
      if (global.innerWidth > 768) closeMobileNav();
    });
  }

  global.AppNav = { mountAppShell, renderNav, currentPageId, closeMobileNav };
})(typeof window !== 'undefined' ? window : global);
