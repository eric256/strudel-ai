// 🐞 Debug log download (🖥 Console → ⬇ debug log): the problems, the whole log and what the app was doing, as a text
// file to send back for fixes. Nothing secret is in it: API keys live on the server.
// (split out of app.js)
import { audioCtx } from './hum-ui.js';
import { APP_BUILD, APP_VERSION } from './share.js';
import { master } from './master-panel.js';
import { diffParams } from '../master.js';
import { mixer } from './mixer.js';
import { rawSheet } from './song-editor.js';
import { debugCounts, debugReport } from '../debuglog.js';
import { $, activeSong, clog, engine, getCode, isPlaying, load, queue, state, ws } from '../app.js';
import { nowSong } from './song-lists.js';
// handy for debugging from the browser console
export function debugContext() {
  const safe = (fn) => { try { return fn(); } catch (e) { return `(unavailable: ${e.message})`; } };
  const ac = safe(() => audioCtx());
  const sg = safe(() => (queue.running ? queue.songs[queue.current] : null) || nowSong || activeSong());
  const step = safe(() => engine.steps.find((x) => x.status === 'playing'));
  const st = load();
  const app = [
    `version ${APP_VERSION} (build ${APP_BUILD}) · ${location.origin}`,
    `browser ${navigator.userAgent}`,
    `window ${innerWidth}×${innerHeight} @${devicePixelRatio}x · audio ${ac?.state || '?'} ${ac?.sampleRate || ''} Hz, latency ${ac?.baseLatency ? Math.round(ac.baseLatency * 1000) + ' ms' : '?'}`,
    `AI ${$('provider')?.value || '?'} / ${$('model')?.value || '?'}${st.claudeEffort ? ` (effort ${st.claudeEffort})` : ''}`,
    `panels open: ${safe(() => ws.panels().filter((p) => p.open).map((p) => p.id).join(', '))}`,
    `settings: ${['quantize', 'fade', 'liveMode', 'autoComplete', 'partVisuals', 'recSongs', 'setForm', 'setBand', 'stationForm', 'stationBand', 'masterStyle', 'masterFollow', 'vizMode', 'aiBudget'].filter((k) => st[k] !== undefined).map((k) => `${k}=${JSON.stringify(st[k])}`).join(' ')}`,
  ].join('\n');
  const now = [
    `${isPlaying() ? 'playing' : 'stopped'} · ${$('status')?.textContent || ''}${engine.paused ? ' · paused' : ''}`,
    sg ? `song “${sg.title}” (${sg.status || '?'}${sg.phase ? `, ${sg.phase}` : ''}) · section ${step?.prompt || '—'} · ${queue.mode || ''} ${queue.running ? `${queue.current + 1}/${queue.songs.length}` : ''}` : 'no song',
    `master ${master.style}${master.bypass ? ' (bypassed)' : ''} · follow ${master.follow} · ${JSON.stringify(diffParams(master.params, master.style))}`,
    `mixer: ${Object.entries(mixer.ch).filter(([, c]) => c.mute || c.solo || c.vol !== 1 || c.low || c.mid || c.high).map(([b, c]) => `${b}${c.mute ? ' M' : ''}${c.solo ? ' S' : ''} ${c.vol}`).join(', ') || 'flat'}`,
  ].join('\n');
  const chat = state.history.slice(-8).map((m) => `--- ${m.role}\n${String(m.content).slice(0, 1500)}`).join('\n');
  return {
    app, 'now': now,
    'song sheet': sg?.sheet ? safe(() => JSON.stringify(rawSheet(sg.sheet), null, 1)) : sg ? `(none: “${sg.title}” is a block-format song — its sections are in the code)` : '',
    'song parts code': sg?.library || '',
    'code in the editor': safe(() => getCode()),
    'recent chat (last 8 messages)': chat,
  };
}
export function downloadDebugLog() {
  const text = debugReport(debugContext());
  const name = `strudel-ai-debug-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.txt`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  const c = debugCounts();
  clog('info', `🐞 debug log saved: ${name} (${c.errors} errors, ${c.warnings} warnings) — send it back for fixes`);
}
