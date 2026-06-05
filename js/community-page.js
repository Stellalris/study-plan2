/**
 * community.html — 留言 + 全员打卡日历
 */
(function () {
  'use strict';

  const PS = window.PlanSupabase;
  if (!PS.requireAuth()) return;
  const auth = PS.getAuth();
  const { sbRequest, sbRpc } = PS;
  const nativeAlert = window.alert.bind(window);

  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  function showAlert(msg) {
    nativeAlert(String(msg ?? ''));
  }

  function fmtDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function formatDateZh(key) {
    const [y, mo, d] = String(key || '').split('-').map(Number);
    return y ? `${y}年${mo}月${d}日` : key;
  }

  function normalizeSqlDateKey(v) {
    const m = String(v ?? '').match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : '';
  }

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  let calDate = new Date();
  let selectedDate = fmtDate(new Date());
  let communityMessages = [];
  let communityCalendarStatus = { users: [], cells: {} };
  let communityCalendarCellsMerged = {};

  function authUserId() {
    return PS.authUserId();
  }

  async function buildCommunityCalendarStatus(year, month) {
    const y = Number(year);
    const mo = Number(month);
    try {
      const data = await sbRpc('community_calendar_status', { p_year: y, p_month: mo });
      if (data && Array.isArray(data.users) && data.cells) return data;
    } catch (e) {
      console.warn('[community] RPC fallback', e.message || e);
    }
    const lastDay = new Date(y, mo, 0).getDate();
    const pad = (n) => String(n).padStart(2, '0');
    const startStr = `${y}-${pad(mo)}-01`;
    const endStr = `${y}-${pad(mo)}-${pad(lastDay)}`;
    const [profiles, taskRows, habitRows, habitLogRows] = await Promise.all([
      sbRequest('/profiles?select=id,username&order=username.asc'),
      sbRequest(
        `/tasks?select=user_id,date,completed&date=gte.${encodeURIComponent(startStr)}&date=lte.${encodeURIComponent(endStr)}`
      ),
      sbRequest('/habits?select=user_id,id'),
      sbRequest(
        `/habit_logs?select=user_id,log_date&log_date=gte.${encodeURIComponent(startStr)}&log_date=lte.${encodeURIComponent(endStr)}`
      ),
    ]);
    const userList = (Array.isArray(profiles) ? profiles : []).map((r) => ({
      id: String(r.id),
      username: String(r.username || ''),
    }));
    const taskMap = new Map();
    (Array.isArray(taskRows) ? taskRows : []).forEach((r) => {
      const d = normalizeSqlDateKey(r.date) || r.date;
      const key = `${String(r.user_id)}|${d}`;
      const cur = taskMap.get(key) || { pending: 0, total: 0 };
      cur.total += 1;
      if (!r.completed) cur.pending += 1;
      taskMap.set(key, cur);
    });
    const habitCountMap = new Map();
    (Array.isArray(habitRows) ? habitRows : []).forEach((r) => {
      const uid = String(r.user_id);
      habitCountMap.set(uid, (habitCountMap.get(uid) || 0) + 1);
    });
    const habitLogMap = new Map();
    (Array.isArray(habitLogRows) ? habitLogRows : []).forEach((r) => {
      const d = normalizeSqlDateKey(r.log_date) || r.log_date;
      const key = `${String(r.user_id)}|${d}`;
      habitLogMap.set(key, (habitLogMap.get(key) || 0) + 1);
    });
    const cells = {};
    for (let day = 1; day <= lastDay; day++) {
      const dateStr = `${y}-${pad(mo)}-${pad(day)}`;
      cells[dateStr] = {};
      for (const u of userList) {
        const uid = u.id;
        const tk = taskMap.get(`${uid}|${dateStr}`) || { pending: 0, total: 0 };
        const hCount = habitCountMap.get(uid) || 0;
        const resolved = habitLogMap.get(`${uid}|${dateStr}`) || 0;
        let state = 'none';
        if (tk.pending > 0) state = 'working';
        else if (tk.total > 0 && tk.pending === 0) {
          state = hCount === 0 || resolved >= hCount ? 'done' : 'working';
        } else if (tk.total === 0) {
          if (hCount === 0) state = 'none';
          else if (resolved === 0) state = 'none';
          else if (resolved < hCount) state = 'working';
          else state = 'done';
        }
        cells[dateStr][uid] = state;
      }
    }
    return { users: userList, cells };
  }

  function mergeCommunityCalendarPayload(data) {
    if (!data || typeof data !== 'object') return;
    if (Array.isArray(data.users)) communityCalendarStatus.users = data.users;
    if (data.cells && typeof data.cells === 'object') {
      Object.assign(communityCalendarCellsMerged, data.cells);
      communityCalendarStatus.cells = { ...communityCalendarStatus.cells, ...data.cells };
    }
  }

  async function api(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    let body = null;
    if (options.body != null) {
      body = typeof options.body === 'object' ? options.body : JSON.parse(String(options.body));
    }
    const uid = authUserId();
    const [pathname, rawQs] = path.includes('?') ? path.split('?') : [path, ''];
    if (pathname === '/api/community/calendar-status' && method === 'GET') {
      const sp = new URLSearchParams(rawQs);
      return buildCommunityCalendarStatus(Number(sp.get('year')), Number(sp.get('month')));
    }
    if (pathname === '/api/community/messages' && method === 'GET') {
      const sp = new URLSearchParams(rawQs);
      const limit = Math.min(80, Math.max(1, Number(sp.get('limit')) || 50));
      const rows = await sbRequest(
        `/community_messages?select=id,user_id,body,created_at,profiles(username)&order=created_at.desc&limit=${limit}`
      );
      return {
        messages: (Array.isArray(rows) ? rows : []).map((r) => ({
          id: String(r.id),
          userId: String(r.user_id),
          username: String(r.profiles?.username || ''),
          body: String(r.body || ''),
          createdAt: r.created_at ? String(r.created_at).slice(0, 19).replace('T', ' ') : '',
        })),
      };
    }
    if (pathname === '/api/community/messages' && method === 'POST') {
      const raw = String(body?.content ?? body?.body ?? '').trim();
      if (!raw) throw new Error('留言不能为空');
      if (raw.length > 2000) throw new Error('留言过长');
      const ins = await sbRequest('/community_messages', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify([{ user_id: uid, body: raw }]),
      });
      const r = Array.isArray(ins) ? ins[0] : ins;
      return {
        id: String(r?.id || ''),
        userId: uid,
        username: String(auth?.user?.username || ''),
        body: raw,
        createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };
    }
    throw new Error(`未知 API ${path}`);
  }

  function messageCreatedDateKey(createdAt) {
    const m = String(createdAt || '').match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : '';
  }

  function checkinBadgeClass(state) {
    if (state === 'done') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    if (state === 'working') return 'bg-amber-100 text-amber-900 border-amber-200';
    if (state === 'none') return 'bg-slate-100 text-slate-600 border-slate-200';
    return 'bg-slate-100 text-slate-500 border-slate-200';
  }

  function getCheckinDisplayForMessage(msg) {
    const uid = String(msg.userId || '');
    const dk = messageCreatedDateKey(msg.createdAt);
    const row = dk ? communityCalendarCellsMerged[dk] : null;
    const st = row && row[uid] != null ? row[uid] : null;
    const lab = st === 'done' ? '已打卡' : st === 'working' ? '进行中' : st === 'none' ? '未打卡' : '—';
    return { label: lab, state: st };
  }

  function refreshCommunityMsgPlaceholder() {
    const ta = $('communityMsgInput');
    if (ta) ta.placeholder = `向所有人留言（发送后将记在 ${formatDateZh(selectedDate)}）…`;
    const hint = $('communityMsgFilterHint');
    if (hint) hint.textContent = `显示「${formatDateZh(selectedDate)}」的留言；点击日历切换日期。`;
  }

  function renderCommunityMessageLists() {
    const scroll = $('communityMsgScroll');
    const empty = $('communityMsgEmpty');
    const myId = String(authUserId() || '');
    refreshCommunityMsgPlaceholder();
    if (!scroll || !empty) return;
    scroll.innerHTML = '';
    const msgsForDay = communityMessages.filter((msg) => messageCreatedDateKey(msg.createdAt) === selectedDate);
    const chronological = [...msgsForDay].reverse();
    chronological.forEach((msg) => {
      const isSelf = String(msg.userId) === myId;
      const { label: ckLabel, state: ckState } = getCheckinDisplayForMessage(msg);
      const badge = `<span class="inline-flex shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${checkinBadgeClass(ckState)}">${esc(ckLabel)}</span>`;
      const timeStr = String(msg.createdAt || '').slice(11, 19) || String(msg.createdAt || '').slice(0, 16);
      const row = document.createElement('div');
      row.className = `flex w-full gap-2 ${isSelf ? 'justify-end' : 'justify-start'}`;
      if (isSelf) {
        row.innerHTML = `<div class="max-w-[88%]"><div class="flex flex-wrap items-center justify-end gap-1.5">${badge}<span class="text-[10px] text-slate-400">${esc(timeStr)}</span></div><div class="mt-1 rounded-2xl rounded-tr-sm bg-violet-600 px-3 py-2 text-[13px] text-white shadow-sm"><p class="whitespace-pre-wrap break-words">${esc(msg.body || '')}</p></div></div>`;
      } else {
        const letter = (msg.username || '?').trim().slice(0, 1) || '?';
        row.innerHTML = `<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-200 text-xs font-bold text-violet-900">${esc(letter)}</div><div class="min-w-0 max-w-[88%]"><div class="flex flex-wrap items-center gap-1.5"><span class="text-xs font-semibold text-violet-900">${esc(msg.username || '用户')}</span>${badge}<span class="text-[10px] text-slate-400">${esc(timeStr)}</span></div><div class="mt-1 rounded-2xl rounded-tl-sm border border-white bg-white px-3 py-2 text-[13px] text-slate-800 shadow-sm"><p class="whitespace-pre-wrap break-words">${esc(msg.body || '')}</p></div></div>`;
      }
      scroll.appendChild(row);
    });
    const hasDay = msgsForDay.length > 0;
    empty.classList.toggle('hidden', hasDay);
    empty.textContent = hasDay ? '暂无留言' : `「${formatDateZh(selectedDate)}」暂无留言`;
    scroll.classList.toggle('hidden', !hasDay);
    if (hasDay) scroll.scrollTop = scroll.scrollHeight;
  }

  async function loadCommunityMessages() {
    try {
      const data = await api('/api/community/messages?limit=50');
      communityMessages = Array.isArray(data?.messages) ? data.messages : [];
    } catch (e) {
      console.warn(e);
      communityMessages = [];
    }
    renderCommunityMessageLists();
  }

  function paintCalendar() {
    const y = calDate.getFullYear();
    const mo = calDate.getMonth();
    $('calTitle').textContent = `${y} 年 ${mo + 1} 月`;
    const first = new Date(y, mo, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(y, mo + 1, 0).getDate();
    const grid = $('calendarGrid');
    grid.innerHTML = '';
    const users = communityCalendarStatus.users || [];
    const cells = communityCalendarCellsMerged;
    const todayKey = fmtDate(new Date());
    for (let i = 0; i < startPad; i++) {
      const ph = document.createElement('div');
      ph.className = 'min-h-[2.5rem]';
      grid.appendChild(ph);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const key = fmtDate(new Date(y, mo, d));
      const cell = document.createElement('button');
      cell.type = 'button';
      const isSel = key === selectedDate;
      const isToday = key === todayKey;
      cell.className = `min-h-[2.5rem] rounded-lg border p-1 text-left text-xs transition ${
        isSel ? 'border-violet-400 bg-violet-50 ring-2 ring-violet-200' : 'border-slate-100 bg-white hover:border-violet-200'
      }`;
      const comm = cells[key];
      const dots =
        users.length && comm
          ? users
              .slice(0, 8)
              .map((u) => {
                const st = comm[u.id] || 'none';
                const cls = st === 'done' ? 'bg-emerald-500' : st === 'working' ? 'bg-amber-500' : 'bg-slate-300';
                return `<span class="inline-block h-1.5 w-1.5 rounded-full ${cls}" title="${esc(u.username)}"></span>`;
              })
              .join('')
          : '';
      cell.innerHTML = `<span class="font-semibold ${isToday ? 'text-brand-600' : 'text-slate-700'}">${d}</span><div class="mt-0.5 flex flex-wrap gap-0.5">${dots}</div>`;
      cell.onclick = () => {
        selectedDate = key;
        paintCalendar();
        renderCommunityMessageLists();
      };
      grid.appendChild(cell);
    }
    const commSel = cells[selectedDate];
    let commLine = '';
    if (commSel && users.length) {
      const parts = users.slice(0, 6).map((u) => {
        const st = commSel[u.id] || 'none';
        const lab = st === 'done' ? '已打卡' : st === 'working' ? '进行中' : '未打卡';
        return `${u.username} ${lab}`;
      });
      commLine = ` · 全员：${parts.join(' · ')}`;
    }
    $('selectedDateHint').textContent = `${formatDateZh(selectedDate)}${commLine}`;
    refreshCommunityMsgPlaceholder();
  }

  async function refreshCalendarStatus() {
    const yy = calDate.getFullYear();
    const mm = calDate.getMonth() + 1;
    const data = await api(`/api/community/calendar-status?year=${yy}&month=${mm}`);
    mergeCommunityCalendarPayload(data);
    paintCalendar();
  }

  async function boot() {
    $('userChip').textContent = `用户：${auth?.user?.username || authUserId()}`;
    AppNav.mountAppShell('main', 'community');

    $('calPrev').onclick = () => {
      calDate = new Date(calDate.getFullYear(), calDate.getMonth() - 1, 1);
      void refreshCalendarStatus();
    };
    $('calNext').onclick = () => {
      calDate = new Date(calDate.getFullYear(), calDate.getMonth() + 1, 1);
      void refreshCalendarStatus();
    };
    $('calToday').onclick = () => {
      calDate = new Date();
      selectedDate = fmtDate(new Date());
      void refreshCalendarStatus();
    };
    $('btnCommunityCalRefresh').onclick = () => void refreshCalendarStatus().then(() => showAlert('打卡状态已更新'));
    $('btnCommunityMsgRefresh').onclick = () => void loadCommunityMessages();
    $('btnCommunityMsgSend').onclick = async () => {
      const text = String($('communityMsgInput').value || '').trim();
      if (!text) {
        showAlert('请输入留言内容');
        return;
      }
      try {
        await api('/api/community/messages', { method: 'POST', body: { content: text } });
        $('communityMsgInput').value = '';
        await loadCommunityMessages();
      } catch (e) {
        showAlert(e.message || '发送失败');
      }
    };

    await Promise.all([loadCommunityMessages(), refreshCalendarStatus()]);
  }

  boot().catch((e) => {
    console.error(e);
    showAlert(e.message || '加载失败');
  });
})();
