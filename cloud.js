// ============================================================================
// cloud.js — Firebase Real-Time Sync, Coach Auth & Role Link Sharing
// ============================================================================

import {
  appStore,
  state,
  setState,
  normalizeTeamObject,
  syncActiveTeamPointer,
  getSerializablePayload,
  applyCloudTimerState,
  recalculateSchedule,
  saveState,
  triggerRenderAll,
  setCloudPushHandler,
  escapeHtml
} from './engine.js';

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCdHYqOhYl_i4zF6DFWEdR_RmxBGytOvys",
  authDomain: "sideline-assistant-pro.firebaseapp.com",
  projectId: "sideline-assistant-pro",
  storageBucket: "sideline-assistant-pro.firebasestorage.app",
  messagingSenderId: "93614361874",
  appId: "1:93614361874:web:8464be9e7bfdfe345ab7cb"
};

export const isFirebaseConfigured = Boolean(
  FIREBASE_CONFIG &&
  FIREBASE_CONFIG.apiKey &&
  !FIREBASE_CONFIG.apiKey.includes('PASTE_YOUR_')
);

// ============================================================================
// ROLE DETECTION (COACH vs ASSISTANT vs VIEWER)
// ============================================================================
const urlParams = new URLSearchParams(window.location.search);
export const sharedTeamIdParam = urlParams.get('team');
const urlRoleParam = (urlParams.get('role') || '').toLowerCase();
const urlPinParam = urlParams.get('pin') || '';

export let appRole = 'coach';
if (sharedTeamIdParam) {
  if (urlRoleParam === 'assistant' && urlPinParam) {
    appRole = 'assistant';
  } else if (urlRoleParam === 'viewer') {
    appRole = 'viewer';
  }
}

export function canEditGame() {
  return appRole === 'coach' || appRole === 'assistant';
}

export function isHeadCoach() {
  return appRole === 'coach';
}

// ============================================================================
// FIREBASE RUNTIME HANDLES
// ============================================================================
let fbDb = null;
let fbAuth = null;
let fbAuthMod = null;
let fbFirestoreMod = null;
let currentCoachUser = null;
let activeUnsubscribe = null;
let isReceivingCloudSnapshot = false;

export function getCurrentCoachUser() {
  return currentCoachUser;
}

export function setSyncBadge(mode, text) {
  const dot = document.getElementById('liveSyncDot');
  const label = document.getElementById('liveSyncText');
  if (!dot || !label) return;

  if (mode === 'live') {
    dot.className = 'w-2 h-2 rounded-full bg-sky-400 animate-pulse';
    label.textContent = text || 'Live Cloud Sync';
    label.className = 'text-sky-300 font-semibold';
  } else if (mode === 'error') {
    dot.className = 'w-2 h-2 rounded-full bg-rose-400';
    label.textContent = text || 'Offline / Local';
    label.className = 'text-rose-300 font-semibold';
  } else {
    dot.className = 'w-2 h-2 rounded-full bg-emerald-400';
    label.textContent = text || 'Local Saved';
    label.className = 'text-emerald-400 font-medium';
  }
}

export async function initFirebaseConnection() {
  setCloudPushHandler(pushActiveTeamToCloud);

  if (!isFirebaseConfigured) {
    setSyncBadge('local', 'Local Saved');
    return;
  }

  try {
    setSyncBadge('live', 'Connecting...');
    const [appMod, firestoreMod, authMod] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js'),
      import('https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js')
    ]);

    const app = appMod.getApps().length ? appMod.getApps()[0] : appMod.initializeApp(FIREBASE_CONFIG);
    fbDb = firestoreMod.getFirestore(app);
    fbFirestoreMod = firestoreMod;
    fbAuth = authMod.getAuth(app);
    fbAuthMod = authMod;

    authMod.onAuthStateChanged(fbAuth, async (user) => {
      currentCoachUser = user || null;
      renderCoachAuthButton();
      if (user && isHeadCoach()) {
        await syncCoachOwnedTeams(user);
      }
    });

    subscribeToActiveTeamCloud();
  } catch (err) {
    console.warn('Firebase connection error:', err);
    setSyncBadge('error', 'Local Fallback');
  }
}

