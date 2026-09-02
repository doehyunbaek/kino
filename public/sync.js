const SYNC_UPDATED_AT_KEY = 'tmdb-favorites-updated-at';

export function createWatchlistSync({ getItems, applyItems, onStatus }) {
  const sync = { configured: false, busy: false, user: null, auth: null, firestore: null, provider: null, unsubscribe: null, timer: null, applyingRemote: false };

  function updateStatus(message = '') {
    const signedIn = Boolean(sync.user);
    onStatus({
      configured: sync.configured,
      signedIn,
      busy: sync.busy,
      message: message || (signedIn ? `Synchronisiert als ${sync.user.email || sync.user.displayName}` : 'Nur auf diesem Gerät')
    });
  }

  function init() {
    const config = window.FILM_FIREBASE_CONFIG || {};
    if (!config.firebaseConfig?.apiKey || !window.firebase?.initializeApp) {
      updateStatus('Cloud-Synchronisierung nicht verfügbar');
      return;
    }
    try {
      const app = window.firebase.apps?.length ? window.firebase.app() : window.firebase.initializeApp(config.firebaseConfig);
      sync.auth = window.firebase.auth(app);
      sync.firestore = window.firebase.firestore(app);
      sync.provider = new window.firebase.auth.GoogleAuthProvider();
      (config.scopes || ['profile', 'email']).forEach(scope => sync.provider.addScope(scope));
      sync.auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
      sync.configured = true;
      sync.auth.onAuthStateChanged(user => {
        sync.user = user;
        stopListener();
        if (user) start().catch(handleError);
        updateStatus();
      });
    } catch (error) { handleError(error); }
    updateStatus();
  }

  async function toggleAuth() {
    if (!sync.configured || !sync.auth || sync.busy) return;
    sync.busy = true;
    updateStatus(sync.user ? 'Abmeldung …' : 'Google-Anmeldung wird geöffnet …');
    try {
      if (sync.user) await sync.auth.signOut();
      else await sync.auth.signInWithPopup(sync.provider);
    } catch (error) { handleError(error); }
    finally { sync.busy = false; updateStatus(); }
  }

  function documentRef() {
    return sync.firestore.collection('users').doc(sync.user.uid).collection('film').doc('watchlist');
  }

  function validItems(items) {
    return (Array.isArray(items) ? items : []).filter(item => item && Number.isFinite(Number(item.id)) && ['movie', 'tv'].includes(item.mediaType));
  }

  function mergeItems(local, remote) {
    const merged = new Map(validItems(remote).map(item => [`${item.mediaType}:${item.id}`, item]));
    validItems(local).forEach(item => merged.set(`${item.mediaType}:${item.id}`, item));
    return [...merged.values()];
  }

  async function start() {
    updateStatus('Firestore wird geprüft …');
    const ref = documentRef();
    const snapshot = await ref.get();
    const remote = snapshot.exists ? snapshot.data() : null;
    const localItems = getItems();
    const localUpdatedAt = localStorage.getItem(SYNC_UPDATED_AT_KEY) || '';

    if (!remote) {
      await writeNow();
    } else if (!localUpdatedAt) {
      const merged = mergeItems(localItems, remote.items);
      applyRemote(merged, new Date().toISOString());
      await writeNow();
    } else if (Date.parse(remote.updatedAt || '') > Date.parse(localUpdatedAt)) {
      applyRemote(validItems(remote.items), remote.updatedAt);
    } else if (Date.parse(localUpdatedAt) > Date.parse(remote.updatedAt || '')) {
      await writeNow();
    }

    stopListener();
    sync.unsubscribe = ref.onSnapshot(next => {
      if (!next.exists || next.metadata.hasPendingWrites || sync.applyingRemote) return;
      const data = next.data();
      const localTime = Date.parse(localStorage.getItem(SYNC_UPDATED_AT_KEY) || '');
      if (Date.parse(data.updatedAt || '') > localTime) applyRemote(validItems(data.items), data.updatedAt);
    }, handleError);
    updateStatus('Merkliste mit Firestore synchronisiert');
  }

  function applyRemote(items, updatedAt) {
    sync.applyingRemote = true;
    try {
      applyItems(items);
      localStorage.setItem(SYNC_UPDATED_AT_KEY, updatedAt || new Date().toISOString());
    } finally { sync.applyingRemote = false; }
  }

  function localChanged() {
    if (sync.applyingRemote) return;
    localStorage.setItem(SYNC_UPDATED_AT_KEY, new Date().toISOString());
    if (!sync.user || !sync.firestore) return;
    clearTimeout(sync.timer);
    sync.timer = setTimeout(() => writeNow().catch(handleError), 500);
  }

  async function writeNow() {
    if (!sync.user || !sync.firestore) return;
    const updatedAt = localStorage.getItem(SYNC_UPDATED_AT_KEY) || new Date().toISOString();
    localStorage.setItem(SYNC_UPDATED_AT_KEY, updatedAt);
    await documentRef().set({ items: validItems(getItems()), updatedAt }, { merge: true });
    updateStatus('Mit Firestore synchronisiert');
  }

  function stopListener() {
    if (sync.unsubscribe) sync.unsubscribe();
    sync.unsubscribe = null;
  }

  function handleError(error) {
    console.error(error);
    const code = String(error?.code || '').toLowerCase();
    const message = code.includes('unauthorized-domain') ? 'Diese Domain ist in Firebase nicht autorisiert' : code.includes('permission-denied') ? 'Keine Firestore-Berechtigung' : code.includes('popup-closed') ? 'Anmeldung abgebrochen' : error?.message || 'Cloud-Synchronisierung fehlgeschlagen';
    updateStatus(message);
  }

  return { init, toggleAuth, localChanged };
}
