// The Netlify build: the site in dist/ (the app's files, index.html stamped with the version and build, the browser's
// libraries from node_modules under /vendor, a server plugins folder if there is one) and netlify/generated/info.json
// (what /api/version, /api/about and /api/plugins report). The /api endpoints are netlify/functions and
// netlify/edge-functions (server/ shared with the Express server). `npm run build:netlify`
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInfo, VENDOR } from '../server/build-info.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, process.env.NETLIFY_DIST || 'dist');
const PLUGINS = path.join(ROOT, 'plugins');
fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), DIST, { recursive: true });
for (const [name, dir] of Object.entries(VENDOR)) fs.cpSync(path.join(ROOT, dir), path.join(DIST, 'vendor', name), { recursive: true });
if (fs.existsSync(PLUGINS)) fs.cpSync(PLUGINS, path.join(DIST, 'user-plugins'), { recursive: true });
const info = buildInfo(ROOT, { pluginsDir: fs.existsSync(PLUGINS) ? PLUGINS : null });
fs.writeFileSync(path.join(DIST, 'index.html'), info.indexHtml);
fs.mkdirSync(path.join(ROOT, 'netlify', 'generated'), { recursive: true });
const { indexHtml, ...rest } = info;
fs.writeFileSync(path.join(ROOT, 'netlify', 'generated', 'info.json'), JSON.stringify(rest));
console.log(`Strudel AI v${info.version} (build ${info.build}) → ${path.relative(ROOT, DIST)}/`);
