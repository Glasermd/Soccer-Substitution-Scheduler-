// ============================================================================
// app.js — UI Renderers, Modals, Event Controllers & PWA Lifecycle
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
  computeEffectivePriorBenchMap,
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

// ============================================================================
// LOCAL UI & MODAL DRAFT STATE
// ============================================================================
let currentMainTab = 'game';
let viewedShiftPartOverride = null; // Allows inspecting Part 1 or Part 2 when previewing a quarter
let deferredPwaPrompt = null;

// Goal Modal Draft
let goalDraft = {
  scorerId: null,
  assistId: null
};

// Shift Override Modal Draft
let modalDraft = {
  shiftIndex: null,
  benchIds: [],
  positions: {}
};

// Past Game History Detail Modal Draft
let histModalDraft = null;

// Parent Identity LocalStorage Helper
function getParentStorageKey() {
  return `sideline_pro_parent_player_${state.id}`;
}

// ============================================================================
// INITIALIZATION & STORAGE BOOTSTRAP
// ============================================================================
function loadFromLocalStorage() {
  try {
    const rawMulti = localStorage.getItem(MULTI_TEAM_STORAGE_KEY);
    if (rawMulti) {
      const parsed = JSON.parse(rawMulti);
      if (parsed && Array.isArray(parsed.teams) && parsed.teams.length > 0) {
        appStore.teams = parsed.teams.map(t => normalizeTeamObject(t));
        appStore.activeTeamId = parsed.activeTeamId || appStore.teams[0].id;
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
    console.warn('Error loading local state:', e);
  }

  // If opened via a shared ?team= link, ensure that team slot exists locally
  if (sharedTeamIdParam) {
    let sharedTeam = appStore.teams.find(t => t.id === sharedTeamIdParam);
    if (!sharedTeam) {
      sharedTeam = createBlankTeam('Shared Team');
      sharedTeam.id = sharedTeamIdParam;
      appStore.teams.push(sharedTeam);
    }
    appStore.activeTeamId = sharedTeamIdParam;
  }

  syncActiveTeamPointer();
  applyCloudTimerState();
  recalculateSchedule(false);
}

// ============================================================================
// MASTER RENDER PIPELINE
// ============================================================================
export function renderAll() {
  renderRolePermissionsUI();
  renderHeaderAndSettings();
  renderOnboardingCard();
  renderParentRsvpCard();
  renderScoreboard();
  renderTimerUI();
  renderStagedAlertsUI();
  renderLiveInPlayPanel();
  renderAttendance();
  renderScheduleGrid();
  renderBalanceTable();
  renderSmsBubbles();
  renderStatsAndHistoryTab();
}

// ============================================================================
// 1. ROLE PERMISSIONS & TOP BANNER
// ============================================================================
function renderRolePermissionsUI() {
  const banner = document.getElementById('roleBanner');
  const setupGearBtn = document.getElementById('setupGearBtn');
  const teamSelect = document.getElementById('headerTeamSelect');
  const staticTeamName = document.getElementById('headerStaticTeamName');
  const smsCard = document.getElementById('smsSectionCard');
  const completeCard = document.getElementById('completeGameSectionCard');

  if (banner) {
    if (appRole === 'assistant') {
      banner.className = 'px-4 py-2 text-xs font-bold text-center border-b bg-amber-500/20 border-amber-500/40 text-amber-200';
      banner.innerHTML = `🧢 <strong>Assistant Coach Mode:</strong> Live score, clock, attendance, and rotation edits sync in real time with the Head Coach.`;
      banner.classList.remove('hidden');
    } else if (appRole === 'viewer') {
      banner.className = 'px-4 py-2 text-xs font-bold text-center border-b bg-sky-500/20 border-sky-500/40 text-sky-200';
      banner.innerHTML = `👀 <strong>Parent Live Viewer:</strong> Watch real-time scores, clock, and rotations below, and check in your player above.`;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  if (setupGearBtn) {
    setupGearBtn.classList.toggle('hidden', !isHeadCoach());
  }

  if (teamSelect && staticTeamName) {
    if (isHeadCoach() && !sharedTeamIdParam) {
      teamSelect.classList.remove('hidden');
      staticTeamName.classList.add('hidden');
    } else {
      teamSelect.classList.add('hidden');
      staticTeamName.classList.remove('hidden');
      staticTeamName.textContent = state.teamName || 'My Team';
    }
  }

  const editable = canEditGame();
  if (smsCard) smsCard.classList.toggle('hidden', !editable);
  if (completeCard) completeCard.classList.toggle('hidden', !editable);
}

// ============================================================================
// 2. HEADER, SETTINGS DRAWER & ROSTER LIST
// ============================================================================
function renderHeaderAndSettings() {
  renderCoachAuthButton();

  // Team Dropdown
  const selectEl = document.getElementById('headerTeamSelect');
  if (selectEl) {
    selectEl.innerHTML = appStore.teams.map(t =>
      `<option value="${escapeHtml(t.id)}" ${t.id === state.id ? 'selected' : ''}>${escapeHtml(t.teamName || 'Untitled Team')}</option>`
    ).join('');
  }

  // Format Summary Label
  const fmtPreset = FORMATION_PRESETS[state.formationKey];
  const fmtName = fmtPreset ? fmtPreset.label : `${getTotalFieldSlots()}v${getTotalFieldSlots()}`;
  const fmtSummaryEl = document.getElementById('formatSummaryLabel');
  if (fmtSummaryEl) {
    const swapTag = (state.shiftsPerQuarter === 2 && state.midQtrPosSwap) ? ' • Mid-Swap' : '';
    fmtSummaryEl.textContent = `${fmtName} • ${fmtDurationLabel(state.quarterMins)} Qtrs${swapTag}`;
  }

  // Position Toggle Button
  const posBtn = document.getElementById('posToggleBtn');
  if (posBtn) {
    if (state.trackPositions) {
      posBtn.className = 'px-2.5 py-1 rounded-lg text-xs font-semibold border transition flex items-center gap-1 bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
      posBtn.innerHTML = '<span>📍 Pos: ON</span>';
    } else {
      posBtn.className = 'px-2.5 py-1 rounded-lg text-xs font-semibold border transition flex items-center gap-1 bg-slate-800 text-slate-400 border-slate-700';
      posBtn.innerHTML = '<span>📍 Pos: OFF</span>';
    }
    posBtn.disabled = !canEditGame();
  }

  // Main Tabs
  const tabGame = document.getElementById('tabBtnGame');
  const tabStats = document.getElementById('tabBtnStats');
  const viewGame = document.getElementById('viewGame');
  const viewStats = document.getElementById('viewStats');

  if (tabGame && tabStats && viewGame && viewStats) {
    if (currentMainTab === 'game') {
      tabGame.className = 'py-1.5 rounded-lg text-xs font-extrabold transition bg-emerald-500 text-slate-950 shadow';
      tabStats.className = 'py-1.5 rounded-lg text-xs font-bold transition text-slate-400 hover:text-white';
      viewGame.classList.remove('hidden');
      viewStats.classList.add('hidden');
    } else {
      tabStats.className = 'py-1.5 rounded-lg text-xs font-extrabold transition bg-emerald-500 text-slate-950 shadow';
      tabGame.className = 'py-1.5 rounded-lg text-xs font-bold transition text-slate-400 hover:text-white';
      viewStats.classList.remove('hidden');
      viewGame.classList.add('hidden');
    }
  }

  // Settings Drawer Inputs
  const teamNameInput = document.getElementById('teamNameInput');
  if (teamNameInput && document.activeElement !== teamNameInput) {
    teamNameInput.value = state.teamName || '';
  }

  const formationSelect = document.getElementById('formationPresetSelect');
  if (formationSelect) {
    formationSelect.value = state.formationKey || '5v5_212';
  }

  const qSelect = document.getElementById('quarterMinsSelect');
  const customQInput = document.getElementById('customQuarterMinsInput');
  if (qSelect && customQInput) {
    const qVal = Number(state.quarterMins) || 8;
    if (PRESET_QUARTER_VALUES.includes(qVal)) {
      qSelect.value = String(qVal);
      customQInput.classList.add('hidden');
    } else {
      qSelect.value = 'custom';
      customQInput.classList.remove('hidden');
      if (document.activeElement !== customQInput) {
        customQInput.value = qVal;
      }
    }
  }

  const shiftsSelect = document.getElementById('shiftsPerQtrSelect');
  if (shiftsSelect) {
    if (state.shiftsPerQuarter === 1) {
      shiftsSelect.value = '1';
    } else if (state.midQtrPosSwap) {
      shiftsSelect.value = '2_swap';
    } else {
      shiftsSelect.value = '2';
    }
  }

  const soundSelect = document.getElementById('setupAlertSoundSelect');
  if (soundSelect) {
    soundSelect.value = state.alertSoundMode || 'chime';
  }

  const deleteTeamBtn = document.getElementById('deleteTeamBtn');
  if (deleteTeamBtn) {
    deleteTeamBtn.classList.toggle('hidden', appStore.teams.length <= 1);
  }

  // Slot Counts
  const totalSlotsEl = document.getElementById('totalFieldSlotsLabel');
  if (totalSlotsEl) totalSlotsEl.textContent = getTotalFieldSlots();
  ['FWD', 'MID', 'DEF', 'GK'].forEach(zone => {
    const el = document.getElementById(`slotCount${zone}`);
    if (el) el.textContent = state.slots[zone] || 0;
  });

  // Roster History List in Settings Drawer
  const rosterListEl = document.getElementById('rosterHistoryList');
  if (rosterListEl) {
    if (state.players.length === 0) {
      rosterListEl.innerHTML = `<div class="text-xs text-slate-500 italic py-2 text-center">No players added yet. Add players above to build your lineup.</div>`;
    } else {
      rosterListEl.innerHTML = state.players.map(p => `
        <div class="flex items-center gap-1.5 bg-slate-950/90 border border-slate-800 rounded-xl p-2 text-xs">
          <input type="text" value="${escapeHtml(p.number || '')}" placeholder="#" maxlength="3"
            onchange="updatePlayerNumber('${p.id}', this.value)"
            class="w-11 bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1 text-center font-bold text-white focus:outline-none focus:border-emerald-500" />
          <input type="text" value="${escapeHtml(p.name)}" placeholder="Player Name"
            onchange="updatePlayerName('${p.id}', this.value)"
            class="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 font-semibold text-white focus:outline-none focus:border-emerald-500" />
          <div class="flex items-center gap-1 shrink-0" title="Prior Season Bench Quarters">
            <span class="text-[10px] text-slate-400">Prior🪑:</span>
            <input type="number" step="0.5" min="0" value="${fmtNum(p.prior.BENCH || 0)}"
              onchange="updatePlayerPriorBench('${p.id}', this.value)"
              class="w-14 bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1 text-center mono font-bold text-slate-200 focus:outline-none focus:border-emerald-500" />
          </div>
          <button onclick="removePlayer('${p.id}')"
            class="px-2 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 font-bold text-xs shrink-0"
            title="Remove Player">
            ✕
          </button>
        </div>
      `).join('');
    }
  }
}

function renderOnboardingCard() {
  const card = document.getElementById('onboardingCard');
  if (!card) return;

  if (isHeadCoach() && state.players.length === 0) {
    card.classList.remove('hidden');
    const nameInp = document.getElementById('onboardTeamNameInput');
    if (nameInp && document.activeElement !== nameInp) {
      nameInp.value = state.teamName || '';
    }
    const fmtSel = document.getElementById('onboardFormatSelect');
    if (fmtSel) {
      fmtSel.value = state.formationKey || '5v5_212';
    }
  } else {
    card.classList.add('hidden');
  }
}

// ============================================================================
// 3. PARENT 1-TAP CHECK-IN & RSVP CARD
// ============================================================================
function renderParentRsvpCard() {
  const card = document.getElementById('parentRsvpCard');
  if (!card) return;

  if (appRole !== 'viewer' || state.players.length === 0) {
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');

  const savedPlayerId = localStorage.getItem(getParentStorageKey());
  const selectedPlayer = state.players.find(p => p.id === savedPlayerId) || null;

  const subtext = document.getElementById('parentRsvpSubtext');
  const switchBtn = document.getElementById('switchParentPlayerBtn');
  const pickerEl = document.getElementById('parentPlayerPicker');
  const actionsEl = document.getElementById('parentRsvpActions');

  if (!selectedPlayer) {
    if (subtext) {
      subtext.textContent = "Tap your child's name once so your phone remembers them, then mark their status for this game.";
    }
    if (switchBtn) switchBtn.classList.add('hidden');
    if (actionsEl) actionsEl.classList.add('hidden');

    if (pickerEl) {
      pickerEl.classList.remove('hidden');
      const sorted = [...state.players].sort(comparePlayerNumbers);
      pickerEl.innerHTML = sorted.map(p => `
        <button onclick="selectParentIdentity('${p.id}')"
          class="px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-sky-500/20 border border-slate-700 hover:border-sky-400 text-xs font-bold text-white transition">
          ${escapeHtml(formatPlayerBadge(p))}
        </button>
      `).join('');
    }
  } else {
    if (subtext) {
      const statusLabel = selectedPlayer.rsvp === 'going'
        ? '✅ Going (Checked In)'
        : selectedPlayer.rsvp === 'late'
        ? '⏳ Running Late (Held from 1st Shift)'
        : selectedPlayer.rsvp === 'out'
        ? '❌ Out Today'
        : (selectedPlayer.present ? '✅ In Lineup' : '❌ Marked Out');
      subtext.innerHTML = `Checking in for <strong class="text-white">${escapeHtml(formatPlayerBadge(selectedPlayer))}</strong> • Current Status: <span class="text-sky-300 font-bold">${statusLabel}</span>`;
    }
    if (switchBtn) switchBtn.classList.remove('hidden');
    if (pickerEl) pickerEl.classList.add('hidden');
    if (actionsEl) actionsEl.classList.remove('hidden');

    const btnGoing = document.getElementById('rsvpBtnGoing');
    const btnLate = document.getElementById('rsvpBtnLate');
    const btnOut = document.getElementById('rsvpBtnOut');

    const activeRsvp = selectedPlayer.rsvp || (selectedPlayer.present ? 'going' : 'out');
    if (btnGoing) {
      btnGoing.className = activeRsvp === 'going'
        ? 'py-2.5 px-2 rounded-xl text-xs font-extrabold border-2 transition flex flex-col items-center gap-0.5 bg-emerald-500/25 border-emerald-400 text-emerald-200 shadow'
        : 'py-2.5 px-2 rounded-xl text-xs font-extrabold border transition flex flex-col items-center gap-0.5 bg-slate-950 border-slate-800 text-slate-300 hover:border-emerald-500/50';
    }
    if (btnLate) {
      btnLate.className = activeRsvp === 'late'
        ? 'py-2.5 px-2 rounded-xl text-xs font-extrabold border-2 transition flex flex-col items-center gap-0.5 bg-amber-500/25 border-amber-400 text-amber-200 shadow'
        : 'py-2.5 px-2 rounded-xl text-xs font-extrabold border transition flex flex-col items-center gap-0.5 bg-slate-950 border-slate-800 text-slate-300 hover:border-amber-500/50';
    }
    if (btnOut) {
      btnOut.className = activeRsvp === 'out'
        ? 'py-2.5 px-2 rounded-xl text-xs font-extrabold border-2 transition flex flex-col items-center gap-0.5 bg-rose-500/25 border-rose-400 text-rose-200 shadow'
        : 'py-2.5 px-2 rounded-xl text-xs font-extrabold border transition flex flex-col items-center gap-0.5 bg-slate-950 border-slate-800 text-slate-300 hover:border-rose-500/50';
    }
  }
}

// ============================================================================
// 4. SCOREBOARD & GOAL LOG
// ============================================================================
function renderScoreboard() {
  const editable = canEditGame();
  const oppInput = document.getElementById('opponentNameInput');
  if (oppInput) {
    if (document.activeElement !== oppInput) {
      oppInput.value = state.currentMatch.opponent || 'Opponent';
    }
    oppInput.disabled = !editable;
  }

  const teamLbl = document.getElementById('scoreTeamLabel');
  if (teamLbl) teamLbl.textContent = state.teamName || 'My Team';

  const oppLbl = document.getElementById('scoreOpponentLabel');
  if (oppLbl) oppLbl.textContent = state.currentMatch.opponent || 'Opponent';

  const ourScoreEl = document.getElementById('ourScoreDisplay');
  if (ourScoreEl) ourScoreEl.textContent = state.currentMatch.ourScore || 0;

  const oppScoreEl = document.getElementById('oppScoreDisplay');
  if (oppScoreEl) oppScoreEl.textContent = state.currentMatch.oppScore || 0;

  const addGoalBtn = document.getElementById('addOurGoalBtn');
  if (addGoalBtn) addGoalBtn.classList.toggle('hidden', !editable);

  const oppControls = document.getElementById('oppScoreControls');
  if (oppControls) oppControls.classList.toggle('hidden', !editable);

  const goalsContainer = document.getElementById('currentGameGoalsContainer');
  const goalsList = document.getElementById('currentGameGoalsList');
  const goals = state.currentMatch.goals || [];

  if (goalsContainer && goalsList) {
    if (goals.length === 0) {
      goalsContainer.classList.add('hidden');
    } else {
      goalsContainer.classList.remove('hidden');
      goalsList.innerHTML = goals.map(g => {
        const scorerText = escapeHtml(g.scorerLabel || getPlayerDisplayById(g.scorerId));
        const assistText = g.assistId
          ? ` <span class="text-slate-400">• Assist: ${escapeHtml(g.assistLabel || getPlayerDisplayById(g.assistId))}</span>`
          : '';
        return `
          <div class="flex items-center justify-between bg-slate-950/80 border border-slate-800/90 rounded-xl px-2.5 py-1.5 text-xs">
            <div class="truncate">
              <span class="mono font-bold text-emerald-400 mr-1.5">Q${g.quarter} ${escapeHtml(g.clock || '')}</span>
              <span class="font-bold text-white">⚽ ${scorerText}</span>
              ${assistText}
            </div>
            ${editable ? `
              <button onclick="deleteMatchGoal('${g.id}')" class="text-slate-500 hover:text-rose-400 px-1.5 font-bold" title="Remove Goal">✕</button>
            ` : ''}
          </div>
        `;
      }).join('');
    }
  }
}

// ============================================================================
// 5. SIDELINE TIMER & BACKGROUND CLOCK PERSISTENCE UI
// ============================================================================
function formatClockMMSS(sec) {
  const s = Math.max(0, Math.floor(sec));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

function renderTimerUI() {
  const editable = canEditGame();
  const viewedQ = timer.viewedQuarter || timer.quarter;
  const activeQ = timer.quarter;
  const fullSec = getQuarterTotalSeconds(state.quarterMins);
  const midSec = getQuarterMidSeconds(state.quarterMins);

  // Quarter Selector Tabs (Q1 - Q4)
  for (let q = 1; q <= 4; q++) {
    const btn = document.getElementById(`qTab${q}`);
    if (!btn) continue;

    const isViewed = q === viewedQ;
    const isClockQ = q === activeQ;
    const isClockActiveOrMid = timer.running || (timer.secondsLeft < fullSec && timer.secondsLeft > 0);

    let label = `Q${q}`;
    if (isClockQ && isClockActiveOrMid) {
      label = `🟢 Q${q}`;
    }

    btn.textContent = label;
    if (isViewed && isClockQ) {
      btn.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold bg-emerald-500 text-slate-950 shadow';
    } else if (isViewed && !isClockQ) {
      btn.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold bg-sky-500 text-slate-950 shadow';
    } else if (isClockQ && isClockActiveOrMid) {
      btn.className = 'px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
    } else {
      btn.className = 'px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-800 text-slate-400 hover:text-white';
    }
  }

  // Background Clock Persistence Notice Banner
  const bgNotice = document.getElementById('bgClockNotice');
  const bgNoticeText = document.getElementById('bgClockNoticeText');
  const activateBtn = document.getElementById('activateViewedQtrBtn');
  if (bgNotice && bgNoticeText) {
    if (viewedQ !== activeQ) {
      bgNotice.classList.remove('hidden');
      const statusStr = timer.running ? 'running' : 'paused';
      bgNoticeText.innerHTML = `👀 Previewing <strong>Q${viewedQ}</strong> while <strong>Q${activeQ}</strong> clock (${formatClockMMSS(timer.secondsLeft)}) is ${statusStr}`;
      if (activateBtn) {
        activateBtn.classList.toggle('hidden', !editable);
      }
    } else {
      bgNotice.classList.add('hidden');
    }
  }

  // Active Shift Badge on Timer Card
  const shiftBadge = document.getElementById('timerShiftBadge');
  if (shiftBadge) {
    const fullSub = isQuarterFullSub(activeQ);
    const activePart = (fullSub || timer.secondsLeft > midSec) ? 1 : 2;
    if (fullSub) {
      shiftBadge.textContent = `Q${activeQ} • Full Quarter`;
      shiftBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30';
    } else if (activePart === 1) {
      shiftBadge.textContent = `Q${activeQ} • 1st Shift`;
      shiftBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30';
    } else {
      shiftBadge.textContent = `Q${activeQ} • 2nd Shift`;
      shiftBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40';
    }
  }

  // Clock Digital Readout
  const displayEl = document.getElementById('timerDisplay');
  if (displayEl) {
    displayEl.textContent = formatClockMMSS(timer.secondsLeft);
    if (timer.running) {
      displayEl.className = 'mono text-5xl font-extrabold tracking-tight text-emerald-400';
    } else if (timer.secondsLeft <= 0) {
      displayEl.className = 'mono text-5xl font-extrabold tracking-tight text-amber-400';
    } else {
      displayEl.className = 'mono text-5xl font-extrabold tracking-tight text-white';
    }
  }

  // Sound Mode Selector Button
  const soundBtn = document.getElementById('soundModeBtn');
  if (soundBtn) {
    const modeObj = ALERT_SOUND_MODES.find(m => m.key === (state.alertSoundMode || 'chime')) || ALERT_SOUND_MODES[0];
    soundBtn.textContent = modeObj.shortLabel;
  }

  // Timer Action Controls
  const actionButtons = document.getElementById('timerActionButtons');
  const soundGroup = document.getElementById('soundControlsGroup');
  if (actionButtons) actionButtons.classList.toggle('hidden', !editable);
  if (soundGroup) soundGroup.classList.toggle('hidden', !editable);

  const startBtn = document.getElementById('timerStartBtn');
  if (startBtn) {
    if (timer.running) {
      startBtn.textContent = '⏸ Pause';
      startBtn.className = 'px-5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-sm transition shadow-lg shadow-amber-400/20';
    } else if (viewedQ !== activeQ) {
      startBtn.textContent = `▶ Start Q${viewedQ}`;
      startBtn.className = 'px-5 py-2.5 rounded-xl bg-sky-400 hover:bg-sky-300 text-slate-950 font-extrabold text-sm transition shadow-lg shadow-sky-400/20';
    } else {
      startBtn.textContent = timer.secondsLeft < fullSec && timer.secondsLeft > 0 ? '▶ Resume' : '▶ Start';
      startBtn.className = 'px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-sm transition shadow-lg shadow-emerald-500/20';
    }
  }

  const syncMidBtn = document.getElementById('syncMidBtn');
  if (syncMidBtn) {
    syncMidBtn.classList.toggle('hidden', isQuarterFullSub(activeQ));
  }

  // Progress Bars
  const splitBar = document.getElementById('timerProgressSplit');
  const singleBar = document.getElementById('timerProgressSingle');
  const pHalf1 = document.getElementById('progressHalf1');
  const pHalf2 = document.getElementById('progressHalf2');
  const pFull = document.getElementById('progressFullBar');

  if (isQuarterFullSub(activeQ)) {
    if (splitBar) splitBar.classList.add('hidden');
    if (singleBar) singleBar.classList.remove('hidden');
    if (pFull) {
      const pct = Math.max(0, Math.min(100, (timer.secondsLeft / fullSec) * 100));
      pFull.style.width = `${pct}%`;
    }
  } else {
    if (splitBar) splitBar.classList.remove('hidden');
    if (singleBar) singleBar.classList.add('hidden');
    const firstHalfDuration = fullSec - midSec;
    if (timer.secondsLeft > midSec) {
      const remInFirst = timer.secondsLeft - midSec;
      const pct1 = Math.max(0, Math.min(100, (remInFirst / firstHalfDuration) * 100));
      if (pHalf1) pHalf1.style.width = `${pct1}%`;
      if (pHalf2) pHalf2.style.width = '100%';
    } else {
      if (pHalf1) pHalf1.style.width = '0%';
      const pct2 = Math.max(0, Math.min(100, (timer.secondsLeft / midSec) * 100));
      if (pHalf2) pHalf2.style.width = `${pct2}%`;
    }
  }
}

// ============================================================================
// 6. STAGED SUBSTITUTION ALERTS (ACTIVE BANNER ABOVE + QUEUED CARD BELOW)
// ============================================================================
function computeShiftDiffSummary(targetShift) {
  if (!targetShift) return { comingIn: [], goingOut: [], posSwaps: [], benchList: [] };

  const presentPlayers = state.players.filter(p => p.present);
  const prevShift = targetShift.index > 0 ? state.computedShifts[targetShift.index - 1] : null;
  const benchList = presentPlayers.filter(p => targetShift.benchIds.includes(p.id));

  if (!prevShift) {
    return {
      comingIn: [],
      goingOut: [],
      posSwaps: [],
      benchList
    };
  }

  const comingIn = presentPlayers.filter(
    p => prevShift.benchIds.includes(p.id) && !targetShift.benchIds.includes(p.id)
  );
  const goingOut = presentPlayers.filter(
    p => !prevShift.benchIds.includes(p.id) && targetShift.benchIds.includes(p.id)
  );
  const posSwaps = presentPlayers.filter(p => {
    if (prevShift.benchIds.includes(p.id) || targetShift.benchIds.includes(p.id)) return false;
    return state.trackPositions && prevShift.positions[p.id] && targetShift.positions[p.id] && prevShift.positions[p.id] !== targetShift.positions[p.id];
  });

  return { comingIn, goingOut, posSwaps, benchList };
}

function getShiftHeadingLabel(shift) {
  if (!shift) return '';
  if (state.shiftsPerQuarter === 1 || state.fullQuarterLocks[shift.quarter]) {
    return `Q${shift.quarter} • Start of Quarter`;
  }
  return shift.part === 1
    ? `Q${shift.quarter} • 1st Shift (Start of Q${shift.quarter})`
    : `Q${shift.quarter} • 2nd Shift (Mid-Quarter ${fmtDurationLabel(state.quarterMins / 2)})`;
}

function renderStagedAlertsUI() {
  const activeBanner = document.getElementById('subAlertBanner');
  const activeTitle = document.getElementById('subAlertTitle');
  const activeContent = document.getElementById('subAlertContent');
  const queuedCard = document.getElementById('queuedSubCard');

  const presentPlayers = state.players.filter(p => p.present);
  if (presentPlayers.length === 0 || !state.computedShifts.length) {
    if (activeBanner) activeBanner.classList.add('hidden');
    if (queuedCard) {
      queuedCard.innerHTML = `<div class="text-xs text-slate-400 text-center py-1">Add present players to view upcoming rotation changes.</div>`;
    }
    return;
  }

  // 1. TOP ACTIVE SUBSTITUTION BANNER
  if (activeBanner && activeTitle && activeContent) {
    const activeShift = typeof timer.activeAlertShiftIdx === 'number'
      ? state.computedShifts[timer.activeAlertShiftIdx]
      : null;

    if (!activeShift) {
      activeBanner.classList.add('hidden');
    } else {
      activeBanner.classList.remove('hidden');
      activeTitle.textContent = `🔔 Active Change Now: ${getShiftHeadingLabel(activeShift)}`;
      const diff = computeShiftDiffSummary(activeShift);

      const lines = [];
      if (diff.comingIn.length > 0) {
        const inBadges = diff.comingIn.map(p => {
          const pos = state.trackPositions ? ` (${activeShift.positions[p.id] || 'MID'})` : '';
          return `<span class="inline-block px-2 py-0.5 rounded-md bg-emerald-500/25 border border-emerald-400/50 text-emerald-200 font-bold mr-1 mb-1">🟢 IN: ${escapeHtml(formatPlayerBadge(p))}${pos}</span>`;
        }).join('');
        lines.push(`<div>${inBadges}</div>`);
      }
      if (diff.goingOut.length > 0) {
        const outBadges = diff.goingOut.map(p =>
          `<span class="inline-block px-2 py-0.5 rounded-md bg-rose-500/25 border border-rose-400/50 text-rose-200 font-bold mr-1 mb-1">🪑 OFF TO BENCH: ${escapeHtml(formatPlayerBadge(p))}</span>`
        ).join('');
        lines.push(`<div>${outBadges}</div>`);
      }
      if (diff.posSwaps.length > 0) {
        const prevShift = state.computedShifts[activeShift.index - 1];
        const swapBadges = diff.posSwaps.map(p =>
          `<span class="inline-block px-2 py-0.5 rounded-md bg-sky-500/25 border border-sky-400/50 text-sky-200 font-semibold mr-1 mb-1">🔄 ${escapeHtml(formatPlayerBadge(p))}: ${prevShift.positions[p.id]} → ${activeShift.positions[p.id]}</span>`
        ).join('');
        lines.push(`<div>${swapBadges}</div>`);
      }
      if (lines.length === 0) {
        const benchNames = diff.benchList.map(p => escapeHtml(formatPlayerBadge(p))).join(', ') || 'None';
        lines.push(`<div class="text-amber-200 font-semibold">Lineup continues • Sitting on Bench: ${benchNames}</div>`);
      }
      activeContent.innerHTML = lines.join('');
    }
  }

  // 2. BOTTOM QUEUED NEXT CHANGE CARD
  if (queuedCard) {
    const nextShift = getNextQueuedShiftObject();
    if (!nextShift) {
      queuedCard.innerHTML = `
        <div class="flex items-center justify-between text-xs text-slate-400">
          <span class="font-bold text-slate-300">⏭️ Next Queued Rotation</span>
          <span class="text-emerald-400 font-semibold">All scheduled shifts triggered</span>
        </div>
      `;
      return;
    }

    const diff = computeShiftDiffSummary(nextShift);
    const editable = canEditGame();

    const inStr = diff.comingIn.length > 0
      ? diff.comingIn.map(p => {
          const pos = state.trackPositions ? ` (${nextShift.positions[p.id] || 'MID'})` : '';
          return `<span class="text-emerald-300 font-bold">${escapeHtml(formatPlayerBadge(p))}${pos}</span>`;
        }).join(', ')
      : '<span class="text-slate-400">No bench sub (same on-field players)</span>';

    const outStr = diff.goingOut.length > 0
      ? diff.goingOut.map(p => `<span class="text-rose-300 font-semibold">${escapeHtml(formatPlayerBadge(p))}</span>`).join(', ')
      : '<span class="text-slate-400">None</span>';

    let swapHtml = '';
    if (diff.posSwaps.length > 0) {
      const prevShift = state.computedShifts[nextShift.index - 1];
      const sList = diff.posSwaps.map(p =>
        `<span class="text-sky-300 font-semibold">${escapeHtml(formatPlayerBadge(p))} (${prevShift.positions[p.id]}→${nextShift.positions[p.id]})</span>`
      ).join(', ');
      swapHtml = `<div class="text-[11px] text-slate-300"><span class="text-slate-400 font-semibold">🔄 Pos Swaps:</span> ${sList}</div>`;
    }

    queuedCard.innerHTML = `
      <div class="flex items-center justify-between gap-2 border-b border-slate-800 pb-2 mb-2">
        <div>
          <span class="text-[11px] font-extrabold uppercase tracking-wider text-indigo-300">
            ⏭️ Queued Next: ${getShiftHeadingLabel(nextShift)}
          </span>
        </div>
        <div class="flex items-center gap-1.5">
          ${editable ? `
            <button onclick="openEditModal(${nextShift.index})"
              class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[11px] font-semibold">
              ✏️ Edit
            </button>
            <button onclick="activateQueuedSubNow(${nextShift.index})"
              class="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 text-[11px] font-bold">
              🔔 Alert Now
            </button>
          ` : ''}
        </div>
      </div>
      <div class="space-y-1 text-xs">
        <div><span class="text-slate-400 font-semibold">🟢 Ready to Sub IN:</span> ${inStr}</div>
        <div><span class="text-slate-400 font-semibold">🪑 Coming OFF to Bench:</span> ${outStr}</div>
        ${swapHtml}
      </div>
    `;
  }
}

// ============================================================================
// 7. CURRENTLY IN-PLAY LINEUP & POSITIONS PANEL
// ============================================================================
function renderLiveInPlayPanel() {
  const container = document.getElementById('liveInPlayContainer');
  if (!container) return;

  const presentPlayers = state.players.filter(p => p.present);
  if (presentPlayers.length === 0) {
    container.innerHTML = `
      <div class="text-center py-6 space-y-2">
        <div class="text-2xl">⚽</div>
        <div class="text-sm font-bold text-white">No Players Checked In</div>
        <div class="text-xs text-slate-400">Add players or mark them present in Roll Call below to see your live on-field lineup.</div>
      </div>
    `;
    return;
  }

  const viewedQ = timer.viewedQuarter || timer.quarter;
  const isPreviewingOtherQuarter = viewedQ !== timer.quarter;
  const fullSub = isQuarterFullSub(viewedQ);

  // Determine which shift of viewedQ to display
  let targetShift = getActiveShiftObject(true);
  if (!fullSub && viewedShiftPartOverride && (viewedShiftPartOverride === 1 || viewedShiftPartOverride === 2)) {
    const overrideCandidate = state.computedShifts.find(s => s.quarter === viewedQ && s.part === viewedShiftPartOverride);
    if (overrideCandidate) targetShift = overrideCandidate;
  }

  if (!targetShift) {
    container.innerHTML = '';
    return;
  }

  const editable = canEditGame();
  const fieldPlayers = presentPlayers.filter(p => !targetShift.benchIds.includes(p.id));
  const benchPlayers = presentPlayers.filter(p => targetShift.benchIds.includes(p.id));

  const statusPill = isPreviewingOtherQuarter
    ? `<span class="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-sky-500/20 text-sky-300 border border-sky-500/40">👀 PREVIEWING Q${viewedQ}${fullSub ? '' : ` • Shift ${targetShift.part}`}</span>`
    : `<span class="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">🟢 ON FIELD NOW • Q${targetShift.quarter}${fullSub ? ' (Full Qtr)' : ` • Shift ${targetShift.part}`}</span>`;

  let partToggleHtml = '';
  if (!fullSub) {
    partToggleHtml = `
      <div class="inline-flex bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[11px]">
        <button onclick="setViewedShiftPart(1)" class="px-2 py-0.5 rounded-md font-bold ${targetShift.part === 1 ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-white'}">1st</button>
        <button onclick="setViewedShiftPart(2)" class="px-2 py-0.5 rounded-md font-bold ${targetShift.part === 2 ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:text-white'}">2nd</button>
      </div>
    `;
  }

  let fieldContentHtml = '';
  if (state.trackPositions) {
    const zones = [
      { key: 'FWD', label: '⚔️ FWD', cls: 'pos-FWD' },
      { key: 'MID', label: '⚡ MID', cls: 'pos-MID' },
      { key: 'DEF', label: '🛡️ DEF', cls: 'pos-DEF' },
      { key: 'GK',  label: '🧤 GK',  cls: 'pos-GK' }
    ].filter(z => (state.slots[z.key] || 0) > 0 || fieldPlayers.some(p => targetShift.positions[p.id] === z.key));

    fieldContentHtml = `
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        ${zones.map(z => {
          const zPlayers = fieldPlayers.filter(p => (targetShift.positions[p.id] || 'MID') === z.key);
          const badges = zPlayers.length > 0
            ? zPlayers.map(p => `<span class="px-2.5 py-1 rounded-lg text-xs font-extrabold ${z.cls}">${escapeHtml(formatPlayerBadge(p))}</span>`).join('')
            : `<span class="text-xs text-slate-500 italic">Open</span>`;
          return `
            <div class="bg-slate-950/90 border border-slate-800/90 rounded-xl p-2.5">
              <div class="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-1.5">${z.label}</div>
              <div class="flex flex-wrap gap-1.5">${badges}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } else {
    fieldContentHtml = `
      <div class="bg-slate-950/90 border border-slate-800/90 rounded-xl p-3">
        <div class="text-[11px] font-extrabold uppercase tracking-wider text-emerald-400 mb-2">🏃 Active Field Players (${fieldPlayers.length})</div>
        <div class="flex flex-wrap gap-1.5">
          ${fieldPlayers.map(p => `<span class="px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-xs font-bold">${escapeHtml(formatPlayerBadge(p))}</span>`).join('')}
        </div>
      </div>
    `;
  }

  const benchBadges = benchPlayers.length > 0
    ? benchPlayers.map(p => `<span class="px-2.5 py-1 rounded-lg pos-BENCH text-xs font-bold">${escapeHtml(formatPlayerBadge(p))}</span>`).join('')
    : `<span class="text-xs text-emerald-400 font-semibold">Everyone Present is Playing on Field!</span>`;

  container.innerHTML = `
    <div class="space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
        <div class="flex items-center gap-2 flex-wrap">
          ${statusPill}
          ${partToggleHtml}
        </div>
        ${editable ? `
          <button onclick="openEditModal(${targetShift.index})"
            class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 text-xs font-bold transition">
            ✏️ Swap / Edit Shift
          </button>
        ` : ''}
      </div>

      ${fieldContentHtml}

      <div class="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5">
        <div class="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-1.5">
          🪑 On Bench This Shift (${benchPlayers.length})
        </div>
        <div class="flex flex-wrap gap-1.5">${benchBadges}</div>
      </div>
    </div>
  `;
}

// ============================================================================
// 8. ROLL CALL / ATTENDANCE BAR
// ============================================================================
function getSortedRosterPlayers() {
  const copy = [...state.players];
  if (state.rosterSort === 'name') {
    copy.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } else if (state.rosterSort === 'number') {
    copy.sort(comparePlayerNumbers);
  }
  return copy;
}

function renderAttendance() {
  const editable = canEditGame();
  const presentCount = state.players.filter(p => p.present).length;
  const fieldSlots = getTotalFieldSlots();
  const benchCount = Math.max(0, presentCount - fieldSlots);

  const titleEl = document.getElementById('rollCallHeaderTitle');
  if (titleEl) {
    titleEl.textContent = editable
      ? '📋 Roll Call (Tap Player to Toggle Present)'
      : '📋 Game Day Roll Call & RSVP Status';
  }

  const subEl = document.getElementById('attendanceSubtext');
  if (subEl) {
    subEl.textContent = `${presentCount} of ${state.players.length} present • ${fieldSlots} on field, ${benchCount} on bench per shift`;
  }

  // Sort buttons
  ['order', 'name', 'number'].forEach(mode => {
    const btnId = mode === 'order' ? 'sortBtnOrder' : mode === 'name' ? 'sortBtnName' : 'sortBtnNumber';
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.className = (state.rosterSort || 'order') === mode
        ? 'px-2 py-1 rounded-md font-bold bg-emerald-500 text-slate-950'
        : 'px-2 py-1 rounded-md font-semibold text-slate-400 hover:text-white';
    }
  });

  const selectAllBtn = document.getElementById('selectAllAttendanceBtn');
  const rotateBtn = document.getElementById('rotateOrderBtn');
  if (selectAllBtn) selectAllBtn.classList.toggle('hidden', !editable);
  if (rotateBtn) rotateBtn.classList.toggle('hidden', !editable);

  const chipsEl = document.getElementById('attendanceChips');
  if (!chipsEl) return;

  if (state.players.length === 0) {
    chipsEl.innerHTML = `<span class="text-xs text-slate-500 italic">No players on roster yet.</span>`;
    return;
  }

  const sortedPlayers = getSortedRosterPlayers();
  chipsEl.innerHTML = sortedPlayers.map(p => {
    let rsvpTag = '';
    if (p.rsvp === 'late') {
      rsvpTag = `<span class="ml-1 px-1.5 py-0.2 rounded bg-amber-500/25 text-amber-300 text-[10px] font-extrabold">⏳ LATE</span>`;
    } else if (p.rsvp === 'going') {
      rsvpTag = `<span class="ml-1 text-[10px] text-emerald-300">✓</span>`;
    } else if (p.rsvp === 'out') {
      rsvpTag = `<span class="ml-1 text-[10px] text-rose-300">OUT</span>`;
    }

    const baseCls = p.present
      ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200 hover:bg-emerald-500/30'
      : 'bg-slate-950 border-slate-800 text-slate-500 line-through hover:border-slate-700';

    return `
      <button ${editable ? `onclick="toggleAttendance('${p.id}')"` : 'disabled'}
        class="px-3 py-1.5 rounded-xl border text-xs font-bold transition flex items-center gap-1 ${baseCls}">
        <span>${p.present ? '🟢' : '⚪'} ${escapeHtml(formatPlayerBadge(p))}</span>
        ${rsvpTag}
      </button>
    `;
  }).join('');
}

// ============================================================================
// 9. QUARTER-BY-QUARTER ROTATION SCHEDULE GRID
// ============================================================================
function renderScheduleGrid() {
  const grid = document.getElementById('scheduleGrid');
  const hint = document.getElementById('scheduleSubHint');
  if (!grid) return;

  const editable = canEditGame();
  if (hint) {
    hint.textContent = editable
      ? 'Active clock shift highlighted • Tap any shift to customize'
      : 'Live rotation schedule';
  }

  const presentPlayers = state.players.filter(p => p.present);
  if (presentPlayers.length === 0) {
    grid.innerHTML = `<div class="col-span-full bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center text-xs text-slate-400">Add and check in players above to generate the 4-quarter rotation schedule.</div>`;
    return;
  }

  const activeClockShift = getActiveShiftObject(false);
  const viewedQ = timer.viewedQuarter || timer.quarter;

  const quarterCards = [];
  for (let q = 1; q <= 4; q++) {
    const qShifts = state.computedShifts.filter(s => s.quarter === q);
    const fullSub = isQuarterFullSub(q);
    const visibleShifts = fullSub ? qShifts.slice(0, 1) : qShifts;

    const isClockQ = q === timer.quarter;
    const isPreviewQ = q === viewedQ && viewedQ !== timer.quarter;

    const cardBorder = isClockQ
      ? 'border-emerald-500/60 ring-1 ring-emerald-500/30'
      : isPreviewQ
      ? 'border-sky-500/60 ring-1 ring-sky-500/30'
      : 'border-slate-800';

    let headerBadge = '';
    if (isClockQ) {
      headerBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">🟢 ACTIVE CLOCK</span>`;
    } else if (isPreviewQ) {
      headerBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-sky-500/20 text-sky-300 border border-sky-500/40">👀 PREVIEWING</span>`;
    }

    const fullQtrToggleBtn = (state.shiftsPerQuarter === 2 && editable)
      ? `<button onclick="toggleFullQuarterLock(${q})"
           class="px-2 py-0.5 rounded-lg text-[11px] font-bold border transition ${
             state.fullQuarterLocks[q]
               ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
               : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
           }">
           ${state.fullQuarterLocks[q] ? '🔒 Full Qtr (1.0)' : '⏱️ 2 Shifts (0.5)'}
         </button>`
      : '';

    const shiftsHtml = visibleShifts.map(sh => {
      const isCurrentActiveShift = activeClockShift && activeClockShift.index === sh.index;
      const benchPlayers = presentPlayers.filter(p => sh.benchIds.includes(p.id));
      const fieldPlayers = presentPlayers.filter(p => !sh.benchIds.includes(p.id));

      const shiftTitle = fullSub
        ? `Full Quarter (${fmtDurationLabel(state.quarterMins)})`
        : sh.part === 1
        ? `1st Shift (0:00–${fmtDurationLabel(state.quarterMins / 2)})`
        : `2nd Shift (${fmtDurationLabel(state.quarterMins / 2)}–${fmtDurationLabel(state.quarterMins)})`;

      const lockTag = sh.locked
        ? `<span class="text-[10px] font-bold text-amber-300 bg-amber-500/20 px-1.5 py-0.5 rounded border border-amber-500/40">🔒 Locked</span>`
        : sh.isMidQtrPosSwapShift
        ? `<span class="text-[10px] font-bold text-sky-300 bg-sky-500/15 px-1.5 py-0.5 rounded border border-sky-500/30">🔄 FWD⇄DEF Swap</span>`
        : '';

      const benchHtml = benchPlayers.length > 0
        ? benchPlayers.map(p => `<span class="px-2 py-0.5 rounded-md pos-BENCH text-[11px] font-bold">${escapeHtml(formatPlayerBadge(p))}</span>`).join('')
        : `<span class="text-[11px] text-emerald-400 font-medium">None (All Play)</span>`;

      let posSummaryHtml = '';
      if (state.trackPositions) {
        const zoneOrder = ['FWD', 'MID', 'DEF', 'GK'];
        const zoneChips = [];
        zoneOrder.forEach(z => {
          const zp = fieldPlayers.filter(p => (sh.positions[p.id] || 'MID') === z);
          if (zp.length > 0) {
            zp.forEach(p => {
              zoneChips.push(`<span class="px-1.5 py-0.5 rounded text-[11px] font-semibold pos-${z}">${z}: ${escapeHtml(formatPlayerBadge(p))}</span>`);
            });
          }
        });
        posSummaryHtml = `<div class="flex flex-wrap gap-1 pt-1.5 border-t border-slate-800/80">${zoneChips.join('')}</div>`;
      }

      return `
        <div ${editable ? `onclick="openEditModal(${sh.index})"` : ''}
          class="rounded-xl p-3 border transition ${editable ? 'cursor-pointer hover:border-emerald-500/50' : ''} ${
            isCurrentActiveShift
              ? 'bg-emerald-950/30 border-emerald-500/50'
              : 'bg-slate-950/80 border-slate-800/90'
          } space-y-2">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-extrabold ${isCurrentActiveShift ? 'text-emerald-300' : 'text-slate-200'}">
              ${isCurrentActiveShift ? '▶ ' : ''}${shiftTitle}
            </span>
            <div class="flex items-center gap-1">
              ${lockTag}
              ${editable ? `<span class="text-[11px] text-slate-400">✏️</span>` : ''}
            </div>
          </div>

          <div class="flex items-center flex-wrap gap-1.5 text-xs">
            <span class="text-[11px] font-bold text-slate-400 mr-1">🪑 Bench:</span>
            ${benchHtml}
          </div>

          ${posSummaryHtml}
        </div>
      `;
    }).join('');

    quarterCards.push(`
      <div class="bg-slate-900 border ${cardBorder} rounded-2xl p-3.5 shadow-lg space-y-2.5">
        <div class="flex items-center justify-between gap-2 border-b border-slate-800 pb-2">
          <div class="flex items-center gap-2">
            <button onclick="selectViewedQuarter(${q})" class="font-extrabold text-sm text-white hover:text-emerald-400 transition">
              Quarter ${q}
            </button>
            ${headerBadge}
          </div>
          ${fullQtrToggleBtn}
        </div>
        <div class="space-y-2">
          ${shiftsHtml}
        </div>
      </div>
    `);
  }

  grid.innerHTML = quarterCards.join('');
}

// ============================================================================
// 10. PLAYTIME & POSITION BALANCE MATRIX
// ============================================================================
export function computeCurrentGameQuarterCounts() {
  const counts = {};
  state.players.forEach(p => {
    counts[p.id] = { BENCH: 0, FWD: 0, MID: 0, DEF: 0, GK: 0 };
  });

  const shiftWeight = getShiftQuarterWeight(state.shiftsPerQuarter);
  const presentSet = new Set(state.players.filter(p => p.present).map(p => p.id));

  state.computedShifts.forEach(sh => {
    presentSet.forEach(pid => {
      if (sh.benchIds.includes(pid)) {
        counts[pid].BENCH = Math.round((counts[pid].BENCH + shiftWeight) * 100) / 100;
      } else {
        const pos = sh.positions[pid] || 'MID';
        counts[pid][pos] = Math.round(((counts[pid][pos] || 0) + shiftWeight) * 100) / 100;
      }
    });
  });

  return counts;
}

function renderBalanceTable() {
  const tbody = document.getElementById('balanceTableBody');
  if (!tbody) return;

  const posCols = document.querySelectorAll('.pos-col');
  posCols.forEach(el => {
    el.classList.toggle('hidden', !state.trackPositions);
  });

  const gkHeader = document.getElementById('gkHeaderCell');
  const showGk = state.trackPositions && ((state.slots.GK || 0) > 0 || state.players.some(p => (p.prior.GK || 0) > 0));
  if (gkHeader) {
    gkHeader.classList.toggle('hidden', !showGk);
  }

  const gameCounts = computeCurrentGameQuarterCounts();
  const rows = state.players.map((p, idx) => {
    const gc = gameCounts[p.id] || { BENCH: 0, FWD: 0, MID: 0, DEF: 0, GK: 0 };
    const playQtrs = p.present ? Math.max(0, 4 - gc.BENCH) : 0;
    const playPct = p.present ? Math.round((playQtrs / 4) * 100) : 0;
    return {
      player: p,
      idx,
      gc,
      playPct,
      totBench: (p.prior.BENCH || 0) + gc.BENCH,
      totFWD: (p.prior.FWD || 0) + gc.FWD,
      totMID: (p.prior.MID || 0) + gc.MID,
      totDEF: (p.prior.DEF || 0) + gc.DEF,
      totGK: (p.prior.GK || 0) + gc.GK
    };
  });

  const sortCol = (state.balanceSort && state.balanceSort.col) || 'order';
  const sortDir = (state.balanceSort && state.balanceSort.dir) === 'desc' ? -1 : 1;

  ['number', 'name', 'BENCH', 'FWD', 'MID', 'DEF', 'GK', 'playPct'].forEach(col => {
    const ind = document.getElementById(`balSort_${col}`);
    if (ind) {
      ind.textContent = sortCol === col ? (sortDir === 1 ? '▲' : '▼') : '';
    }
  });

  rows.sort((a, b) => {
    if (a.player.present !== b.player.present) return a.player.present ? -1 : 1;
    if (sortCol === 'number') return comparePlayerNumbers(a.player, b.player) * sortDir;
    if (sortCol === 'name') return (a.player.name || '').localeCompare(b.player.name || '') * sortDir;
    if (sortCol === 'BENCH') return (a.gc.BENCH - b.gc.BENCH || a.totBench - b.totBench) * sortDir;
    if (sortCol === 'FWD') return (a.gc.FWD - b.gc.FWD || a.totFWD - b.totFWD) * sortDir;
    if (sortCol === 'MID') return (a.gc.MID - b.gc.MID || a.totMID - b.totMID) * sortDir;
    if (sortCol === 'DEF') return (a.gc.DEF - b.gc.DEF || a.totDEF - b.totDEF) * sortDir;
    if (sortCol === 'GK') return (a.gc.GK - b.gc.GK || a.totGK - b.totGK) * sortDir;
    if (sortCol === 'playPct') return (a.playPct - b.playPct) * sortDir;
    return (a.idx - b.idx) * sortDir;
  });

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="py-4 text-center text-slate-500 italic">No players on roster.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const p = r.player;
    const gc = r.gc;
    const priorB = p.prior.BENCH || 0;
    const rowOpacity = p.present ? '' : 'opacity-45';

    const fmtCell = (todayVal, priorVal, colorCls = 'text-slate-200') => {
      if (!p.present) return `<span class="text-slate-600">-</span>`;
      const priorTag = priorVal > 0 ? `<span class="text-[10px] text-slate-500 ml-0.5">(+${fmtNum(priorVal)})</span>` : '';
      return `<span class="mono font-bold ${colorCls}">${fmtNum(todayVal)}</span>${priorTag}`;
    };

    return `
      <tr class="${rowOpacity}">
        <td class="py-2 pr-1 mono font-bold text-slate-400">${escapeHtml(p.number || '-')}</td>
        <td class="py-2 pr-2 font-bold text-white">${escapeHtml(p.name)} ${!p.present ? '<span class="text-[10px] text-rose-400 font-normal">(Out)</span>' : ''}</td>
        <td class="py-2 px-2 text-center">${fmtCell(gc.BENCH, priorB, 'text-slate-200')}</td>
        ${state.trackPositions ? `
          <td class="py-2 px-2 text-center">${fmtCell(gc.FWD, p.prior.FWD || 0, 'text-rose-300')}</td>
          <td class="py-2 px-2 text-center">${fmtCell(gc.MID, p.prior.MID || 0, 'text-blue-300')}</td>
          <td class="py-2 px-2 text-center">${fmtCell(gc.DEF, p.prior.DEF || 0, 'text-emerald-300')}</td>
          ${showGk ? `<td class="py-2 px-2 text-center">${fmtCell(gc.GK, p.prior.GK || 0, 'text-amber-300')}</td>` : ''}
        ` : ''}
        <td class="py-2 pl-2 text-right mono font-extrabold ${r.playPct >= 75 ? 'text-emerald-400' : r.playPct >= 50 ? 'text-amber-300' : 'text-rose-400'}">
          ${p.present ? `${r.playPct}%` : '0%'}
        </td>
      </tr>
    `;
  }).join('');
}

// ============================================================================
// 11. 1-TAP SMS / RCS SCHEDULE GENERATOR
// ============================================================================
function buildSmsMessagesArray() {
  const presentPlayers = state.players.filter(p => p.present);
  if (presentPlayers.length === 0) return [];

  const bubbles = [];
  for (let q = 1; q <= 4; q++) {
    const fullSub = isQuarterFullSub(q);
    const qShifts = state.computedShifts.filter(s => s.quarter === q);
    const visibleShifts = fullSub ? qShifts.slice(0, 1) : qShifts;

    const lines = [`⚽ ${state.teamName} — Q${q}`];
    visibleShifts.forEach(sh => {
      const prefix = fullSub ? 'Full Qtr' : (sh.part === 1 ? '1st Half' : '2nd Half');
      const benchNames = presentPlayers.filter(p => sh.benchIds.includes(p.id)).map(formatPlayerBadge).join(', ') || 'None';
      lines.push(`${prefix} 🪑 Bench: ${benchNames}`);

      if (state.smsStyle === 'positions' && state.trackPositions) {
        const fieldPlayers = presentPlayers.filter(p => !sh.benchIds.includes(p.id));
        const posParts = [];
        ['FWD', 'MID', 'DEF', 'GK'].forEach(z => {
          const zp = fieldPlayers.filter(p => (sh.positions[p.id] || 'MID') === z).map(formatPlayerBadge);
          if (zp.length > 0) posParts.push(`${z}: ${zp.join(', ')}`);
        });
        if (posParts.length > 0) {
          lines.push(`  📍 ${posParts.join(' | ')}`);
        }
      }
    });
    bubbles.push(lines.join('\n'));
  }
  return bubbles;
}

function renderSmsBubbles() {
  const container = document.getElementById('smsBubblesContainer');
  if (!container) return;

  const btnCompact = document.getElementById('smsBtnCompact');
  const btnPos = document.getElementById('smsBtnPositions');
  if (btnCompact && btnPos) {
    btnCompact.className = state.smsStyle === 'compact'
      ? 'px-2.5 py-1 rounded-lg text-xs font-bold border bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
      : 'px-2.5 py-1 rounded-lg text-xs font-semibold border bg-slate-800 text-slate-400 border-slate-700';
    btnPos.className = state.smsStyle === 'positions'
      ? 'px-2.5 py-1 rounded-lg text-xs font-bold border bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
      : 'px-2.5 py-1 rounded-lg text-xs font-semibold border bg-slate-800 text-slate-400 border-slate-700';
  }

  const bubbles = buildSmsMessagesArray();
  if (bubbles.length === 0) {
    container.innerHTML = `<div class="text-xs text-slate-500 italic text-center py-2">Check in players to generate copy-ready text bubbles.</div>`;
    return;
  }

  container.innerHTML = bubbles.map((txt, idx) => `
    <div onclick="copySingleSms(${idx})" id="smsBubble_${idx}"
      class="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800/90 border border-slate-800 cursor-pointer transition flex items-start justify-between gap-2">
      <pre class="text-xs text-slate-200 whitespace-pre-wrap font-sans leading-relaxed">${escapeHtml(txt)}</pre>
      <span class="text-[11px] font-bold text-emerald-400 shrink-0">📋 Copy</span>
    </div>
  `).join('');
}

// ============================================================================
// 12. TAB 2: SEASON STATS LEADERBOARD & GAME HISTORY
// ============================================================================
function renderStatsAndHistoryTab() {
  // 1. Season Record & Goal Totals
  let wins = 0, losses = 0, draws = 0, gf = 0, ga = 0;
  (state.gameHistory || []).forEach(g => {
    const our = Number(g.ourScore) || 0;
    const opp = Number(g.oppScore) || 0;
    gf += our;
    ga += opp;
    if (our > opp) wins++;
    else if (our < opp) losses++;
    else draws++;
  });

  const recEl = document.getElementById('statRecord');
  const gfEl = document.getElementById('statGoalsFor');
  const gaEl = document.getElementById('statGoalsAgainst');
  const gdEl = document.getElementById('statGoalDiff');

  if (recEl) recEl.textContent = `${wins}-${losses}-${draws}`;
  if (gfEl) gfEl.textContent = gf;
  if (gaEl) gaEl.textContent = ga;
  if (gdEl) {
    const diff = gf - ga;
    gdEl.textContent = diff > 0 ? `+${diff}` : String(diff);
  }

  // 2. Season Player Leaderboard
  const tbody = document.getElementById('seasonStatsTableBody');
  if (tbody) {
    const rows = state.players.map((p, idx) => {
      const gp = Number(p.prior.gamesPlayed) || 0;
      const g = Number(p.prior.goals) || 0;
      const a = Number(p.prior.assists) || 0;
      const pts = (g * 2) + a;
      const bench = Number(p.prior.BENCH) || 0;
      return { player: p, idx, gp, g, a, pts, bench };
    });

    const sortCol = (state.statsSort && state.statsSort.col) || 'pts';
    const sortDir = (state.statsSort && state.statsSort.dir) === 'asc' ? 1 : -1;

    ['number', 'name', 'gamesPlayed', 'goals', 'assists', 'pts', 'BENCH'].forEach(col => {
      const ind = document.getElementById(`stSort_${col}`);
      if (ind) ind.textContent = sortCol === col ? (sortDir === 1 ? '▲' : '▼') : '';
    });

    rows.sort((a, b) => {
      if (sortCol === 'number') return comparePlayerNumbers(a.player, b.player) * sortDir;
      if (sortCol === 'name') return (a.player.name || '').localeCompare(b.player.name || '') * sortDir;
      if (sortCol === 'gamesPlayed') return (a.gp - b.gp) * sortDir;
      if (sortCol === 'goals') return (a.g - b.g || a.pts - b.pts) * sortDir;
      if (sortCol === 'assists') return (a.a - b.a || a.pts - b.pts) * sortDir;
      if (sortCol === 'pts') return (a.pts - b.pts || a.g - b.g) * sortDir;
      if (sortCol === 'BENCH') return (a.bench - b.bench) * sortDir;
      return (a.idx - b.idx) * sortDir;
    });

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="py-4 text-center text-slate-500 italic">No players on roster.</td></tr>`;
    } else {
      tbody.innerHTML = rows.map(r => {
        const p = r.player;
        const posStr = `${fmtNum(p.prior.FWD || 0)} / ${fmtNum(p.prior.MID || 0)} / ${fmtNum(p.prior.DEF || 0)} / ${fmtNum(p.prior.GK || 0)}`;
        return `
          <tr>
            <td class="py-2 pr-1 mono font-bold text-slate-400">${escapeHtml(p.number || '-')}</td>
            <td class="py-2 pr-2 font-bold text-white">${escapeHtml(p.name)}</td>
            <td class="py-2 px-2 text-center mono text-slate-300">${r.gp}</td>
            <td class="py-2 px-2 text-center mono font-bold text-emerald-400">${r.g}</td>
            <td class="py-2 px-2 text-center mono font-bold text-blue-400">${r.a}</td>
            <td class="py-2 px-2 text-center mono font-extrabold text-amber-300">${r.pts}</td>
            <td class="py-2 px-2 text-center mono text-slate-300">${fmtNum(r.bench)}</td>
            <td class="py-2 pl-2 text-right mono text-slate-400">${posStr}</td>
          </tr>
        `;
      }).join('');
    }
  }

  // 3. Completed Game History List
  const histList = document.getElementById('gameHistoryList');
  if (histList) {
    const games = state.gameHistory || [];
    if (games.length === 0) {
      histList.innerHTML = `<div class="text-xs text-slate-500 italic py-4 text-center">No completed games archived yet. Use "✅ Complete & Save Game" at the bottom of the Live Game tab after a match.</div>`;
    } else {
      histList.innerHTML = games.map(g => {
        const our = Number(g.ourScore) || 0;
        const opp = Number(g.oppScore) || 0;
        const resBadge = our > opp
          ? `<span class="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-extrabold text-xs">W ${our}-${opp}</span>`
          : our < opp
          ? `<span class="px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/40 font-extrabold text-xs">L ${our}-${opp}</span>`
          : `<span class="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/40 font-extrabold text-xs">D ${our}-${opp}</span>`;

        const goalPills = (g.goals || []).map(gl => {
          const s = escapeHtml(gl.scorerLabel || getPlayerDisplayById(gl.scorerId));
          const a = gl.assistId ? ` (A: ${escapeHtml(gl.assistLabel || getPlayerDisplayById(gl.assistId))})` : '';
          return `<span class="inline-block px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[11px] text-slate-300">⚽ ${s}${a}</span>`;
        }).join(' ');

        return `
          <div onclick="openGameDetailModal('${g.id}')"
            class="bg-slate-950/80 hover:bg-slate-950 border border-slate-800 hover:border-emerald-500/50 rounded-2xl p-3.5 cursor-pointer transition space-y-2">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 min-w-0">
                ${resBadge}
                <span class="font-extrabold text-sm text-white truncate">${escapeHtml(g.teamName || state.teamName)} vs ${escapeHtml(g.opponent || 'Opponent')}</span>
              </div>
              <span class="text-[11px] text-slate-400 shrink-0">${escapeHtml(g.date || '')} ✏️</span>
            </div>
            ${goalPills ? `<div class="flex flex-wrap gap-1">${goalPills}</div>` : ''}
          </div>
        `;
      }).join('');
    }
  }
}

// ============================================================================
// INTERACTIVE CONTROLLERS & WINDOW HANDLERS
// ============================================================================

export function switchMainTab(tab) {
  currentMainTab = tab === 'stats' ? 'stats' : 'game';
  renderAll();
}

export function toggleDrawer(drawerId) {
  const el = document.getElementById(drawerId);
  if (!el) return;
  el.classList.toggle('hidden');
}

export function handleTeamSelectChange(teamId) {
  if (!isHeadCoach()) return;
  const found = appStore.teams.find(t => t.id === teamId);
  if (!found) return;
  appStore.activeTeamId = found.id;
  syncActiveTeamPointer();
  applyCloudTimerState();
  recalculateSchedule(false);
  saveState(false);
  subscribeToActiveTeamCloud();
  renderAll();
}

export function createNewTeamPrompt() {
  if (!isHeadCoach()) return;
  const name = prompt('Enter new team name:', `Team ${appStore.teams.length + 1}`);
  if (!name || !name.trim()) return;
  const newTeam = createBlankTeam(name.trim());
  appStore.teams.push(newTeam);
  appStore.activeTeamId = newTeam.id;
  syncActiveTeamPointer();
  resetTimer(false);
  recalculateSchedule(true);
  subscribeToActiveTeamCloud();
  renderAll();
}

export function deleteCurrentTeam() {
  if (!isHeadCoach() || appStore.teams.length <= 1) return;
  if (!confirm(`Delete team "${state.teamName}" from this device?`)) return;
  appStore.teams = appStore.teams.filter(t => t.id !== state.id);
  appStore.activeTeamId = appStore.teams[0].id;
  syncActiveTeamPointer();
  applyCloudTimerState();
  recalculateSchedule(false);
  saveState(false);
  subscribeToActiveTeamCloud();
  renderAll();
}

export function updateTeamName(val) {
  if (!canEditGame()) return;
  const clean = (val || '').trim() || 'My Team';
  state.teamName = clean;
  saveState(true);
  renderAll();
}

export function handleFormationChange(presetKey) {
  if (!canEditGame()) return;
  const preset = FORMATION_PRESETS[presetKey];
  if (!preset) return;
  state.formationKey = presetKey;
  state.slots = { ...preset.slots };
  state.lockedShifts = {};
  recalculateSchedule(true);
  renderAll();
}

export function handleQuarterSelectChange(val) {
  if (!canEditGame()) return;
  const customInp = document.getElementById('customQuarterMinsInput');
  if (val === 'custom') {
    if (customInp) {
      customInp.classList.remove('hidden');
      customInp.value = state.quarterMins;
      customInp.focus();
    }
    return;
  }
  const num = parseFloat(val) || 8;
  state.quarterMins = num;
  if (!timer.running) {
    timer.secondsLeft = getQuarterTotalSeconds(num);
  }
  syncTimerToStateAndCloud();
  renderAll();
}

export function handleCustomQuarterInput(val) {
  if (!canEditGame()) return;
  const num = Math.max(1, Math.min(60, parseFloat(val) || 8));
  state.quarterMins = num;
  if (!timer.running) {
    timer.secondsLeft = getQuarterTotalSeconds(num);
  }
  syncTimerToStateAndCloud();
  renderAll();
}

export function handleTimingChange() {
  if (!canEditGame()) return;
  const sel = document.getElementById('shiftsPerQtrSelect');
  if (!sel) return;
  const val = sel.value;
  if (val === '1') {
    state.shiftsPerQuarter = 1;
    state.midQtrPosSwap = false;
  } else if (val === '2_swap') {
    state.shiftsPerQuarter = 2;
    state.midQtrPosSwap = true;
  } else {
    state.shiftsPerQuarter = 2;
    state.midQtrPosSwap = false;
  }
  state.lockedShifts = {};
  recalculateSchedule(true);
  renderAll();
}

export function adjustSlot(zone, delta) {
  if (!canEditGame()) return;
  const current = state.slots[zone] || 0;
  const next = Math.max(0, Math.min(11, current + delta));
  state.slots[zone] = next;
  state.lockedShifts = {};
  recalculateSchedule(true);
  renderAll();
}

export function togglePositionMode() {
  if (!canEditGame()) return;
  state.trackPositions = !state.trackPositions;
  saveState(true);
  renderAll();
}

function createPlayerObject(name, number) {
  return {
    id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name: name.trim(),
    number: (number || '').trim(),
    present: true,
    rsvp: null,
    prior: {
      BENCH: 0,
      FWD: 0,
      MID: 0,
      DEF: 0,
      GK: 0,
      gamesPlayed: 0,
      goals: 0,
      assists: 0,
      manualBenchOverride: false
    }
  };
}

export function addPlayer() {
  if (!canEditGame()) return;
  const numInp = document.getElementById('newPlayerNumberInput');
  const nameInp = document.getElementById('newPlayerInput');
  const name = (nameInp ? nameInp.value : '').trim();
  const num = (numInp ? numInp.value : '').trim();
  if (!name) return;

  state.players.push(createPlayerObject(name, num));
  if (nameInp) nameInp.value = '';
  if (numInp) numInp.value = '';
  recalculateSchedule(true);
  renderAll();
}

export function addPlayerFromOnboarding() {
  if (!canEditGame()) return;
  const numInp = document.getElementById('onboardPlayerNum');
  const nameInp = document.getElementById('onboardPlayerName');
  const name = (nameInp ? nameInp.value : '').trim();
  const num = (numInp ? numInp.value : '').trim();
  if (!name) return;

  state.players.push(createPlayerObject(name, num));
  if (nameInp) {
    nameInp.value = '';
    nameInp.focus();
  }
  if (numInp) numInp.value = '';
  recalculateSchedule(true);
  renderAll();
}

export function updatePlayerNumber(playerId, val) {
  if (!canEditGame()) return;
  const p = state.players.find(x => x.id === playerId);
  if (!p) return;
  p.number = (val || '').trim();
  saveState(true);
  renderAll();
}

export function updatePlayerName(playerId, val) {
  if (!canEditGame()) return;
  const p = state.players.find(x => x.id === playerId);
  if (!p || !val.trim()) return;
  p.name = val.trim();
  saveState(true);
  renderAll();
}

export function updatePlayerPriorBench(playerId, val) {
  if (!canEditGame()) return;
  const p = state.players.find(x => x.id === playerId);
  if (!p) return;
  p.prior.BENCH = Math.max(0, parseFloat(val) || 0);
  p.prior.manualBenchOverride = true;
  recalculateSchedule(true);
  renderAll();
}

export function removePlayer(playerId) {
  if (!canEditGame()) return;
  const p = state.players.find(x => x.id === playerId);
  if (!p) return;
  if (!confirm(`Remove ${formatPlayerBadge(p)} from roster?`)) return;
  state.players = state.players.filter(x => x.id !== playerId);
  state.lockedShifts = {};
  recalculateSchedule(true);
  renderAll();
}

export function resetSeasonHistory() {
  if (!canEditGame()) return;
  if (!confirm('Reset all prior season bench, position, goal, and assist counts to 0 for this team?')) return;
  state.players.forEach(p => {
    p.prior = {
      BENCH: 0, FWD: 0, MID: 0, DEF: 0, GK: 0,
      gamesPlayed: 0, goals: 0, assists: 0,
      manualBenchOverride: false
    };
  });
  state.gameHistory = [];
  recalculateSchedule(true);
  renderAll();
}

// Parent RSVP Actions
export function selectParentIdentity(playerId) {
  localStorage.setItem(getParentStorageKey(), playerId);
  renderParentRsvpCard();
}

export function clearParentIdentity() {
  localStorage.removeItem(getParentStorageKey());
  renderParentRsvpCard();
}

export async function submitParentRsvp(status) {
  const savedPlayerId = localStorage.getItem(getParentStorageKey());
  const p = state.players.find(x => x.id === savedPlayerId);
  if (!p) return;

  p.rsvp = status;
  p.present = status !== 'out';
  recalculateSchedule(false);
  saveState(false);
  await pushActiveTeamToCloud(true);
  renderAll();
}

// Attendance & Roster Sorting
export function toggleAttendance(playerId) {
  if (!canEditGame()) return;
  const p = state.players.find(x => x.id === playerId);
  if (!p) return;
  p.present = !p.present;
  p.rsvp = p.present ? 'going' : 'out';
  recalculateSchedule(true);
  renderAll();
}

export function setAllAttendance(presentVal) {
  if (!canEditGame()) return;
  state.players.forEach(p => {
    p.present = Boolean(presentVal);
    p.rsvp = p.present ? 'going' : 'out';
  });
  recalculateSchedule(true);
  renderAll();
}

export function rotateStarterOrder() {
  if (!canEditGame() || state.players.length <= 1) return;
  const first = state.players.shift();
  state.players.push(first);
  state.rosterSort = 'order';
  state.lockedShifts = {};
  recalculateSchedule(true);
  renderAll();
}

export function setRosterSort(mode) {
  state.rosterSort = mode;
  saveState(false);
  renderAll();
}

// Viewed Shift Part & Queued Sub Alert Activation
export function setViewedShiftPart(part) {
  viewedShiftPartOverride = part;
  renderLiveInPlayPanel();
}

export function activateQueuedSubNow(shiftIdx) {
  if (!canEditGame()) return;
  triggerSubAlertForShift(shiftIdx);
  playAlertSignal(2);
  syncTimerToStateAndCloud();
  renderAll();
}

export function toggleFullQuarterLock(quarter) {
  if (!canEditGame()) return;
  state.fullQuarterLocks[quarter] = !state.fullQuarterLocks[quarter];
  recalculateSchedule(true);
  renderAll();
}

export function clearAllLocks() {
  if (!canEditGame()) return;
  state.lockedShifts = {};
  state.fullQuarterLocks = { 1: false, 2: false, 3: false, 4: false };
  recalculateSchedule(true);
  renderAll();
}

// Table Sorting
export function toggleBalanceSort(col) {
  if (!state.balanceSort) state.balanceSort = { col: 'order', dir: 'asc' };
  if (state.balanceSort.col === col) {
    state.balanceSort.dir = state.balanceSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    state.balanceSort.col = col;
    state.balanceSort.dir = col === 'playPct' ? 'desc' : 'asc';
  }
  renderBalanceTable();
}

export function toggleStatsSort(col) {
  if (!state.statsSort) state.statsSort = { col: 'pts', dir: 'desc' };
  if (state.statsSort.col === col) {
    state.statsSort.dir = state.statsSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    state.statsSort.col = col;
    state.statsSort.dir = (col === 'name' || col === 'number') ? 'asc' : 'desc';
  }
  renderStatsAndHistoryTab();
}

// SMS Copy
export function setSmsStyle(style) {
  state.smsStyle = style;
  saveState(true);
  renderSmsBubbles();
}

export async function copySingleSms(idx) {
  const bubbles = buildSmsMessagesArray();
  const text = bubbles[idx];
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const el = document.getElementById(`smsBubble_${idx}`);
    if (el) {
      const span = el.querySelector('span');
      if (span) {
        const orig = span.textContent;
        span.textContent = '✅ Copied!';
        setTimeout(() => { span.textContent = orig; }, 1500);
      }
    }
  } catch (e) {
    prompt('Copy text:', text);
  }
}

export async function copyAllSms() {
  const bubbles = buildSmsMessagesArray();
  if (!bubbles.length) return;
  const fullText = bubbles.join('\n\n');
  const btn = document.getElementById('copyAllBtn');
  try {
    await navigator.clipboard.writeText(fullText);
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✅ Copied All!';
      setTimeout(() => { btn.textContent = orig; }, 1800);
    }
  } catch (e) {
    prompt('Copy schedule:', fullText);
  }
}

// ============================================================================
// SCOREBOARD & GOAL MODAL CONTROLLERS
// ============================================================================
export function updateOpponentName(val) {
  if (!canEditGame()) return;
  state.currentMatch.opponent = (val || '').trim() || 'Opponent';
  saveState(true);
  renderAll();
}

export function adjustOpponentScore(delta) {
  if (!canEditGame()) return;
  state.currentMatch.oppScore = Math.max(0, (Number(state.currentMatch.oppScore) || 0) + delta);
  saveState(true);
  renderAll();
}

export function openGoalModal() {
  if (!canEditGame()) return;
  const presentPlayers = state.players.filter(p => p.present);
  goalDraft.scorerId = presentPlayers.length > 0 ? presentPlayers[0].id : 'OWN_GOAL';
  goalDraft.assistId = null;
  renderGoalModalChips();
  document.getElementById('goalModal').classList.remove('hidden');
}

export function closeGoalModal() {
  document.getElementById('goalModal').classList.add('hidden');
}

function renderGoalModalChips() {
  const scorerContainer = document.getElementById('goalScorerChips');
  const assistContainer = document.getElementById('goalAssistChips');
  if (!scorerContainer || !assistContainer) return;

  const presentPlayers = getSortedRosterPlayers().filter(p => p.present);

  const scorerButtons = presentPlayers.map(p => {
    const active = goalDraft.scorerId === p.id;
    return `
      <button onclick="selectGoalScorer('${p.id}')"
        class="py-2 px-2.5 rounded-xl border text-xs font-bold text-left truncate transition ${
          active
            ? 'bg-emerald-500 text-slate-950 border-emerald-400 font-extrabold shadow'
            : 'bg-slate-950 text-slate-200 border-slate-800 hover:border-slate-700'
        }">
        ⚽ ${escapeHtml(formatPlayerBadge(p))}
      </button>
    `;
  });
  scorerButtons.push(`
    <button onclick="selectGoalScorer('OWN_GOAL')"
      class="py-2 px-2.5 rounded-xl border text-xs font-bold text-left truncate transition ${
        goalDraft.scorerId === 'OWN_GOAL'
          ? 'bg-emerald-500 text-slate-950 border-emerald-400 font-extrabold shadow'
          : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
      }">
      🥅 Opponent Own Goal
    </button>
  `);
  scorerContainer.innerHTML = scorerButtons.join('');

  const assistButtons = [
    `<button onclick="selectGoalAssist(null)"
      class="py-2 px-2.5 rounded-xl border text-xs font-bold text-left truncate transition ${
        goalDraft.assistId === null
          ? 'bg-blue-500 text-slate-950 border-blue-400 font-extrabold shadow'
          : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
      }">
      — Unassisted
    </button>`
  ];
  presentPlayers.forEach(p => {
    if (p.id === goalDraft.scorerId) return;
    const active = goalDraft.assistId === p.id;
    assistButtons.push(`
      <button onclick="selectGoalAssist('${p.id}')"
        class="py-2 px-2.5 rounded-xl border text-xs font-bold text-left truncate transition ${
          active
            ? 'bg-blue-500 text-slate-950 border-blue-400 font-extrabold shadow'
            : 'bg-slate-950 text-slate-200 border-slate-800 hover:border-slate-700'
        }">
        👟 ${escapeHtml(formatPlayerBadge(p))}
      </button>
    `);
  });
  assistContainer.innerHTML = assistButtons.join('');
}

export function selectGoalScorer(scorerId) {
  goalDraft.scorerId = scorerId;
  if (goalDraft.assistId === scorerId) {
    goalDraft.assistId = null;
  }
  renderGoalModalChips();
}

export function selectGoalAssist(assistId) {
  goalDraft.assistId = assistId;
  renderGoalModalChips();
}

export function confirmGoalLog() {
  if (!canEditGame()) return;
  const goalObj = {
    id: 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
    quarter: timer.quarter,
    clock: formatClockMMSS(timer.secondsLeft),
    scorerId: goalDraft.scorerId,
    assistId: goalDraft.assistId,
    scorerLabel: getPlayerDisplayById(goalDraft.scorerId),
    assistLabel: goalDraft.assistId ? getPlayerDisplayById(goalDraft.assistId) : null
  };
  state.currentMatch.goals.push(goalObj);
  state.currentMatch.ourScore = (Number(state.currentMatch.ourScore) || 0) + 1;
  closeGoalModal();
  saveState(true);
  renderAll();
}

export function deleteMatchGoal(goalId) {
  if (!canEditGame()) return;
  const idx = state.currentMatch.goals.findIndex(g => g.id === goalId);
  if (idx === -1) return;
  state.currentMatch.goals.splice(idx, 1);
  state.currentMatch.ourScore = Math.max(0, (Number(state.currentMatch.ourScore) || 1) - 1);
  saveState(true);
  renderAll();
}

// ============================================================================
// ON-THE-FLY SHIFT & POSITION OVERRIDE MODAL
// ============================================================================
export function openEditModal(shiftIndex) {
  if (!canEditGame()) return;
  const sh = state.computedShifts[shiftIndex];
  if (!sh) return;

  modalDraft.shiftIndex = shiftIndex;
  modalDraft.benchIds = [...sh.benchIds];
  modalDraft.positions = { ...sh.positions };

  renderEditModalContent();
  document.getElementById('editModal').classList.remove('hidden');
}

export function closeEditModal() {
  document.getElementById('editModal').classList.add('hidden');
}

function renderEditModalContent() {
  const sh = state.computedShifts[modalDraft.shiftIndex];
  if (!sh) return;

  const titleEl = document.getElementById('modalTitle');
  if (titleEl) {
    const fullSub = isQuarterFullSub(sh.quarter);
    titleEl.textContent = fullSub
      ? `Edit Q${sh.quarter} • Full Quarter`
      : `Edit Q${sh.quarter} • ${sh.part === 1 ? '1st' : '2nd'} Shift`;
  }

  const presentPlayers = getSortedRosterPlayers().filter(p => p.present);
  const expectedBench = Math.max(0, presentPlayers.length - getTotalFieldSlots());

  const counterEl = document.getElementById('modalBenchCounter');
  if (counterEl) {
    const diff = modalDraft.benchIds.length - expectedBench;
    const statusCls = diff === 0 ? 'text-emerald-400' : 'text-amber-300';
    counterEl.innerHTML = `Sitting Out: <span class="${statusCls} font-extrabold">${modalDraft.benchIds.length}</span> (Target: ${expectedBench})`;
  }

  const randGkBtn = document.getElementById('modalRandomGkBtn');
  if (randGkBtn) {
    const showGk = state.trackPositions && (state.slots.GK || 0) > 0;
    randGkBtn.classList.toggle('hidden', !showGk);
  }

  const listEl = document.getElementById('modalPlayerList');
  if (!listEl) return;

  const availZones = ['FWD', 'MID', 'DEF', 'GK'].filter(z => (state.slots[z] || 0) > 0);
  if (availZones.length === 0) availZones.push('MID');

  listEl.innerHTML = presentPlayers.map(p => {
    const isBench = modalDraft.benchIds.includes(p.id);
    const curPos = modalDraft.positions[p.id] || availZones[0];

    const posButtons = (!isBench && state.trackPositions)
      ? availZones.map(z => `
          <button onclick="setModalPlayerPos('${p.id}', '${z}')"
            class="px-2 py-1 rounded-lg text-xs font-extrabold transition ${
              curPos === z ? `pos-${z} ring-1 ring-white/40` : 'bg-slate-900 text-slate-400 border border-slate-800'
            }">
            ${z}
          </button>
        `).join('')
      : '';

    return `
      <div class="flex items-center justify-between gap-2 bg-slate-950 border ${isBench ? 'border-slate-800' : 'border-emerald-500/30'} rounded-xl p-2.5">
        <div class="font-bold text-xs ${isBench ? 'text-slate-400' : 'text-white'} truncate">
          ${escapeHtml(formatPlayerBadge(p))}
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          ${posButtons}
          <button onclick="toggleModalPlayerBench('${p.id}')"
            class="px-2.5 py-1 rounded-lg text-xs font-extrabold border transition ${
              isBench
                ? 'pos-BENCH'
                : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
            }">
            ${isBench ? '🪑 Bench' : '🟢 Field'}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

