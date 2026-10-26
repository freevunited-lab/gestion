// Coordination helpers for bounded financial calculation caches and async UI work.
// The module never persists financial values and never performs application writes.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEPENDENCY_FIELDS = ['accountId', 'period', 'indicator'];

function canonical(value, stack = new WeakSet()) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `string:${JSON.stringify(value)}`;
  if (typeof value === 'boolean') return `boolean:${value ? '1' : '0'}`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Les options de calcul doivent contenir des nombres finis.');
    return `number:${Object.is(value, -0) ? '0' : String(value)}`;
  }
  if (typeof value === 'bigint') return `bigint:${value.toString()}`;
  if (typeof value === 'function' || typeof value === 'symbol') throw new TypeError('Contexte de calcul non sérialisable.');
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError('Date non valide dans le contexte de calcul.');
    return `date:${value.toISOString()}`;
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    const values = value instanceof DataView
      ? Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
      : Array.from(value);
    return `typed:${Object.prototype.toString.call(value)}:[${values.map(item => canonical(item, stack)).join(',')}]`;
  }
  if (stack.has(value)) throw new TypeError('Le contexte de calcul ne peut pas contenir de référence circulaire.');
  stack.add(value);
  try {
    if (Array.isArray(value)) return `array:[${Array.from(value, item => canonical(item, stack)).join(',')}]`;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Les options de calcul doivent être des objets simples.');
    if (Object.getOwnPropertySymbols(value).length) throw new TypeError('Les options de calcul ne peuvent pas contenir de clés symboliques.');
    const keys = Object.keys(value).sort();
    return `object:{${keys.map(key => `${JSON.stringify(key)}:${canonical(value[key], stack)}`).join(',')}}`;
  } finally {
    stack.delete(value);
  }
}

function validISODate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeScope(scope) {
  const values = Array.isArray(scope) ? scope : [scope];
  if (!values.length || values.some(value => !['string', 'number'].includes(typeof value) ||
      (typeof value === 'string' && !value.trim()) || (typeof value === 'number' && !Number.isFinite(value)))) {
    throw new TypeError('Le périmètre doit contenir au moins un identifiant de compte valide.');
  }
  return values.map(value => canonical(value)).sort();
}

/**
 * Produces a deterministic cache key for a calculation result.
 * All arguments that can change a financial result are required in the key.
 */
export function calculationCacheKey({ engineVersion, dataRevision, calculationDate, accountScope, options = {} } = {}) {
  if (typeof engineVersion !== 'string' || !engineVersion.trim()) throw new TypeError('Version du moteur requise.');
  if (dataRevision === undefined || dataRevision === null || dataRevision === '') throw new TypeError('Révision des données requise.');
  if (!validISODate(calculationDate)) throw new TypeError('Date de calcul ISO invalide.');
  const scope = normalizeScope(accountScope);
  return `freev-calculation-v1:${canonical([engineVersion, dataRevision, calculationDate, scope, options])}`;
}

