import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HttpError,
  accountType,
  allowedOrigin,
  connectionState,
  enforceRateLimit,
  maskIban,
  normalizeMappings,
  opaqueAccountId,
  publicAccounts
} from '../src/lib.js';

class MemoryKv {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key) || null; }
  async put(key, value) { this.values.set(key, value); }
}

test('CORS limite les appels au site Freev publie', () => {
  const env = { FREEV_ALLOWED_ORIGIN: 'https://trystan2340.github.io' };
  assert.equal(allowedOrigin(new Request('https://worker.example', { headers: { origin: env.FREEV_ALLOWED_ORIGIN } }), env), env.FREEV_ALLOWED_ORIGIN);
  assert.equal(allowedOrigin(new Request('https://worker.example', { headers: { origin: 'https://attacker.example' } }), env), '');
});

test('les identifiants bancaires rendus au navigateur sont opaques et les IBAN masques', async () => {
  const accountId = await opaqueAccountId('firebase-user', 42);
  assert.match(accountId, /^acct_[a-f0-9]{32}$/);
  assert.equal(maskIban('FR76 3000 4000 0000 1234 5678 901'), '•••• 8901');
  const accounts = await publicAccounts('firebase-user', [{ id: 42, name: 'Compte courant', type: 'checking', iban: 'FR761234' }]);
  assert.equal(accounts[0].id, accountId);
  assert.equal(accounts[0].type, 'current');
  assert.equal(accounts[0].maskedIban, '•••• 1234');
  assert.deepEqual(await publicAccounts('firebase-user', [{ name: 'Sans identifiant' }]), []);
});

test('les associations imposent un compte externe et Freev uniques', () => {
  assert.deepEqual(normalizeMappings([{ bankAccountId: 'acct_a', freevAccountId: 'freev_a' }], ['acct_a'], ['freev_a']), [{ bankAccountId: 'acct_a', freevAccountId: 'freev_a' }]);
  assert.throws(
    () => normalizeMappings([{ bankAccountId: 'acct_a', freevAccountId: 'freev_a' }, { bankAccountId: 'acct_a', freevAccountId: 'freev_b' }], ['acct_a'], ['freev_a', 'freev_b']),
    error => error instanceof HttpError && error.code === 'invalid_mapping'
  );
});

test('les etats du prestataire restent comprehensibles pour Freev', () => {
  assert.equal(connectionState([]), 'not_connected');
  assert.equal(connectionState([{ state: 'SCA_REQUIRED' }]), 'action_required');
  assert.equal(connectionState([{ state: 'WEBSITE_UNAVAILABLE' }]), 'error');
  assert.equal(connectionState([{ state: null }]), 'ready');
  assert.equal(accountType('card'), 'credit');
});

test('la protection anti-abus limite les appels sans stocker IP ou UID en clair', async () => {
  const kv = new MemoryKv();
  const env = { FREEV_BANK_DATA: kv };
  await enforceRateLimit(env, 'sync', 'firebase-user-42', { limit: 2, windowSeconds: 60 });
  await enforceRateLimit(env, 'sync', 'firebase-user-42', { limit: 2, windowSeconds: 60 });
  await assert.rejects(
    enforceRateLimit(env, 'sync', 'firebase-user-42', { limit: 2, windowSeconds: 60 }),
    error => error instanceof HttpError && error.status === 429 && error.code === 'rate_limited'
  );
  assert.ok([...kv.values.keys()].every(key => !key.includes('firebase-user-42')));
});

test('la protection anti-abus bloque aussi une rafale concurrente dans une instance Worker', async () => {
  const kv = new MemoryKv();
  const env = { FREEV_BANK_DATA: kv };
  const results = await Promise.allSettled(Array.from({ length: 3 }, () =>
    enforceRateLimit(env, 'status', 'concurrent-user', { limit: 2, windowSeconds: 60 })
  ));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
});
