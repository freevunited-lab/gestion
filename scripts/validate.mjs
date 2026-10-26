import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const target = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(target) : [target];
});

for (const file of walk(path.join(root, 'assets/js')).filter(file => file.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) errors.push(`${path.relative(root, file)}: ${result.stderr.trim()}`);
}

for (const htmlName of ['index.html', 'rapport-mensuel.html']) {
  const html = fs.readFileSync(path.join(root, htmlName), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  for (const id of new Set(ids)) {
    if (ids.filter(value => value === id).length > 1) errors.push(`${htmlName}: identifiant dupliqué #${id}`);
  }
  for (const match of html.matchAll(/(?:src|href)="((?:assets\/|manifest\.webmanifest)[^"]*)"/g)) {
    const localPath = match[1].split(/[?#]/)[0];
    if (!fs.existsSync(path.join(root, localPath))) errors.push(`${htmlName}: fichier manquant ${localPath}`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('Validation réussie : scripts, identifiants HTML et fichiers locaux cohérents.');
