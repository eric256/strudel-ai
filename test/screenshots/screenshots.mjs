// Screenshots of every feature, for docs/FEATURES.md: the app in a real browser, with a stand-in AI that writes a full
// demo song (so the editors, staff and grids have something to show). Strudel's samples are fetched with curl.
//   npm run screenshots   (needs Playwright, like the smoke test: PLAYWRIGHT_MODULE=/path/to/playwright)
// Writes docs/screenshots/*.png.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'docs/screenshots');
const DATA = path.join(ROOT, '.screenshots-data');
const PORT = 3990, AI_PORT = 3991;

// --- the demo AI -------------------------------------------------------------------------------------------------
const SHEET = {
  title: 'Neon Rain', form: 'verse-chorus', band: 'none', master: 'synthwave', bpm: 104, meter: '4/4', key: 'A minor', scale: 'A:minor',
  chords: { verse: 'Am F C G', chorus: 'F G Am Em', bridge: 'Dm Am E Am' },
  melody: '<[0 ~ 2 4] [5 4 2 ~] [0 2 4 7] [6 4 2 ~]>', hook: '<[7 ~ 9 7] [5 4 2 4]>',
  parts: [
    { name: 'drums', role: 'drums', sound: 'RolandTR909', variants: ['main', 'half', 'fill', 'fill2'], desc: 'four on the floor with open hats' },
    { name: 'bass', role: 'bass', sound: 'sawtooth', variants: ['main', 'alt1'], desc: 'driving eighths' },
    { name: 'keys', role: 'chords', sound: 'triangle', variants: ['main'], desc: 'arpeggiated chords' },
    { name: 'pad', role: 'pad', sound: 'sawtooth', variants: ['main'], desc: 'wide slow pad' },
    { name: 'lead', role: 'melody', sound: 'square', variants: ['main', 'solo'], desc: 'the tune', tune: 'melody' },
    { name: 'hook', role: 'melody', sound: 'gm_lead_2_sawtooth', variants: ['main'], desc: 'the chorus hook', tune: 'hook' },
  ],
  sections: [
    { name: 'intro', bars: 4, chords: 'verse', play: ['pad', 'keys@in'], level: 0.75 },
    { name: 'verse', bars: 8, chords: 'verse', play: ['drums.half', 'bass', 'keys', 'lead'], level: 0.85 },
    { name: 'chorus', bars: 4, chords: 'chorus', play: ['drums', 'bass', 'keys', 'pad', 'hook'], level: 1.05 },
    { name: 'verse 2', bars: 8, chords: 'verse', play: ['drums', 'bass.alt1', 'keys', 'lead'] },
    { name: 'solo', bars: 8, chords: 'bridge', play: ['drums.half', 'bass', 'pad', 'lead.solo'], solo: 'lead' },
    { name: 'chorus 2', bars: 4, chords: 'chorus', play: ['drums', 'bass', 'keys', 'pad', 'hook'], level: 1.15, shift: 2 },
    { name: 'outro', bars: 4, chords: 'verse', play: ['pad', 'keys@out'], level: 0.7 },
  ],
  ending: 'fade',
};
const PARTS = {
  drums_main: 's("[bd,hh] hh [sd,hh] [bd,hh] [bd,oh] hh [sd,hh] [hh,oh]").bank("RolandTR909").velocity("1 0.5 0.9 0.6").room(slider(0.15, 0, 1)).gain(slider(0.8, 0, 1.2))',
  drums_half: 'stack(s("bd ~ ~ ~ ~ ~ bd ~"), s("~ ~ sd ~"), s("hh*4")).bank("RolandTR909").gain(slider(0.7, 0, 1.2))',
  drums_fill: 's("sd sd sd sd sd sd sd sd").bank("RolandTR909").velocity("0.4 0.5 0.6 0.7 0.8 0.9 1 1").gain(0.8)',
  drums_fill2: 's("~ lt ~ mt ~ ht ht ht").bank("RolandTR909").gain(0.8)',
  bass_main: '(prog) => chord(prog).rootNotes(2).struct("x ~ x x ~ x ~ x").s("sawtooth").lpf(slider(700, 200, 3000)).decay(0.2).sustain(0.4).gain(slider(0.55, 0, 1.2))',
  bass_alt1: '(prog) => chord(prog).rootNotes(2).struct("x x ~ x x ~ x x").s("sawtooth").lpf(slider(900, 200, 3000)).gain(slider(0.55, 0, 1.2))',
  keys_main: '(prog) => n("<[0 1 2 3 2 1 2 3] [0 2 1 3 0 2 1 3]>").chord(prog).voicing().s("triangle").release(0.3).room(slider(0.35, 0, 1)).gain(slider(0.4, 0, 1.2))',
  pad_main: '(prog) => chord(prog).voicing().s("sawtooth").attack(0.4).release(1.2).lpf(slider(1400, 200, 6000)).room(slider(0.5, 0, 1)).gain(slider(0.22, 0, 1.2))',
  lead_main: 'n("<[0 ~ 2 4] [5 4 2 ~] [0 2 4 7] [6 4 2 ~]>").scale("A:minor").s("square").lpf(slider(2400, 300, 8000)).delay(slider(0.25, 0, 1)).gain(slider(0.32, 0, 1.2))',
  lead_solo: 'n("<[7 9 11 9 7 ~ 4 5] [7@3 ~ 4 2 4 ~] [9 11 12 11 9 7 9 ~] [7@4 ~ 4 2 0]>").scale("A:minor").s("square").lpf(3000).delay(0.3).gain(0.34)',
  hook_main: 'n("<[7 ~ 9 7] [5 4 2 4]>").scale("A:minor").s("gm_lead_2_sawtooth").room(slider(0.3, 0, 1)).gain(slider(0.4, 0, 1.2))',
};
const JAM = 'setcpm(96/4)\nkick: s("bd ~ ~ bd, ~ sd").bank("RolandTR808").gain(slider(0.8, 0, 1.2))\nhats: s("hh*8").bank("RolandTR808").velocity("0.5 1").gain(slider(0.4, 0, 1.2))\nbass: note("<a1 f1 c2 g1>").struct("x ~ x x").s("sawtooth").lpf(slider(800, 200, 3000)).gain(slider(0.5, 0, 1.2))\nchords: chord("<Am F C G>").voicing().s("triangle").room(0.4).gain(slider(0.3, 0, 1.2))\nlead: n("0 2 4 <7 6>").scale("A:minor").s("square").delay(0.3).gain(slider(0.25, 0, 1.2))';
function aiReply(sys, last) {
  if (sys.startsWith('You are a songwriter')) return JSON.stringify(SHEET);
  if (sys.startsWith('You write the PART LIBRARY')) {
    const ids = [...last.matchAll(/^- (\w+)\s+\[/gm)].map((m) => m[1]);
    const lib = ['setcpm(104/4)', ...ids.map((id) => `const ${id} = ${PARTS[id] || PARTS[`${id.split('_')[0]}_main`] || 'n("0 2 4").scale("A:minor").s("triangle").gain(0.3)'}`)];
    return '```javascript\n' + lib.join('\n') + '\n```';
  }
  if (sys.startsWith('You are the music director')) return 'Neon Rain | synthwave night drive with a soaring lead\nMidnight Arcade | bright synth-pop with arpeggios\nLow Tide | slow dreamy synthwave';
  return 'A dusty groove with a walking bass and a little melody on top.\n```javascript\n' + JAM + '\n```';
}
const ai = http.createServer((req, res) => {
  if (req.url.startsWith('/v1/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"data":[{"id":"demo"}]}'); }
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const j = JSON.parse(body);
    const content = aiReply(j.messages[0].content, j.messages[j.messages.length - 1].content);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
});
await new Promise((r) => ai.listen(AI_PORT, '127.0.0.1', r));

// --- the app -----------------------------------------------------------------------------------------------------
rmSync(DATA, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const app = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, LLAMACPP_URL: `http://127.0.0.1:${AI_PORT}` } });
process.on('exit', () => { app.kill(); rmSync(DATA, { recursive: true, force: true }); });
await new Promise((r) => app.stdout.on('data', (d) => /http:\/\//.test(String(d)) && r()));
const browser = await pw.default.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
// Strudel's sample catalogues and samples (fetched with curl, which follows the environment's proxy); nothing else
const { execFile } = await import('node:child_process');
const cache = new Map();
const curl = (url) => cache.get(url) || cache.set(url, new Promise((res) => execFile('curl', ['-sSL', '--max-time', '20', url], { encoding: 'buffer', maxBuffer: 64e6 }, (e, out) => res(e ? null : out)))).get(url);
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
  const url = r.request().url();
  if (!/githubusercontent|felixroos|strudel|tidalcycles|gleitz/.test(url)) return r.abort();
  const body = await curl(url);
  if (!body) return r.abort();
  const type = /\.json/.test(url) ? 'application/json' : /\.js($|\?)/.test(url) ? 'application/javascript' : /\.wav/.test(url) ? 'audio/wav' : /\.mp3/.test(url) ? 'audio/mpeg' : /\.ogg/.test(url) ? 'audio/ogg' : 'application/octet-stream';
  r.fulfill({ status: 200, contentType: type, body, headers: { 'access-control-allow-origin': '*' } });
});
const p = await ctx.newPage();
const ev = (f, a) => p.evaluate(f, a);
const shot = async (name, el = null) => {
  await p.waitForTimeout(400);
  // soundfonts this sandbox can't download leave a "Failed to fetch" under the code: not part of the app's look
  await ev(() => { const b = document.getElementById('error-bar'); if (/fetch/i.test(b?.textContent || '')) b.hidden = true; });
  await (el ? p.locator(el).first().screenshot({ path: `${OUT}/${name}.png` }) : p.screenshot({ path: `${OUT}/${name}.png` }));
  console.log('📸', name);
};
const open = (id) => ev((id) => strudelAI.ws.open(id), id);
const send = (text, target) => ev(([text, target]) => {
  const s = document.getElementById('chatTarget');
  if (target) { s.value = target; s.dispatchEvent(new Event('change')); }
  document.getElementById('input').value = text;
  document.getElementById('chat-form').requestSubmit();
}, [text, target]);
const playing = () => p.waitForFunction(() => strudelAI.engine.steps.some((x) => x.status === 'playing') && document.querySelector('strudel-editor').editor.repl.scheduler.started, null, { timeout: 60000 })
  .catch(async (e) => { console.log(await ev(() => [...document.querySelectorAll('#messages .msg, #consoleLog div')].slice(-12).map((m) => m.textContent.slice(0, 200)).join('\n'))); throw e; });
