'use strict';

const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { HttpsError, onCall } = require('firebase-functions/v2/https');

initializeApp();

exports.deleteOwnAccount = onCall({
  region: 'europe-west1',
  maxInstances: 5
}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Connexion requise.');
  if (request.data?.confirmation !== 'SUPPRIMER') {
    throw new HttpsError('invalid-argument', 'Confirmation manquante.');
  }

  const authTime = Number(request.auth.token?.auth_time || 0);
  const now = Math.floor(Date.now() / 1000);
  if (!authTime || authTime > now + 60 || now - authTime > 5 * 60) {
    throw new HttpsError('failed-precondition', 'Reconnectez-vous pour confirmer cette action.');
  }

  const userRef = getFirestore().collection('users').doc(uid);
  let snapshot;
  try {
    snapshot = await userRef.get();
    if (snapshot.exists) await userRef.delete();
  } catch (_) {
    throw new HttpsError('internal', 'La suppression des données cloud a échoué.');
  }

  try {
    await getAuth().deleteUser(uid);
  } catch (error) {
    if (error?.code === 'auth/user-not-found') return { deleted: true };

    if (snapshot?.exists) {
      try {
        await userRef.set(snapshot.data());
      } catch (_) {
        throw new HttpsError('internal', 'La suppression n’a pas pu être finalisée. Contactez le support FREEV.');
      }
    }
    throw new HttpsError('internal', 'La suppression du compte a échoué.');
  }

  return { deleted: true };
});
