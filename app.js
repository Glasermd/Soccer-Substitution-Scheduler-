// ============================================================================
// app.js — UI Renderer, Staged Sub Alerts, Modals & Event Controllers
// ============================================================================

import {
  MULTI_TEAM_STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  PRESET_QUARTER_VALUES,
  ALERT_SOUND_MODES,
  FORMATION_PRESETS,
  createBlankTeam,
  appStore,
  state,
  setState,
  timer,
  registerEngineCallbacks,
  getQuarterTotalSeconds,
  getQuarterMidSeconds,
  fmtDurationLabel,
  fmtNum,
  comparePlayerNumbers,
  getShiftQuarterWeight,
  formatPlayerBadge,
  getPlayerDisplayById,
  escapeHtml,
  normalizeTeamObject,
  syncActiveTeamPointer,
  saveState,
  getTotalFieldSlots,
  recalculateSchedule,
  isQuarterFullSub,
  getActiveShiftObject,
  getNextQueuedShiftObject,
  syncTimerToStateAndCloud,
  applyCloudTimerState,
  triggerSubAlertForShift,
  dismissActiveSubAlert,
  toggleTimer,
  selectViewedQuarter,
  activateViewedQuarterClock,
  adjustTimer,
  syncMidQuarter,
  resetTimer,
  setAlertSoundMode,
  cycleAlertSoundMode,
  playAlertSignal
} from './engine.js';

import {
  sharedTeamIdParam,
  appRole,
  canEditGame,
  isHeadCoach,
  getCurrentCoachUser,
  initFirebaseConnection,
  renderCoachAuthButton,
  openCoachAuthModal,
  closeCoachAuthModal,
  handleGoogleCoachLogin,
  handleEmailCoachAuth,
  handleCoachSignOut,
  subscribeToActiveTeamCloud,
  pushActiveTeamToCloud,
  openInviteModal,
  closeInviteModal,
  shareRoleLink
} from './cloud.js';

// Local UI & Modal Draft State
let currentActiveTab = 'game';
let editingShiftIdx = null;
let modalDraft = { benchIds: [], positions: {} };
let goalDraft = { scorerId: null, assistId: null };
let editingHistoryGameId = null;
let histDraft = null;
let deferredInstallPrompt = null;

// Register callbacks with engine.js
registerEngineCallbacks({
  onRenderAll: renderAll,
  onCanEdit: canEditGame
});

// ============================================================================
// INITIALIZATION & PWA INSTALL SUPPORT
// ============================================================================
function initPwaSupport() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const btn = document.getElementById('pwaInstallBtn');
    if (btn) {
      btn.classList.remove('hidden');
      btn.classList.add('flex');
    }
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    const btn = document.getElementById('pwaInstallBtn');
    if (btn) btn.classList.add('hidden');
  });
}

async function triggerPwaInstall() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    document.getElementById('pwaInstallBtn').classList.add('hidden');
  } else {
    alert('To install as a full-screen app: open your browser menu (⋮ or Share ↑) and tap "Install app" or "Add to Home Screen".');
  }
}

function loadState() {
  initPwaSupport();
  currentActiveTab = 'game';

  try {
    const rawMulti = localStorage.getItem(MULTI_TEAM_STORAGE_KEY);
    if (rawMulti) {
      const parsedMulti = JSON.parse(rawMulti);
      if (parsedMulti && Array.isArray(parsedMulti.teams) && parsedMulti.teams.length > 0) {
        appStore.teams = parsedMulti.teams.map(normalizeTeamObject);
        appStore.activeTeamId = parsedMulti.activeTeamId || appStore.teams[0].id;
      }
    } else {
      const rawLegacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (rawLegacy) {
        const legacyTeam = normalizeTeamObject(JSON.parse(rawLegacy));
        appStore.teams = [legacyTeam];
        appStore.activeTeamId = legacyTeam.id;
      }
    }
  } catch (e) {
    console.warn('Could not load saved state:', e);
  }

  if (sharedTeamIdParam) {
    let existing = appStore.teams.find(t => t.id === sharedTeamIdParam);
    if (!existing) {
      existing = createBlankTeam('Loading Live Team...');
      existing.id = sharedTeamIdParam;
      appStore.teams.push(existing);
    }
    appStore.activeTeamId = existing.id;
  }

  syncActiveTeamPointer();
  applyCloudTimerState();
  recalculateSchedule(false);
  renderAll();
  initFirebaseConnection();
}

// ============================================================================
// MULTI-TEAM MANAGEMENT HANDLERS
// ============================================================================
function handleTeamSelectChange(val) {
  if (!isHeadCoach()) return;
  if (val === '__ADD_NEW_TEAM__') {
    createNewTeamPrompt();
    return;
  }
  switchActiveTeam(val);
}

function switchActiveTeam(teamId) {
  const target = appStore.teams.find(t => t.id === teamId);
  if (!target) return;
  appStore.activeTeamId = target.id;
  setState(target);
  applyCloudTimerState();
  recalculateSchedule(false);
  renderAll();
  subscribeToActiveTeamCloud();
}

function createNewTeamPrompt() {
  if (!isHeadCoach()) return;
  const defaultName = `Team ${appStore.teams.length + 1}`;
  const entered = prompt('Enter a name for the new team:', defaultName);
  if (entered === null) {
    renderHeaderAndSettings();
    return;
  }
  const cleanName = entered.trim() || defaultName;
  const newTeam = createBlankTeam(cleanName);
  const coachUser = getCurrentCoachUser();
  if (coachUser) {
    newTeam.ownerUid = coachUser.uid;
    newTeam.ownerEmail = coachUser.email || '';
  }
  appStore.teams.push(newTeam);
  appStore.activeTeamId = newTeam.id;
  setState(newTeam);
  currentActiveTab = 'game';
  resetTimer(false);
  recalculateSchedule();
  renderAll();
  subscribeToActiveTeamCloud();
}

function deleteCurrentTeam() {
  if (!isHeadCoach()) return;
  if (appStore.teams.length <= 1) {
    alert('You must have at least one team. To start fresh, you can remove players or reset counts.');
    return;
  }
  const confirmDelete = confirm(`Delete "${state.teamName}" from your device?`);
  if (!confirmDelete) return;

  appStore.teams = appStore.teams.filter(t => t.id !== state.id);
  appStore.activeTeamId = appStore.teams[0].id;
  syncActiveTeamPointer();
  resetTimer(false);
  recalculateSchedule(false);
  renderAll();
  subscribeToActiveTeamCloud();
}

// ============================================================================
// 1-TAP PARENT IDENTITY & GAME RSVP LOGIC
// ============================================================================
function getParentIdentityKey() {
  return `sideline_parent_player_${state.id}`;
}

function getSelectedParentPlayerId() {
  try {
    return localStorage.getItem(getParentIdentityKey());
  } catch (e) {
    return null;
  }
}

function selectParentIdentity(playerId) {
  try {
    localStorage.setItem(getParentIdentityKey(), playerId);
  } catch (e) {}
  renderParentRsvpCard();
}

function clearParentIdentity() {
  try {
    localStorage.removeItem(getParentIdentityKey());
  } catch (e) {}
  renderParentRsvpCard();
}

function submitParentRsvp(status) {
  const pid = getSelectedParentPlayerId();
  const player = state.players.find(p => p.id === pid);
  if (!player) return;

  player.rsvp = status;
  player.present = status !== 'out';

  recalculateSchedule(false);
  pushActiveTeamToCloud(true);
  renderAll();
}

