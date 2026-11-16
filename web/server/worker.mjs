import { emberChat } from './emberChat.mjs';
import { getWorldGrid } from './worldGrid.mjs';
import { fetchFireFeed } from './fireFeed.mjs';

const json = (value, status = 200, cache = 'no-store') => Response.json(value, { status, headers: { 'Cache-Control': cache, 'Access-Control-Allow-Origin': 'https://chironk.github.io' } });
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/ember/chat') {
      const allowed = request.headers.get('Origin') === 'https://chironk.github.io' || request.headers.get('Origin') === url.origin;
      if (!allowed) return json({ error: 'Origin not allowed' }, 403);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': request.headers.get('Origin'), 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600', Vary: 'Origin' } });
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      const result = await emberChat(request, env);
      const response = json(result.body, result.status);
      response.headers.set('Access-Control-Allow-Origin', request.headers.get('Origin'));
      return response;
    }
    if (url.pathname.startsWith('/api/')) {
      if (request.method !== 'GET') return json({ error: 'This hosted preview uses NASA FIRMS alerts for subscriptions.' }, 503);
      if (url.pathname === '/api/relay/status') return json({ emailReady: false, lastCheck: null, count: 0, recipients: [], signal: null });
      if (url.pathname === '/api/world-grid' || /^\/api\/firms\/(world|us)$/.test(url.pathname)) {
        try {
          const data = url.pathname === '/api/world-grid' ? await getWorldGrid() : await fetchFireFeed(url.pathname.endsWith('/us') ? 'us' : 'world');
          const response = json(data, 200, 'public, max-age=300');
          return response;
        } catch { return json({ error: 'NASA feed unavailable. Use the dated saved snapshot.' }, 502); }
      }
      return json({ error: 'Endpoint unavailable' }, 503);
    }
    return env.ASSETS.fetch(request);
  },
};