export function toggleModalPlayerBench(playerId) {
  const idx = modalDraft.benchIds.indexOf(playerId);
  if (idx >= 0) {
    modalDraft.benchIds.splice(idx, 1);
    if (!modalDraft.positions[playerId]) {
      modalDraft.positions[playerId] = 'MID';
    }
  } else {
    modalDraft.benchIds.push(playerId);
  }
  renderEditModalContent();
}

export function setModalPlayerPos(playerId, pos) {
  modalDraft.positions[playerId] = pos;
  renderEditModalContent();
}

export function rollRandomModalGoalie() {
  const presentField = state.players.filter(p => p.present && !modalDraft.benchIds.includes(p.id));
  if (presentField.length === 0) return;

  // Clear current GK into DEF/MID first
  presentField.forEach(p => {
    if (modalDraft.positions[p.id] === 'GK') {
      modalDraft.positions[p.id] = (state.slots.DEF || 0) > 0 ? 'DEF' : 'MID';
    }
  });

  const pick = presentField[Math.floor(Math.random() * presentField.length)];
  modalDraft.positions[pick.id] = 'GK';
  renderEditModalContent();
}

export function unlockCurrentModalShift() {
  if (modalDraft.shiftIndex === null) return;
  delete state.lockedShifts[modalDraft.shiftIndex];
  closeEditModal();
  recalculateSchedule(true);
  renderAll();
}

