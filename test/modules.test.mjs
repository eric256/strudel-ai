// The browser modules import each other by name: a name that its module doesn't export breaks the whole page at
// load time (and node --check can't see it). Check every relative import of every module in public/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const files = ['', 'lib', 'features', 'templates'].flatMap((d) => fs.readdirSync(path.join(PUBLIC, d)).filter((f) => f.endsWith('.js')).map((f) => path.join(PUBLIC, d, f)));

function exportsOf(file) {
  const s = fs.readFileSync(file, 'utf8'), out = new Set();
  for (const m of s.matchAll(/^export (?:async )?(?:function\*? ([\w$]+)|class ([\w$]+)|(?:const|let|var) ([^=;]+?)\s*(?:=|;|$))/gm)) {
    if (m[1] || m[2]) out.add(m[1] || m[2]);
    else for (const n of m[3].split(',')) out.add(n.trim().split(/\s/)[0]);
  }
  for (const m of s.matchAll(/^export \{([^}]*)\}/gm)) for (const n of m[1].split(',')) out.add(n.trim().split(/\s+as\s+/).pop());
  return out;
}

test('every named import between the browser modules exists', () => {
  const missing = [];
  for (const file of files) {
    const s = fs.readFileSync(file, 'utf8');
    for (const m of s.matchAll(/^import \{([^}]*)\} from '(\.{1,2}\/[^']+)';$/gm)) {
      const target = path.resolve(path.dirname(file), m[2]);
      assert.ok(fs.existsSync(target), `${path.relative(PUBLIC, file)} imports a missing file ${m[2]}`);
      const exp = exportsOf(target);
      for (const spec of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
        const name = spec.split(/\s+as\s+/)[0];
        if (!exp.has(name)) missing.push(`${path.relative(PUBLIC, file)}: ${name} from ${m[2]}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('every feature with start-up code is set up by app.js', () => {
  const app = fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
  for (const file of files.filter((f) => f.includes(`${path.sep}features${path.sep}`))) {
    if (!/^export (async )?function setup\(/m.test(fs.readFileSync(file, 'utf8'))) continue;
    const name = path.basename(file, '.js').replace(/-/g, '_');
    assert.match(app, new RegExp(`^(await )?setup_${name}\\(\\);`, 'm'), `${path.basename(file)}'s setup() is never called`);
  }
});

const templateFiles = files.filter((f) => f.includes(`${path.sep}templates${path.sep}`) && !f.endsWith(`${path.sep}index.js`));

test('templates are markup only: they import nothing but html.js, the template registry and lib/', () => {
  for (const file of templateFiles) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/^import [^;]* from '([^']+)';$/gm)) {
      assert.ok(['../html.js', './index.js'].includes(m[1]) || m[1].startsWith('../lib/'), `${path.relative(PUBLIC, file)} imports ${m[1]}: templates get their data passed in`);
    }
  }
});

test('every template the app uses (T.name) exists, and every template file is registered', () => {
  const names = new Set(templateFiles.flatMap((f) => [...exportsOf(f)]));
  const index = fs.readFileSync(path.join(PUBLIC, 'templates', 'index.js'), 'utf8');
  for (const f of templateFiles) assert.ok(index.includes(`'./${path.basename(f)}'`), `templates/index.js doesn't import ${path.basename(f)}`);
  const missing = [];
  for (const file of files.filter((f) => !f.endsWith(`templates${path.sep}index.js`))) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/\bT\.([A-Za-z_$][\w$]*)\(/g)) if (!names.has(m[1])) missing.push(`${path.relative(PUBLIC, file)}: T.${m[1]}`);
  }
  assert.deepEqual(missing, []);
});
