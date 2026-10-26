import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const environment = await initializeTestEnvironment({
  projectId: 'freev-valeur-rules-test',
  firestore: {
    host: '127.0.0.1',
    port: 8080,
    rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8')
  }
});

try {
  const owner = environment.authenticatedContext('owner').firestore();
  const intruder = environment.authenticatedContext('intruder').firestore();
  const anonymous = environment.unauthenticatedContext().firestore();
  const ownerDocument = doc(owner, 'users/owner');

  await assertSucceeds(setDoc(ownerDocument, { accountData: '{\"accounts\":[]}', schemaVersion: '2026-08-02-v5', revision: 1 }));
  await assertSucceeds(getDoc(ownerDocument));
  await assertSucceeds(updateDoc(ownerDocument, { revision: 2, currentAccountId: 'account-1' }));
  await assertFails(updateDoc(ownerDocument, { revision: 2, currentAccountId: 'stale' }));
  await assertFails(updateDoc(ownerDocument, { currentAccountId: 'old-client' }));
  await assertSucceeds(updateDoc(ownerDocument, { revision: 3, currentAccountId: 'new' }));
  await assertFails(getDoc(doc(intruder, 'users/owner')));
  await assertFails(setDoc(doc(intruder, 'users/owner'), { accounts: ['stolen'] }));
  await assertFails(getDoc(doc(anonymous, 'users/owner')));
  await assertFails(setDoc(doc(owner, 'publicProfiles/owner'), { ownerUid: 'owner' }));
  await assertFails(deleteDoc(ownerDocument));
  await environment.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'users/owner'), { accountData: '{\"accounts\":[]}', schemaVersion: 'old' });
  });
  const legacy = ownerDocument;
  // Le document sans compteur peut migrer, mais pas revenir à 0.
  await assertSucceeds(updateDoc(legacy, { revision: 1 }));
  await assertFails(updateDoc(legacy, { revision: 1 }));
  await assertFails(deleteDoc(ownerDocument));
  console.log('Règles Firestore vérifiées : propriétaire autorisé, accès croisés et anonymes refusés.');
} finally {
  await environment.cleanup();
}
