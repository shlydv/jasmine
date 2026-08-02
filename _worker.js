// Worker entrypoint for the existing jasmine-residency static-assets project.
// Cloudflare Workers serves the HTML/assets through ASSETS and routes the D1
// API through the same deployment.

import { onRequestGet, onRequestPut } from './functions/api/data.js';

const API_PATH = '/api/data';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === API_PATH || url.pathname === `${API_PATH}/`) {
      const context = {
        request,
        env,
        waitUntil: promise => ctx && ctx.waitUntil ? ctx.waitUntil(promise) : promise
      };

      if (request.method === 'GET') return onRequestGet(context);
      if (request.method === 'PUT') return onRequestPut(context);
      return new Response('Method not allowed', {
        status: 405,
        headers: { allow: 'GET, PUT' }
      });
    }

    if (!env.ASSETS) {
      return new Response('Static asset binding ASSETS is not configured.', { status: 503 });
    }
    return env.ASSETS.fetch(request);
  }
};
