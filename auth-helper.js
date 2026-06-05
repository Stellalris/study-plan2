/**
 * auth-helper.js
 * 提供 5 天免登录的 token 刷新机制。
 * 依赖：app-config.js（提供 SUPABASE_URL / SUPABASE_ANON_KEY）
 *
 * 使用方式：
 *   <script src="app-config.js"></script>
 *   <script src="auth-helper.js"></script>
 *   <script>
 *     (async () => {
 *       const auth = await AuthHelper.ensureSession();
 *       if (!auth) { location.replace('login1.html'); return; }
 *       // auth.token, auth.user 可用
 *     })();
 *   </script>
 */
(function () {
  'use strict';

  var AUTH_KEY = 'study-plan-auth';
  var FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000; // 5 天毫秒数

  /**
   * 从 JWT 中解析 payload（不含验签）
   */
  function jwtPayload(token) {
    try {
      var part = String(token || '').split('.')[1];
      if (!part) return null;
      var b64 = part.replace(/-/g, '+').replace(/_/g, '/');
      var pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
      return JSON.parse(atob(b64 + pad));
    } catch (e) {
      return null;
    }
  }

  /**
   * 判断 token 是否已过期（预留 30 秒缓冲）
   */
  function isTokenExpired(token) {
    var payload = jwtPayload(token);
    if (!payload || !payload.exp) return true;
    return (payload.exp * 1000) <= (Date.now() + 30000);
  }

  /**
   * 用 refresh_token 换取新的 access_token
   * 返回 { access_token, refresh_token, expires_in } 或 null
   */
  async function refreshAccessToken(refreshToken) {
    var url = (window.APP_CONFIG?.SUPABASE_URL || '').trim().replace(/\/$/, '');
    var anonKey = (window.APP_CONFIG?.SUPABASE_ANON_KEY || '').trim();
    if (!url || !anonKey || !refreshToken) return null;

    try {
      var res = await fetch(url + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': anonKey,
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) return null;
      var data = await res.json();
      if (!data.access_token) return null;
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token || refreshToken,
        expires_in: data.expires_in || 3600,
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * 从 localStorage 读取缓存的 auth 数据
   */
  function getCachedAuth() {
    try {
      return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    } catch (e) {
      return null;
    }
  }

  /**
   * 保存 auth 数据到 localStorage
   */
  function saveAuth(data) {
    try {
      localStorage.setItem(AUTH_KEY, JSON.stringify(data));
    } catch (e) {
      // ignore
    }
  }

  /**
   * 清除 auth 数据
   */
  function clearAuth() {
    try {
      localStorage.removeItem(AUTH_KEY);
    } catch (e) {
      // ignore
    }
  }

  /**
   * 核心方法：确保 session 有效
   * 返回 { token, user } 或 null（需要重新登录）
   */
  async function ensureSession() {
    var cached = getCachedAuth();
    if (!cached || !cached.token || !cached.user || !cached.user.id) {
      return null;
    }

    // 检查 5 天免登录期限
    if (cached.login_at) {
      var elapsed = Date.now() - cached.login_at;
      if (elapsed > FIVE_DAYS_MS) {
        // 超过 5 天，清除并返回 null
        clearAuth();
        return null;
      }
    }

    // 如果 token 未过期，直接返回
    if (!isTokenExpired(cached.token)) {
      return { token: cached.token, user: cached.user };
    }

    // token 已过期，尝试用 refresh_token 刷新
    if (!cached.refresh_token) {
      // 没有 refresh_token，无法刷新，需要重新登录
      clearAuth();
      return null;
    }

    var refreshed = await refreshAccessToken(cached.refresh_token);
    if (!refreshed) {
      // 刷新失败，清除 auth 让用户重新登录
      clearAuth();
      return null;
    }

    // 刷新成功，更新 localStorage
    var newAuth = {
      token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      user: cached.user,
      login_at: cached.login_at, // 保持原来的登录时间，不延长 5 天期限
    };
    saveAuth(newAuth);
    return { token: refreshed.access_token, user: cached.user };
  }

  /**
   * 登录成功后调用此方法保存 session（含 refresh_token）
   */
  function onLoginSuccess(accessToken, refreshToken, user) {
    var authData = {
      token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        email: user.email || '',
        username: user.username || user.email || '',
        role: user.role || 'user',
      },
      login_at: Date.now(), // 记录登录时间，用于 5 天判断
    };
    saveAuth(authData);
  }

  /**
   * 退出登录
   */
  function logout() {
    clearAuth();
  }

  // 暴露全局 API
  window.AuthHelper = {
    ensureSession: ensureSession,
    onLoginSuccess: onLoginSuccess,
    logout: logout,
    getCachedAuth: getCachedAuth,
    clearAuth: clearAuth,
  };
})();
