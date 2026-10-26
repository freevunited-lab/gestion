import {
  HttpError,
  connectionState,
  corsHeaders,
  enforceRateLimit,
  json,
  latestSync,
  normalizeMappings,
  opaqueAccountId,
  publicAccounts,
  readBearer,
  requireAllowedOrigin,
  safeString
} from './lib.js';

const RECORD_PREFIX = 'bank-user:';
const MAX_TRANSACTIONS = 100;

function clientRateSubject(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0] || 'anonymous';
}

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function recordKeyMaterial(env) {
  try {
    const key = base64UrlDecode(env.BANK_DATA_ENCRYPTION_KEY);
    if (key.byteLength !== 32) throw new Error('invalid_key_length');
    return crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  } catch {
    throw new HttpError(503, 'bank_storage_not_configured', 'Le coffre bancaire sécurisé n’est pas encore configuré.');
  }
}

async function encryptRecord(env, record) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await recordKeyMaterial(env);
  const payload = new TextEncoder().encode(JSON.stringify(record));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload);
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(encrypted))}`;
}

async function decryptRecord(env, value) {
  const [version, ivValue, encryptedValue] = String(value || '').split('.');
  if (version !== 'v1' || !ivValue || !encryptedValue) return null;
  try {
    const key = await recordKeyMaterial(env);
    const clear = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64UrlDecode(ivValue) },
      key,
      base64UrlDecode(encryptedValue)
    );
    const record = JSON.parse(new TextDecoder().decode(clear));
    return record && typeof record.powensToken === 'string' ? record : null;
  } catch {
    return null;
  }
}

function recordKey(uid) {
  return `${RECORD_PREFIX}${uid}`;
}

async function readRecord(env, uid) {
  const raw = await env.FREEV_BANK_DATA.get(recordKey(uid));
  if (!raw) return null;
  return decryptRecord(env, raw);
}

async function writeRecord(env, uid, record) {
  await env.FREEV_BANK_DATA.put(recordKey(uid), await encryptRecord(env, record));
}

async function firebaseIdentity(request, env) {
  const idToken = readBearer(request);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken })
  });
  if (!response.ok) throw new HttpError(401, 'invalid_auth', 'Session Freev invalide.');
  const payload = await response.json();
  const uid = safeString(payload?.users?.[0]?.localId, 160);
  if (!uid) throw new HttpError(401, 'invalid_auth', 'Session Freev invalide.');
  return { uid, idToken };
}

async function powens(env, token, path, options = {}) {
  const response = await fetch(`${env.POWENS_API_BASE.replace(/\/$/, '')}${path}`, {
    ...options,
    headers: {
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    console.warn(JSON.stringify({ event: 'powens_request_failed', status: response.status, path }));
    throw new HttpError(502, 'bank_provider_error', 'Le service bancaire est indisponible.');
  }
  if (response.status === 204) return null;
  return response.json();
}

async function ensurePowensUser(env, uid) {
  const existing = await readRecord(env, uid);
  if (existing) return existing;
  if (!env.POWENS_CLIENT_ID || !env.POWENS_CLIENT_SECRET) {
    throw new HttpError(503, 'bank_provider_not_configured', 'La connexion bancaire n’est pas encore configurée.');
  }
  const issued = await powens(env, null, '/auth/init', {
    method: 'POST',
    body: JSON.stringify({ client_id: env.POWENS_CLIENT_ID, client_secret: env.POWENS_CLIENT_SECRET })
  });
  const powensToken = safeString(issued?.auth_token, 4096);
  if (!powensToken) throw new HttpError(502, 'bank_provider_error', 'Le service bancaire n’a pas fourni de session utilisateur.');
  const record = {
    powensToken,
    powensUserId: safeString(issued?.id_user || issued?.user?.id, 80),
    mappings: [],
    createdAt: new Date().toISOString()
  };
  await writeRecord(env, uid, record);
  return record;
}

async function providerSnapshot(env, uid, record) {
  const [connectionsPayload, accountsPayload] = await Promise.all([
    powens(env, record.powensToken, '/users/me/connections'),
    powens(env, record.powensToken, '/users/me/accounts?all')
  ]);
  const connections = connectionsPayload?.connections || [];
  const rawAccounts = accountsPayload?.accounts || [];
  const bankAccounts = await publicAccounts(uid, rawAccounts);
  return {
    state: connectionState(connections),
    institution: safeString(connections?.[0]?.connector?.name || connections?.[0]?.connector_name, 80),
    lastSync: latestSync(connections),
    pendingCount: 0,
    bankAccounts,
    mappings: Array.isArray(record.mappings) ? record.mappings : [],
    rawAccounts
  };
}

async function ownedFreevAccountIds(env, uid, idToken) {
  const documentUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/users/${encodeURIComponent(uid)}`;
  const response = await fetch(documentUrl, { headers: { authorization: `Bearer ${idToken}` } });
  if (!response.ok) throw new HttpError(503, 'freev_data_unavailable', 'Les comptes Freev ne peuvent pas être vérifiés pour le moment.');
  const document = await response.json();
  let state;
  try {
    state = JSON.parse(document?.fields?.accountData?.stringValue || '{}');
  } catch {
    throw new HttpError(409, 'freev_data_invalid', 'Les données Freev sont illisibles.');
  }
  return (Array.isArray(state.accounts) ? state.accounts : [])
    .map(account => safeString(account?.id, 160))
    .filter(Boolean);
}