p.on('pageerror', (e) => console.log('pageerror', e.message));

await p.goto(`http://127.0.0.1:${PORT}/`);
await p.waitForFunction(() => window.strudelAI && document.querySelector('strudel-editor')?.editor?.repl, null, { timeout: 60000 });
await ev(() => document.querySelector('#welcome .close, #welcomeClose')?.click());

// 📻 Radio
await ev(() => strudelAI.setMode('radio'));
await open('station');
await ev(() => { document.getElementById('stationStart').click(); });
await playing();
await p.waitForTimeout(2500);
await shot('01-radio-mode');
await open('station'); await shot('02-station', '#stationTab');
await open('playlist'); await shot('03-playlist', '#playlistPanel');
await shot('04-now-playing', '#songPanel');
await ev(() => document.getElementById('stop').click());

// 🎼 Studio
await ev(() => strudelAI.setMode('studio'));
await send('a synthwave night drive with a soaring lead', 'song');
await p.waitForFunction(() => document.querySelectorAll('#editForm .se-sec').length >= 5 && !!strudelAI.activeSong(), null, { timeout: 60000 });
await playing();
// to the chorus, so the arrangement's playhead is in the middle
await ev(() => { document.querySelectorAll('#editForm .se-sec')[2].click(); [...document.querySelectorAll('#editForm .se-selrow button')].find((b) => /go/.test(b.textContent)).click(); });
await p.waitForFunction(() => /chorus/.test(strudelAI.engine.steps.find((x) => x.status === 'playing')?.prompt || ''), null, { timeout: 40000 });
await p.waitForTimeout(1500);
await shot('06-studio-mode');
await shot('07-song-editor', '#editPanel');
await ev(() => document.querySelector('#editForm .se-grid-wrap')?.scrollIntoView());
await shot('08-arrangement-playhead', '#editForm .se-grid-wrap');
// 🎵 Songs: the song saved to My songs and ★ favorited (shared on the server)
await ev(() => { for (const a of ['save', 'fav']) document.querySelector(`#nowSongView [data-act="${a}"]`)?.click(); });
await p.waitForTimeout(800);
await open('songs'); await shot('05-songs', '#setTab');
await open('edit');