export function saveModalShift() {
  if (modalDraft.shiftIndex === null) return;
  state.lockedShifts[modalDraft.shiftIndex] = {
    benchIds: [...modalDraft.benchIds],
    positions: { ...modalDraft.positions }
  };
  closeEditModal();
  recalculateSchedule(true);
  renderAll();
}

// ============================================================================
// COMPLETE & ARCHIVE GAME + PAST GAME HISTORY EDITOR MODAL
// ============================================================================
export function finishAndSaveGame() {
  if (!canEditGame()) return;
  const presentPlayers = state.players.filter(p => p.present);
  if (presentPlayers.length === 0) {
    alert('Mark players present before completing a game.');
    return;
  }

  if (!confirm(`Save and archive "${state.teamName} ${state.currentMatch.ourScore} - ${state.currentMatch.oppScore} ${state.currentMatch.opponent}" to Season Stats & History?`)) {
    return;
  }

  const gameCounts = computeCurrentGameQuarterCounts();
  const goals = state.currentMatch.goals || [];
  const playerStatsSnapshot = {};

  presentPlayers.forEach(p => {
    const gc = gameCounts[p.id] || { BENCH: 0, FWD: 0, MID: 0, DEF: 0, GK: 0 };
    const pGoals = goals.filter(g => g.scorerId === p.id).length;
    const pAssists = goals.filter(g => g.assistId === p.id).length;

    p.prior.gamesPlayed = (Number(p.prior.gamesPlayed) || 0) + 1;
    p.prior.BENCH = Math.round(((Number(p.prior.BENCH) || 0) + gc.BENCH) * 100) / 100;
    p.prior.FWD = Math.round(((Number(p.prior.FWD) || 0) + gc.FWD) * 100) / 100;
    p.prior.MID = Math.round(((Number(p.prior.MID) || 0) + gc.MID) * 100) / 100;
    p.prior.DEF = Math.round(((Number(p.prior.DEF) || 0) + gc.DEF) * 100) / 100;
    p.prior.GK = Math.round(((Number(p.prior.GK) || 0) + gc.GK) * 100) / 100;
    p.prior.goals = (Number(p.prior.goals) || 0) + pGoals;
    p.prior.assists = (Number(p.prior.assists) || 0) + pAssists;

    playerStatsSnapshot[p.id] = {
      name: p.name,
      number: p.number || '',
      BENCH: gc.BENCH,
      FWD: gc.FWD,
      MID: gc.MID,
      DEF: gc.DEF,
      GK: gc.GK,
      goals: pGoals,
      assists: pAssists
    };
  });

  const rotationSnapshot = state.computedShifts.map(sh => ({
    quarter: sh.quarter,
    part: sh.part,
    benchNames: presentPlayers.filter(p => sh.benchIds.includes(p.id)).map(formatPlayerBadge)
  }));

  const historyEntry = {
    id: 'game_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    date: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    teamName: state.teamName,
    opponent: state.currentMatch.opponent || 'Opponent',
    ourScore: Number(state.currentMatch.ourScore) || 0,
    oppScore: Number(state.currentMatch.oppScore) || 0,
    goals: JSON.parse(JSON.stringify(goals)),
    playerStatsSnapshot,
    rotationSnapshot
  };

  state.gameHistory.unshift(historyEntry);

  // Reset live match for next game
  state.currentMatch = {
    opponent: 'Opponent',
    ourScore: 0,
    oppScore: 0,
    goals: []
  };
  state.lockedShifts = {};
  state.fullQuarterLocks = { 1: false, 2: false, 3: false, 4: false };
  state.players.forEach(p => { p.rsvp = null; });

  timer.quarter = 1;
  timer.viewedQuarter = 1;
  timer.activeAlertShiftIdx = null;
  timer.dismissedShiftIndices = [];
  resetTimer(false);
  recalculateSchedule(true);
  currentMainTab = 'stats';
  renderAll();
}

