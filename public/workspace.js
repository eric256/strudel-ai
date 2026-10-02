// ---------------------------------------------------------------------------
// Workspace: every tool (chat, songs, station, now playing, visualizer, keys, pads, mixer, console) is a panel in
// dockview (https://dockview.dev, dockview-core — no framework): panels tab together, split anywhere, float as
// windows, maximise, or pop out into their own browser window (right-click a tab).
// The code editor is a panel too. Strudel's editor element must never move in the DOM (re-inserting it creates a
// second editor), so its panel holds an empty slot and the real editor is laid over it.
// Two panels are FIXED — they can't be closed: the code editor and 🎶 Now playing (it holds the transport, keeps a
// group of its own, and never shrinks below its transport bar).
// ---------------------------------------------------------------------------

const EDITOR = 'editor';
const NOW = 'song';
const FIXED = new Set([EDITOR, NOW]);
const NOW_MIN_HEIGHT = 52; // the transport bar

/** Load dockview's browser build (it includes its own CSS). */
export function loadDockview() {
  if (globalThis['dockview-core']) return Promise.resolve(globalThis['dockview-core']);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/dockview/dockview-core.min.js';
    s.onload = () => (globalThis['dockview-core'] ? resolve(globalThis['dockview-core']) : reject(new Error('dockview did not load')));
    s.onerror = () => reject(new Error('dockview could not be loaded'));
    document.head.appendChild(s);
  });
}

/**
 * @param {object} o
 * @param {HTMLElement} o.root     the workspace element (main) — dockview fills it
 * @param {HTMLElement} o.center   the element holding the code editor; it stays put and is laid over the "editor" panel
 * @param {Array} o.panels         [{ id, title, icon, el, area }]
 * @param {object|null} o.saved    a saved dockview layout (toJSON), or null
 * @param {Function} o.onSave      called with the layout after every change
 */
