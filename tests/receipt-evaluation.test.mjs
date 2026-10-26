import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateReceiptTranscriptions } from '../assets/js/receipt-evaluation.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('mesure séparément les champs exacts, manquants et les erreurs présentées comme fiables', () => {
  const result = evaluateReceiptTranscriptions([
    { name: 'exact', text: 'AUCHAN\nDATE 25/10/2026 12:40\nTOTAL TTC 12,30 €', expected: { merchant: 'Auchan', amount: '12,30', date: '2026-10-25', time: '12:40' } },
    { name: 'incomplet', text: 'LIDL\nDATE 25/10/2026', expected: { merchant: 'Lidl', amount: '9,90', date: '2026-10-25', time: null } },
    { name: 'total faux', text: 'CARREFOUR\nDATE 25/10/2026\nTOTAL TTC 14,20 €', expected: { merchant: 'Carrefour', amount: '41,20', date: '2026-10-25', time: null } }
  ]);
  assert.equal(result.count, 3);
  assert.equal(result.fields.amount.correct, 1);
  assert.equal(result.fields.amount.missing, 1);
  assert.equal(result.fields.amount.wrong, 1);
  assert.equal(result.unsafeHighConfidence, 1);
  assert.equal(result.cases.length, 2);
  assert.throws(() => evaluateReceiptTranscriptions([{ text: 'test', expected: {} }]));
});

test('la commande d’évaluation signale une proposition sûre erronée', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'freev-receipt-eval-'));
  try {
    const file = join(directory, 'samples.json');
    await writeFile(file, JSON.stringify([{ text: 'LIDL\nDATE 25/10/2026\nTOTAL TTC 12,30 €', expected: { merchant: 'Lidl', amount: '21,30', date: '2026-10-25', time: null } }]));
    const run = spawnSync(process.execPath, ['scripts/evaluate-receipts.mjs', file], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.equal(JSON.parse(run.stdout).unsafeHighConfidence, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
