// ---------------------------------------------------------------------------
// 🧪 Trial layout engine: dockview (https://dockview.dev, dockview-core — no framework).
// Same API as workspace.js (open / close / toggle / isOpen / isVisible / on / reset / layout / panels / minSize),
// so the rest of the app doesn't know which engine runs. Extras over the built-in engine: splits anywhere
// (nested), maximise a group, and pop a group out into its own browser window (right-click a tab).
// The code editor is a panel too (it can't be closed). Strudel's editor element must never move in the DOM
// (re-inserting it creates a second editor), so its panel holds an empty slot and the real editor is laid over it.
// Turn it on in ⚙ Settings → General → 🧪 layout engine; the built-in engine stays the default.
// ---------------------------------------------------------------------------

const EDITOR = 'editor';

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
export function createDockviewWorkspace({ dv, root, center, panels, saved, onSave }) {
  const P = new Map(panels.map((p) => [p.id, { onVisible: null, onOpen: null, ...p }]));
  const slot = document.createElement('div');
  slot.className = 'dv-editor-slot';
  P.set(EDITOR, { id: EDITOR, title: 'Code', icon: '⌨', el: slot, area: 'center', onVisible: null, onOpen: null });
  const store = document.getElementById('panel-store');

  // dockview fills the workspace; the built-in engine's areas are hidden, the editor column floats over its slot
  for (const el of root.children) if (el !== center) el.style.display = 'none';
  for (const el of center.children) if (el.id !== 'editor-pane') el.style.display = 'none';
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
    // right-click a tab: maximise, float, pop out into a window
    getTabContextMenuItems: ({ panel }) => (panel.id === EDITOR
      ? ['maximize'] // the editor stays in the page (see above)
      : ['close', 'closeOthers', 'separator', 'maximize', 'separator', 'float', 'popout']),
  });

  const title = (p) => `${p.icon ? p.icon + ' ' : ''}${p.title}`;
  const panelOf = (id) => api.getPanel(id);
  /** Where a panel opens: in a group that already holds a panel from the same area (auto-tabbing), else beside the editor. */
  function position(id) {
    const area = P.get(id).area;
    const mate = [...P.values()].find((q) => q.id !== id && q.area === area && panelOf(q.id));
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
  const closePanel = (id) => { if (id !== EDITOR) panelOf(id)?.api.close(); };

  function buildDefault() {
    api.clear();
    api.addPanel({ id: EDITOR, component: EDITOR, title: title(P.get(EDITOR)) });
    api.addPanel({ id: 'chat', component: 'chat', title: title(P.get('chat')), position: { referencePanel: EDITOR, direction: 'right' }, initialWidth: 430 });
    api.addPanel({ id: 'songs', component: 'songs', title: title(P.get('songs')), position: { referencePanel: 'chat', direction: 'within' }, inactive: true });
    api.addPanel({ id: 'station', component: 'station', title: title(P.get('station')), position: { referencePanel: 'chat', direction: 'within' }, inactive: true });
    api.addPanel({ id: 'song', component: 'song', title: title(P.get('song')), position: { referencePanel: 'chat', direction: 'below' } });
  }

  let loaded = false;
  if (saved) { try { api.fromJSON(saved); loaded = !!panelOf(EDITOR); } catch (e) { console.warn('dockview layout could not be restored:', e); } }
  if (!loaded) buildDefault();

  // the editor can't go away: put it back if it's closed
  api.onDidRemovePanel((panel) => {
    if (panel.id === EDITOR) setTimeout(() => { if (!panelOf(EDITOR)) api.addPanel({ id: EDITOR, component: EDITOR, title: title(P.get(EDITOR)), position: { direction: 'left' } }); });
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
    engine: 'dockview',
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
    reset() { buildDefault(); sync(); },
    layout: () => api.toJSON(),
    panels: () => panels.map((p) => ({ id: p.id, title: p.title, icon: p.icon, open: !!panelOf(p.id) })),
    minSize(id, px) {
      const g = panelOf(id)?.group;
      try { if (g && g.api.height < px && g.api.location?.type !== 'floating') g.api.setSize({ height: px }); } catch {}
    },
  };
}