export function createWorkspace({ dv, root, center, panels, saved, onSave }) {
  const P = new Map(panels.map((p) => [p.id, { onVisible: null, onOpen: null, ...p }]));
  const slot = document.createElement('div');
  slot.className = 'dv-editor-slot';
  P.set(EDITOR, { id: EDITOR, title: 'Code', icon: '⌨', el: slot, area: 'center', onVisible: null, onOpen: null });
  const store = document.getElementById('panel-store');

  // dockview fills the workspace; the editor column floats over its slot
  center.classList.add('dv-editor-overlay');
  const host = document.createElement('div');
  host.className = 'dv-host dockview-theme-dark';
  root.insertBefore(host, center);
  /** Lay the editor over its slot (or hide it while another tab covers it). */
  function placeEditor() {
    const r = slot.getBoundingClientRect(), wr = root.getBoundingClientRect();
    const shown = slot.isConnected && r.width > 0 && r.height > 0;
    center.style.display = shown ? '' : 'none';
    if (!shown) return;
    Object.assign(center.style, { left: `${r.left - wr.left}px`, top: `${r.top - wr.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  }
  new ResizeObserver(placeEditor).observe(slot);
  window.addEventListener('resize', () => requestAnimationFrame(placeEditor));
  // during drags and splitter moves the slot moves without resizing: follow it
  const follow = () => { placeEditor(); requestAnimationFrame(follow); };
  requestAnimationFrame(follow);

  const api = dv.createDockview(host, {
    theme: dv.themeDark,
    popoutUrl: '/popout.html',
    // keep every panel's content in the page while another tab covers it: the app finds its elements by id,
    // and the visualizer, meters and timers keep running in background tabs
    defaultRenderer: 'always',
    createComponent: ({ id, name }) => {
      const p = P.get(name);
      const element = p?.el || document.createElement('div');
      element.hidden = false;
      return { element, init() {} };
    },
    // the fixed panels' tabs have no close button
    createTabComponent: ({ name }) => (name === 'fixed' ? fixedTab() : undefined),
    // right-click a tab: maximise, float, pop out into a window
    getTabContextMenuItems: ({ panel }) => (panel.id === EDITOR
      ? ['maximize'] // the editor stays in the page (see above)
      : panel.id === NOW ? ['maximize', 'separator', 'float', 'popout']
      : ['close', 'closeOthers', 'separator', 'maximize', 'separator', 'float', 'popout']),
  });

  const title = (p) => `${p.icon ? p.icon + ' ' : ''}${p.title}`;
  function fixedTab() {
    const element = document.createElement('div');
    element.className = 'dv-fixed-tab';
    return { element, init(params) { element.textContent = params.title || ''; element.title = 'Always shown'; } };
  }
  /** Add one of the fixed panels (editor, now playing). */
  const addFixed = (id, opts) => api.addPanel({ id, component: id, tabComponent: 'fixed', title: title(P.get(id)), ...opts });
  const panelOf = (id) => api.getPanel(id);
  /** Where a panel opens: in a group that already holds a panel from the same area (auto-tabbing), else beside the editor. */
  function position(id) {
    const area = P.get(id).area;
    const mate = [...P.values()].find((q) => q.id !== id && q.id !== NOW && q.area === area && panelOf(q.id));
    if (mate) return { referencePanel: mate.id, direction: 'within' };
    const dir = { right: 'right', left: 'left', top: 'above', bottom: 'below' }[area] || 'right';
    return panelOf(EDITOR) ? { referencePanel: EDITOR, direction: dir } : { direction: dir };
  }
  function openPanel(id, { activate = true } = {}) {
    const p = P.get(id);
    if (!p) return;
    let panel = panelOf(id);
    if (!panel) panel = api.addPanel({ id, component: id, title: title(p), position: position(id), inactive: !activate });
    else if (activate) panel.api.setActive();
  }
  const closePanel = (id) => { if (!FIXED.has(id)) panelOf(id)?.api.close(); };

  function buildDefault() {
    api.clear();
    addFixed(EDITOR, {});
    api.addPanel({ id: 'chat', component: 'chat', title: title(P.get('chat')), position: { referencePanel: EDITOR, direction: 'right' }, initialWidth: 430 });
    api.addPanel({ id: 'songs', component: 'songs', title: title(P.get('songs')), position: { referencePanel: 'chat', direction: 'within' }, inactive: true });
    api.addPanel({ id: 'station', component: 'station', title: title(P.get('station')), position: { referencePanel: 'chat', direction: 'within' }, inactive: true });
    api.addPanel({ id: 'playlist', component: 'playlist', title: title(P.get('playlist')), position: { referencePanel: 'chat', direction: 'within' }, inactive: true });
    addFixed(NOW, { position: { referencePanel: 'chat', direction: 'below' }, initialHeight: 320 });
  }
  /** 🎶 Now playing: always there, alone in its group (so its transport is never hidden behind another tab), never shorter than the transport. */
  function ensureNow() {
    let panel = panelOf(NOW);
    if (panel && panel.group.panels.length > 1) {
      // tabbed with others (an older saved layout): give it its own group below them
      const g = panel.group;
      try { panel.api.moveTo({ group: api.addGroup({ referenceGroup: g, direction: 'below' }) }); } catch {}
    }
    if (!panelOf(NOW)) {
      const ref = panelOf('chat') || panelOf(EDITOR);
      addFixed(NOW, { position: ref ? { referencePanel: ref.id, direction: 'below' } : { direction: 'right' } });
    }
    try { panelOf(NOW).group.api.setConstraints({ minimumHeight: NOW_MIN_HEIGHT + 35 }); } catch {}
  }

  let loaded = false;
  if (saved) { try { api.fromJSON(saved); loaded = !!panelOf(EDITOR); } catch (e) { console.warn('dockview layout could not be restored:', e); } }
  if (!loaded) buildDefault();
  ensureNow();

  // nothing gets tabbed into Now playing's group, and Now playing doesn't get tabbed into another
  api.onWillDrop((e) => {
    const into = e.position === 'center' || e.kind === 'tab' || e.kind === 'header_space';
    if (!into || !e.group) return;
    const dragged = e.getData?.()?.panelId;
    const nowGroup = e.group.panels.some((x) => x.id === NOW);
    if ((nowGroup && dragged !== NOW) || (dragged === NOW && !nowGroup) || (dragged == null && nowGroup)) e.preventDefault();
  });

  // the fixed panels can't go away: put them back if they're closed
  api.onDidRemovePanel((panel) => {
    if (panel.id === EDITOR) setTimeout(() => { if (!panelOf(EDITOR)) addFixed(EDITOR, { position: { direction: 'left' } }); });
    if (panel.id === NOW) setTimeout(ensureNow);
    const p = P.get(panel.id);
    if (p?.el && p.el.parentNode !== store) store.appendChild(p.el); // keep the panel's DOM (and its state) for next time
  });

  // tell panels when they're opened / shown, and save the layout
  let open = new Set(), visible = new Set();
  const watched = new WeakSet();
  function sync() {
    const nowOpen = new Set(api.panels.map((x) => x.id));
    const nowVis = new Set(api.panels.filter((x) => x.api.isVisible).map((x) => x.id));
    for (const [id, p] of P) {
      if (nowOpen.has(id) !== open.has(id)) p.onOpen?.(nowOpen.has(id));
      if (nowVis.has(id) !== visible.has(id)) p.onVisible?.(nowVis.has(id));
    }
    open = nowOpen;
    visible = nowVis;
    for (const x of api.panels) if (!watched.has(x)) { watched.add(x); x.api.onDidVisibilityChange(() => setTimeout(sync)); }
    window.dispatchEvent(new Event('resize'));
  }
  let saveTimer = null;
  api.onDidLayoutChange(() => {
    sync();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { onSave?.(api.toJSON()); } catch {} }, 300);
  });
  api.onDidActivePanelChange(() => setTimeout(sync));
  sync();

  return {
    api,
    open: openPanel,
    close: closePanel,
    toggle: (id) => (panelOf(id) ? closePanel(id) : openPanel(id)),
    isOpen: (id) => !!panelOf(id),
    isVisible: (id) => !!panelOf(id)?.api.isVisible,
    on(id, { onVisible, onOpen } = {}) {
      const p = P.get(id);
      if (!p) return;
      if (onVisible) { p.onVisible = onVisible; onVisible(visible.has(id)); }
      if (onOpen) { p.onOpen = onOpen; onOpen(open.has(id)); }
    },
    reset() { buildDefault(); ensureNow(); sync(); },
    layout: () => api.toJSON(),
    panels: () => panels.map((p) => ({ id: p.id, title: p.title, icon: p.icon, open: !!panelOf(p.id), fixed: FIXED.has(p.id) })),
    minSize(id, px) {
      const g = panelOf(id)?.group;
      try { if (g && g.api.height < px && g.api.location?.type !== 'floating') g.api.setSize({ height: px }); } catch {}
    },
  };
}
