/**
 * simple-mind-map 资源路径（自托管优先，CDN 回退）
 */
(function (global) {
  'use strict';

  const VER = '0.14.0-fix.2';
  global.MindMapLibConfig = {
    version: VER,
    localBase: 'vendor/simple-mind-map',
    cdnBase: `https://cdn.jsdelivr.net/npm/simple-mind-map@${VER}/dist`,
    cssFile: 'simpleMindMap.esm.min.css',
    jsFile: 'simpleMindMap.umd.min.js',
  };
})(typeof window !== 'undefined' ? window : global);
