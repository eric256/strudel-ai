// The Express server's key/value store: one JSON file per key under DATA_DIR ("shares/abc" → DATA_DIR/shares/abc.json),
// the same files the server always kept, so existing shares and favorites carry on. (Netlify uses Netlify Blobs.)
import fs from 'node:fs';
import path from 'node:path';

const KEY = /^[a-z]+\/[A-Za-z0-9_-]{1,64}$/;
export function fileStore(dir) {
  const file = (key) => {
    if (!KEY.test(key)) throw new Error(`bad key ${key}`);
    return path.join(dir, `${key}.json`);
  };
  return {
    async get(key) { try { return fs.readFileSync(file(key), 'utf8'); } catch { return null; } },
    async set(key, text) { const f = file(key); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); },
    async delete(key) { try { fs.unlinkSync(file(key)); } catch {} },
    async list(prefix) {
      const sub = prefix.replace(/\/$/, '');
      try { return fs.readdirSync(path.join(dir, sub)).filter((f) => f.endsWith('.json')).map((f) => `${sub}/${f.slice(0, -5)}`); } catch { return []; }
    },
  };
}