export function openGameDetailModal(gameId) {
  const game = (state.gameHistory || []).find(g => g.id === gameId);
  if (!game) return;

  histModalDraft = JSON.parse(JSON.stringify(game));
  if (!histModalDraft.playerStatsSnapshot) {
    histModalDraft.playerStatsSnapshot = {};
  }

  renderGameDetailModalContent();
  document.getElementById('gameDetailModal').classList.remove('hidden');
}

export function closeGameDetailModal() {
  histModalDraft = null;
  document.getElementById('gameDetailModal').classList.add('hidden');
}

function renderGameDetailModalContent() {
  if (!histModalDraft) return;
  const editable = canEditGame();

  const dateInp = document.getElementById('histEditDate');
  const teamInp = document.getElementById('histEditTeamName');
  const oppInp = document.getElementById('histEditOpponent');
  const ourInp = document.getElementById('histEditOurScore');
  const oppScoreInp = document.getElementById('histEditOppScore');

  if (dateInp) { dateInp.value = histModalDraft.date || ''; dateInp.disabled = !editable; }
  if (teamInp) { teamInp.value = histModalDraft.teamName || state.teamName; teamInp.disabled = !editable; }
  if (oppInp) { oppInp.value = histModalDraft.opponent || 'Opponent'; oppInp.disabled = !editable; }
  if (ourInp) { ourInp.value = histModalDraft.ourScore || 0; ourInp.disabled = !editable; }
  if (oppScoreInp) { oppScoreInp.value = histModalDraft.oppScore || 0; oppScoreInp.disabled = !editable; }

  document.querySelectorAll('.hist-edit-btn').forEach(btn => {
    btn.classList.toggle('hidden', !editable);
  });

  const addGoalBtn = document.getElementById('histAddGoalBtn');
  const delGameBtn = document.getElementById('histDeleteGameBtn');
  const saveGameBtn = document.getElementById('histSaveGameBtn');
  if (addGoalBtn) addGoalBtn.classList.toggle('hidden', !editable);
  if (delGameBtn) delGameBtn.classList.toggle('hidden', !editable);
  if (saveGameBtn) saveGameBtn.classList.toggle('hidden', !editable);

  // Goals List in Modal
  const goalsListEl = document.getElementById('histEditGoalsList');
  if (goalsListEl) {
    const goals = histModalDraft.goals || [];
    if (goals.length === 0) {
      goalsListEl.innerHTML = `<div class="text-xs text-slate-500 italic py-2">No goals logged for this match.</div>`;
    } else {
      const playerOpts = state.players.map(p => ({ id: p.id, label: formatPlayerBadge(p) }));
      goalsListEl.innerHTML = goals.map((gl, idx) => `
        <div class="flex flex-wrap items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs">
          <select onchange="updateHistDraftGoal(${idx}, 'quarter', this.value)" ${!editable ? 'disabled' : ''}
            class="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-emerald-300 font-bold">
            ${[1, 2, 3, 4].map(q => `<option value="${q}" ${Number(gl.quarter) === q ? 'selected' : ''}>Q${q}</option>`).join('')}
          </select>
          <select onchange="updateHistDraftGoal(${idx}, 'scorerId', this.value)" ${!editable ? 'disabled' : ''}
            class="flex-1 min-w-[120px] bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-white font-semibold">
            ${playerOpts.map(o => `<option value="${o.id}" ${gl.scorerId === o.id ? 'selected' : ''}>⚽ ${escapeHtml(o.label)}</option>`).join('')}
            <option value="OWN_GOAL" ${gl.scorerId === 'OWN_GOAL' ? 'selected' : ''}>🥅 Own Goal</option>
          </select>
          <select onchange="updateHistDraftGoal(${idx}, 'assistId', this.value)" ${!editable ? 'disabled' : ''}
            class="flex-1 min-w-[120px] bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-blue-300 font-semibold">
            <option value="">— No Assist</option>
            ${playerOpts.map(o => `<option value="${o.id}" ${gl.assistId === o.id ? 'selected' : ''}>👟 ${escapeHtml(o.label)}</option>`).join('')}
          </select>
          ${editable ? `
            <button onclick="removeHistDraftGoal(${idx})" class="px-2 py-1 rounded-lg bg-rose-500/15 text-rose-300 font-bold">✕</button>
          ` : ''}
        </div>
      `).join('');
    }
  }

  // Player Quarter Counts in Modal
  const playersListEl = document.getElementById('histEditPlayersList');
  if (playersListEl) {
    const snap = histModalDraft.playerStatsSnapshot || {};
    const pIds = Object.keys(snap);
    if (pIds.length === 0) {
      playersListEl.innerHTML = `<div class="text-xs text-slate-500 italic">No per-player quarter snapshot stored for this match.</div>`;
    } else {
      playersListEl.innerHTML = pIds.map(pid => {
        const ps = snap[pid];
        const pObj = state.players.find(x => x.id === pid);
        const label = pObj ? formatPlayerBadge(pObj) : (ps.number ? `#${ps.number} ${ps.name}` : ps.name);
        return `
          <div class="grid grid-cols-6 gap-1.5 items-center bg-slate-950 border border-slate-800 rounded-xl p-2 text-[11px]">
            <div class="col-span-2 font-bold text-white truncate">${escapeHtml(label)}</div>
            ${['BENCH', 'FWD', 'MID', 'DEF'].map(z => `
              <div class="flex flex-col items-center">
                <span class="text-[9px] text-slate-400">${z}</span>
                <input type="number" step="0.5" min="0" max="4" value="${fmtNum(ps[z] || 0)}"
                  ${!editable ? 'disabled' : ''}
                  onchange="updateHistDraftPlayerStat('${pid}', '${z}', this.value)"
                  class="w-12 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-center mono font-bold text-white" />
              </div>
            `).join('')}
          </div>
        `;
      }).join('');
    }
  }

  // Rotation Snapshot
  const rotSec = document.getElementById('histRotationSnapshotSection');
  const rotList = document.getElementById('histRotationSnapshotList');
  if (rotSec && rotList) {
    const snaps = histModalDraft.rotationSnapshot || [];
    if (snaps.length === 0) {
      rotSec.classList.add('hidden');
    } else {
      rotSec.classList.remove('hidden');
      rotList.innerHTML = snaps.map(s => `
        <div class="bg-slate-950 border border-slate-800 rounded-xl p-2">
          <div class="font-bold text-emerald-300">Q${s.quarter} • Shift ${s.part}</div>
          <div class="text-slate-400">🪑 Bench: ${escapeHtml((s.benchNames || []).join(', ') || 'None')}</div>
        </div>
      `).join('');
    }
  }
}

