// ============================================================
// ===== AUTHENTIFICATION FIREBASE (stubs — voir <script type="module">) =
// ============================================================
// Les vraies implémentations sont dans le bloc <script type="module">
// qui utilise le SDK Firebase v10 modulaire (jetons JWT modernes).
// Ces stubs évitent les erreurs si le module n'est pas encore chargé.
let _currentUser        = null;
let _cloudSyncEnabled   = false;
function authLogin()              { window._fbAuthLogin?.();    }
function authRegister()           { window._fbAuthRegister?.(); }
function authLogout()             { window._fbAuthLogout?.();   }
function authResetPassword()      { window._fbAuthReset?.();    }
function authSubmit()             { window._fbAuthSubmit?.();   }
function switchAuthTab(t)         { window._fbSwitchTab?.(t);   }
function showAuthModal()          { document.getElementById('authOverlay').style.display='flex'; document.getElementById('authLoadingScreen').style.display='none'; }
function hideAuthModal()          { document.getElementById('authOverlay').style.display='none'; }
function showAuthLoadingScreen()  { document.getElementById('authLoadingScreen').style.display='flex'; }
function hideAuthLoadingScreen()  { document.getElementById('authLoadingScreen').style.display='none'; }
function showAuthNotConfiguredBanner() {
  const el = document.getElementById('authNotConfiguredBanner');
  if (!el) return;
  el.style.display = 'flex';
  document.body.classList.add('has-auth-banner');
  requestAnimationFrame(() => {
    document.documentElement.style.setProperty('--auth-banner-height', `${el.offsetHeight}px`);
  });
}
function hideAuthNotConfiguredBanner() {
  const el = document.getElementById('authNotConfiguredBanner');
  if (el) el.style.display = 'none';
  document.body.classList.remove('has-auth-banner');
  document.documentElement.style.removeProperty('--auth-banner-height');
}
function showCloudBadge(state)    { window._fbShowBadge?.(state); }
function updateSidebarUserInfo(u) { window._fbUpdateSidebar?.(u); }

// Bridge : le module Firebase met à jour ces let via cette fonction
window._fbSetAuthState = function(user) {
  _currentUser      = user;
  _cloudSyncEnabled = !!user;
};

// Patch saveAccountSystem : déclenche un sync cloud après chaque save
const _origSaveAccountSystem = saveAccountSystem;
saveAccountSystem = function() {
  _origSaveAccountSystem();
  window._fbMarkLocalDirty?.();
  if (_currentUser && _cloudSyncEnabled) {
    if (saveAccountSystem._t) clearTimeout(saveAccountSystem._t);
    saveAccountSystem._t = setTimeout(() => window._fbSaveCloud?.(), 500);
  }
};
// Met à jour la référence window avec la version patchée
window.saveAccountSystem = saveAccountSystem;

window._fbFlushCloud = function() {
  if (!_currentUser || !_cloudSyncEnabled) return;
  if (saveAccountSystem._t) {
    clearTimeout(saveAccountSystem._t);
    saveAccountSystem._t = null;
  }
  window._fbSaveCloud?.();
};

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') window._fbFlushCloud();
});
window.addEventListener('pagehide', () => window._fbFlushCloud());
