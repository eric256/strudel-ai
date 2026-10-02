// ---------------------------------------------------------------------------
// Workspace: every tool (chat, songs, station, the playing song, visualizer, keys,
// pads, console) is a panel. Panels live in tab groups; a group is docked in one of
// the four areas around the code editor (left, right, top, bottom) or floats like a
// window inside the page. Drag a tab (or a group's header) to move it:
//   · onto another group → it becomes a tab there
//   · onto the top / bottom (or left / right) quarter of a docked group → its own group next to it
//   · onto an edge of the page → a new group in that area
//   · anywhere else → a floating window
// Areas and groups are resized with the splitters between them; floating windows by
// their corner. The layout is saved (see `onSave`).
// ---------------------------------------------------------------------------

const AREAS = ['left', 'right', 'top', 'bottom'];
const COL = { left: true, right: true }; // areas whose groups stack vertically
const DRAG_START = 6; // px before a press becomes a drag
const EDGE = 44; // px from an edge of the workspace that docks into that area

let gidSeq = 0;
const newGid = () => `g${Date.now().toString(36)}${(gidSeq++).toString(36)}`;

/**
 * @param {object} o
 * @param {HTMLElement} o.root     the workspace element (holds the areas, the center column and the floating layer)
 * @param {Array} o.panels         [{ id, title, icon, el, area }] — `area` is where the panel opens the first time
 * @param {object} o.defaults      the default layout (see `layout` below)
 * @param {object|null} o.saved    a saved layout, or null
 * @param {Function} o.onSave      called with the layout after every change
 */