// 🧩 Part editor
const part = async (name, src = null) => {
  await ev((name) => { const row = [...document.querySelectorAll('#editForm .se-part')].find((r) => r.querySelector('.se-pname').value === name); row.querySelector('.se-pedit').click(); }, name);
  await p.waitForSelector('#partForm .pe');
  if (src) await ev((src) => [...document.querySelectorAll('#partForm .pe-chip')].find((c) => c.textContent.trim() === src)?.click(), src);
  await p.waitForTimeout(300);
};
await part('lead');
await ev(() => document.querySelector('#partForm .pe-play').click());
await p.waitForTimeout(800);
// select a note, so the toolbar shows it
const bar = await p.locator('#partForm .pe-bar').nth(1).boundingBox();
await p.mouse.click(bar.x + 10 + 48 * 2 + 24, bar.y + 92 - 5 * 3);
await shot('09-part-editor-staff', '#partPanel');
await part('drums');
await shot('10-part-editor-drums', '#partPanel');
await part('keys');
await shot('11-part-editor-chord-tones', '#partPanel');
await ev(() => document.querySelector('#partForm .pe-stop')?.click());
// 🎨 themes (the song carries on)
await ev(() => strudelAI.engine.paused && document.getElementById('nowPause').click());
await p.waitForTimeout(1500);
await open('edit');
for (const t of ['light', 'synthwave']) {
  await ev((t) => import('/theme.js').then((m) => m.applyTheme(t)), t);
  await p.waitForTimeout(800);
  await shot(`27-theme-${t}`);
}
await ev(() => import('/theme.js').then((m) => m.applyTheme('dark')));
await ev(() => document.getElementById('stop').click());

