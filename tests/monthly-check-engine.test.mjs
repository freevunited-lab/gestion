import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMonthlyCheck, recordDecision, validateMonth, traceReopen, monthSignature, defaultMonth } from '../assets/js/monthly-check-engine.mjs';

const TODAY = '2026-10-22';
const M = '2026-09';
const tx = (o) => ({ type: 'expense', category: 'Alimentation', amount: 20, date: '2026-09-10', paymentStatus: 'paid', desc: o.id, ...o });
const history = ['2026-04-05', '2026-05-05', '2026-06-05', '2026-07-05', '2026-08-05'].map((date, i) => tx({ id: `h${i}`, date, amount: 40, desc: `Courses ${i}` }));
const base = () => ({
  id: 'a', transactions: [
    ...history,
    tx({ id: 'ok1', desc: 'Boulangerie', amount: 4.5, date: '2026-09-02' }),
    tx({ id: 'd1', desc: 'Cinéma', amount: 25, date: '2026-09-12', category: 'Loisirs' }),
    tx({ id: 'd2', desc: 'cinema', amount: 25, date: '2026-09-12', category: 'Loisirs' }),
    tx({ id: 'nc', desc: 'Inconnu', amount: 9, date: '2026-09-15', category: 'À classer' }),
    tx({ id: 'nc2', desc: 'Autre inconnu', amount: 3, date: '2026-09-16', category: '' }),
    tx({ id: 'pend', desc: 'Loyer', amount: 650, date: '2026-09-28', category: 'Logement', paymentStatus: 'planned' }),
    tx({ id: 'big', desc: 'Grosse course', amount: 190, date: '2026-09-20' }),
    tx({ id: 'rec', desc: 'Pointée', amount: 12, date: '2026-09-21', category: 'Santé', reconciled: true }),
    tx({ id: 'rm', isRecurring: true, desc: 'Modèle', amount: 999, date: '2026-09-01' })
  ]
});
const kinds = r => r.items.map(i => i.kind).sort();

test('QUO 07 : seules les situations à décider sont proposées, pas les opérations saines', () => {
  const r = buildMonthlyCheck(base(), M, { today: TODAY });
  assert.deepEqual(kinds(r), ['category', 'duplicate', 'pending', 'reconciliation', 'unusual']);
  assert.ok(!r.items.some(i => i.kind !== 'reconciliation' && i.refs.includes('ok1')));
  assert.ok(!r.items.some(i => i.refs.includes('rm'))); // modèle récurrent jamais proposé
  assert.ok(r.counts.healthy >= 1 && r.counts.operations === 8);
});

test('QUO 07 : cause et incertitude sont fournies pour chaque proposition', () => {
  const r = buildMonthlyCheck(base(), M, { today: TODAY });
  for (const i of r.items) { assert.ok(i.cause.length > 10); assert.match(i.uncertaintyLabel, /Incertitude/); }
  const dup = r.items.find(i => i.kind === 'duplicate');
  assert.deepEqual(dup.refs, ['d1', 'd2']);
  const unusual = r.items.find(i => i.kind === 'unusual');
  assert.match(unusual.cause, /190,00\s€/);
  assert.match(unusual.cause, /40,00\s€/);
});

test('QUO 07 : l’écart de pointage n’est proposé que si l’utilisateur pointe déjà et que le mois est terminé', () => {
  const a = base(); a.transactions.forEach(t => { t.reconciled = false; });
  assert.ok(!buildMonthlyCheck(a, M, { today: TODAY }).items.some(i => i.kind === 'reconciliation'));
  assert.ok(!buildMonthlyCheck(base(), M, { today: '2026-09-20' }).items.some(i => i.kind === 'reconciliation'));
});

