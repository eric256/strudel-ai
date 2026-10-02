// 🧩 Example plugin: a big bar · beat counter.
// Shows how a plugin adds a panel, a header button and a settings page, follows the player's events, draws with
// the theme's colours and keeps its own settings. (How plugins work: PLUGINS.md.)
export default {
  id: 'bar-counter',
  name: 'Bar counter',
  version: '1.0.0',
  description: 'A big bar · beat display with the song and section, and an optional flash on the first beat. Adds a ⏱ button to the header.',

  setup(api) {
    const { html, render } = api;
    let shown = false, frame = 0;

    const panel = api.addPanel({
      id: 'bars', title: 'Bar counter', icon: '⏱', area: 'bottom',
      onVisible: (v) => { shown = v; cancelAnimationFrame(frame); if (v) tick(); },
    });

    function draw() {
      const playing = api.app.isPlaying();
      const beats = api.app.beatsPerBar();
      const c = api.app.nowCycle();
      const bar = Math.floor(c) + 1, beat = Math.floor((c % 1) * beats) + 1;
      const flash = playing && beat === 1 && api.storage.get('flash', true);
      const song = api.app.song;
      render(html`
        <div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
                    background:${flash ? api.themeAlpha('accent', 0.18) : 'transparent'};transition:background .15s">
          <div style="font:600 44px var(--mono);color:${playing ? 'var(--text)' : 'var(--faint)'}">
            ${playing ? html`${bar}<span style="color:var(--muted)"> · </span><span style="color:var(--accent)">${beat}</span>` : '— · —'}</div>
          <div style="display:flex;gap:6px">${Array.from({ length: beats }, (_, i) => html`
            <i style="width:12px;height:12px;border-radius:50%;background:${playing && i + 1 === beat ? 'var(--accent)' : 'var(--line)'}"></i>`)}</div>
          <div class="muted small">${song ? html`“${song.title}”${api.app.section ? html` · ${api.app.section}` : ''}` : 'no song playing'}</div>
        </div>`, panel.el);
    }
    function tick() { draw(); if (shown) frame = requestAnimationFrame(tick); }
    draw();
    // between frames (or while the panel is hidden) the song and the transport still update it
    api.on('song', draw);
    api.on('transport', draw);

    api.addButton({ icon: '⏱', title: 'Bar counter (🧩 plugin)', onClick: () => panel.open() });

    api.addSettings({
      title: 'Bar counter', icon: '⏱',
      render: (el) => render(html`
        <p class="muted small">From the 🧩 Bar counter plugin.</p>
        <label><input type="checkbox" .checked=${api.storage.get('flash', true)}
          @change=${(e) => api.storage.set('flash', e.target.checked)} /> flash on the first beat of each bar</label>`, el),
    });

    // turned off: stop drawing (the panel, button and settings page are removed for us)
    return () => cancelAnimationFrame(frame);
  },
};
