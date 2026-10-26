// Contrôle indépendant, jour par jour, des échéances autour du Nouvel An et du 29 février.
// Exécution : node scripts/stress-recurrence-calendar.mjs [--cases=10000]
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { forecastMonths } from '../assets/js/finance-priority2-engine.mjs';

const argument = process.argv.find(value => value.startsWith('--cases='))?.slice(8);
const cases = argument === undefined ? 10000 : Number(argument);
if (!Number.isSafeInteger(cases) || cases < 1 || cases > 100000) throw Error('Nombre de scénarios invalide');
let seed = 0x20260229;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const oneOf = values => values[Math.floor(random() * values.length)];
const integer = (min, max) => min + Math.floor(random() * (max - min + 1));
const dateFromISO = iso => new Date(`${iso}T12:00:00Z`);
const isoFromDate = date => date.toISOString().slice(0, 10);
const monthEnd = month => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0, 12));
const monthStart = month => new Date(`${month}-01T12:00:00Z`);
const shiftedMonth = (month, offset) => {
  const d = monthStart(month);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return isoFromDate(d).slice(0, 7);
};
const lastDay = month => monthEnd(month).getUTCDate();
const weekday = iso => dateFromISO(iso).getUTCDay();
const cents = value => Math.round(value * 100);

function scenario(index) {
  const today = oneOf(['2026-12-29', '2027-02-27', '2028-02-27', '2028-12-29']);
  const starts = ['2024-02-29', '2025-12-31', '2026-01-30', '2026-12-28', '2027-02-28', '2028-02-29'];
  const rules = Array.from({ length: integer(1, 5) }, (_, number) => {
    const frequency = oneOf(['monthly', 'monthly', 'weekly', 'yearly']);
    const startDate = oneOf(starts);
    const endMonth = shiftedMonth(today.slice(0, 7), integer(0, 3));
    const effectiveEndDate = random() < 0.25 ? `${endMonth}-${String(integer(1, lastDay(endMonth))).padStart(2, '0')}` : '';
    const skipped = random() < 0.2 && frequency !== 'weekly'
      ? [frequency === 'yearly' ? String(integer(2026, 2028)) : shiftedMonth(today.slice(0, 7), integer(0, 3))] : [];
    return {
      id: `s${index}-r${number}`, startDate, dayOfMonth: integer(1, 31), frequency,
      type: oneOf(['expense', 'income', 'transfer', 'savings_withdrawal']),
      amountBase: integer(1, 100000) / 100, skippedPeriods: skipped,
      subscription: effectiveEndDate ? { effectiveEndDate } : undefined,
      rateVersions: random() < 0.35 ? [{ effectiveFrom: `${shiftedMonth(today.slice(0, 7), integer(0, 3))}-01`,
        amountBase: integer(1, 100000) / 100 }] : []
    };
  });
  return { today, rules };
}

function reference(today, rules) {
  const months = Array.from({ length: 4 }, (_, index) => shiftedMonth(today.slice(0, 7), index));
  const buckets = months.map(month => ({ month, change: 0, income: 0, expenses: 0, count: 0 }));
  const end = monthEnd(months.at(-1));
  for (let cursor = dateFromISO(today); cursor < end;) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const date = isoFromDate(cursor);
    const month = date.slice(0, 7);
    const bucket = buckets.find(item => item.month === month);
    for (const rule of rules) {
      if (date < rule.startDate || (rule.subscription?.effectiveEndDate && date > rule.subscription.effectiveEndDate)) continue;
      let matches = false;
      if (rule.frequency === 'weekly') matches = weekday(date) === weekday(rule.startDate);
      else {
        const expectedDay = Math.min(rule.dayOfMonth, lastDay(month));
        matches = Number(date.slice(8, 10)) === expectedDay &&
          (rule.frequency !== 'yearly' || date.slice(5, 7) === rule.startDate.slice(5, 7));
      }
      if (!matches) continue;
      const key = rule.frequency === 'yearly' ? date.slice(0, 4) : month;
      if (rule.skippedPeriods.includes(key)) continue;
      const rate = rule.rateVersions.find(item => item.effectiveFrom <= date);
      const amount = cents(rate?.amountBase ?? rule.amountBase);
      bucket.change += rule.type === 'income' ? amount : -amount;
      if (rule.type === 'income') bucket.income += amount;
      if (rule.type === 'expense' || rule.type === 'savings_withdrawal') bucket.expenses += amount;
      bucket.count++;
    }
  }
  let balance = 0;
  for (const bucket of buckets) { balance += bucket.change; bucket.balance = balance; }
  return buckets;
}

const started = performance.now();
let checkedRules = 0;
for (let index = 0; index < cases; index++) {
  const { today, rules } = scenario(index);
  checkedRules += rules.length;
  const account = { id: `s${index}`, initialCapital: 0, settings: { baseCurrency: 'EUR' },
    transactions: [], recurringTransactions: rules };
  const expected = reference(today, rules);
  const actual = forecastMonths([account], { today, months: 4 });
  try {
    for (let month = 0; month < 4; month++) {
      const found = actual[month], wanted = expected[month];
      for (const field of ['change', 'income', 'expenses', 'balance'])
        assert.equal(found[`${field}Minor`], wanted[field], `${wanted.month}.${field}`);
      assert.equal(found.items.length, wanted.count, `${wanted.month}.count`);
    }
  } catch (error) {
    console.error(JSON.stringify({ seed: '0x20260229', index, today, rules, expected, actual }, null, 2));
    throw error;
  }
}
console.log(JSON.stringify({ status: 'PASS', seed: '0x20260229', scenarios: cases,
  recurringRules: checkedRules, checksPerScenario: 20,
  durationMs: Math.round(performance.now() - started) }, null, 2));