function callbackUri(env) {
  const url = new URL(env.FREEV_REDIRECT_URI);
  if (url.protocol !== 'https:' || url.origin !== env.FREEV_ALLOWED_ORIGIN) {
    throw new HttpError(503, 'redirect_not_configured', 'L’adresse de retour Freev doit être HTTPS et autorisée.');
  }
  return url.toString();
}

async function startConnection(request, env, identity) {
  const record = await ensurePowensUser(env, identity.uid);
  const now = Date.now();
  if (Date.parse(record.lastStartAt || '') > now - 30_000) {
    throw new HttpError(429, 'start_rate_limited', 'Patientez quelques secondes avant de recommencer.');
  }
  const codePayload = await powens(env, record.powensToken, '/auth/token/code?type=singleAccess');
  const code = safeString(codePayload?.code, 1024);
  if (!code) throw new HttpError(502, 'bank_provider_error', 'Le service bancaire n’a pas fourni de code temporaire.');
  const state = crypto.randomUUID();
  record.pendingState = { value: state, expiresAt: now + 30 * 60_000 };
  record.lastStartAt = new Date(now).toISOString();
  await writeRecord(env, identity.uid, record);

  const redirectUrl = new URL('https://webview.powens.com/fr/connect');
  redirectUrl.searchParams.set('domain', env.POWENS_WEBVIEW_DOMAIN);
  redirectUrl.searchParams.set('client_id', env.POWENS_CLIENT_ID);
  redirectUrl.searchParams.set('redirect_uri', callbackUri(env));
  redirectUrl.searchParams.set('code', code);
  redirectUrl.searchParams.set('state', state);
  return json({ redirectUrl: redirectUrl.toString() }, 200, corsHeaders(request, env));
}

async function getStatus(request, env, identity) {
  await enforceRateLimit(env, 'status', identity.uid, { limit: 12, windowSeconds: 60 });
  const record = await readRecord(env, identity.uid);
  if (!record) return json({ state: 'not_connected', bankAccounts: [], mappings: [] }, 200, corsHeaders(request, env));
  const status = await providerSnapshot(env, identity.uid, record);
  return json(status, 200, corsHeaders(request, env));
}

async function saveMappings(request, env, identity) {
  const body = await request.json().catch(() => { throw new HttpError(400, 'invalid_json', 'Corps de requête invalide.'); });
  const record = await readRecord(env, identity.uid);
  if (!record) throw new HttpError(409, 'not_connected', 'Aucune banque n’est connectée.');
  const status = await providerSnapshot(env, identity.uid, record);
  const freevAccountIds = await ownedFreevAccountIds(env, identity.uid, identity.idToken);
  record.mappings = normalizeMappings(body?.mappings, status.bankAccounts.map(account => account.id), freevAccountIds);
  record.updatedAt = new Date().toISOString();
  await writeRecord(env, identity.uid, record);
  return json({ ...status, mappings: record.mappings }, 200, corsHeaders(request, env));
}

