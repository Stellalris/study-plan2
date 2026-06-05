/**
 * mindmap.html 启动脚本：按需加载 simple-mind-map + PlanMindMap
 */
(function () {
  'use strict';

  const PS = window.PlanSupabase;
  if (!PS.requireAuth()) return;
  const auth = PS.getAuth();
  const { sbRequest } = PS;
  const nativeAlert = window.alert.bind(window);
  const nativeConfirm = window.confirm.bind(window);

  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  function showAlert(msg, face) {
    const faces = { success: '(ﾉ>ω<)ﾉ', invalid: '(´-ω-｀)', warning: 'Σ(っ °Д °;)っ' };
    nativeAlert(`${faces[face] || faces.warning} ${String(msg ?? '')}`);
  }

  function formatApiError(e, fallback) {
    return e instanceof Error ? e.message : fallback || String(e);
  }

  function normPriority(v) {
    const n = Number(v);
    return n === 2 || n === 0 ? n : 1;
  }

  function normalizeSqlDateKey(v) {
    const s = String(v ?? '').trim();
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : '';
  }

  function fmtDate(d) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
  }

  function formatDateZh(key) {
    const [y, mo, d] = String(key || '').split('-').map(Number);
    if (!y) return key;
    return `${y}年${mo}月${d}日`;
  }

  function mapTaskRow(r) {
    return {
      id: String(r.id),
      title: r.title,
      date: normalizeSqlDateKey(r.date) || r.date,
      sortOrder: Number(r.sort_order) || 0,
      priority: normPriority(r.priority),
      duration: Number(r.duration) || 45,
      category: r.category || '其他',
      completed: !!r.completed,
      courseCheckRef: r.course_check_ref || null,
    };
  }

  function taskPayloadToDb(body) {
    const patch = {};
    if (body.title != null) patch.title = String(body.title).trim().slice(0, 120);
    if (body.date != null) patch.date = String(body.date).slice(0, 10);
    if (body.duration != null) patch.duration = Number(body.duration) || 45;
    if (body.category != null) patch.category = String(body.category).slice(0, 40);
    if (body.priority != null) patch.priority = normPriority(body.priority);
    if (body.completed != null) patch.completed = !!body.completed;
    if (body.sortOrder != null) patch.sort_order = Number(body.sortOrder) || 0;
    return patch;
  }

  let tasks = [];
  let studyMilestones = [];
  let studyGoalProfile = {};
  let selectedDate = fmtDate(new Date());
  let MM = null;

  const milestoneSortFn = (a, b) =>
    (Number(a.sortOrder) - Number(b.sortOrder)) ||
    String(a.milestoneDate).localeCompare(String(b.milestoneDate)) ||
    String(a.id).localeCompare(String(b.id));

  function authUserId() {
    return PS.authUserId();
  }

  async function api(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    let body = null;
    if (options.body != null && options.body !== '') {
      body = typeof options.body === 'object' ? options.body : JSON.parse(String(options.body));
    }
    const uid = authUserId();
    if (!uid) throw new Error('登录已失效');
    const [pathname, rawQs] = path.includes('?') ? path.split('?') : [path, ''];
    const pathOnly = pathname;

    if (pathOnly === '/api/task-mind-map' && method === 'GET') {
      if (!MM) throw new Error('导图模块未就绪');
      return MM.handleApiGet(sbRequest);
    }
    if (pathOnly === '/api/task-mind-map' && method === 'POST') {
      if (!MM) throw new Error('导图模块未就绪');
      return MM.handleApiPost(body, uid, sbRequest);
    }

    if (pathOnly === '/api/tasks' && method === 'GET') {
      const rows = await sbRequest(
        '/tasks?select=id,title,date,sort_order,priority,duration,category,completed,course_check_ref&order=date.asc,priority.desc,sort_order.asc,id.asc'
      );
      return (Array.isArray(rows) ? rows : []).map(mapTaskRow);
    }
    if (pathOnly === '/api/tasks' && method === 'POST') {
      const row = {
        user_id: uid,
        title: body.title,
        date: body.date,
        sort_order: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
        priority: normPriority(body.priority),
        duration: Number(body.duration) || 45,
        category: body.category || '其他',
        completed: !!body.completed,
        course_check_ref: body.courseCheckRef || null,
      };
      const ins = await sbRequest('/tasks', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify([row]),
      });
      const r = Array.isArray(ins) ? ins[0] : ins;
      return { id: String(r.id) };
    }
    if (pathOnly.startsWith('/api/tasks/') && method === 'PUT') {
      const taskId = pathOnly.split('/').pop();
      await sbRequest(`/tasks?id=eq.${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(taskPayloadToDb(body)),
      });
      return { ok: true };
    }

    if (pathOnly === '/api/study-goal-profile' && method === 'GET') {
      const rows = await sbRequest('/study_goal_profile');
      const r = Array.isArray(rows) && rows[0];
      if (!r) {
        return {
          semesterTitle: '',
          semesterStart: '',
          semesterEnd: '',
          goalText: '',
          semester2Title: '',
          semester2Start: '',
          semester2End: '',
          goal2Text: '',
          examTitle: '',
          examDate: '',
        };
      }
      return {
        semesterTitle: String(r.semester_title || ''),
        semesterStart: normalizeSqlDateKey(r.semester_start) || '',
        semesterEnd: normalizeSqlDateKey(r.semester_end) || '',
        goalText: String(r.goal_text || ''),
        semester2Title: String(r.semester2_title ?? ''),
        semester2Start: normalizeSqlDateKey(r.semester2_start) || '',
        semester2End: normalizeSqlDateKey(r.semester2_end) || '',
        goal2Text: String(r.goal2_text ?? ''),
        examTitle: String(r.exam_title || ''),
        examDate: normalizeSqlDateKey(r.exam_date) || '',
      };
    }

    if (pathOnly === '/api/study-milestones' && method === 'GET') {
      const rows = await sbRequest(
        '/study_milestones?select=id,title,milestone_date,sort_order,completed,notes,is_countdown,is_semester_goal,semester_goal_slot'
      );
      return (Array.isArray(rows) ? rows : []).map((x) => ({
        id: String(x.id),
        title: String(x.title || ''),
        milestoneDate: normalizeSqlDateKey(x.milestone_date) || x.milestone_date,
        sortOrder: Number(x.sort_order) || 0,
        completed: !!x.completed,
        notes: String(x.notes || ''),
        isCountdown: Number(x.is_countdown) === 1,
        isSemesterGoal: Number(x.is_semester_goal) === 1,
        semesterGoalSlot: Number(x.semester_goal_slot) === 1 ? 1 : 0,
      }));
    }
    if (pathOnly.startsWith('/api/study-milestones/') && method === 'PUT') {
      const id = pathOnly.split('/').pop();
      const patch = {};
      if (body.completed != null) patch.completed = !!body.completed;
      if (body.title != null) patch.title = String(body.title).trim().slice(0, 200);
      await sbRequest(`/study_milestones?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(patch),
      });
      return { ok: true };
    }

    throw new Error(`未知 API：${path}`);
  }

  async function createTask(payload) {
    const data = await api('/api/tasks', { method: 'POST', body: payload });
    return String(data.id);
  }

  async function updateTask(task) {
    await api(`/api/tasks/${task.id}`, { method: 'PUT', body: task });
    const idx = tasks.findIndex((t) => String(t.id) === String(task.id));
    if (idx >= 0) tasks[idx] = { ...tasks[idx], ...task };
  }

  function syncUI() {
    MM?.refreshLinkTray?.();
    MM?.syncFromTasks?.();
  }

  function renderMilestoneList() {
    MM?.refreshLinkTray?.();
  }

  function openModal(task) {
    if (!task || task.courseCheckRef) return;
    $('modalBackdrop').classList.remove('hidden');
    $('modalBackdrop').classList.add('flex');
    requestAnimationFrame(() => {
      $('modalBackdrop').classList.remove('opacity-0');
      $('modalPanel').classList.remove('scale-95');
    });
    $('modalTitle').textContent = '编辑任务';
    $('taskId').value = task.id;
    $('taskTitle').value = task.title;
    $('taskDate').value = task.date;
    $('taskDuration').value = task.duration;
    $('taskCategory').value = task.category || '其他';
    $('taskPriority').value = String(normPriority(task.priority));
    $('taskCompleted').checked = !!task.completed;
    $('taskTitle').focus();
  }

  function closeModal() {
    $('modalBackdrop').classList.add('opacity-0');
    $('modalPanel').classList.add('scale-95');
    setTimeout(() => {
      $('modalBackdrop').classList.add('hidden');
      $('modalBackdrop').classList.remove('flex');
    }, 240);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`加载失败: ${src}`));
      document.head.appendChild(s);
    });
  }

  function loadStylesheet(href) {
    return new Promise((resolve, reject) => {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = href;
      l.crossOrigin = 'anonymous';
      l.onload = () => resolve();
      l.onerror = () => reject(new Error(`样式加载失败: ${href}`));
      document.head.appendChild(l);
    });
  }

  async function loadMindMapLibrary() {
    const ver = '0.14.0-fix.2';
    const base = `https://cdn.jsdelivr.net/npm/simple-mind-map@${ver}/dist`;
    await loadStylesheet(`${base}/simpleMindMap.esm.min.css`);
    await loadScript(`${base}/simpleMindMap.umd.min.js`);
    if (!window.simpleMindMap && !window.SimpleMindMap) {
      throw new Error('simple-mind-map 未正确加载');
    }
  }

  async function boot() {
    const chip = $('userChip');
    if (chip) {
      chip.textContent = `用户：${auth?.user?.username || authUserId()}`;
    }
    AppNav.mountAppShell('main', 'mindmap');

    await loadMindMapLibrary();
    await new Promise((r) => {
      const s = document.createElement('script');
      s.src = 'js/plan-mindmap.js';
      s.onload = r;
      s.onerror = () => {
        throw new Error('plan-mindmap.js 加载失败');
      };
      document.body.appendChild(s);
    });

    [tasks, studyMilestones, studyGoalProfile] = await Promise.all([
      api('/api/tasks'),
      api('/api/study-milestones'),
      api('/api/study-goal-profile'),
    ]);

    MM = PlanMindMap.create({
      $,
      esc,
      showAlert,
      nativeConfirm,
      api,
      fmtDate,
      formatDateZh,
      normPriority,
      formatApiError,
      syncUI,
      getTasks: () => tasks,
      getStudyMilestones: () => studyMilestones,
      getStudyGoalProfile: () => studyGoalProfile,
      getStudyGoalPanelView: () => 'mindmap',
      getSelectedDate: () => selectedDate,
      createTask,
      updateTask,
      openModal,
      renderMilestoneList,
      getMilestoneSortFn: () => milestoneSortFn,
    });

    MM.bindToolbar();
    MM.bindCanvasMenu();
    await MM.loadData();
    MM.activatePanel();
    window.addEventListener('resize', () => MM.onResize());

    $('modalClose').onclick = closeModal;
    $('modalCancel').onclick = closeModal;
    $('taskForm').onsubmit = async (e) => {
      e.preventDefault();
      const id = $('taskId').value;
      const task = {
        id,
        title: String($('taskTitle').value || '').trim(),
        date: $('taskDate').value,
        duration: Number($('taskDuration').value) || 45,
        category: $('taskCategory').value,
        priority: normPriority($('taskPriority').value),
        completed: !!$('taskCompleted').checked,
      };
      if (!task.title) {
        showAlert('标题不能为空', 'invalid');
        return;
      }
      try {
        await updateTask(task);
        closeModal();
        syncUI();
        showAlert('任务已保存', 'success');
      } catch (err) {
        showAlert(formatApiError(err, '保存失败'));
      }
    };

    $('pageInitLock')?.classList.add('hidden');
  }

  boot().catch((e) => {
    console.error(e);
    showAlert(e.message || '加载失败');
    $('pageInitLock')?.classList.add('hidden');
  });
})();
