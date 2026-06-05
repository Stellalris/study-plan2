/**
 * Supabase REST 客户端（多页共用）
 */
(function (global) {
  'use strict';

  const AUTH_KEY = 'study-plan-auth';

  function readAuth() {
    try {
      return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    } catch {
      return null;
    }
  }

  function jwtSub(token) {
    try {
      const part = String(token || '').split('.')[1];
      if (!part) return null;
      const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
      const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
      return JSON.parse(atob(b64 + pad)).sub || null;
    } catch {
      return null;
    }
  }

  let auth = readAuth();

  function getConfig() {
    const url = String(global.APP_CONFIG?.SUPABASE_URL || '').trim().replace(/\/$/, '');
    const key = String(global.APP_CONFIG?.SUPABASE_ANON_KEY || '').trim();
    return { url, key };
  }

  function authUserId() {
    return auth?.user?.id || jwtSub(auth?.token);
  }

  function requireAuth() {
    auth = readAuth();
    if (!auth?.token || !authUserId()) {
      global.location.replace('login1.html');
      return false;
    }
    return true;
  }

  async function sbRequest(pathAndQuery, init = {}) {
    const { url: SUPABASE_URL, key: SUPABASE_ANON_KEY } = getConfig();
    const qm = pathAndQuery.indexOf('?');
    const p = qm >= 0 ? pathAndQuery.slice(0, qm) : pathAndQuery;
    const q = qm >= 0 ? pathAndQuery.slice(qm + 1) : '';
    const method = String(init.method || 'GET').toUpperCase();
    const rawBody =
      init.body == null ? null : typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
    const headers = {
      Accept: 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: auth?.token ? `Bearer ${auth.token}` : `Bearer ${SUPABASE_ANON_KEY}`,
    };
    if (method !== 'GET' && method !== 'HEAD') headers['Content-Type'] = 'application/json';
    if (init.headers && typeof init.headers === 'object') Object.assign(headers, init.headers);
    let res;
    try {
      res = await fetch(`${SUPABASE_URL}/rest/v1${p}${q ? `?${q}` : ''}`, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : rawBody,
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      const net =
        e instanceof TypeError || (typeof m === 'string' && m.toLowerCase().includes('failed to fetch'));
      throw new Error(net ? `无法连接 Supabase（${SUPABASE_URL}）` : m);
    }
    const text = await res.text();
    if (res.status === 204) return null;
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }
    if (!res.ok) {
      const msg =
        (data && (data.message || data.error_description || data.hint || data.details)) ||
        `请求失败（HTTP ${res.status}）`;
      const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      err.httpStatus = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function sbRpc(fnName, args = {}) {
    const { url: SUPABASE_URL, key: SUPABASE_ANON_KEY } = getConfig();
    const authHdr = auth?.token ? `Bearer ${auth.token}` : `Bearer ${SUPABASE_ANON_KEY}`;
    let res;
    try {
      res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(fnName)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: authHdr,
        },
        body: JSON.stringify(args),
      });
    } catch (e) {
      throw new Error(`无法连接 Supabase RPC（${fnName}）`);
    }
    const text = await res.text();
    let data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const msg = (data && data.message) || `RPC 失败（HTTP ${res.status}）`;
      const err = new Error(msg);
      err.httpStatus = res.status;
      throw err;
    }
    return data;
  }

  global.PlanSupabase = {
    AUTH_KEY,
    readAuth,
    requireAuth,
    getAuth: () => auth,
    setAuth: (a) => {
      auth = a;
    },
    authUserId,
    sbRequest,
    sbRpc,
    getConfig,
  };
})(typeof window !== 'undefined' ? window : global);