function cloneValue(value) {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeDependencies(dependencies) {
  const input = dependencies == null ? [] : Array.isArray(dependencies) ? dependencies : [dependencies];
  if (!input.length) return [{}]; // Undeclared dependencies are global and invalidate conservatively.
  return input.map(dependency => {
    if (!dependency || typeof dependency !== 'object' || Array.isArray(dependency)) {
      throw new TypeError('Chaque dépendance doit préciser un compte, une période ou un indicateur.');
    }
    const normalized = {};
    for (const field of DEPENDENCY_FIELDS) {
      const value = dependency[field];
      if (value === undefined || value === null || value === '*') continue;
      if (Array.isArray(value)) {
        if (value.some(item => item === undefined || item === null || String(item) === '')) throw new TypeError(`Dépendance ${field} invalide.`);
        normalized[field] = value.map(String);
      } else {
        if (!['string', 'number'].includes(typeof value) || String(value) === '') throw new TypeError(`Dépendance ${field} invalide.`);
        normalized[field] = String(value);
      }
    }
    if (!DEPENDENCY_FIELDS.some(field => Object.hasOwn(normalized, field))) {
      throw new TypeError('Une dépendance doit préciser un compte, une période ou un indicateur.');
    }
    return normalized;
  });
}

function normalizeSelector(selectors, field) {
  const name = { accountId: 'accountIds', period: 'periods', indicator: 'indicators' }[field];
  const key = Object.hasOwn(selectors, name) ? name : field;
  if (!Object.hasOwn(selectors, key)) return null;
  const input = Array.isArray(selectors[key]) ? selectors[key] : [selectors[key]];
  return new Set(input.filter(value => value !== undefined && value !== null).map(String));
}

function dependencyMatches(dependency, selectors) {
  for (const field of DEPENDENCY_FIELDS) {
    const wanted = selectors[field];
    if (wanted === null) continue;
    if (!wanted.size) return false;
    const actual = dependency[field];
    if (actual === undefined) continue; // A broad dependency matches every value in this dimension.
    const values = Array.isArray(actual) ? actual : [actual];
    if (!values.some(value => wanted.has(value))) return false;
  }
  return true;
}

/**
 * Creates a bounded, in-memory LRU cache for derived calculations.
 * Entries should declare their account/period/indicator dependencies so a mutation can invalidate
 * only the affected results. The key still includes revision, date, scope, options and engine version.
 */
export function createCalculationCache({ maxEntries = 128 } = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new RangeError('La taille du cache doit être un entier positif.');
  const entries = new Map();
  const keyOf = calculationCacheKey;

  const has = context => entries.has(keyOf(context));
  const get = context => {
    const key = keyOf(context);
    if (!entries.has(key)) return undefined;
    const entry = entries.get(key);
    entries.delete(key);
    entries.set(key, entry);
    return cloneValue(entry.value);
  };
  const set = (context, value, { dependencies } = {}) => {
    if (value === undefined) throw new TypeError('Une valeur undefined ne peut pas être mise en cache.');
    const key = keyOf(context);
    const entry = { value: cloneValue(value), dependencies: normalizeDependencies(dependencies) };
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    return key;
  };
  const invalidate = (selectors = {}) => {
    if (!selectors || typeof selectors !== 'object' || Array.isArray(selectors)) throw new TypeError('Critères d’invalidation invalides.');
    const filters = Object.fromEntries(DEPENDENCY_FIELDS.map(field => [field, normalizeSelector(selectors, field)]));
    const scoped = DEPENDENCY_FIELDS.some(field => filters[field] !== null);
    if (!scoped) {
      const removed = entries.size;
      entries.clear();
      return removed;
    }
    let removed = 0;
    for (const [key, entry] of entries) {
      if (entry.dependencies.some(dependency => dependencyMatches(dependency, filters))) {
        entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  };
  const clear = () => {
    const removed = entries.size;
    entries.clear();
    return removed;
  };

  return Object.freeze({
    get,
    set,
    has,
    invalidate,
    clear,
    key: keyOf,
    get size() { return entries.size; }
  });
}

/**
 * Creates latest-wins request coordination for searches and projections.
 * Work returns data; callers must commit UI state only through ticket.commit() or after isCurrent().
 */
export function createLatestRequestCoordinator() {
  if (typeof globalThis.AbortController !== 'function') throw new Error('AbortController est requis.');
  const current = new Map();
  let sequence = 0;

  const isCurrent = ticket => {
    if (!ticket || typeof ticket.channel !== 'string' || !Number.isSafeInteger(ticket.requestId)) return false;
    const active = current.get(ticket.channel);
    return Boolean(active && active.requestId === ticket.requestId && !active.controller.signal.aborted);
  };
  const cancel = channel => {
    const key = String(channel || 'default');
    const active = current.get(key);
    if (!active) return false;
    active.controller.abort();
    current.delete(key);
    return true;
  };
  const begin = (channel = 'default') => {
    const key = String(channel || 'default');
    const previous = current.get(key);
    if (previous) previous.controller.abort();
    sequence += 1;
    if (!Number.isSafeInteger(sequence)) throw new RangeError('Identifiant de requête épuisé.');
    const active = { channel: key, requestId: sequence, controller: new AbortController() };
    current.set(key, active);
    const ticket = {
      channel: key,
      requestId: active.requestId,
      signal: active.controller.signal,
      isCurrent: () => isCurrent(ticket),
      commit(callback) {
        if (!isCurrent(ticket)) return false;
        if (typeof callback !== 'function') throw new TypeError('La validation du résultat doit être une fonction.');
        callback();
        return true;
      },
      cancel: () => cancel(key)
    };
    return Object.freeze(ticket);
  };
  const cancelAll = () => {
    let cancelled = 0;
    for (const channel of [...current.keys()]) if (cancel(channel)) cancelled += 1;
    return cancelled;
  };
  const runLatest = async (channel, work) => {
    if (typeof work !== 'function') throw new TypeError('Le calcul doit être une fonction.');
    const ticket = begin(channel);
    try {
      const value = await work({ requestId: ticket.requestId, signal: ticket.signal });
      return ticket.isCurrent()
        ? { requestId: ticket.requestId, status: 'current', value }
        : { requestId: ticket.requestId, status: 'stale' };
    } catch (error) {
      if (!ticket.isCurrent()) return { requestId: ticket.requestId, status: 'stale' };
      throw error;
    }
  };

  return Object.freeze({
    begin,
    cancel,
    cancelAll,
    isCurrent,
    commit: (ticket, callback) => ticket?.commit?.(callback) || false,
    runLatest,
    get nextRequestId() { return sequence + 1; }
  });
}

