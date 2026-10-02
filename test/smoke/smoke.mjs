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
    expect(/SOUND GUIDE/.test(req.sys) && /BAND — write the song for exactly this band/.test(req.last), 'the sheet request has the band and the sound guide');
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

  await step('✎ Edit song applies changes (a longer chorus, another master style)', async () => {
    await ev(() => document.querySelector('#nowSongView [data-act="edit"]').click());
    await p.waitForTimeout(600);
    await ev(() => {
      const f = document.getElementById('editForm');
      f.querySelector('[data-f="master"]').value = 'dub';
      const t = f.querySelector('[data-f="sections"]');
      t.value = t.value.replace(/^chorus \| 4 \|/m, 'chorus | 8 |');
      f.querySelector('[data-act="edit-save"]').click();
    });
    await p.waitForFunction(() => /applied/.test(document.querySelector('#editForm .sv-edit-msg')?.textContent || ''), null, { timeout: 15000 });
    const s = await ev(() => { const sh = strudelAI.queue.songs[0].sheet; return { master: sh.master, chorus: sh.sections.find((x) => x.name === 'chorus').bars }; });
    expect(s.master === 'dub' && s.chorus === 8, JSON.stringify(s));
  });

  await step('a song that can\'t be written is marked ✗ with ↻ Try again (no block-by-block fallback)', async () => {
    const before = log.filter((x) => x.kind === 'code').length;
    await ev(() => { const d = document; d.getElementById('chatTarget').value = 'new'; d.getElementById('input').value = 'FAILSHEET a doomed song'; d.getElementById('chat-form').requestSubmit(); });
    await p.waitForFunction(() => strudelAI.queue.songs.some((s) => s.status === 'failed'), null, { timeout: 40000 });
    expect(log.filter((x) => x.kind === 'code').length === before, 'the song was written block by block');
    const k = await ev(() => strudelAI.queue.songs.findIndex((s) => s.status === 'failed'));
    await ev(() => strudelAI.ws.open('songs'));
    await ev((k) => document.querySelector(`#setStatus [data-k="${k}"]`)?.click(), k);
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

  await step('no page errors', async () => expect(!errors.length, errors.join(' | ')));
} finally {
  await browser.close();
  app.kill();
  ai.close();
}
console.log(failed ? `\n${failed} step(s) failed` : '\nall smoke steps passed');
process.exit(failed ? 1 : 0);
