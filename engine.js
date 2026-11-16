// ============================================================================
// engine.js — Core State, Fairness Rotation Engine, Timer & Ref-Safe Audio
// ============================================================================

export const MULTI_TEAM_STORAGE_KEY = 'soccer_sub_pos_stats_v4_multiteam';
export const LEGACY_STORAGE_KEY = 'soccer_sub_pos_stats_v3';
export const PRESET_QUARTER_VALUES = [6, 8, 10, 12, 12.5, 15];

export const ALERT_SOUND_MODES = [
  { key: 'chime',   label: '🔔 Chime',   shortLabel: '🔔 Chime' },
  { key: 'beep',    label: '📟 Beep',    shortLabel: '📟 Beep' },
  { key: 'vibrate', label: '📳 Vibrate', shortLabel: '📳 Vibrate' },
  { key: 'whistle', label: '📣 Whistle', shortLabel: '📣 Whistle' },
  { key: 'mute',    label: '🔇 Mute',    shortLabel: '🔇 Mute' }
];

export const FORMATION_PRESETS = {
  '5v5_212':  { label: '5v5 (2-1-2)',     slots: { FWD: 2, MID: 1, DEF: 2, GK: 0 } },
  '5v5_32':   { label: '5v5 (3-2)',       slots: { FWD: 3, MID: 0, DEF: 2, GK: 0 } },
  '4v4_22':   { label: '4v4 (2-2)',       slots: { FWD: 2, MID: 0, DEF: 2, GK: 0 } },
  '5v5_gk':   { label: '5v5 + GK',        slots: { FWD: 2, MID: 0, DEF: 2, GK: 1 } },
  '6v6_gk':   { label: '6v6 (2-1-2+GK)',  slots: { FWD: 2, MID: 1, DEF: 2, GK: 1 } },
  '7v7_231':  { label: '7v7 (2-3-1+GK)',  slots: { FWD: 2, MID: 3, DEF: 1, GK: 1 } },
  '7v7_222':  { label: '7v7 (2-2-2+GK)',  slots: { FWD: 2, MID: 2, DEF: 2, GK: 1 } },
  '9v9_332':  { label: '9v9 (2-3-3+GK)',  slots: { FWD: 2, MID: 3, DEF: 3, GK: 1 } },
  '11v11_433':{ label: '11v11 (3-3-4+GK)',slots: { FWD: 3, MID: 3, DEF: 4, GK: 1 } }
};

export function createBlankTeam(name = 'My Team') {
  return {
    id: 'team_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    editPin: String(Math.floor(1000 + Math.random() * 9000)),
    ownerUid: null,
    ownerEmail: null,
    v5QuarterScale: true,
    updatedAt: Date.now(),
    teamName: name,
    trackPositions: true,
    smsStyle: 'positions',
    alertSoundMode: 'chime', // Default to non-whistle Chime so it never confuses the ref
    formationKey: '5v5_212',
    slots: { FWD: 2, MID: 1, DEF: 2, GK: 0 },
    quarterMins: 8,
    shiftsPerQuarter: 2,
    midQtrPosSwap: false,
    rosterSort: 'order',
    balanceSort: { col: 'order', dir: 'asc' },
    statsSort: { col: 'pts', dir: 'desc' },
    players: [],
    lockedShifts: {},
    fullQuarterLocks: { 1: false, 2: false, 3: false, 4: false },
    computedShifts: [],
    currentMatch: {
      opponent: 'Opponent',
      ourScore: 0,
      oppScore: 0,
      goals: []
    },
    timerSync: {
      quarter: 1,
      running: false,
      endTimeMs: null,
      remainingSec: 480,
      midAlertFired: false,
      activeAlertShiftIdx: null,
      dismissedShiftIndices: []
    },
    gameHistory: []
  };
}

export let appStore = {
  activeTeamId: null,
  teams: []
};

export let state = createBlankTeam();

export function setState(newState) {
  state = newState;
}