export function adjustHistDraftScore(side, delta) {
  if (!histModalDraft || !canEditGame()) return;
  if (side === 'our') {
    histModalDraft.ourScore = Math.max(0, (Number(histModalDraft.ourScore) || 0) + delta);
  } else {
    histModalDraft.oppScore = Math.max(0, (Number(histModalDraft.oppScore) || 0) + delta);
  }
  renderGameDetailModalContent();
}

export function addHistDraftGoal() {
  if (!histModalDraft || !canEditGame()) return;
  const firstP = state.players[0];
  const scorerId = firstP ? firstP.id : 'OWN_GOAL';
  histModalDraft.goals = histModalDraft.goals || [];
  histModalDraft.goals.push({
    id: 'hg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
    quarter: 1,
    clock: '04:00',
    scorerId,
    assistId: null,
    scorerLabel: getPlayerDisplayById(scorerId),
    assistLabel: null
  });
  histModalDraft.ourScore = histModalDraft.goals.length;
  renderGameDetailModalContent();
}

export function updateHistDraftGoal(idx, field, val) {
  if (!histModalDraft || !histModalDraft.goals || !histModalDraft.goals[idx]) return;
  const g = histModalDraft.goals[idx];
  if (field === 'quarter') {
    g.quarter = parseInt(val, 10) || 1;
  } else if (field === 'scorerId') {
    g.scorerId = val;
    g.scorerLabel = getPlayerDisplayById(val);
  } else if (field === 'assistId') {
    g.assistId = val || null;
    g.assistLabel = val ? getPlayerDisplayById(val) : null;
  }
  renderGameDetailModalContent();
}