// ⌨ Jam
await ev(() => strudelAI.setMode('jam'));
await send('a dusty groove with a walking bass');
await p.waitForFunction(() => document.querySelector('strudel-editor').editor.repl.scheduler.started, null, { timeout: 30000 });
await p.waitForTimeout(2500);
await shot('12-jam-mode');
for (const [id, el, name] of [['pads', '#pads-dock', '13-pads'], ['keys', '#keys-dock', '14-keys'], ]) {
  await open(id);
  await shot(name, el);
}
// the console panels, floated big enough to show them whole
const big = async (id, name, w, h) => {
  await open(id);
  await ev(([id, w, h]) => { const pn = strudelAI.ws.api.getPanel(id); strudelAI.ws.api.addFloatingGroup(pn, { position: { left: 40, top: 60 }, width: w, height: h }); }, [id, w, h]);
  await p.waitForTimeout(1200);
  await shot(name, `#${id}-dock`);
  await ev((id) => strudelAI.ws.dock?.(id), id);
};
await big('mixer', '15-mixer', 760, 560);
await big('master', '16-master', 1180, 420);
// 🎚 Equalizer: the first channel, with the "Soft top" preset
await ev(() => strudelAI.openEqualizer(strudelAI.mixerChannels()[0]?.base || 'master'));
await p.waitForTimeout(500);
await ev(() => [...document.querySelectorAll('#eqBody .eq-presets button')].find((b) => /Soft/.test(b.textContent))?.click());
await big('eq', '16b-equalizer', 1000, 360);
await ev(() => [...document.querySelectorAll('#eqBody .eq-presets button')].find((b) => /Flat/.test(b.textContent))?.click());
// 🔀 Routing: the drums on a bus, the lead with a wet reverb path
await open('route');
await p.waitForTimeout(500);
const tpl = (part, re) => ev(([part, re]) => { const s = document.querySelector('#routeBody .rt-tpl select'); if (part) { s.value = part; s.dispatchEvent(new Event('change')); } [...document.querySelectorAll('#routeBody .rt-tpl button')].find((b) => new RegExp(re).test(b.textContent))?.click(); }, [part, re]);
await tpl(null, 'Drum bus');
await tpl('lead', 'Wet space');
await big('route', '16c-routing', 1440, 800);
await ev(() => [...document.querySelectorAll('#routeBody .rt-right button')].find((b) => b.textContent === 'clear')?.click());
await open('viz');
await ev(() => { const s = document.getElementById('vizMode'); s.value = 'dashboard'; s.dispatchEvent(new Event('change')); });
await p.waitForTimeout(1500);
await shot('17-visualizer', '#viz-dock');
await open('hydra');
await ev(() => { const h = document.getElementById('hydraMode'); h.value = 'kaleido'; h.onchange?.(); h.dispatchEvent(new Event('change')); });
await p.waitForTimeout(2500);
await shot('18-hydra', '#hydra-dock');

// floating panels
await ev(() => strudelAI.ws.float('mixer'));
await p.waitForTimeout(800);
await shot('19-floating-panel');
await ev(() => strudelAI.ws.dock?.('mixer'));
await ev(() => document.getElementById('stop').click());

// ⚙ Settings (with a taste to show: no square waves, softer synths, a few likes)
await ev(() => strudelAI.setTaste({ avoid: [{ sound: 'square', instead: 'triangle' }, { sound: 'gm_distortion_guitar', instead: 'gm_overdriven_guitar' }], soften: true, cutoff: 3200, likes: 'warm, round sounds; Rhodes and upright bass; nothing screechy', liked: ['gm_epiano1', 'gm_acoustic_bass'] }, { quiet: true }));
await ev(() => document.getElementById('settingsBtn').click());
for (const [sec, name] of [['setGeneral', '20-settings-general'], ['setAI', '21-settings-ai'], ['setBands', '22-settings-bands'], ['setForms', '23-settings-forms'], ['setStations', '24-settings-stations'], ['setMyTaste', '24b-settings-my-taste'], ['setTheme', '25-settings-themes'], ['setPlugins', '26-settings-plugins']]) {
  await ev((sec) => document.querySelector(`.settings-tabs button[data-sec="${sec}"]`).click(), sec);
  await shot(name, '#settingsDlg');
}
await ev(() => document.getElementById('settingsClose').click());
await ev(() => strudelAI.setTaste({}, { quiet: true }));


await browser.close();
ai.close();
console.log(`\nscreenshots in ${path.relative(ROOT, OUT)}/`);
process.exit(0);