export let timer = {
  quarter: 1,         // The quarter the clock is actively timing
  viewedQuarter: 1,   // The quarter currently being inspected in the UI
  secondsLeft: 8 * 60,
  running: false,
  intervalId: null,
  midAlertFired: false,
  activeAlertShiftIdx: null,
  dismissedShiftIndices: []
};

// Callback hooks registered by app.js and cloud.js to avoid circular dependencies
let renderAllCallback = () => {};
let cloudPushCallback = () => {};
let canEditCallback = () => true;

export function registerEngineCallbacks({ onRenderAll, onCanEdit }) {
  if (onRenderAll) renderAllCallback = onRenderAll;
  if (onCanEdit) canEditCallback = onCanEdit;
}

export function setCloudPushHandler(fn) {
  cloudPushCallback = fn;
}

export function triggerRenderAll() {
  renderAllCallback();
}

// ============================================================================
// FORMATTING & DURATION HELPERS
// ============================================================================
export function getQuarterTotalSeconds(qMins = state.quarterMins) {
  return Math.max(30, Math.round((Number(qMins) || 8) * 60));
}

export function getQuarterMidSeconds(qMins = state.quarterMins) {
  return Math.floor(getQuarterTotalSeconds(qMins) / 2);
}

export function fmtDurationLabel(minsFloat) {
  const totalSecs = Math.round((Number(minsFloat) || 0) * 60);
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  if (s === 0) return `${m}m`;
  if (s === 30) return `${m}.5m`;
  return `${m}m ${s}s`;
}

export function fmtNum(val) {
  const n = Math.round((Number(val) || 0) * 100) / 100;
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
}

export function comparePlayerNumbers(a, b) {
  const numA = parseInt(a.number, 10);
  const numB = parseInt(b.number, 10);
  const validA = !isNaN(numA);
  const validB = !isNaN(numB);
  if (validA && validB) {
    if (numA !== numB) return numA - numB;
  } else if (validA !== validB) {
    return validA ? -1 : 1;
  }
  return (a.name || '').localeCompare(b.name || '');
}

export function getShiftQuarterWeight(shiftsPerQuarter = state.shiftsPerQuarter) {
  return shiftsPerQuarter === 1 ? 1.0 : 0.5;
}

export function formatPlayerBadge(player) {
  if (!player) return '';
  return player.number ? `#${player.number} ${player.name}` : player.name;
}

