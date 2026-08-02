// Jasmine Residency cloud data API.
//
// This Pages Function is intentionally fail-closed: it requires a D1 binding and
// a valid Cloudflare Access JWT before it will read or write tenant data.

const DATA_ID = 'main';
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;

let jwksCache = null;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function errorResponse(message, status = 400) {
  return json({ error: message }, status);
}

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function base64UrlToJson(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
}

function normaliseTeamDomain(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

async function getJwks(teamDomain) {
  const now = Date.now();
  if (jwksCache && jwksCache.domain === teamDomain && jwksCache.expiresAt > now) {
    return jwksCache.keys;
  }

  const response = await fetch(`${teamDomain}/cdn-cgi/access/certs`, {
    headers: { accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`Access key lookup failed (${response.status})`);

  const body = await response.json();
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    throw new Error('Access key lookup returned no keys');
  }

  jwksCache = { domain: teamDomain, keys: body.keys, expiresAt: now + JWKS_CACHE_TTL_MS };
  return body.keys;
}

async function verifyAccessToken(request, env) {
  const teamDomain = normaliseTeamDomain(env.CF_ACCESS_TEAM_DOMAIN);
  const audience = String(env.CF_ACCESS_AUD || '').trim();
  const token = request.headers.get('cf-access-jwt-assertion');

  if (!teamDomain || !audience || !token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  let header;
  let payload;
  try {
    header = base64UrlToJson(parts[0]);
    payload = base64UrlToJson(parts[1]);
  } catch (error) {
    return null;
  }

  if (header.alg !== 'RS256' || !header.kid) return null;
  if (payload.iss !== teamDomain) return null;
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(audience)) return null;

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp <= now) return null;
  if (payload.nbf && payload.nbf > now + 60) return null;

  const jwks = await getJwks(teamDomain);
  const jwk = jwks.find(key => key.kid === header.kid && key.alg === 'RS256');
  if (!jwk) return null;

  const publicKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const verified = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    publicKey,
    base64UrlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );

  return verified ? payload : null;
}

async function requireAccess(request, env) {
  if (!env.JASMINE_DB) {
    return { response: errorResponse('Cloud database is not bound yet. Add the JASMINE_DB D1 binding and run schema.sql.', 503) };
  }
  if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) {
    return { response: errorResponse('Cloud authentication is not configured yet. Add Cloudflare Access and its team domain/AUD variables.', 503) };
  }

  try {
    const identity = await verifyAccessToken(request, env);
    if (!identity) return { response: errorResponse('Cloudflare Access authentication required.', 401) };
    return { identity };
  } catch (error) {
    return { response: errorResponse('Cloudflare Access token validation failed.', 401) };
  }
}

function validateData(data) {
  if (!data || !Array.isArray(data.tenants)) return 'The uploaded data must contain a tenants array.';
  for (const tenant of data.tenants) {
    if (!tenant || typeof tenant !== 'object' || tenant.flat === undefined || !Array.isArray(tenant.entries)) {
      return 'Each tenant must contain a flat value and entries array.';
    }
  }
  return null;
}

async function readCurrent(db) {
  return db.prepare('SELECT payload, version, updated_at AS updatedAt FROM app_data WHERE id = ?')
    .bind(DATA_ID)
    .first();
}

export async function onRequestGet(context) {
  const auth = await requireAccess(context.request, context.env);
  if (auth.response) return auth.response;

  try {
    const row = await readCurrent(context.env.JASMINE_DB);
    if (!row) return json({ data: null, version: 0, updatedAt: 0 });
    return json({
      data: JSON.parse(row.payload),
      version: Number(row.version),
      updatedAt: Number(row.updatedAt)
    });
  } catch (error) {
    return errorResponse('Cloud database is not ready. Apply schema.sql, then try again.', 503);
  }
}

export async function onRequestPut(context) {
  const auth = await requireAccess(context.request, context.env);
  if (auth.response) return auth.response;

  let body;
  try {
    body = await context.request.json();
  } catch (error) {
    return errorResponse('Request body must be valid JSON.');
  }

  const validationError = validateData(body && body.data);
  if (validationError) return errorResponse(validationError);

  const payload = JSON.stringify(body.data);
  if (new TextEncoder().encode(payload).byteLength > MAX_PAYLOAD_BYTES) {
    return errorResponse('Backup is larger than the cloud API limit.', 413);
  }

  const expectedVersion = Number.isInteger(body.expectedVersion) && body.expectedVersion >= 0
    ? body.expectedVersion
    : 0;
  const now = Date.now();
  const db = context.env.JASMINE_DB;

  try {
    const current = await readCurrent(db);
    if (!current) {
      if (expectedVersion !== 0) {
        return json({ error: 'Cloud version conflict.', ...(await currentConflict(db)) }, 409);
      }
      await db.prepare(
        'INSERT INTO app_data (id, payload, version, updated_at) VALUES (?, ?, 1, ?)'
      ).bind(DATA_ID, payload, now).run();
      return json({ data: body.data, version: 1, updatedAt: now });
    }

    if (Number(current.version) !== expectedVersion) {
      return json({ error: 'Cloud version conflict.', ...(await currentConflict(db)) }, 409);
    }

    const result = await db.prepare(
      'UPDATE app_data SET payload = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?'
    ).bind(payload, now, DATA_ID, expectedVersion).run();

    if (!result.meta || result.meta.changes !== 1) {
      return json({ error: 'Cloud version conflict.', ...(await currentConflict(db)) }, 409);
    }
    return json({ data: body.data, version: expectedVersion + 1, updatedAt: now });
  } catch (error) {
    return errorResponse('Cloud save failed. Check the D1 schema and binding.', 503);
  }
}

async function currentConflict(db) {
  const row = await readCurrent(db);
  if (!row) return { data: null, version: 0, updatedAt: 0 };
  return {
    data: JSON.parse(row.payload),
    version: Number(row.version),
    updatedAt: Number(row.updatedAt)
  };
}
