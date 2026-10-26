import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAutomationRules,
  buildFinancialIntelligence,
  buildLocalAlerts,
  calculateNetWorth,
  detectPersistentExpenseChanges,
  detectSubscriptions,
  merchantKey,
  parseCSVStatement,
  parseQIFStatement,
  partitionDuplicates,
  suggestAutomationRules,
  transactionFingerprint
} from '../assets/js/v5-engine.js';

test('le CSV français accepte les décimales, les guillemets et les accents', () => {
  const parsed = parseCSVStatement('Date;Libellé;Montant;Catégorie\n02/08/2026;"Marché, centre";-42,90;Alimentation\n03/08/2026;Salaire;2100,00;Revenus');
  assert.equal(parsed.delimiter, ';');
  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(parsed.transactions.map(({ date, desc, amount, type, category }) => ({ date, desc, amount, type, category })), [
    { date: '2026-08-02', desc: 'Marché, centre', amount: 42.9, type: 'expense', category: 'Alimentation' },
    { date: '2026-08-03', desc: 'Salaire', amount: 2100, type: 'income', category: 'Revenus' }
  ]);
});

test('le CSV débit/crédit classe correctement les mouvements', () => {
  const parsed = parseCSVStatement('Date,Description,Débit,Crédit\n2026-08-01,Restaurant,25.50,\n2026-08-02,Remboursement,,15.20');
  assert.deepEqual(parsed.transactions.map(item => [item.type, item.amount]), [['expense', 25.5], ['income', 15.2]]);
});

test('l’import de relevé utilise les mêmes unités exactes et écarte les montants trop précis', () => {
  const parsed = parseCSVStatement('Date;Description;Montant\n2026-08-01;Courses;1 234,56\n2026-08-02;Invalide;12,345');
  assert.equal(parsed.transactions.length, 1);
  assert.equal(parsed.transactions[0].amount, 1234.56);
  assert.equal(parsed.errors.length, 1);
});

test('les dates impossibles et les lignes incomplètes sont refusées', () => {
  const parsed = parseCSVStatement('Date;Description;Montant\n31/02/2026;Impossible;-20\n02/08/2026;;-10');
  assert.equal(parsed.transactions.length, 0);
  assert.equal(parsed.errors.length, 2);
});

test('le QIF produit des revenus et dépenses normalisés', () => {
  const qif = '!Type:Bank\nD02/08/2026\nT-12,50\nPCafé du coin\nLRestaurants\n^\nD03/08/2026\nT100\nMPrime\n^';
  const parsed = parseQIFStatement(qif);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.transactions.length, 2);
  assert.equal(parsed.transactions[0].type, 'expense');
  assert.equal(parsed.transactions[0].amount, 12.5);
  assert.equal(parsed.transactions[1].type, 'income');
});

test('les doublons sont détectés dans le relevé et dans le compte existant', () => {
  const existing = [{ date: '2026-08-02', type: 'expense', amount: 12.5, desc: 'CB Café 1234' }];
  const incoming = [
    { date: '2026-08-02', type: 'expense', amountBase: 12.5, desc: 'Café' },
    { date: '2026-08-03', type: 'expense', amount: 20, desc: 'Train' },
    { date: '2026-08-03', type: 'expense', amount: 20, desc: 'Train' }
  ];
  const result = partitionDuplicates(existing, incoming);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.duplicates.length, 2);
  assert.equal(transactionFingerprint(existing[0]), transactionFingerprint(incoming[0]));
});

test('les règles automatisent sans modifier le tableau d’origine', () => {
  const source = [{ id: '1', desc: 'PRLV NETFLIX', category: 'À classer', type: 'expense', amount: 19.99 }];
  const result = applyAutomationRules(source, [{ id: 'r1', contains: 'Netflix', category: 'Abonnements', enabled: true }]);
  assert.equal(result.changed, 1);
  assert.equal(result.transactions[0].category, 'Abonnements');
  assert.equal(result.transactions[0].automationRuleId, 'r1');
  assert.equal(source[0].category, 'À classer');
});

