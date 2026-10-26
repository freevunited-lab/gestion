const MAX_MAPPING_COUNT = 32;
const RATE_LIMIT_PREFIX = 'bank-rate:';
const localRateWindows = new Map();

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  });
}

export function allowedOrigin(request, env) {
  const origin = request.headers.get('origin') || '';
  return origin && origin === env.FREEV_ALLOWED_ORIGIN ? origin : '';
}

export function corsHeaders(request, env) {
  const origin = allowedOrigin(request, env);
  return origin ? {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '600',
    vary: 'Origin'
  } : {};
}

export function requireAllowedOrigin(request, env) {
  if (request.headers.has('origin') && !allowedOrigin(request, env)) {
    throw new HttpError(403, 'origin_not_allowed', 'Origine non autorisée.');
  }
}

export function readBearer(request) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '');
  if (!match || match[1].length > 8192) throw new HttpError(401, 'missing_auth', 'Authentification requise.');
  return match[1];
}

export function safeString(value, max = 160) {
  return String(value || '').trim().slice(0, max);
}

async function opaqueRateKey(scope, subject) {
  const payload = new TextEncoder().encode(`${scope}:${safeString(subject, 256) || 'anonymous'}`);
  const digest = await crypto.subtle.digest('SHA-256', payload);
  const token = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 40);
  return `${RATE_LIMIT_PREFIX}${scope}:${token}`;
}

// Cloudflare KV donne une limite partagée entre les instances du Worker ; le
// petit cache mémoire bloque aussi les rafales concurrentes dans une instance.
// Les clés ne contiennent ni IP ni UID en clair.
export async function enforceRateLimit(env, scope, subject, { limit, windowSeconds }) {
  if (!env?.FREEV_BANK_DATA || !Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowSeconds) || windowSeconds < 1) {
    throw new HttpError(503, 'rate_limit_unavailable', 'La protection anti-abus est indisponible.');
  }
  const key = await opaqueRateKey(scope, subject);
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const local = localRateWindows.get(key);
  if (local && local.resetAt > now && local.count >= limit) {
    throw new HttpError(429, 'rate_limited', 'Trop de demandes. Réessayez dans un instant.');
  }
  // Réserve immédiatement un créneau dans l'instance. Sans cette étape, une
  // rafale concurrente pourrait lire le même compteur KV avant son écriture.
  const reservation = local && local.resetAt > now
    ? { count: local.count + 1, resetAt: local.resetAt }
    : { count: 1, resetAt: now + windowMs };
  localRateWindows.set(key, reservation);
  try {
    const stored = await env.FREEV_BANK_DATA.get(key);
    const parsed = stored ? JSON.parse(stored) : null;
    const active = parsed && Number.isFinite(parsed.resetAt) && parsed.resetAt > now
      ? { count: Number(parsed.count) || 0, resetAt: parsed.resetAt }
      : { count: 0, resetAt: now + windowMs };
    if (active.count >= limit) {
      localRateWindows.set(key, active);
      throw new HttpError(429, 'rate_limited', 'Trop de demandes. Réessayez dans un instant.');
    }
    const next = { count: Math.max(active.count + 1, reservation.count), resetAt: active.resetAt };
    localRateWindows.set(key, next);
    await env.FREEV_BANK_DATA.put(key, JSON.stringify(next), { expirationTtl: Math.max(1, Math.ceil((next.resetAt - now) / 1000)) });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, 'rate_limit_unavailable', 'La protection anti-abus est indisponible.');
  }
}

export function safeIdentifier(value) {
  const identifier = safeString(value, 160);
  return /^[A-Za-z0-9._:-]{1,160}$/.test(identifier) ? identifier : '';
}

export function maskIban(value) {
  const clean = String(value || '').replace(/[^A-Za-z0-9]/g, '');
  return clean.length >= 4 ? `•••• ${clean.slice(-4)}` : '';
}

export function accountType(value) {
  const source = safeString(value, 32).toLowerCase();
  if (source.includes('saving') || source.includes('livret')) return 'savings';
  if (source.includes('card') || source.includes('credit')) return 'credit';
  if (source.includes('check') || source.includes('current')) return 'current';
  return 'other';
}

export async function opaqueAccountId(userId, rawAccountId) {
  const payload = new TextEncoder().encode(`${userId}:${String(rawAccountId)}`);
  const digest = await crypto.subtle.digest('SHA-256', payload);
  return `acct_${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32)}`;
}

export async function publicAccounts(userId, accounts) {
  return Promise.all((Array.isArray(accounts) ? accounts : []).map(async account => {
    if (account?.id === undefined || account?.id === null || account.id === '') return null;
    return {
      id: await opaqueAccountId(userId, account.id),
      name: safeString(account.name || account.label || 'Compte bancaire', 80),
      type: accountType(account.type),
      currency: /^[A-Z]{3}$/.test(String(account.currency?.id || account.currency || '').toUpperCase())
        ? String(account.currency?.id || account.currency).toUpperCase()
        : 'EUR',
      maskedIban: maskIban(account.iban || account.number)
    };
  })).then(items => items.filter(Boolean));
}

export function normalizeMappings(value, bankAccountIds, freevAccountIds) {
  const bankIds = new Set(bankAccountIds || []);
  const freevIds = new Set(freevAccountIds || []);
  const usedBankIds = new Set();
  const usedFreevIds = new Set();
  const mappings = Array.isArray(value) ? value : [];
  if (mappings.length > MAX_MAPPING_COUNT) throw new HttpError(400, 'too_many_mappings', 'Trop de comptes à associer.');
  return mappings.reduce((result, mapping) => {
    const bankAccountId = safeIdentifier(mapping?.bankAccountId);
    const freevAccountId = safeIdentifier(mapping?.freevAccountId);
    if (!bankIds.has(bankAccountId) || !freevIds.has(freevAccountId) || usedBankIds.has(bankAccountId) || usedFreevIds.has(freevAccountId)) {
      throw new HttpError(400, 'invalid_mapping', 'Association de comptes invalide.');
    }
    usedBankIds.add(bankAccountId);
    usedFreevIds.add(freevAccountId);
    result.push({ bankAccountId, freevAccountId });
    return result;
  }, []);
}

export function connectionState(connections) {
  const values = (Array.isArray(connections) ? connections : []).map(connection => String(connection?.state || '').toLowerCase());
  if (!values.length) return 'not_connected';
  if (values.some(value => /error|wrong|unavailable/.test(value))) return 'error';
  if (values.some(value => /sca|otp|action|need/.test(value))) return 'action_required';
  if (values.some(value => /sync/.test(value))) return 'syncing';
  return 'ready';
}

export function latestSync(connections) {
  const dates = (Array.isArray(connections) ? connections : [])
    .map(connection => connection?.last_update || connection?.last_sync || connection?.updated_at)
    .filter(value => typeof value === 'string' && !Number.isNaN(Date.parse(value)))
    .sort();
  return dates.at(-1) || '';
}
