import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculationCacheKey,
  createCalculationCache,
  createLatestRequestCoordinator
} from '../assets/js/calculation-coordination.mjs';

const context = overrides => ({
  engineVersion: 'finance-v1',
  dataRevision: 4,
  calculationDate: '2026-10-22',
  accountScope: ['main', 'savings'],
  options: { horizon: 30, includePlanned: true },
  ...overrides
});

test('ALX 12 : cache key includes revision, day, scope, options and engine version', () => {
  const base = context();
  const reordered = context({ accountScope: ['savings', 'main'], options: { includePlanned: true, horizon: 30 } });
  assert.equal(calculationCacheKey(base), calculationCacheKey(reordered));
  for (const change of [
    { dataRevision: 5 },
    { calculationDate: '2026-10-23' },
    { accountScope: ['main'] },
    { options: { horizon: 31, includePlanned: true } },
    { engineVersion: 'finance-v2' }
  ]) assert.notEqual(calculationCacheKey(base), calculationCacheKey(context(change)));
});

test('ALX 12 : dependency invalidation touches only affected account, period and indicator', () => {
  const cache = createCalculationCache({ maxEntries: 8 });
  const affected = context({ accountScope: ['main'] });
  const unrelated = context({ accountScope: ['savings'] });
  const otherPeriod = context({ accountScope: ['main'], options: { horizon: 31 } });
  const deps = [{ accountId: 'main', period: '2026-10', indicator: 'balance' }];
  cache.set(affected, { total: 100 }, { dependencies: deps });
  cache.set(unrelated, { total: 200 }, { dependencies: [{ accountId: 'savings', period: '2026-10', indicator: 'balance' }] });
  cache.set(otherPeriod, { total: 300 }, { dependencies: [{ accountId: 'main', period: '2026-09', indicator: 'balance' }] });

  assert.equal(cache.invalidate({ accountIds: ['main'], periods: ['2026-10'], indicators: ['balance'] }), 1);
  assert.equal(cache.get(affected), undefined);
  assert.deepEqual(cache.get(unrelated), { total: 200 });
  assert.deepEqual(cache.get(otherPeriod), { total: 300 });
});

test('ALX 12 : account-wide dependencies conservatively invalidate for any period in that account', () => {
  const cache = createCalculationCache();
  const ctx = context({ accountScope: ['main'] });
  cache.set(ctx, { count: 2 }, { dependencies: [{ accountId: 'main', indicator: 'forecast' }] });
  assert.equal(cache.invalidate({ accountIds: ['main'], periods: ['2026-10'], indicators: ['forecast'] }), 1);
  assert.equal(cache.has(ctx), false);
});

test('ALX 12 : cached values are copied and the cache evicts least recently used entries', () => {
  const cache = createCalculationCache({ maxEntries: 2 });
  const a = context({ accountScope: ['a'] });
  const b = context({ accountScope: ['b'] });
  const c = context({ accountScope: ['c'] });
  cache.set(a, { nested: { amount: 10 } });
  cache.set(b, { nested: { amount: 20 } });
  const returned = cache.get(a);
  returned.nested.amount = 999;
  assert.deepEqual(cache.get(a), { nested: { amount: 10 } });
  cache.set(c, { nested: { amount: 30 } });
  assert.equal(cache.has(b), false);
  assert.equal(cache.has(a), true);
  assert.equal(cache.size, 2);
});

test('ALX 12 : cache context rejects invalid dates, missing revisions and non-finite options', () => {
  assert.throws(() => calculationCacheKey(context({ calculationDate: '2026-02-30' })), /date/i);
  assert.throws(() => calculationCacheKey(context({ dataRevision: undefined })), /révision/i);
  assert.throws(() => calculationCacheKey(context({ options: { count: Infinity } })), /finis/i);
});

test('ALX 13 : une requête plus récente invalide et interrompt la précédente du même canal', () => {
  const jobs = createLatestRequestCoordinator();
  const first = jobs.begin('search');
  const second = jobs.begin('search');
  assert.ok(second.requestId > first.requestId);
  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  assert.equal(second.isCurrent(), true);
  let commits = 0;
  assert.equal(first.commit(() => { commits += 1; }), false);
  assert.equal(second.commit(() => { commits += 1; }), true);
  assert.equal(commits, 1);
});

test('ALX 13 : les canaux indépendants ne se bloquent pas ; annulation explicite rend le résultat obsolète', () => {
  const jobs = createLatestRequestCoordinator();
  const search = jobs.begin('search');
  const forecast = jobs.begin('forecast');
  assert.equal(search.isCurrent(), true);
  assert.equal(forecast.isCurrent(), true);
  assert.equal(jobs.cancel('search'), true);
  assert.equal(search.signal.aborted, true);
  assert.equal(search.isCurrent(), false);
  assert.equal(forecast.isCurrent(), true);
});

test('ALX 13 : runLatest marque les anciens résultats obsolètes sans les renvoyer comme résultats valides', async () => {
  const jobs = createLatestRequestCoordinator();
  let finishOld;
  let finishCurrent;
  const old = jobs.runLatest('projection', () => new Promise(resolve => { finishOld = resolve; }));
  const current = jobs.runLatest('projection', () => new Promise(resolve => { finishCurrent = resolve; }));
  finishOld({ balance: 1 });
  assert.deepEqual(await old, { requestId: 1, status: 'stale' });
  finishCurrent({ balance: 2 });
  assert.deepEqual(await current, { requestId: 2, status: 'current', value: { balance: 2 } });
});

