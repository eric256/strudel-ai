// ---------------------------------------------------------------------------
// Workspace: every tool (chat, songs, station, now playing, visualizer, keys, pads, mixer, console) is a panel in
// dockview (https://dockview.dev, dockview-core — no framework): panels tab together, split anywhere, float as
// windows, maximise, or pop out into their own browser window (right-click a tab).
// The code editor is a panel too. Strudel's editor element must never move in the DOM (re-inserting it creates a
// second editor), so its panel holds an empty slot and the real editor is laid over it.
// Two panels are fixed — they can't be closed: the code editor and 🎶 Now playing (in the modes that use it: it holds the transport, keeps a
// group of its own, and never shrinks below its transport bar).
// ---------------------------------------------------------------------------

const EDITOR = 'editor';
const NOW = 'song';
const NOW_MIN_HEIGHT = 52; // the transport bar
/** The layout when nothing is saved: chat, songs, station and playlist on the right, Now playing below them. */
export const DEFAULT_PRESET = { right: ['chat', 'songs', 'station', 'playlist'], bottom: [], now: true };

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
 * @param {object} o.preset        the layout to build when there's no saved one: { right: [ids], bottom: [ids], now: bool }
 * @param {Function} o.onSave      called with the layout after every change
 */
export function createWorkspace({ dv, root, center, panels, saved, preset = DEFAULT_PRESET, onSave }) {
  const P = new Map(panels.map((p) => [p.id, { onVisible: null, onOpen: null, ...p }]));
  const slot = document.createElement('div');
  slot.className = 'dv-editor-slot';
  P.set(EDITOR, { id: EDITOR, title: 'Code', icon: '⌨', el: slot, area: 'center', onVisible: null, onOpen: null });
  const store = document.getElementById('panel-store');
  /** Holders for saved panels nobody has registered yet: id → element. */
  const waiting = new Map();
  const waitFor = (id) => {
    const el = document.createElement('div');
    el.className = 'panel plugin-panel';
    el.textContent = '…';
    waiting.set(id, el);
    return el;
  };

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
      // a saved panel whose owner (a 🧩 plugin) hasn't registered yet: a holder it gets when it does (addPanel)
      const element = p?.el || waiting.get(name) || waitFor(name);
      element.hidden = false;
      return { element, init() {} };
    },
    // ⧉ float / ⇲ dock, ↗ own window, 📌 always on top, ⛶ maximise — on every group's header
    createRightHeaderActionComponent: () => headerActions(),
    // the fixed panels' tabs have no close button
    createTabComponent: ({ name }) => (name === 'fixed' ? fixedTab() : undefined),
    // right-click a tab: maximise, float, pop out into a window
    getTabContextMenuItems: ({ panel }) => (panel.id === EDITOR
      ? ['maximize'] // the editor stays in the page (see above)
      : panel.id === NOW ? ['maximize', 'separator', 'float', 'popout']
      : ['close', 'closeOthers', 'separator', 'maximize', 'separator', 'float', 'popout']),
  });

  const title = (p) => `${p.icon ? p.icon + ' ' : ''}${p.title}`;

  // --- header buttons: float, dock, pop out, always on top, maximise (they act on the group's active panel) ---
  const canPin = () => 'documentPictureInPicture' in window;
  function headerActions() {
    const element = document.createElement('div');
    element.className = 'dv-actions';
    let params = null;
    const subs = [];
    const button = (label, tip, fn) => {
      const b = document.createElement('button');
      b.className = 'dv-act';
      b.textContent = label;
      b.title = tip;
      b.addEventListener('pointerdown', (e) => e.stopPropagation()); // not a drag of the header
      b.onclick = (e) => { e.stopPropagation(); try { fn(); } catch (err) { console.warn('[panels]', err); } };
      return b;
    };
    function draw() {
      element.replaceChildren();
      const g = params?.group;
      const panel = g?.activePanel;
      if (!panel) return;
      const where = g.api.location?.type || 'grid';
      const movable = panel.id !== EDITOR; // the code editor stays in the page
      if (movable && where === 'grid') element.append(button('⧉', 'Float this panel over the layout (drag it anywhere, resize it)', () => floatPanel(panel.id)));
      if (movable && where !== 'grid') element.append(button('⇲', 'Dock this panel back into the layout', () => dockPanel(panel.id)));
      if (movable && where !== 'popout') element.append(button('↗', 'Open this panel in its own browser window', () => popoutPanel(panel.id)));
      if (movable && canPin()) element.append(button('📌', 'Always on top: this panel in a small window that stays above your other windows (Chrome / Edge)', () => pinOnTop(panel.id)));
      if (where === 'grid') element.append(button('⛶', 'Maximise / restore this panel', () => (panel.api.isMaximized() ? panel.api.exitMaximized() : panel.api.maximize())));
    }
    return {
      element,
      init(p) {
        params = p;
        draw();
        subs.push(p.api.onDidLocationChange(() => draw()), p.api.onDidActivePanelChange(() => draw()));
      },
      dispose() { for (const d of subs) d.dispose?.(); },
    };
  }
  function floatPanel(id) {
    const panel = panelOf(id);
    if (!panel) return;
    const r = root.getBoundingClientRect();
    const w = Math.min(560, Math.max(320, panel.api.width || 420)), h = Math.min(480, Math.max(220, panel.api.height || 300));
    api.addFloatingGroup(panel, { position: { left: Math.max(20, (r.width - w) / 2), top: Math.max(20, (r.height - h) / 3) }, width: w, height: h });
  }
  /** Back into the layout: tabbed with a panel from the same area, else beside the editor. */
  function dockPanel(id) {
    const panel = panelOf(id);
    if (!panel) return;
    const area = P.get(id)?.area;
    const mate = api.panels.find((x) => x.id !== id && x.id !== NOW && x.group.api.location?.type === 'grid' && P.get(x.id)?.area === area && x.id !== EDITOR);
    if (mate) panel.api.moveTo({ group: mate.group, position: 'center' });
    else panel.api.moveTo({ group: panelOf(EDITOR).group, position: { right: 'right', left: 'left', top: 'top' }[area] || 'bottom' });
  }
  function popoutPanel(id) {
    const panel = panelOf(id);
    if (panel) api.addPopoutGroup(panel).catch?.((e) => console.warn('[panels] pop-out failed (pop-ups blocked?)', e));
  }

  // 📌 always on top: Document Picture-in-Picture (Chrome / Edge). The panel's element moves into the little window
  // (the app keeps finding it by id) and comes back when the window closes.
  const pinned = { id: null, win: null, holder: null, observer: null };
  async function pinOnTop(id) {
    const p = P.get(id);
    if (!p || !canPin()) return;
    if (pinned.win) pinned.win.close(); // one at a time
    const r = p.el.getBoundingClientRect();
    const win = await window.documentPictureInPicture.requestWindow({ width: Math.round(Math.max(340, r.width)), height: Math.round(Math.max(220, r.height)) });
    for (const node of document.querySelectorAll('link[rel="stylesheet"], style')) win.document.head.append(node.cloneNode(true));
    const copyTheme = () => {
      win.document.documentElement.style.cssText = document.documentElement.style.cssText;
      win.document.documentElement.dataset.theme = document.documentElement.dataset.theme || '';
    };
    copyTheme();
    pinned.observer = new MutationObserver(copyTheme);
    pinned.observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme'] });
    win.document.title = `${p.icon || ''} ${p.title} — Strudel AI`;
    win.document.body.className = `pip-body ${document.body.className}`;
    const holder = document.createElement('div');
    holder.className = 'pip-holder muted small';
    holder.textContent = `📌 ${p.title} is in its always-on-top window — close that window to bring it back here.`;
    p.el.replaceWith(holder);
    win.document.body.append(p.el);
    Object.assign(pinned, { id, win, holder });
    win.addEventListener('pagehide', () => {
      pinned.observer?.disconnect();
      if (holder.isConnected) holder.replaceWith(p.el); else store.appendChild(p.el);
      Object.assign(pinned, { id: null, win: null, holder: null, observer: null });
      window.dispatchEvent(new Event('resize'));
    }, { once: true });
  }
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
  const isFixed = (id) => id === EDITOR || (id === NOW && needNow);
  const closePanel = (id) => { if (!isFixed(id)) panelOf(id)?.api.close(); };

  /** Build a layout: the editor, the `right` panels tabbed beside it, Now playing below them, the `bottom` ones under the editor. */
  function buildPreset(pr = preset) {
    api.clear();
    addFixed(EDITOR, {});
    const add = (id, position, extra = {}) => { if (P.has(id) && !panelOf(id)) api.addPanel({ id, component: id, title: title(P.get(id)), position, ...extra }); };
    const right = (pr.right || []).filter((id) => P.has(id));
    right.forEach((id, k) => add(id, k ? { referencePanel: right[0], direction: 'within' } : { referencePanel: EDITOR, direction: 'right' }, k ? { inactive: true } : { initialWidth: 430 }));
    if (pr.now !== false) addFixed(NOW, { position: right.length ? { referencePanel: right[0], direction: 'below' } : { referencePanel: EDITOR, direction: 'right' }, initialHeight: 320 });
    const bottom = (pr.bottom || []).filter((id) => P.has(id));
    bottom.forEach((id, k) => add(id, k ? { referencePanel: bottom[0], direction: 'within' } : { referencePanel: EDITOR, direction: 'below' }, k ? { inactive: true } : { initialHeight: 260 }));
  }
  /** Is 🎶 Now playing part of this layout (a mode can leave it out)? */
  let needNow = preset.now !== false;
  /** 🎶 Now playing: always there, alone in its group (so its transport is never hidden behind another tab), never shorter than the transport. */
  function ensureNow() {
    if (!needNow) return;
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

  let loaded = false, switching = false;
  if (saved) { try { api.fromJSON(saved); loaded = !!panelOf(EDITOR); } catch (e) { console.warn('dockview layout could not be restored:', e); } }
  if (!loaded) buildPreset();
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
    if (panel.id === NOW && !switching) setTimeout(ensureNow);
    if (pinned.id === panel.id) pinned.win?.close(); // closing a pinned panel brings it home first
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
    reset() { buildPreset(); ensureNow(); sync(); },
    /** Switch to another layout (a mode's): its saved one, else its preset. */
    setLayout(savedLayout, pr) {
      switching = true;
      try {
        preset = pr || DEFAULT_PRESET;
        needNow = preset.now !== false;
        let ok = false;
        if (savedLayout) { try { api.fromJSON(savedLayout); ok = !!panelOf(EDITOR); } catch (e) { console.warn('dockview layout could not be restored:', e); } }
        if (!ok) buildPreset();
        ensureNow();
      } finally { switching = false; }
      sync();
    },
    float: floatPanel,
    dock: dockPanel,
    popout: popoutPanel,
    pinOnTop,
    pinnedId: () => pinned.id,
    layout: () => api.toJSON(),
    panels: () => [...P.values()].filter((p) => p.id !== EDITOR).map((p) => ({ id: p.id, title: p.title, icon: p.icon, open: !!panelOf(p.id), fixed: isFixed(p.id) })),
    /**
     * Add a panel after start-up (🧩 plugins): { id, title, icon, area }. Returns its element. A panel with this id
     * restored from the saved layout keeps its place and gets the element now.
     */
    addPanel(def) {
      if (P.has(def.id)) throw new Error(`a panel "${def.id}" already exists`);
      const el = waiting.get(def.id) || document.createElement('div');
      waiting.delete(def.id);
      el.className = 'panel plugin-panel';
      el.textContent = '';
      P.set(def.id, { onVisible: null, onOpen: null, area: 'bottom', ...def, el });
      const panel = panelOf(def.id);
      if (panel) panel.api.setTitle(title(P.get(def.id)));
      sync();
      return el;
    },
    /** Remove a panel added with addPanel (closing it if it's open). */
    removePanel(id) {
      if (isFixed(id) || !P.has(id)) return;
      panelOf(id)?.api.close();
      P.get(id).el.remove();
      P.delete(id);
    },
    /** Close saved panels that nothing registered (a plugin that was removed or turned off). */
    dropWaiting() {
      for (const id of waiting.keys()) panelOf(id)?.api.close();
      waiting.clear();
    },
    minSize(id, px) {
      const g = panelOf(id)?.group;
      try { if (g && g.api.height < px && g.api.location?.type !== 'floating') g.api.setSize({ height: px }); } catch {}
    },
  };
}