export function removeHistDraftGoal(idx) {
  if (!histModalDraft || !histModalDraft.goals) return;
  histModalDraft.goals.splice(idx, 1);
  histModalDraft.ourScore = Math.max(0, (Number(histModalDraft.ourScore) || 1) - 1);
  renderGameDetailModalContent();
}

export function updateHistDraftPlayerStat(playerId, zone, val) {
  if (!histModalDraft || !histModalDraft.playerStatsSnapshot || !histModalDraft.playerStatsSnapshot[playerId]) return;
  histModalDraft.playerStatsSnapshot[playerId][zone] = Math.max(0, parseFloat(val) || 0);
}

export function saveGameDetailEdits() {
  if (!histModalDraft || !canEditGame()) return;
  const origIdx = state.gameHistory.findIndex(g => g.id === histModalDraft.id);
  if (origIdx === -1) return;

  const origGame = state.gameHistory[origIdx];

  // Sync top-level text/number inputs from modal
  const dateInp = document.getElementById('histEditDate');
  const teamInp = document.getElementById('histEditTeamName');
  const oppInp = document.getElementById('histEditOpponent');
  const ourInp = document.getElementById('histEditOurScore');
  const oppScoreInp = document.getElementById('histEditOppScore');

  if (dateInp) histModalDraft.date = dateInp.value.trim();
  if (teamInp) histModalDraft.teamName = teamInp.value.trim();
  if (oppInp) histModalDraft.opponent = oppInp.value.trim();
  if (ourInp) histModalDraft.ourScore = Math.max(0, parseInt(ourInp.value, 10) || 0);
  if (oppScoreInp) histModalDraft.oppScore = Math.max(0, parseInt(oppScoreInp.value, 10) || 0);

  // Reconcile goals & assists delta into player.prior
  state.players.forEach(p => {
    const oldGoals = (origGame.goals || []).filter(g => g.scorerId === p.id).length;
    const newGoals = (histModalDraft.goals || []).filter(g => g.scorerId === p.id).length;
    p.prior.goals = Math.max(0, (Number(p.prior.goals) || 0) + (newGoals - oldGoals));

    const oldAssists = (origGame.goals || []).filter(g => g.assistId === p.id).length;
    const newAssists = (histModalDraft.goals || []).filter(g => g.assistId === p.id).length;
    p.prior.assists = Math.max(0, (Number(p.prior.assists) || 0) + (newAssists - oldAssists));

    const oldSnap = (origGame.playerStatsSnapshot || {})[p.id];
    const newSnap = (histModalDraft.playerStatsSnapshot || {})[p.id];
    if (oldSnap && newSnap) {
      ['BENCH', 'FWD', 'MID', 'DEF', 'GK'].forEach(z => {
        const delta = (Number(newSnap[z]) || 0) - (Number(oldSnap[z]) || 0);
        p.prior[z] = Math.max(0, Math.round(((Number(p.prior[z]) || 0) + delta) * 100) / 100);
      });
      newSnap.goals = newGoals;
      newSnap.assists = newAssists;
    }
  });

  state.gameHistory[origIdx] = histModalDraft;
  closeGameDetailModal();
  recalculateSchedule(true);
  renderAll();
}

