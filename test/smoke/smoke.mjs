// Browser smoke test: starts the app with a mock AI and walks through the main features in Chromium.
//   npm run smoke            (needs Playwright: npm i -D playwright && npx playwright install chromium,
//                             or PLAYWRIGHT_MODULE=/path/to/node_modules/playwright)
// Exits non-zero on the first failure or any page error.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockAI, log } from './mock-ai.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP_PORT = 3911, AI_PORT = 3912;
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = pw.chromium || pw.default?.chromium;

const ai = await startMockAI(AI_PORT);
const app = spawn(process.execPath, ['server.js'], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(APP_PORT), DATA_DIR: mkdtempSync(path.join(tmpdir(), 'strudel-ai-smoke-')), LLAMACPP_URL: `http://127.0.0.1:${AI_PORT}`, DEFAULT_PROVIDER: 'llamacpp', ANTHROPIC_API_KEY: '' },
});
process.on('exit', () => app.kill()); // never leave the server running
let appLog = '';
app.stderr.on('data', (d) => (appLog += d));
await new Promise((resolve, reject) => {
  app.stdout.on('data', (d) => /http:\/\//.test(String(d)) && resolve());
  app.on('exit', (c) => reject(new Error(`server exited (${c}): ${appLog.slice(-500)}`)));
});

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
let failed = 0;
const step = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed++; console.log(`✗ ${name}: ${e.message}`); }
};
const expect = (ok, msg) => { if (!ok) throw new Error(msg); };
try {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  // no internet in CI: the sample maps get a tiny stand-in, everything else from outside is blocked
  const SAMPLES = '{"_base":"https://x/","bd":["a.wav"],"hh":["a.wav"],"sd":["a.wav"],"RolandTR909_bd":["a.wav"],"RolandTR909_sd":["a.wav"],"RolandTR909_hh":["a.wav"]}';
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => (/\.json($|\?)/.test(r.request().url()) ? r.fulfill({ status: 200, contentType: 'application/json', body: SAMPLES }) : r.abort()));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  const ev = (fn, arg) => p.evaluate(fn, arg);

  await step('the app loads', async () => {
    await p.goto(`http://127.0.0.1:${APP_PORT}/`);
    await p.waitForFunction(() => document.querySelector('strudel-editor')?.editor?.repl && window.strudelAI, null, { timeout: 30000 });
    await p.waitForTimeout(1000);
    expect(await ev(() => document.querySelector('header').getBoundingClientRect().top === 0), 'header not at the top');
  });

  await step('chat changes the code', async () => {
    await ev(() => { const $ = (id) => document.getElementById(id); $('chatTarget').value = 'code'; $('input').value = 'a simple beat'; $('chat-form').requestSubmit(); });
    await p.waitForFunction(() => /lead: note/.test(document.querySelector('strudel-editor').editor.code), null, { timeout: 20000 });
  });

  await step('a new song is written from the chat and plays (band + master style)', async () => {
    await ev(() => { const b = document.getElementById('setBand'); b.value = 'techno rig'; b.onchange(); });
    await ev(() => { const d = document; d.getElementById('chatTarget').value = 'new'; d.getElementById('input').value = 'BAND dark warehouse techno'; d.getElementById('chat-form').requestSubmit(); });
    await p.waitForFunction(() => strudelAI.queue.songs[0]?.status === 'playing', null, { timeout: 40000 });
    const sh = await ev(() => { const s = strudelAI.queue.songs[0]; return { title: s.title, band: s.sheet.band, master: s.sheet.master, pad: s.sheet.parts.find((x) => x.id === 'pad').sound }; });
    expect(sh.title === 'Smoke Signal', `title ${sh.title}`);
    expect(sh.band === 'techno rig' && sh.master === 'techno', `band ${sh.band} / master ${sh.master}`);
    expect(sh.pad === 'gm_pad_sweep', `the band's pad, got ${sh.pad}`);
    const req = log.find((x) => x.kind === 'sheet');
    expect(/SOUND GUIDE/.test(req.sys) && /BAND — write the song for this band/.test(req.last), 'the sheet request has the band and the sound guide');
  });

  await step('now playing shows the sections and the master style', async () => {
    await p.waitForTimeout(1000);
    const v = await ev(() => ({ secs: document.querySelectorAll('#nowSongView .sv-sections > *').length, chip: document.querySelector('#nowSongView .master-chip')?.textContent }));
    expect(v.secs >= 4, `sections shown: ${v.secs}`);
    expect(/techno/.test(v.chip || ''), `master chip: ${v.chip}`);
  });

  await step('player events: sections switch on time and Now playing follows', async () => {
    await ev(() => { window.__events = []; strudelAI.player.on('*', (e, d) => window.__events.push([e, performance.now(), d?.step?.prompt || d?.song?.title || d?.state || ''])); });
    // the intro is 4 bars at 120 bpm (8 s): wait for the next section
    await p.waitForFunction(() => window.__events.some(([e]) => e === 'section'), null, { timeout: 15000 });
    await p.waitForTimeout(100);
    const r = await ev(() => {
      const st = strudelAI.engine.steps.find((x) => x.status === 'playing');
      const i = strudelAI.engine.steps.indexOf(st);
      const row = document.querySelector(`#nowSongView .sv-left[data-i="${i}"]`);
      return { prompt: st?.prompt, row: !!row, text: row?.textContent || '', late: (performance.now() - window.__events.find(([e]) => e === 'section')[1]) };
    });
    expect(r.row, `the playing section (${r.prompt}) has no progress row`);
    expect(/^bar \d+\/\d+/.test(r.text), `progress text: "${r.text}"`);
  });

  await step('⏸ pause and ▶ resume', async () => {
    await ev(() => document.getElementById('nowPause').click());
    await p.waitForTimeout(400);
    const paused = await ev(() => ({ p: !!strudelAI.engine.paused, playing: document.querySelector('strudel-editor').editor.repl.scheduler.started, ev: window.__events.some(([e, , d]) => e === 'transport' && d === 'paused'), txt: [...document.querySelectorAll('#nowSongView .sv-left')].map((e) => e.textContent).join('|') }));
    expect(paused.p && !paused.playing && paused.ev, JSON.stringify(paused));
    expect(/paused at bar/.test(paused.txt), `paused text: ${paused.txt}`);
    await ev(() => document.getElementById('play').click());
    await p.waitForFunction(() => document.querySelector('strudel-editor').editor.repl.scheduler.started && !strudelAI.engine.paused, null, { timeout: 5000 });
  });

  await step('templates: titles are text (escaped), and an opened section stays open while the view updates', async () => {
    await ev(() => { const sg = strudelAI.queue.songs[strudelAI.queue.current]; window.__realTitle = sg.title; sg.title = '<img src=x onerror="window.__xss=1">Bold'; strudelAI.player.emit('songs'); });
    await p.waitForTimeout(400);
    const esc = await ev(() => ({ xss: !!window.__xss, img: !!document.querySelector('#nowSongView .sv-head img, #playlist img'), text: document.querySelector('#nowSongView .sv-head b').textContent }));
    await ev(() => { strudelAI.queue.songs[strudelAI.queue.current].title = window.__realTitle; strudelAI.player.emit('songs'); });
    expect(!esc.xss && !esc.img && esc.text.startsWith('<img'), `not escaped: ${JSON.stringify(esc)}`);
    await ev(() => { const d = document.querySelector('#nowSongView details.step'); d.open = true; window.__det = d; });
    await p.waitForTimeout(2500); // several renders (events + the 1 s safety render)
    expect(await ev(() => window.__det.isConnected && window.__det.open), 'the opened section was rebuilt or closed');
  });

  await step('the mixer shows every part', async () => {
    await ev(() => strudelAI.ws.open('mixer'));
    await p.waitForTimeout(800);
    const names = await ev(() => [...document.querySelectorAll('#mixerStrips .mx-strip')].map((s) => s.dataset.base));
    for (const n of ['drums', 'bass', 'pad', 'hook', '__master']) expect(names.includes(n), `no ${n} strip (${names})`);
  });

  await step('the master chain is on the output and follows the song', async () => {
    await ev(() => strudelAI.ws.open('master'));
    await p.waitForTimeout(800);
    const m = await ev(() => ({ installed: !!globalThis.getSuperdoughAudioController().output.channelMerger.__master, style: strudelAI.master.style, controls: document.querySelectorAll('#masterBody input[type=range]').length }));
    expect(m.installed, 'chain not installed');
    expect(m.style === 'techno', `style ${m.style}`);
    expect(m.controls === 16, `controls ${m.controls}`);
    const peak = await ev(async () => { const a = strudelAI.master.chain.analyser, b = new Float32Array(2048); let x = 0; for (let i = 0; i < 15; i++) { a.getFloatTimeDomainData(b); for (const v of b) x = Math.max(x, Math.abs(v)); await new Promise((r) => setTimeout(r, 100)); } return x; });
    expect(peak > 0.01, `no sound through the master (peak ${peak})`);
  });

  await step('⏭ next and ⏮ previous song', async () => {
    await ev(() => { const d = document; d.getElementById('chatTarget').value = 'new'; d.getElementById('input').value = 'a second song'; d.getElementById('chat-form').requestSubmit(); });
    await p.waitForFunction(() => strudelAI.queue.songs.length === 2 && strudelAI.queue.songs[1].status === 'ready', null, { timeout: 30000 });
    await ev(() => document.getElementById('nextSong').click());
    await p.waitForFunction(() => strudelAI.queue.current === 1, null, { timeout: 15000 });
    expect(await ev(() => window.__events.some(([e]) => e === 'song')), 'no song event');
    await ev(() => document.getElementById('prevSong').click());
    await p.waitForFunction(() => strudelAI.queue.current === 0, null, { timeout: 20000 });
    await p.waitForFunction(() => /^▶ /.test(document.getElementById('nowLine').textContent), null, { timeout: 3000 });
  });

  await step('📃 playlist: a station joins without stopping the song; ■ Stop keeps its written songs; ＋ Playlist, move, remove', async () => {
    const before = await ev(() => ({ title: strudelAI.queue.songs[strudelAI.queue.current]?.title, current: strudelAI.queue.current }));
    expect(before.title, 'nothing playing before the station starts');
    await ev(() => { strudelAI.ws.open('station'); document.getElementById('stationStart').click(); });
    await p.waitForTimeout(1500);
    const during = await ev(() => ({ running: strudelAI.queue.running, current: strudelAI.queue.current, playing: document.querySelector('strudel-editor').editor.repl.scheduler.started, station: !!strudelAI.queue.station }));
    expect(during.running && during.playing && during.station && during.current === before.current, `the song was interrupted: ${JSON.stringify(during)}`);
    // its songs join the end of the playlist and are written in the background
    await p.waitForFunction(() => strudelAI.queue.songs.some((s) => s.from === 'station' && s.blocks?.length), null, { timeout: 40000 });
    // switch to another station: nothing stops
    await ev(() => { const sel = document.getElementById('stationSelect'); sel.value = '1'; sel.onchange(); document.getElementById('stationStart').click(); });
    expect(await ev(() => strudelAI.queue.station?.name === document.getElementById('stationSelect').selectedOptions[0].textContent), 'did not switch station');
    // ■ Stop: no new songs; written ones stay, only-named ones go; the music keeps playing
    await ev(() => document.getElementById('stationStop').click());
    const after = await ev(() => ({ station: strudelAI.queue.station, written: strudelAI.queue.songs.filter((s, k) => k > strudelAI.queue.current && s.from === 'station' && s.blocks?.length).length, named: strudelAI.queue.songs.filter((s, k) => k > strudelAI.queue.current && s.from === 'station' && s.status === 'waiting' && !s.blocks).length, playing: document.querySelector('strudel-editor').editor.repl.scheduler.started }));
    expect(!after.station && after.playing && after.written >= 1 && after.named === 0, `after stop: ${JSON.stringify(after)}`);
    // ＋ Playlist from This session, then move it up and remove it in the 📃 Playlist panel
    await ev(() => strudelAI.ws.open('playlist'));
    const n = await ev(() => strudelAI.queue.songs.length);
    await ev(() => strudelAI.addToPlaylist(strudelAI.sessionSongs[0], { at: 'end' }));
    await p.waitForTimeout(300);
    expect(await ev(() => strudelAI.queue.songs.length) === n + 1, 'not added');
    const last = n;
    await ev((k) => document.querySelector(`#playlist .pl-row[data-k="${k}"] [data-pl="up"]`).click(), last);
    await p.waitForTimeout(300);
    const moved = await ev((k) => strudelAI.queue.songs[k - 1].copyOf === strudelAI.sessionSongs[0], last);
    expect(moved, 'not moved up');
    await ev((k) => document.querySelector(`#playlist .pl-row[data-k="${k - 1}"] [data-pl="remove"]`).click(), last);
    await p.waitForTimeout(300);
    expect(await ev(() => strudelAI.queue.songs.length) === n, 'not removed');
  });

  await step('✎ song editor: master, section bars, the arrangement grid, a new section and part, ✓ apply (live)', async () => {
    await ev(() => { window.__edited = strudelAI.queue.songs[strudelAI.queue.current]; document.querySelector('#nowSongView [data-act="edit"]').click(); });
    await p.waitForFunction(() => document.querySelectorAll('#editForm .se-sec').length >= 2, null, { timeout: 5000 });
    const change = (sel, v) => ev(([sel, v]) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('change')); }, [sel, v]);
    // master → dub
    await ev(() => { const s = [...document.querySelectorAll('#editForm .se-head select')][1]; s.value = 'dub'; s.dispatchEvent(new Event('change')); });
    // the chorus: 8 bars
    await ev(() => [...document.querySelectorAll('#editForm .se-sec')].find((x) => /chorus/.test(x.querySelector('b').textContent)).click());
    await change('#editForm .se-selrow .se-num', '8');
    // the grid: the first part switched on (or off) in the first section
    const before = await ev(() => document.querySelector('#editForm .se-grid tbody tr .se-cell').className);
    await ev(() => document.querySelector('#editForm .se-grid tbody tr .se-cell').click());
    expect(await ev(() => document.querySelector('#editForm .se-grid tbody tr .se-cell').className) !== before, 'the grid cell did not change');
    // a new section (a copy of the last one) and a new part with starter code
    await ev(() => document.querySelector('#editForm .se-add').click());
    await ev(() => [...document.querySelectorAll('#editForm .se-parts > .link')].find((b) => /part/.test(b.textContent)).click());
    expect(await ev(() => /const part_main = /.test([...document.querySelectorAll('#editForm .se-def textarea')].map((t) => t.value).join())), 'the new part has no starter code');
    expect(await ev(() => /changed/.test(document.querySelector('#editForm .se-msg').textContent) || /new part/.test(document.querySelector('#editForm .se-msg').textContent)), 'no "changed" note');
    await ev(() => document.querySelector('#editForm .se-apply').click());
    await p.waitForFunction(() => /applied|⚠/.test(document.querySelector('#editForm .se-msg')?.textContent || ''), null, { timeout: 15000 });
    const msg = await ev(() => document.querySelector('#editForm .se-msg').textContent);
    expect(/applied/.test(msg), msg);
    const s = await ev(() => { const sh = window.__edited.sheet; return { master: sh.master, chorus: sh.sections.find((x) => x.name === 'chorus').bars, sections: sh.sections.length, part: sh.parts.some((x) => x.id === 'part'), lib: /const part_main/.test(window.__edited.library) }; });
    expect(s.master === 'dub' && s.chorus === 8 && s.part && s.lib, JSON.stringify(s));
  });

  await step('a song that can\'t be written is marked ✗ with ↻ Try again (no block-by-block fallback)', async () => {
    const before = log.filter((x) => x.kind === 'code').length;
    await ev(() => { const d = document; d.getElementById('chatTarget').value = 'new'; d.getElementById('input').value = 'FAILSHEET a doomed song'; d.getElementById('chat-form').requestSubmit(); });
    await p.waitForFunction(() => strudelAI.queue.songs.some((s) => s.status === 'failed'), null, { timeout: 40000 });
    expect(log.filter((x) => x.kind === 'code').length === before, 'the song was written block by block');
    const k = await ev(() => strudelAI.queue.songs.findIndex((s) => s.status === 'failed'));
    const row = await ev(() => strudelAI.sessionSongs.findIndex((s) => s.status === 'failed'));
    await ev(() => strudelAI.ws.open('songs'));
    await ev((r) => document.querySelector(`#setStatus [data-k="${r}"]`)?.click(), row);
    await p.waitForTimeout(400);
    expect(await ev(() => !!document.querySelector('#setStatus [data-act="retry"]')), 'no ↻ Try again button');
    await ev(() => document.querySelector('#setStatus [data-act="retry"]').click());
    await p.waitForFunction((k) => strudelAI.queue.songs[k].status === 'playing', k, { timeout: 40000 });
  });

  await step('an old block-format song (saved before song sheets) still loads and plays', async () => {
    await ev(() => {
      const sg = strudelAI.songFromJSON({ format: 'strudel-ai-song', title: 'Old Blocks', steps: [
        { bars: 2, prompt: 'intro', code: 'setcpm(120/4)\npads: note("c3 e3").s("triangle").gain(0.2)' },
        { bars: 2, prompt: 'groove', code: 'setcpm(120/4)\ndrums: note("c5*4").s("square").decay(0.05).sustain(0).gain(0.3)' }] });
      strudelAI.playSong(sg);
    });
    await p.waitForFunction(() => strudelAI.queue.songs.some((s) => s.title === 'Old Blocks' && s.status === 'playing'), null, { timeout: 20000 });
    await p.waitForFunction(() => /^▶ Old Blocks/.test(document.getElementById('nowLine').textContent), null, { timeout: 5000 });
  });

  await step('settings: forms and bands editors open', async () => {
    await ev(() => document.querySelector('.bands-edit').click());
    await p.waitForTimeout(300);
    expect(await ev(() => document.getElementById('bandSelect').options.length >= 13), 'no bands');
    await ev(() => document.querySelector('.settings-tabs [data-sec="setForms"]').click());
    expect(await ev(() => document.getElementById('formSelect').options.length >= 10), 'no forms');
    await ev(() => document.getElementById('settingsDlg').close());
  });

  await step('🎨 themes: pick, edit (saves your own), export, import, back to dark', async () => {
    await ev(() => { document.getElementById('settingsBtn')?.click(); document.querySelector('.settings-tabs [data-sec="setTheme"]').click(); });
    await p.waitForTimeout(200);
    expect(await ev(() => document.querySelectorAll('#themeList .th-card').length >= 5), 'no theme cards');
    await ev(() => [...document.querySelectorAll('#themeList .th-card')].find((b) => /Light/.test(b.textContent)).click());
    expect(await ev(() => document.documentElement.dataset.theme === 'light' && getComputedStyle(document.body).backgroundColor === 'rgb(238, 240, 244)'), 'light did not apply');
    expect(await ev(() => getComputedStyle(document.querySelector('.dv-groupview')).backgroundColor === 'rgb(255, 255, 255)'), 'dockview panels did not follow the theme');
    // change a colour: a built-in theme becomes your own copy
    await ev(() => { const i = document.querySelector('#themeEditor .th-token[title="--accent"] input'); i.value = '#ff0000'; i.dispatchEvent(new Event('change')); });
    expect(await ev(() => document.documentElement.dataset.theme.startsWith('user-') && getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === '#ff0000'), 'the edit did not make a user theme');
    const [dl] = await Promise.all([p.waitForEvent('download'), ev(() => [...document.querySelectorAll('#themeEditor button')].find((b) => /export/.test(b.textContent)).click())]);
    const file = await dl.path();
    expect(JSON.parse(await (await import('node:fs/promises')).readFile(file, 'utf8')).colors.accent === '#ff0000', 'export lacks the colour');
    await p.setInputFiles('#themeEditor input[type=file]', file);
    await p.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem('strudel-ai:v1')).userThemes).length === 2, null, { timeout: 5000 });
    await ev(() => [...document.querySelectorAll('#themeList .th-card')].find((b) => /^Dark/.test(b.textContent.trim())).click());
    expect(await ev(() => document.documentElement.dataset.theme === 'dark'), 'dark did not apply');
    await ev(() => document.getElementById('settingsDlg').close());
  });

  await step('🧩 plugins: the examples add a panel, button, settings page, theme, band and AI hint; off removes them; installs; a template override', async () => {
    await ev(() => { document.getElementById('settingsBtn').click(); document.querySelector('.settings-tabs [data-sec="setPlugins"]').click(); });
    await p.waitForFunction(() => document.querySelectorAll('.plugin-card').length >= 2 && strudelAI.plugins().every((x) => x.id), null, { timeout: 10000 });
    const toggle = (name) => ev((n) => [...document.querySelectorAll('.plugin-card')].find((x) => x.textContent.includes(n)).querySelector('input').click(), name);
    await toggle('Bar counter'); await toggle('Paper pack');
    await p.waitForFunction(() => strudelAI.plugins().filter((x) => x.on).length === 2, null, { timeout: 5000 });
    const on = await ev(async () => ({
      button: !!document.querySelector('#pluginButtons button'),
      panel: strudelAI.ws.panels().some((x) => x.id === 'bar-counter.bars'),
      settings: !!document.querySelector('.settings-tabs [data-sec^="setPlugin-bar-counter"]'),
      band: strudelAI.getBands().some((b) => b.name === 'Paper Strings'),
      theme: !!(await import('/theme.js')).allThemes()['paper-pack.paper'],
      hint: /comment above it/.test((await import('/features/plugins.js')).promptHints('code')),
    }));
    for (const [k, v] of Object.entries(on)) expect(v, `the plugin's ${k} is missing`);
    await ev(() => document.querySelector('#pluginButtons button').click());
    await p.waitForFunction(() => strudelAI.ws.isOpen('bar-counter.bars') && /·/.test(document.querySelector('.plugin-panel')?.textContent || ''), null, { timeout: 5000 });
    await toggle('Bar counter'); await toggle('Paper pack');
    const off = await ev(async () => ({ button: !!document.querySelector('#pluginButtons button'), panel: strudelAI.ws.panels().some((x) => x.id === 'bar-counter.bars'), hint: (await import('/features/plugins.js')).promptHints('code') }));
    expect(!off.button && !off.panel && !off.hint, `turning off left ${JSON.stringify(off)}`);
    // install: a broken plugin is turned off with its error; a working one starts
    const fs = await import('node:fs/promises'), os = await import('node:os'), path = await import('node:path');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plug-'));
    await fs.writeFile(path.join(dir, 'broken.js'), 'export default { id: "broken", setup() { throw new Error("boom"); } };');
    await fs.writeFile(path.join(dir, 'hello.js'), 'export default { id: "hello", name: "Hello", setup(api) { api.addButton({ icon: "👋", onClick: () => api.message("hello") }); '
      + 'api.overrideTemplate("playlistRow", (original) => (row, act) => api.html`<div class="hello-row">👋 ${original(row, act)}</div>`); } };');
    await p.setInputFiles('#pluginList input[type=file]', path.join(dir, 'broken.js'));
    await p.waitForFunction(() => strudelAI.plugins().some((x) => x.src === 'installed:broken.js' && !x.on && /boom/.test(x.error)), null, { timeout: 5000 });
    await p.setInputFiles('#pluginList input[type=file]', path.join(dir, 'hello.js'));
    await p.waitForFunction(() => strudelAI.plugins().some((x) => x.id === 'hello' && x.on) && document.querySelector('#pluginButtons button')?.textContent === '👋', null, { timeout: 5000 });
    // its template override shows straight away (the playlist re-renders), wrapping the built-in row
    await p.waitForFunction(() => document.querySelector('#playlist .hello-row .pl-row'), null, { timeout: 5000 });
    p.once('dialog', (d) => d.accept());
    await ev(() => [...document.querySelectorAll('.plugin-card')].find((x) => x.textContent.includes('Hello')).querySelector('button.link').click());
    await p.waitForFunction(() => !strudelAI.plugins().some((x) => x.id === 'hello') && !document.querySelector('#pluginButtons button'), null, { timeout: 5000 });
    await p.waitForFunction(() => !document.querySelector('#playlist .hello-row') && document.querySelector('#playlist .pl-row'), null, { timeout: 5000 });
    await ev(() => document.getElementById('settingsDlg').close());
  });

  await step('every panel opens (visualizer, keys, pads, console …)', async () => {
    const ids = await ev(() => strudelAI.ws.panels().map((x) => x.id));
    for (const id of ids) { await ev((id) => strudelAI.ws.open(id), id); await p.waitForTimeout(150); }
    expect(await ev(() => strudelAI.ws.panels().every((x) => x.open)), 'a panel did not open');
  });

  await step('keys play a note; a pad toggles its line into the code', async () => {
    await ev(() => { strudelAI.noteOn(60); });
    await p.waitForTimeout(200);
    await ev(() => strudelAI.noteOff(60));
    await ev(() => document.querySelector('#padsGrid .pad[data-i="0"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    await p.waitForTimeout(100);
    await ev(() => document.querySelector('#padsGrid .pad[data-i="0"]').dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
    await p.waitForFunction(() => strudelAI.padsState.pending.size > 0 || /^pad1:/m.test(document.querySelector('strudel-editor').editor.code), null, { timeout: 5000 });
  });

  await step('🌀 Hydra visuals show in their panel, then behind the code, and stop', async () => {
    await ev(() => { const w = document.getElementById('hydraWhere'); w.value = 'panel'; w.onchange(); const h = document.getElementById('hydraMode'); h.value = 'kaleido'; h.onchange(); });
    await p.waitForFunction(() => document.getElementById('hydra-canvas')?.parentElement?.id === 'hydraStage' && strudelAI.ws.isOpen('hydra'), null, { timeout: 15000 });
    expect(await ev(() => document.getElementById('hydra-canvas').getBoundingClientRect().height > 50), 'the Hydra canvas has no size in its panel');
    // the presets' inputs are numbers (Strudel's own H() handed Hydra the pattern's text, so it drew nothing)
    const hv = await ev(() => ({ h: globalThis.H('<4 5 6>')(), l: globalThis.L() }));
    expect([4, 5, 6].includes(hv.h) && hv.l >= 0 && hv.l <= 1, `H() / L(): ${JSON.stringify(hv)}`);
    await ev(() => { const w = document.getElementById('hydraWhere'); w.value = 'code'; w.onchange(); });
    expect(await ev(() => document.getElementById('hydra-canvas').parentElement.classList.contains('ws-center') && document.body.classList.contains('hydra-behind')), 'Hydra did not move behind the code');
    await ev(() => { const w = document.getElementById('hydraWhere'); w.value = 'panel'; w.onchange(); const h = document.getElementById('hydraMode'); h.value = 'off'; h.onchange(); });
    expect(await ev(() => !document.getElementById('hydra-canvas') && !document.body.classList.contains('hydra-on')), 'Hydra did not stop');
  });

  await step('panels float over the layout and dock back (header buttons ⧉ ⇲ ↗ ⛶)', async () => {
    await ev(() => strudelAI.ws.open('mixer'));
    await p.waitForTimeout(200);
    const where = () => ev(() => strudelAI.ws.api.getPanel('mixer').group.api.location.type);
    const headerHas = (label) => ev((l) => [...strudelAI.ws.api.getPanel('mixer').group.element.querySelectorAll('.dv-act')].some((b) => b.textContent === l), label);
    expect(await headerHas('⧉') && await headerHas('↗'), 'the mixer header has no float / pop-out buttons');
    await ev(() => [...strudelAI.ws.api.getPanel('mixer').group.element.querySelectorAll('.dv-act')].find((b) => b.textContent === '⧉').click());
    await p.waitForFunction(() => strudelAI.ws.api.getPanel('mixer').group.api.location.type === 'floating', null, { timeout: 3000 });
    expect(await headerHas('⇲'), 'a floating panel has no dock button');
    await ev(() => [...strudelAI.ws.api.getPanel('mixer').group.element.querySelectorAll('.dv-act')].find((b) => b.textContent === '⇲').click());
    await p.waitForFunction(() => strudelAI.ws.api.getPanel('mixer').group.api.location.type === 'grid', null, { timeout: 3000 });
    expect(await where() === 'grid', 'the mixer did not dock back');
  });

  await step('📁 save to My songs, 🔗 share link, ⏺ MP3 start / stop', async () => {
    await ev(() => strudelAI.ws.open('song'));
    await ev(() => document.querySelector('#nowSongView [data-act="save"]')?.click());
    await p.waitForFunction(() => strudelAI.mySongs.length >= 1, null, { timeout: 5000 });
    await ev(() => document.querySelector('#nowSongView [data-act="link"]')?.click());
    await p.waitForFunction(() => strudelAI.mySongs.concat(strudelAI.queue.songs).some((s) => s.shareUrl), null, { timeout: 10000 });
    await ev(() => document.getElementById('mp3Btn').click());
    await p.waitForTimeout(1200);
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), ev(() => document.getElementById('mp3Btn').click())]);
    expect(/\.mp3$/.test(dl.suggestedFilename()), `mp3 file ${dl.suggestedFilename()}`);
  });

  await step('🔗 a share link opens the song in a new tab', async () => {
    const { url, title } = await ev(() => { const sg = strudelAI.mySongs.concat(strudelAI.queue.songs).find((s) => s.shareUrl); return { url: sg.shareUrl, title: sg.title }; });
    const p2 = await ctx.newPage();
    p2.on('pageerror', (e) => errors.push(`(share tab) ${e.message}`));
    await p2.goto(url.replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${APP_PORT}`));
    await p2.waitForFunction((t) => window.strudelAI?.sessionSongs.some((s) => s.title === t && s.blocks?.length), title, { timeout: 20000 });
    await p2.close();
  });

  await step('📻 the station plans songs and plays them', async () => {
    await ev(() => { document.getElementById('stop').click(); strudelAI.ws.open('station'); });
    await p.waitForTimeout(500);
    await ev(() => document.getElementById('stationStart').click());
    await p.waitForFunction(() => strudelAI.queue.station && strudelAI.queue.songs.some((s) => s.from === 'station' && s.status === 'playing'), null, { timeout: 40000 });
    expect(log.some((x) => x.kind === 'songs'), 'the station did not ask for songs');
    await ev(() => document.getElementById('stationStop').click());
  });

  await step('📃 a song that played (or is playing) keeps its buttons in the playlist: ⬇ MP3 once recorded, ★, JSON, link', async () => {
    await ev(() => strudelAI.ws.open('playlist'));
    // a finished recording (as mp3.js leaves it) on the playing song
    await ev(() => { const sg = strudelAI.queue.songs[strudelAI.queue.current]; sg.take = { url: 'blob:smoke', name: 'smoke.mp3', secs: 42, size: 1e6 }; strudelAI.player.emit('songs'); });
    await p.waitForFunction(() => [...document.querySelectorAll('#playlist .pl-row.now .pl-tools button')].some((b) => /⬇ MP3/.test(b.textContent)), null, { timeout: 3000 });
    const played = await ev(() => [...document.querySelectorAll('#playlist .pl-row.played')].map((r) => r.querySelectorAll('.pl-tools button').length));
    expect(played.every((n) => n >= 2), `a played song has no buttons: ${played}`);
    expect(await ev(() => document.querySelectorAll('#playlist .pl-row.up .pl-tools').length === 0), 'upcoming songs should not have the played-song buttons');
  });

  await step('dynamics: a solo section brings its part forward; a hard ending leaves a bar of silence; the feel humanizes the parts', async () => {
    // a written song playing, open in the song editor
    await ev(() => { strudelAI.ws.open('song'); });
    await p.waitForFunction(() => strudelAI.queue.running && strudelAI.queue.songs[strudelAI.queue.current]?.sheet && document.querySelector('#nowSongView [data-act="edit"]'), null, { timeout: 30000 });
    await ev(() => document.querySelector('#nowSongView [data-act="edit"]').click());
    await p.waitForFunction(() => document.querySelectorAll('#editForm .se-sec').length >= 2, null, { timeout: 5000 });
    await ev(() => { const s = [...document.querySelectorAll('#editForm .se-head select')].find((x) => [...x.options].some((o) => o.value === 'cut')); s.value = 'cut'; s.dispatchEvent(new Event('change')); });
    // the feel: how loosely the band plays (humanized dynamics and timing on every part)
    await ev(() => { const i = [...document.querySelectorAll('#editForm .se-head .se-num')].find((x) => x.max === '100'); i.value = '70'; i.dispatchEvent(new Event('change')); });
    await ev(() => document.querySelectorAll('#editForm .se-sec')[1].click());
    await ev(() => { const s = [...document.querySelectorAll('#editForm .se-selrow select')].find((x) => [...x.options].some((o) => o.value === '')); s.value = s.options[1].value; s.dispatchEvent(new Event('change')); });
    await ev(() => { const i = [...document.querySelectorAll('#editForm .se-selrow .se-num')].find((x) => x.max === '130'); i.value = '80'; i.dispatchEvent(new Event('change')); });
    await ev(() => document.querySelector('#editForm .se-apply').click());
    await p.waitForFunction(() => /applied|⚠/.test(document.querySelector('#editForm .se-msg')?.textContent || ''), null, { timeout: 15000 });
    const sg = await ev(() => { const x = strudelAI.queue.songs[strudelAI.queue.current]; return { ending: x.sheet.ending, solo: x.sheet.sections[1].solo, level: x.sheet.sections[1].level, gap: !!x.blocks[x.blocks.length - 1].gap, feel: x.sheet.feel, felt: /\.mul\(velocity\(rand/.test(x.blocks[0].code) }; });
    expect(sg.ending === 'cut' && sg.solo && sg.level === 0.8 && sg.gap, `the sheet: ${JSON.stringify(sg)}`);
    expect(sg.feel === 0.7 && sg.felt, `the feel is in the sheet and the parts' code: ${JSON.stringify(sg)}`);
    // go to the solo section: the mixer brings its part forward
    await ev(() => [...document.querySelectorAll('#editForm .se-selrow button')].find((b) => /go/.test(b.textContent)).click());
    await p.waitForFunction((part) => strudelAI.mixer.lead === part, sg.solo, { timeout: 15000 });
    // go to the last section: then the bar of silence plays
    await ev(() => { const secs = document.querySelectorAll('#editForm .se-sec'); secs[secs.length - 1].click(); });
    await ev(() => [...document.querySelectorAll('#editForm .se-selrow button')].find((b) => /go/.test(b.textContent)).click());
    await p.waitForFunction(() => strudelAI.engine.steps.some((st) => st.gap && st.status === 'playing') || !strudelAI.queue.running || strudelAI.queue.songs[strudelAI.queue.current]?.blocks?.[0]?.status === 'playing', null, { timeout: 30000 });
    expect(await ev(() => strudelAI.mixer.lead === null), 'the solo did not end');
  });

  await step('stop', async () => {
    await ev(() => document.getElementById('stop').click());
    await p.waitForTimeout(500);
    expect(await ev(() => !strudelAI.queue.running || !document.querySelector('strudel-editor').editor.repl.scheduler.started), 'still playing');
  });

  await step('🐞 the debug log downloads with the problems and context', async () => {
    await ev(() => { console.warn('smoke: a test warning'); strudelAI.ws.open('console'); });
    await p.waitForTimeout(300);
    const [dl] = await Promise.all([p.waitForEvent('download'), ev(() => document.getElementById('consoleDownload').click())]);
    expect(/^strudel-ai-debug-\d{12}\.txt$/.test(dl.suggestedFilename()), `file name ${dl.suggestedFilename()}`);
    const text = await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8');
    for (const want of ['== SUMMARY:', 'smoke: a test warning', '== APP ==', '== SONG SHEET ==', '== CODE IN THE EDITOR ==', '== FULL LOG', '“Smoke Signal”']) expect(text.includes(want), `missing ${want}`);
  });

  await step('modes: 📻 Radio → ⌨ Jam → 🎼 Studio → 📻 Radio; switching stops the music, each mode has its layout, chat targets and code', async () => {
    // something playing in Radio
    await ev(() => { const sg = strudelAI.mySongs[0]; if (sg) strudelAI.playSong(sg); });
    await p.waitForFunction(() => document.querySelector('strudel-editor').editor.repl.scheduler.started, null, { timeout: 20000 });
    const state = () => ev(() => ({
      mode: strudelAI.currentMode(), playing: !!document.querySelector('strudel-editor').editor.repl.scheduler.started, running: strudelAI.queue.running,
      open: strudelAI.ws.panels().filter((x) => x.open).map((x) => x.id), target: document.getElementById('chatTarget').value,
      targets: [...document.getElementById('chatTarget').options].filter((o) => !o.hidden).map((o) => o.value), code: document.querySelector('strudel-editor').editor.code,
    }));
    await ev(() => document.querySelector('#modeSwitch [data-mode="jam"]').click());
    let st = await state();
    expect(st.mode === 'jam' && !st.playing && !st.running, `Jam: the music didn't stop ${JSON.stringify(st)}`);
    expect(st.target === 'code' && !st.targets.includes('song') && !st.targets.includes('new'), `Jam chat targets: ${st.targets}`);
    expect(!st.open.includes('song') && st.open.includes('chat'), `Jam layout: ${st.open}`);
    expect(/⌨ Jam|setcpm/.test(st.code), 'Jam did not load its code');
    // the mixer in Jam: only the parts in the code
    await ev(() => document.querySelector('strudel-editor').editor.setCode('setcpm(120/4)\nkick: s("bd*4")\nhats: s("hh*8").gain(0.4)'));
    await ev(() => strudelAI.ws.open('mixer'));
    await p.waitForFunction(() => strudelAI.mixerChannels().map((c) => c.base).join() === 'kick,hats', null, { timeout: 3000 });
    // Jam keeps its code across a switch
    await ev(() => document.querySelector('#modeSwitch [data-mode="studio"]').click());
    st = await state();
    expect(st.mode === 'studio' && st.target === 'song' && st.open.includes('edit') && st.open.includes('song'), `Studio: ${JSON.stringify(st)}`);
    await ev(() => document.querySelector('#modeSwitch [data-mode="jam"]').click());
    expect(/kick: s\("bd\*4"\)/.test((await state()).code), 'Jam lost its code');
    await ev(() => document.querySelector('#modeSwitch [data-mode="radio"]').click());
    st = await state();
    expect(st.mode === 'radio' && st.targets.includes('new') && st.open.includes('station'), `Radio: ${JSON.stringify(st)}`);
  });

  await step('🎼 Studio: a song described in the chat is written and opened in ✎ Edit song; chat edits change it (even when it has finished)', async () => {
    await ev(() => strudelAI.setMode('studio'));
    await ev(() => { document.querySelector('#editForm .se-head button.link:last-child')?.click(); });
    await ev(() => { const s = document.getElementById('chatTarget'); s.value = 'song'; s.dispatchEvent(new Event('change')); });
    // no song open: the message describes a new one (not a code change)
    const codeReqs = log.filter((x) => x.kind === 'code').length;
    await ev(() => { document.getElementById('input').value = 'a celtic jig with a fiddle'; document.getElementById('chat-form').requestSubmit(); });
    await p.waitForFunction(() => document.querySelectorAll('#editForm .se-sec').length >= 2 && !!strudelAI.activeSong(), null, { timeout: 40000 });
    expect(log.filter((x) => x.kind === 'code').length === codeReqs, 'Studio sent the message as a code change');
    const target = await ev(() => document.getElementById('chatTarget').value);
    expect(target === 'song', `the chat target after a new song: ${target}`);
    // the song plays to its end (the playlist finishes): a chat edit still adds its sections — to the sheet, the
    // arrangement and the editor (all its sections had been played, so none were re-arranged before)
    await ev(() => { const secs = document.querySelectorAll('#editForm .se-sec'); secs[secs.length - 1].click(); });
    await ev(() => [...document.querySelectorAll('#editForm .se-selrow button')].find((b) => /go/.test(b.textContent)).click());
    await p.waitForFunction(() => !strudelAI.queue.running, null, { timeout: 90000 });
    const before = await ev(() => { const sg = strudelAI.activeSong(); return { secs: sg.sheet.sections.length, blocks: sg.blocks.filter((b) => !b.fillStep && !b.gap).length, ed: document.querySelectorAll('#editForm .se-sec').length }; });
    await ev(() => { document.getElementById('input').value = 'ADDVERSES build out a couple more verses'; document.getElementById('chat-form').requestSubmit(); });
    await p.waitForFunction((n) => strudelAI.activeSong()?.sheet.sections.length === n + 2, before.secs, { timeout: 20000 });
    await p.waitForTimeout(300);
    const after = await ev(() => { const sg = strudelAI.activeSong(); return { secs: sg.sheet.sections.length, blocks: sg.blocks.filter((b) => !b.fillStep && !b.gap).length, ed: document.querySelectorAll('#editForm .se-sec').length }; });
    expect(after.blocks === before.blocks + 2 && after.ed === before.ed + 2, `the new verses aren't everywhere: ${JSON.stringify({ before, after })}`);
  });

  await step('⬆ promotion: a jam becomes a song (opened in 🎼 Studio); the song becomes a 🎸 band and a 📻 station', async () => {
    await ev(() => strudelAI.setMode('jam'));
    await ev(() => document.querySelector('strudel-editor').editor.setCode('setcpm(124/4)\nkick: s("bd*4")\nhats: s("hh*8").gain(0.4)\nbass: note("a1 ~ a1 c2").s("sawtooth")'));
    expect(await ev(() => getComputedStyle(document.getElementById('jamPromote')).display !== 'none'), 'no 🎼 Make it a song button in Jam');
    const sheetsBefore = log.filter((x) => x.kind === 'sheet').length;
    await ev(() => document.getElementById('jamPromote').click());
    expect(await ev(() => strudelAI.currentMode() === 'studio'), 'did not switch to Studio');
    await p.waitForFunction(() => document.querySelectorAll('#editForm .se-sec').length >= 2, null, { timeout: 40000 });
    const req = log.filter((x) => x.kind === 'sheet')[sheetsBefore];
    expect(req && /JAM — build this song from the live-coded jam/.test(req.last) && /kick: s\("bd\*4"\)/.test(req.last), 'the sheet request lacks the jam');
    // the song → a band, then a station like it
    await p.waitForFunction(() => document.querySelector('#nowSongView [data-act="band"]'), null, { timeout: 20000 });
    const before = await ev(() => strudelAI.getBands().length);
    await ev(() => document.querySelector('#nowSongView [data-act="band"]').click());
    const band = await ev(() => strudelAI.getBands()[strudelAI.getBands().length - 1]);
    expect((await ev(() => strudelAI.getBands().length)) === before + 1 && / band$/.test(band.name) && band.instruments.split('\n').length >= 2, `the band: ${JSON.stringify(band)}`);
    await ev(() => document.querySelector('#nowSongView [data-act="station"]').click());
    await p.waitForFunction(() => strudelAI.queue.station && / Radio$/.test(strudelAI.queue.station.name), null, { timeout: 5000 });
    const st = await ev(() => ({ mode: strudelAI.currentMode(), band: document.getElementById('stationBand').value, theme: strudelAI.queue.station.theme }));
    expect(st.mode === 'radio' && / band/.test(st.band) && /music like/.test(st.theme), `the station: ${JSON.stringify(st)}`);
    await ev(() => document.getElementById('stationStop').click());
    await ev(() => document.getElementById('stop').click());
  });

  await step('no page errors', async () => expect(!errors.length, errors.join(' | ')));
} finally {
  await browser.close();
  app.kill();
  ai.close();
}
console.log(failed ? `\n${failed} step(s) failed` : '\nall smoke steps passed');
process.exit(failed ? 1 : 0);
