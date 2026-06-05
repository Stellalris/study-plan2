/**
 * plan-mindmap.js — 思维导图 v3（从 plan.html 拆出）
 * 依赖：PlanUtil、simple-mind-map（UMD）、PlanApp 注入 deps
 */
(function (global) {
  'use strict';

  function createPlanMindMap(deps) {
    const $ = deps.$;
    const esc = deps.esc;
    const showAlert = deps.showAlert;
    const nativeConfirm = deps.nativeConfirm;
    const api = deps.api;
    const fmtDate = deps.fmtDate;
    const getTasks = deps.getTasks;
    const getStudyMilestones = deps.getStudyMilestones;
    const getStudyGoalProfile = deps.getStudyGoalProfile;
    const getStudyGoalPanelView = deps.getStudyGoalPanelView;
    const createTask = deps.createTask;
    const getSelectedDate = deps.getSelectedDate;
    const formatApiError = deps.formatApiError;
    const formatDateZh = deps.formatDateZh;
    const normPriority = deps.normPriority;
    const syncUI = deps.syncUI;
    const updateTask = deps.updateTask;
    const openModal = deps.openModal;
    const renderMilestoneList = deps.renderMilestoneList;
    const getMilestoneSortFn = deps.getMilestoneSortFn;

    let mindMapInstance = null;
    let mindMapPreviewInstance = null;
    let mindMapStageExpanded = false;
    let mindMapLoaded = false;
    const MAX_MIND_MAPS = 2;
    /** @type {{ version: 3, activeId: string|null, maps: Array<{id:string,layout:string,title:string,tree:object,createdAt?:string}> } | null} */
    let mindMapStore = null;
    let mindMapSaving = false;
    let mindMapDirtyByMapId = {};
    let mindMapEditingByMapId = {};
    let mindMapEverSyncedByMapId = {};
    let mindMapServerUpdatedAt = null;
    let mindMapServerSignatures = {};
    let mindMapViewTransforms = {};
    const MIND_MAP_LAYOUTS = {
      logical: { layout: 'logicalStructure', theme: 'classic', label: '逻辑图' },
      radial: { layout: 'mindMap', theme: 'classic', label: '放射图' },
    };

    function getMindMapLayoutConfig(key) {
      return MIND_MAP_LAYOUTS[key] || MIND_MAP_LAYOUTS.logical;
    }

    function genMindMapId() {
      return `mm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function escMindMapText(s) {
      return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');
    }

    let mindMapLinkSyncSilent = false;
    let mindMapExportedTaskIds = new Set();
    let mindMapColorMenuNode = null;
    let mindMapLongPressTimer = null;

    const MIND_MAP_FILL_COLOR_PRESETS = [
      { label: '默认', value: '' },
      { label: '红', value: '#fecaca' },
      { label: '橙', value: '#fed7aa' },
      { label: '黄', value: '#fef08a' },
      { label: '绿', value: '#bbf7d0' },
      { label: '青', value: '#99f6e4' },
      { label: '蓝', value: '#bfdbfe' },
      { label: '紫', value: '#ddd6fe' },
      { label: '粉', value: '#fbcfe8' },
      { label: '灰', value: '#e2e8f0' },
    ];
    const MIND_MAP_STROKE_COLOR_PRESETS = [
      { label: '默认', value: '' },
      { label: '红', value: '#ef4444' },
      { label: '橙', value: '#f97316' },
      { label: '黄', value: '#eab308' },
      { label: '绿', value: '#22c55e' },
      { label: '青', value: '#14b8a6' },
      { label: '蓝', value: '#3b82f6' },
      { label: '紫', value: '#8b5cf6' },
      { label: '粉', value: '#ec4899' },
      { label: '灰', value: '#64748b' },
    ];

    function getMindMapThemeConfig() {
      return {
        lineStyle: 'straight',
        lineWidth: 2,
        lineColor: '#14b8a6',
        second: { marginX: 36, marginY: 20 },
        node: { marginX: 28, marginY: 14 },
      };
    }

    function getMindMapCtor() {
      const sm = window.simpleMindMap;
      if (!sm) return null;
      return typeof sm === 'function' ? sm : (sm.default || sm);
    }

    function buildMindMapCtorOptions(el, data, { layoutKey = 'logical', editable = true } = {}) {
      const cfg = getMindMapLayoutConfig(layoutKey);
      return {
        el,
        data: normalizeMindMapPayload(data) || defaultMindMapData(),
        layout: cfg.layout,
        theme: cfg.theme,
        themeConfig: getMindMapThemeConfig(),
        editable,
        readonly: !editable,
        mousewheelAction: 'zoom',
        enableFreeDrag: editable,
        isUseCustomNodeContent: false,
      };
    }

    function updateMindMapCurrentTitleUi() {
      const el = $('mindMapCurrentTitle');
      const entry = getActiveMindMapEntry();
      if (el) {
        if (!entry) el.textContent = '未创建思维导图';
        else el.textContent = `${entry.title}（${getMindMapLayoutConfig(entry.layout).label}）`;
      }
      updateMindMapEmptyHint();
    }

    function updateMindMapEmptyHint() {
      const entry = getActiveMindMapEntry();
      const hasMaps = (mindMapStore?.maps?.length || 0) > 0;
      $('mindMapEmptyHint')?.classList.toggle('hidden', !!entry);
      $('mindMapEmptyHint')?.classList.toggle('pointer-events-none', !!entry);
      $('mindMapContainer')?.classList.toggle('opacity-0', !entry);
      $('mindMapToolbarMain')?.classList.toggle('opacity-50', !hasMaps && !entry);
      $('mindMapContextBar')?.classList.toggle('hidden', !entry);
    }

    function resizeMindMapInstance(inst, { fit = false } = {}) {
      if (!inst) return;
      requestAnimationFrame(() => {
        try {
          inst.resize();
          if (fit) inst.view?.fit();
        } catch (_) {}
      });
    }

    function refitMindMapInstance(inst) {
      resizeMindMapInstance(inst, { fit: true });
    }

    /** 布局稳定后多次适应画布，避免侧栏/首屏尺寸未就绪 */
    function scheduleMindMapFitView() {
      const run = () => {
        if (!mindMapInstance) return;
        const entry = getActiveMindMapEntry();
        if (entry?.id && mindMapViewTransforms[entry.id]) return;
        refitMindMapInstance(mindMapInstance);
      };
      requestAnimationFrame(() => requestAnimationFrame(run));
      setTimeout(run, 120);
      setTimeout(run, 400);
    }

    function captureMindMapViewTransform(inst) {
      try {
        return inst?.view?.getTransformData?.() ?? null;
      } catch (_) {
        return null;
      }
    }

    function restoreMindMapViewTransform(inst, transformData) {
      if (!inst?.view?.setTransformData || !transformData) return;
      try {
        inst.view.setTransformData(transformData);
      } catch (_) {}
    }

    function destroyMindMapInstance() {
      if (!mindMapInstance) return;
      try {
        stashActiveMindMapTree();
        if (typeof mindMapInstance.destroy === 'function') mindMapInstance.destroy();
      } catch (_) {}
      mindMapInstance = null;
      const el = $('mindMapContainer');
      if (el) el.innerHTML = '';
    }

    function bindMindMapInstanceEvents(inst) {
      if (!inst || inst._eventsBound) return;
      inst._eventsBound = true;
      inst.on('data_change', () => {
        stashActiveMindMapTree();
        scheduleMindMapSave();
      });
      inst.on('back_forward', (index, len) => {
        updateMindMapHistoryButtons(index, len);
      });
      inst.on('node_active', (_node, activeList) => {
        const hasActive = Array.isArray(activeList) && activeList.length > 0;
        const delBtn = $('mindMapDelete');
        const childBtn = $('mindMapAddChild');
        const sibBtn = $('mindMapAddSibling');
        if (delBtn) delBtn.disabled = !hasActive;
        if (childBtn) childBtn.disabled = !hasActive;
        if (sibBtn) sibBtn.disabled = !hasActive;
        updateMindMapActiveLinkUi();
      });
      inst.on('node_contextmenu', (e, node) => {
        if (e?.preventDefault) e.preventDefault();
        if (e?.stopPropagation) e.stopPropagation();
        showMindMapColorMenu(e, node);
      });
      inst.on('node_click', () => {
        hideMindMapColorMenu();
        hideMindMapToolbarMenus();
      });
      inst.on('draw_click', () => {
        hideMindMapColorMenu();
        hideMindMapToolbarMenus();
      });
    }

    function remountActiveMindMap() {
      const entry = getActiveMindMapEntry();
      updateMindMapCurrentTitleUi();
      if (!entry) {
        destroyMindMapInstance();
        return null;
      }
      const MindMapCtor = getMindMapCtor();
      const el = $('mindMapContainer');
      if (!MindMapCtor || !el) return null;
      const prevId = mindMapInstance?._mindMapMapId;
      const prevLayout = mindMapInstance?._mindMapLayoutKey;
      const needRecreate = !mindMapInstance || prevLayout !== entry.layout;
      if (mindMapInstance && prevId) {
        mindMapViewTransforms[prevId] = captureMindMapViewTransform(mindMapInstance);
      }
      if (needRecreate) {
        destroyMindMapInstance();
        mindMapInstance = new MindMapCtor(
          buildMindMapCtorOptions(el, entry.tree, { layoutKey: entry.layout, editable: true })
        );
        mindMapInstance._mindMapLayoutKey = entry.layout;
        mindMapInstance._mindMapMapId = entry.id;
        bindMindMapInstanceEvents(mindMapInstance);
        bindMindMapLinkDropZone();
        bindMindMapColorMenu();
        updateMindMapHistoryButtons(0, 1);
      } else {
        hideMindMapColorMenu();
        mindMapInstance.setData(entry.tree);
        mindMapInstance._mindMapMapId = entry.id;
      }
      applyMindMapEditMode();
      refitMindMapInstance(mindMapInstance);
      renderMindMapLinkTray();
      refreshMindMapLinkVisuals();
      rebuildMindMapExportedTaskIds();
      requestAnimationFrame(() => {
        try {
          restoreMindMapViewTransform(mindMapInstance, mindMapViewTransforms[entry.id]);
        } catch (_) {}
      });
      return mindMapInstance;
    }

    function parseMindMapJsonField(raw) {
      if (raw == null) return null;
      if (typeof raw === 'string') {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }
      return typeof raw === 'object' ? raw : null;
    }

    function normalizeMindMapTreePayload(raw) {
      const obj = parseMindMapJsonField(raw);
      if (!obj || typeof obj !== 'object') return null;
      if (obj.root && typeof obj.root === 'object') return obj.root;
      if (obj.data && typeof obj.data === 'object') return obj;
      return null;
    }

    function buildV2BundleFromApiRow(r) {
      const fallback = { data: { text: '学习计划' }, children: [] };
      const logical = normalizeMindMapTreePayload(r?.map_data_logical);
      const radial = normalizeMindMapTreePayload(r?.map_data_radial);
      if (logical || radial) {
        return {
          version: 2,
          logical: logical || fallback,
          radial: radial || fallback,
        };
      }
      const legacy = parseMindMapJsonField(r?.map_data);
      if (!legacy || typeof legacy !== 'object') {
        return { version: 2, logical: fallback, radial: { ...fallback, children: [] } };
      }
      if (legacy.version === 2 && (legacy.logical || legacy.radial)) {
        return {
          version: 2,
          logical: normalizeMindMapTreePayload(legacy.logical) || fallback,
          radial: normalizeMindMapTreePayload(legacy.radial) || fallback,
        };
      }
      const single = normalizeMindMapTreePayload(legacy);
      if (single) {
        const cloned = JSON.parse(JSON.stringify(single));
        return { version: 2, logical: cloned, radial: JSON.parse(JSON.stringify(single)) };
      }
      return { version: 2, logical: fallback, radial: fallback };
    }

    function normalizeMapEntry(m) {
      if (!m || typeof m !== 'object') return null;
      const layout = m.layout === 'radial' ? 'radial' : 'logical';
      const tree = normalizeMindMapPayload(m.tree) || defaultMindMapData();
      return {
        id: String(m.id || genMindMapId()),
        layout,
        title: String(m.title || getMindMapLayoutConfig(layout).label).slice(0, 40),
        tree: cloneMindMapTree(tree),
        createdAt: m.createdAt ? String(m.createdAt) : null,
      };
    }

    function defaultMindMapStore() {
      return { version: 3, activeId: null, maps: [] };
    }

    function migrateV2BundleToStore(bundle) {
      const maps = [];
      const pushIf = (layout, tree, title) => {
        if (!tree || maps.length >= MAX_MIND_MAPS) return;
        maps.push(makeMindMapEntry(layout, tree, title));
      };
      if (bundle?.logical) pushIf('logical', bundle.logical, '逻辑图');
      if (bundle?.radial && maps.length < MAX_MIND_MAPS) {
        const sigL = mindMapTreeSignature(bundle.logical);
        const sigR = mindMapTreeSignature(bundle.radial);
        if (!sigL || sigR !== sigL) pushIf('radial', bundle.radial, '放射图');
      }
      return {
        version: 3,
        activeId: maps[0]?.id || null,
        maps,
      };
    }

    function normalizeMindMapStore(raw, apiRow) {
      if (raw && typeof raw === 'object' && raw.version === 3 && Array.isArray(raw.maps)) {
        const maps = raw.maps.map(normalizeMapEntry).filter(Boolean).slice(0, MAX_MIND_MAPS);
        const activeId =
          raw.activeId && maps.some((m) => m.id === raw.activeId) ? raw.activeId : maps[0]?.id || null;
        return { version: 3, activeId, maps };
      }
      const bundle =
        raw && typeof raw === 'object' && raw.version === 2
          ? raw
          : apiRow
            ? buildV2BundleFromApiRow(apiRow)
            : null;
      if (bundle) return migrateV2BundleToStore(bundle);
      const single = normalizeMindMapPayload(raw);
      if (single) {
        const entry = makeMindMapEntry('logical', single);
        return { version: 3, activeId: entry.id, maps: [entry] };
      }
      if (apiRow) return migrateV2BundleToStore(buildV2BundleFromApiRow(apiRow));
      return defaultMindMapStore();
    }

    function buildMindMapStoreFromApiRow(r) {
      const legacy = parseMindMapJsonField(r?.map_data);
      if (legacy?.version === 3) return normalizeMindMapStore(legacy);
      return normalizeMindMapStore(null, r);
    }

    function mindMapTreeSignature(tree) {
      if (!tree || typeof tree !== 'object') return '';
      try {
        return JSON.stringify(tree);
      } catch {
        return '';
      }
    }

    /** 对比云端与上次同步时的各图签名，返回发生冲突的 mapId 列表 */
    function detectMindMapStoreConflicts(serverStore, expectedMapSignatures) {
      const expected =
        expectedMapSignatures && typeof expectedMapSignatures === 'object' ? expectedMapSignatures : {};
      const conflictIds = [];
      const serverMaps = serverStore?.maps || [];
      for (const sm of serverMaps) {
        const serverSig = mindMapTreeSignature(sm.tree);
        const exp = expected[sm.id];
        if (exp === undefined || exp !== serverSig) conflictIds.push(sm.id);
      }
      for (const id of Object.keys(expected)) {
        if (!serverMaps.some((m) => m.id === id)) conflictIds.push(id);
      }
      return [...new Set(conflictIds)];
    }

    /** v3 库同步到 dual 列，避免旧列与 map_data 长期不一致（取各 layout 的第一张） */
    function v3StoreToLegacyDualColumns(store) {
      const maps = store?.maps || [];
      const firstLogical = maps.find((m) => m.layout === 'logical');
      const firstRadial = maps.find((m) => m.layout === 'radial');
      return {
        map_data_logical: firstLogical?.tree ?? null,
        map_data_radial: firstRadial?.tree ?? null,
      };
    }

    function cloneMindMapStoreEntry(entry) {
      if (!entry) return null;
      return {
        id: entry.id,
        layout: entry.layout === 'radial' ? 'radial' : 'logical',
        title: entry.title,
        tree: cloneMindMapTree(entry.tree),
        createdAt: entry.createdAt || null,
      };
    }

    /** 409 后合并：冲突图用云端，其它本地 dirty 图保留 */
    function mergeMindMapStoreAfterServerConflict(localStore, serverStore, { dirtyByMapId, conflictMapIds, activeId }) {
      const merged = normalizeMindMapStore(JSON.parse(JSON.stringify(serverStore)));
      const conflictSet = new Set(conflictMapIds || []);
      const nextDirty = {};

      for (const lm of localStore?.maps || []) {
        const wasDirty = !!dirtyByMapId[lm.id];
        const onServer = merged.maps.find((m) => m.id === lm.id);

        if (!onServer) {
          if (merged.maps.length < MAX_MIND_MAPS) {
            const cloned = cloneMindMapStoreEntry(lm);
            if (cloned) {
              merged.maps.push(cloned);
              if (wasDirty) nextDirty[cloned.id] = true;
            }
          }
          continue;
        }

        if (wasDirty && !conflictSet.has(lm.id)) {
          onServer.tree = cloneMindMapTree(lm.tree);
          onServer.title = lm.title;
          nextDirty[lm.id] = true;
        }
      }

      if (activeId && merged.maps.some((m) => m.id === activeId)) merged.activeId = activeId;
      else merged.activeId = merged.maps[0]?.id || null;

      return { store: merged, dirtyByMapId: nextDirty };
    }

    function defaultMindMapData() {
      return {
        data: { text: '学习计划' },
        children: [],
      };
    }

    function cloneMindMapTree(node) {
      if (!node || typeof node !== 'object') return defaultMindMapData();
      const out = { data: { ...(node.data || {}) } };
      out.children = Array.isArray(node.children) ? node.children.map(cloneMindMapTree) : [];
      return out;
    }

    function makeMindMapEntry(layout, tree, title) {
      const lay = layout === 'radial' ? 'radial' : 'logical';
      const maps = mindMapStore?.maps || [];
      const sameLayoutCount = maps.filter((m) => m.layout === lay).length;
      const defaultTitle =
        title ||
        `${getMindMapLayoutConfig(lay).label}${sameLayoutCount > 0 ? ` ${sameLayoutCount + 1}` : ''}`;
      return {
        id: genMindMapId(),
        layout: lay,
        title: String(defaultTitle).slice(0, 40),
        tree: cloneMindMapTree(tree || defaultMindMapData()),
        createdAt: new Date().toISOString(),
      };
    }

    function ensureMindMapStore() {
      if (!mindMapStore) mindMapStore = defaultMindMapStore();
      return mindMapStore;
    }

    function getActiveMindMapId() {
      const store = ensureMindMapStore();
      if (store.activeId && store.maps.some((m) => m.id === store.activeId)) return store.activeId;
      return store.maps[0]?.id || null;
    }

    function getActiveMindMapEntry() {
      const id = getActiveMindMapId();
      if (!id) return null;
      return ensureMindMapStore().maps.find((m) => m.id === id) || null;
    }

    function normalizeMindMapPayload(raw) {
      if (!raw || typeof raw !== 'object') return null;
      if (raw.root && typeof raw.root === 'object') {
        return raw.root;
      }
      if (raw.data && typeof raw.data === 'object') {
        return raw;
      }
      return null;
    }

    function getActiveMindMapTree() {
      const entry = getActiveMindMapEntry();
      return entry?.tree || defaultMindMapData();
    }

    function stashActiveMindMapTree() {
      const entry = getActiveMindMapEntry();
      if (!entry || !mindMapInstance) return;
      try {
        entry.tree = mindMapInstance.getData(true);
      } catch (_) {}
    }

    function isActiveMindMapEditing() {
      const id = getActiveMindMapId();
      if (!id) return true;
      return mindMapEditingByMapId[id] !== false;
    }

    function canExportMindMapToTasks() {
      const id = getActiveMindMapId();
      return (
        !!id &&
        isActiveMindMapPreview() &&
        !isActiveMindMapDirty() &&
        !!mindMapEverSyncedByMapId[id]
      );
    }

    function isActiveMindMapPreview() {
      return !isActiveMindMapEditing();
    }

    function initMindMapModesFresh() {
      mindMapEverSyncedByMapId = {};
      mindMapEditingByMapId = {};
    }

    function initMindMapModesFromServer(store) {
      mindMapEverSyncedByMapId = {};
      mindMapEditingByMapId = {};
      (store?.maps || []).forEach((m) => {
        mindMapEverSyncedByMapId[m.id] = true;
        mindMapEditingByMapId[m.id] = false;
      });
    }

    function hideMindMapCanvasMenu() {
      $('mindMapCanvasMenu')?.classList.add('hidden');
    }

    function renderMindMapCanvasMenuItems() {
      const menu = $('mindMapCanvasMenu');
      if (!menu) return;
      const store = ensureMindMapStore();
      const parts = [];
      store.maps.forEach((m) => {
        if (m.id === store.activeId) return;
        parts.push(
          `<button type="button" class="mindmap-toolbar-menu-item w-full text-left" data-mm-action="open" data-mm-id="${escMindMapText(m.id)}">打开 · ${escMindMapText(m.title)}（${escMindMapText(getMindMapLayoutConfig(m.layout).label)}）</button>`
        );
      });
      if (store.maps.length < MAX_MIND_MAPS) {
        if (parts.length) parts.push('<div class="my-1 border-t border-slate-100"></div>');
        parts.push(
          '<button type="button" class="mindmap-toolbar-menu-item w-full text-left" data-mm-action="new" data-mm-layout="logical">新建逻辑图</button>'
        );
        parts.push(
          '<button type="button" class="mindmap-toolbar-menu-item w-full text-left" data-mm-action="new" data-mm-layout="radial">新建放射图</button>'
        );
      }
      if (!parts.length) {
        parts.push('<p class="px-2 py-1.5 text-[10px] text-slate-400">最多 2 张，类型不限</p>');
        parts.push(
          '<button type="button" class="mindmap-toolbar-menu-item w-full text-left" data-mm-action="new" data-mm-layout="logical">新建逻辑图</button>'
        );
        parts.push(
          '<button type="button" class="mindmap-toolbar-menu-item w-full text-left" data-mm-action="new" data-mm-layout="radial">新建放射图</button>'
        );
      }
      menu.innerHTML = parts.join('');
    }

    function showMindMapCanvasMenu(e) {
      renderMindMapCanvasMenuItems();
      const menu = $('mindMapCanvasMenu');
      if (!menu) return;
      hideMindMapToolbarMenus();
      hideMindMapColorMenu();
      menu.classList.remove('hidden');
      const x = e.clientX || 0;
      const y = e.clientY || 0;
      menu.style.left = `${Math.min(x, window.innerWidth - 220)}px`;
      menu.style.top = `${Math.min(y, window.innerHeight - 180)}px`;
    }

    function bindMindMapCanvasMenu() {
      if (document._mindMapCanvasMenuBound) return;
      document._mindMapCanvasMenuBound = true;
      const onContextMenu = (e) => {
        if (e.target.closest?.('#mindMapColorMenu, #mindMapCanvasMenu, .mindmap-toolbar-menu')) return;
        e.preventDefault();
        showMindMapCanvasMenu(e);
      };
      $('mindMapStage')?.addEventListener('contextmenu', onContextMenu);
      $('mindMapEmptyHint')?.addEventListener('contextmenu', onContextMenu);
      $('mindMapMapsMenuBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        showMindMapCanvasMenu({ clientX: rect.left, clientY: rect.bottom + 4 });
      });
      $('mindMapCanvasMenu')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-mm-action]');
        if (!btn) return;
        e.stopPropagation();
        hideMindMapCanvasMenu();
        if (btn.dataset.mmAction === 'open') void switchToMindMapById(btn.dataset.mmId);
        else if (btn.dataset.mmAction === 'new') void createMindMap(btn.dataset.mmLayout);
      });
    }

    async function promptUnsavedMindMapBeforeLeave() {
      if (!isActiveMindMapDirty()) return true;
      const entry = getActiveMindMapEntry();
      const title = entry?.title || '当前思维导图';
      const ok = nativeConfirm(
        `「${title}」有未保存的修改。\n\n确定 = 先保存到云端再切换\n取消 = 留在当前导图`
      );
      if (!ok) return false;
      const saved = await saveTaskMindMap();
      return saved || !isActiveMindMapDirty();
    }

    async function createMindMap(layout) {
      const store = ensureMindMapStore();
      if (store.maps.length >= MAX_MIND_MAPS) {
        showAlert('最多只能创建 2 张思维导图。', 'warning');
        return;
      }
      if (!(await promptUnsavedMindMapBeforeLeave())) return;
      stashActiveMindMapTree();
      const entry = makeMindMapEntry(layout);
      store.maps.push(entry);
      store.activeId = entry.id;
      mindMapEditingByMapId[entry.id] = true;
      mindMapEverSyncedByMapId[entry.id] = false;
      mindMapDirtyByMapId[entry.id] = true;
      remountActiveMindMap();
      updateMindMapSyncStatus('dirty');
    }

    async function switchToMindMapById(mapId) {
      const store = ensureMindMapStore();
      if (!store.maps.some((m) => m.id === mapId) || store.activeId === mapId) return;
      if (!(await promptUnsavedMindMapBeforeLeave())) return;
      stashActiveMindMapTree();
      if (mindMapInstance) {
        mindMapViewTransforms[store.activeId] = captureMindMapViewTransform(mindMapInstance);
      }
      store.activeId = mapId;
      remountActiveMindMap();
      updateMindMapSyncStatus(
        isActiveMindMapDirty() ? 'dirty' : isAnyMindMapDirty() ? 'dirty-other' : 'synced'
      );
    }

    function hideMindMapToolbarMenus() {
      $('mindMapTaskMenu')?.classList.add('hidden');
      $('mindMapMoreMenu')?.classList.add('hidden');
      hideMindMapCanvasMenu();
    }

    function toggleMindMapToolbarMenu(menuId) {
      const menu = $(menuId);
      if (!menu) return;
      const willOpen = menu.classList.contains('hidden');
      hideMindMapToolbarMenus();
      if (willOpen) menu.classList.remove('hidden');
    }

    function bindMindMapToolbarMenus() {
      if (document._mindMapToolbarMenusBound) return;
      document._mindMapToolbarMenusBound = true;
      $('mindMapTaskMenuBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMindMapToolbarMenu('mindMapTaskMenu');
      });
      $('mindMapMoreMenuBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMindMapToolbarMenu('mindMapMoreMenu');
      });
      document.addEventListener('click', () => hideMindMapToolbarMenus());
      $('mindMapToggleTaskDone')?.addEventListener('click', () => hideMindMapToolbarMenus());
      $('mindMapOpenTaskBtn')?.addEventListener('click', () => hideMindMapToolbarMenus());
      $('mindMapUndo')?.addEventListener('click', () => hideMindMapToolbarMenus());
      $('mindMapRedo')?.addEventListener('click', () => hideMindMapToolbarMenus());
    }

    function applyMindMapEditMode() {
      if (!mindMapInstance) return;
      const editing = isActiveMindMapEditing();
      try {
        mindMapInstance.setMode(editing ? 'edit' : 'readonly');
      } catch (e) {
        console.warn('[mindmap] 切换编辑模式失败', e.message || e);
      }
      $('mindMapStage')?.classList.toggle('mind-map-preview-mode', !editing);
      updateMindMapToolbarMode();
    }

    function updateMindMapToolbarMode() {
      const editing = isActiveMindMapEditing();
      const dirty = isActiveMindMapDirty();
      $('mindMapPreviewActions')?.classList.toggle('hidden', editing);
      $('mindMapEditActions')?.classList.toggle('hidden', !editing);
      $('mindMapEditBtn')?.classList.toggle('hidden', editing || dirty);
      $('mindMapSaveBtn')?.classList.toggle('hidden', !editing && !dirty);
      $('mindMapViewModeBadge')?.classList.toggle('hidden', editing);
      $('mindMapLinkTray')?.classList.toggle('opacity-50', !editing);
      $('mindMapLinkTray')?.classList.toggle('pointer-events-none', !editing);
      hideMindMapToolbarMenus();
      updateMindMapActiveLinkUi();
      updateMindMapSaveBtnState();
    }

    function enterMindMapEditMode() {
      const id = getActiveMindMapId();
      if (id) mindMapEditingByMapId[id] = true;
      applyMindMapEditMode();
    }

    function enterMindMapPreviewMode(mapId) {
      const id = mapId || getActiveMindMapId();
      if (id) mindMapEditingByMapId[id] = false;
      if (id === getActiveMindMapId()) applyMindMapEditMode();
      else updateMindMapToolbarMode();
    }

    function captureMindMapServerSignatures(store) {
      mindMapServerSignatures = {};
      (store?.maps || []).forEach((m) => {
        mindMapServerSignatures[m.id] = mindMapTreeSignature(m.tree);
      });
    }

    function isActiveMindMapDirty() {
      const id = getActiveMindMapId();
      return id ? !!mindMapDirtyByMapId[id] : false;
    }

    function isAnyMindMapDirty() {
      return Object.values(mindMapDirtyByMapId).some(Boolean);
    }

    function clearMindMapDirtyFlags() {
      mindMapDirtyByMapId = {};
    }

    async function loadTaskMindMapData() {
      try {
        const res = await api('/api/task-mind-map');
        mindMapServerUpdatedAt = res?.updatedAt || null;
        mindMapStore = normalizeMindMapStore(res?.mapData);
        captureMindMapServerSignatures(mindMapStore);
        if (res?.mapData && mindMapStore.maps.length) initMindMapModesFromServer(mindMapStore);
        else initMindMapModesFresh();
        updateMindMapCurrentTitleUi();
        if (getActiveMindMapEntry()) remountActiveMindMap();
        else destroyMindMapInstance();
        clearMindMapDirtyFlags();
        updateMindMapSyncStatus('synced');
        mindMapLoaded = true;
        return mindMapStore;
      } catch (e) {
        console.warn('[mindmap] 加载失败', e.message || e);
        mindMapLoaded = true;
        return null;
      }
    }

    function updateMindMapSaveBtnState() {
      const btn = $('mindMapSaveBtn');
      if (!btn) return;
      btn.disabled = !isActiveMindMapDirty() || mindMapSaving || !getActiveMindMapEntry();
    }

    function updateMindMapSyncStatus(state) {
      const statusEl = $('mindMapSyncStatus');
      const iconEl = $('mindMapSyncIcon');
      if (!statusEl) return;
      const entry = getActiveMindMapEntry();
      const activeLabel = entry?.title || '思维导图';
      if (state === 'saving') {
        statusEl.textContent = `同步「${activeLabel}」…`;
        if (iconEl) iconEl.className = 'fa-solid fa-spinner fa-spin mr-1 text-brand-500';
      } else if (state === 'dirty') {
        statusEl.textContent = `「${activeLabel}」待同步`;
        if (iconEl) iconEl.className = 'fa-solid fa-cloud-arrow-up mr-1 text-amber-500';
      } else if (state === 'dirty-other') {
        statusEl.textContent = '其它导图待同步';
        if (iconEl) iconEl.className = 'fa-solid fa-cloud-arrow-up mr-1 text-amber-500';
      } else if (state === 'error') {
        statusEl.textContent = '同步失败';
        if (iconEl) iconEl.className = 'fa-solid fa-cloud-exclamation mr-1 text-red-500';
      } else {
        statusEl.textContent = '已同步';
        if (iconEl) iconEl.className = 'fa-solid fa-cloud mr-1 text-emerald-500';
      }
      updateMindMapSaveBtnState();
    }

    function scheduleMindMapSave() {
      if (mindMapLinkSyncSilent) return;
      const id = getActiveMindMapId();
      if (!id) return;
      mindMapDirtyByMapId[id] = true;
      updateMindMapSyncStatus('dirty');
    }

    function formatMindMapConflictLabels(serverStore, conflictMapIds) {
      const ids = Array.isArray(conflictMapIds) ? conflictMapIds : [];
      const maps = serverStore?.maps || [];
      const labels = ids.map((id) => {
        const m = maps.find((x) => x.id === id);
        return m ? `「${m.title}」` : '某张导图';
      });
      return labels.length ? labels.join('、') : '思维导图';
    }

    async function saveTaskMindMap(options = {}) {
      if (mindMapSaving) return false;
      const savingId = getActiveMindMapId();
      if (!savingId) return false;
      mindMapSaving = true;
      updateMindMapSyncStatus('saving');
      stashActiveMindMapTree();
      const localStoreSnapshot = JSON.parse(JSON.stringify(ensureMindMapStore()));
      const dirtySnapshot = { ...mindMapDirtyByMapId };
      try {
        const store = ensureMindMapStore();
        const entry = store.maps.find((m) => m.id === savingId);
        const res = await api('/api/task-mind-map', {
          method: 'POST',
          body: JSON.stringify({
            mapData: store,
            activeMapId: savingId,
            expectedUpdatedAt: options.force ? null : mindMapServerUpdatedAt,
            expectedMapSignatures: { ...mindMapServerSignatures },
            force: !!options.force,
          }),
        });
        mindMapDirtyByMapId[savingId] = false;
        if (entry) mindMapServerSignatures[savingId] = mindMapTreeSignature(entry.tree);
        mindMapEverSyncedByMapId[savingId] = true;
        enterMindMapPreviewMode(savingId);
        mindMapServerUpdatedAt = res?.updatedAt || new Date().toISOString();
        captureMindMapServerSignatures(store);
        updateMindMapSyncStatus(
          isAnyMindMapDirty() ? (isActiveMindMapDirty() ? 'dirty' : 'dirty-other') : 'synced'
        );
        return true;
      } catch (e) {
        if (e.httpStatus === 409 && e.data) {
          updateMindMapSyncStatus('error');
          const remoteAt = e.data.updatedAt
            ? String(e.data.updatedAt).slice(0, 19).replace('T', ' ')
            : '';
          const serverStore = normalizeMindMapStore(e.data.mapData);
          const conflictMapIds = e.data.conflictMapIds || [];
          const conflictLabel = formatMindMapConflictLabels(serverStore, conflictMapIds);
          const overwrite = nativeConfirm(
            `检测到其它设备已更新思维导图（${remoteAt || '较新版本'}）。\n\n冲突：${conflictLabel}\n\n确定 = 用本页全部导图覆盖云端\n取消 = 合并云端版本（冲突图用云端，其它未冲突的本地修改保留）`
          );
          if (overwrite) {
            mindMapServerUpdatedAt = e.data.updatedAt || mindMapServerUpdatedAt;
            mindMapSaving = false;
            return saveTaskMindMap({ force: true });
          }
          stashActiveMindMapTree();
          const merged = mergeMindMapStoreAfterServerConflict(localStoreSnapshot, serverStore, {
            dirtyByMapId: dirtySnapshot,
            conflictMapIds,
            activeId: savingId,
          });
          mindMapStore = merged.store;
          mindMapDirtyByMapId = merged.dirtyByMapId;
          captureMindMapServerSignatures(mindMapStore);
          (mindMapStore.maps || []).forEach((m) => {
            if (!merged.dirtyByMapId[m.id]) {
              mindMapEverSyncedByMapId[m.id] = true;
              mindMapEditingByMapId[m.id] = false;
            } else {
              mindMapEditingByMapId[m.id] = true;
            }
          });
          if (getActiveMindMapEntry()) remountActiveMindMap();
          else destroyMindMapInstance();
          updateMindMapCurrentTitleUi();
          mindMapServerUpdatedAt = e.data.updatedAt || mindMapServerUpdatedAt;
          updateMindMapSyncStatus(
            isAnyMindMapDirty() ? (isActiveMindMapDirty() ? 'dirty' : 'dirty-other') : 'synced'
          );
          const kept = Object.keys(merged.dirtyByMapId).filter((id) => merged.dirtyByMapId[id]);
          showAlert(
            kept.length
              ? `已合并云端版本。${kept.length} 张本地修改仍待保存。`
              : '已加载云端较新版本。',
            kept.length ? 'warning' : 'success'
          );
          return false;
        }
        updateMindMapSyncStatus('error');
        mindMapDirtyByMapId[savingId] = true;
        console.warn('[mindmap] 保存失败', e.message || e);
        return false;
      } finally {
        mindMapSaving = false;
        updateMindMapSaveBtnState();
      }
    }

    function resolveMindMapTaskExport(nodeData) {
      const taskId = String(nodeData?.taskId || '').trim();
      if (!taskId) return null;
      const task = getTasks().find((t) => String(t.id) === taskId);
      if (task) {
        return { taskId, title: task.title, completed: !!task.completed, missing: false, raw: task };
      }
      return { taskId, title: '(任务已删除)', completed: false, missing: true };
    }

    function buildMindMapNodeVisualPatch(nodeData) {
      const d = nodeData && typeof nodeData === 'object' ? nodeData : {};
      const tags = [];
      const linkTarget = resolveMindMapLinkTarget(d);
      const taskExport = resolveMindMapTaskExport(d);
      if (linkTarget) tags.push(buildMindMapLinkTagLabel(linkTarget));
      if (taskExport) tags.push(taskExport.completed ? '✓ 已加入任务' : '📋 已加入任务');

      const userFill = String(d.styleFillColor || '').trim();
      const userBorder = String(d.styleBorderColor || '').trim();
      const userLine = String(d.styleLineColor || '').trim();

      let fillColor = userFill;
      if (!fillColor) {
        if (taskExport?.completed) fillColor = '#d1fae5';
        else if (taskExport) fillColor = '#ecfdf5';
        else if (linkTarget) fillColor = getMindMapLinkFillColor(linkTarget);
      }

      const patch = { tag: tags.length ? tags : [] };
      patch.fillColor = fillColor || '';
      patch.borderColor = userBorder || '';
      patch.lineColor = userLine || '';
      patch.borderWidth = userBorder ? 2 : '';
      return patch;
    }

    function refreshMindMapNodeVisual(node) {
      if (!node || node.isRoot) return;
      const d = node.nodeData?.data || {};
      const visual = buildMindMapNodeVisualPatch(d);
      setMindMapNodeDataPatch(node, visual);
      applyMindMapNodeRenderStyles(node, visual);
    }

    function rebuildMindMapExportedTaskIds() {
      mindMapExportedTaskIds = new Set();
      if (!mindMapInstance?.renderer?.root) return;
      walkMindMapNodeInstances(mindMapInstance.renderer.root, (node) => {
        const id = String(node.nodeData?.data?.taskId || '').trim();
        if (id) mindMapExportedTaskIds.add(id);
      });
    }

    function clearMindMapTaskLinkByTaskId(taskId) {
      if (!mindMapInstance?.renderer?.root || !taskId) return;
      let changed = false;
      walkMindMapNodeInstances(mindMapInstance.renderer.root, (node) => {
        if (String(node.nodeData?.data?.taskId || '') !== String(taskId)) return;
        setMindMapNodeDataPatch(node, { taskId: '', exportedAt: '', ...buildMindMapNodeVisualPatch({ ...node.nodeData?.data, taskId: '' }) });
        changed = true;
      });
      if (changed) scheduleMindMapSave();
      rebuildMindMapExportedTaskIds();
    }

    function syncMindMapFromTasks() {
      if (!mindMapInstance?.renderer?.root) return;
      mindMapLinkSyncSilent = true;
      try {
        walkMindMapNodeInstances(mindMapInstance.renderer.root, (node) => {
          refreshMindMapNodeVisual(node);
        });
        mindMapInstance.render?.();
        rebuildMindMapExportedTaskIds();
      } finally {
        mindMapLinkSyncSilent = false;
      }
    }

    function collectMindMapExportNodes(startNode, { includeChildren = true, skipExported = true } = {}) {
      if (!startNode || startNode.isRoot) return [];
      const list = [];
      const tryAdd = (node, depth) => {
        if (!node || node.isRoot) return;
        const d = node.nodeData?.data || {};
        const text = String(d.text || '').trim();
        if (!text) return;
        const taskId = String(d.taskId || '').trim();
        const hasTask = !!taskId;
        if (skipExported && hasTask) return;
        list.push({ node, text, depth, hasTask, taskId });
      };
      tryAdd(startNode, 0);
      if (includeChildren) {
        const walk = (node, depth) => {
          (node.children || []).forEach((child) => {
            tryAdd(child, depth);
            walk(child, depth + 1);
          });
        };
        walk(startNode, 1);
      }
      return list;
    }

    function renderMindMapExportPreview() {
      const ul = $('mindMapExportPreview');
      if (!ul) return;
      const start = getMindMapActiveNode();
      if (!start) {
        ul.innerHTML = '<li class="text-slate-400">请先选中一个节点</li>';
        return;
      }
      const includeChildren = !!$('mindMapExportIncludeChildren')?.checked;
      const skipExported = !!$('mindMapExportSkipExisting')?.checked;
      const items = collectMindMapExportNodes(start, { includeChildren, skipExported });
      if (!items.length) {
        ul.innerHTML = '<li class="text-amber-700">没有可导出的节点（可能已全部导出）</li>';
        return;
      }
      ul.innerHTML = items
        .map(
          (it) =>
            `<li class="flex items-center gap-2 rounded-md px-2 py-1 ${it.hasTask ? 'bg-amber-50 text-amber-800' : 'bg-slate-50'}"><span class="text-slate-400" style="padding-left:${Math.min(it.depth, 6) * 12}px">${it.depth ? '↳' : '●'}</span><span class="min-w-0 flex-1 truncate">${esc(it.text)}</span>${it.hasTask ? '<span class="shrink-0 text-[10px]">已导出</span>' : ''}</li>`
        )
        .join('');
    }

    function openMindMapExportModal() {
      if (!canExportMindMapToTasks()) {
        showAlert('请先保存思维导图到云端，再在查看模式下加入任务列表。', 'invalid');
        return;
      }
      const start = getMindMapActiveNode();
      if (!start) {
        showAlert('请先选中要导出的节点（根节点不可导出）。', 'invalid');
        return;
      }
      const backdrop = $('mindMapExportBackdrop');
      const panel = $('mindMapExportPanel');
      if (!backdrop) return;
      if ($('mindMapExportDate')) $('mindMapExportDate').value = getSelectedDate() || fmtDate(new Date());
      renderMindMapExportPreview();
      backdrop.classList.remove('hidden');
      backdrop.classList.add('flex');
      requestAnimationFrame(() => {
        backdrop.classList.remove('opacity-0');
        if (panel) panel.classList.remove('scale-[0.98]');
      });
    }

    function closeMindMapExportModal() {
      const backdrop = $('mindMapExportBackdrop');
      const panel = $('mindMapExportPanel');
      if (!backdrop) return;
      backdrop.classList.add('opacity-0');
      if (panel) panel.classList.add('scale-[0.98]');
      setTimeout(() => {
        backdrop.classList.add('hidden');
        backdrop.classList.remove('flex');
      }, 200);
    }

    async function confirmMindMapExportToTasks() {
      const start = getMindMapActiveNode();
      if (!start) {
        showAlert('请先选中节点。', 'invalid');
        return;
      }
      const includeChildren = !!$('mindMapExportIncludeChildren')?.checked;
      const skipExported = !!$('mindMapExportSkipExisting')?.checked;
      const items = collectMindMapExportNodes(start, { includeChildren, skipExported });
      if (!items.length) {
        showAlert('没有可导出的节点。', 'invalid');
        return;
      }
      const dateStr = String($('mindMapExportDate')?.value || getSelectedDate() || fmtDate(new Date())).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        showAlert('请选择合法的任务日期。', 'invalid');
        return;
      }
      const duration = Math.max(5, Math.min(1440, Number($('mindMapExportDuration')?.value) || 45));
      const priority = normPriority($('mindMapExportPriority')?.value ?? 1);
      const category = String($('mindMapExportCategory')?.value || '其他');
      const btn = $('mindMapExportConfirm');
      if (btn) btn.disabled = true;
      let created = 0;
      try {
        for (const it of items) {
          const sib = getTasks().filter((t) => t.date === dateStr);
          const nextOrder = sib.length ? Math.max(...sib.map((x) => Number(x.sortOrder) || 0)) + 1 : 0;
          const newId = await createTask({
            title: it.text.slice(0, 120),
            date: dateStr,
            duration,
            category,
            priority,
            completed: false,
            sortOrder: nextOrder,
          });
          getTasks().push({
            id: newId,
            title: it.text.slice(0, 120),
            date: dateStr,
            duration,
            category,
            priority,
            completed: false,
            sortOrder: nextOrder,
            courseCheckRef: null,
          });
          setMindMapNodeDataPatch(it.node, {
            taskId: newId,
            exportedAt: fmtDate(new Date()),
            ...buildMindMapNodeVisualPatch({ ...it.node.nodeData?.data, taskId: newId }),
          });
          created += 1;
        }
        scheduleMindMapSave();
        rebuildMindMapExportedTaskIds();
        closeMindMapExportModal();
        syncUI();
        showAlert(`已导出 ${created} 项到任务列表（${formatDateZh(dateStr)}）。`, 'success');
      } catch (e) {
        showAlert(formatApiError(e, '导出失败'));
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    async function toggleActiveMindMapTaskDone() {
      const node = getMindMapActiveNode();
      if (!node) return;
      const exp = resolveMindMapTaskExport(node.nodeData?.data);
      if (!exp?.taskId || exp.missing) {
        showAlert('当前节点尚未导出为任务，或任务已被删除。', 'invalid');
        return;
      }
      const next = !exp.completed;
      try {
        const task = getTasks().find((t) => String(t.id) === String(exp.taskId));
        if (task) {
          task.completed = next;
          await updateTask(task);
        }
        refreshMindMapNodeVisual(node);
        mindMapInstance?.render?.();
        scheduleMindMapSave();
        syncUI();
      } catch (e) {
        showAlert(formatApiError(e, '更新任务状态失败'));
      }
    }

    function openActiveMindMapLinkedTask() {
      const node = getMindMapActiveNode();
      if (!node) return;
      const exp = resolveMindMapTaskExport(node.nodeData?.data);
      if (!exp?.taskId || exp.missing) {
        showAlert('当前节点没有关联的有效任务。', 'invalid');
        return;
      }
      const task = getTasks().find((t) => String(t.id) === String(exp.taskId));
      if (task) openModal(task);
    }

    function bindMindMapExportModal() {
      if (document._mindMapExportModalBound) return;
      document._mindMapExportModalBound = true;
      $('mindMapExportClose')?.addEventListener('click', closeMindMapExportModal);
      $('mindMapExportCancel')?.addEventListener('click', closeMindMapExportModal);
      $('mindMapExportConfirm')?.addEventListener('click', () => {
        void confirmMindMapExportToTasks();
      });
      $('mindMapExportIncludeChildren')?.addEventListener('change', renderMindMapExportPreview);
      $('mindMapExportSkipExisting')?.addEventListener('change', renderMindMapExportPreview);
      const backdrop = $('mindMapExportBackdrop');
      if (backdrop) {
        backdrop.addEventListener('click', (e) => {
          if (e.target === backdrop) closeMindMapExportModal();
        });
      }
    }

    function getMindMapActiveNode() {
      const list = mindMapInstance?.renderer?.activeNodeList;
      if (!Array.isArray(list) || !list.length) return null;
      const node = list[0];
      if (node?.isRoot) return null;
      return node;
    }

    function getMindMapNodeLinkKey(nodeData) {
      const d = nodeData && typeof nodeData === 'object' ? nodeData : {};
      const linkType = String(d.linkType || '').trim();
      if (linkType === 'semesterGoal') return `sg:${Number(d.linkSlot) === 1 ? 1 : 0}`;
      if (linkType === 'milestone' && d.linkId) return `ms:${String(d.linkId)}`;
      return '';
    }

    function buildMindMapLinkTargets() {
      const sortFn = typeof getMilestoneSortFn() === 'function' ? getMilestoneSortFn() : (a, b) => 0;
      const targets = [];
      getStudyMilestones()
        .filter((m) => m.isSemesterGoal)
        .sort((a, b) => {
          const sa = Number(a.semesterGoalSlot) === 1 ? 1 : 0;
          const sb = Number(b.semesterGoalSlot) === 1 ? 1 : 0;
          if (sa !== sb) return sa - sb;
          return sortFn(a, b);
        })
        .forEach((m) => {
          const slot = Number(m.semesterGoalSlot) === 1 ? 1 : 0;
          targets.push({
            key: `sg:${slot}`,
            type: 'semesterGoal',
            id: String(m.id),
            slot,
            label: m.title || (slot === 1 ? '学期二目标' : '学期一目标'),
            sublabel: slot === 1 ? '学期目标 · 学期二' : '学期目标 · 学期一',
            completed: !!m.completed,
          });
        });
      getStudyMilestones()
        .filter((m) => !m.isSemesterGoal)
        .sort(sortFn)
        .forEach((m) => {
          targets.push({
            key: `ms:${m.id}`,
            type: 'milestone',
            id: String(m.id),
            label: m.title,
            sublabel: `里程碑 · ${formatDateZh(m.milestoneDate)}`,
            completed: !!m.completed,
          });
        });
      return targets;
    }

    function resolveMindMapLinkTarget(nodeData) {
      const d = nodeData && typeof nodeData === 'object' ? nodeData : {};
      const linkType = String(d.linkType || '').trim();
      const linkId = String(d.linkId || '').trim();
      if (linkType === 'milestone' && linkId) {
        const m = getStudyMilestones().find((x) => String(x.id) === linkId);
        if (m) {
          return {
            type: 'milestone',
            id: String(m.id),
            label: m.title,
            sublabel: `里程碑 · ${formatDateZh(m.milestoneDate)}`,
            completed: !!m.completed,
            missing: false,
            raw: m,
          };
        }
        return {
          type: 'milestone',
          id: linkId,
          label: '(里程碑已删除)',
          sublabel: '里程碑',
          completed: false,
          missing: true,
        };
      }
      if (linkType === 'semesterGoal') {
        const slot = Number(d.linkSlot) === 1 ? 1 : 0;
        const m = getStudyMilestones().find(
          (x) => x.isSemesterGoal && (Number(x.semesterGoalSlot) === 1 ? 1 : 0) === slot
        );
        if (m) {
          return {
            type: 'semesterGoal',
            id: String(m.id),
            slot,
            label: m.title,
            sublabel: slot === 1 ? '学期目标 · 学期二' : '学期目标 · 学期一',
            completed: !!m.completed,
            missing: false,
            raw: m,
          };
        }
        const g = getStudyGoalProfile() || {};
        return {
          type: 'semesterGoal',
          id: linkId || '',
          slot,
          label: slot === 1 ? g.semester2Title || '学期二目标' : g.semesterTitle || '学期一目标',
          sublabel: slot === 1 ? '学期目标 · 学期二' : '学期目标 · 学期一',
          completed: false,
          missing: true,
        };
      }
      return null;
    }

    function buildMindMapLinkTagLabel(target) {
      if (!target) return '';
      const prefix = target.completed ? '✓ ' : '';
      if (target.type === 'semesterGoal') return `${prefix}${target.sublabel}`;
      return `${prefix}${target.sublabel} ${target.label}`.trim();
    }

    function getMindMapLinkFillColor(target) {
      if (!target) return '';
      if (target.missing) return '#fef3c7';
      if (target.completed) return '#d1fae5';
      if (target.type === 'semesterGoal') return Number(target.slot) === 1 ? '#eef2ff' : '#fff1f2';
      return '#eff6ff';
    }

    function setMindMapNodeDataPatch(node, patch) {
      if (!mindMapInstance || !node) return;
      try {
        mindMapInstance.execCommand('SET_NODE_DATA', node, patch);
      } catch (_) {
        try {
          mindMapInstance.renderer?.setNodeDataRender?.(node, patch);
        } catch (e2) {
          console.warn('[mindmap] 更新节点失败', e2.message || e2);
        }
      }
    }

    function applyMindMapNodeRenderStyles(node, visual) {
      if (!node || !visual) return;
      const styleObj = {
        fillColor: visual.fillColor || undefined,
        borderColor: visual.borderColor || '',
        borderWidth: visual.borderColor ? visual.borderWidth || 2 : 0,
        lineColor: visual.lineColor || '',
      };
      try {
        mindMapInstance?.execCommand('SET_NODE_STYLES', node, styleObj);
      } catch (_) {
        try {
          if (typeof node.setStyles === 'function') node.setStyles(styleObj);
          else if (typeof node.setStyle === 'function') {
            Object.entries(styleObj).forEach(([k, v]) => node.setStyle(k, v));
          }
        } catch (e2) {
          console.warn('[mindmap] 更新节点样式失败', e2.message || e2);
        }
      }
    }

    function applyMindMapNodeStyleColors(node, { fill, border, line, reset } = {}) {
      if (!node || !mindMapInstance) return;
      const base = { ...(node.nodeData?.data || {}) };
      if (reset) {
        base.styleFillColor = '';
        base.styleBorderColor = '';
        base.styleLineColor = '';
      } else {
        if (fill !== undefined) base.styleFillColor = fill;
        if (border !== undefined) base.styleBorderColor = border;
        if (line !== undefined) base.styleLineColor = line;
      }
      const visual = buildMindMapNodeVisualPatch(base);
      const dataPatch = {
        ...(reset
          ? { styleFillColor: '', styleBorderColor: '', styleLineColor: '' }
          : {
              ...(fill !== undefined ? { styleFillColor: fill } : {}),
              ...(border !== undefined ? { styleBorderColor: border } : {}),
              ...(line !== undefined ? { styleLineColor: line } : {}),
            }),
        ...visual,
      };
      setMindMapNodeDataPatch(node, dataPatch);
      applyMindMapNodeRenderStyles(node, visual);
      if (mindMapColorMenuNode === node) highlightMindMapColorMenuSwatches(base);
      scheduleMindMapSave();
    }

    function highlightMindMapColorMenuSwatches(d) {
      const fill = String(d?.styleFillColor || '').trim();
      const border = String(d?.styleBorderColor || '').trim();
      const line = String(d?.styleLineColor || '').trim();
      document.querySelectorAll('#mindMapColorMenuFill .mindmap-color-swatch').forEach((btn) => {
        btn.classList.toggle('is-active', (btn.getAttribute('data-color-value') || '') === fill);
      });
      document.querySelectorAll('#mindMapColorMenuBorder .mindmap-color-swatch').forEach((btn) => {
        btn.classList.toggle('is-active', (btn.getAttribute('data-color-value') || '') === border);
      });
      document.querySelectorAll('#mindMapColorMenuLine .mindmap-color-swatch').forEach((btn) => {
        btn.classList.toggle('is-active', (btn.getAttribute('data-color-value') || '') === line);
      });
    }

    function hideMindMapColorMenu() {
      mindMapColorMenuNode = null;
      $('mindMapColorMenu')?.classList.add('hidden');
    }

    function showMindMapColorMenu(e, node) {
      if (!node || !isActiveMindMapEditing()) return;
      const menu = $('mindMapColorMenu');
      if (!menu) return;
      mindMapColorMenuNode = node;
      const title = $('mindMapColorMenuTitle');
      const rawText = String(node.nodeData?.data?.text || '').replace(/<[^>]+>/g, '').trim();
      if (title) title.textContent = (rawText || '节点').slice(0, 28);
      highlightMindMapColorMenuSwatches(node.nodeData?.data || {});
      menu.classList.remove('hidden');
      const x = e?.clientX ?? e?.touches?.[0]?.clientX ?? 0;
      const y = e?.clientY ?? e?.touches?.[0]?.clientY ?? 0;
      const pad = 8;
      const rect = menu.getBoundingClientRect();
      let left = x + pad;
      let top = y + pad;
      if (left + rect.width > window.innerWidth - pad) left = Math.max(pad, x - rect.width - pad);
      if (top + rect.height > window.innerHeight - pad) top = Math.max(pad, y - rect.height - pad);
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    }

    function findMindMapNodeAtPoint(clientX, clientY) {
      const el = document.elementFromPoint(clientX, clientY);
      if (!el || !mindMapInstance?.renderer?.root) return null;
      let cur = el;
      const container = $('mindMapContainer');
      while (cur && cur !== container) {
        let hit = null;
        walkMindMapNodeInstances(mindMapInstance.renderer.root, (node) => {
          if (hit) return;
          const groupEl = node.group?.node;
          if (groupEl && (groupEl === cur || groupEl.contains(cur))) hit = node;
        });
        if (hit) return hit;
        cur = cur.parentElement;
      }
      return null;
    }

    function renderMindMapColorSwatchRow(container, presets, kind) {
      if (!container) return;
      container.innerHTML = presets
        .map((p) => {
          const bg = p.value ? `background:${p.value};` : '';
          const inner = p.value ? '' : '<span class="text-[10px] text-slate-400">∅</span>';
          return `<button type="button" class="mindmap-color-swatch inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 ${p.value ? '' : 'bg-white'}" data-color-kind="${kind}" data-color-value="${esc(p.value)}" title="${esc(p.label)}" style="${bg}">${inner}</button>`;
        })
        .join('');
      container.querySelectorAll('.mindmap-color-swatch').forEach((btn) => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (!mindMapColorMenuNode) return;
          const k = btn.getAttribute('data-color-kind');
          const value = btn.getAttribute('data-color-value') || '';
          const payload = {};
          if (k === 'fill') payload.fill = value;
          else if (k === 'border') payload.border = value;
          else if (k === 'line') payload.line = value;
          applyMindMapNodeStyleColors(mindMapColorMenuNode, payload);
        });
      });
    }

    function bindMindMapColorMenu() {
      const container = $('mindMapContainer');
      if (!container || container._mindMapColorBound) return;
      container._mindMapColorBound = true;

      renderMindMapColorSwatchRow($('mindMapColorMenuFill'), MIND_MAP_FILL_COLOR_PRESETS, 'fill');
      renderMindMapColorSwatchRow($('mindMapColorMenuBorder'), MIND_MAP_STROKE_COLOR_PRESETS, 'border');
      renderMindMapColorSwatchRow($('mindMapColorMenuLine'), MIND_MAP_STROKE_COLOR_PRESETS, 'line');

      $('mindMapColorMenuReset')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (mindMapColorMenuNode) applyMindMapNodeStyleColors(mindMapColorMenuNode, { reset: true });
      });

      document.addEventListener('click', (e) => {
        const menu = $('mindMapColorMenu');
        if (!menu || menu.classList.contains('hidden')) return;
        if (!menu.contains(e.target)) hideMindMapColorMenu();
      });

      container.addEventListener('contextmenu', (e) => e.preventDefault());

      let touchStartX = 0;
      let touchStartY = 0;
      container.addEventListener(
        'touchstart',
        (e) => {
          if (e.touches.length !== 1) return;
          const t = e.touches[0];
          touchStartX = t.clientX;
          touchStartY = t.clientY;
          clearTimeout(mindMapLongPressTimer);
          mindMapLongPressTimer = setTimeout(() => {
            const node = findMindMapNodeAtPoint(touchStartX, touchStartY);
            if (node) showMindMapColorMenu({ clientX: touchStartX, clientY: touchStartY }, node);
          }, 520);
        },
        { passive: true }
      );
      container.addEventListener(
        'touchmove',
        (e) => {
          const t = e.touches[0];
          if (t && (Math.abs(t.clientX - touchStartX) > 12 || Math.abs(t.clientY - touchStartY) > 12)) {
            clearTimeout(mindMapLongPressTimer);
          }
        },
        { passive: true }
      );
      container.addEventListener('touchend', () => clearTimeout(mindMapLongPressTimer));
      container.addEventListener('touchcancel', () => clearTimeout(mindMapLongPressTimer));
    }

    function walkMindMapNodeInstances(node, fn) {
      if (!node) return;
      if (!node.isRoot) fn(node);
      (node.children || []).forEach((child) => walkMindMapNodeInstances(child, fn));
    }

    function refreshMindMapLinkVisuals() {
      syncMindMapFromTasks();
    }

    function updateMindMapActiveLinkUi() {
      const node = getMindMapActiveNode();
      const target = node ? resolveMindMapLinkTarget(node.nodeData?.data) : null;
      const taskExp = node ? resolveMindMapTaskExport(node.nodeData?.data) : null;
      const hint = $('mindMapActiveLinkHint');
      const contextBar = $('mindMapContextBar');
      const contextLabel = $('mindMapContextLabel');
      const unlinkBtn = $('mindMapUnlinkBtn');
      const doneBtn = $('mindMapToggleLinkDone');
      const linkActions = $('mindMapLinkActions');
      const exportBtn = $('mindMapExportTaskBtn');
      const taskDoneBtn = $('mindMapToggleTaskDone');
      const openTaskBtn = $('mindMapOpenTaskBtn');
      const taskMenuWrap = $('mindMapTaskMenuWrap');
      const activeKey = node ? getMindMapNodeLinkKey(node.nodeData?.data) : '';
      const hintParts = [];
      if (contextBar) {
        contextBar.classList.toggle('hidden', !node);
        contextBar.classList.toggle('flex', !!node);
      }
      if (contextLabel && node) {
        const raw = String(node.nodeData?.data?.text || '').replace(/<[^>]+>/g, '').trim() || '节点';
        contextLabel.innerHTML = `<i class="fa-solid fa-circle-dot mr-1 text-brand-500 text-[10px]"></i>${esc(raw.slice(0, 28))}`;
      }
      if (!node) {
        hideMindMapToolbarMenus();
        if (hint) {
          hint.textContent = isActiveMindMapEditing()
            ? '编辑模式：选中节点后可增删改，或在下方关联目标/里程碑。'
            : '查看模式：选中节点后可加入任务列表；需修改请点击「编辑导图」。';
        }
      } else {
        if (taskExp) {
          hintParts.push(`已导出任务：${taskExp.title}${taskExp.completed ? '（已完成）' : ''}${taskExp.missing ? '（任务已删除）' : ''}`);
        }
        if (target) {
          hintParts.push(`已关联：${target.sublabel} · ${target.label}${target.completed ? '（已完成）' : ''}`);
        }
        if (!hintParts.length) {
          hintParts.push(
            isActiveMindMapEditing()
              ? '可关联下方目标/里程碑，或保存后在查看模式加入任务列表。'
              : '可「加入任务列表」安排执行。'
          );
        }
        if (hint) hint.textContent = hintParts.join(' · ');
      }
      if (linkActions) linkActions.classList.toggle('hidden', !node || !target || !isActiveMindMapEditing());
      if (unlinkBtn) unlinkBtn.disabled = !target || !isActiveMindMapEditing();
      if (exportBtn) exportBtn.disabled = !node || !canExportMindMapToTasks();
      if (taskMenuWrap) taskMenuWrap.classList.toggle('hidden', !node || !taskExp || !isActiveMindMapPreview());
      if (taskDoneBtn) {
        taskDoneBtn.disabled = !taskExp || taskExp.missing || !canExportMindMapToTasks();
        const span = taskDoneBtn.querySelector('span');
        const label = taskExp?.completed ? '标记任务未完成' : '标记任务完成';
        if (span) span.textContent = label;
      }
      if (openTaskBtn) openTaskBtn.disabled = !taskExp || taskExp.missing || !canExportMindMapToTasks();
      if (doneBtn) {
        doneBtn.disabled = !target || target.missing || !target.id || !isActiveMindMapEditing();
        const label = target?.completed ? '关联项未完成' : '关联项完成';
        doneBtn.innerHTML = `<i class="fa-solid fa-circle-check mr-1"></i>${label}`;
      }
      document.querySelectorAll('.mindmap-link-chip').forEach((chip) => {
        chip.classList.toggle('is-on-active', !!activeKey && chip.dataset.linkKey === activeKey);
      });
    }

    function renderMindMapLinkTray() {
      const wrap = $('mindMapLinkChips');
      if (!wrap) return;
      const targets = buildMindMapLinkTargets();
      if (!targets.length) {
        wrap.innerHTML = '<span class="text-slate-400">请先在「学习目标与里程碑」中保存学期目标或添加里程碑。</span>';
        return;
      }
      wrap.innerHTML = targets
        .map((t) => {
          const kindCls =
            t.type === 'semesterGoal'
              ? Number(t.slot) === 1
                ? 'border-indigo-200 bg-indigo-50 text-indigo-900'
                : 'border-rose-200 bg-rose-50 text-rose-900'
              : 'border-sky-200 bg-sky-50 text-sky-900';
          return `<button type="button" class="mindmap-link-chip rounded-full border px-3 py-1.5 font-medium ${kindCls}${t.completed ? ' is-done' : ''}" data-link-key="${esc(t.key)}" data-link-type="${esc(t.type)}" draggable="true" title="${esc(t.sublabel)} · ${esc(t.label)}">${t.completed ? '<i class="fa-solid fa-check mr-1 text-[10px]"></i>' : ''}${esc(t.label)}</button>`;
        })
        .join('');
      wrap.querySelectorAll('.mindmap-link-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          const key = chip.getAttribute('data-link-key');
          if (key) linkMindMapTargetByKey(key);
        });
        chip.addEventListener('dragstart', (e) => {
          const key = chip.getAttribute('data-link-key');
          if (e.dataTransfer && key) {
            e.dataTransfer.setData('text/mindmap-link-key', key);
            e.dataTransfer.effectAllowed = 'link';
          }
        });
      });
      updateMindMapActiveLinkUi();
    }

    function linkMindMapTargetByKey(key) {
      if (!isActiveMindMapEditing()) {
        showAlert('查看模式下不可关联。请点击「编辑导图」后再操作。', 'invalid');
        return;
      }
      const target = buildMindMapLinkTargets().find((t) => t.key === key);
      if (!target) return;
      const node = getMindMapActiveNode();
      if (!node) {
        showAlert('请先选中要关联的节点（根节点不可关联）。', 'invalid');
        return;
      }
      const resolved = {
        type: target.type,
        id: target.id,
        slot: target.slot,
        label: target.label,
        sublabel: target.sublabel,
        completed: target.completed,
        missing: false,
      };
      const patch = {
        linkType: target.type,
        linkId: target.id || '',
      };
      if (target.type === 'semesterGoal') {
        patch.linkSlot = Number(target.slot) === 1 ? 1 : 0;
      }
      const merged = buildMindMapNodeVisualPatch({ ...node.nodeData?.data, ...patch });
      setMindMapNodeDataPatch(node, { ...patch, ...merged });
      scheduleMindMapSave();
      updateMindMapActiveLinkUi();
      showAlert(`已关联到「${target.label}」`, 'success');
    }

    function unlinkActiveMindMapNode() {
      const node = getMindMapActiveNode();
      if (!node) return;
      setMindMapNodeDataPatch(node, {
        linkType: '',
        linkId: '',
        linkSlot: '',
        ...buildMindMapNodeVisualPatch({ ...node.nodeData?.data, linkType: '', linkId: '' }),
      });
      scheduleMindMapSave();
      updateMindMapActiveLinkUi();
    }

    async function toggleActiveMindMapLinkDone() {
      const node = getMindMapActiveNode();
      if (!node) return;
      const target = resolveMindMapLinkTarget(node.nodeData?.data);
      if (!target?.id || target.missing) {
        showAlert('当前节点未关联有效的目标或里程碑。', 'invalid');
        return;
      }
      const next = !target.completed;
      try {
        await api(`/api/study-milestones/${target.id}`, {
          method: 'PUT',
          body: JSON.stringify({ completed: next }),
        });
        const row = getStudyMilestones().find((x) => String(x.id) === String(target.id));
        if (row) row.completed = next;
        renderMilestoneList();
        refreshMindMapLinkVisuals();
        updateMindMapActiveLinkUi();
      } catch (e) {
        showAlert(formatApiError(e, '更新完成状态失败'));
      }
    }

    function bindMindMapLinkDropZone() {
      const container = $('mindMapContainer');
      if (!container || container._mindMapLinkDropBound) return;
      container._mindMapLinkDropBound = true;
      container.addEventListener('dragover', (e) => {
        if (e.dataTransfer?.types?.includes('text/mindmap-link-key')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'link';
        }
      });
      container.addEventListener('drop', (e) => {
        const key = e.dataTransfer?.getData('text/mindmap-link-key');
        if (!key) return;
        e.preventDefault();
        linkMindMapTargetByKey(key);
      });
    }

    function updateMindMapHistoryButtons(index, len) {
      const undoBtn = $('mindMapUndo');
      const redoBtn = $('mindMapRedo');
      if (undoBtn) undoBtn.disabled = index <= 0;
      if (redoBtn) redoBtn.disabled = index >= len - 1;
    }

    function ensureMindMapInstance(initialTree) {
      const MindMapCtor = getMindMapCtor();
      if (!MindMapCtor || !$('mindMapContainer')) {
        if (getStudyGoalPanelView() === 'mindmap') {
          showAlert('思维导图库加载失败，请刷新页面后重试。', 'warning');
        }
        return null;
      }
      ensureMindMapStore();
      if (initialTree) {
        let entry = getActiveMindMapEntry();
        if (!entry && mindMapStore.maps.length < MAX_MIND_MAPS) {
          entry = makeMindMapEntry('logical', initialTree);
          mindMapStore.maps.push(entry);
          mindMapStore.activeId = entry.id;
          mindMapEditingByMapId[entry.id] = true;
        } else if (entry) {
          entry.tree = cloneMindMapTree(initialTree);
        }
      }
      bindMindMapCanvasMenu();
      updateMindMapCurrentTitleUi();
      if (!getActiveMindMapEntry()) return null;
      if (!mindMapInstance || mindMapInstance._mindMapMapId !== getActiveMindMapId()) {
        return remountActiveMindMap();
      }
      if (!mindMapInstance._eventsBound) bindMindMapInstanceEvents(mindMapInstance);
      applyMindMapEditMode();
      return mindMapInstance;
    }

    function destroyMindMapPreview() {
      if (!mindMapPreviewInstance) return;
      try {
        if (typeof mindMapPreviewInstance.destroy === 'function') {
          mindMapPreviewInstance.destroy();
        }
      } catch (_) {}
      mindMapPreviewInstance = null;
      const el = $('mindMapFullscreenContainer');
      if (el) el.innerHTML = '';
    }

    function toggleMindMapExpanded(force) {
      const stage = $('mindMapStage');
      const expandBtn = $('mindMapExpandBtn');
      const collapseBtn = $('mindMapCollapseBtn');
      if (!stage) return;
      if (!mindMapInstance) ensureMindMapInstance();
      mindMapStageExpanded = typeof force === 'boolean' ? force : !mindMapStageExpanded;
      stage.classList.toggle('mind-map-stage-expanded', mindMapStageExpanded);
      expandBtn?.classList.toggle('hidden', mindMapStageExpanded);
      collapseBtn?.classList.toggle('hidden', !mindMapStageExpanded);
      document.body.classList.toggle('overflow-hidden', mindMapStageExpanded);
      refitMindMapInstance(mindMapInstance);
    }

    function closeMindMapExpanded() {
      if (mindMapStageExpanded) toggleMindMapExpanded(false);
    }

    function openMindMapFullscreen() {
      toggleMindMapExpanded(true);
    }

    function closeMindMapFullscreen() {
      closeMindMapExpanded();
      const backdrop = $('mindMapFullscreenBackdrop');
      const panel = $('mindMapFullscreenPanel');
      if (!backdrop || backdrop.classList.contains('hidden')) return;
      backdrop.classList.add('opacity-0');
      if (panel) panel.classList.add('scale-[0.98]');
      setTimeout(() => {
        backdrop.classList.add('hidden');
        backdrop.classList.remove('flex');
        destroyMindMapPreview();
      }, 200);
    }

    function mindMapPreviewViewAction(action) {
      if (!mindMapPreviewInstance?.view) return;
      try {
        if (action === 'in') mindMapPreviewInstance.view.enlarge();
        else if (action === 'out') mindMapPreviewInstance.view.narrow();
        else mindMapPreviewInstance.view.fit();
      } catch (e) {
        console.warn('[mindmap] 预览缩放失败', e.message || e);
      }
    }

    function bindMindMapToolbar() {
      bindMindMapToolbarMenus();
      bindMindMapExportModal();
      bindMindMapCanvasMenu();
      $('mindMapUndo')?.addEventListener('click', () => {
        mindMapInstance?.execCommand('BACK');
      });
      $('mindMapRedo')?.addEventListener('click', () => {
        mindMapInstance?.execCommand('FORWARD');
      });
      $('mindMapAddChild')?.addEventListener('click', () => {
        mindMapInstance?.execCommand('INSERT_CHILD_NODE');
      });
      $('mindMapAddSibling')?.addEventListener('click', () => {
        mindMapInstance?.execCommand('INSERT_NODE');
      });
      $('mindMapDelete')?.addEventListener('click', () => {
        if (!mindMapInstance) return;
        if (!confirm('确定删除选中的节点吗？')) return;
        mindMapInstance.execCommand('REMOVE_NODE');
      });
      $('mindMapUnlinkBtn')?.addEventListener('click', () => unlinkActiveMindMapNode());
      $('mindMapExportTaskBtn')?.addEventListener('click', () => openMindMapExportModal());
      $('mindMapToggleTaskDone')?.addEventListener('click', () => {
        void toggleActiveMindMapTaskDone();
      });
      $('mindMapOpenTaskBtn')?.addEventListener('click', () => openActiveMindMapLinkedTask());
      $('mindMapToggleLinkDone')?.addEventListener('click', () => {
        void toggleActiveMindMapLinkDone();
      });
      $('mindMapExpandBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openMindMapFullscreen();
      });
      $('mindMapCollapseBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeMindMapExpanded();
      });
      $('mindMapFsClose')?.addEventListener('click', () => closeMindMapFullscreen());
      $('mindMapFsZoomIn')?.addEventListener('click', () => mindMapPreviewViewAction('in'));
      $('mindMapFsZoomOut')?.addEventListener('click', () => mindMapPreviewViewAction('out'));
      $('mindMapFsFit')?.addEventListener('click', () => mindMapPreviewViewAction('fit'));
      const fsBackdrop = $('mindMapFullscreenBackdrop');
      if (fsBackdrop) {
        fsBackdrop.addEventListener('click', (e) => {
          if (e.target === fsBackdrop) closeMindMapFullscreen();
        });
      }
      updateMindMapCurrentTitleUi();
      $('mindMapSaveBtn')?.addEventListener('click', () => {
        if (isActiveMindMapDirty() && !mindMapSaving) void saveTaskMindMap();
      });
      $('mindMapEditBtn')?.addEventListener('click', () => enterMindMapEditMode());
      if (!document._mindMapSaveHotkeyBound) {
        document._mindMapSaveHotkeyBound = true;
        document.addEventListener('keydown', (e) => {
          if (getStudyGoalPanelView() !== 'mindmap') return;
          if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
          if (isActiveMindMapDirty() && !mindMapSaving) {
            e.preventDefault();
            void saveTaskMindMap();
          }
        });
      }
    }

    async function handleTaskMindMapGet(sbRequest) {
      let r = null;
      try {
        const rows = await sbRequest('/task_mind_maps?select=map_data_logical,map_data_radial,map_data,updated_at');
        r = Array.isArray(rows) && rows[0];
      } catch (_) {
        const rows = await sbRequest('/task_mind_maps?select=map_data,updated_at');
        r = Array.isArray(rows) && rows[0];
      }
      if (!r) return { mapData: null, updatedAt: null };
      const mapData = buildMindMapStoreFromApiRow(r);
      return { mapData, updatedAt: r.updated_at || null };
    }

    async function handleTaskMindMapPost(body, uid, sbRequest) {
      let store = body?.mapData ?? body?.map_data ?? null;
      store = normalizeMindMapStore(store);
      if (!store || store.version !== 3) throw new Error('导图数据不能为空');
      const activeId = body?.activeMapId ?? body?.active_map_id ?? store.activeId;
      const force = body?.force === true || body?.force === 1;
      const expected = body?.expectedUpdatedAt ?? body?.expected_updated_at ?? null;
      let expectedMapSignatures = body?.expectedMapSignatures ?? body?.expected_map_signatures ?? null;
      if (!expectedMapSignatures || typeof expectedMapSignatures !== 'object') {
        expectedMapSignatures = {};
      }
      const legacySig = String(body?.expectedMapSignature ?? body?.expected_map_signature ?? '').trim();
      if (!Object.keys(expectedMapSignatures).length && legacySig && activeId) {
        expectedMapSignatures[activeId] = legacySig;
      }
      let curRows = null;
      try {
        curRows = await sbRequest('/task_mind_maps?select=map_data_logical,map_data_radial,map_data,updated_at');
      } catch (_) {
        curRows = await sbRequest('/task_mind_maps?select=map_data,updated_at');
      }
      const cur = Array.isArray(curRows) && curRows[0];
      if (!force && expected != null && String(expected).trim() !== '' && cur?.updated_at) {
        const serverMs = new Date(cur.updated_at).getTime();
        const expectMs = new Date(expected).getTime();
        if (!Number.isNaN(serverMs) && !Number.isNaN(expectMs) && serverMs > expectMs + 500) {
          const serverStore = buildMindMapStoreFromApiRow(cur);
          const conflictMapIds = detectMindMapStoreConflicts(serverStore, expectedMapSignatures);
          if (conflictMapIds.length) {
            const err = new Error('云端已有较新版本');
            err.httpStatus = 409;
            err.data = { updatedAt: cur.updated_at, mapData: serverStore, conflictMapIds };
            throw err;
          }
        }
      }
      store.activeId = activeId && store.maps.some((m) => m.id === activeId) ? activeId : store.maps[0]?.id || null;
      const now = new Date().toISOString();
      const dualCols = v3StoreToLegacyDualColumns(store);
      const payload = { map_data: store, updated_at: now, ...dualCols };
      if (cur) {
        try {
          await sbRequest(`/task_mind_maps?user_id=eq.${encodeURIComponent(uid)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify(payload),
          });
        } catch (_) {
          await sbRequest(`/task_mind_maps?user_id=eq.${encodeURIComponent(uid)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({ map_data: store, updated_at: now }),
          });
        }
      } else {
        try {
          await sbRequest('/task_mind_maps?on_conflict=user_id', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Prefer: 'resolution=merge-duplicates,return=minimal',
            },
            body: JSON.stringify([{ user_id: uid, ...payload }]),
          });
        } catch (_) {
          await sbRequest('/task_mind_maps?on_conflict=user_id', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Prefer: 'resolution=merge-duplicates,return=minimal',
            },
            body: JSON.stringify([{ user_id: uid, map_data: store, updated_at: now }]),
          });
        }
      }
      return { ok: true, updatedAt: now };
    }

    async function activateMindMapPanel() {
      bindMindMapCanvasMenu();
      updateMindMapCurrentTitleUi();
      if (!mindMapLoaded) {
        try {
          await loadTaskMindMapData();
        } catch (e) {
          console.warn('[mindmap] 加载失败', e.message || e);
          mindMapLoaded = true;
          initMindMapModesFresh();
        }
      }
      ensureMindMapInstance();
      applyMindMapEditMode();
      renderMindMapLinkTray();
      scheduleMindMapFitView();
    }

    function onMindMapResize() {
      if (!mindMapInstance) return;
      try {
        mindMapInstance.resize();
        if (mindMapStageExpanded || getStudyGoalPanelView() === 'mindmap') {
          refitMindMapInstance(mindMapInstance);
        }
      } catch (_) {}
    }

    return {
      get instance() { return mindMapInstance; },
      get stageExpanded() { return mindMapStageExpanded; },
      exportedTaskIdsHas(id) { return mindMapExportedTaskIds.has(String(id)); },
      bindToolbar: bindMindMapToolbar,
      bindCanvasMenu: bindMindMapCanvasMenu,
      ensureInstance: ensureMindMapInstance,
      loadData: loadTaskMindMapData,
      applyEditMode: applyMindMapEditMode,
      hideColorMenu: hideMindMapColorMenu,
      closeExpanded: closeMindMapExpanded,
      isActiveDirty: isActiveMindMapDirty,
      isAnyDirty: isAnyMindMapDirty,
      save: saveTaskMindMap,
      syncFromTasks: syncMindMapFromTasks,
      clearTaskLinkByTaskId: clearMindMapTaskLinkByTaskId,
      getActiveEntry: getActiveMindMapEntry,
      activatePanel: activateMindMapPanel,
      handleApiGet: handleTaskMindMapGet,
      handleApiPost: handleTaskMindMapPost,
      onResize: onMindMapResize,
      refreshLinkTray: renderMindMapLinkTray,
      fitView: scheduleMindMapFitView,
    };
  }

  global.PlanMindMap = { create: createPlanMindMap };
})(typeof window !== 'undefined' ? window : global);