test('les suggestions exigent trois classements cohérents et distinguent revenus et dépenses', () => {
  const suggestions = suggestAutomationRules([
    { desc: 'CB CARREFOUR 123', merchant: 'Carrefour', type: 'expense', category: 'Alimentation' },
    { desc: 'CARREFOUR MARKET 456', merchant: 'Carrefour', type: 'expense', category: 'Alimentation' },
    { desc: 'CARREFOUR MARKET 789', merchant: 'Carrefour', type: 'expense', category: 'Alimentation' },
    { desc: 'REMBOURSEMENT CARREFOUR', merchant: 'Carrefour', type: 'income', category: 'Remboursements' },
    { desc: 'Salaire', merchant: 'Employeur', type: 'income', category: 'Revenus' }
  ]);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].contains, 'carrefour');
  assert.equal(suggestions[0].category, 'Alimentation');
  assert.equal(suggestions[0].matchType, 'expense');
  assert.equal(suggestions[0].sampleSize, 3);
  assert.equal(suggestions[0].confidence, 100);
});

test('les suggestions ignorent les règles automatiques, transferts, récurrences et groupes ambigus', () => {
  const suggestions = suggestAutomationRules([
    { desc: 'NETFLIX 123', merchant: 'Netflix', type: 'expense', category: 'Abonnements' },
    { desc: 'NETFLIX 456', merchant: 'Netflix', type: 'expense', category: 'Abonnements' },
    { desc: 'NETFLIX 789', merchant: 'Netflix', type: 'expense', category: 'Abonnements', automationRuleId: 'old-rule' },
    { desc: 'NETFLIX 012', merchant: 'Netflix', type: 'expense', category: 'Loisirs' },
    { desc: 'ABONNEMENT MUSIQUE', merchant: 'Musique', type: 'expense', category: 'Abonnements', parentId: 'recurring-rule' },
    { desc: 'ABONNEMENT MUSIQUE', merchant: 'Musique', type: 'expense', category: 'Abonnements', projected: true },
    { desc: 'TRANSFERT NETFLIX', merchant: 'Netflix', type: 'transfer', category: 'Abonnements' },
    { desc: 'VENTE', merchant: 'Vide', type: 'expense', category: '   ' }
  ]);
  assert.deepEqual(suggestions, []);
});

test('une règle suggérée limitée aux dépenses ne reclasse jamais un revenu du même commerçant', () => {
  const result = applyAutomationRules([
    { id: 'expense', desc: 'CB CARREFOUR', merchant: 'Carrefour', type: 'expense', category: 'Autre' },
    { id: 'income', desc: 'Remboursement Carrefour', merchant: 'Carrefour', type: 'income', category: 'Remboursements' }
  ], [{ id: 'rule', contains: 'carrefour', category: 'Alimentation', matchType: 'expense' }]);
  assert.equal(result.transactions[0].category, 'Alimentation');
  assert.equal(result.transactions[1].category, 'Remboursements');
  assert.equal(result.transactions[1].automationRuleId, undefined);
  const invalidScope = applyAutomationRules([
    { desc: 'CB CARREFOUR', merchant: 'Carrefour', type: 'expense', category: 'Autre' }
  ], [{ id: 'bad-rule', contains: 'carrefour', category: 'Alimentation', matchType: 'transfer' }]);
  assert.equal(invalidScope.transactions[0].category, 'Autre');
});

test('les abonnements mensuels et leurs hausses sont détectés', () => {
  const transactions = [
    { type: 'expense', date: '2026-05-05', desc: 'Netflix', amount: 15 },
    { type: 'expense', date: '2026-06-05', desc: 'Netflix', amount: 15 },
    { type: 'expense', date: '2026-07-05', desc: 'Netflix', amount: 18 }
  ];
  const subscriptions = detectSubscriptions(transactions, []);
  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0].frequency, 'monthly');
  assert.equal(subscriptions[0].priceChange, 20);
  assert.equal(subscriptions[0].yearlyCost, 216);
});

test('une récurrence existante n’est pas détectée une deuxième fois', () => {
  const transactions = [
    { type: 'expense', date: '2026-06-05', desc: 'Internet', amount: 35 },
    { type: 'expense', date: '2026-07-05', desc: 'Internet', amount: 35 }
  ];
  const subscriptions = detectSubscriptions(transactions, [{ id: 'r1', type: 'expense', desc: 'Internet', amount: 35, frequency: 'monthly' }]);
  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0].source, 'recurring');
});

