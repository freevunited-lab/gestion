
(async function bootFirebaseIntegration() {
let initializeApp;
let getAuth;
let onAuthStateChanged;
let createUserWithEmailAndPassword;
let signInWithEmailAndPassword;
let signOut;
let sendPasswordResetEmail;
let EmailAuthProvider;
let reauthenticateWithCredential;
let getFirestore;
let initializeFirestore;
let getDocFromServer;
let memoryLocalCache;
let clearIndexedDbPersistence;
let runTransaction;
let doc;
let setDoc;
let getDoc;
let firebaseBootError = null;
let cloudGuard;

if (window.FIREBASE_CONFIGURED) {
  try {
    const moduleUrl = new URL('./cloud-sync-guard.mjs',
      document.currentScript?.src || new URL('assets/js/firebase-auth.js', document.baseURI).href).href;
    const modules = Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
      import(moduleUrl)
    ]);
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Délai Firebase dépassé')), 8000)
    );
    const [appModule, authModule, firestoreModule, guardModule] = await Promise.race([modules, timeout]);
    cloudGuard = guardModule;
    ({ initializeApp } = appModule);
    ({
      getAuth,
      onAuthStateChanged,
      createUserWithEmailAndPassword,
      signInWithEmailAndPassword,
      signOut,
      sendPasswordResetEmail,
      EmailAuthProvider,
      reauthenticateWithCredential
    } = authModule);
    ({ getFirestore, initializeFirestore, memoryLocalCache, clearIndexedDbPersistence, getDocFromServer, runTransaction, doc, getDoc } = firestoreModule);
  } catch (error) {
    console.error('[Freev] Connexion Firebase impossible :', error);
    firebaseBootError = error;
  }
}

// ─── Helpers UI (partagés avec le script principal via window) ───
function showErr(msg)  { const e=document.getElementById('authError');   if(e){e.textContent=msg;e.style.display='block';} }
function showOk(msg)   { const e=document.getElementById('authSuccess'); if(e){e.textContent=msg;e.style.display='block';} }
function clearMsgs()   { ['authError','authSuccess'].forEach(id=>{ const e=document.getElementById(id); if(e) e.style.display='none'; }); }

function errMsg(code) {
  return ({
    'auth/email-already-in-use': 'Cette adresse email est déjà utilisée.',
    'auth/invalid-email':        'Adresse email invalide.',
    'auth/weak-password':        'Mot de passe trop faible (min. 6 caractères).',
    'auth/user-not-found':       'Aucun compte avec cet email.',
    'auth/wrong-password':       'Mot de passe incorrect.',
    'auth/too-many-requests':    'Trop de tentatives. Réessaie dans quelques minutes.',
    'auth/network-request-failed':'Problème de connexion réseau.',
    'auth/invalid-credential':   'Email ou mot de passe incorrect.',
  })[code] ?? `Erreur : ${code}`;
}

// ─── Badge cloud ─────────────────────────────────────────────────
window._fbShowBadge = (state) => {
  window.__freevCloudState = state;
  const el = document.getElementById('cloudSyncBadge');
  if (!el) return;
  const labels = { synced: 'Synchronisé', syncing: 'Synchronisation en cours', offline: 'Hors ligne' };
  const label = labels[state] || 'État de synchronisation inconnu';
  el.className = 'cloud-sync-badge ' + state;
  el.setAttribute('aria-label', label);
  el.title = label;
  if (state === 'synced')  el.innerHTML = '<i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i> Synchronisé';
  if (state === 'syncing') el.innerHTML = '<span class="auth-spinner" aria-hidden="true" style="width:10px;height:10px;border-width:1.5px;"></span> Synchronisation en cours';
  if (state === 'offline') el.innerHTML = '<i class="fa-solid fa-cloud-slash" aria-hidden="true"></i> Hors ligne';
  el.style.display = 'inline-flex';
};