export function deleteCurrentModalHistoryGame() {
  if (!histModalDraft || !canEditGame()) return;
  if (!confirm('Delete this game from history and subtract its stats from season totals?')) return;

  const origIdx = state.gameHistory.findIndex(g => g.id === histModalDraft.id);
  if (origIdx === -1) return;
  const origGame = state.gameHistory[origIdx];

  state.players.forEach(p => {
    const oldGoals = (origGame.goals || []).filter(g => g.scorerId === p.id).length;
    const oldAssists = (origGame.goals || []).filter(g => g.assistId === p.id).length;
    p.prior.goals = Math.max(0, (Number(p.prior.goals) || 0) - oldGoals);
    p.prior.assists = Math.max(0, (Number(p.prior.assists) || 0) - oldAssists);

    const oldSnap = (origGame.playerStatsSnapshot || {})[p.id];
    if (oldSnap) {
      p.prior.gamesPlayed = Math.max(0, (Number(p.prior.gamesPlayed) || 1) - 1);
      ['BENCH', 'FWD', 'MID', 'DEF', 'GK'].forEach(z => {
        p.prior[z] = Math.max(0, Math.round(((Number(p.prior[z]) || 0) - (Number(oldSnap[z]) || 0)) * 100) / 100);
      });
    }
  });

  state.gameHistory.splice(origIdx, 1);
  closeGameDetailModal();
  recalculateSchedule(true);
  renderAll();
}