export function renderCoachAuthButton() {
  const btn = document.getElementById('coachAuthBtn');
  const lbl = document.getElementById('coachAuthBtnLabel');
  const signedInSec = document.getElementById('authSignedInSection');
  const signedOutSec = document.getElementById('authSignedOutSection');
  const emailLbl = document.getElementById('authUserEmailLabel');

  if (!btn || !lbl) return;

  if (!isHeadCoach()) {
    btn.classList.add('hidden');
    return;
  }
  btn.classList.remove('hidden');

  if (currentCoachUser) {
    const shortName = currentCoachUser.displayName
      ? currentCoachUser.displayName.split(' ')[0]
      : (currentCoachUser.email ? currentCoachUser.email.split('@')[0] : 'Coach');
    lbl.textContent = `👤 ${shortName}`;
    btn.className = 'px-2.5 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-bold transition flex items-center gap-1 max-w-[130px]';

    if (signedInSec && signedOutSec) {
      signedInSec.classList.remove('hidden');
      signedOutSec.classList.add('hidden');
      emailLbl.textContent = currentCoachUser.email || currentCoachUser.displayName || 'Coach Account';
    }
  } else {
    lbl.textContent = '🔑 Login';
    btn.className = 'px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition flex items-center gap-1 max-w-[130px]';

    if (signedInSec && signedOutSec) {
      signedInSec.classList.add('hidden');
      signedOutSec.classList.remove('hidden');
    }
  }
}

async function syncCoachOwnedTeams(user) {
  if (!fbDb || !fbFirestoreMod || !user) return;
  try {
    for (const t of appStore.teams) {
      if (!t.ownerUid && t.players && t.players.length > 0) {
        t.ownerUid = user.uid;
        t.ownerEmail = user.email || '';
        const ref = fbFirestoreMod.doc(fbDb, 'sideline_pro_teams', t.id);
        await fbFirestoreMod.setDoc(ref, JSON.parse(JSON.stringify({ ...t, activeTab: 'game', updatedAt: Date.now() })));
      }
    }

    const q = fbFirestoreMod.query(
      fbFirestoreMod.collection(fbDb, 'sideline_pro_teams'),
      fbFirestoreMod.where('ownerUid', '==', user.uid)
    );
    const snap = await fbFirestoreMod.getDocs(q);
    let addedAny = false;
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      if (data && data.id) {
        const exists = appStore.teams.some(t => t.id === data.id);
        if (!exists) {
          appStore.teams.push(normalizeTeamObject(data));
          addedAny = true;
        }
      }
    });

    if (addedAny) {
      syncActiveTeamPointer();
      saveState(false);
      triggerRenderAll();
    }
  } catch (e) {
    console.warn('Could not sync coach owned teams:', e);
  }
}

export function openCoachAuthModal() {
  const errEl = document.getElementById('authErrorMsg');
  if (errEl) errEl.classList.add('hidden');
  renderCoachAuthButton();
  document.getElementById('coachAuthModal').classList.remove('hidden');
}

export function closeCoachAuthModal() {
  document.getElementById('coachAuthModal').classList.add('hidden');
}

function showAuthError(msg) {
  const errEl = document.getElementById('authErrorMsg');
  if (!errEl) return;
  errEl.textContent = msg;
  errEl.classList.remove('hidden');
}

export async function handleGoogleCoachLogin() {
  if (!fbAuth || !fbAuthMod) {
    showAuthError('Firebase Authentication is still initializing. Try again in a moment.');
    return;
  }
  try {
    const provider = new fbAuthMod.GoogleAuthProvider();
    await fbAuthMod.signInWithPopup(fbAuth, provider);
    closeCoachAuthModal();
  } catch (err) {
    showAuthError(err.message || 'Google Sign-In failed. Ensure Google Sign-In is enabled in your Firebase Console.');
  }
}

export async function handleEmailCoachAuth(mode) {
  if (!fbAuth || !fbAuthMod) {
    showAuthError('Firebase Authentication is not ready.');
    return;
  }
  const email = (document.getElementById('authEmailInput').value || '').trim();
  const pass = document.getElementById('authPasswordInput').value || '';
  if (!email || pass.length < 6) {
    showAuthError('Please enter a valid email and a password of at least 6 characters.');
    return;
  }
  try {
    if (mode === 'register') {
      await fbAuthMod.createUserWithEmailAndPassword(fbAuth, email, pass);
    } else {
      await fbAuthMod.signInWithEmailAndPassword(fbAuth, email, pass);
    }
    closeCoachAuthModal();
  } catch (err) {
    showAuthError(err.message || 'Authentication failed. Check your email/password or enable Email/Password Auth in Firebase Console.');
  }
}

export async function handleCoachSignOut() {
  if (!fbAuth || !fbAuthMod) return;
  await fbAuthMod.signOut(fbAuth);
  renderCoachAuthButton();
}