// ─── Sidebar user info ───────────────────────────────────────────
window._fbUpdateSidebar = (user) => {
  const info    = document.getElementById('sidebarUserInfo');
  const logout  = document.getElementById('sidebarLogoutBtn');
  const loginBtn= document.getElementById('sidebarLoginBtn');
  if (!info) return;
  if (user) {
    const email = String(user.email || 'Utilisateur');
    const avatar = document.createElement('span');
    avatar.className = 'sidebar-user-avatar';
    avatar.textContent = email[0].toUpperCase();
    avatar.setAttribute('aria-hidden', 'true');
    const label = document.createElement('div');
    label.className = 'sidebar-user-email';
    label.title = email;
    label.textContent = email;
    info.replaceChildren(avatar, label);
    info.setAttribute('aria-label', `Ouvrir le profil du compte ${email}`);
    info.setAttribute('aria-expanded', 'false');
    info.title = email;
    info.style.display   = 'flex';
    if (logout)   logout.style.display   = 'flex';
    if (loginBtn) loginBtn.style.display = 'none';
  } else {
    info.style.display   = 'none';
    info.setAttribute('aria-expanded', 'false');
    info.setAttribute('aria-label', 'Ouvrir le profil du compte');
    info.setAttribute('title', 'Profil du compte');
    if (logout)   logout.style.display   = 'none';
    if (loginBtn) loginBtn.style.display = 'flex';
  }
};

// ─── onglet login/register ───────────────────────────────────────
let _tab = 'login';
window._fbSwitchTab = (tab) => {
  _tab = tab;
  document.getElementById('authTabLogin')?.classList.toggle('active', tab==='login');
  document.getElementById('authTabRegister')?.classList.toggle('active', tab==='register');
  const p2  = document.getElementById('authPass2Group');
  const btn = document.getElementById('authSubmitBtn');
  const fgt = document.getElementById('authForgotBtn');
  if (p2)  p2.style.display  = tab==='register' ? 'block' : 'none';
  if (btn) btn.textContent   = tab==='login'     ? 'Se connecter' : 'Créer mon compte';
  if (fgt) fgt.style.display = tab==='login'     ? 'block' : 'none';
  clearMsgs();
};
window._fbAuthSubmit = () => { if (_tab==='login') window._fbAuthLogin(); else window._fbAuthRegister(); };