export function getPlayerDisplayById(id) {
  if (id === 'OWN_GOAL') return 'Own Goal';
  const p = state.players.find(x => x.id === id);
  return p ? formatPlayerBadge(p) : 'Team Goal';
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

// ============================================================================
// NORMALIZATION & STORAGE PERSISTENCE
// ============================================================================
export function normalizeTeamObject(rawTeam) {
  const base = createBlankTeam(rawTeam.teamName || 'My Team');
  const merged = { ...base, ...rawTeam };

  delete merged.activeTab;

  merged.quarterMins = parseFloat(rawTeam.quarterMins) || 8;
  merged.midQtrPosSwap = Boolean(rawTeam.midQtrPosSwap);
  merged.alertSoundMode = rawTeam.alertSoundMode || 'chime';
  merged.editPin = String(rawTeam.editPin || base.editPin);
  merged.rosterSort = rawTeam.rosterSort || 'order';
  merged.balanceSort = rawTeam.balanceSort || { col: 'order', dir: 'asc' };
  merged.statsSort = rawTeam.statsSort || { col: 'pts', dir: 'desc' };
  merged.lockedShifts = rawTeam.lockedShifts || {};
  merged.fullQuarterLocks = { 1: false, 2: false, 3: false, 4: false, ...(rawTeam.fullQuarterLocks || {}) };

  const needsV5ScaleMigration = !rawTeam.v5QuarterScale && (rawTeam.shiftsPerQuarter || 2) === 2;

  merged.players = (merged.players || []).map(p => {
    const prior = {
      BENCH: 0, FWD: 0, MID: 0, DEF: 0, GK: 0,
      gamesPlayed: 0, goals: 0, assists: 0,
      ...(p.prior || {})
    };

    if (needsV5ScaleMigration) {
      const totalShiftSum = (prior.BENCH || 0) + (prior.FWD || 0) + (prior.MID || 0) + (prior.DEF || 0) + (prior.GK || 0);
      if (totalShiftSum > 0) {
        ['BENCH', 'FWD', 'MID', 'DEF', 'GK'].forEach(z => {
          prior[z] = Math.round((prior[z] || 0) * 0.5 * 10) / 10;
        });
      }
    }

    return {
      ...p,
      number: p.number || '',
      rsvp: p.rsvp || null,
      prior
    };
  });

  merged.v5QuarterScale = true;
  merged.currentMatch = {
    opponent: 'Opponent',
    ourScore: 0,
    oppScore: 0,
    goals: [],
    ...(rawTeam.currentMatch || {})
  };
  merged.timerSync = {
    quarter: 1,
    running: false,
    endTimeMs: null,
    remainingSec: getQuarterTotalSeconds(merged.quarterMins),
    midAlertFired: false,
    activeAlertShiftIdx: null,
    dismissedShiftIndices: [],
    ...(rawTeam.timerSync || {})
  };
  merged.gameHistory = (rawTeam.gameHistory || []).map(g => ({
    ...g,
    goals: (g.goals || []).map((gl, i) => ({
      id: gl.id || ('hg_' + i + '_' + Date.now()),
      quarter: gl.quarter || 1,
      clock: gl.clock || '04:00',
      scorerId: gl.scorerId || null,
      assistId: gl.assistId || null,
      scorerLabel: gl.scorerLabel || 'Goal',
      assistLabel: gl.assistLabel || null
    }))
  }));

  return merged;
}

export function syncActiveTeamPointer() {
  if (!appStore.teams || appStore.teams.length === 0) {
    const initial = createBlankTeam('Team 1');
    appStore.teams = [initial];
    appStore.activeTeamId = initial.id;
  }
  let found = appStore.teams.find(t => t.id === appStore.activeTeamId);
  if (!found) {
    found = appStore.teams[0];
    appStore.activeTeamId = found.id;
  }
  state = found;
}

export function getSerializablePayload() {
  return {
    id: state.id,
    editPin: state.editPin,
    ownerUid: state.ownerUid || null,
    ownerEmail: state.ownerEmail || null,
    activeTab: 'game',
    v5QuarterScale: true,
    teamName: state.teamName,
    trackPositions: state.trackPositions,
    smsStyle: state.smsStyle,
    alertSoundMode: state.alertSoundMode || 'chime',
    formationKey: state.formationKey,
    slots: state.slots,
    quarterMins: state.quarterMins,
    shiftsPerQuarter: state.shiftsPerQuarter,
    midQtrPosSwap: Boolean(state.midQtrPosSwap),
    rosterSort: state.rosterSort,
    players: state.players,
    lockedShifts: state.lockedShifts,
    fullQuarterLocks: state.fullQuarterLocks,
    currentMatch: state.currentMatch,
    timerSync: state.timerSync,
    gameHistory: state.gameHistory
  };
}

export function saveState(syncCloud = true) {
  state.updatedAt = Date.now();
  try {
    localStorage.setItem(MULTI_TEAM_STORAGE_KEY, JSON.stringify({
      activeTeamId: appStore.activeTeamId,
      teams: appStore.teams
    }));
  } catch (e) {
    console.warn('Save error:', e);
  }
  if (syncCloud && canEditCallback()) {
    cloudPushCallback();
  }
}

// ============================================================================
// FAIR BENCH + POSITION ROTATION ENGINE (ABSENCE-NEUTRAL + 4-QTR LOOKAHEAD)
// ============================================================================
export function getTotalFieldSlots() {
  return (state.slots.FWD || 0) + (state.slots.MID || 0) + (state.slots.DEF || 0) + (state.slots.GK || 0);
}

export function getTotalShiftsCount() {
  return 4 * state.shiftsPerQuarter;
}

function buildSwappedFwdDefPositions(prevPosMap, fieldPlayers) {
  const swapped = {};
  const fwdIds = [];
  const defIds = [];

  fieldPlayers.forEach(p => {
    const prevZone = prevPosMap[p.id] || 'MID';
    if (prevZone === 'FWD') fwdIds.push(p.id);
    else if (prevZone === 'DEF') defIds.push(p.id);
    else swapped[p.id] = prevZone;
  });

  fwdIds.forEach(id => { swapped[id] = 'DEF'; });
  defIds.forEach(id => { swapped[id] = 'FWD'; });
  return swapped;
}

export function computeEffectivePriorBenchMap(presentPlayers) {
  const map = {};
  const maxGP = presentPlayers.reduce((m, p) => Math.max(m, Number(p.prior.gamesPlayed) || 0), 0);

  const activePriors = presentPlayers
    .filter(p => (Number(p.prior.gamesPlayed) || 0) > 0 || (Number(p.prior.BENCH) || 0) > 0)
    .map(p => Number(p.prior.BENCH) || 0);
  const avgPrior = activePriors.length > 0
    ? activePriors.reduce((a, b) => a + b, 0) / activePriors.length
    : 0;

  presentPlayers.forEach(p => {
    const rawBench = Number(p.prior.BENCH) || 0;
    const gp = Number(p.prior.gamesPlayed) || 0;

    if (p.prior.manualBenchOverride || maxGP <= 1 || gp >= maxGP) {
      map[p.id] = rawBench;
    } else if (gp > 0) {
      map[p.id] = Math.round(((rawBench / gp) * maxGP) * 100) / 100;
    } else if (rawBench > 0) {
      map[p.id] = rawBench;
    } else {
      map[p.id] = Math.round(avgPrior * 100) / 100;
    }
  });

  return map;
}

export function recalculateSchedule(syncCloud = true) {
  const presentPlayers = state.players.filter(p => p.present);
  const numPresent = presentPlayers.length;
  const fieldSize = getTotalFieldSlots();
  const numSitting = Math.max(0, numPresent - fieldSize);
  const totalShifts = getTotalShiftsCount();
  const shiftWeight = getShiftQuarterWeight(state.shiftsPerQuarter);
  const effectivePriorMap = computeEffectivePriorBenchMap(presentPlayers);

  const runningCounts = {};
  presentPlayers.forEach(p => {
    runningCounts[p.id] = { BENCH: 0, FWD: 0, MID: 0, DEF: 0, GK: 0 };
  });

  const shifts = [];

  for (let s = 0; s < totalShifts; s++) {
    const quarter = Math.floor(s / state.shiftsPerQuarter) + 1;
    const part = (s % state.shiftsPerQuarter) + 1;
    const prevShift = s > 0 ? shifts[s - 1] : null;

    let benchIds = [];
    let posMap = {};
    let isLocked = false;
    let isMidQtrPosSwapShift = false;

    if (numPresent === 0) {
      shifts.push({ index: s, quarter, part, benchIds: [], positions: {}, locked: false, isMidQtrPosSwapShift: false });
      continue;
    }

    if (state.shiftsPerQuarter === 2 && part === 2 && state.fullQuarterLocks[quarter] && prevShift) {
      benchIds = [...prevShift.benchIds];
      posMap = { ...prevShift.positions };
      isLocked = true;
    } else if (state.lockedShifts[s]) {
      const lock = state.lockedShifts[s];
      benchIds = lock.benchIds.filter(id => presentPlayers.some(p => p.id === id));
      posMap = { ...(lock.positions || {}) };
      isLocked = true;
    } else if (state.shiftsPerQuarter === 2 && part === 2 && state.midQtrPosSwap && prevShift) {
      benchIds = [...prevShift.benchIds];
      const fieldPlayers = presentPlayers.filter(p => !benchIds.includes(p.id));
      posMap = buildSwappedFwdDefPositions(prevShift.positions || {}, fieldPlayers);
      isMidQtrPosSwapShift = true;
    } else {
      const candidates = presentPlayers.map((p, idx) => {
        const satPrev = prevShift ? prevShift.benchIds.includes(p.id) : false;
        const effPrior = effectivePriorMap[p.id] || 0;
        const gameBench = runningCounts[p.id].BENCH;
        const totalBench = Math.round((effPrior + gameBench) * 100) / 100;
        const isLateFirstShift = (s === 0 && p.rsvp === 'late');
        return {
          id: p.id,
          idx,
          satPrev,
          isLateFirstShift,
          effPrior,
          gameBench,
          totalBench
        };
      });

      const isSecondHalfOfGame = quarter >= 3;

      candidates.sort((a, b) => {
        if (a.isLateFirstShift !== b.isLateFirstShift) return a.isLateFirstShift ? -1 : 1;
        if (a.satPrev !== b.satPrev) return a.satPrev ? 1 : -1;
        if (Math.abs(a.totalBench - b.totalBench) > 0.01) return a.totalBench - b.totalBench;

        if (isSecondHalfOfGame) {
          if (Math.abs(a.gameBench - b.gameBench) > 0.01) return a.gameBench - b.gameBench;
          if (Math.abs(a.effPrior - b.effPrior) > 0.01) return a.effPrior - b.effPrior;
        } else {
          if (Math.abs(a.effPrior - b.effPrior) > 0.01) return a.effPrior - b.effPrior;
          if (Math.abs(a.gameBench - b.gameBench) > 0.01) return a.gameBench - b.gameBench;
        }
        return a.idx - b.idx;
      });

      benchIds = candidates.slice(0, numSitting).map(c => c.id);
    }

    const fieldPlayers = presentPlayers.filter(p => !benchIds.includes(p.id));
    const needsPositionAssignment = fieldPlayers.some(p => !posMap[p.id]);
    if (needsPositionAssignment) {
      posMap = assignFairPositions(fieldPlayers, runningCounts, prevShift, posMap);
    }

    presentPlayers.forEach(p => {
      if (benchIds.includes(p.id)) {
        runningCounts[p.id].BENCH = Math.round((runningCounts[p.id].BENCH + shiftWeight) * 100) / 100;
      } else {
        const assignedPos = posMap[p.id] || 'MID';
        runningCounts[p.id][assignedPos] = Math.round(((runningCounts[p.id][assignedPos] || 0) + shiftWeight) * 100) / 100;
      }
    });

    shifts.push({
      index: s,
      quarter,
      part,
      benchIds,
      positions: posMap,
      locked: isLocked,
      isMidQtrPosSwapShift
    });
  }

  state.computedShifts = shifts;
  saveState(syncCloud);
}

function assignFairPositions(fieldPlayers, runningCounts, prevShift, existingPosMap = {}) {
  const result = {};
  const unassigned = [];

  const remainingSlots = {
    GK: state.slots.GK || 0,
    DEF: state.slots.DEF || 0,
    MID: state.slots.MID || 0,
    FWD: state.slots.FWD || 0
  };

  fieldPlayers.forEach(p => {
    const lockedPos = existingPosMap[p.id];
    if (lockedPos && remainingSlots[lockedPos] > 0) {
      result[p.id] = lockedPos;
      remainingSlots[lockedPos]--;
    } else {
      unassigned.push(p);
    }
  });

  const slotPool = [];
  ['GK', 'FWD', 'DEF', 'MID'].forEach(zone => {
    for (let i = 0; i < (remainingSlots[zone] || 0); i++) {
      slotPool.push(zone);
    }
  });

  while (slotPool.length < unassigned.length) {
    slotPool.push('MID');
  }

  const usedPlayers = new Set();

  slotPool.slice(0, unassigned.length).forEach(zone => {
    let bestPlayer = null;
    let bestScore = Infinity;

    unassigned.forEach((p, idx) => {
      if (usedPlayers.has(p.id)) return;
      const totalInZone = (p.prior[zone] || 0) + (runningCounts[p.id][zone] || 0);
      const gameInZone = runningCounts[p.id][zone] || 0;
      const prevPos = prevShift && prevShift.positions ? prevShift.positions[p.id] : null;
      const repeatPenalty = prevPos === zone ? 1.25 : 0;

      const score = (totalInZone * 10) + (gameInZone * 4) + (repeatPenalty * 10) + (idx * 0.01);
      if (score < bestScore) {
        bestScore = score;
        bestPlayer = p;
      }
    });

    if (bestPlayer) {
      result[bestPlayer.id] = zone;
      usedPlayers.add(bestPlayer.id);
    }
  });

  return result;
}

// ============================================================================
// TIMER, AUTO-ADVANCE, BACKGROUND PERSISTENCE & STAGED ALERTS
// ============================================================================
export function isQuarterFullSub(q = timer.quarter) {
  return state.shiftsPerQuarter === 1 || !!state.fullQuarterLocks[q];
}

export function getActiveShiftObject(forViewedQuarter = false) {
  const q = forViewedQuarter ? (timer.viewedQuarter || timer.quarter) : timer.quarter;
  if (state.shiftsPerQuarter === 1) {
    return state.computedShifts.find(s => s.quarter === q && s.part === 1) || state.computedShifts[0];
  }
  const midSec = getQuarterMidSeconds(state.quarterMins);
  const isClockQuarter = q === timer.quarter;
  const activePart = (state.fullQuarterLocks[q] || !isClockQuarter || timer.secondsLeft > midSec) ? 1 : 2;
  return state.computedShifts.find(s => s.quarter === q && s.part === activePart) || state.computedShifts[0];
}

// Returns the next upcoming shift to display in the Queued Next Change card below In-Play
export function getNextQueuedShiftObject() {
  const currentShift = getActiveShiftObject(false);
  if (!currentShift || !state.computedShifts.length) return null;

  const dismissed = new Set(timer.dismissedShiftIndices || []);
  for (let i = currentShift.index + 1; i < state.computedShifts.length; i++) {
    const candidate = state.computedShifts[i];
    // Skip 2nd half of a locked full quarter
    if (state.shiftsPerQuarter === 2 && candidate.part === 2 && state.fullQuarterLocks[candidate.quarter]) {
      continue;
    }
    // Skip if this shift is currently in the active top alert banner or already dismissed
    if (timer.activeAlertShiftIdx === candidate.index || dismissed.has(candidate.index)) {
      continue;
    }
    return candidate;
  }
  return null;
}

export function syncTimerToStateAndCloud() {
  state.timerSync = {
    quarter: timer.quarter,
    running: timer.running,
    endTimeMs: timer.running ? (Date.now() + timer.secondsLeft * 1000) : null,
    remainingSec: timer.secondsLeft,
    midAlertFired: timer.midAlertFired,
    activeAlertShiftIdx: timer.activeAlertShiftIdx,
    dismissedShiftIndices: timer.dismissedShiftIndices || []
  };
  saveState(true);
}

export function applyCloudTimerState() {
  const ts = state.timerSync;
  if (!ts) return;

  const prevClockQtr = timer.quarter;
  timer.quarter = ts.quarter || 1;
  if (!timer.viewedQuarter || timer.viewedQuarter === prevClockQtr) {
    timer.viewedQuarter = timer.quarter;
  }
  timer.midAlertFired = !!ts.midAlertFired;
  timer.activeAlertShiftIdx = typeof ts.activeAlertShiftIdx === 'number' ? ts.activeAlertShiftIdx : null;
  timer.dismissedShiftIndices = Array.isArray(ts.dismissedShiftIndices) ? ts.dismissedShiftIndices : [];

  if (timer.intervalId) {
    clearInterval(timer.intervalId);
    timer.intervalId = null;
  }

  if (ts.running && ts.endTimeMs) {
    const left = Math.max(0, Math.ceil((ts.endTimeMs - Date.now()) / 1000));
    timer.secondsLeft = left;
    timer.running = left > 0;
    if (timer.running) {
      timer.intervalId = setInterval(tickTimer, 1000);
    }
  } else {
    timer.running = false;
    timer.secondsLeft = typeof ts.remainingSec === 'number'
      ? ts.remainingSec
      : getQuarterTotalSeconds(state.quarterMins);
  }
}

export function triggerSubAlertForShift(shiftIdx) {
  timer.activeAlertShiftIdx = shiftIdx;
}

export function dismissActiveSubAlert() {
  if (timer.activeAlertShiftIdx !== null) {
    if (!timer.dismissedShiftIndices.includes(timer.activeAlertShiftIdx)) {
      timer.dismissedShiftIndices.push(timer.activeAlertShiftIdx);
    }
    timer.activeAlertShiftIdx = null;
    syncTimerToStateAndCloud();
    triggerRenderAll();
  }
}

export function toggleTimer() {
  if (!canEditCallback()) return;

  // If coach is previewing a different quarter while the timer is stopped, pressing Start activates that quarter
  if (!timer.running && timer.viewedQuarter !== timer.quarter) {
    timer.quarter = timer.viewedQuarter;
    timer.secondsLeft = getQuarterTotalSeconds(state.quarterMins);
    timer.midAlertFired = false;
  }

  if (timer.running) {
    clearInterval(timer.intervalId);
    timer.running = false;
  } else {
    if (timer.secondsLeft <= 0) {
      timer.secondsLeft = getQuarterTotalSeconds(state.quarterMins);
      timer.midAlertFired = false;
    }
    timer.running = true;
    timer.intervalId = setInterval(tickTimer, 1000);
  }
  syncTimerToStateAndCloud();
  triggerRenderAll();
}

export function tickTimer() {
  if (timer.running && state.timerSync && state.timerSync.endTimeMs) {
    timer.secondsLeft = Math.max(0, Math.ceil((state.timerSync.endTimeMs - Date.now()) / 1000));
  } else if (timer.secondsLeft > 0) {
    timer.secondsLeft--;
  }

  const midSec = getQuarterMidSeconds(state.quarterMins);

  // 1. Mid-Quarter Alert Trigger
  if (!isQuarterFullSub(timer.quarter) && timer.secondsLeft <= midSec && !timer.midAlertFired) {
    timer.midAlertFired = true;
    if (canEditCallback()) playAlertSignal(2);
    const midShift = state.computedShifts.find(s => s.quarter === timer.quarter && s.part === 2);
    if (midShift) {
      triggerSubAlertForShift(midShift.index);
    }
    if (canEditCallback()) syncTimerToStateAndCloud();
  }

  // 2. End of Quarter: Stop Clock & Auto-Advance to Next Quarter (Do Not Auto-Start)
  if (timer.secondsLeft <= 0) {
    clearInterval(timer.intervalId);
    timer.running = false;
    if (canEditCallback()) playAlertSignal(3);

    if (timer.quarter < 4) {
      const nextQ = timer.quarter + 1;
      timer.quarter = nextQ;
      timer.viewedQuarter = nextQ;
      timer.secondsLeft = getQuarterTotalSeconds(state.quarterMins);
      timer.midAlertFired = false;

      const nextQShift = state.computedShifts.find(s => s.quarter === nextQ && s.part === 1);
      if (nextQShift) {
        triggerSubAlertForShift(nextQShift.index);
      }
    } else {
      timer.secondsLeft = 0;
    }

    if (canEditCallback()) {
      syncTimerToStateAndCloud();
    }
  }

  triggerRenderAll();
}

// Background Clock Persistence: Tapping another quarter previews it while keeping the running clock intact
export function selectViewedQuarter(q) {
  const fullSec = getQuarterTotalSeconds(state.quarterMins);
  const isClockRunningOrMidway = timer.running || (timer.secondsLeft < fullSec && timer.secondsLeft > 0);

  if (isClockRunningOrMidway && q !== timer.quarter) {
    timer.viewedQuarter = q;
    triggerRenderAll();
    return;
  }

  if (!canEditCallback()) {
    timer.viewedQuarter = q;
    triggerRenderAll();
    return;
  }

  timer.quarter = q;
  timer.viewedQuarter = q;
  resetTimer(true);
}

export function activateViewedQuarterClock() {
  if (!canEditCallback()) return;
  timer.quarter = timer.viewedQuarter || 1;
  resetTimer(true);
}

export function adjustTimer(deltaSec) {
  if (!canEditCallback()) return;
  const maxSec = getQuarterTotalSeconds(state.quarterMins);
  timer.secondsLeft = Math.max(0, Math.min(maxSec, timer.secondsLeft + deltaSec));
  syncTimerToStateAndCloud();
  triggerRenderAll();
}

export function syncMidQuarter() {
  if (!canEditCallback() || isQuarterFullSub(timer.quarter)) return;
  timer.secondsLeft = getQuarterMidSeconds(state.quarterMins);
  timer.midAlertFired = true;
  const midShift = state.computedShifts.find(s => s.quarter === timer.quarter && s.part === 2);
  if (midShift) {
    triggerSubAlertForShift(midShift.index);
  }
  syncTimerToStateAndCloud();
  triggerRenderAll();
}

export function resetTimer(syncToCloud = true) {
  clearInterval(timer.intervalId);
  timer.running = false;
  timer.viewedQuarter = timer.quarter;
  timer.secondsLeft = getQuarterTotalSeconds(state.quarterMins);
  timer.midAlertFired = false;
  if (syncToCloud && canEditCallback()) {
    syncTimerToStateAndCloud();
  }
  triggerRenderAll();
}

// ============================================================================
// REF-SAFE ALERT SOUNDS & VIBRATION SYNTHESIZER
// ============================================================================
export function setAlertSoundMode(mode) {
  state.alertSoundMode = mode;
  saveState(true);
  playAlertSignal(1, true);
  triggerRenderAll();
}

export function cycleAlertSoundMode() {
  const idx = ALERT_SOUND_MODES.findIndex(m => m.key === (state.alertSoundMode || 'chime'));
  const next = ALERT_SOUND_MODES[(idx + 1) % ALERT_SOUND_MODES.length];
  setAlertSoundMode(next.key);
}

export function playAlertSignal(blasts = 2, isTest = false) {
  const mode = state.alertSoundMode || 'chime';
  if (mode === 'mute') return;

  try {
    if (navigator.vibrate) {
      navigator.vibrate(blasts >= 3 ? [220, 100, 220, 100, 320] : [200, 100, 240]);
    }
    if (mode === 'vibrate') return;

    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    if (mode === 'chime') {
      // Pleasant ref-safe ascending harmonic chime (C5 -> E5 -> G5)
      const notes = [523.25, 659.25, 783.99];
      const count = isTest ? 2 : Math.min(3, Math.max(2, blasts));
      for (let i = 0; i < count; i++) {
        const start = ctx.currentTime + i * 0.18;
        const dur = 0.35;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(notes[i % notes.length], start);
        gain.gain.setValueAtTime(0.001, start);
        gain.gain.exponentialRampToValueAtTime(0.32, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + dur);
      }
    } else if (mode === 'beep') {
      // Crisp digital scoreboard double-beep (880Hz square/triangle blend)
      for (let i = 0; i < blasts; i++) {
        const start = ctx.currentTime + i * 0.22;
        const dur = 0.14;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(880, start);
        gain.gain.setValueAtTime(0.001, start);
        gain.gain.exponentialRampToValueAtTime(0.18, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + dur);
      }
    } else if (mode === 'whistle') {
      // Classic high-pitched whistle
      for (let i = 0; i < blasts; i++) {
        const start = ctx.currentTime + i * 0.35;
        const dur = i === blasts - 1 ? 0.38 : 0.22;
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        osc1.type = 'triangle';
        osc2.type = 'sine';
        osc1.frequency.setValueAtTime(2750, start);
        osc2.frequency.setValueAtTime(2830, start);
        gain.gain.setValueAtTime(0.01, start);
        gain.gain.exponentialRampToValueAtTime(0.32, start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);
        osc1.start(start);
        osc2.start(start);
        osc1.stop(start + dur);
        osc2.stop(start + dur);
      }
    }
  } catch (e) {
    console.warn('AudioContext unavailable:', e);
  }
}