test('le patrimoine net combine trésorerie, épargne, actifs et dettes', () => {
  const account = {
    initialCapital: 1000,
    transactions: [{ type: 'income', amount: 500, date: '2026-10-01' }, { type: 'expense', amount: 200, date: '2026-10-02' }],
    savingsAccounts: { Livret: 700 },
    wealthAssets: [{ value: 10_000 }, { value: -50 }],
    debts: [{ direction: 'i_owe_them', remainingAmount: 2500 }, { direction: 'they_owe_me', remainingAmount: 300 }]
  };
  assert.deepEqual(calculateNetWorth(account, '2026-10-24'), { cash: 1300, savings: 700, assets: 10_000, liabilities: 2500, netWorth: 9500 });
  assert.equal(merchantKey({ desc: 'PRLV SEPA Netflix 123456' }), 'netflix');
});

test('les rappels locaux détectent budgets, échéances et hausses sans données distantes', () => {
  const alerts = buildLocalAlerts({
    envelopes: { Alimentation: 100 },
    transactions: [
      { type: 'expense', date: '2026-08-01', desc: 'Courses', category: 'Alimentation', amount: 85 },
      { type: 'expense', date: '2026-06-05', desc: 'Netflix', amount: 10 },
      { type: 'expense', date: '2026-07-05', desc: 'Netflix', amount: 12 }
    ],
    recurringTransactions: [],
    debts: [{ id: 'd1', person: 'Alex', remainingAmount: 50, endDate: '2026-08-04' }]
  }, '2026-08-02');
  assert.ok(alerts.some(alert => alert.id === 'envelope-alimentation'));
  assert.ok(alerts.some(alert => alert.id === 'debt-d1'));
  assert.ok(alerts.some(alert => alert.id === 'subscription-netflix'));
});

test('les paiements très instables ne sont pas présentés comme un abonnement', () => {
  const subscriptions = detectSubscriptions([
    { type: 'expense', date: '2026-05-05', desc: 'Boutique variable', amount: 10 },
    { type: 'expense', date: '2026-06-05', desc: 'Boutique variable', amount: 100 },
    { type: 'expense', date: '2026-07-05', desc: 'Boutique variable', amount: 10 }
  ], []);
  assert.equal(subscriptions.length, 0);
});

test('le centre intelligent compare deux mois complets et présente une variation ponctuelle sans la qualifier de tendance', () => {
  const intelligence = buildFinancialIntelligence({
    initialCapital: 1000,
    savingsAccounts: { Livret: 300 },
    transactions: [
      { type: 'income', date: '2026-06-02', desc: 'Salaire', category: 'Revenus', amount: 2000 },
      { type: 'expense', date: '2026-06-08', desc: 'Courses', category: 'Alimentation', amount: 300 },
      { type: 'income', date: '2026-07-02', desc: 'Salaire', category: 'Revenus', amount: 2000 },
      { type: 'expense', date: '2026-07-08', desc: 'Courses', category: 'Alimentation', amount: 600 },
      { type: 'expense', date: '2026-07-09', desc: 'A classer', category: 'À classer', amount: 50 }
    ],
    recurringTransactions: [], debts: [], envelopes: {}
  }, { today: '2026-08-02' });
  assert.equal(intelligence.lastMonth.month, '2026-07');
  assert.equal(intelligence.previousMonth.month, '2026-06');
  assert.ok(intelligence.changes.expenses > 100);
  assert.ok(intelligence.decisions.some(decision => decision.title.includes('Variation des dépenses')));
  assert.equal(intelligence.confidence, null);
  assert.equal(intelligence.confidenceLabel, 'Non évaluée');
});

test('ALX 10 : une hausse persistante dépasse la médiane robuste sur plusieurs mois ; un pic isolé ne suffit pas', () => {
  const expenses = (amounts) => amounts.map(([date, amount], index) => ({
    id: `shift-${index}`, type: 'expense', date, amount, category: 'Alimentation', desc: 'Courses'
  }));
  const sustained = detectPersistentExpenseChanges({ transactions: expenses([
    ['2026-02-05', 100], ['2026-03-05', 100], ['2026-04-05', 100],
    ['2026-05-05', 150], ['2026-06-05', 150], ['2026-07-05', 150]
  ]) }, '2026-08-02');
  assert.equal(sustained.length, 1);
  assert.equal(sustained[0].aboveThresholdMonths, 3);
  assert.equal(sustained[0].baselineMedian, 100);
  assert.equal(sustained[0].recentMedian, 150);

  const spike = detectPersistentExpenseChanges({ transactions: expenses([
    ['2026-02-05', 100], ['2026-03-05', 100], ['2026-04-05', 100],
    ['2026-05-05', 100], ['2026-06-05', 100], ['2026-07-05', 1000]
  ]) }, '2026-08-02');
  assert.equal(spike.length, 0);
});
