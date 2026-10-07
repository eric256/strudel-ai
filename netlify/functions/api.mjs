// Netlify Function: every /api endpoint except the chat (which streams for minutes: see edge-functions/chat.mjs).
// The endpoints are server/api.js, shared with the Express server; data (shared songs, favorites, accounts) is kept
// in Netlify Blobs. The build (scripts/build-netlify.mjs) writes the version, plugins and changelog it reports.
import { getStore } from '@netlify/blobs';
import { makeApi } from '../../server/api.js';
import info from '../generated/info.json' with { type: 'json' };

/** Hosted for other people: Claude only, unless PROVIDERS says otherwise (local AI servers aren't reachable). */
export const netlifyEnv = (env) => ({ DEFAULT_PROVIDER: 'anthropic', PROVIDERS: 'anthropic', ...env });

/** A Netlify Blobs store as the API's key/value store. */
export function blobStore(blobs) {
  return {
    get: (key) => blobs.get(key),
    set: (key, text) => blobs.set(key, text),
    delete: (key) => blobs.delete(key),
    list: async (prefix) => (await blobs.list({ prefix })).blobs.map((b) => b.key),
  };
}
/** The handler, for any store (the tests use one in memory). */
export const handlerWith = (store, env = process.env) => makeApi({ env: netlifyEnv(env), store, info: () => info });

let handler = null;
export default async (req) => {
  handler ||= handlerWith(blobStore(getStore({ name: 'strudel-ai', consistency: 'strong' })));
  return (await handler(req)) || new Response('{"error":"not found"}', { status: 404, headers: { 'Content-Type': 'application/json' } });
};
export const config = { path: '/api/*' };