export function subscribeToActiveTeamCloud() {
  if (!fbDb || !fbFirestoreMod || !state.id) return;
  if (activeUnsubscribe) activeUnsubscribe();

  const teamRef = fbFirestoreMod.doc(fbDb, 'sideline_pro_teams', state.id);

  activeUnsubscribe = fbFirestoreMod.onSnapshot(teamRef, (snap) => {
    if (snap.exists()) {
      const cloudData = snap.data();

      if (appRole === 'assistant' && cloudData.editPin && urlPinParam !== String(cloudData.editPin)) {
        appRole = 'viewer';
      }

      isReceivingCloudSnapshot = true;
      const mergedTeam = normalizeTeamObject(cloudData);
      const idx = appStore.teams.findIndex(t => t.id === mergedTeam.id);
      if (idx >= 0) {
        appStore.teams[idx] = mergedTeam;
      } else {
        appStore.teams.push(mergedTeam);
      }
      appStore.activeTeamId = mergedTeam.id;
      setState(mergedTeam);

      applyCloudTimerState();
      recalculateSchedule(false);
      triggerRenderAll();
      isReceivingCloudSnapshot = false;
      setSyncBadge('live', 'Live Synced');
    } else if (canEditGame() && state.players.length > 0) {
      pushActiveTeamToCloud();
      setSyncBadge('live', 'Live Synced');
    } else {
      setSyncBadge('live', 'Live Ready');
    }
  }, (err) => {
    console.warn('Firestore snapshot error:', err);
    setSyncBadge('error', 'Sync Paused');
  });
}

// Overwrites the team document cleanly (without { merge: true }) so deleted shift locks stay deleted
export async function pushActiveTeamToCloud(allowParentRsvp = false) {
  if (!fbDb || !fbFirestoreMod || isReceivingCloudSnapshot) return;
  if (!canEditGame() && !allowParentRsvp) return;

  try {
    if (currentCoachUser && isHeadCoach() && !state.ownerUid) {
      state.ownerUid = currentCoachUser.uid;
      state.ownerEmail = currentCoachUser.email || '';
    }
    const teamRef = fbFirestoreMod.doc(fbDb, 'sideline_pro_teams', state.id);
    const payload = JSON.parse(JSON.stringify({
      ...getSerializablePayload(),
      updatedAt: Date.now()
    }));
    await fbFirestoreMod.setDoc(teamRef, payload);
  } catch (err) {
    console.warn('Failed to push update to Firestore:', err);
  }
}

// ============================================================================
// INVITE MODAL & ROLE LINK SHARING
// ============================================================================
export function openInviteModal() {
  const notice = document.getElementById('inviteCloudNotice');
  const assistantCard = document.getElementById('assistantInviteCard');

  if (assistantCard) {
    assistantCard.style.display = canEditGame() ? '' : 'none';
  }

  if (isFirebaseConfigured) {
    notice.className = 'p-3 rounded-xl border bg-emerald-500/10 border-emerald-500/30 text-emerald-200 text-xs';
    notice.innerHTML = `<strong>🟢 Live Cloud Sharing Active:</strong> Any parent or assistant coach who opens their link below will see real-time updates for <strong>${escapeHtml(state.teamName)}</strong>.`;
  } else {
    notice.className = 'p-3 rounded-xl border bg-amber-500/15 border-amber-500/40 text-amber-200 text-xs';
    notice.innerHTML = `<strong>⚠️ Firebase Not Connected Yet:</strong> Paste your <code>FIREBASE_CONFIG</code> keys in <code>cloud.js</code> to enable live real-time syncing across phones.`;
  }

  document.getElementById('inviteModal').classList.remove('hidden');
}

export function closeInviteModal() {
  document.getElementById('inviteModal').classList.add('hidden');
}

export async function shareRoleLink(targetRole) {
  await pushActiveTeamToCloud();

  const baseUrl = window.location.origin + window.location.pathname;
  let roleUrl = `${baseUrl}?team=${encodeURIComponent(state.id)}&role=viewer`;
  let shareTitle = `${state.teamName}: Live Game & Sub Tracker (Parent View)`;
  let shareText = `Check in for ${state.teamName} and watch our live score, clock, and player rotations here:`;
  let btnId = 'shareViewerBtn';

  if (targetRole === 'assistant') {
    roleUrl = `${baseUrl}?team=${encodeURIComponent(state.id)}&role=assistant&pin=${encodeURIComponent(state.editPin)}`;
    shareTitle = `${state.teamName}: Assistant Coach Live Editor`;
    shareText = `Co-manage ${state.teamName}'s live score, timer, and substitutions here:`;
    btnId = 'shareAssistantBtn';
  }

  const btn = document.getElementById(btnId);
  const origHtml = btn.innerHTML;

  if (navigator.share) {
    try {
      await navigator.share({ title: shareTitle, text: shareText, url: roleUrl });
      return;
    } catch (err) {}
  }

  try {
    await navigator.clipboard.writeText(roleUrl);
    btn.innerHTML = '✅ Link Copied to Clipboard!';
    setTimeout(() => { btn.innerHTML = origHtml; }, 2000);
  } catch (e) {
    prompt('Copy this link:', roleUrl);
  }
}