// ─── Init Firebase (SDK v10 modulaire) ──────────────────────────
if (!window.FIREBASE_CONFIGURED || firebaseBootError) {
  // Firebase est obligatoire : aucune ouverture locale de l'application.
  const showFirebaseRequired = () => {
    const loading = document.getElementById('authLoadingScreen');
    const authOverlay = document.getElementById('authOverlay');
    if (authOverlay) authOverlay.style.display = 'none';
    if (!loading) return;
    loading.style.display = 'flex';
    loading.innerHTML = `
      <div style="max-width:460px;padding:2rem;text-align:center;color:white;">
        <div style="font-size:2.25rem;margin-bottom:1rem;">☁️</div>
        <div style="font-size:1.35rem;font-weight:800;margin-bottom:.65rem;">Connexion Firebase obligatoire</div>
        <div style="color:#cbd5e1;line-height:1.6;margin-bottom:1.35rem;">
          Freev Valeur ne peut pas fonctionner sans Firebase. Vérifiez votre connexion Internet et la configuration du projet.
        </div>
        <button type="button" onclick="location.reload()" class="btn btn-primary" style="margin:auto;">
          <i class="fa-solid fa-rotate-right"></i> Réessayer
        </button>
      </div>`;
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showFirebaseRequired);
  else showFirebaseRequired();
} else {
  const app  = initializeApp(window.FIREBASE_CONFIG);
  const auth = getAuth(app);
  window._fbDeleteOwnAccount = async (password) => {
    const user = auth.currentUser;
    if (!user?.email) throw Object.assign(new Error('Aucun compte actif.'), { code: 'auth/no-current-user' });
    if (!user.providerData?.some(provider => provider.providerId === 'password')) {
      throw Object.assign(new Error('Cette méthode de connexion ne permet pas une vérification par mot de passe.'), { code: 'auth/unsupported-provider' });
    }
    const credential = EmailAuthProvider.credential(user.email, password);
    await reauthenticateWithCredential(user, credential);
    await user.getIdToken(true);
    if (auth.currentUser?.uid !== user.uid) {
      throw Object.assign(new Error('La session a changé.'), { code: 'auth/session-changed' });
    }

    let serverConfirmedDeletion = false;
    try {
      await window._fbPrepareAccountDeletion?.();
      const functionsModule = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
      const functions = functionsModule.getFunctions(app, 'europe-west1');
      const deleteOwnAccount = functionsModule.httpsCallable(functions, 'deleteOwnAccount');
      const response = await deleteOwnAccount({ confirmation: 'SUPPRIMER' });
      if (response.data?.deleted !== true) {
        throw Object.assign(new Error('La suppression n’a pas été confirmée.'), { code: 'functions/failed-precondition' });
      }
      serverConfirmedDeletion = true;

      try { window.clearSensitiveLocalCache?.(); } catch (_) {}
      try {
        if (localStorage.getItem(LAST_FIREBASE_UID_KEY) === user.uid) localStorage.removeItem(LAST_FIREBASE_UID_KEY);
        localStorage.removeItem('freevDeviceSessions');
      } catch (_) {}
      try {
        if (sessionStorage.getItem('freevPreferCloudOnce') === user.uid) sessionStorage.removeItem('freevPreferCloudOnce');
      } catch (_) {}
      return { deleted: true };
    } catch (error) {
      if (!serverConfirmedDeletion) window._fbCancelAccountDeletionPreparation?.();
      throw error;
    }
  };
  window._fbEndDeletedAccountSession = () => signOut(auth);
  // Confidentialité : le SDK ne conserve plus de snapshots financiers dans
  // IndexedDB, même si le navigateur avait auparavant un cache « appareil fiable ».
  // L'option appareil fiable concerne seulement la copie localStorage explicite.
  const db = initializeFirestore && memoryLocalCache
    ? initializeFirestore(app, { localCache: memoryLocalCache() })
    : getFirestore(app);
  // Nettoyage du cache IndexedDB conservé par les versions antérieures.
  // À exécuter avant la première lecture Firestore. Les autres onglets ouverts
  // peuvent empêcher la purge : on ne prétend jamais avoir réussi si elle échoue.
  let legacyCachePurged = false;
  if (typeof clearIndexedDbPersistence === 'function') {
    try {
      await clearIndexedDbPersistence(db);
      legacyCachePurged = true;
    } catch (error) {
      console.warn('[Freev] Ancien cache Firestore non effacé (fermer les autres onglets) :', error);
    }
  }
  window.__freevLegacyFirestoreCachePurged = legacyCachePurged;
  const LAST_FIREBASE_UID_KEY = 'freevLastFirebaseUid';
  const CLOUD_META_KEY = 'freevCloudSyncState_v1';
  let accountDeletionInProgress = false;
  function readLocalSyncMeta(uid) {
    if (!window.isTrustedDeviceCacheEnabled?.()) return null;
    try {
      const meta = JSON.parse(localStorage.getItem(CLOUD_META_KEY) || 'null');
      return meta?.ownerUid === uid ? meta : null;
    } catch (_) { return null; }
  }
  function writeLocalSyncMeta(uid, dirty) {
    if (!window.isTrustedDeviceCacheEnabled?.() || !cloudBaseline) return;
    try {
      localStorage.setItem(CLOUD_META_KEY, JSON.stringify({
        ownerUid: uid, revision: cloudBaseline.revision,
        serverStamp: cloudBaseline.serverStamp || '', dirty
      }));
    } catch (error) { console.warn('[Freev] Metadata du cache cloud indisponibles :', error); }
  }
  // saveAccountSystem est appelé par le bridge à chaque modification.
  window._fbMarkLocalDirty = () => {
    if (accountDeletionInProgress) return;
    const uid = auth.currentUser?.uid;
    if (uid && activeDataUid === uid && cloudVerified) writeLocalSyncMeta(uid, true);
  };
  let cloudSaveQueue = { pending: false, promise: null };
  let cloudHealthy = false;
  let cloudVerified = false;
  let cloudBaseline = null;
  let cloudConflict = false;
  let authSessionGeneration = 0;
  let activeDataUid = '';
  function isCurrentAuthSession(uid, generation) {
    return authSessionGeneration === generation && auth.currentUser?.uid === uid;
  }

  function localCacheBelongsTo(uid) {
    const ownerUid = window.getLocalAccountCacheOwnerUid?.() || '';
    const lastUid = localStorage.getItem(LAST_FIREBASE_UID_KEY) || '';
    // Migration contrôlée : un ancien cache non étiqueté reste récupérable
    // seulement s'il n'a jamais été associé à un autre compte Firebase.
    return ownerUid ? ownerUid === uid : (!lastUid || lastUid === uid);
  }

  function applyFreshAccountState() {
    const fresh = window.createAccountObj?.('Compte principal');
    if (fresh) window._applyCloudData?.({ accounts: [fresh], currentAccountId: fresh.id, multiViewMode: 'individual', selectedGroupIds: [] });
  }

  function loadOwnedLocalState(uid, generation) {
    if (!isCurrentAuthSession(uid, generation)) return false;
    if (!localCacheBelongsTo(uid)) {
      applyFreshAccountState();
      return false;
    }
    return window.loadAccountSystem?.(uid) !== false && isCurrentAuthSession(uid, generation);
  }

  // Affichage bloquant : ne jamais autoriser une modification sur un état
  // dont la version serveur n'a pas pu être vérifiée.
  function showBlockedScreen(title, description) {
    const loading = document.getElementById('authLoadingScreen');
    if (!loading) return;
    loading.replaceChildren();
    loading.style.display = 'flex';
    const panel = document.createElement('section');
    panel.style.cssText = 'max-width:550px;padding:2rem;color:white;text-align:center;display:grid;gap:1rem';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const content = document.createElement('p');
    content.textContent = description;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-primary';
    retry.textContent = 'Réessayer la connexion';
    retry.addEventListener('click', () => location.reload());
    panel.append(heading, content, retry);
    loading.append(panel);
  }

  function exportStateSnapshot(payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `freev-recuperation-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function showCloudConflict(uid, generation, reason = 'Les données ont été modifiées sur un autre appareil.') {
    cloudConflict = true;
    cloudHealthy = false;
    cloudVerified = false;
    activeDataUid = '';
    window._fbShowBadge('offline');
    const overlay = document.getElementById('freevCloudConflictOverlay') || document.createElement('div');
    overlay.id = 'freevCloudConflictOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:#071426f5;z-index:2147483646;display:grid;place-items:center;padding:24px';
    overlay.replaceChildren();
    const panel = document.createElement('section');
    panel.style.cssText = 'max-width:560px;background:#152336;color:white;border:1px solid #64748b;border-radius:18px;padding:28px;display:grid;gap:16px';
    const heading = document.createElement('h2'); heading.textContent = '⚠️ Conflit de sauvegarde détecté';
    const message = document.createElement('p');
    message.textContent = reason + ' Aucune donnée ne sera écrasée automatiquement. Exportez votre version de cet appareil, puis rechargez et choisissez la version cloud.';
    const exportBtn = document.createElement('button'); exportBtn.type = 'button';
    exportBtn.className = 'btn btn-primary'; exportBtn.textContent = 'Exporter mes données actuelles (JSON)';
    exportBtn.addEventListener('click', () => {
      if (!isCurrentAuthSession(uid, generation)) return;
      const cached = localStorage.getItem('freevMultiAccounts_v2');
      let data;
      try { data = cached && JSON.parse(cached); } catch (_) {}
      if (window.__freevBooted || !data || data.ownerUid !== uid) data = window._getAppState?.() || data;
      if (data) exportStateSnapshot(data);
    });
    const reloadBtn = document.createElement('button'); reloadBtn.type = 'button';
    reloadBtn.className = 'btn btn-secondary'; reloadBtn.textContent = 'Utiliser la version cloud et recharger';
    reloadBtn.addEventListener('click', () => {
      if (!isCurrentAuthSession(uid, generation)) return;
      if (!confirm('Avez-vous exporté vos modifications locales ? La version cloud sera rechargée et la copie locale sera remplacée.')) return;
      sessionStorage.setItem('freevPreferCloudOnce', uid);
      location.reload();
    });
    panel.append(heading, message, exportBtn, reloadBtn);
    overlay.append(panel);
    document.body.append(overlay);
  }

  // Les écritures sont des transactions compare-and-swap sur revision ET
  // accountData. Cela bloque aussi les modifications d'une ancienne version
  // qui n'utilisait pas encore le compteur de révision.
  window._fbSaveCloud = (expectedUid = '') => {
    const sessionUid = auth.currentUser?.uid || '';
    const sessionGeneration = authSessionGeneration;
    if (accountDeletionInProgress || !sessionUid || (expectedUid && sessionUid !== expectedUid) ||
        !cloudVerified || cloudConflict || activeDataUid !== sessionUid || !cloudBaseline) return Promise.resolve(false);
    const queue = cloudSaveQueue;
    queue.pending = true;
    if (queue.promise) return queue.promise;
    // Une génération d'authentification possède sa propre file et promesse.
    const currentSave = (async () => {
      while (queue.pending) {
        queue.pending = false;
        if (!isCurrentAuthSession(sessionUid, sessionGeneration) || !cloudVerified) return false;
        try {
          window._fbShowBadge('syncing');
          const state = window._getAppState();
          const payload = {
            schemaVersion: '2026-08-02-v5', ...state,
            selectedGroupIds: [...(state.selectedGroupIds || [])],
            lastSaved: new Date().toISOString()
          };
          if (cloudGuard.equivalentCloudState(cloudBaseline.raw, payload)) {
            cloudHealthy = true;
            if (!queue.pending) writeLocalSyncMeta(sessionUid, false);
            window._fbShowBadge('synced');
            continue;
          }
          let raw = JSON.stringify(payload);
          // selectedGroupIds est un Set dans l'application : JSON.stringify(Set)
          // retourne {}, ce qui masquerait un changement de sélection en vol.
          const serializedAppState = () => {
            const current = window._getAppState();
            return JSON.stringify({ ...current, selectedGroupIds: [...(current.selectedGroupIds || [])] });
          };
          const startingState = serializedAppState();
          const expected = { ...cloudBaseline };
          const saveDocument = async (dataRaw, stamp, version) => runTransaction(db, async transaction => {
            const ref = doc(db, 'users', sessionUid);
            const snapshot = await transaction.get(ref);
            const current = snapshot.exists() ? snapshot.data() : null;
            const revision = cloudGuard.nextRevision(current, version);
            transaction.set(ref, {
              accountData: dataRaw, schemaVersion: payload.schemaVersion,
              updatedAt: stamp, revision
            }, { merge: true });
            return revision;
          });
          let saved, merged = null;
          try {
            saved = await saveDocument(raw, payload.lastSaved, expected);
          } catch (error) {
            if (error?.name !== 'CloudConflictError' || !isCurrentAuthSession(sessionUid, sessionGeneration)) throw error;
            // Les sauvegardes concurrentes ne peuvent être fusionnées que si
            // chaque appareil a édité une échéance simple dans un mois différent.
            const latest = await getDocFromServer(doc(db, 'users', sessionUid));
            if (!latest.exists() || serializedAppState() !== startingState)
              throw new cloudGuard.CloudConflictError();
            const remoteData = latest.data();
            merged = cloudGuard.mergeDisjointRecurringMonths(expected.raw, raw, remoteData.accountData);
            if (!merged) throw new cloudGuard.CloudConflictError();
            merged.lastSaved = new Date().toISOString();
            raw = JSON.stringify(merged);
            saved = await saveDocument(raw, merged.lastSaved, cloudGuard.cloudVersion(remoteData));
          }
          if (!isCurrentAuthSession(sessionUid, sessionGeneration)) return false;
          if (merged) {
            // Ne jamais remplacer une saisie plus récente faite durant l'aller-retour réseau.
            // La fusion déjà écrite côté cloud reste valide ; le reste est exportable.
            if (serializedAppState() !== startingState) {
              showCloudConflict(sessionUid, sessionGeneration,
                'Les deux échéances ont été fusionnées dans Firebase, mais de nouvelles modifications locales nécessitent une vérification.');
              return false;
            }
            window._applyCloudData(merged);
            window.saveAccountSystem?.();
            window.syncAllUI?.();
            window.showToast?.('Les modifications de deux mois différents ont été fusionnées.', 'success');
          }
          cloudBaseline = { raw, revision: saved, serverStamp: merged?.lastSaved || payload.lastSaved };
          cloudHealthy = true;
          if (!queue.pending) writeLocalSyncMeta(sessionUid, false);
          localStorage.setItem(LAST_FIREBASE_UID_KEY, sessionUid);
          window._fbShowBadge('synced');
        } catch (error) {
          // Ne pas afficher un échec de l'ancienne session sur le nouveau compte.
          if (!isCurrentAuthSession(sessionUid, sessionGeneration)) return false;
          console.warn('[Freev] Cloud save refused:', error);
          cloudHealthy = false;
          window._fbShowBadge('offline');
          if (error?.name === 'CloudConflictError' || error?.code === 'permission-denied') {
            showCloudConflict(sessionUid, sessionGeneration,
              error?.code === 'permission-denied'
                ? 'Firebase refuse cette écriture. Une autre version de FREEV ou ses règles de sécurité peuvent avoir changé.'
                : 'Une modification distante a été détectée.');
          } else {
            window.showToast?.('Sauvegarde Firebase impossible : conservez une exportation JSON avant de quitter.', 'error');
          }
          return false;
        }
      }
      return cloudHealthy;
    })();
    queue.promise = currentSave.finally(() => {
      queue.promise = null;
      // Ne pas déclencher de tâche ancienne après un changement de compte.
      if (queue === cloudSaveQueue && queue.pending &&
          isCurrentAuthSession(sessionUid, sessionGeneration) &&
          cloudVerified && !cloudConflict && activeDataUid === sessionUid) {
        void window._fbSaveCloud(sessionUid);
      }
    });
    return queue.promise;
  };

  window._fbPrepareAccountDeletion = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) throw Object.assign(new Error('Session expirée.'), { code: 'auth/session-changed' });
    const saveFunction = window.saveAccountSystem;
    if (saveFunction?._t) {
      clearTimeout(saveFunction._t);
      saveFunction._t = null;
    }
    const synced = await window._fbSaveCloud(uid);
    if (synced !== true) {
      throw Object.assign(new Error('La sauvegarde cloud doit être confirmée avant la suppression.'), { code: 'freev/cloud-sync-pending' });
    }

    accountDeletionInProgress = true;
    while (cloudSaveQueue.promise) {
      const activeSave = cloudSaveQueue.promise;
      const activeResult = await activeSave;
      if (activeResult !== true) {
        accountDeletionInProgress = false;
        throw Object.assign(new Error('La sauvegarde cloud est encore en cours.'), { code: 'freev/cloud-sync-pending' });
      }
    }
    if (cloudSaveQueue.pending) {
      accountDeletionInProgress = false;
      throw Object.assign(new Error('La sauvegarde cloud est encore en cours.'), { code: 'freev/cloud-sync-pending' });
    }
    return true;
  };

  window._fbCancelAccountDeletionPreparation = () => {
    if (!accountDeletionInProgress) return;
    accountDeletionInProgress = false;
    const uid = auth.currentUser?.uid;
    if (uid) void window._fbSaveCloud(uid);
  };

  // Aucune initialisation utilisateur tant que la lecture depuis le serveur
  // n'est pas confirmée. getDoc() seul peut retourner un snapshot cache obsolète.
  async function loadCloudAndInit(uid, generation) {
    let snapshot;
    try {
      snapshot = await getDocFromServer(doc(db, 'users', uid));
      if (!isCurrentAuthSession(uid, generation)) return false;
      cloudBaseline = cloudGuard.cloudVersion(snapshot.exists() ? snapshot.data() : null);
      cloudBaseline.serverStamp = snapshot.exists() ? String(snapshot.data().updatedAt || '') : ''; 
      cloudVerified = true;
      cloudHealthy = true;
    } catch (error) {
      if (!isCurrentAuthSession(uid, generation)) return false;
      console.warn('[Freev] Lecture serveur obligatoire indisponible :', error);
      showBlockedScreen('Connexion cloud indisponible',
        'FREEV n’ouvrira pas une ancienne sauvegarde locale tant que la version Firebase actuelle ne peut pas être vérifiée. Vos données restent inchangées.');
      return false;
    }

    try {
      if (cloudBaseline.raw !== null) {
        const parsed = cloudGuard.parseCloudState(cloudBaseline.raw);
        const localRaw = localStorage.getItem('freevMultiAccounts_v2');
        let localParsed = null;
        try { localParsed = localRaw ? JSON.parse(localRaw) : null; } catch (_) {}
        const syncMeta = readLocalSyncMeta(uid);
        const hasUnsentLocalChanges = syncMeta ? syncMeta.dirty === true : true;
        const preferCloud = sessionStorage.getItem('freevPreferCloudOnce') === uid;
        if (preferCloud) sessionStorage.removeItem('freevPreferCloudOnce');
        if (!preferCloud && hasUnsentLocalChanges && cloudGuard.needsLocalReconciliation(localParsed, parsed,
          localCacheBelongsTo(uid) && localParsed?.ownerUid === uid,
          localStorage.getItem(LAST_FIREBASE_UID_KEY) === uid, syncMeta?.dirty === true)) {
          showCloudConflict(uid, generation, 'Votre sauvegarde locale est plus récente et différente de celle de Firebase.');
          return false;
        }
        window._applyCloudData(parsed);
        window.saveAccountSystem?.();
        localStorage.setItem(LAST_FIREBASE_UID_KEY, uid);
        writeLocalSyncMeta(uid, false);
      } else {
        // Cloud absent : migration depuis le cache uniquement si l'identité concorde.
        if (!loadOwnedLocalState(uid, generation)) applyFreshAccountState();
        window.loadCurrentAccountIntoGlobals?.();
      }
      if (!isCurrentAuthSession(uid, generation)) return false;
      activeDataUid = uid;
      if (cloudBaseline.raw === null) {
        const saved = await window._fbSaveCloud(uid);
        if (!saved || !isCurrentAuthSession(uid, generation)) {
          showBlockedScreen('Première sauvegarde non confirmée',
            'Impossible de créer votre document cloud. Réessayez la connexion avant de saisir des opérations.');
          activeDataUid = '';
          return false;
        }
      }
    } catch (error) {
      console.error('[Freev] Données cloud invalides ou impossibles à charger :', error);
      cloudVerified = false;
      activeDataUid = '';
      showBlockedScreen('Sauvegarde cloud invalide',
        'Le document Firebase est illisible. FREEV ne le remplacera pas par un document vide. Réparez ou restaurez les données depuis une sauvegarde vérifiée.');
      return false;
    }
    if (!isCurrentAuthSession(uid, generation)) return false;
    document.getElementById('authLoadingScreen').style.display = 'none';
    window._runPostAuthInit?.();
    return true;
  }

  // ── Listener d'état de connexion (JWT Firebase Auth v10) ─────
  onAuthStateChanged(auth, async (user) => {
    const generation = ++authSessionGeneration;
    cloudSaveQueue = { pending: false, promise: null };
    window.__freevAuthEpoch = generation;
    activeDataUid = '';
    cloudVerified = false;
    cloudBaseline = null;
    cloudConflict = false;
    // Met à jour les let locaux du script principal via le bridge
    window._fbSetAuthState?.(user);
    window.__freevUserId = user?.uid || '';
    if (user) {
      window._fbGetCurrentUser = () => auth.currentUser;
      try {
        const sessions = JSON.parse(localStorage.getItem('freevDeviceSessions') || '[]');
        const current = {
          id: `${navigator.platform || 'appareil'}-${screen.width}x${screen.height}`,
          label: /iPhone|iPad/i.test(navigator.userAgent) ? 'iPhone ou iPad' : /Android/i.test(navigator.userAgent) ? 'Appareil Android' : 'Ordinateur',
          lastSeen: new Date().toISOString(),
          current: true
        };
        const next = [current, ...sessions.filter(session => session.id !== current.id).map(session => ({ ...session, current: false }))].slice(0, 8);
        localStorage.setItem('freevDeviceSessions', JSON.stringify(next));
      } catch (_) {}
      document.getElementById('authOverlay').style.display = 'none';
      window._fbUpdateSidebar(user);
      window._fbShowBadge('syncing');
      const cloudOk = await loadCloudAndInit(user.uid, generation);
      if (!isCurrentAuthSession(user.uid, generation)) return;
      window._fbShowBadge(cloudOk ? 'synced' : 'offline');
    } else {
      document.getElementById('freevCloudConflictOverlay')?.remove();
      document.getElementById('authLoadingScreen').style.display = 'none';
      document.getElementById('authOverlay').style.display = 'flex';
      window._fbUpdateSidebar(null);
    }
  });

  // ── Actions auth exposées à window (appelées par les onclick HTML) ──
  window._fbAuthLogin = async () => {
    const email = document.getElementById('authEmail')?.value?.trim();
    const pass  = document.getElementById('authPassword')?.value;
    const btn   = document.getElementById('authSubmitBtn');
    clearMsgs();
    if (!email || !pass) return showErr('Remplis tous les champs.');
    btn.disabled = true;
    btn.innerHTML = '<span class="auth-spinner"></span>Connexion...';
    try {
      await signInWithEmailAndPassword(auth, email, pass);
      // onAuthStateChanged prend le relais
    } catch(e) {
      btn.disabled = false; btn.textContent = 'Se connecter';
      showErr(errMsg(e.code));
    }
  };

  window._fbAuthRegister = async () => {
    const email = document.getElementById('authEmail')?.value?.trim();
    const pass  = document.getElementById('authPassword')?.value;
    const pass2 = document.getElementById('authPassword2')?.value;
    const btn   = document.getElementById('authSubmitBtn');
    clearMsgs();
    if (!email || !pass)    return showErr('Remplis tous les champs.');
    if (pass !== pass2)     return showErr('Les mots de passe ne correspondent pas.');
    if (pass.length < 6)    return showErr('Le mot de passe doit faire au moins 6 caractères.');
    btn.disabled = true;
    btn.innerHTML = '<span class="auth-spinner"></span>Création...';
    try {
      await createUserWithEmailAndPassword(auth, email, pass);
    } catch(e) {
      btn.disabled = false; btn.textContent = 'Créer mon compte';
      showErr(errMsg(e.code));
    }
  };

  window._fbAuthLogout = async () => {
    if (!confirm('Se déconnecter ? FREEV va vérifier la sauvegarde des données dans le cloud.')) return;
    let saved = false;
    try { saved = (await window._fbSaveCloud?.()) === true; } catch (_) {}
    if (!saved && !confirm('La sauvegarde cloud n’a pas pu être confirmée. En vous déconnectant, des modifications non synchronisées pourraient être perdues. Continuer malgré ce risque ?')) return;
    if (!window.isTrustedDeviceCacheEnabled?.()) window.clearSensitiveLocalCache?.();
    await signOut(auth);
    location.reload();
  };

  window._fbAuthReset = async () => {
    const email = document.getElementById('authEmail')?.value?.trim();
    if (!email) return showErr('Saisis ton email d\'abord.');
    clearMsgs();
    try {
      await sendPasswordResetEmail(auth, email);
      showOk('Email envoyé ! Vérifie ta boîte mail.');
    } catch(e) { showErr(errMsg(e.code)); }
  };

  // Afficher l'écran de chargement tant qu'on attend onAuthStateChanged
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('authLoadingScreen').style.display = 'flex';
  });
}
})();
