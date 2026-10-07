// Netlify Edge Function: POST /api/chat — the AI proxy (server/llm.js via server/api.js). It runs at the edge because
// a song sheet or a part library can stream from Claude for a minute or more, longer than a function may run; an
// edge function only counts the time it computes, not the time it waits on Claude. Who is asking (and their own
// Claude key) comes from the cookies, so it needs no storage.
import { makeApi } from '../../server/api.js';

const NO_STORE = { get: async () => null, set: async () => {}, delete: async () => {}, list: async () => [] };
const env = () => ({ DEFAULT_PROVIDER: 'anthropic', PROVIDERS: 'anthropic', ...(globalThis.Netlify?.env?.toObject?.() || {}) });
let handler = null;
export default async (req) => {
  handler ||= makeApi({ env: env(), store: NO_STORE });
  return handler(req);
};
export const config = { path: '/api/chat', method: 'POST' };