async function completeCallback(request, env, identity) {
  const body = await request.json().catch(() => ({}));
  const state = safeString(body?.state, 128);
  const record = await readRecord(env, identity.uid);
  const pending = record?.pendingState;
  if (!record || !pending || pending.value !== state || pending.expiresAt < Date.now()) {
    throw new HttpError(400, 'invalid_callback_state', 'Retour bancaire invalide ou expiré.');
  }
  delete record.pendingState;
  record.lastCallbackAt = new Date().toISOString();
  await writeRecord(env, identity.uid, record);
  const status = await providerSnapshot(env, identity.uid, record);
  return json(status, 200, corsHeaders(request, env));
}

async function syncCandidates(request, env, identity) {
  await enforceRateLimit(env, 'sync', identity.uid, { limit: 4, windowSeconds: 60 });
  const record = await readRecord(env, identity.uid);
  if (!record) throw new HttpError(409, 'not_connected', 'Aucune banque n’est connectée.');
  const status = await providerSnapshot(env, identity.uid, record);
  const transactionsPayload = await powens(env, record.powensToken, `/users/me/transactions?limit=${MAX_TRANSACTIONS}`);
  const rawAccountsById = new Map(status.rawAccounts.map(account => [String(account.id), account]));
  const candidates = await Promise.all((transactionsPayload?.transactions || []).slice(0, MAX_TRANSACTIONS).map(async transaction => ({
    id: `tx_${await opaqueAccountId(identity.uid, transaction.id)}`,
    bankAccountId: rawAccountsById.has(String(transaction.id_account))
      ? await opaqueAccountId(identity.uid, transaction.id_account)
      : '',
    date: safeString(transaction.date || transaction.rdate || transaction.application_date, 32),
    label: safeString(transaction.original_wording || transaction.wording || 'Opération bancaire', 160),
    amount: Number.isFinite(Number(transaction.value)) ? Number(transaction.value) : 0,
    currency: /^[A-Z]{3}$/.test(String(transaction.currency?.id || transaction.currency || '').toUpperCase())
      ? String(transaction.currency?.id || transaction.currency).toUpperCase()
      : 'EUR'
  })));
  return json({ ...status, pendingCount: candidates.length, candidates }, 200, corsHeaders(request, env));
}

async function webhook(request, env) {
  if (!env.POWENS_WEBHOOK_SECRET || request.headers.get('x-freev-webhook-secret') !== env.POWENS_WEBHOOK_SECRET) {
    throw new HttpError(401, 'invalid_webhook', 'Webhook non autorisé.');
  }
  // Les notifications servent uniquement à indiquer qu’une synchronisation est disponible.
  // Aucune transaction, aucun jeton et aucune donnée bancaire ne sont journalisés ici.
  return new Response(null, { status: 204 });
}

function errorResponse(error, request, env) {
  const status = error instanceof HttpError ? error.status : 500;
  const code = error instanceof HttpError ? error.code : 'internal_error';
  if (!(error instanceof HttpError)) console.error(JSON.stringify({ event: 'worker_error', message: error?.message || 'unknown' }));
  return json({ error: code }, status, corsHeaders(request, env));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      try {
        requireAllowedOrigin(request, env);
        return new Response(null, { status: 204, headers: corsHeaders(request, env) });
      } catch (error) {
        return errorResponse(error, request, env);
      }
    }
    try {
      if (url.pathname === '/v1/bank-webhooks/powens' && request.method === 'POST') return webhook(request, env);
      requireAllowedOrigin(request, env);
      // Bloque les jetons invalides avant l'appel Firebase, et limite ensuite
      // chaque utilisateur authentifié avant les appels Powens/Firestore.
      await enforceRateLimit(env, 'identity', clientRateSubject(request), { limit: 30, windowSeconds: 60 });
      const identity = await firebaseIdentity(request, env);
      await enforceRateLimit(env, 'api', identity.uid, { limit: 40, windowSeconds: 60 });
      if (url.pathname === '/v1/bank-connections/start' && request.method === 'POST') return startConnection(request, env, identity);
      if (url.pathname === '/v1/bank-connections/status' && request.method === 'GET') return getStatus(request, env, identity);
      if (url.pathname === '/v1/bank-connections/mappings' && request.method === 'PUT') return saveMappings(request, env, identity);
      if (url.pathname === '/v1/bank-connections/callback' && request.method === 'POST') return completeCallback(request, env, identity);
      if (url.pathname === '/v1/bank-connections/sync' && request.method === 'POST') return syncCandidates(request, env, identity);
      throw new HttpError(404, 'not_found', 'Route inconnue.');
    } catch (error) {
      return errorResponse(error, request, env);
    }
  }
};
