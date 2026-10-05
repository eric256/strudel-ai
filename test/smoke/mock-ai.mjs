// A stand-in AI for the smoke test: an OpenAI-compatible endpoint (the app's llama.cpp provider) that answers each
// kind of request (song sheet, part library, chat code) with a small, valid reply.
import http from 'node:http';

const sheet = (last) => ({
  ...(/no title yet/.test(last) ? { title: 'Smoke Signal' } : {}),
  form: 'short', band: /BAND/.test(last) ? 'techno rig' : 'none', master: /BAND/.test(last) ? 'techno' : 'lo-fi',
  bpm: 120, meter: '4/4', key: 'A minor', scale: 'A:minor',
  chords: { verse: 'Am F C G', chorus: 'F G Am Am' },
  hook: '<[0 2 4 2] [3 2 0 ~]>',
  parts: [
    { name: 'drums', role: 'drums', sound: 'RolandTR909', variants: ['main', 'fill'], desc: 'four on the floor' },
    { name: 'bass', role: 'bass', sound: 'sawtooth', variants: ['main'], desc: 'roots' },
    { name: 'pad', role: 'pad', sound: 'triangle', layers: ['sine'], variants: ['main'], desc: 'chords, layered' },
    { name: 'hook', role: 'melody', sound: 'square', variants: ['main'], desc: 'plays the hook' },
  ],
  sections: [
    { name: 'intro', bars: 4, chords: 'verse', play: ['pad', 'drums'] },
    { name: 'A', bars: 8, chords: 'verse', play: ['pad', 'drums', 'bass'] },
    { name: 'chorus', bars: 4, chords: 'chorus', play: ['drums', 'bass', 'pad', 'hook'] },
    { name: 'outro', bars: 4, chords: 'verse', play: ['pad'] },
  ],
});
function library(req) {
  const ids = [...req.matchAll(/^- (\w+)\s+\[(function of prog|plain pattern)\]/gm)].map((m) => [m[1], m[2]]);
  const only = (req.match(/It is missing these consts: ([\w, ]+)\./) || [])[1]?.split(/,\s*/);
  const lines = ['setcpm(120/4)'];
  for (const [id, kind] of ids) {
    if (only && !only.includes(id)) continue;
    if (id.startsWith('drums')) lines.push(`const ${id} = note("${id.endsWith('fill') ? 'c5*8' : 'c5*4'}").s("square").decay(0.05).sustain(0).gain(0.4)`);
    else if (kind.startsWith('function')) lines.push(`const ${id} = (prog) => chord(prog).${id.startsWith('bass') ? 'rootNotes(2)' : 'voicing()'}.s("${id.startsWith('bass') ? 'sawtooth' : 'triangle'}").gain(slider(0.3, 0, 1.2))`);
    else lines.push(`const ${id} = n("0 2 4 2").scale("A:minor").s("square").gain(slider(0.2, 0, 1.2))`);
  }
  return '```javascript\n' + lines.join('\n') + '\n```';
}

export const log = [];
let failSheets = 0;
export function startMockAI(port) {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/v1/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"data":[{"id":"mock"}]}'); }
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const j = JSON.parse(body);
      const sys = j.messages[0].content, last = j.messages[j.messages.length - 1].content;
      let kind, content;
      // a song described with FAILSHEET gets unusable sheets the first 6 times (both rounds of 3 tries), then good ones
      if (sys.startsWith('You are a songwriter') && /FAILSHEET/.test(last) && failSheets++ < 6) { kind = 'sheet'; content = 'Sorry, no sheet today.'; }
      else if (sys.startsWith('You are a songwriter')) { kind = 'sheet'; content = JSON.stringify(sheet(last)); }
      else if (sys.startsWith('You write the PART LIBRARY')) { kind = 'library'; content = library(last); }
      else if (sys.startsWith('You are the music director')) { kind = 'songs'; content = 'Night Drive | synthwave with a driving bass\nRain Loop | slow lo-fi with soft keys\nSky Steps | bright house with piano chords'; }
      // a whole-song chat edit asking for ADDVERSES: the active song's sheet with two more verses before its last section
      // (repeats of the verse, with its name — songs repeat names: A, B, A)
      else if (/TARGET: THE WHOLE SONG/.test(last) && /ADDVERSES/.test(last)) {
        kind = 'song';
        const sh = JSON.parse(last.match(/sheet JSON[^\n]*\n(\{.*\})\n/)[1]);
        const verse = sh.sections[1] || sh.sections[0];
        sh.sections.splice(sh.sections.length - 1, 0, { ...verse }, { ...verse });
        content = `I added two more verses.\n\`\`\`song\n${JSON.stringify(sh)}\n\`\`\``;
      }
      else { kind = 'code'; content = 'Here you go.\n```javascript\nsetcpm(120/4)\ndrums: s("bd*4").bank("RolandTR909")\nlead: note("c4 e4 g4").s("square").gain(0.3)\n```'; }
      log.push({ kind, sys, last });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
