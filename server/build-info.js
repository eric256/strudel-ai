// What a build is (Node only): the version (package.json), a build id (a hash of the app's files — any change makes
// a new one, and open pages notice and update), index.html stamped with them, the plugins that come with the app,
// and the changelog. The Express server reads them at start-up; the Netlify build writes them into the site.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function buildInfo(root, { pluginsDir = null } = {}) {
  const PUBLIC = path.join(root, 'public');
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const h = crypto.createHash('sha1').update(version);
  const files = ['server.js', 'prompt.js', ...fs.readdirSync(path.join(root, 'server')).map((f) => path.join('server', f)),
    ...fs.readdirSync(PUBLIC, { recursive: true }).map((f) => path.join('public', String(f)))];
  for (const f of files.sort()) { try { h.update(f).update(fs.readFileSync(path.join(root, f))); } catch {} }
  const build = h.digest('hex').slice(0, 8);
  // index.html carries the build it was served with, so the page knows its own version
  const indexHtml = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')
    .replace('<head>', `<head>\n  <meta name="app-version" content="${version}" />\n  <meta name="app-build" content="${build}" />`)
    .replace(/(\/(?:main\.js|style\.css))"/g, `$1?v=${build}"`);
  const listJs = (dir) => { try { return fs.readdirSync(dir).filter((f) => /^[\w.-]+\.m?js$/.test(f)).sort(); } catch { return []; } };
  let changelog = '';
  try { changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'); } catch {}
  return {
    version, build, indexHtml, changelog, repo: 'https://github.com/eric256/strudel-ai',
    plugins: { builtin: listJs(path.join(PUBLIC, 'plugins')).map((f) => `/plugins/${f}`), server: pluginsDir ? listJs(pluginsDir).map((f) => `/user-plugins/${f}`) : [] },
  };
}

/** Folders the browser loads from node_modules (served at /vendor/<name>). */
export const VENDOR = {
  strudel: 'node_modules/@strudel/repl/dist',
  dockview: 'node_modules/dockview-core/dist',
  hydra: 'node_modules/hydra-synth/dist',
  'lit-html': 'node_modules/lit-html',
  lamejs: 'node_modules/lamejs',
  drawflow: 'node_modules/drawflow/dist',
};