test('QUO 07 : confirmer / ignorer masque la proposition ; une donnée nouvelle la fait réapparaître', () => {
  const a = base();
  const first = buildMonthlyCheck(a, M, { today: TODAY });
  const cat = first.items.find(i => i.kind === 'category');
  a.monthlyChecks = { [M]: recordDecision(a, M, cat, 'ignored', { today: TODAY }) };
  assert.ok(!buildMonthlyCheck(a, M, { today: TODAY }).items.some(i => i.kind === 'category'));
  assert.equal(buildMonthlyCheck(a, M, { today: '2026-10-30' }).hidden.length, 1); // pas de retour immédiat, ni plus tard sans donnée nouvelle
  a.transactions.push(tx({ id: 'nc3', desc: 'Nouveau', date: '2026-09-17', category: '' }));
  const again = buildMonthlyCheck(a, M, { today: TODAY }).items.find(i => i.kind === 'category');
  assert.ok(again && again.reopened);
});

test('QUO 07 : reporter masque 7 jours puis la proposition revient', () => {
  const a = base();
  const pend = buildMonthlyCheck(a, M, { today: TODAY }).items.find(i => i.kind === 'pending');
  a.monthlyChecks = { [M]: recordDecision(a, M, pend, 'postponed', { today: TODAY }) };
  assert.equal(a.monthlyChecks[M].decisions[pend.id].until, '2026-10-29');
  assert.ok(!buildMonthlyCheck(a, M, { today: '2026-10-28' }).items.some(i => i.kind === 'pending'));
  assert.ok(buildMonthlyCheck(a, M, { today: '2026-10-29' }).items.some(i => i.kind === 'pending'));
});

test('QUO 07 : valider un mois = vérifié ; une modification historique le rouvre avec une trace', () => {
  const a = base();
  a.monthlyChecks = { [M]: validateMonth(a, M, { today: TODAY }) };
  assert.equal(buildMonthlyCheck(a, M, { today: TODAY }).status, 'validated');
  assert.match(a.monthlyChecks[M].log[0].title, /pas une certification/);
  a.transactions.find(t => t.id === 'ok1').amount = 5;
  assert.equal(buildMonthlyCheck(a, M, { today: TODAY }).status, 'reopened');
  const rec = traceReopen(a, M, { today: TODAY });
  assert.equal(rec.log[0].event, 'reopened');
  a.monthlyChecks[M] = rec;
  assert.equal(traceReopen(a, M, { today: TODAY }), null); // une seule trace par état
  // Une opération d'un autre mois ne rouvre pas ce mois.
  const b = base(); b.monthlyChecks = { [M]: validateMonth(b, M, { today: TODAY }) };
  b.transactions.push(tx({ id: 'oct', date: '2026-10-05' }));
  assert.equal(buildMonthlyCheck(b, M, { today: TODAY }).status, 'validated');
});

test('QUO 07 : pas de mutation de l’entrée, mois invalide refusé, mois par défaut', () => {
  const a = base(); const copy = JSON.stringify(a);
  buildMonthlyCheck(a, M, { today: TODAY }); recordDecision(a, M, { id: 'x', fingerprint: 'f', title: 't' }, 'confirmed', { today: TODAY });
  assert.equal(JSON.stringify(a), copy);
  assert.equal(buildMonthlyCheck(a, '2026-13', { today: TODAY }).ok, false);
  assert.equal(defaultMonth('2026-01-15'), '2025-12');
  assert.notEqual(monthSignature(a, M), monthSignature(a, '2026-08'));
  assert.throws(() => recordDecision(a, M, { id: 'x' }, 'delete', { today: TODAY }));
});

test('QUO 07 : montants invalides et revenus ne produisent ni doublon ni montant inhabituel', () => {
  const a = { id: 'a', transactions: [tx({ id: '1', amount: 'abc', desc: 'X' }), tx({ id: '2', amount: 'abc', desc: 'X' }), tx({ id: '3', type: 'income', amount: 5000, desc: 'Paie', category: 'Salaire' })] };
  const r = buildMonthlyCheck(a, M, { today: TODAY });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid-data');
  assert.deepEqual(r.errors.map(error => error.transactionId), ['1', '2']);
});

test('ALX 02 : une date invalide ne disparaît pas silencieusement du mois vérifié', () => {
  const result = buildMonthlyCheck({ id: 'a', transactions: [tx({ id: 'bad-date', date: '2026-09-31' })] }, M, { today: TODAY });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'invalid-date');
  assert.equal(result.errors[0].transactionId, 'bad-date');
});