export function createWorkspace({ root, panels, defaults, saved, onSave }) {
  const P = new Map(panels.map((p) => [p.id, { onVisible: null, onOpen: null, ...p }]));
  const $a = Object.fromEntries(AREAS.map((a) => [a, root.querySelector(`[data-area-box="${a}"]`)]));
  const $split = Object.fromEntries(AREAS.map((a) => [a, root.querySelector(`.ws-split[data-area="${a}"]`)]));
  const floatLayer = root.querySelector('.ws-float');
  const hint = root.querySelector('.ws-hint');
  const store = document.getElementById('panel-store');
  let L = sanitize(saved) || sanitize(structuredClone(defaults));
  let topZ = Math.max(10, ...L.groups.map((g) => g.z || 0));
  const groupEls = new Map(); // gid → element
  let visible = new Set(), open = new Set();
  let saveTimer = null;

  // ---- layout model ----------------------------------------------------------
  function sanitize(l) {
    if (!l || typeof l !== 'object' || !Array.isArray(l.groups)) return null;
    const seen = new Set();
    const groups = [];
    for (const g of l.groups) {
      const ps = (Array.isArray(g.panels) ? g.panels : []).filter((id) => P.has(id) && !seen.has(id));
      ps.forEach((id) => seen.add(id));
      if (!ps.length) continue;
      const where = g.where === 'float' || AREAS.includes(g.where) ? g.where : 'right';
      groups.push({
        id: String(g.id || newGid()), where, panels: ps, active: ps.includes(g.active) ? g.active : ps[0],
        weight: Number(g.weight) > 0 ? Number(g.weight) : 1,
        x: Number(g.x) || 60, y: Number(g.y) || 60, w: Number(g.w) || 420, h: Number(g.h) || 320, z: Number(g.z) || 10,
        dockTo: AREAS.includes(g.dockTo) ? g.dockTo : null,
      });
    }
    const areas = {};
    for (const a of AREAS) areas[a] = { size: Number(l.areas?.[a]?.size) || (COL[a] ? 400 : 220) };
    return { v: 1, areas, groups, home: typeof l.home === 'object' && l.home ? l.home : {} };
  }
  const groupOf = (id) => L.groups.find((g) => g.panels.includes(id));
  const byId = (gid) => L.groups.find((g) => g.id === gid);
  const inArea = (a) => L.groups.filter((g) => g.where === a);

  function changed() {
    render();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => onSave?.(structuredClone(L)), 150);
  }

  /** Take a panel out of its group (the group goes when it's empty). Remembers where it was. */
  function detach(id) {
    const g = groupOf(id);
    if (!g) return null;
    L.home[id] = { where: g.where, gid: g.id, x: g.x, y: g.y, w: g.w, h: g.h };
    g.panels = g.panels.filter((p) => p !== id);
    if (g.active === id) g.active = g.panels[0];
    if (!g.panels.length) L.groups = L.groups.filter((x) => x !== g);
    return g;
  }
  function addGroup(where, panelIds, { index = null, rect = null, weight = 1 } = {}) {
    const g = { id: newGid(), where, panels: [...panelIds], active: panelIds[0], weight, x: 60, y: 60, w: 420, h: 320, z: ++topZ, dockTo: null };
    if (rect) Object.assign(g, fitRect(rect));
    if (index == null) L.groups.push(g);
    else L.groups.splice(index, 0, g);
    return g;
  }
  /** Keep a floating window inside the workspace. */
  function fitRect({ x, y, w, h }) {
    const r = root.getBoundingClientRect();
    w = Math.max(220, Math.min(w || 420, r.width - 8));
    h = Math.max(140, Math.min(h || 320, r.height - 8));
    x = Math.max(0, Math.min(x ?? 60, r.width - w));
    y = Math.max(0, Math.min(y ?? 60, r.height - h));
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  }

  // ---- public API ------------------------------------------------------------
  function openPanel(id, { activate = true } = {}) {
    const p = P.get(id);
    if (!p) return;
    let g = groupOf(id);
    if (!g) {
      const home = L.homeOf?.(id) || L.home[id] || { where: p.area || 'right' };
      const same = home.gid && byId(home.gid);
      if (same) { same.panels.push(id); g = same; }
      else if (home.where === 'float') g = addGroup('float', [id], { rect: home });
      else {
        // tab it into the area's group automatically (the last one), or start the area's first group
        const where = AREAS.includes(home.where) ? home.where : p.area || 'right';
        const there = inArea(where);
        if (there.length) { g = there[there.length - 1]; g.panels.push(id); }
        else g = addGroup(where, [id]);
      }
    }
    if (activate) { g.active = id; if (g.where === 'float') g.z = ++topZ; }
    changed();
  }
  function closePanel(id) {
    if (!groupOf(id)) return;
    detach(id);
    changed();
  }

  // ---- rendering ---------------------------------------------------------------
  function groupEl(g) {
    let el = groupEls.get(g.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'ws-group';
      el.dataset.gid = g.id;
      el.innerHTML = '<div class="ws-head"><div class="ws-tabs"></div><span class="ws-fill" title="Drag to move · double-click to float / dock"></span>' +
        '<button class="ws-dockbtn" title="Float this group as a window / dock it again">⧉</button></div><div class="ws-body"></div>';
      groupEls.set(g.id, el);
      // floating windows: resized by their corner (CSS resize) → remember the size
      new ResizeObserver(() => {
        const gg = byId(el.dataset.gid);
        if (!gg || gg.where !== 'float' || dragging) return;
        const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
        if (w && h && (w !== gg.w || h !== gg.h)) { gg.w = w; gg.h = h; clearTimeout(saveTimer); saveTimer = setTimeout(() => onSave?.(structuredClone(L)), 300); window.dispatchEvent(new Event('resize')); }
      }).observe(el);
    }
    const tabs = el.querySelector('.ws-tabs');
    tabs.innerHTML = g.panels.map((id) => {
      const p = P.get(id);
      return `<div class="ws-tab${id === g.active ? ' active' : ''}" data-p="${id}" title="${p.title} — drag to move it">` +
        `<span class="ws-ico">${p.icon || ''}</span><span class="ws-title">${p.title}</span><button class="ws-x" data-close="${id}" title="Close ${p.title}">✕</button></div>`;
    }).join('');
    const body = el.querySelector('.ws-body');
    for (const id of g.panels) {
      const pel = P.get(id).el;
      if (pel.parentNode !== body) body.appendChild(pel);
      pel.hidden = id !== g.active;
    }
    el.classList.toggle('floating', g.where === 'float');
    el.querySelector('.ws-dockbtn').textContent = g.where === 'float' ? '⇲' : '⧉';
    el.querySelector('.ws-dockbtn').title = g.where === 'float' ? `Dock this window (${g.dockTo || 'right'} side)` : 'Float this group as a window';
    if (g.where === 'float') {
      Object.assign(el.style, { left: g.x + 'px', top: g.y + 'px', width: g.w + 'px', height: g.h + 'px', zIndex: g.z, flexGrow: '' });
    } else {
      Object.assign(el.style, { left: '', top: '', width: '', height: '', zIndex: '', flexGrow: g.weight });
    }
    return el;
  }

  function render() {
    // panels that aren't open wait in the store
    for (const [id, p] of P) if (!groupOf(id) && p.el.parentNode !== store) store.appendChild(p.el);
    for (const a of AREAS) {
      const box = $a[a];
      const gs = inArea(a);
      const kids = [];
      gs.forEach((g, i) => {
        if (i) {
          const sp = document.createElement('div');
          sp.className = `ws-gsplit ${COL[a] ? 'v' : 'h'}`;
          sp.dataset.a = gs[i - 1].id;
          sp.dataset.b = g.id;
          kids.push(sp);
        }
        kids.push(groupEl(g));
      });
      box.replaceChildren(...kids);
      box.hidden = !gs.length;
      $split[a].hidden = !gs.length;
      box.style.setProperty('--ws-size', L.areas[a].size + 'px');
    }
    floatLayer.replaceChildren(...L.groups.filter((g) => g.where === 'float').map(groupEl));
    for (const [gid] of groupEls) if (!byId(gid)) groupEls.delete(gid);
    // tell panels what became visible / opened
    const nowOpen = new Set(L.groups.flatMap((g) => g.panels));
    const nowVis = new Set(L.groups.map((g) => g.active));
    for (const [id, p] of P) {
      if (nowOpen.has(id) !== open.has(id)) p.onOpen?.(nowOpen.has(id));
      if (nowVis.has(id) !== visible.has(id)) p.onVisible?.(nowVis.has(id));
    }
    open = nowOpen;
    visible = nowVis;
    window.dispatchEvent(new Event('resize'));
  }

  // ---- pointer interactions ----------------------------------------------------
  let dragging = null;

  root.addEventListener('pointerdown', (e) => {
    const gEl = e.target.closest('.ws-group');
    if (gEl && gEl.classList.contains('floating')) { const g = byId(gEl.dataset.gid); if (g && g.z !== topZ) { g.z = ++topZ; gEl.style.zIndex = g.z; } }
    if (e.button !== 0) return;
    if (e.target.closest('.ws-x, .ws-dockbtn')) return;
    const tab = e.target.closest('.ws-tab');
    const head = e.target.closest('.ws-head');
    if (head && gEl) {
      const g = byId(gEl.dataset.gid);
      if (!g) return;
      if (tab) { g.active = tab.dataset.p; render(); changedSoon(); }
      dragging = { g, panel: tab ? tab.dataset.p : null, x0: e.clientX, y0: e.clientY, started: false, pointerId: e.pointerId, el: gEl };
      return;
    }
    const sp = e.target.closest('.ws-split, .ws-gsplit');
    if (sp) startSplit(e, sp);
  });
  window.addEventListener('pointermove', (e) => {
    const d = dragging;
    if (!d) return;
    if (!d.started) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < DRAG_START) return;
      d.started = true;
      document.body.classList.add('ws-dragging');
      const r = d.el.getBoundingClientRect(), wr = root.getBoundingClientRect();
      // a floating window moved by its header follows the pointer; everything else drags a ghost
      d.move = d.g.where === 'float' && (!d.panel || d.g.panels.length === 1);
      d.off = { x: d.x0 - r.left, y: d.y0 - r.top };
      d.size = { w: d.g.where === 'float' ? d.g.w : Math.min(480, r.width), h: d.g.where === 'float' ? d.g.h : Math.min(380, r.height) };
      if (!d.move) {
        d.ghost = document.createElement('div');
        d.ghost.className = 'ws-ghost';
        d.ghost.textContent = d.panel ? `${P.get(d.panel).icon || ''} ${P.get(d.panel).title}` : d.g.panels.map((id) => P.get(id).title).join(' · ');
        document.body.appendChild(d.ghost);
      }
      d.wr = wr;
    }
    if (d.move) {
      const wr = root.getBoundingClientRect();
      const rect = fitRect({ x: e.clientX - wr.left - d.off.x, y: e.clientY - wr.top - d.off.y, w: d.g.w, h: d.g.h });
      d.g.x = rect.x; d.g.y = rect.y;
      d.el.style.left = rect.x + 'px';
      d.el.style.top = rect.y + 'px';
    } else {
      d.ghost.style.left = e.clientX + 12 + 'px';
      d.ghost.style.top = e.clientY + 8 + 'px';
    }
    d.target = hitTest(e.clientX, e.clientY, d);
    showHint(d.target);
  });
  const endDrag = (e) => {
    const d = dragging;
    if (!d) return;
    dragging = null;
    document.body.classList.remove('ws-dragging');
    d.ghost?.remove();
    hint.hidden = true;
    if (!d.started) return;
    drop(d, e);
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  let soonTimer = null;
  const changedSoon = () => { clearTimeout(soonTimer); soonTimer = setTimeout(() => onSave?.(structuredClone(L)), 300); };

  root.addEventListener('click', (e) => {
    const x = e.target.closest('.ws-x');
    if (x) { e.stopPropagation(); closePanel(x.dataset.close); return; }
    const db = e.target.closest('.ws-dockbtn');
    if (db) toggleFloat(byId(db.closest('.ws-group').dataset.gid));
  });
  root.addEventListener('dblclick', (e) => {
    if (!e.target.closest('.ws-fill')) return;
    toggleFloat(byId(e.target.closest('.ws-group').dataset.gid));
  });

  function toggleFloat(g) {
    if (!g) return;
    if (g.where === 'float') {
      const to = g.dockTo || 'right';
      L.groups = L.groups.filter((x) => x !== g);
      g.where = to;
      L.groups.push(g);
    } else {
      const el = groupEls.get(g.id), wr = root.getBoundingClientRect(), r = el.getBoundingClientRect();
      g.dockTo = g.where;
      Object.assign(g, fitRect({ x: r.left - wr.left + 30, y: r.top - wr.top + 30, w: Math.min(r.width, 520), h: Math.min(r.height, 420) }));
      g.where = 'float';
      g.z = ++topZ;
    }
    changed();
  }

  /** Where would a drop at (x, y) go? */
  function hitTest(x, y, d) {
    const wr = root.getBoundingClientRect();
    const cr = root.querySelector('.ws-center').getBoundingClientRect();
    const self = d.g;
    const solo = !d.panel || self.panels.length === 1; // the whole group is moving
    // 1) edges of the page
    if (x < wr.left + EDGE) return { type: 'area', area: 'left', rect: { left: wr.left, top: wr.top, width: 120, height: wr.height } };
    if (x > wr.right - EDGE) return { type: 'area', area: 'right', rect: { left: wr.right - 120, top: wr.top, width: 120, height: wr.height } };
    if (x > cr.left && x < cr.right && y < cr.top + EDGE && y >= cr.top) return { type: 'area', area: 'top', rect: { left: cr.left, top: cr.top, width: cr.width, height: 90 } };
    if (x > cr.left && x < cr.right && y > cr.bottom - EDGE && y <= cr.bottom) return { type: 'area', area: 'bottom', rect: { left: cr.left, top: cr.bottom - 90, width: cr.width, height: 90 } };
    // 2) floating windows (topmost first), then docked groups
    const cands = [...L.groups].filter((g) => !(solo && g === self))
      .sort((a, b) => (b.where === 'float') - (a.where === 'float') || (b.z || 0) - (a.z || 0));
    for (const g of cands) {
      const el = groupEls.get(g.id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      if (g === self && !solo) return { type: 'tab', gid: g.id, rect: r, same: true };
      if (g.where !== 'float') {
        const along = COL[g.where] ? (y - r.top) / r.height : (x - r.left) / r.width;
        if (along < 0.25 || along > 0.75) {
          const before = along < 0.25;
          const rect = COL[g.where]
            ? { left: r.left, top: before ? r.top : r.top + r.height / 2, width: r.width, height: r.height / 2 }
            : { left: before ? r.left : r.left + r.width / 2, top: r.top, width: r.width / 2, height: r.height };
          return { type: 'split', gid: g.id, before, rect };
        }
      }
      return { type: 'tab', gid: g.id, rect: r };
    }
    return null;
  }
  function showHint(t) {
    if (!t || t.same) { hint.hidden = true; return; }
    const wr = root.getBoundingClientRect();
    hint.hidden = false;
    hint.className = `ws-hint ${t.type}`;
    Object.assign(hint.style, { left: t.rect.left - wr.left + 'px', top: t.rect.top - wr.top + 'px', width: t.rect.width + 'px', height: t.rect.height + 'px' });
  }

  function drop(d, e) {
    const t = d.target;
    const ids = d.panel && d.g.panels.length > 1 ? [d.panel] : [...d.g.panels];
    if (t?.same) return changed();
    if (!t) {
      if (d.move) return changed(); // a window that was moved: it stays where it was dropped
      const wr = root.getBoundingClientRect();
      const rect = { x: e.clientX - wr.left - 40, y: e.clientY - wr.top - 14, ...d.size };
      const from = d.g.where;
      take(d, ids);
      const g = addGroup('float', ids, { rect });
      g.dockTo = AREAS.includes(from) ? from : d.g.dockTo;
      return changed();
    }
    // keep the moving group's object (and its id) when the whole group moves
    if (t.type === 'tab') {
      const into = byId(t.gid);
      take(d, ids);
      into.panels.push(...ids);
      into.active = ids[0];
    } else if (t.type === 'split') {
      const ref = byId(t.gid);
      take(d, ids);
      const idx = L.groups.indexOf(ref) + (t.before ? 0 : 1);
      addGroup(ref.where, ids, { index: idx, weight: ref.weight });
    } else if (t.type === 'area') {
      take(d, ids);
      addGroup(t.area, ids);
    }
    changed();
  }
  /** Remove the dragged panels from their group. */
  function take(d, ids) {
    for (const id of ids) {
      const g = groupOf(id);
      if (!g) continue;
      g.panels = g.panels.filter((p) => p !== id);
      if (g.active === id) g.active = g.panels[0];
      if (!g.panels.length) L.groups = L.groups.filter((x) => x !== g);
    }
  }

  // splitters: area size, or the share between two neighbouring groups
  function startSplit(e, sp) {
    e.preventDefault();
    sp.setPointerCapture(e.pointerId);
    document.body.classList.add('ws-resizing');
    const area = sp.dataset.area;
    let move;
    if (area) {
      const box = $a[area], start = COL[area] ? box.getBoundingClientRect().width : box.getBoundingClientRect().height;
      const sign = area === 'left' || area === 'top' ? 1 : -1;
      const p0 = COL[area] ? e.clientX : e.clientY;
      move = (ev) => {
        const wr = root.getBoundingClientRect();
        const max = COL[area] ? wr.width - 320 : wr.height - 160;
        const size = Math.round(Math.max(COL[area] ? 220 : 90, Math.min(max, start + sign * ((COL[area] ? ev.clientX : ev.clientY) - p0))));
        L.areas[area].size = size;
        box.style.setProperty('--ws-size', size + 'px');
        window.dispatchEvent(new Event('resize'));
      };
    } else {
      const a = byId(sp.dataset.a), b = byId(sp.dataset.b);
      const ea = groupEls.get(a.id), eb = groupEls.get(b.id);
      const col = sp.classList.contains('v');
      const sa = col ? ea.offsetHeight : ea.offsetWidth, sb = col ? eb.offsetHeight : eb.offsetWidth;
      const total = a.weight + b.weight, p0 = col ? e.clientY : e.clientX;
      move = (ev) => {
        const dp = (col ? ev.clientY : ev.clientX) - p0;
        const na = Math.max(60, Math.min(sa + sb - 60, sa + dp));
        a.weight = (total * na) / (sa + sb);
        b.weight = total - a.weight;
        ea.style.flexGrow = a.weight;
        eb.style.flexGrow = b.weight;
        window.dispatchEvent(new Event('resize'));
      };
    }
    const up = () => {
      sp.removeEventListener('pointermove', move);
      sp.removeEventListener('pointerup', up);
      sp.removeEventListener('pointercancel', up);
      document.body.classList.remove('ws-resizing');
      changed();
    };
    sp.addEventListener('pointermove', move);
    sp.addEventListener('pointerup', up);
    sp.addEventListener('pointercancel', up);
  }
  // double-click a splitter: back to the default size
  root.addEventListener('dblclick', (e) => {
    const sp = e.target.closest('.ws-split');
    if (!sp) return;
    const a = sp.dataset.area;
    L.areas[a].size = defaults.areas?.[a]?.size || (COL[a] ? 400 : 220);
    changed();
  });
  // keep floating windows inside when the page shrinks
  let fitTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(() => {
      for (const g of L.groups.filter((x) => x.where === 'float')) {
        const r = fitRect(g);
        if (r.x !== g.x || r.y !== g.y || r.w !== g.w || r.h !== g.h) { Object.assign(g, r); const el = groupEls.get(g.id); if (el) Object.assign(el.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' }); }
      }
    }, 100);
  });

  render();

  return {
    open: openPanel,
    close: closePanel,
    toggle: (id) => (groupOf(id) ? closePanel(id) : openPanel(id)),
    isOpen: (id) => !!groupOf(id),
    isVisible: (id) => !!groupOf(id) && groupOf(id).active === id,
    /** Callbacks: onVisible(bool) when the panel's tab is shown / hidden, onOpen(bool) when it's opened / closed. */
    on(id, { onVisible, onOpen } = {}) {
      const p = P.get(id);
      if (onVisible) { p.onVisible = onVisible; onVisible(visible.has(id)); }
      if (onOpen) { p.onOpen = onOpen; onOpen(open.has(id)); }
    },
    reset() { L = sanitize(structuredClone(defaults)); changed(); },
    layout: () => structuredClone(L),
    panels: () => [...P.values()].map((p) => ({ id: p.id, title: p.title, icon: p.icon, open: !!groupOf(p.id) })),
  };
}
