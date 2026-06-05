/**
 * 从 plan 等页预取思维导图资源，缩短进入 mindmap.html 的等待
 */
(function (global) {
  'use strict';

  if (!global.MindMapLibConfig) {
    const VER = '0.14.0-fix.2';
    global.MindMapLibConfig = {
      version: VER,
      localBase: 'vendor/simple-mind-map',
      cdnBase: `https://cdn.jsdelivr.net/npm/simple-mind-map@${VER}/dist`,
      cssFile: 'simpleMindMap.esm.min.css',
      jsFile: 'simpleMindMap.umd.min.js',
    };
  }

  const cfg = global.MindMapLibConfig;

  let warmed = false;

  function linkPrefetch(href, as) {
    try {
      if (document.querySelector(`link[rel="prefetch"][href="${href}"]`)) return;
      const l = document.createElement('link');
      l.rel = 'prefetch';
      l.href = href;
      if (as) l.as = as;
      document.head.appendChild(l);
    } catch (_) {}
  }

  function warmMindMapAssets() {
    if (warmed) return;
    warmed = true;
    linkPrefetch('mindmap.html', 'document');
    linkPrefetch('js/mindmap-page.js', 'script');
    linkPrefetch('js/plan-mindmap.js', 'script');
    linkPrefetch('js/mindmap-lib-config.js', 'script');
    linkPrefetch(`${cfg.localBase}/${cfg.jsFile}`, 'script');
    linkPrefetch(`${cfg.localBase}/${cfg.cssFile}`, 'style');
  }

  function scheduleWarm() {
    if ('requestIdleCallback' in global) {
      global.requestIdleCallback(warmMindMapAssets, { timeout: 4000 });
    } else {
      setTimeout(warmMindMapAssets, 2000);
    }
  }

  scheduleWarm();

  global.addEventListener(
    'mouseover',
    (e) => {
      if (e.target.closest?.('a[href*="mindmap.html"]')) warmMindMapAssets();
    },
    { passive: true }
  );

  global.MindMapPrefetch = { warm: warmMindMapAssets };
})(typeof window !== 'undefined' ? window : global);