// ============================================================================
// FEEDBACK EMBED & PWA INSTALL PROMPT
// ============================================================================
export function toggleFeedbackEmbed() {
  const container = document.getElementById('feedbackEmbedContainer');
  const iframe = document.getElementById('feedbackIframe');
  const btn = document.getElementById('toggleFeedbackEmbedBtn');
  if (!container || !iframe) return;

  const isHidden = container.classList.contains('hidden');
  if (isHidden) {
    if (!iframe.getAttribute('src')) {
      iframe.setAttribute('src', iframe.getAttribute('data-src'));
    }
    container.classList.remove('hidden');
    if (btn) btn.textContent = '✕ Hide Inline Form';
  } else {
    container.classList.add('hidden');
    if (btn) btn.textContent = '📝 Fill Out Inline';
  }
}

export async function triggerPwaInstall() {
  if (!deferredPwaPrompt) return;
  deferredPwaPrompt.prompt();
  await deferredPwaPrompt.userChoice;
  deferredPwaPrompt = null;
  const btn = document.getElementById('pwaInstallBtn');
  if (btn) btn.classList.add('hidden');
}

function setupPwaInstallListeners() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPwaPrompt = e;
    const btn = document.getElementById('pwaInstallBtn');
    if (btn) {
      btn.classList.remove('hidden');
      btn.classList.add('flex');
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

// ============================================================================
// BIND ALL INLINE HANDLERS TO WINDOW & BOOTSTRAP APPLICATION
// ============================================================================
Object.assign(window, {
  // Cloud & Auth
  openCoachAuthModal,
  closeCoachAuthModal,
  handleGoogleCoachLogin,
  handleEmailCoachAuth,
  handleCoachSignOut,
  openInviteModal,
  closeInviteModal,
  shareRoleLink,

  // Engine & Timer
  selectViewedQuarter: (q) => {
    viewedShiftPartOverride = null;
    selectViewedQuarter(q);
  },
  activateViewedQuarterClock: () => {
    viewedShiftPartOverride = null;
    activateViewedQuarterClock();
  },
  toggleTimer,
  adjustTimer,
  syncMidQuarter,
  resetTimer,
  setAlertSoundMode,
  cycleAlertSoundMode,
  playAlertSignal,
  dismissActiveSubAlert,

  // App UI & Controllers
  switchMainTab,
  toggleDrawer,
  handleTeamSelectChange,
  createNewTeamPrompt,
  deleteCurrentTeam,
  updateTeamName,
  handleFormationChange,
  handleQuarterSelectChange,
  handleCustomQuarterInput,
  handleTimingChange,
  adjustSlot,
  togglePositionMode,
  addPlayer,
  addPlayerFromOnboarding,
  updatePlayerNumber,
  updatePlayerName,
  updatePlayerPriorBench,
  removePlayer,
  resetSeasonHistory,
  selectParentIdentity,
  clearParentIdentity,
  submitParentRsvp,
  toggleAttendance,
  setAllAttendance,
  rotateStarterOrder,
  setRosterSort,
  setViewedShiftPart,
  activateQueuedSubNow,
  toggleFullQuarterLock,
  clearAllLocks,
  toggleBalanceSort,
  toggleStatsSort,
  setSmsStyle,
  copySingleSms,
  copyAllSms,
  updateOpponentName,
  adjustOpponentScore,
  openGoalModal,
  closeGoalModal,
  selectGoalScorer,
  selectGoalAssist,
  confirmGoalLog,
  deleteMatchGoal,
  openEditModal,
  closeEditModal,
  toggleModalPlayerBench,
  setModalPlayerPos,
  rollRandomModalGoalie,
  unlockCurrentModalShift,
  saveModalShift,
  finishAndSaveGame,
  openGameDetailModal,
  closeGameDetailModal,
  adjustHistDraftScore,
  addHistDraftGoal,
  updateHistDraftGoal,
  removeHistDraftGoal,
  updateHistDraftPlayerStat,
  saveGameDetailEdits,
  deleteCurrentModalHistoryGame,
  toggleFeedbackEmbed,
  triggerPwaInstall
});

// Register engine hooks & start app
registerEngineCallbacks({
  onRenderAll: renderAll,
  onCanEdit: canEditGame
});

loadFromLocalStorage();
setupPwaInstallListeners();
renderAll();
initFirebaseConnection();