function renderParentRsvpCard() {
  const card = document.getElementById('parentRsvpCard');
  if (!card) return;

  if (appRole !== 'viewer' || state.players.length === 0) {
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');

  const selectedPid = getSelectedParentPlayerId();
  const selectedPlayer = state.players.find(p => p.id === selectedPid);

  const pickerEl = document.getElementById('parentPlayerPicker');
  const actionsEl = document.getElementById('parentRsvpActions');
  const switchBtn = document.getElementById('switchParentPlayerBtn');
  const subtext = document.getElementById('parentRsvpSubtext');

  if (!selectedPlayer) {
    switchBtn.classList.add('hidden');
    actionsEl.classList.add('hidden');
    pickerEl.classList.remove('hidden');
    subtext.textContent = 'Which player are you here for? Tap once to remember on your phone:';

    const sorted = getSortedRosterList(state.players);
    pickerEl.innerHTML = sorted.map(p => `
      <button onclick="selectParentIdentity('${p.id}')"
        class="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-950 hover:bg-sky-500/20 text-sky-200 border border-sky-500/30 transition active:scale-95">
        ${escapeHtml(formatPlayerBadge(p))}
      </button>
    `).join('');
  } else {
    switchBtn.classList.remove('hidden');
    pickerEl.classList.add('hidden');
    actionsEl.classList.remove('hidden');

    const curRsvp = selectedPlayer.rsvp || (selectedPlayer.present ? 'going' : 'out');
    subtext.innerHTML = `Checking in for <strong class="text-white">${escapeHtml(formatPlayerBadge(selectedPlayer))}</strong>:`;

    const btnGoing = document.getElementById('rsvpBtnGoing');
    const btnLate = document.getElementById('rsvpBtnLate');
    const btnOut = document.getElementById('rsvpBtnOut');

    btnGoing.className = `py-2.5 px-2 rounded-xl text-xs font-extrabold border transition flex flex-col items-center gap-0.5 ${
      curRsvp === 'going'
        ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-lg'
        : 'bg-slate-950 text-slate-300 border-slate-800'
    }`;
    btnLate.className = `py-2.5 px-2 rounded-xl text-xs font-extrabold border transition flex flex-col items-center gap-0.5 ${
      curRsvp === 'late'
        ? 'bg-amber-400 text-slate-950 border-amber-300 shadow-lg'
        : 'bg-slate-950 text-slate-300 border-slate-800'
    }`;
    btnOut.className = `py-2.5 px-2 rounded-xl text-xs font-extrabold border transition flex flex-col items-center gap-0.5 ${
      curRsvp === 'out'
        ? 'bg-rose-500 text-white border-rose-400 shadow-lg'
        : 'bg-slate-950 text-slate-300 border-slate-800'
    }`;
  }
}

// ============================================================================
// MASTER UI RENDERING & ROLE-BASED VISIBILITY
// ============================================================================
export function renderAll() {
  renderRolePermissionsUI();
  renderCoachAuthButton();
  renderTabsAndOnboarding();
  renderHeaderAndSettings();
  renderParentRsvpCard();
  renderScoreboard();
  renderTimerUI();
  renderAttendance();
  renderScheduleGrid();
  renderBalanceTable();
  renderSmsBubbles();
  renderStatsAndHistoryTab();
}

function renderRolePermissionsUI() {
  const banner = document.getElementById('roleBanner');
  const teamSelect = document.getElementById('headerTeamSelect');
  const staticTeamName = document.getElementById('headerStaticTeamName');
  const setupGearBtn = document.getElementById('setupGearBtn');
  const posToggleBtn = document.getElementById('posToggleBtn');
  const addOurGoalBtn = document.getElementById('addOurGoalBtn');
  const oppScoreControls = document.getElementById('oppScoreControls');
  const opponentInput = document.getElementById('opponentNameInput');
  const timerActionButtons = document.getElementById('timerActionButtons');
  const soundControlsGroup = document.getElementById('soundControlsGroup');
  const selectAllBtn = document.getElementById('selectAllAttendanceBtn');
  const rotateOrderBtn = document.getElementById('rotateOrderBtn');
  const smsSection = document.getElementById('smsSectionCard');
  const completeGameSection = document.getElementById('completeGameSectionCard');

  if (appRole === 'viewer') {
    banner.className = 'px-4 py-1.5 text-xs font-extrabold text-center bg-sky-500/20 text-sky-200 border-b border-sky-500/30';
    banner.innerHTML = '👀 LIVE PARENT VIEWER MODE: Check in your player below & watch live updates';
    banner.classList.remove('hidden');

    teamSelect.classList.add('hidden');
    staticTeamName.textContent = state.teamName || 'Live Team';
    staticTeamName.classList.remove('hidden');

    setupGearBtn.classList.add('hidden');
    posToggleBtn.classList.add('hidden');
    addOurGoalBtn.classList.add('hidden');
    oppScoreControls.classList.add('hidden');
    opponentInput.disabled = true;
    timerActionButtons.classList.add('hidden');
    if (soundControlsGroup) soundControlsGroup.classList.add('hidden');
    selectAllBtn.classList.add('hidden');
    rotateOrderBtn.classList.add('hidden');
    smsSection.classList.add('hidden');
    completeGameSection.classList.add('hidden');

    document.getElementById('rollCallHeaderTitle').textContent = '📋 Active Match Roster & RSVP Status';
    document.getElementById('scheduleSubHint').textContent = 'Active shift highlighted in green';
    document.getElementById('historySubHint').textContent = 'Tap any match card to view the box score';
  } else if (appRole === 'assistant') {
    banner.className = 'px-4 py-1.5 text-xs font-extrabold text-center bg-amber-500/20 text-amber-200 border-b border-amber-500/30';
    banner.innerHTML = '🧢 ASSISTANT COACH MODE: Live Sideline Score, Timer & Sub Editor';
    banner.classList.remove('hidden');

    teamSelect.classList.add('hidden');
    staticTeamName.textContent = state.teamName || 'Live Team';
    staticTeamName.classList.remove('hidden');

    setupGearBtn.classList.add('hidden');
    if (soundControlsGroup) soundControlsGroup.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
    teamSelect.classList.remove('hidden');
    staticTeamName.classList.add('hidden');
    setupGearBtn.classList.remove('hidden');
    if (soundControlsGroup) soundControlsGroup.classList.remove('hidden');
  }
}

function switchMainTab(tab) {
  currentActiveTab = tab;
  renderTabsAndOnboarding();
  if (tab === 'stats') renderStatsAndHistoryTab();
}

function renderTabsAndOnboarding() {
  const isGame = currentActiveTab === 'game';
  document.getElementById('viewGame').classList.toggle('hidden', !isGame);
  document.getElementById('viewStats').classList.toggle('hidden', isGame);

  document.getElementById('tabBtnGame').className = isGame
    ? 'py-1.5 rounded-lg text-xs font-extrabold bg-emerald-500 text-slate-950 shadow'
    : 'py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:text-white';
  document.getElementById('tabBtnStats').className = !isGame
    ? 'py-1.5 rounded-lg text-xs font-extrabold bg-emerald-500 text-slate-950 shadow'
    : 'py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:text-white';

  const onboarding = document.getElementById('onboardingCard');
  if (isHeadCoach() && state.players.length === 0) {
    onboarding.classList.remove('hidden');
    document.getElementById('onboardTeamNameInput').value =
      (state.teamName === 'My Team' || state.teamName.startsWith('Team ')) ? '' : state.teamName;
    document.getElementById('onboardFormatSelect').value = state.formationKey;
  } else {
    onboarding.classList.add('hidden');
  }
}

function renderHeaderAndSettings() {
  const selectEl = document.getElementById('headerTeamSelect');
  selectEl.innerHTML = [
    ...appStore.teams.map(t =>
      `<option value="${t.id}" ${t.id === state.id ? 'selected' : ''}>${escapeHtml(t.teamName || 'My Team')} (${t.players.length})</option>`
    ),
    `<option value="__ADD_NEW_TEAM__">➕ Add New Team...</option>`
  ].join('');

  document.getElementById('headerStaticTeamName').textContent = state.teamName || 'My Team';
  document.getElementById('teamNameInput').value = state.teamName || '';

  const deleteBtn = document.getElementById('deleteTeamBtn');
  if (deleteBtn) {
    deleteBtn.style.display = appStore.teams.length > 1 ? '' : 'none';
  }

  const preset = FORMATION_PRESETS[state.formationKey];
  const formLabel = preset ? preset.label : `${getTotalFieldSlots()}v${getTotalFieldSlots()}`;
  document.getElementById('formatSummaryLabel').textContent = `${formLabel} • ${fmtDurationLabel(state.quarterMins)} Qtrs`;

  const posBtn = document.getElementById('posToggleBtn');
  if (state.trackPositions) {
    posBtn.className = 'px-2.5 py-1 rounded-lg text-xs font-semibold border transition flex items-center gap-1 bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
    posBtn.innerHTML = '<span>📍 Pos</span>';
  } else {
    posBtn.className = 'px-2.5 py-1 rounded-lg text-xs font-semibold border transition flex items-center gap-1 bg-slate-800 text-slate-400 border-slate-700';
    posBtn.innerHTML = '<span>📍 Off</span>';
  }

  document.getElementById('formationPresetSelect').value = state.formationKey;

  const qSelect = document.getElementById('quarterMinsSelect');
  const customInput = document.getElementById('customQuarterMinsInput');
  const isPreset = PRESET_QUARTER_VALUES.includes(Number(state.quarterMins));
  if (isPreset && qSelect.value !== 'custom') {
    qSelect.value = String(Number(state.quarterMins));
    customInput.classList.add('hidden');
  } else {
    qSelect.value = 'custom';
    customInput.value = state.quarterMins;
    customInput.classList.remove('hidden');
  }

  const modeVal = state.shiftsPerQuarter === 1
    ? '1'
    : (state.midQtrPosSwap ? '2_swap' : '2');
  document.getElementById('shiftsPerQtrSelect').value = modeVal;

  const soundSelect = document.getElementById('setupAlertSoundSelect');
  if (soundSelect) {
    soundSelect.value = state.alertSoundMode || 'chime';
  }

  document.getElementById('slotCountFWD').textContent = state.slots.FWD;
  document.getElementById('slotCountMID').textContent = state.slots.MID;
  document.getElementById('slotCountDEF').textContent = state.slots.DEF;
  document.getElementById('slotCountGK').textContent = state.slots.GK;
  document.getElementById('totalFieldSlotsLabel').textContent = getTotalFieldSlots();

  const rosterEl = document.getElementById('rosterHistoryList');
  if (state.players.length === 0) {
    rosterEl.innerHTML = `<div class="text-xs text-slate-500 italic py-2 text-center">No players added yet. Use the form above to add your roster.</div>`;
    return;
  }

  rosterEl.innerHTML = state.players.map(p => `
    <div class="flex items-center justify-between bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-2 text-xs gap-2">
      <div class="flex items-center gap-2 flex-1 min-w-0">
        <input type="text" value="${escapeHtml(p.number || '')}" placeholder="#" maxlength="3"
          onchange="updatePlayerNumber('${p.id}', this.value)"
          class="w-11 bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1 text-center font-bold text-emerald-300 text-xs" />
        <input type="text" value="${escapeHtml(p.name)}"
          onchange="updatePlayerName('${p.id}', this.value)"
          class="flex-1 min-w-0 bg-transparent border-b border-transparent focus:border-emerald-500 font-bold text-white text-xs focus:outline-none" />
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <span class="text-[11px] text-slate-400">Prior Bench:</span>
        <button onclick="adjustPrior('${p.id}', 'BENCH', -0.5)" class="w-5 h-5 rounded bg-slate-800 font-bold">-</button>
        <span class="mono font-bold text-amber-300 w-7 text-center">${fmtNum(p.prior.BENCH || 0)}</span>
        <button onclick="adjustPrior('${p.id}', 'BENCH', 0.5)" class="w-5 h-5 rounded bg-slate-800 font-bold">+</button>
        <button onclick="removePlayer('${p.id}')" class="ml-1 text-slate-500 hover:text-rose-400" title="Remove">🗑️</button>
      </div>
    </div>
  `).join('');
}

// ============================================================================
// LIVE SCOREBOARD & GOAL LOGGING
// ============================================================================
function renderScoreboard() {
  document.getElementById('scoreTeamLabel').textContent = state.teamName || 'My Team';
  document.getElementById('scoreOpponentLabel').textContent = state.currentMatch.opponent || 'Opponent';
  document.getElementById('opponentNameInput').value = state.currentMatch.opponent === 'Opponent' ? '' : state.currentMatch.opponent;
  document.getElementById('ourScoreDisplay').textContent = state.currentMatch.ourScore;
  document.getElementById('oppScoreDisplay').textContent = state.currentMatch.oppScore;

  const goals = state.currentMatch.goals || [];
  const container = document.getElementById('currentGameGoalsContainer');
  const list = document.getElementById('currentGameGoalsList');

  if (goals.length === 0) {
    container.classList.add('hidden');
    list.innerHTML = '';
    return;
  }

  container.classList.remove('hidden');
  list.innerHTML = goals.map(g => {
    const scorerName = getPlayerDisplayById(g.scorerId);
    const assistName = g.assistId ? getPlayerDisplayById(g.assistId) : null;
    return `
      <div class="flex items-center justify-between bg-slate-950/80 border border-slate-800/80 rounded-lg px-2.5 py-1.5 text-xs">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="mono text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold">
            Q${g.quarter} (${g.clock})
          </span>
          <span class="font-bold text-white">⚽ ${escapeHtml(scorerName)}</span>
          ${assistName ? `<span class="text-slate-400">• 👟 Ast: <strong class="text-blue-300">${escapeHtml(assistName)}</strong></span>` : `<span class="text-slate-500 italic">(Unassisted)</span>`}
        </div>
        ${canEditGame() ? `<button onclick="removeGoal('${g.id}')" class="text-slate-500 hover:text-rose-400 text-xs px-1.5" title="Undo Goal">✕</button>` : ''}
      </div>
    `;
  }).join('');
}

function updateTeamName(val) {
  if (!isHeadCoach()) return;
  state.teamName = (val || '').trim() || 'My Team';
  saveState();
  renderAll();
}

function updateOpponentName(val) {
  if (!canEditGame()) return;
  state.currentMatch.opponent = (val || '').trim() || 'Opponent';
  saveState();
  renderScoreboard();
}

function adjustOpponentScore(delta) {
  if (!canEditGame()) return;
  state.currentMatch.oppScore = Math.max(0, (state.currentMatch.oppScore || 0) + delta);
  saveState();
  renderScoreboard();
}

function openGoalModal() {
  if (!canEditGame()) return;
  const presentPlayers = state.players.filter(p => p.present);
  goalDraft = {
    scorerId: presentPlayers.length > 0 ? presentPlayers[0].id : 'OWN_GOAL',
    assistId: null
  };
  document.getElementById('goalModal').classList.remove('hidden');
  renderGoalModalChips();
}

function closeGoalModal() {
  document.getElementById('goalModal').classList.add('hidden');
}

function renderGoalModalChips() {
  const presentPlayers = state.players.filter(p => p.present);
  const scorerEl = document.getElementById('goalScorerChips');
  const assistEl = document.getElementById('goalAssistChips');

  const scorerOptions = [
    ...presentPlayers.map(p => ({ id: p.id, label: formatPlayerBadge(p) })),
    { id: 'OWN_GOAL', label: 'Own Goal / Team' }
  ];

  scorerEl.innerHTML = scorerOptions.map(opt => {
    const active = goalDraft.scorerId === opt.id;
    return `
      <button onclick="selectGoalScorer('${opt.id}')"
        class="px-3 py-2 rounded-xl text-xs font-bold border text-left truncate transition ${
          active
            ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow'
            : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
        }">
        ⚽ ${escapeHtml(opt.label)}
      </button>
    `;
  }).join('');

  const assistOptions = [
    { id: null, label: 'Unassisted' },
    ...presentPlayers
      .filter(p => p.id !== goalDraft.scorerId)
      .map(p => ({ id: p.id, label: formatPlayerBadge(p) }))
  ];

  assistEl.innerHTML = assistOptions.map(opt => {
    const active = goalDraft.assistId === opt.id;
    return `
      <button onclick="selectGoalAssist(${opt.id ? `'${opt.id}'` : 'null'})"
        class="px-3 py-2 rounded-xl text-xs font-bold border text-left truncate transition ${
          active
            ? 'bg-blue-500 text-slate-950 border-blue-400 shadow'
            : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
        }">
        ${opt.id ? '👟 ' : ''}${escapeHtml(opt.label)}
      </button>
    `;
  }).join('');
}

function selectGoalScorer(id) {
  goalDraft.scorerId = id;
  if (goalDraft.assistId === id) goalDraft.assistId = null;
  renderGoalModalChips();
}

function selectGoalAssist(id) {
  goalDraft.assistId = id;
  renderGoalModalChips();
}

function confirmGoalLog() {
  if (!canEditGame()) return;
  const mins = Math.floor(timer.secondsLeft / 60);
  const secs = timer.secondsLeft % 60;
  const clockStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  state.currentMatch.ourScore = (state.currentMatch.ourScore || 0) + 1;
  state.currentMatch.goals.push({
    id: 'g_' + Date.now(),
    quarter: timer.quarter,
    clock: clockStr,
    scorerId: goalDraft.scorerId,
    assistId: goalDraft.assistId
  });

  closeGoalModal();
  saveState();
  renderScoreboard();
}

function removeGoal(goalId) {
  if (!canEditGame()) return;
  const idx = state.currentMatch.goals.findIndex(g => g.id === goalId);
  if (idx >= 0) {
    state.currentMatch.goals.splice(idx, 1);
    state.currentMatch.ourScore = Math.max(0, state.currentMatch.ourScore - 1);
    saveState();
    renderScoreboard();
  }
}

// ============================================================================
// TIMER UI, BACKGROUND CLOCK PERSISTENCE, IN-PLAY & STAGED SUB ALERTS
// ============================================================================
function renderTimerUI() {
  const totalSec = getQuarterTotalSeconds(state.quarterMins);
  const midSec = getQuarterMidSeconds(state.quarterMins);
  const mins = Math.floor(timer.secondsLeft / 60);
  const secs = timer.secondsLeft % 60;
  const clockStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  document.getElementById('timerDisplay').textContent = clockStr;

  const viewedQ = timer.viewedQuarter || timer.quarter;
  const isPreviewingOtherQuarter = viewedQ !== timer.quarter;

  for (let q = 1; q <= 4; q++) {
    const btn = document.getElementById('qTab' + q);
    if (!btn) continue;
    if (q === timer.quarter && q === viewedQ) {
      btn.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold bg-emerald-500 text-slate-950 shadow';
      btn.textContent = `Q${q}`;
    } else if (q === timer.quarter) {
      btn.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold bg-emerald-500/25 text-emerald-300 border border-emerald-400';
      btn.textContent = `Q${q} ⏱️`;
    } else if (q === viewedQ) {
      btn.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold bg-sky-500 text-slate-950 shadow';
      btn.textContent = `Q${q} 👀`;
    } else {
      btn.className = 'px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-800 text-slate-400 hover:text-white';
      btn.textContent = `Q${q}`;
    }
  }

  // Background Clock Persistence Banner
  const bgNotice = document.getElementById('bgClockNotice');
  const bgNoticeText = document.getElementById('bgClockNoticeText');
  const activateBtn = document.getElementById('activateViewedQtrBtn');
  if (bgNotice && bgNoticeText) {
    if (isPreviewingOtherQuarter) {
      bgNotice.classList.remove('hidden');
      const statusVerb = timer.running ? 'running' : 'paused';
      bgNoticeText.innerHTML = `👀 Previewing <strong>Q${viewedQ}</strong> while <strong>Q${timer.quarter}</strong> clock (${clockStr}) is ${statusVerb}`;
      if (activateBtn) {
        activateBtn.style.display = canEditGame() ? '' : 'none';
        activateBtn.textContent = `Switch Clock to Q${viewedQ}`;
      }
    } else {
      bgNotice.classList.add('hidden');
    }
  }

  // Ref-Safe Sound Mode Button Label
  const soundModeBtn = document.getElementById('soundModeBtn');
  if (soundModeBtn) {
    const modeObj = ALERT_SOUND_MODES.find(m => m.key === (state.alertSoundMode || 'chime')) || ALERT_SOUND_MODES[0];
    soundModeBtn.textContent = modeObj.shortLabel;
  }

  const startBtn = document.getElementById('timerStartBtn');
  if (timer.running) {
    startBtn.textContent = '⏸ Pause';
    startBtn.className = 'px-5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-sm transition';
  } else {
    startBtn.textContent = isPreviewingOtherQuarter ? `▶ Start Q${viewedQ}` : '▶ Start';
    startBtn.className = 'px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-sm transition shadow-lg shadow-emerald-500/20';
  }

  const fullQuarterLive = isQuarterFullSub(timer.quarter);
  const badge = document.getElementById('timerShiftBadge');
  const syncMidBtn = document.getElementById('syncMidBtn');
  const splitProgress = document.getElementById('timerProgressSplit');
  const singleProgress = document.getElementById('timerProgressSingle');

  if (!fullQuarterLive) {
    const isFirstHalf = timer.secondsLeft > midSec;
    if (state.midQtrPosSwap) {
      badge.textContent = isFirstHalf
        ? `Q${timer.quarter} • 1st Half`
        : `Q${timer.quarter} • 2nd Half (FWD⇄DEF Swapped)`;
    } else {
      badge.textContent = isFirstHalf
        ? `Q${timer.quarter} • 1st Shift`
        : `Q${timer.quarter} • 2nd Shift`;
    }

    syncMidBtn.classList.remove('hidden');
    splitProgress.classList.remove('hidden');
    singleProgress.classList.add('hidden');

    const p1 = isFirstHalf ? ((timer.secondsLeft - midSec) / Math.max(1, totalSec - midSec)) * 100 : 0;
    const p2 = isFirstHalf ? 100 : (timer.secondsLeft / Math.max(1, midSec)) * 100;
    document.getElementById('progressHalf1').style.width = `${Math.max(0, Math.min(100, p1))}%`;
    document.getElementById('progressHalf2').style.width = `${Math.max(0, Math.min(100, p2))}%`;
  } else {
    badge.textContent = `Q${timer.quarter} • Full Quarter`;
    syncMidBtn.classList.add('hidden');
    splitProgress.classList.add('hidden');
    singleProgress.classList.remove('hidden');

    const pct = (timer.secondsLeft / Math.max(1, totalSec)) * 100;
    document.getElementById('progressFullBar').style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  renderLiveInPlayPanel();
  renderStagedAlertsUI();
}

function buildShiftDiffSummaryHtml(targetShift) {
  if (!targetShift) return '';
  const prevShift = targetShift.index > 0 ? state.computedShifts[targetShift.index - 1] : null;
  const playerMap = Object.fromEntries(state.players.map(p => [p.id, formatPlayerBadge(p)]));

  if (targetShift.part === 2 && targetShift.isMidQtrPosSwapShift) {
    const newFwds = Object.entries(targetShift.positions || {})
      .filter(([pid, pos]) => !targetShift.benchIds.includes(pid) && pos === 'FWD' && playerMap[pid])
      .map(([pid]) => playerMap[pid]);
    const newDefs = Object.entries(targetShift.positions || {})
      .filter(([pid, pos]) => !targetShift.benchIds.includes(pid) && pos === 'DEF' && playerMap[pid])
      .map(([pid]) => playerMap[pid]);

    return `
      <div class="text-emerald-300 font-bold">🔄 Mid-Quarter Striker ⇄ Defender Swap (Bench, MID & GK stay)</div>
      <div><strong>⚔️ Move to FWD:</strong> ${newFwds.length ? newFwds.map(escapeHtml).join(', ') : 'None'}</div>
      <div><strong>🛡️ Move to DEF:</strong> ${newDefs.length ? newDefs.map(escapeHtml).join(', ') : 'None'}</div>
    `;
  }

  const goingOut = targetShift.benchIds.map(id => playerMap[id]).filter(Boolean);
  const comingIn = prevShift
    ? prevShift.benchIds.filter(id => !targetShift.benchIds.includes(id)).map(id => playerMap[id]).filter(Boolean)
    : [];

  let html = `
    <div><strong>🏃 Coming ON Field:</strong> <span class="text-emerald-300 font-semibold">${comingIn.length ? comingIn.map(escapeHtml).join(', ') : 'Starting Lineup'}</span></div>
    <div><strong>🪑 Going to Bench:</strong> <span class="text-slate-200 font-semibold">${goingOut.length ? goingOut.map(escapeHtml).join(', ') : 'None (All Play)'}</span></div>
  `;

  if (state.trackPositions) {
    const posSummary = Object.entries(targetShift.positions || {})
      .filter(([pid]) => !targetShift.benchIds.includes(pid) && playerMap[pid])
      .map(([pid, pos]) => `${escapeHtml(playerMap[pid])} (${pos})`)
      .join(' • ');
    if (posSummary) {
      html += `<div class="pt-1 text-emerald-300"><strong>📍 Field Spots:</strong> ${posSummary}</div>`;
    }
  }

  return html;
}

function getShiftHeadingLabel(shift) {
  if (!shift) return '';
  const isFull = isQuarterFullSub(shift.quarter);
  if (isFull) return `Q${shift.quarter} • Start of Quarter`;
  if (shift.part === 1) return `Q${shift.quarter} • 1st Shift (Start of Q${shift.quarter})`;
  return state.midQtrPosSwap
    ? `Q${shift.quarter} • Mid-Quarter FWD⇄DEF Swap`
    : `Q${shift.quarter} • 2nd Shift (Mid-Quarter Sub)`;
}

function renderStagedAlertsUI() {
  const activeBanner = document.getElementById('subAlertBanner');
  const activeTitle = document.getElementById('subAlertTitle');
  const activeContent = document.getElementById('subAlertContent');
  const queuedCard = document.getElementById('queuedSubCard');

  if (!activeBanner || !queuedCard) return;

  const presentCount = state.players.filter(p => p.present).length;
  if (presentCount === 0) {
    activeBanner.classList.add('hidden');
    queuedCard.classList.add('hidden');
    return;
  }

  // 1. Render Active Alert Banner (ABOVE In-Play) if triggered and not yet dismissed
  const activeAlertShift = typeof timer.activeAlertShiftIdx === 'number'
    ? state.computedShifts[timer.activeAlertShiftIdx]
    : null;

  if (activeAlertShift) {
    activeTitle.textContent = `🔔 Now Active: ${getShiftHeadingLabel(activeAlertShift)}`;
    activeContent.innerHTML = buildShiftDiffSummaryHtml(activeAlertShift);
    activeBanner.classList.remove('hidden');
  } else {
    activeBanner.classList.add('hidden');
  }

  // 2. Render Queued Next Change Card (BELOW In-Play)
  const nextShift = getNextQueuedShiftObject();
  if (!nextShift) {
    queuedCard.classList.remove('hidden');
    queuedCard.innerHTML = `
      <div class="flex items-center justify-between text-xs text-slate-400">
        <span class="font-bold uppercase tracking-wider text-slate-500">⏭️ Next Queued Rotation</span>
        <span class="italic text-slate-500">Final shift of match reached</span>
      </div>
    `;
    return;
  }

  queuedCard.classList.remove('hidden');
  queuedCard.innerHTML = `
    <div class="flex items-center justify-between gap-2 border-b border-slate-800 pb-2 mb-2">
      <div class="flex items-center gap-1.5">
        <span class="w-2 h-2 rounded-full bg-amber-400"></span>
        <span class="text-xs font-extrabold uppercase tracking-wider text-amber-300">
          ⏭️ Queued Next: ${escapeHtml(getShiftHeadingLabel(nextShift))}
        </span>
      </div>
      ${canEditGame() ? `
        <button onclick="activateQueuedAlertNow(${nextShift.index})"
          class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 text-[11px] font-bold transition">
          🔔 Activate Alert
        </button>
      ` : ''}
    </div>
    <div class="text-xs text-slate-300 space-y-1">
      ${buildShiftDiffSummaryHtml(nextShift)}
    </div>
  `;
}

function activateQueuedAlertNow(shiftIdx) {
  if (!canEditGame()) return;
  triggerSubAlertForShift(shiftIdx);
  syncTimerToStateAndCloud();
  renderTimerUI();
}

function renderLiveInPlayPanel() {
  const container = document.getElementById('liveInPlayContainer');
  if (!container) return;

  if (state.players.filter(p => p.present).length === 0) {
    container.innerHTML = `<div class="text-xs text-slate-500 italic">Add players to your roster to see the active lineup.</div>`;
    return;
  }

  const viewedQ = timer.viewedQuarter || timer.quarter;
  const isPreviewingOtherQuarter = viewedQ !== timer.quarter;
  const activeShift = getActiveShiftObject(isPreviewingOtherQuarter);
  if (!activeShift) {
    container.innerHTML = '';
    return;
  }

  const playerMap = Object.fromEntries(state.players.map(p => [p.id, formatPlayerBadge(p)]));
  const benchNames = activeShift.benchIds.map(id => playerMap[id]).filter(Boolean);
  const isFullQtr = isQuarterFullSub(activeShift.quarter);
  const shiftDurLabel = fmtDurationLabel(state.quarterMins / state.shiftsPerQuarter);
  const qtrDurLabel = fmtDurationLabel(state.quarterMins);
  const shiftDesc = isFullQtr
    ? `Q${activeShift.quarter} • Full Quarter (${qtrDurLabel})`
    : `Q${activeShift.quarter} • ${activeShift.part === 1 ? '1st' : '2nd'} Shift (${shiftDurLabel})`;

  const posGroups = { FWD: [], MID: [], DEF: [], GK: [] };
  const allFieldNames = [];
  Object.entries(activeShift.positions || {}).forEach(([pid, pos]) => {
    if (!activeShift.benchIds.includes(pid) && playerMap[pid]) {
      allFieldNames.push(playerMap[pid]);
      if (!posGroups[pos]) posGroups[pos] = [];
      posGroups[pos].push(playerMap[pid]);
    }
  });

  const headerBadgeColor = isPreviewingOtherQuarter
    ? 'border-sky-500/40'
    : 'border-emerald-500/40';
  const dotColor = isPreviewingOtherQuarter
    ? 'bg-sky-400'
    : 'bg-emerald-400 animate-pulse';
  const titlePrefix = isPreviewingOtherQuarter
    ? `Previewing Lineup: ${shiftDesc}`
    : `Currently In Play: ${shiftDesc}`;
  const titleColor = isPreviewingOtherQuarter ? 'text-sky-300' : 'text-emerald-300';

  container.innerHTML = `
    <div class="bg-slate-950/90 border ${headerBadgeColor} rounded-xl p-3 space-y-2">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full ${dotColor}"></span>
          <span class="text-xs font-extrabold uppercase tracking-wider ${titleColor}">${titlePrefix}</span>
        </div>
        ${canEditGame() ? `
          <button onclick="openEditModal(${activeShift.index})" class="text-[11px] font-semibold text-emerald-400 hover:underline shrink-0">
            ✏️ Edit Lineup
          </button>
        ` : ''}
      </div>

      <div class="flex items-center gap-1.5 flex-wrap pt-0.5">
        <span class="text-[11px] font-bold uppercase text-slate-400">🪑 Bench:</span>
        ${benchNames.length > 0
          ? benchNames.map(n => `<span class="px-2 py-0.5 rounded-md text-xs font-bold pos-BENCH">${escapeHtml(n)}</span>`).join('')
          : `<span class="text-xs text-slate-500 italic">None (All Play)</span>`
        }
      </div>

      ${state.trackPositions ? `
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1.5 border-t border-slate-800/80 text-xs">
          ${posGroups.FWD.length ? `
            <div class="bg-slate-900/90 border border-rose-500/30 rounded-lg p-2">
              <div class="text-[10px] font-extrabold text-rose-400 uppercase">⚔️ Attack (FWD)</div>
              <div class="font-bold text-white mt-0.5">${posGroups.FWD.map(escapeHtml).join(', ')}</div>
            </div>
          ` : ''}
          ${posGroups.MID.length ? `
            <div class="bg-slate-900/90 border border-blue-500/30 rounded-lg p-2">
              <div class="text-[10px] font-extrabold text-blue-400 uppercase">⚡ Midfield (MID)</div>
              <div class="font-bold text-white mt-0.5">${posGroups.MID.map(escapeHtml).join(', ')}</div>
            </div>
          ` : ''}
          ${posGroups.DEF.length ? `
            <div class="bg-slate-900/90 border border-emerald-500/30 rounded-lg p-2">
              <div class="text-[10px] font-extrabold text-emerald-400 uppercase">🛡️ Defense (DEF)</div>
              <div class="font-bold text-white mt-0.5">${posGroups.DEF.map(escapeHtml).join(', ')}</div>
            </div>
          ` : ''}
          ${posGroups.GK.length ? `
            <div class="bg-slate-900/90 border border-amber-500/30 rounded-lg p-2">
              <div class="text-[10px] font-extrabold text-amber-400 uppercase">🧤 Goalie (GK)</div>
              <div class="font-bold text-white mt-0.5">${posGroups.GK.map(escapeHtml).join(', ')}</div>
            </div>
          ` : ''}
        </div>
      ` : `
        <div class="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-800/80 text-xs">
          <span class="text-[11px] font-bold uppercase text-emerald-400">🏃 On Field:</span>
          <span class="font-bold text-white">${allFieldNames.map(escapeHtml).join(', ')}</span>
        </div>
      `}
    </div>
  `;
}

// ============================================================================
// ATTENDANCE, SCHEDULE GRID & FAIRNESS BALANCE TABLE
// ============================================================================
function setRosterSort(mode) {
  state.rosterSort = mode;
  saveState(false);
  renderAttendance();
}

function getSortedRosterList(playersArray) {
  const copy = [...playersArray];
  if (state.rosterSort === 'name') {
    copy.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } else if (state.rosterSort === 'number') {
    copy.sort(comparePlayerNumbers);
  }
  return copy;
}

function renderAttendance() {
  const presentCount = state.players.filter(p => p.present).length;
  const fieldSlots = getTotalFieldSlots();
  const sittingCount = Math.max(0, presentCount - fieldSlots);

  document.getElementById('attendanceSubtext').textContent =
    `${presentCount} present • ${fieldSlots} on field • ${sittingCount} sitting per shift`;

  ['Order', 'Name', 'Number'].forEach(label => {
    const key = label.toLowerCase();
    const btn = document.getElementById('sortBtn' + label);
    if (btn) {
      btn.className = state.rosterSort === key
        ? 'px-2 py-1 rounded-md font-bold bg-emerald-500 text-slate-950'
        : 'px-2 py-1 rounded-md font-semibold text-slate-400 hover:text-white';
    }
  });

  const container = document.getElementById('attendanceChips');
  if (state.players.length === 0) {
    container.innerHTML = `<span class="text-xs text-slate-500 italic">No players in roster yet.</span>`;
    return;
  }

  const sortedPlayers = getSortedRosterList(state.players);
  const editable = canEditGame();

  container.innerHTML = sortedPlayers.map(p => {
    const badge = formatPlayerBadge(p);
    const clickAttr = editable ? `onclick="togglePlayerPresence('${p.id}')"` : '';
    const rsvpTag = p.rsvp === 'late'
      ? `<span class="ml-1 px-1.5 py-0.2 rounded bg-amber-500/30 text-amber-200 text-[10px] font-extrabold">⏳ Late</span>`
      : (p.rsvp === 'going' && p.present ? `<span class="text-[10px] text-emerald-300">✓</span>` : '');

    if (p.present) {
      return `
        <button ${clickAttr}
          class="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5 shadow-sm transition ${editable ? 'active:scale-95' : 'cursor-default'}">
          <span class="w-2 h-2 rounded-full ${p.rsvp === 'late' ? 'bg-amber-400' : 'bg-emerald-400'}"></span>
          <span>${escapeHtml(badge)}</span>
          ${rsvpTag}
        </button>
      `;
    } else {
      return `
        <button ${clickAttr}
          class="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800/70 text-slate-500 border border-slate-800 line-through flex items-center gap-1.5 transition ${editable ? 'active:scale-95' : 'cursor-default'}">
          <span class="w-2 h-2 rounded-full bg-slate-600"></span>
          <span>${escapeHtml(badge)}</span>
        </button>
      `;
    }
  }).join('');
}

function renderScheduleGrid() {
  const grid = document.getElementById('scheduleGrid');
  const playerMap = Object.fromEntries(state.players.map(p => [p.id, formatPlayerBadge(p)]));
  const shiftDurLabel = fmtDurationLabel(state.quarterMins / state.shiftsPerQuarter);
  const qtrDurLabel = fmtDurationLabel(state.quarterMins);
  const activeShift = getActiveShiftObject(false);
  const viewedQ = timer.viewedQuarter || timer.quarter;
  const editable = canEditGame();

  let html = '';
  for (let q = 1; q <= 4; q++) {
    const qShifts = state.computedShifts.filter(s => s.quarter === q);
    const isFullQtr = state.shiftsPerQuarter === 1 || !!state.fullQuarterLocks[q];
    const isActiveClockQuarter = timer.quarter === q;
    const isPreviewQuarter = viewedQ === q && viewedQ !== timer.quarter;

    const visibleShifts = (state.shiftsPerQuarter === 2 && state.fullQuarterLocks[q] && qShifts.length > 0)
      ? [qShifts[0]]
      : qShifts;

    const cardBorderClass = isActiveClockQuarter
      ? 'bg-slate-900 border-emerald-500 ring-2 ring-emerald-500/30'
      : isPreviewQuarter
        ? 'bg-slate-900 border-sky-500 ring-2 ring-sky-500/30'
        : 'bg-slate-900 border-slate-800';

    html += `
      <div class="rounded-2xl p-3.5 space-y-2.5 shadow-lg border transition ${cardBorderClass}">
        <div class="flex items-center justify-between border-b border-slate-800 pb-2">
          <div class="flex items-center gap-2 flex-wrap">
            <button onclick="selectViewedQuarter(${q})"
              class="px-2 py-0.5 rounded-md font-extrabold text-xs transition ${
                isActiveClockQuarter
                  ? 'bg-emerald-500 text-slate-950 shadow'
                  : isPreviewQuarter
                    ? 'bg-sky-500 text-slate-950 shadow'
                    : 'bg-emerald-500/20 text-emerald-300'
              }">
              Quarter ${q}
            </button>
            <span class="text-[11px] text-slate-400">${qtrDurLabel}</span>
            ${isActiveClockQuarter ? `<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-extrabold border border-emerald-500/40">🟢 ACTIVE CLOCK</span>` : ''}
            ${isPreviewQuarter ? `<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300 font-extrabold border border-sky-500/40">👀 PREVIEWING</span>` : ''}
          </div>
          ${state.shiftsPerQuarter === 2 && editable ? `
            <button onclick="toggleFullQuarter(${q})"
              class="px-2 py-1 rounded-lg text-[11px] font-semibold border transition ${
                state.fullQuarterLocks[q]
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
              }">
              ${state.fullQuarterLocks[q] ? '🔒 Full Qtr (1.0)' : 'Full Qtr (No Mid-Sub)'}
            </button>
          ` : (isFullQtr ? `<span class="text-[11px] text-slate-500 font-semibold">Full Qtr (1.0)</span>` : '')}
        </div>

        <div class="space-y-2">
          ${visibleShifts.map(shift => {
            const benchNames = shift.benchIds.map(id => playerMap[id] || '').filter(Boolean);
            let shiftLabel = '';
            if (isFullQtr) {
              shiftLabel = `Full Quarter (${qtrDurLabel} • 1.0 Qtr)`;
            } else if (shift.part === 2 && shift.isMidQtrPosSwapShift) {
              shiftLabel = `2nd ${shiftDurLabel} • 🔄 FWD ⇄ DEF Swap`;
            } else {
              shiftLabel = shift.part === 1 ? `1st ${shiftDurLabel} (0.5 Qtr)` : `2nd ${shiftDurLabel} (0.5 Qtr)`;
            }

            const isShiftActive = isActiveClockQuarter && (
              isFullQtr || (activeShift && activeShift.index === shift.index)
            );

            const posGroups = { FWD: [], MID: [], DEF: [], GK: [] };
            Object.entries(shift.positions || {}).forEach(([pid, pos]) => {
              if (!shift.benchIds.includes(pid) && playerMap[pid]) {
                if (!posGroups[pos]) posGroups[pos] = [];
                posGroups[pos].push(playerMap[pid]);
              }
            });

            return `
              <div ${editable ? `onclick="openEditModal(${shift.index})"` : ''}
                class="group ${editable ? 'cursor-pointer' : 'cursor-default'} rounded-xl p-2.5 border transition ${
                  isShiftActive
                    ? 'bg-emerald-950/35 border-emerald-400 ring-1 ring-emerald-400/50 shadow-md'
                    : shift.locked
                      ? 'bg-amber-500/10 border-amber-500/40'
                      : 'bg-slate-950/60 border-slate-800/90'
                }">
                <div class="flex items-center justify-between mb-1.5">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="text-xs font-bold ${isShiftActive ? 'text-emerald-300' : 'text-slate-300'}">${shiftLabel}</span>
                    ${isShiftActive ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500 text-slate-950 font-extrabold">▶ IN PLAY</span>` : ''}
                    ${shift.locked ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold">LOCKED</span>` : ''}
                  </div>
                  ${editable ? `<span class="text-[11px] text-emerald-400 group-hover:underline font-medium">✏️ Edit Actual</span>` : ''}
                </div>

                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">🪑 Out:</span>
                  ${benchNames.length > 0
                    ? benchNames.map(n => `<span class="px-2 py-0.5 rounded-md text-xs font-bold pos-BENCH">${escapeHtml(n)}</span>`).join('')
                    : `<span class="text-xs text-slate-500 italic">None (All Play)</span>`
                  }
                </div>

                ${state.trackPositions ? `
                  <div class="mt-2 pt-2 border-t border-slate-800/70 grid grid-cols-2 gap-1.5 text-[11px]">
                    ${posGroups.FWD.length ? `
                      <div class="flex items-center gap-1 flex-wrap">
                        <span class="font-bold text-rose-400">⚔️ FWD:</span>
                        <span class="text-slate-200 font-medium">${posGroups.FWD.map(escapeHtml).join(', ')}</span>
                      </div>
                    ` : ''}
                    ${posGroups.MID.length ? `
                      <div class="flex items-center gap-1 flex-wrap">
                        <span class="font-bold text-blue-400">⚡ MID:</span>
                        <span class="text-slate-200 font-medium">${posGroups.MID.map(escapeHtml).join(', ')}</span>
                      </div>
                    ` : ''}
                    ${posGroups.DEF.length ? `
                      <div class="flex items-center gap-1 flex-wrap">
                        <span class="font-bold text-emerald-400">🛡️ DEF:</span>
                        <span class="text-slate-200 font-medium">${posGroups.DEF.map(escapeHtml).join(', ')}</span>
                      </div>
                    ` : ''}
                    ${posGroups.GK.length ? `
                      <div class="flex items-center gap-1 flex-wrap">
                        <span class="font-bold text-amber-400">🧤 GK:</span>
                        <span class="text-slate-200 font-medium">${posGroups.GK.map(escapeHtml).join(', ')}</span>
                      </div>
                    ` : ''}
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }
  grid.innerHTML = html;
}

function toggleBalanceSort(col) {
  if (!state.balanceSort) state.balanceSort = { col: 'order', dir: 'asc' };
  if (state.balanceSort.col === col) {
    state.balanceSort.dir = state.balanceSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    state.balanceSort.col = col;
    state.balanceSort.dir = (col === 'name' || col === 'number') ? 'asc' : 'desc';
  }
  saveState(false);
  renderBalanceTable();
}

function renderBalanceTable() {
  const tbody = document.getElementById('balanceTableBody');
  const showGkCol = (state.slots.GK || 0) > 0;
  const shiftWeight = getShiftQuarterWeight(state.shiftsPerQuarter);
  const totalGameQuarters = 4.0;

  document.getElementById('gkHeaderCell').style.display = (state.trackPositions && showGkCol) ? '' : 'none';
  document.querySelectorAll('.pos-col').forEach(el => {
    if (el.id !== 'gkHeaderCell') {
      el.style.display = state.trackPositions ? '' : 'none';
    }
  });

  const sortCol = (state.balanceSort && state.balanceSort.col) || 'order';
  const sortDir = (state.balanceSort && state.balanceSort.dir) || 'asc';
  ['number', 'name', 'BENCH', 'FWD', 'MID', 'DEF', 'GK', 'playPct'].forEach(c => {
    const ind = document.getElementById('balSort_' + c);
    if (ind) ind.textContent = sortCol === c ? (sortDir === 'asc' ? '▲' : '▼') : '';
  });

  const presentPlayers = state.players.filter(p => p.present);
  if (presentPlayers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="py-3 text-center text-slate-500 italic">No active players yet.</td></tr>`;
    return;
  }

  const rows = presentPlayers.map((p, idx) => {
    const counts = { BENCH: 0, FWD: 0, MID: 0, DEF: 0, GK: 0 };
    state.computedShifts.forEach(s => {
      if (s.benchIds.includes(p.id)) {
        counts.BENCH = Math.round((counts.BENCH + shiftWeight) * 100) / 100;
      } else {
        const pos = s.positions[p.id] || 'MID';
        counts[pos] = Math.round(((counts[pos] || 0) + shiftWeight) * 100) / 100;
      }
    });

    const playedQuarters = Math.max(0, totalGameQuarters - counts.BENCH);
    const playPct = Math.round((playedQuarters / totalGameQuarters) * 100);

    return { player: p, idx, counts, playPct };
  });

  rows.sort((a, b) => {
    let cmp = 0;
    if (sortCol === 'name') {
      cmp = (a.player.name || '').localeCompare(b.player.name || '');
    } else if (sortCol === 'number') {
      cmp = comparePlayerNumbers(a.player, b.player);
    } else if (sortCol === 'playPct') {
      cmp = a.playPct - b.playPct;
    } else if (['BENCH', 'FWD', 'MID', 'DEF', 'GK'].includes(sortCol)) {
      const totA = (a.counts[sortCol] || 0) + (a.player.prior[sortCol] || 0);
      const totB = (b.counts[sortCol] || 0) + (b.player.prior[sortCol] || 0);
      cmp = totA !== totB ? totA - totB : (a.counts[sortCol] || 0) - (b.counts[sortCol] || 0);
    } else {
      cmp = a.idx - b.idx;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  tbody.innerHTML = rows.map(({ player: p, counts, playPct }) => {
    const fmtCell = (zone) => {
      const today = counts[zone] || 0;
      const season = Math.round((today + (p.prior[zone] || 0)) * 100) / 100;
      return p.prior[zone]
        ? `<span class="font-bold text-white">${fmtNum(today)}</span> <span class="text-slate-500">(${fmtNum(season)})</span>`
        : `<span class="font-bold text-white">${fmtNum(today)}</span>`;
    };

    return `
      <tr>
        <td class="py-2 pr-1 mono text-emerald-300 font-bold">${p.number ? '#' + escapeHtml(p.number) : '-'}</td>
        <td class="py-2 pr-2 font-bold text-white">${escapeHtml(p.name)}</td>
        <td class="py-2 px-2 text-center mono">${fmtCell('BENCH')}</td>
        ${state.trackPositions ? `
          <td class="py-2 px-2 text-center mono text-rose-300">${fmtCell('FWD')}</td>
          <td class="py-2 px-2 text-center mono text-blue-300">${fmtCell('MID')}</td>
          <td class="py-2 px-2 text-center mono text-emerald-300">${fmtCell('DEF')}</td>
          ${showGkCol ? `<td class="py-2 px-2 text-center mono text-amber-300">${fmtCell('GK')}</td>` : ''}
        ` : ''}
        <td class="py-2 pl-2 text-right mono font-bold text-emerald-400">${playPct}%</td>
      </tr>
    `;
  }).join('');
}

// ============================================================================
// SEASON STATS & CLICKABLE / EDITABLE GAME HISTORY VIEWER
// ============================================================================
function toggleStatsSort(col) {
  if (!state.statsSort) state.statsSort = { col: 'pts', dir: 'desc' };
  if (state.statsSort.col === col) {
    state.statsSort.dir = state.statsSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    state.statsSort.col = col;
    state.statsSort.dir = (col === 'name' || col === 'number') ? 'asc' : 'desc';
  }
  saveState(false);
  renderStatsAndHistoryTab();
}

function renderStatsAndHistoryTab() {
  let wins = 0, losses = 0, draws = 0, gf = 0, ga = 0;
  state.gameHistory.forEach(g => {
    gf += Number(g.ourScore) || 0;
    ga += Number(g.oppScore) || 0;
    if (g.ourScore > g.oppScore) wins++;
    else if (g.ourScore < g.oppScore) losses++;
    else draws++;
  });

  const diff = gf - ga;
  document.getElementById('statRecord').textContent = `${wins}-${losses}-${draws}`;
  document.getElementById('statGoalsFor').textContent = gf;
  document.getElementById('statGoalsAgainst').textContent = ga;
  document.getElementById('statGoalDiff').textContent = diff > 0 ? `+${diff}` : String(diff);

  const sortCol = (state.statsSort && state.statsSort.col) || 'pts';
  const sortDir = (state.statsSort && state.statsSort.dir) || 'desc';
  ['number', 'name', 'gamesPlayed', 'goals', 'assists', 'pts', 'BENCH'].forEach(c => {
    const el = document.getElementById('stSort_' + c);
    if (el) el.textContent = sortCol === c ? (sortDir === 'asc' ? '▲' : '▼') : '';
  });

  const statsBody = document.getElementById('seasonStatsTableBody');
  if (state.players.length === 0) {
    statsBody.innerHTML = `<tr><td colspan="8" class="py-4 text-center text-slate-500 italic">No players in roster yet.</td></tr>`;
  } else {
    const sortedPlayers = [...state.players].sort((a, b) => {
      let cmp = 0;
      const ptsA = (a.prior.goals || 0) + (a.prior.assists || 0);
      const ptsB = (b.prior.goals || 0) + (b.prior.assists || 0);

      if (sortCol === 'name') cmp = (a.name || '').localeCompare(b.name || '');
      else if (sortCol === 'number') cmp = comparePlayerNumbers(a, b);
      else if (sortCol === 'gamesPlayed') cmp = (a.prior.gamesPlayed || 0) - (b.prior.gamesPlayed || 0);
      else if (sortCol === 'goals') cmp = (a.prior.goals || 0) - (b.prior.goals || 0);
      else if (sortCol === 'assists') cmp = (a.prior.assists || 0) - (b.prior.assists || 0);
      else if (sortCol === 'BENCH') cmp = (a.prior.BENCH || 0) - (b.prior.BENCH || 0);
      else {
        cmp = ptsA !== ptsB ? ptsA - ptsB : (a.prior.goals || 0) - (b.prior.goals || 0);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    statsBody.innerHTML = sortedPlayers.map(p => {
      const g = p.prior.goals || 0;
      const a = p.prior.assists || 0;
      const pts = g + a;
      const gp = p.prior.gamesPlayed || 0;
      const bench = fmtNum(p.prior.BENCH || 0);
      const posBreakdown = `${fmtNum(p.prior.FWD || 0)} / ${fmtNum(p.prior.MID || 0)} / ${fmtNum(p.prior.DEF || 0)} / ${fmtNum(p.prior.GK || 0)}`;

      return `
        <tr>
          <td class="py-2.5 pr-1 mono text-emerald-300 font-bold">${p.number ? '#' + escapeHtml(p.number) : '-'}</td>
          <td class="py-2.5 pr-2 font-bold text-white">${escapeHtml(p.name)}</td>
          <td class="py-2.5 px-2 text-center mono text-slate-300">${gp}</td>
          <td class="py-2.5 px-2 text-center mono font-bold text-emerald-400">${g}</td>
          <td class="py-2.5 px-2 text-center mono font-bold text-blue-400">${a}</td>
          <td class="py-2.5 px-2 text-center mono font-extrabold text-amber-300">${pts}</td>
          <td class="py-2.5 px-2 text-center mono text-slate-300">${bench}</td>
          <td class="py-2.5 pl-2 text-right mono text-slate-400">${posBreakdown}</td>
        </tr>
      `;
    }).join('');
  }

  const histContainer = document.getElementById('gameHistoryList');
  if (state.gameHistory.length === 0) {
    histContainer.innerHTML = `
      <div class="text-xs text-slate-500 italic py-6 text-center bg-slate-950/50 rounded-xl border border-slate-800/70">
        No completed games saved yet for ${escapeHtml(state.teamName)}.
      </div>
    `;
    return;
  }

  histContainer.innerHTML = state.gameHistory.map(game => {
    const isWin = game.ourScore > game.oppScore;
    const isLoss = game.ourScore < game.oppScore;
    const badgeClass = isWin
      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
      : isLoss
        ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
        : 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    const resChar = isWin ? 'W' : isLoss ? 'L' : 'D';

    return `
      <div onclick="openGameDetailModal('${game.id}')"
        class="cursor-pointer group bg-slate-950/80 hover:bg-slate-950 border border-slate-800 hover:border-emerald-500/50 rounded-xl p-3.5 space-y-2 transition shadow">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="px-2 py-0.5 rounded-md text-xs font-extrabold border ${badgeClass}">${resChar}</span>
            <span class="font-extrabold text-sm text-white">
              ${escapeHtml(game.teamName)} <span class="text-emerald-400 mono">${game.ourScore}</span> - <span class="text-slate-300 mono">${game.oppScore}</span> ${escapeHtml(game.opponent)}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-slate-400">${escapeHtml(game.date)}</span>
            <span class="text-[11px] text-emerald-400 font-semibold group-hover:underline">${canEditGame() ? '✏️ View / Edit' : '📋 View Details'}</span>
          </div>
        </div>

        ${game.goals && game.goals.length > 0 ? `
          <div class="pt-1.5 border-t border-slate-800/70 flex flex-wrap gap-1.5">
            ${game.goals.map(gl => `
              <span class="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-[11px] text-slate-300">
                ⚽ <strong>${escapeHtml(gl.scorerLabel)}</strong>
                ${gl.assistLabel ? `<span class="text-slate-400">(Ast: ${escapeHtml(gl.assistLabel)})</span>` : ''}
              </span>
            `).join('')}
          </div>
        ` : `<div class="text-[11px] text-slate-500 italic">No team goals logged</div>`}
      </div>
    `;
  }).join('');
}

function finishAndSaveGame() {
  if (!canEditGame() || state.players.length === 0) return;

  const presentPlayers = state.players.filter(p => p.present);
  const shiftWeight = getShiftQuarterWeight(state.shiftsPerQuarter);

  const gamePlayerStats = {};
  state.players.forEach(p => {
    gamePlayerStats[p.id] = {
      playerId: p.id,
      name: p.name,
      number: p.number || '',
      present: !!p.present,
      BENCH: 0, FWD: 0, MID: 0, DEF: 0, GK: 0
    };
  });

  state.computedShifts.forEach(s => {
    presentPlayers.forEach(p => {
      if (s.benchIds.includes(p.id)) {
        p.prior.BENCH = Math.round(((p.prior.BENCH || 0) + shiftWeight) * 100) / 100;
        gamePlayerStats[p.id].BENCH = Math.round((gamePlayerStats[p.id].BENCH + shiftWeight) * 100) / 100;
      } else {
        const pos = s.positions[p.id] || 'MID';
        p.prior[pos] = Math.round(((p.prior[pos] || 0) + shiftWeight) * 100) / 100;
        gamePlayerStats[p.id][pos] = Math.round(((gamePlayerStats[p.id][pos] || 0) + shiftWeight) * 100) / 100;
      }
    });
  });

  presentPlayers.forEach(p => {
    p.prior.gamesPlayed = (p.prior.gamesPlayed || 0) + 1;
  });

  state.players.forEach(p => {
    p.rsvp = null;
    p.present = true;
  });

  const formattedGoals = (state.currentMatch.goals || []).map(g => {
    const scorer = state.players.find(p => p.id === g.scorerId);
    if (scorer) scorer.prior.goals = (scorer.prior.goals || 0) + 1;

    const assister = g.assistId ? state.players.find(p => p.id === g.assistId) : null;
    if (assister) assister.prior.assists = (assister.prior.assists || 0) + 1;

    return {
      id: g.id || ('hg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5)),
      quarter: g.quarter,
      clock: g.clock,
      scorerId: g.scorerId,
      assistId: g.assistId || null,
      scorerLabel: getPlayerDisplayById(g.scorerId),
      assistLabel: g.assistId ? getPlayerDisplayById(g.assistId) : null
    };
  });

  const playerMap = Object.fromEntries(state.players.map(p => [p.id, formatPlayerBadge(p)]));
  const rotationSnapshot = state.computedShifts.map(s => ({
    quarter: s.quarter,
    part: s.part,
    benchNames: s.benchIds.map(id => playerMap[id]).filter(Boolean),
    positions: Object.fromEntries(
      Object.entries(s.positions || {})
        .filter(([pid]) => !s.benchIds.includes(pid) && playerMap[pid])
        .map(([pid, pos]) => [playerMap[pid], pos])
    )
  }));

  const todayStr = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  state.gameHistory.unshift({
    id: 'match_' + Date.now(),
    date: todayStr,
    teamName: state.teamName || 'My Team',
    opponent: state.currentMatch.opponent || 'Opponent',
    ourScore: state.currentMatch.ourScore || 0,
    oppScore: state.currentMatch.oppScore || 0,
    shiftsPerQuarter: state.shiftsPerQuarter,
    goals: formattedGoals,
    playerStats: gamePlayerStats,
    rotationSnapshot
  });

  state.currentMatch = {
    opponent: 'Opponent',
    ourScore: 0,
    oppScore: 0,
    goals: []
  };
  state.lockedShifts = {};
  state.fullQuarterLocks = { 1: false, 2: false, 3: false, 4: false };
  timer.quarter = 1;
  timer.viewedQuarter = 1;
  timer.activeAlertShiftIdx = null;
  timer.dismissedShiftIndices = [];
  resetTimer(false);
  recalculateSchedule();
  switchMainTab('stats');
  renderAll();
}

// ============================================================================
// HISTORICAL GAME DETAIL VIEWER & EDITOR MODAL LOGIC
// ============================================================================
function resolveGoalPlayerId(goalObj, fieldId, fieldLabel) {
  if (goalObj[fieldId]) return goalObj[fieldId];
  if (!goalObj[fieldLabel]) return fieldId === 'scorerId' ? 'OWN_GOAL' : null;
  const lbl = String(goalObj[fieldLabel]).toLowerCase().trim();
  if (lbl === 'own goal' || lbl === 'team goal') return 'OWN_GOAL';
  const match = state.players.find(p =>
    formatPlayerBadge(p).toLowerCase() === lbl || p.name.toLowerCase() === lbl
  );
  return match ? match.id : (fieldId === 'scorerId' ? 'OWN_GOAL' : null);
}

function openGameDetailModal(gameId) {
  const game = state.gameHistory.find(g => g.id === gameId);
  if (!game) return;
  editingHistoryGameId = gameId;

  const draftPlayerStats = {};
  state.players.forEach(p => {
    const existing = game.playerStats && game.playerStats[p.id];
    draftPlayerStats[p.id] = existing
      ? { ...existing }
      : {
          playerId: p.id,
          name: p.name,
          number: p.number || '',
          present: true,
          BENCH: 0, FWD: 0, MID: 0, DEF: 0, GK: 0,
          isLegacyUnrecorded: true
        };
  });

  histDraft = {
    date: game.date || '',
    teamName: game.teamName || state.teamName,
    opponent: game.opponent || 'Opponent',
    ourScore: Number(game.ourScore) || 0,
    oppScore: Number(game.oppScore) || 0,
    goals: (game.goals || []).map(gl => ({
      id: gl.id || ('hg_' + Math.random().toString(36).slice(2, 7)),
      quarter: gl.quarter || 1,
      clock: gl.clock || '04:00',
      scorerId: resolveGoalPlayerId(gl, 'scorerId', 'scorerLabel'),
      assistId: resolveGoalPlayerId(gl, 'assistId', 'assistLabel')
    })),
    playerStats: draftPlayerStats,
    rotationSnapshot: game.rotationSnapshot || null
  };

  const editable = canEditGame();
  document.getElementById('gameDetailModalTitle').textContent = editable ? '📋 Match Details & Editor' : '📋 Match Box Score';
  document.getElementById('gameDetailModalSubtitle').textContent = editable
    ? 'Edit score, goals, assists, or player quarter counts. Saving updates season stats automatically.'
    : 'Completed match summary and player quarter breakdown.';

  ['histEditDate', 'histEditTeamName', 'histEditOpponent', 'histEditOurScore', 'histEditOppScore'].forEach(id => {
    document.getElementById(id).disabled = !editable;
  });
  document.querySelectorAll('.hist-edit-btn').forEach(el => {
    el.style.display = editable ? '' : 'none';
  });
  document.getElementById('histAddGoalBtn').style.display = editable ? '' : 'none';
  document.getElementById('histDeleteGameBtn').style.display = isHeadCoach() ? '' : 'none';
  document.getElementById('histSaveGameBtn').style.display = editable ? '' : 'none';

  document.getElementById('histEditDate').value = histDraft.date;
  document.getElementById('histEditTeamName').value = histDraft.teamName;
  document.getElementById('histEditOpponent').value = histDraft.opponent;
  document.getElementById('histEditOurScore').value = histDraft.ourScore;
  document.getElementById('histEditOppScore').value = histDraft.oppScore;

  renderHistEditGoals();
  renderHistEditPlayers();
  renderHistRotationSnapshot();

  document.getElementById('gameDetailModal').classList.remove('hidden');
}

function closeGameDetailModal() {
  editingHistoryGameId = null;
  histDraft = null;
  document.getElementById('gameDetailModal').classList.add('hidden');
}

function adjustHistDraftScore(side, delta) {
  if (!canEditGame() || !histDraft) return;
  if (side === 'our') {
    const cur = parseInt(document.getElementById('histEditOurScore').value, 10) || 0;
    document.getElementById('histEditOurScore').value = Math.max(0, cur + delta);
  } else {
    const cur = parseInt(document.getElementById('histEditOppScore').value, 10) || 0;
    document.getElementById('histEditOppScore').value = Math.max(0, cur + delta);
  }
}

function renderHistEditGoals() {
  const container = document.getElementById('histEditGoalsList');
  const editable = canEditGame();
  if (!histDraft.goals || histDraft.goals.length === 0) {
    container.innerHTML = `<div class="text-xs text-slate-500 italic py-2 text-center bg-slate-950 rounded-xl border border-slate-800">No team goals logged for this game.</div>`;
    return;
  }

  const scorerOptions = [
    ...state.players.map(p => ({ id: p.id, label: formatPlayerBadge(p) })),
    { id: 'OWN_GOAL', label: 'Own Goal / Team' }
  ];

  const assistOptions = [
    { id: '', label: 'Unassisted' },
    ...state.players.map(p => ({ id: p.id, label: formatPlayerBadge(p) }))
  ];

  container.innerHTML = histDraft.goals.map((g, idx) => `
    <div class="bg-slate-950 border border-slate-800 rounded-xl p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
      <div class="flex items-center gap-1.5">
        <select ${editable ? '' : 'disabled'} onchange="updateHistGoalField(${idx}, 'quarter', Number(this.value))"
          class="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-emerald-300 font-bold">
          ${[1, 2, 3, 4].map(q => `<option value="${q}" ${Number(g.quarter) === q ? 'selected' : ''}>Q${q}</option>`).join('')}
        </select>
        <input ${editable ? '' : 'disabled'} type="text" value="${escapeHtml(g.clock || '04:00')}" maxlength="5"
          onchange="updateHistGoalField(${idx}, 'clock', this.value)"
          class="w-14 bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1 text-center mono text-slate-300" />
      </div>

      <div class="flex items-center gap-1.5 flex-1 min-w-[180px]">
        <span class="text-slate-400">⚽</span>
        <select ${editable ? '' : 'disabled'} onchange="updateHistGoalField(${idx}, 'scorerId', this.value)"
          class="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-white font-bold">
          ${scorerOptions.map(o => `<option value="${o.id}" ${g.scorerId === o.id ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
        </select>
      </div>

      <div class="flex items-center gap-1.5 flex-1 min-w-[170px]">
        <span class="text-slate-400">👟</span>
        <select ${editable ? '' : 'disabled'} onchange="updateHistGoalField(${idx}, 'assistId', this.value || null)"
          class="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-blue-300 font-semibold">
          ${assistOptions.map(o => `<option value="${o.id}" ${(g.assistId || '') === o.id ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
        </select>
        ${editable ? `<button onclick="removeHistDraftGoal(${idx})" class="text-slate-500 hover:text-rose-400 px-1.5 font-bold" title="Remove Goal">✕</button>` : ''}
      </div>
    </div>
  `).join('');
}

function updateHistGoalField(idx, field, value) {
  if (!canEditGame() || !histDraft || !histDraft.goals[idx]) return;
  histDraft.goals[idx][field] = value;
}

function addHistDraftGoal() {
  if (!canEditGame() || !histDraft) return;
  const defaultScorer = state.players.length > 0 ? state.players[0].id : 'OWN_GOAL';
  histDraft.goals.push({
    id: 'hg_' + Date.now(),
    quarter: 1,
    clock: '04:00',
    scorerId: defaultScorer,
    assistId: null
  });
  const curScore = parseInt(document.getElementById('histEditOurScore').value, 10) || 0;
  if (histDraft.goals.length > curScore) {
    document.getElementById('histEditOurScore').value = histDraft.goals.length;
  }
  renderHistEditGoals();
}

function removeHistDraftGoal(idx) {
  if (!canEditGame() || !histDraft) return;
  histDraft.goals.splice(idx, 1);
  const curScore = parseInt(document.getElementById('histEditOurScore').value, 10) || 0;
  document.getElementById('histEditOurScore').value = Math.max(0, curScore - 1);
  renderHistEditGoals();
}

function renderHistEditPlayers() {
  const container = document.getElementById('histEditPlayersList');
  const editable = canEditGame();
  if (!histDraft || state.players.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = state.players.map(p => {
    const ps = histDraft.playerStats[p.id] || { present: true, BENCH: 0, FWD: 0, MID: 0, DEF: 0, GK: 0 };
    return `
      <div class="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div class="flex items-center gap-2 min-w-[120px]">
          <input ${editable ? '' : 'disabled'} type="checkbox" ${ps.present ? 'checked' : ''}
            onchange="toggleHistPlayerPresent('${p.id}', this.checked)"
            class="rounded accent-emerald-500" />
          <span class="font-bold text-white ${ps.present ? '' : 'line-through text-slate-500'}">${escapeHtml(formatPlayerBadge(p))}</span>
        </div>
        <div class="flex items-center gap-2 flex-wrap text-[11px]">
          <label class="text-slate-400">🪑<input ${editable ? '' : 'disabled'} type="number" step="0.5" min="0" value="${ps.BENCH || 0}"
            onchange="updateHistPlayerStat('${p.id}', 'BENCH', this.value)"
            class="w-11 ml-1 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-center mono text-white" /></label>
          <label class="text-rose-400">FWD<input ${editable ? '' : 'disabled'} type="number" step="0.5" min="0" value="${ps.FWD || 0}"
            onchange="updateHistPlayerStat('${p.id}', 'FWD', this.value)"
            class="w-11 ml-1 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-center mono text-white" /></label>
          <label class="text-blue-400">MID<input ${editable ? '' : 'disabled'} type="number" step="0.5" min="0" value="${ps.MID || 0}"
            onchange="updateHistPlayerStat('${p.id}', 'MID', this.value)"
            class="w-11 ml-1 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-center mono text-white" /></label>
          <label class="text-emerald-400">DEF<input ${editable ? '' : 'disabled'} type="number" step="0.5" min="0" value="${ps.DEF || 0}"
            onchange="updateHistPlayerStat('${p.id}', 'DEF', this.value)"
            class="w-11 ml-1 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-center mono text-white" /></label>
          <label class="text-amber-400">GK<input ${editable ? '' : 'disabled'} type="number" step="0.5" min="0" value="${ps.GK || 0}"
            onchange="updateHistPlayerStat('${p.id}', 'GK', this.value)"
            class="w-11 ml-1 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-center mono text-white" /></label>
        </div>
      </div>
    `;
  }).join('');
}

function toggleHistPlayerPresent(playerId, isPresent) {
  if (!canEditGame() || !histDraft || !histDraft.playerStats[playerId]) return;
  histDraft.playerStats[playerId].present = isPresent;
  histDraft.playerStats[playerId].isLegacyUnrecorded = false;
  renderHistEditPlayers();
}

function updateHistPlayerStat(playerId, zone, val) {
  if (!canEditGame() || !histDraft || !histDraft.playerStats[playerId]) return;
  histDraft.playerStats[playerId][zone] = Math.max(0, parseFloat(val) || 0);
  histDraft.playerStats[playerId].isLegacyUnrecorded = false;
}

function renderHistRotationSnapshot() {
  const sec = document.getElementById('histRotationSnapshotSection');
  const list = document.getElementById('histRotationSnapshotList');
  if (!histDraft || !histDraft.rotationSnapshot || histDraft.rotationSnapshot.length === 0) {
    sec.classList.add('hidden');
    list.innerHTML = '';
    return;
  }
  sec.classList.remove('hidden');
  list.innerHTML = histDraft.rotationSnapshot.map(s => `
    <div class="bg-slate-950 border border-slate-800 rounded-lg p-2">
      <div class="font-bold text-emerald-300">Q${s.quarter} • Shift ${s.part}</div>
      <div class="text-slate-400">🪑 Out: <span class="text-white font-semibold">${s.benchNames && s.benchNames.length ? s.benchNames.map(escapeHtml).join(', ') : 'None'}</span></div>
    </div>
  `).join('');
}

function saveGameDetailEdits() {
  if (!canEditGame() || !editingHistoryGameId || !histDraft) return;
  const gameIdx = state.gameHistory.findIndex(g => g.id === editingHistoryGameId);
  if (gameIdx < 0) return;

  const oldGame = state.gameHistory[gameIdx];

  const oldGoalsCount = {};
  const oldAssistsCount = {};
  (oldGame.goals || []).forEach(gl => {
    const sId = resolveGoalPlayerId(gl, 'scorerId', 'scorerLabel');
    const aId = resolveGoalPlayerId(gl, 'assistId', 'assistLabel');
    if (sId && sId !== 'OWN_GOAL') oldGoalsCount[sId] = (oldGoalsCount[sId] || 0) + 1;
    if (aId) oldAssistsCount[aId] = (oldAssistsCount[aId] || 0) + 1;
  });

  const newGoalsCount = {};
  const newAssistsCount = {};
  const savedGoals = histDraft.goals.map(gl => {
    if (gl.scorerId && gl.scorerId !== 'OWN_GOAL') {
      newGoalsCount[gl.scorerId] = (newGoalsCount[gl.scorerId] || 0) + 1;
    }
    if (gl.assistId) {
      newAssistsCount[gl.assistId] = (newAssistsCount[gl.assistId] || 0) + 1;
    }
    return {
      id: gl.id,
      quarter: gl.quarter,
      clock: gl.clock,
      scorerId: gl.scorerId,
      assistId: gl.assistId || null,
      scorerLabel: getPlayerDisplayById(gl.scorerId),
      assistLabel: gl.assistId ? getPlayerDisplayById(gl.assistId) : null
    };
  });

  state.players.forEach(p => {
    const gDelta = (newGoalsCount[p.id] || 0) - (oldGoalsCount[p.id] || 0);
    const aDelta = (newAssistsCount[p.id] || 0) - (oldAssistsCount[p.id] || 0);
    p.prior.goals = Math.max(0, (p.prior.goals || 0) + gDelta);
    p.prior.assists = Math.max(0, (p.prior.assists || 0) + aDelta);

    const newPs = histDraft.playerStats[p.id];
    const oldPs = oldGame.playerStats ? oldGame.playerStats[p.id] : null;
    if (newPs && !newPs.isLegacyUnrecorded && oldPs) {
      const gpDelta = (newPs.present ? 1 : 0) - (oldPs.present ? 1 : 0);
      p.prior.gamesPlayed = Math.max(0, (p.prior.gamesPlayed || 0) + gpDelta);
      ['BENCH', 'FWD', 'MID', 'DEF', 'GK'].forEach(z => {
        const zDelta = (Number(newPs[z]) || 0) - (Number(oldPs[z]) || 0);
        p.prior[z] = Math.max(0, Math.round(((p.prior[z] || 0) + zDelta) * 100) / 100);
      });
    }
  });

  state.gameHistory[gameIdx] = {
    ...oldGame,
    date: document.getElementById('histEditDate').value.trim() || oldGame.date,
    teamName: document.getElementById('histEditTeamName').value.trim() || state.teamName,
    opponent: document.getElementById('histEditOpponent').value.trim() || 'Opponent',
    ourScore: Math.max(0, parseInt(document.getElementById('histEditOurScore').value, 10) || 0),
    oppScore: Math.max(0, parseInt(document.getElementById('histEditOppScore').value, 10) || 0),
    goals: savedGoals,
    playerStats: histDraft.playerStats
  };

  closeGameDetailModal();
  recalculateSchedule();
  renderAll();
}

function deleteCurrentModalHistoryGame() {
  if (!isHeadCoach() || !editingHistoryGameId) return;
  if (!confirm('Delete this game from history and subtract its goals, assists, and shifts from season totals?')) return;
  deleteHistoryGame(editingHistoryGameId);
  closeGameDetailModal();
}

function deleteHistoryGame(gameId) {
  if (!isHeadCoach()) return;
  const game = state.gameHistory.find(g => g.id === gameId);
  if (game) {
    (game.goals || []).forEach(gl => {
      const sId = resolveGoalPlayerId(gl, 'scorerId', 'scorerLabel');
      const aId = resolveGoalPlayerId(gl, 'assistId', 'assistLabel');
      const scorer = state.players.find(p => p.id === sId);
      if (scorer) scorer.prior.goals = Math.max(0, (scorer.prior.goals || 0) - 1);
      const assister = state.players.find(p => p.id === aId);
      if (assister) assister.prior.assists = Math.max(0, (assister.prior.assists || 0) - 1);
    });

    if (game.playerStats) {
      state.players.forEach(p => {
        const ps = game.playerStats[p.id];
        if (ps && !ps.isLegacyUnrecorded) {
          if (ps.present) p.prior.gamesPlayed = Math.max(0, (p.prior.gamesPlayed || 0) - 1);
          ['BENCH', 'FWD', 'MID', 'DEF', 'GK'].forEach(z => {
            p.prior[z] = Math.max(0, Math.round(((p.prior[z] || 0) - (Number(ps[z]) || 0)) * 100) / 100);
          });
        }
      });
    }
  }

  state.gameHistory = state.gameHistory.filter(g => g.id !== gameId);
  recalculateSchedule();
  renderAll();
}

// ============================================================================
// SMS / RCS TEXT GENERATION & COPY
// ============================================================================
function getSmsMessages() {
  const playerMap = Object.fromEntries(state.players.map(p => [p.id, formatPlayerBadge(p)]));
  const ordinals = ['', '1st', '2nd', '3rd', '4th'];
  const messages = [];

  state.computedShifts.forEach(s => {
    if (state.shiftsPerQuarter === 2 && s.part === 2 && state.fullQuarterLocks[s.quarter]) {
      return;
    }

    const qOrd = ordinals[s.quarter];
    const benchNames = s.benchIds.map(id => playerMap[id]).filter(Boolean);
    const benchStr = benchNames.length === 0
      ? 'None'
      : benchNames.length === 1
        ? benchNames[0]
        : benchNames.slice(0, -1).join(', ') + ' and ' + benchNames[benchNames.length - 1];

    const isFullQtr = state.shiftsPerQuarter === 1 || !!state.fullQuarterLocks[s.quarter];
    const prefix = isFullQtr
      ? `Out ${qOrd}`
      : (s.part === 1 ? `Out ${qOrd}` : `2nd part of ${qOrd}`);

    if (state.smsStyle === 'compact' || !state.trackPositions) {
      if (s.part === 2 && s.isMidQtrPosSwapShift) return;
      messages.push(`${prefix} ${benchStr}`);
    } else {
      const groups = { FWD: [], MID: [], DEF: [], GK: [] };
      Object.entries(s.positions || {}).forEach(([pid, pos]) => {
        if (!s.benchIds.includes(pid) && playerMap[pid]) {
          groups[pos].push(playerMap[pid]);
        }
      });
      const posParts = [];
      if (groups.FWD.length) posParts.push(`FWD: ${groups.FWD.join('/')}`);
      if (groups.MID.length) posParts.push(`MID: ${groups.MID.join('/')}`);
      if (groups.DEF.length) posParts.push(`DEF: ${groups.DEF.join('/')}`);
      if (groups.GK.length)  posParts.push(`GK: ${groups.GK.join('/')}`);

      messages.push(`${prefix}: ${benchStr} | ${posParts.join(' • ')}`);
    }
  });

  return messages;
}

function renderSmsBubbles() {
  const isCompact = state.smsStyle === 'compact' || !state.trackPositions;
  document.getElementById('smsBtnCompact').className = `px-2.5 py-1 rounded-lg text-xs font-semibold border ${
    isCompact ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'
  }`;
  document.getElementById('smsBtnPositions').className = `px-2.5 py-1 rounded-lg text-xs font-semibold border ${
    !isCompact ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'
  }`;

  const messages = getSmsMessages();
  const container = document.getElementById('smsBubblesContainer');
  container.innerHTML = messages.map((msg, idx) => `
    <div onclick="copySingleBubble(${idx})"
      class="cursor-pointer group flex items-center justify-between bg-[#1e4e68] hover:bg-[#255f7e] text-white px-3.5 py-2 rounded-2xl rounded-br-sm text-xs font-medium shadow transition">
      <span>${escapeHtml(msg)}</span>
      <span class="text-[10px] opacity-60 group-hover:opacity-100 ml-2 shrink-0">📋 Copy</span>
    </div>
  `).join('');
}

function setSmsStyle(style) {
  state.smsStyle = style;
  saveState(false);
  renderSmsBubbles();
}

function copySingleBubble(idx) {
  const msgs = getSmsMessages();
  if (msgs[idx]) copyTextToClipboard(msgs[idx]);
}

function copyAllSms() {
  const fullText = getSmsMessages().join('\n');
  copyTextToClipboard(fullText, 'copyAllBtn');
}

function copyTextToClipboard(text, btnId) {
  navigator.clipboard.writeText(text).then(() => {
    if (btnId) {
      const btn = document.getElementById(btnId);
      const orig = btn.innerHTML;
      btn.innerHTML = '✅ Copied!';
      setTimeout(() => { btn.innerHTML = orig; }, 1600);
    }
  });
}

// ============================================================================
// ON-THE-FLY SHIFT & POSITION MODAL ACTIONS (INCLUDES 🎲 RANDOM GK)
// ============================================================================
function openEditModal(shiftIdx) {
  if (!canEditGame()) return;
  editingShiftIdx = shiftIdx;
  const shift = state.computedShifts[shiftIdx];
  if (!shift) return;

  modalDraft = {
    benchIds: [...shift.benchIds],
    positions: { ...shift.positions }
  };

  const shiftDurLabel = fmtDurationLabel(state.quarterMins / state.shiftsPerQuarter);
  const qtrDurLabel = fmtDurationLabel(state.quarterMins);
  const isFullQtr = state.shiftsPerQuarter === 1 || !!state.fullQuarterLocks[shift.quarter];
  const partLabel = isFullQtr
    ? `Full ${qtrDurLabel}`
    : (shift.part === 1 ? `1st ${shiftDurLabel}` : `2nd ${shiftDurLabel}`);

  document.getElementById('modalTitle').textContent = `Edit Quarter ${shift.quarter} • ${partLabel}`;

  const randGkBtn = document.getElementById('modalRandomGkBtn');
  if (randGkBtn) {
    randGkBtn.classList.toggle('hidden', !(state.trackPositions && (state.slots.GK || 0) > 0));
  }

  document.getElementById('editModal').classList.remove('hidden');
  renderModalPlayers();
}

function closeEditModal() {
  editingShiftIdx = null;
  document.getElementById('editModal').classList.add('hidden');
}

function rollRandomModalGoalie() {
  const onFieldPlayers = state.players.filter(p => p.present && !modalDraft.benchIds.includes(p.id));
  if (onFieldPlayers.length === 0) return;

  const currentGkIds = onFieldPlayers.filter(p => modalDraft.positions[p.id] === 'GK').map(p => p.id);
  const candidates = onFieldPlayers.filter(p => !currentGkIds.includes(p.id));
  const pool = candidates.length > 0 ? candidates : onFieldPlayers;
  const winner = pool[Math.floor(Math.random() * pool.length)];

  const winnerOldPos = modalDraft.positions[winner.id] || 'MID';
  currentGkIds.forEach(oldId => {
    modalDraft.positions[oldId] = winnerOldPos === 'GK' ? 'DEF' : winnerOldPos;
  });
  modalDraft.positions[winner.id] = 'GK';
  renderModalPlayers();
}

function renderModalPlayers() {
  const presentPlayers = getSortedRosterList(state.players.filter(p => p.present));
  const targetBench = Math.max(0, presentPlayers.length - getTotalFieldSlots());

  document.getElementById('modalBenchCounter').textContent =
    `Sitting Out: ${modalDraft.benchIds.length} (Recommended: ${targetBench})`;

  const activeZones = ['FWD', 'MID', 'DEF'];
  if ((state.slots.GK || 0) > 0) activeZones.push('GK');

  const listEl = document.getElementById('modalPlayerList');
  listEl.innerHTML = presentPlayers.map(p => {
    const isSitting = modalDraft.benchIds.includes(p.id);
    const currentPos = modalDraft.positions[p.id] || 'MID';

    return `
      <div class="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5">
        <div class="flex items-center gap-2.5">
          <button onclick="toggleModalBench('${p.id}')"
            class="px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              isSitting
                ? 'pos-BENCH'
                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
            }">
            ${isSitting ? '🪑 Sitting Out' : '🏃 On Field'}
          </button>
          <span class="font-bold text-sm text-white">${escapeHtml(formatPlayerBadge(p))}</span>
        </div>

        ${!isSitting && state.trackPositions ? `
          <div class="flex items-center gap-1">
            ${activeZones.map(z => `
              <button onclick="setModalPlayerPos('${p.id}', '${z}')"
                class="px-2 py-1 rounded-md text-xs font-extrabold transition ${
                  currentPos === z ? `pos-${z}` : 'bg-slate-900 text-slate-500 border border-slate-800'
                }">
                ${z}
              </button>
            `).join('')}
          </div>
        ` : `
          <span class="text-xs text-slate-500">${isSitting ? 'On Bench' : 'Playing'}</span>
        `}
      </div>
    `;
  }).join('');
}

function toggleModalBench(playerId) {
  const idx = modalDraft.benchIds.indexOf(playerId);
  if (idx >= 0) {
    modalDraft.benchIds.splice(idx, 1);
    if (!modalDraft.positions[playerId]) modalDraft.positions[playerId] = 'MID';
  } else {
    modalDraft.benchIds.push(playerId);
  }
  renderModalPlayers();
}

function setModalPlayerPos(playerId, pos) {
  modalDraft.positions[playerId] = pos;
  renderModalPlayers();
}

function saveModalShift() {
  if (!canEditGame() || editingShiftIdx === null) return;
  const shift = state.computedShifts[editingShiftIdx];
  state.lockedShifts[editingShiftIdx] = {
    benchIds: [...modalDraft.benchIds],
    positions: { ...modalDraft.positions }
  };

  if (state.midQtrPosSwap && shift && shift.part === 1 && !state.lockedShifts[editingShiftIdx + 1]) {
    delete state.lockedShifts[editingShiftIdx + 1];
  }

  closeEditModal();
  recalculateSchedule();
  renderAll();
}

function unlockCurrentModalShift() {
  if (!canEditGame() || editingShiftIdx === null) return;
  delete state.lockedShifts[editingShiftIdx];
  closeEditModal();
  recalculateSchedule();
  renderAll();
}

// ============================================================================
// ROSTER, ATTENDANCE & FORMAT HANDLERS
// ============================================================================
function addPlayerFromOnboarding() {
  if (!isHeadCoach()) return;
  const numEl = document.getElementById('onboardPlayerNum');
  const nameEl = document.getElementById('onboardPlayerName');
  const teamEl = document.getElementById('onboardTeamNameInput');

  if (teamEl && teamEl.value.trim()) {
    state.teamName = teamEl.value.trim();
  }

  const name = (nameEl.value || '').trim();
  const number = (numEl.value || '').trim();
  if (!name) return;

  state.players.push({
    id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name,
    number,
    present: true,
    rsvp: null,
    prior: { BENCH: 0, FWD: 0, MID: 0, DEF: 0, GK: 0, gamesPlayed: 0, goals: 0, assists: 0 }
  });

  numEl.value = '';
  nameEl.value = '';
  nameEl.focus();
  recalculateSchedule();
  renderAll();
}

function addPlayer() {
  if (!isHeadCoach()) return;
  const numInput = document.getElementById('newPlayerNumberInput');
  const nameInput = document.getElementById('newPlayerInput');
  const name = (nameInput.value || '').trim();
  const number = (numInput.value || '').trim();
  if (!name) return;

  state.players.push({
    id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name,
    number,
    present: true,
    rsvp: null,
    prior: { BENCH: 0, FWD: 0, MID: 0, DEF: 0, GK: 0, gamesPlayed: 0, goals: 0, assists: 0 }
  });
  numInput.value = '';
  nameInput.value = '';
  nameInput.focus();
  recalculateSchedule();
  renderAll();
}

function updatePlayerNumber(playerId, newNum) {
  if (!isHeadCoach()) return;
  const p = state.players.find(x => x.id === playerId);
  if (p) {
    p.number = (newNum || '').trim();
    saveState();
    renderAll();
  }
}

function updatePlayerName(playerId, newName) {
  if (!isHeadCoach()) return;
  const p = state.players.find(x => x.id === playerId);
  if (p && newName.trim()) {
    p.name = newName.trim();
    saveState();
    renderAll();
  }
}

function removePlayer(id) {
  if (!isHeadCoach()) return;
  state.players = state.players.filter(p => p.id !== id);
  recalculateSchedule();
  renderAll();
}

function togglePositionMode() {
  if (!canEditGame()) return;
  state.trackPositions = !state.trackPositions;
  saveState();
  renderAll();
}

function toggleDrawer(id) {
  if (!isHeadCoach()) return;
  const el = document.getElementById(id);
  if (!el) return;
  const isHidden = el.classList.contains('hidden');
  if (isHidden) {
    el.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (id === 'settingsDrawer' && window.scrollY > 180) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    el.classList.add('hidden');
  }
}

function togglePlayerPresence(playerId) {
  if (!canEditGame()) return;
  const p = state.players.find(x => x.id === playerId);
  if (p) {
    p.present = !p.present;
    p.rsvp = p.present ? 'going' : 'out';
    recalculateSchedule();
    renderAll();
  }
}

function setAllAttendance(val) {
  if (!canEditGame()) return;
  state.players.forEach(p => {
    p.present = val;
    p.rsvp = val ? 'going' : 'out';
  });
  recalculateSchedule();
  renderAll();
}

function rotateStarterOrder() {
  if (!canEditGame()) return;
  if (state.players.length > 1) {
    const first = state.players.shift();
    state.players.push(first);
    recalculateSchedule();
    renderAll();
  }
}

function handleFormationChange(presetKey) {
  if (!isHeadCoach()) return;
  const preset = FORMATION_PRESETS[presetKey];
  if (preset) {
    state.formationKey = presetKey;
    state.slots = { ...preset.slots };
    state.lockedShifts = {};
    recalculateSchedule();
    renderAll();
  }
}

function adjustSlot(zone, delta) {
  if (!isHeadCoach()) return;
  state.slots[zone] = Math.max(0, (state.slots[zone] || 0) + delta);
  recalculateSchedule();
  renderAll();
}

function handleQuarterSelectChange(val) {
  if (!isHeadCoach()) return;
  const customInput = document.getElementById('customQuarterMinsInput');
  if (val === 'custom') {
    customInput.value = state.quarterMins;
    customInput.classList.remove('hidden');
    customInput.focus();
  } else {
    customInput.classList.add('hidden');
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && parsed > 0) {
      state.quarterMins = parsed;
      resetTimer(false);
      recalculateSchedule();
      renderAll();
    }
  }
}

function handleCustomQuarterInput(val) {
  if (!isHeadCoach()) return;
  const parsed = parseFloat(val);
  if (!isNaN(parsed) && parsed >= 1 && parsed <= 60) {
    state.quarterMins = Math.round(parsed * 100) / 100;
    resetTimer(false);
    recalculateSchedule();
    renderAll();
  }
}

function handleTimingChange() {
  if (!isHeadCoach()) return;
  const rawMode = document.getElementById('shiftsPerQtrSelect').value;
  const newShiftsPerQtr = rawMode === '1' ? 1 : 2;
  const newMidQtrPosSwap = rawMode === '2_swap';
  const oldShiftsPerQtr = state.shiftsPerQuarter;

  const preservedLocks = {};
  for (let q = 1; q <= 4; q++) {
    const oldFirstIdx = oldShiftsPerQtr === 2 ? (q - 1) * 2 : (q - 1);
    const newFirstIdx = newShiftsPerQtr === 2 ? (q - 1) * 2 : (q - 1);
    const sourceShift = state.lockedShifts[oldFirstIdx] || state.computedShifts[oldFirstIdx];
    if (sourceShift) {
      preservedLocks[newFirstIdx] = {
        benchIds: [...(sourceShift.benchIds || [])],
        positions: { ...(sourceShift.positions || {}) }
      };
    }
  }
  state.lockedShifts = preservedLocks;

  if (newMidQtrPosSwap) {
    state.fullQuarterLocks = { 1: false, 2: false, 3: false, 4: false };
  }

  state.shiftsPerQuarter = newShiftsPerQtr;
  state.midQtrPosSwap = newMidQtrPosSwap;
  timer.activeAlertShiftIdx = null;
  timer.dismissedShiftIndices = [];
  resetTimer(false);
  recalculateSchedule();
  renderAll();
}

function toggleFullQuarter(q) {
  if (!canEditGame()) return;
  state.fullQuarterLocks[q] = !state.fullQuarterLocks[q];
  if (state.shiftsPerQuarter === 2) {
    const firstIdx = (q - 1) * 2;
    const firstShift = state.computedShifts[firstIdx];
    if (firstShift && !state.lockedShifts[firstIdx]) {
      state.lockedShifts[firstIdx] = {
        benchIds: [...firstShift.benchIds],
        positions: { ...firstShift.positions }
      };
    }
  }
  recalculateSchedule();
  renderAll();
}

function adjustPrior(playerId, zone, delta) {
  if (!isHeadCoach()) return;
  const p = state.players.find(x => x.id === playerId);
  if (p) {
    p.prior[zone] = Math.max(0, Math.round(((p.prior[zone] || 0) + delta) * 100) / 100);
    if (zone === 'BENCH') {
      p.prior.manualBenchOverride = true;
    }
    recalculateSchedule();
    renderAll();
  }
}

function resetSeasonHistory() {
  if (!isHeadCoach()) return;
  state.players.forEach(p => {
    p.prior = {
      BENCH: 0, FWD: 0, MID: 0, DEF: 0, GK: 0,
      gamesPlayed: 0, goals: 0, assists: 0,
      manualBenchOverride: false
    };
  });
  state.lockedShifts = {};
  recalculateSchedule();
  renderAll();
}

function clearAllLocks() {
  if (!canEditGame()) return;
  state.lockedShifts = {};
  state.fullQuarterLocks = { 1: false, 2: false, 3: false, 4: false };
  timer.activeAlertShiftIdx = null;
  timer.dismissedShiftIndices = [];
  recalculateSchedule();
  renderAll();
}

function toggleFeedbackEmbed() {
  const container = document.getElementById('feedbackEmbedContainer');
  const iframe = document.getElementById('feedbackIframe');
  const btn = document.getElementById('toggleFeedbackEmbedBtn');

  const isHidden = container.classList.contains('hidden');
  if (isHidden) {
    if (!iframe.getAttribute('src')) {
      iframe.setAttribute('src', iframe.getAttribute('data-src'));
    }
    container.classList.remove('hidden');
    btn.textContent = '✕ Hide Inline Form';
  } else {
    container.classList.add('hidden');
    btn.textContent = '📝 Fill Out Inline';
  }
}

// ============================================================================
// EXPOSE HANDLERS TO GLOBAL WINDOW FOR INLINE HTML ONCLICK BINDINGS
// ============================================================================
Object.assign(window, {
  triggerPwaInstall,
  openCoachAuthModal,
  closeCoachAuthModal,
  handleGoogleCoachLogin,
  handleEmailCoachAuth,
  handleCoachSignOut,
  selectParentIdentity,
  clearParentIdentity,
  submitParentRsvp,
  openInviteModal,
  closeInviteModal,
  shareRoleLink,
  handleTeamSelectChange,
  createNewTeamPrompt,
  deleteCurrentTeam,
  togglePositionMode,
  toggleDrawer,
  switchMainTab,
  updateTeamName,
  handleFormationChange,
  handleQuarterSelectChange,
  handleCustomQuarterInput,
  handleTimingChange,
  setAlertSoundMode,
  cycleAlertSoundMode,
  playAlertSignal,
  adjustSlot,
  resetSeasonHistory,
  addPlayer,
  addPlayerFromOnboarding,
  updatePlayerNumber,
  updatePlayerName,
  removePlayer,
  adjustPrior,
  updateOpponentName,
  openGoalModal,
  closeGoalModal,
  selectGoalScorer,
  selectGoalAssist,
  confirmGoalLog,
  removeGoal,
  adjustOpponentScore,
  selectViewedQuarter,
  activateViewedQuarterClock,
  toggleTimer,
  adjustTimer,
  syncMidQuarter,
  resetTimer,
  dismissActiveSubAlert,
  activateQueuedAlertNow,
  setRosterSort,
  setAllAttendance,
  rotateStarterOrder,
  togglePlayerPresence,
  toggleFullQuarter,
  toggleBalanceSort,
  toggleStatsSort,
  openEditModal,
  closeEditModal,
  rollRandomModalGoalie,
  toggleModalBench,
  setModalPlayerPos,
  saveModalShift,
  unlockCurrentModalShift,
  setSmsStyle,
  copySingleBubble,
  copyAllSms,
  clearAllLocks,
  finishAndSaveGame,
  openGameDetailModal,
  closeGameDetailModal,
  adjustHistDraftScore,
  updateHistGoalField,
  addHistDraftGoal,
  removeHistDraftGoal,
  toggleHistPlayerPresent,
  updateHistPlayerStat,
  saveGameDetailEdits,
  deleteCurrentModalHistoryGame,
  toggleFeedbackEmbed
});

window.addEventListener('DOMContentLoaded', loadState);
