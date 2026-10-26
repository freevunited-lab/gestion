import { readFile } from 'node:fs/promises';
import { evaluateReceiptTranscriptions } from '../assets/js/receipt-evaluation.mjs';

const file = process.argv[2];
if (!file) {
  process.stderr.write('Usage : node scripts/evaluate-receipts.mjs chemin/vers/tickets-annotes.json\n');
  process.exitCode = 2;
} else {
  try {
    const samples = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(samples)) throw new TypeError('Le fichier doit contenir une liste JSON.');
    const result = evaluateReceiptTranscriptions(samples);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.unsafeHighConfidence) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
