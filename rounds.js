/* ============================================================
   ROUNDS TAB -- Court setup, scheduling algorithm, rest queue, global state
   File: rounds.js
   ============================================================ */


var allRounds = [];
var lastRound = [];
var currentRoundIndex = 0;
var isOnPage2 = false;
var resetRest = false;


	
var schedulerState = {
    numCourts: 0,
    allPlayers: [],
    activeplayers: [],
    fixedPairs: [],
    PlayedCount:    new Map(),
    typePlayCount:  { MD: new Map(), LD: new Map(), XD: new Map() }, // per-type play counts
    restCount: new Map(),
    restQueue: new Map(),
    PlayerScoreMap: new Map(),
    playedTogether: new Map(),
    fixedMap: new Map(),
    roundIndex: 0,
    pairPlayedSet: new Set(),
    gamesMap: new Set(),
    markingWinnerMode: false,
    winCount: new Map(),
    pairCooldownMap: new Map(),
    rankPoints: new Map(),
    streakMap:  new Map(),
    courts:     1,
    courtTypes:   [],  // per-court type: 'free'|'MD'|'LD'|'XD'|'singles-free'|'singles-men'|'singles-women'
    courtFormats: [],  // per-court format: 'doubles'|'singles'
    standardGamesMode: true, // Standard scheduling algorithm
    uniqueGamesMode: true,   // Standard option: prioritise never-played pairs
    balancedGamesMode: false, // Balanced: rating-aware grouping, independent of Mark Winner
};

schedulerState.activeplayers = new Proxy([], {
  get(target, prop) {
    const value = target[prop];

    if (typeof value === 'function') {
      return function (...args) {
        const result = value.apply(target, args);
        updateRoundsPageAccess();
        if (['splice','push','pop','shift','unshift','sort','reverse'].includes(String(prop)) &&
            typeof requestRoundOneSetupRegeneration === 'function') {
          requestRoundOneSetupRegeneration();
        }
        return result;
      };
    }

    return value;
  }
});



allRounds = new Proxy(allRounds, {
  set(target, prop, value) {
    target[prop] = value;
    updateSummaryPageAccess();
  // Refresh round history in gear panel if open
  const gearBody = document.getElementById('roundSettingsBody');
  if (gearBody && gearBody.classList.contains('open')) {
    if (typeof renderRoundHistory === 'function') renderRoundHistory();
  }
    return true;
  },
  deleteProperty(target, prop) {
    delete target[prop];
    updateSummaryPageAccess();
    return true;
  }
});


let courts = 1;
let roundOneRegenerationTimer = null;
let roundOneRegenerationRunning = false;
let roundOneInternalOrderChange = false;
// True while the current (latest) round is still a pre-play proposal.
// It is closed as soon as Play is pressed and reopened only after nextRound()
// has finished generating the following proposal.
let roundOneProposalOpen = false;

function roundOneInputOrder(targetState = schedulerState) {
  const state = targetState || schedulerState;
  const active = [...(state.activeplayers || [])];
  const activeSet = new Set(active);
  const catalogued = (state.allPlayers || [])
    .filter(player => player && player.active && activeSet.has(player.name))
    .map(player => player.name)
    .reverse();
  const cataloguedSet = new Set(catalogued);
  return [...catalogued, ...active.filter(name => !cataloguedSet.has(name))];
}

function applyRoundOneInitialOrder(targetState = schedulerState, modeOverride = null) {
  const state = targetState || schedulerState;
  const ordered = roundOneInputOrder(state);
  roundOneInternalOrderChange = true;
  try {
    state.activeplayers.splice(0, state.activeplayers.length, ...ordered);
    const initialOrder = modeOverride === 'keep' || modeOverride === 'random'
      ? modeOverride
      : (localStorage.getItem('initialPlayerOrder') === 'keep' ? 'keep' : 'random');
    if (initialOrder === 'random') {
      for (let index = state.activeplayers.length - 1; index > 0; index--) {
        const randomIndex = Math.floor(Math.random() * (index + 1));
        [state.activeplayers[index], state.activeplayers[randomIndex]] =
          [state.activeplayers[randomIndex], state.activeplayers[index]];
      }
    }
  } finally {
    roundOneInternalOrderChange = false;
  }
}

function isUnplayedRoundOneProposal() {
  return roundOneProposalOpen &&
    allRounds.length > 0 && currentRoundIndex === allRounds.length - 1 &&
    (typeof currentState === 'undefined' || currentState !== 'active');
}

function syncCurrentRoundSetupState() {
  const active = [...new Set(schedulerState.activeplayers || [])];
  const activeSet = new Set(active);
  const syncMap = (value, defaultValue) => {
    const oldMap = value instanceof Map ? value : new Map();
    return new Map(active.map(name => [
      name,
      oldMap.has(name) ? oldMap.get(name) : defaultValue
    ]));
  };

  schedulerState.restCount = syncMap(schedulerState.restCount, 0);
  schedulerState.PlayedCount = syncMap(schedulerState.PlayedCount, 0);
  schedulerState.PlayerScoreMap = syncMap(schedulerState.PlayerScoreMap, 0);
  schedulerState.winCount = syncMap(schedulerState.winCount, 0);
  schedulerState.rankPoints = syncMap(schedulerState.rankPoints, 100);
  schedulerState.streakMap = syncMap(schedulerState.streakMap, 0);

  const oldOpponents = schedulerState.opponentMap instanceof Map
    ? schedulerState.opponentMap
    : new Map();
  schedulerState.opponentMap = new Map(active.map(player => {
    const oldInner = oldOpponents.get(player) instanceof Map
      ? oldOpponents.get(player)
      : new Map();
    return [player, new Map(active
      .filter(other => other !== player)
      .map(other => [other, oldInner.get(other) || 0]))];
  }));

  schedulerState.fixedPairs = (schedulerState.fixedPairs || []).filter(pair =>
    Array.isArray(pair) && pair.length === 2 &&
    activeSet.has(pair[0]) && activeSet.has(pair[1])
  );
  schedulerState.fixedMap = new Map();
  schedulerState.fixedPairs.forEach(([a, b]) => {
    schedulerState.fixedMap.set(a, b);
    schedulerState.fixedMap.set(b, a);
  });
  schedulerState.restQueue = rebuildRestQueue(
    Array.isArray(schedulerState.restQueue) ? schedulerState.restQueue : []
  );
}

function closeRoundOneProposal() {
  roundOneProposalOpen = false;
  if (roundOneRegenerationTimer) {
    clearTimeout(roundOneRegenerationTimer);
    roundOneRegenerationTimer = null;
  }
}

function requestRoundOneSetupRegeneration() {
  if (roundOneInternalOrderChange || !isUnplayedRoundOneProposal()) return;
  clearTimeout(roundOneRegenerationTimer);
  roundOneRegenerationTimer = setTimeout(async () => {
    if (roundOneRegenerationRunning || !isUnplayedRoundOneProposal()) return;
    roundOneRegenerationRunning = true;
    try {
      syncCurrentRoundSetupState();
      await regenerateCurrentRoundForCourtSetup();
    } catch (error) {
      console.error('Unable to regenerate current round after setup change:', error);
    } finally {
      roundOneRegenerationRunning = false;
    }
  }, 0);
}

function roundCourtRequiredPlayers(numCourts = courts, formats = schedulerState.courtFormats || []) {
  let required = 0;
  for (let index = 0; index < numCourts; index++) {
    required += (formats[index] || 'doubles') === 'singles' ? 2 : 4;
  }
  return required;
}

function roundEnsureCourtConfig(numCourts, totalPlayers = schedulerState.activeplayers.length) {
  if (!Array.isArray(schedulerState.courtFormats)) schedulerState.courtFormats = [];
  if (!Array.isArray(schedulerState.courtTypes)) schedulerState.courtTypes = [];

  schedulerState.courtFormats = schedulerState.courtFormats.slice(0, numCourts);
  schedulerState.courtTypes = schedulerState.courtTypes.slice(0, numCourts);

  while (schedulerState.courtFormats.length < numCourts) {
    const usedSeats = roundCourtRequiredPlayers(
      schedulerState.courtFormats.length,
      schedulerState.courtFormats
    );
    const preset = localStorage.getItem('roundFormatPreset');
    const format = preset === 'singles' ? 'singles'
      : preset === 'doubles' ? 'doubles'
      : (usedSeats + 4 <= totalPlayers ? 'doubles' : 'singles');
    if (usedSeats + (format === 'singles' ? 2 : 4) > totalPlayers) return false;
    schedulerState.courtFormats.push(format);
    schedulerState.courtTypes.push(format === 'singles' ? 'singles-free' : 'free');
  }

  for (let index = 0; index < numCourts; index++) {
    const format = schedulerState.courtFormats[index] || 'doubles';
    schedulerState.courtFormats[index] = format;
    if (!schedulerState.courtTypes[index]) {
      schedulerState.courtTypes[index] = format === 'singles' ? 'singles-free' : 'free';
    }
  }

  return roundCourtRequiredPlayers(numCourts) <= totalPlayers;
}

function roundCanUseFormat(courtIndex, format) {
  const formats = [...(schedulerState.courtFormats || [])];
  while (formats.length < courts) formats.push('doubles');
  formats[courtIndex] = format;
  return roundCourtRequiredPlayers(courts, formats) <= schedulerState.activeplayers.length;
}

async function regenerateCurrentRoundForCourtSetup() {
  // Court/setup changes must use the same proven path as the whole-round 🎲.
  // Do not run a separate automatic round generator or re-initialize the session.
  schedulerState.numCourts = courts;
  schedulerState.courts = courts;

  if (!allRounds.length) {
    await goToRounds();
    return;
  }

  if (typeof RefreshRound === 'function') {
    await RefreshRound();
  }
}

async function updateCourtDisplay() {
  document.getElementById("num-courts").textContent = courts;
  updateCourtButtons(); // update both + and -

  // Keep scheduler court count in sync, then use the existing whole-round 🎲.
  schedulerState.numCourts = courts;
  schedulerState.courts = courts;
  if (allRounds.length && typeof RefreshRound === 'function') {
    await RefreshRound();
  } else if (!allRounds.length && typeof goToRounds === 'function') {
    await goToRounds();
  }

  const totalPlayers = schedulerState.activeplayers.length;
  const numPlayersPerRound = roundCourtRequiredPlayers();
  const numResting = Math.max(totalPlayers - numPlayersPerRound, 0);

  if (numResting >= numPlayersPerRound) {
    resetRest = true;
  } else {
    resetRest = false;
  }
	
}

async function roundAdjCourts(delta) {
  // Round iMode uses the court count fixed by its selected template/config.
  if (isRoundIModeTemplateSession()) return;
  if (typeof currentState !== 'undefined' && currentState === 'active') return;
  const totalPlayers = schedulerState.activeplayers.length;
  if (delta > 0) {
    const usedSeats = roundCourtRequiredPlayers();
    if (usedSeats + 2 > totalPlayers) return;
    const format = usedSeats + 4 <= totalPlayers ? 'doubles' : 'singles';
    if (!Array.isArray(schedulerState.courtFormats)) schedulerState.courtFormats = [];
    if (!Array.isArray(schedulerState.courtTypes)) schedulerState.courtTypes = [];
    schedulerState.courtFormats[courts] = format;
    schedulerState.courtTypes[courts] = format === 'singles' ? 'singles-free' : 'free';
    courts += 1;
  } else if (delta < 0 && courts > 1) {
    courts -= 1;
    schedulerState.courtFormats = (schedulerState.courtFormats || []).slice(0, courts);
    schedulerState.courtTypes = (schedulerState.courtTypes || []).slice(0, courts);
  } else {
    return;
  }
  await updateCourtDisplay();
}

// Enable / disable buttons
function updateCourtButtons() {
  const totalPlayers = schedulerState.activeplayers.length;
  const requiredPlayers = roundCourtRequiredPlayers();

  const plusBtn = document.getElementById("courtPlus");
  const minusBtn = document.getElementById("courtMinus");
  if (!plusBtn || !minusBtn) return;

  // Round iMode court count is fixed for the whole session.
  if (isRoundIModeTemplateSession()) {
    plusBtn.disabled = true;
    minusBtn.disabled = true;
    plusBtn.classList.add("disabled-btn");
    minusBtn.classList.add("disabled-btn");
    return;
  }

  // PLUS disable logic
  if (requiredPlayers + 2 > totalPlayers) {
    plusBtn.disabled = true;
    plusBtn.classList.add("disabled-btn");
  } else {
    plusBtn.disabled = false;
    plusBtn.classList.remove("disabled-btn");
  }

  // MINUS disable logic
  if (courts <= 1) {
    minusBtn.disabled = true;
    minusBtn.classList.add("disabled-btn");
  } else {
    minusBtn.disabled = false;
    minusBtn.classList.remove("disabled-btn");
  }
}


async function goToRounds() {
  const numCourtsInput = parseInt(document.getElementById("num-courts").textContent);
  courts = Math.max(1, numCourtsInput || 1);
  updateCourtButtons();
  //const numCourtsInput = parseInt(document.getElementById('num-courts').value);
  schedulerState.courts = numCourtsInput; // keep alias in sync for competitive_algorithm.js
  const totalPlayers = schedulerState.activeplayers.length;
  if (!totalPlayers) {
    alert('Please add players first!');
    return;
  }

  if (!numCourtsInput) {
    alert('Please enter no of Courts!');
    return;
  }  
  // Auto-calculate courts based on player count ÷ 4
  if (!roundEnsureCourtConfig(numCourtsInput, totalPlayers)) {
    alert('Not enough selected players for this court setup.');
    return;
  }
  const numCourts = numCourtsInput;
  if (!numCourts) {
    alert('Number of courts could not be determined!');
    return;
  }
  if (allRounds.length <= 1) {
    const savedFormats = [...schedulerState.courtFormats];
    const savedTypes = [...schedulerState.courtTypes];
    // This preference is consumed only while proposing Round 1. Once play
    // starts, the normal rest/fairness/manual-order logic remains unchanged.
    applyRoundOneInitialOrder();
    initScheduler(numCourts, { formats: savedFormats, types: savedTypes });
    allRounds.length = 0;
    schedulerState.roundIndex = 1; // first round starts at 1, not 0
    allRounds.push(await safeGenerateRound(schedulerState));
    roundOneProposalOpen = true;
    if (typeof _lastRenderedRoundIndex !== 'undefined') _lastRenderedRoundIndex = -1;
    currentRoundIndex = 0;
    showRound(0);
    // Normal Round Mode registers a live server session. Offline Mode is local-only.
    if (!(window.SCSOfflineRounds && typeof window.SCSOfflineRounds.isActive === 'function' && window.SCSOfflineRounds.isActive())) {
      ensureLiveSession();
    }
  } else {   
      schedulerState.numCourts = numCourts;      
      schedulerState.fixedMap = new Map();
      schedulerState.restQueue = rebuildRestQueue(schedulerState.restQueue);
      schedulerState.roundIndex = allRounds.length - 1;
      currentRoundIndex = schedulerState.roundIndex;
      const newRound = await safeGenerateRound(schedulerState);
      allRounds[allRounds.length - 1] = newRound;
      showRound(currentRoundIndex);
    }  
  /*
  document.getElementById('playersPage').style.display = 'none';
  document.getElementById('roundsPage').style.display = 'block';
  isOnPage2 = true;
  */
}

function goBack() {
  updatePlayerList();
  document.getElementById('playersPage').style.display = 'block';
  document.getElementById('roundsPage').style.display = 'none';
  isOnPage2 = false;
  const btn = document.getElementById('goToRoundsBtn');
  btn.disabled = false;
}

/* ── Ensure live session exists -- retries silently until success ── */
async function ensureLiveSession() {
  try {
    const existingId = (typeof getMySessionId === 'function') ? getMySessionId() : null;
    let club = (typeof getMyClub === 'function') ? getMyClub() : null;
    if (!club || !club.id) {
      // Manager workspaces have role-specific club keys. Use them to repair
      // shared club state if startup restoration has not populated it yet.
      const mode = (typeof appMode !== 'undefined' && appMode) ||
        sessionStorage.getItem('appMode') || localStorage.getItem('kbrr_app_mode') || 'organiser';
      const rolePrefix = mode === 'vault' ? 'kbrr_vault_club_' : 'kbrr_org_club_';
      const fallbackId = localStorage.getItem(rolePrefix + 'id') || '';
      const fallbackName = localStorage.getItem(rolePrefix + 'name') || '';
      if (fallbackId && typeof setMyClub === 'function') {
        setMyClub(fallbackId, fallbackName);
        club = { id: fallbackId, name: fallbackName };
      }
    }
    if (!club || !club.id) {
      console.warn('ensureLiveSession: no active manager club; session registration deferred');
      return; // no club yet -- will retry next round
    }

    // A locally persisted session ID can outlive the database session it
    // belonged to (for example after End followed by restoring an old UI
    // snapshot). Only reuse it when it is still live for the current club.
    if (existingId && typeof sbGet === 'function') {
      const existingRows = await sbGet('sessions',
        `id=eq.${existingId}&select=id,club_id,status,updated_at`).catch(() => []);
      const existing = existingRows && existingRows[0];
      const existingUpdatedAt = existing && existing.updated_at
        ? new Date(existing.updated_at).getTime() : 0;
      const existingIsFresh = existingUpdatedAt &&
        (Date.now() - existingUpdatedAt) <= (3 * 60 * 60 * 1000);
      if (existing && String(existing.club_id || '') === String(club.id) &&
          String(existing.status || '').toLowerCase() === 'live' && existingIsFresh) {
        return;
      }
      if (typeof setMySessionId === 'function') setMySessionId(null);
    } else if (existingId) {
      // Without a way to validate it, do not let a stale ID suppress a new
      // live session indefinitely.
      if (typeof setMySessionId === 'function') setMySessionId(null);
    }

    if (typeof dbStartSession === 'function') {
      // A direct Round Manager start should also follow the normal Slot Manager
      // create + post flow so player payment tracking is available there.
      let directSlot = null;
      if (typeof vaultSlotsCreatePostedFromRoundManager === 'function') {
        try { directSlot = await vaultSlotsCreatePostedFromRoundManager(); }
        catch (slotError) { console.warn('Direct Round Manager slot post failed:', slotError.message); }
      }
      // Start through the same linked slot path used by Slot Manager.
      // This records sessions.source_slot_id and slots.played_session_id,
      // allowing the existing finished-session payment flow to work unchanged.
      await dbStartSession(directSlot && directSlot.id ? directSlot.id : null);
      if (typeof saveRoundsToDb       === 'function') saveRoundsToDb();
      if (typeof updateSessionLiveBar === 'function') updateSessionLiveBar();
      if (typeof startSessionHeartbeat === 'function') startSessionHeartbeat();
    }
  } catch(e) {
    console.warn('ensureLiveSession failed -- will retry next round:', e.message);
  }
}

function isRoundIModeSession() {
  return !!(window.SCSOfflineRounds &&
    typeof window.SCSOfflineRounds.isIModeActive === 'function' &&
    window.SCSOfflineRounds.isIModeActive());
}

function isRoundIModeTemplateSession() {
  return !!(window.SCSOfflineRounds &&
    typeof window.SCSOfflineRounds.isTemplateSessionActive === 'function' &&
    window.SCSOfflineRounds.isTemplateSessionActive());
}

async function generateRoundWithLiveRules(state, options = null) {
  // Single source of truth for both normal Online Round and Offline preparation.
  // This is the exact retry/cycle logic previously embedded in nextRound().
  let newRound;
  try {
    newRound = await safeGenerateRound(state, options);
  } catch (error) {
    // A complete uniqueness cycle is expected, not a generation failure.
    // Keep every completed round, clear only cycle-specific repetition
    // tracking, then generate the next numbered round immediately.
    if (state.standardGamesMode && error?.code === 'UNIQUE_CYCLE_EXHAUSTED') {
      resetUniqueRoundCycleKeepingSetup(state);
      newRound = await safeGenerateRound(state, options);
    } else {
      throw error;
    }
  }
  // Fixed-pair schedules can exhaust their reachable unique games long before
  // the theoretical all-player combination count. If the worker can only
  // return a match already used in this cycle, start a fresh round cycle and
  // regenerate while retaining players, fixed pairs and court setup.
  if (state.standardGamesMode && roundContainsKnownMatch(newRound, state)) {
    resetUniqueRoundCycleKeepingSetup(state);
    newRound = await safeGenerateRound(state, options);
  }
  return newRound;
}

async function nextRound() {
  // Retry live session registration in case it failed earlier
  if (!isRoundIModeSession()) ensureLiveSession();

  if (currentRoundIndex + 1 < allRounds.length) {
    currentRoundIndex++;
    showRound(currentRoundIndex);
  } else {
    updSchedule(allRounds.length - 1, schedulerState, !isRoundIModeSession()); // iMode syncs once on End
    // Derive numbering from committed history. Failed Worker attempts must not
    // inflate roundIndex and later jump Round 2 to Round 7.
    allRounds.forEach((round,index) => { if (round) round.round = index + 1; });
    schedulerState.roundIndex = allRounds.length + 1;
    const newRound = await generateRoundWithLiveRules(schedulerState);
    newRound.round = allRounds.length + 1;
    allRounds.push(newRound);
    currentRoundIndex = allRounds.length - 1;
    roundOneProposalOpen = true;
    showRound(currentRoundIndex);
    if (!isRoundIModeSession() && typeof saveRoundsToDb === 'function') saveRoundsToDb();
  }
  updateSummaryPageAccess();
  // Note: saveSnapshot called from toggleRound after state fully settled
}
async function endRounds() {
  if (typeof stopRoundTimer === 'function' && currentState === 'active') stopRoundTimer(false);
  sessionFinished = true;

  const endingOfflineSession =
    window.SCSOfflineRounds &&
    (
      (typeof window.SCSOfflineRounds.hasSessionInProgress === 'function' &&
       window.SCSOfflineRounds.hasSessionInProgress()) ||
      (typeof window.SCSOfflineRounds.isActive === 'function' &&
       window.SCSOfflineRounds.isActive())
    );

  updSchedule(allRounds.length - 1, schedulerState, false); // false = don't sync ratings again

  if (endingOfflineSession) {
    // Offline End means finish the CURRENT round/session. Do not ask the local
    // prepared pool for another round merely to close the session.
    currentRoundIndex = Math.max(0, allRounds.length - 1);
    if (window.SCSOfflineRounds &&
        typeof window.SCSOfflineRounds.endSession === 'function') {
      await window.SCSOfflineRounds.endSession();
    }
  } else {
    // Keep the original online Round Mode behavior unchanged.
    const newRound = await safeGenerateRound(schedulerState); // do NOT wrap in []
    allRounds.push(newRound);
    currentRoundIndex = allRounds.length - 2;
    showRound(currentRoundIndex);
  }
	
	// pass schedulerState              
	// Disable Next & Refresh
  document.getElementById("nextBtn").disabled = true;
  document.getElementById("roundShufle").disabled = true;

  // Optional: also disable End to prevent double-click
  document.getElementById("endBtn").disabled = true;
	updateSummaryPageAccess();
	showPage('summaryPage');

	
}
function prevRound() {
  if (currentRoundIndex > 0) {
    currentRoundIndex--;
    showRound(currentRoundIndex);
  }
}

function initSchedulerState(state, numCourts, courtConfig = null) {
  state.numCourts   = numCourts;
  state.courts      = numCourts;
  state.roundIndex  = 0;

  state.restCount      = new Map(state.activeplayers.map(p => [p, 0]));
  state.PlayedCount    = new Map(state.activeplayers.map(p => [p, 0]));
  state.typePlayCount  = { MD: new Map(), LD: new Map(), XD: new Map() };
  state.PlayerScoreMap = new Map(state.activeplayers.map(p => [p, 0]));
  state.winCount       = new Map(state.activeplayers.map(p => [p, 0]));
  state.rankPoints     = new Map(state.activeplayers.map(p => [p, 100]));
  state.streakMap      = new Map(state.activeplayers.map(p => [p, 0]));

  state.playedTogether = new Map();
  state.fixedMap       = new Map();
  state.pairPlayedSet  = new Set();
  state.gamesMap       = new Set();
  state.courtTypes = courtConfig?.types ? courtConfig.types.slice(0, numCourts) : [];
  state.courtFormats = courtConfig?.formats ? courtConfig.formats.slice(0, numCourts) : [];

  state.pairHistory    = new Map();
  state.reachablePairs = new Set();

  state.opponentMap = new Map();
  for (const p1 of state.activeplayers) {
    const innerMap = new Map();
    for (const p2 of state.activeplayers) {
      if (p1 !== p2) innerMap.set(p2, 0);
    }
    state.opponentMap.set(p1, innerMap);
  }

  state.fixedPairs = Array.isArray(state.fixedPairs) ? state.fixedPairs : [];
  state.fixedPairs.forEach(([a, b]) => {
    state.fixedMap.set(a, b);
    state.fixedMap.set(b, a);
  });

  state.restQueue = [...state.activeplayers];
}

function initScheduler(numCourts, courtConfig = null) {
  initSchedulerState(schedulerState, numCourts, courtConfig);
}

function updateScheduler() {
  schedulerState.opponentMap = new Map();
  for (const p1 of schedulerState.activeplayers) {
    const innerMap = new Map();
    for (const p2 of schedulerState.activeplayers) {
      if (p1 !== p2) innerMap.set(p2, 0);
    }
    schedulerState.opponentMap.set(p1, innerMap);
  }

  // Reset new algorithm state on court change
  schedulerState.pairHistory    = new Map();
  schedulerState.reachablePairs = new Set();

  schedulerState.restQueue = rebuildRestQueue(schedulerState.restQueue);
}

/* ================================
   🔁 1-3-2-4 QUEUE REORDER (GUARDED)
================================ */
function reorder1324(queue, roundIndex = 0) {
  const total = queue.length;

  if (total < 4 || total % 2 !== 0) {
    return queue.slice();
  }

  // 1️⃣ split into pairs
  const pairs = [];
  for (let i = 0; i < total; i += 2) {
    pairs.push([queue[i], queue[i + 1]]);
  }

  const pCount = pairs.length;

  // 2️⃣ 4 or 6 pairs (8 / 12 players)
  if (pCount === 4 || pCount === 6) {
    const size = Math.floor(pCount / 4);

    const g1 = pairs.slice(0, size);
    const g2 = pairs.slice(size, size * 2);
    const g3 = pairs.slice(size * 2, size * 3);
    const g4 = pairs.slice(size * 3);

    // deterministic rotations (no randomness)
    const patterns = [
      [g1, g4, g2, g3], // 1-4-2-3
      [g2, g1, g4, g3], // rotate
      [g3, g2, g1, g4], // rotate
    ];

    const pattern = patterns[roundIndex % patterns.length];
    return pattern.flat().flat();
  }

  // 3️⃣ 8+ pairs (16+ players)
  if (pCount >= 8) {
    const size = Math.floor(pCount / 8);
    const groups = [];

    for (let i = 0; i < 8; i++) {
      groups.push(pairs.slice(i * size, (i + 1) * size));
    }

    const patterns = [
      [0, 2, 4, 6, 1, 3, 5, 7],
      [1, 3, 5, 7, 2, 4, 6, 0],
      [2, 4, 6, 0, 3, 5, 7, 1],
      [3, 5, 7, 1, 4, 6, 0, 2],
    ];

    const order = patterns[roundIndex % patterns.length];
    return order.flatMap(i => groups[i]).flat();
  }

  // 4️⃣ fallback → rotate pairs by roundIndex
  const offset = roundIndex % pCount;
  return [...pairs.slice(offset), ...pairs.slice(0, offset)].flat();
}




// 🔍 check if ALL pairs exhausted
function allPairsExhausted(queue, pairPlayedSet) {
  for (let i = 0; i < queue.length; i++) {
    for (let j = i + 1; j < queue.length; j++) {
      const key = [queue[i], queue[j]].sort().join("&");
      if (!pairPlayedSet.has(key)) return false;
    }
  }
  return true;
}




/* ============================================================
   QC MODULE — validateRound
   Validates a round before rendering.
   Hard fails → regenerate with random fallback
   Soft fails → log only
============================================================ */
function _pairKey(a, b) { return [a, b].sort().join('&'); }

function validateRound(round, schedulerState) {
  const hardFails = [];
  const softFails = [];

  if (!round || !round.games) {
    hardFails.push('No games in round');
    return { valid: false, hardFails, softFails };
  }

  const { games, playing } = round;
  const { numCourts, fixedPairs } = schedulerState;

  // ── Hard Check 1: Court count ──
  if (games.length !== numCourts) {
    hardFails.push(`Court count mismatch: got ${games.length}, expected ${numCourts}`);
  }

  // ── Hard Check 2: Doubles is 2v2; Singles is 1v1 ──
  const courtFormats = schedulerState.courtFormats || [];
  const courtTypes = schedulerState.courtTypes || [];
  const playerGender = name => {
    const player = (schedulerState.allPlayers || []).find(item => item && item.name === name);
    return String(player?.gender || player?.sex || '').toLowerCase();
  };
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    const courtIndex = Number.isFinite(Number(g.court))
      ? Math.max(0, Number(g.court) - 1)
      : i;
    const format = courtFormats[courtIndex] || 'doubles';
    const expectedPairSize = format === 'singles' ? 1 : 2;
    if (!g.pair1 || g.pair1.length !== expectedPairSize) {
      hardFails.push(`Court ${courtIndex + 1}: pair1 invalid for ${format}`);
    }
    if (!g.pair2 || g.pair2.length !== expectedPairSize) {
      hardFails.push(`Court ${courtIndex + 1}: pair2 invalid for ${format}`);
    }
    const type = String(courtTypes[courtIndex] || 'free').toLowerCase();
    const names = [...(g.pair1 || []), ...(g.pair2 || [])];
    const men = names.filter(name => playerGender(name) === 'male').length;
    const women = names.filter(name => ['female','women','woman','lady','ladies'].includes(playerGender(name))).length;
    if (format === 'doubles' && type === 'md' && men !== 4) {
      hardFails.push(`Court ${courtIndex + 1}: MD requires four men`);
    }
    if (format === 'doubles' && (type === 'ld' || type === 'wd') && women !== 4) {
      hardFails.push(`Court ${courtIndex + 1}: LD requires four women`);
    }
    if (format === 'doubles' && type === 'xd') {
      const pair1Mixed = (g.pair1 || []).filter(name => playerGender(name) === 'male').length === 1
        && (g.pair1 || []).filter(name => ['female','women','woman','lady','ladies'].includes(playerGender(name))).length === 1;
      const pair2Mixed = (g.pair2 || []).filter(name => playerGender(name) === 'male').length === 1
        && (g.pair2 || []).filter(name => ['female','women','woman','lady','ladies'].includes(playerGender(name))).length === 1;
      if (men !== 2 || women !== 2 || !pair1Mixed || !pair2Mixed) {
        hardFails.push(`Court ${courtIndex + 1}: XD requires one man and one woman in each pair`);
      }
    }
  }

  // ── Hard Check 3: No duplicate players across courts ──
  const allCourtPlayers = games.flatMap(g => [...(g.pair1||[]), ...(g.pair2||[])]);
  const seen = new Set();
  for (const p of allCourtPlayers) {
    if (seen.has(p)) hardFails.push(`Duplicate player in courts: ${p}`);
    seen.add(p);
  }

  // ── Hard Check 4: playing/resting agree with court assignments ──
  if (playing && playing.length) {
    const playingSeen = new Set();
    for (const p of playing) {
      if (!seen.has(p)) hardFails.push(`Playing player missing from courts: ${p}`);
      if (playingSeen.has(p)) hardFails.push(`Duplicate player in playing list: ${p}`);
      playingSeen.add(p);
    }
  }
  const restingSeen = new Set();
  for (const restingPlayer of (round.resting || [])) {
    const baseName = String(restingPlayer).split('#')[0];
    if (restingSeen.has(baseName)) hardFails.push(`Duplicate player in resting list: ${baseName}`);
    if (seen.has(baseName)) hardFails.push(`Player appears in a court and resting list: ${baseName}`);
    restingSeen.add(baseName);
  }

  // ── Hard Check 5: Fixed pairs intact ──
  if (fixedPairs && fixedPairs.length) {
    const restingSet = new Set((round.resting || []).map(r => r.split('#')[0]));
    for (const [a, b] of fixedPairs) {
      // Skip if both resting
      if (restingSet.has(a) && restingSet.has(b)) continue;
      // If both playing, must be together as a pair
      if (!restingSet.has(a) && !restingSet.has(b)) {
        const together = games.some(g =>
          (g.pair1 && g.pair1.includes(a) && g.pair1.includes(b)) ||
          (g.pair2 && g.pair2.includes(a) && g.pair2.includes(b))
        );
        if (!together) hardFails.push(`Fixed pair split: ${a} & ${b}`);
      }
    }
  }

  // ── Check 6: repetition rules differ by generation mode ──
  // Standard requires a fully unique match cycle. Balanced still prefers unique
  // games, but its only hard repetition rule is: do not repeat the same complete
  // match from the immediately previous round.
  const { gamesMap } = schedulerState;
  const isBalancedMode = schedulerState.gameGenerationMode === 'balanced' || schedulerState.balancedGamesMode;
  const previousRound = (typeof allRounds !== 'undefined' && allRounds.length)
    ? allRounds[allRounds.length - 1]
    : null;
  const previousMatchKeys = new Set((previousRound?.games || []).map(previousGame => {
    if (!previousGame?.pair1 || !previousGame?.pair2) return '';
    const previousPair1 = previousGame.pair1.slice().sort().join('&');
    const previousPair2 = previousGame.pair2.slice().sort().join('&');
    return [previousPair1, previousPair2].sort().join(':');
  }).filter(Boolean));

  if (gamesMap && gamesMap.size > 0) {
    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      if (!g.pair1 || !g.pair2) continue;
      const p1key = g.pair1.slice().sort().join('&');
      const p2key = g.pair2.slice().sort().join('&');
      const matchKey = [p1key, p2key].sort().join(':');
      if (!gamesMap.has(matchKey)) continue;

      if (isBalancedMode) {
        softFails.push(`Court ${i+1} reused a match to preserve Balanced-mode constraints`);
      } else {
        hardFails.push(`Court ${i+1} repeated match: ${g.pair1.join('+')} vs ${g.pair2.join('+')}`);
      }
    }
  }

  // ── Hard Check 7: Balanced temporary-rating equality ──
  // This checks the exact same frozen Top/Bottom map shown by the UI.
  if (isBalancedMode && round.balancedRatingMap) {
    const fixedTeamKeys = new Set((fixedPairs || []).map(pair => pair.slice().sort().join('&')));
    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      if (!g?.pair1 || !g?.pair2 || g.pair1.length !== 2 || g.pair2.length !== 2) continue;
      const p1Fixed = fixedTeamKeys.has(g.pair1.slice().sort().join('&'));
      const p2Fixed = fixedTeamKeys.has(g.pair2.slice().sort().join('&'));
      if (p1Fixed || p2Fixed) continue;
      const band = name => Number(round.balancedRatingMap[name]) >= 5 ? 1 : 0;
      const left = g.pair1.reduce((sum, name) => sum + band(name), 0);
      const right = g.pair2.reduce((sum, name) => sum + band(name), 0);
      if (left !== right) {
        if (g.balanceMode === 'standard-fallback') {
          softFails.push(`Court ${i+1} used Standard fallback because strict balance was impossible`);
        } else {
          hardFails.push(`Balanced temporary-rating mismatch on Court ${i+1}: ${left} vs ${right}`);
        }
      }
    }
  }

  // ── Soft Check 7: Rating balance ──
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    if (!g.pair1 || !g.pair2) continue;
    const avg1 = g.pair1.reduce((s, p) => {
      const r = typeof getActiveRating === 'function' ? getActiveRating(p) : 1.0;
      return s + (Number.isFinite(r) ? r : 1.0);
    }, 0) / g.pair1.length;
    const avg2 = g.pair2.reduce((s, p) => {
      const r = typeof getActiveRating === 'function' ? getActiveRating(p) : 1.0;
      return s + (Number.isFinite(r) ? r : 1.0);
    }, 0) / g.pair2.length;
    if (Math.abs(avg1 - avg2) > 1.0) {
      softFails.push(`Court ${i+1} rating imbalance: ${avg1.toFixed(1)} vs ${avg2.toFixed(1)}`);
    }
  }

  if (softFails.length) console.warn('QC soft fails:', softFails);

  return { valid: hardFails.length === 0, hardFails, softFails };
}

/* ── Run QC and retry if hard fail ── */
/* ================================================================
   safeGenerateRound — async, calls Cloudflare Worker
   Worker ONLY generates games/resting/playing.
   ALL schedulerState variables (Maps, Sets, etc.) stay in JS
   and are updated by updSchedule exactly as before.
   ================================================================ */
function balanceLiveRoundOpponents(games, state, balancedRatingMap) {
  if (!Array.isArray(games) || games.length < 2) return games;
  const output = games.map(game => ({ ...game, pair1:[...(game.pair1 || [])], pair2:[...(game.pair2 || [])] }));
  const groups = new Map();
  output.forEach((game, index) => {
    const courtIndex = Number.isFinite(Number(game.court)) ? Math.max(0, Number(game.court) - 1) : index;
    const format = String(state.courtFormats?.[courtIndex] || game.format || 'doubles').toLowerCase();
    const type = String(state.courtTypes?.[courtIndex] || game.type || 'free').toLowerCase();
    const signature = [format, type, game.pair1.length, game.pair2.length].join('|');
    if (!groups.has(signature)) groups.set(signature, []);
    groups.get(signature).push(index);
  });
  const opponentCount = (left, right) => state.opponentMap instanceof Map
    ? (state.opponentMap.get(left)?.get(right) || 0)
    : 0;
  const teamKey = team => [...team].sort().join('&');
  const matchKey = (left, right) => [teamKey(left), teamKey(right)].sort().join(':');
  const fixedKeys = new Set((state.fixedPairs || []).map(teamKey));
  const isBalanced = state.gameGenerationMode === 'balanced' || state.balancedGamesMode;
  const previousKeys = new Set((allRounds?.[allRounds.length - 1]?.games || []).map(game => matchKey(game.pair1 || [], game.pair2 || [])));
  const buildMatchings = items => {
    if (!items.length) return [[]];
    const first = items[0];
    const result = [];
    for (let i = 1; i < items.length; i++) {
      const rest = items.slice(1, i).concat(items.slice(i + 1));
      buildMatchings(rest).forEach(matching => result.push([[first, items[i]], ...matching]));
    }
    return result;
  };
  groups.forEach(indexes => {
    if (indexes.length < 2 || indexes.length > 3) return;
    const teams = indexes.flatMap(index => [output[index].pair1, output[index].pair2]);
    if (teams.some(team => !Array.isArray(team) || !team.length)) return;
    let best = null;
    for (const matching of buildMatchings(teams.map((_, index) => index))) {
      let valid = true;
      let maxMeetings = 0;
      let repeatCost = 0;
      let spreadCost = 0;
      let ratingCost = 0;
      matching.forEach(([leftIndex, rightIndex]) => {
        const left = teams[leftIndex];
        const right = teams[rightIndex];
        const key = matchKey(left, right);
        if (!isBalanced && state.gamesMap instanceof Map && state.gamesMap.has(key)) valid = false;
        if (previousKeys.has(key)) repeatCost += 1;
        if (isBalanced && balancedRatingMap && !fixedKeys.has(teamKey(left)) && !fixedKeys.has(teamKey(right))) {
          const band = name => Number(balancedRatingMap[name]) >= 5 ? 1 : 0;
          if (left.reduce((sum, name) => sum + band(name), 0) !== right.reduce((sum, name) => sum + band(name), 0)) valid = false;
        }
        for (const a of left) for (const b of right) {
          const meetings = opponentCount(a, b);
          maxMeetings = Math.max(maxMeetings, meetings);
          spreadCost += Math.pow(meetings + 1, 3);
        }
        if (typeof getActiveRating === 'function') {
          const leftAverage = left.reduce((sum, name) => sum + (Number(getActiveRating(name)) || 1), 0) / left.length;
          const rightAverage = right.reduce((sum, name) => sum + (Number(getActiveRating(name)) || 1), 0) / right.length;
          ratingCost += Math.abs(leftAverage - rightAverage);
        }
      });
      if (!valid) continue;
      const score = repeatCost * 100000000 + maxMeetings * 1000000 + spreadCost * 1000 + ratingCost;
      if (!best || score < best.score) best = { matching, score };
    }
    if (!best) return;
    best.matching.forEach(([leftIndex, rightIndex], position) => {
      const gameIndex = indexes[position];
      output[gameIndex].pair1 = [...teams[leftIndex]];
      output[gameIndex].pair2 = [...teams[rightIndex]];
    });
  });
  return output;
}

async function safeGenerateRound(state, options = null) {
  const historyRounds = options && Array.isArray(options.historyRounds) ? options.historyRounds : allRounds;
  // Sync the explicit two-mode game-generation selection.
  // Standard and Balanced are independent of the Mark Winner toggle.
  // Offline preparation passes an already-complete schedulerState. Preserve
  // that exact setup so the existing Worker generator receives its normal
  // courtTypes/courtFormats/Standard-Balanced configuration unchanged.
  // Normal online Round Mode continues to sync from its UI controls.
  if (!(options && options.offlinePreparation)) {
    if (typeof getGameGenerationMode === 'function') {
      state.gameGenerationMode = getGameGenerationMode();
    }
    if (typeof getStandardGamesMode === 'function') {
      state.standardGamesMode = getStandardGamesMode();
    }
    if (typeof getUniquePairMode === 'function') {
      state.uniqueGamesMode = getUniquePairMode();
    }
    state.balancedGamesMode = state.gameGenerationMode === 'balanced';
  }

  // ── Verify subscription token is still valid before generating ──
  const email = typeof authGetEmail === 'function' ? authGetEmail() : null;
  if (email && typeof _refreshTokenIfNeeded === 'function') {
    await _refreshTokenIfNeeded(email);
  }
  if (typeof canAccessMode === 'function' && !canAccessMode('organiser')) {
    if (typeof showModeUpgradePrompt === 'function') showModeUpgradePrompt('organiser');
    throw new Error('Subscription required');
  }

  // ── Serialize only what the Worker needs to generate the round ──

  // opponentMap: Map<name, Map<name, count>> → [[name, [[opp,count]]]]
  const opponentMapSerial = [];
  if (state.opponentMap instanceof Map) {
    for (const [p, inner] of state.opponentMap) {
      opponentMapSerial.push([p, [...inner.entries()]]);
    }
  }

  // restCount: Map<name, count> → [[name, count]]
  const restCountSerial = state.restCount instanceof Map
    ? [...state.restCount.entries()]
    : [];

  // restQueue: plain array of player names
  const restQueueSerial = Array.isArray(state.restQueue)
    ? [...state.restQueue]
    : [];

  // Balanced mode only: choose the playing pool for every doubles round.
  // For C courts, target 2C players from the upper rating half and 2C from
  // the lower rating half. Rest fairness remains the first selection priority:
  // players with more previous rests, especially those who rested last round,
  // are brought back into play before other players in the same rating half.
  // Standard mode is intentionally left unchanged.
  let generationActivePlayers = [...(state.activeplayers || [])];
  let balancedPreselectedResting = [];

  // Balanced temporary ratings are frozen ONCE from the complete selected
  // player pool before anybody is assigned to a court or resting.  The UI
  // must never re-split the smaller `playing` list afterwards, otherwise a
  // strong player who happens to rest can incorrectly appear as Bottom.
  let balancedRatingMap = null;
  if (state.balancedGamesMode) {
    const ratingOf = name => {
      const player = (state.allPlayers || []).find(item => item && item.name === name);
      const value = player && !player.guest && !player.unrated
        ? Number(player.activeRating ?? player.clubRating ?? player.rating ?? 1.0)
        : 1.0;
      return Number.isFinite(value) ? value : 1.0;
    };
    // Balanced bands follow the players' real ratings. They do not need to
    // contain equal numbers: 3.5+ is Top and anything below 3.5 is Bottom.
    balancedRatingMap = Object.fromEntries(
      generationActivePlayers.map(name => [name, ratingOf(name) >= 3.5 ? 5.0 : 2.5])
    );
  }
  // The strict Worker owns Balanced rest selection. Keeping this false avoids
  // a second browser-side scheduler overriding its persistent FIFO decision.
  const useBalancedPoolSelection = false;
  const allDoublesCourts = Array.from({ length: state.numCourts || 0 }, (_, i) =>
    (state.courtFormats || [])[i] || 'doubles'
  ).every(format => format === 'doubles');
  const allFreeCourts = Array.from({ length: state.numCourts || 0 }, (_, i) =>
    String((state.courtTypes || [])[i] || 'free').toLowerCase() === 'free'
  ).every(Boolean);

  // Upper/lower pool preselection is valid only for Free Doubles. Typed courts
  // (MD/WD/LD/XD) must receive the complete active pool so the Worker can meet
  // gender requirements while preserving rest fairness across later rounds.
  if (useBalancedPoolSelection && allDoublesCourts && allFreeCourts) {
    const playingNeeded = Math.min(generationActivePlayers.length, (state.numCourts || 0) * 4);

    if (playingNeeded > 0 && generationActivePlayers.length > playingNeeded) {
      const originalOrder = new Map(generationActivePlayers.map((name, index) => [name, index]));
      const queueOrder = new Map(restQueueSerial.map((name, index) => [name, index]));
      const previousResting = new Set(
        historyRounds && historyRounds.length
          ? ((historyRounds[historyRounds.length - 1] && historyRounds[historyRounds.length - 1].resting) || []).map(name => String(name).split('#')[0])
          : []
      );
      const ratingOf = name => {
        const player = (state.allPlayers || []).find(item => item && item.name === name);
        const value = player && !player.guest && !player.unrated
          ? Number(player.clubRating ?? player.rating ?? 1.0)
          : 1.0;
        return Number.isFinite(value) ? value : 1.0;
      };
      const restOf = name => state.restCount instanceof Map ? (state.restCount.get(name) || 0) : 0;
      const byPlayPriority = (a, b) =>
        Number(previousResting.has(b)) - Number(previousResting.has(a)) ||
        restOf(b) - restOf(a) ||
        (queueOrder.get(a) ?? Number.MAX_SAFE_INTEGER) - (queueOrder.get(b) ?? Number.MAX_SAFE_INTEGER) ||
        (originalOrder.get(a) || 0) - (originalOrder.get(b) || 0);

      const ratingSorted = [...generationActivePlayers].sort((a, b) =>
        ratingOf(b) - ratingOf(a) || (originalOrder.get(a) || 0) - (originalOrder.get(b) || 0)
      );
      const upperSize = Math.ceil(ratingSorted.length / 2);
      const upperGroup = ratingSorted.slice(0, upperSize);
      const lowerGroup = ratingSorted.slice(upperSize);

      let upperNeeded = Math.min((state.numCourts || 0) * 2, upperGroup.length);
      let lowerNeeded = Math.min((state.numCourts || 0) * 2, lowerGroup.length);

      // If one half is too small, fill the remaining playing places from the
      // other half while staying as close as possible to an equal split.
      let unfilled = playingNeeded - upperNeeded - lowerNeeded;
      if (unfilled > 0) {
        const upperSpare = upperGroup.length - upperNeeded;
        const addUpper = Math.min(unfilled, upperSpare);
        upperNeeded += addUpper;
        unfilled -= addUpper;
      }
      if (unfilled > 0) lowerNeeded += Math.min(unfilled, lowerGroup.length - lowerNeeded);

      const selected = new Set([
        ...[...upperGroup].sort(byPlayPriority).slice(0, upperNeeded),
        ...[...lowerGroup].sort(byPlayPriority).slice(0, lowerNeeded),
      ]);

      // Fixed pairs remain atomic. When one partner is selected, bring the
      // other partner in and replace the lowest-priority non-fixed player from
      // the same rating half where possible.
      const fixedPartner = new Map();
      for (const pair of (state.fixedPairs || [])) {
        if (Array.isArray(pair) && pair.length >= 2) {
          fixedPartner.set(pair[0], pair[1]);
          fixedPartner.set(pair[1], pair[0]);
        }
      }
      const upperSet = new Set(upperGroup);
      for (const [player, partner] of fixedPartner) {
        if (!selected.has(player) || selected.has(partner) || !originalOrder.has(partner)) continue;
        const partnerIsUpper = upperSet.has(partner);
        const removable = [...selected]
          .filter(name => name !== player && upperSet.has(name) === partnerIsUpper && !fixedPartner.has(name))
          .sort((a, b) => byPlayPriority(b, a))[0];
        if (removable) selected.delete(removable);
        selected.add(partner);
      }

      // Keep the exact court capacity after fixed-pair repair.
      if (selected.size > playingNeeded) {
        const removable = [...selected]
          .filter(name => !fixedPartner.has(name))
          .sort((a, b) => byPlayPriority(b, a));
        while (selected.size > playingNeeded && removable.length) selected.delete(removable.shift());
      }
      if (selected.size < playingNeeded) {
        const fill = generationActivePlayers.filter(name => !selected.has(name)).sort(byPlayPriority);
        while (selected.size < playingNeeded && fill.length) selected.add(fill.shift());
      }

      generationActivePlayers = generationActivePlayers.filter(name => selected.has(name));
      balancedPreselectedResting = (state.activeplayers || []).filter(name => !selected.has(name));
    }
  }

  // pairPlayedSet: Set<string> → [string]
  const pairPlayedSetSerial = state.pairPlayedSet instanceof Set
    ? [...state.pairPlayedSet]
    : [];

  // gamesMap: Set<string> → [string]
  const gamesMapSerial = state.gamesMap instanceof Set
    ? [...state.gamesMap]
    : [];

  // allPlayers for rating/gender lookups in competitive mode
  const allPlayersSerial = (state.allPlayers || []).map(p => ({
    name:       p.name,
    gender:     p.gender     || null,
    rating:     (p.guest || p.unrated) ? null : (p.rating || 1.0),
    clubRating: (p.guest || p.unrated) ? null : (p.clubRating || null),
    guest:      !!p.guest,
    unrated:    !!p.unrated,
  }));

  const playMode = (typeof getPlayMode === 'function') ? getPlayMode() : 'random';

  // ── Adjust restCount to reflect type-specific fairness ──
  // For typed courts (MD/LD/XD), players who have played that type more
  // should be deprioritised — we encode this as a higher "restCount penalty"
  // so the worker's sortRested naturally picks less-played-type players first.
  const adjustedRestCount = new Map(
    state.restCount instanceof Map ? [...state.restCount.entries()] : []
  );
  const typePlayCount = state.typePlayCount || { MD: new Map(), LD: new Map(), XD: new Map() };
  const courtTypes    = state.courtTypes || [];
  const courtFormats  = state.courtFormats || [];

  // For each typed court, find the max type play count among active players
  // then compute a penalty = (player type count) so less-played players sort first
  const typesInUse = new Set(courtTypes.filter(t => t === 'MD' || t === 'LD' || t === 'XD'));
  typesInUse.forEach(function(type) {
    const tmap = typePlayCount[type] || new Map();
    const maxCount = Math.max(0, ...[...(state.activeplayers || [])].map(p => tmap.get(p) || 0));
    if (maxCount === 0) return;
    (state.activeplayers || []).forEach(function(p) {
      const typeCount = tmap.get(p) || 0;
      // Invert: players with MORE type plays get HIGHER restCount penalty
      // (worker picks players with HIGHER restCount first — most rested)
      // We want LESS played type to be picked, so give them a boost instead
      const current = adjustedRestCount.get(p) || 0;
      // Boost players who have played this type less
      adjustedRestCount.set(p, current + (maxCount - typeCount));
    });
  });

  const adjustedRestCountSerial = [...adjustedRestCount.entries()];

  const payload = {
    activeplayers:          generationActivePlayers,
    numCourts:              state.numCourts,
    courts:                 state.courts || state.numCourts,
    fixedPairs:             (state.fixedPairs || []).filter(pair =>
      !useBalancedPoolSelection || pair.every(name => generationActivePlayers.includes(name))
    ),
    restQueue:              restQueueSerial,
    // Court type changes eligibility only; never manufacture rest totals.
    restCount:              restCountSerial,
    opponentMap:            opponentMapSerial,
    pairPlayedSet:          pairPlayedSetSerial,
    gamesMap:               gamesMapSerial,
    allRounds:              (playMode === 'competitive' || state.standardGamesMode || state.balancedGamesMode || state._mbmCall || (state.courtFormats || []).some(f => f === 'singles') || (state.courtTypes || []).some(t => t && t !== 'free')) ? (historyRounds || []) : [], // competitive + Standard algorithm + MBM + typed/singles courts need history
    playMode:               playMode,
    minRounds:              state.minRounds || 6,
    lastMode:               state._lastMode || null,
    allPlayers:             allPlayersSerial,
    roundIndex:             state.roundIndex || 0,
    fixedPairGameQueue:     state.fixedPairGameQueue     || null,
    fixedPairGameQueueHash: state.fixedPairGameQueueHash || null,
    courtTypes:             state.courtTypes   || [],
    courtFormats:           state.courtFormats || [],
    standardGamesMode:      state.standardGamesMode || false,
    uniqueGamesMode:        state.uniqueGamesMode !== false,
    balancedGamesMode:      state.balancedGamesMode || false,
    gameGenerationMode:     state.gameGenerationMode || (state.balancedGamesMode ? 'balanced' : 'standard'),
    // Exact frozen Top(1)/Bottom(0) bands used by the UI. The Worker must use
    // this same classification after rest selection; never re-split `playing`.
    balancedBands:          balancedRatingMap ? Object.fromEntries(
      Object.entries(balancedRatingMap).map(([name, value]) => [name, Number(value) >= 5 ? 1 : 0])
    ) : null,
    _mbmCall:               state._mbmCall      || false,
    _mbmWaitQueue:          state._mbmWaitQueue || [],
  };

  // Keep a local data-only copy of the exact round request context.
  // This does not alter the payload, call the Worker differently, or expose
  // any Worker scheduling code. IndexedDB errors are intentionally ignored.
  if (window.SCSOfflineDB && typeof window.SCSOfflineDB.saveRoundContext === 'function') {
    window.SCSOfflineDB.saveRoundContext(payload).catch(function(error) {
      console.warn('Offline round context save failed:', error && error.message ? error.message : error);
    });
  }

  // Round Mode Offline is an explicit separate mode. Normal Round Mode never
  // falls back to local candidates; it keeps the original Worker-only flow.
  if (!(options && options.offlinePreparation) && window.SCSOfflineRounds &&
      typeof window.SCSOfflineRounds.isActive === 'function' && window.SCSOfflineRounds.isActive()) {
    const offlineRound = await window.SCSOfflineRounds.pickRound(state);
    if (offlineRound) return offlineRound;
    // Round iMode is hybrid: when prepared rounds are unavailable or exhausted,
    // continue below through the proven live Worker using the same scheduler state.
  }

  let resp;
  try {
    const res = await fetch(WORKER_URL + '/generate-round', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error('Worker ' + res.status + ': ' + errText);
    }
    resp = await res.json();
    if (isRoundIModeSession() && window.SCSOfflineRounds &&
        typeof window.SCSOfflineRounds.noteGenerationSource === 'function') {
      window.SCSOfflineRounds.noteGenerationSource('live');
    }
  } catch(e) {
    console.error('safeGenerateRound Worker error:', e);
    alert('Round generation failed — please check connection.\n' + e.message);
    throw e;
  }

  // ── Worker returns { games, resting, playing, roundIndex, lastMode } ──
  // NOTE: Do NOT use resp.roundIndex to update state.roundIndex.
  // The worker increments roundIndex on every internal retry attempt, causing
  // the displayed round number to jump (e.g. Round 35 → Round 38).
  // The caller always sets the correct roundIndex before calling safeGenerateRound.
  if (resp.lastMode) state._lastMode = resp.lastMode;
  if (Array.isArray(resp.updatedRestQueue)) {
    const activeNames = new Set(state.activeplayers || []);
    const restoredQueue = resp.updatedRestQueue.filter((name,index,array) =>
      activeNames.has(name) && array.indexOf(name) === index
    );
    if (restoredQueue.length === activeNames.size) state.restQueue = restoredQueue;
  }
  // New Standard schedulers share a Worker-side Plan B.  When it restarts
  // match uniqueness, mirror that cycle boundary in the browser before QC;
  // player counts, rest FIFO, fixed pairs and the full visible history remain.
  if (resp.fallbackUsed && state.standardGamesMode) {
    resetUniqueRoundCycleKeepingSetup(state);
  }

  // ── Validate court count ──
  const expectedCourts = state.numCourts || 1;
  // Rendering uses array position for each court tile. Normalize the Worker's
  // explicit 1-based court number first so a fair game cannot be displayed
  // beneath another court's MD/LD/XD label.
  const returnedGames  = (resp.games || []).map((game,index) => ({ game, index }))
    .sort((a,b) => {
      const courtA = Number.isFinite(Number(a.game?.court)) ? Number(a.game.court) : a.index + 1;
      const courtB = Number.isFinite(Number(b.game?.court)) ? Number(b.game.court) : b.index + 1;
      return courtA - courtB || a.index - b.index;
    })
    .map(({game},index) => ({ ...game, court:index + 1 }));
  if (returnedGames.length < expectedCourts) {
    console.warn('Worker returned', returnedGames.length, 'courts, expected', expectedCourts);
    // Don't throw — return what we got, caller can handle partial
  }

  // ── Return same shape as original AischedulerNextRound ──
  const workerResting = resp.resting || [];

  // Keep the existing resting-player UI contract in every mode: each entry is
  // stored as "Player Name#restCount". Balanced mode preselects some resting
  // players locally, so add the same suffix the worker normally supplies.
  const formatRestingName = name => {
    const baseName = String(name).split('#')[0];
    const nextRestCount = (state.restCount instanceof Map
      ? (state.restCount.get(baseName) || 0)
      : 0) + 1;
    return `${baseName}#${nextRestCount}`;
  };

  const combinedResting = balancedPreselectedResting.map(formatRestingName);
  const combinedRestingBases = new Set(
    combinedResting.map(name => String(name).split('#')[0])
  );

  for (const name of workerResting) {
    const baseName = String(name).split('#')[0];
    if (!combinedRestingBases.has(baseName)) {
      // The worker's restCount input can contain temporary Balanced/typed
      // fairness weighting. Its returned #suffix is therefore not a real
      // historical rest total. Always rebuild the display suffix from the
      // client's committed restCount so retries/previews cannot inflate it.
      combinedResting.push(formatRestingName(baseName));
      combinedRestingBases.add(baseName);
    }
  }

  // Live opponent balancing is a final rematch of complete teams only. Partner
  // selection, resting players, fixed pairs and the Worker algorithm stay intact.
  const liveGames = options && options.offlinePreparation
    ? returnedGames
    : balanceLiveRoundOpponents(returnedGames, state, balancedRatingMap);

  const generatedRound = {
    round:   state.roundIndex, // use caller's roundIndex, not worker's
    games:   liveGames,
    resting: combinedResting,
    playing: resp.playing || generationActivePlayers,
    // Frozen Balanced Top/Bottom classification for this round.  Both court
    // players and resting players read the same map; no later rating lookup
    // or playing-pool re-split is allowed to change their temporary rating.
    balancedRatingMap: balancedRatingMap,
  };

  // Never render a stale/invalid Worker response. In particular, an older
  // Worker may label a court Singles while still returning a 2v2 game, which
  // can also duplicate those players in another court or in the resting list.
  const quality = validateRound(generatedRound, state);
  if (!quality.valid) {
    const details = quality.hardFails.join('; ');
    console.error('Worker returned an invalid round:', details, generatedRound);
    const repeatsOnly = quality.hardFails.length > 0 &&
      quality.hardFails.every(message => message.includes('repeated match'));
    const error = new Error(
      (repeatsOnly ? 'Unique round cycle exhausted: ' : 'Worker update required: ') + details
    );
    error.code = repeatsOnly ? 'UNIQUE_CYCLE_EXHAUSTED' : 'INVALID_WORKER_ROUND';
    throw error;
  }

  return generatedRound;
}

function updSchedule(roundIndex, schedulerState, syncToDb = true, options = null) {
  //AUTO_SAVE();
  const liveUpdateOptions = options || {};
  const data = liveUpdateOptions.data || allRounds[roundIndex];
  if (!data) return;

  const { games, resting } = data;
  const {
    restCount,
    PlayedCount,
    PlayerScoreMap,
    opponentMap,
    pairPlayedSet,
	gamesMap,
    playedTogether, // <<-- Missing in your version
  } = schedulerState;

  // 1️⃣ Update rest count
  for (const p of resting) {
    const playerName = p.split('#')[0];
    restCount.set(playerName, (restCount.get(playerName) || 0) + 1);
  }
   
// Helper → base name
const base = p => p.split('#')[0];

// 1️⃣ COPY restQueue first (so we don't modify during loop)
let newQueue = schedulerState.restQueue.slice();

// 2️⃣ FULL REMOVE: strip any players whose base name matches resting
for (const r of resting) {
  const b = base(r);
  newQueue = newQueue.filter(q => base(q) !== b);
}

// Replace restQueue after ALL removals done
schedulerState.restQueue = newQueue;

// 3️⃣ FULL ADD: now add base names of ALL resting at once
for (const r of resting) {
  schedulerState.restQueue.push(base(r));
}    

  // 2️⃣ Update PlayedCount
  if (!liveUpdateOptions.silent) lastRound.length = 0; // keep Live UI history unchanged during virtual preparation

for (const [gi, game] of games.entries()) {
  const allPlayers = [...game.pair1, ...game.pair2];

  if (!liveUpdateOptions.silent) lastRound.push(...allPlayers);

  for (const p of allPlayers) {
    PlayedCount.set(p, (PlayedCount.get(p) || 0) + 1);
    // Track per-type play count
    const _type = (schedulerState.courtTypes || [])[gi] || 'free';
    if (_type === 'MD' || _type === 'LD' || _type === 'XD') {
      if (!schedulerState.typePlayCount) schedulerState.typePlayCount = { MD: new Map(), LD: new Map(), XD: new Map() };
      const _tmap = schedulerState.typePlayCount[_type];
      _tmap.set(p, (_tmap.get(p) || 0) + 1);
    }
  }
}

  // 3️⃣ Update opponentMap & PlayerScoreMap
  for (const game of games) {
    const { pair1, pair2 } = game;

    // Ensure maps exist (prevents null errors)
    for (const a of [...pair1, ...pair2]) {
      if (!opponentMap.has(a)) opponentMap.set(a, new Map());
    }

    // Opponent tracking
    for (const a of pair1) {
      for (const b of pair2) {
        opponentMap.get(a).set(b, (opponentMap.get(a).get(b) || 0) + 1);
        opponentMap.get(b).set(a, (opponentMap.get(b).get(a) || 0) + 1);
      }
    }

    // Score calculation (new opponents bonus)
    for (const group of [pair1, pair2]) {
      for (const player of group) {
        let newOpponents = 0;
        const rivals = group === pair1 ? pair2 : pair1;

        for (const r of rivals) {
          if (opponentMap.get(player).get(r) === 1) newOpponents++;
        }

        const score = newOpponents === 2 ? 2 : newOpponents === 1 ? 1 : 0;
        PlayerScoreMap.set(player, (PlayerScoreMap.get(player) || 0) + score);
      }
    }
  }

  // 4️⃣ Track pairs played together (with round info)
  for (const game of games) {
    for (const pr of [game.pair1, game.pair2]) {
      const key = pr.slice().sort().join("&");
      pairPlayedSet.add(key);
      playedTogether.set(key, roundIndex); // <<-- IMPORTANT FIX
    }
  }

    // 4️⃣ Track pairs played together (with round info)
  for (const game of games) {
  const p1 = game.pair1.slice().sort().join("&");
  const p2 = game.pair2.slice().sort().join("&");

  // ensure A&B:C&D === C&D:A&B
  const gameKey = [p1, p2].sort().join(":");

  gamesMap.add(gameKey);
}

/// 7️⃣ 🏆 Update WIN COUNT + RATINGS
// Win counts always tracked regardless of mode
for (const game of games) {
  if (!game.winner) continue;
  const winners = game.winner === 'L' ? game.pair1 : game.pair2;
  for (const p of winners) {
    schedulerState.winCount.set(p, (schedulerState.winCount.get(p) || 0) + 1);
  }
}

// Rating updates -- DUPR-style individual player formula
// Each player's delta depends on their own rating vs opponent average
// K = 0.45 (max swing), spread = 1.5 (curve steepness)
const RATING_K      = 0.45;
const RATING_SPREAD = 1.5;

const roundWins         = new Map();
const roundLosses       = new Map();
const roundRatingDeltas = new Map(); // uncapped delta for points
function _roundIsGuestPlayer(name) {
  const key = String(name || '').trim().toLowerCase();
  const p = (schedulerState.allPlayers || []).find(pl => String(pl.name || '').trim().toLowerCase() === key);
  return !!(p && (p.guest || p.unrated)) || /\(guest(?:\s+[a-z0-9]+)?\)$/i.test(String(name || ''));
}

for (const game of games) {
  if (!game.winner) continue;

  const winners = game.winner === 'L' ? game.pair1 : game.pair2;
  const losers  = game.winner === 'L' ? game.pair2 : game.pair1;
  const hasGuest = winners.concat(losers).some(_roundIsGuestPlayer);
  if (hasGuest) {
    winners.forEach(p => { if (!_roundIsGuestPlayer(p)) roundWins.set(p, (roundWins.get(p) || 0) + 1); });
    losers.forEach(p => { if (!_roundIsGuestPlayer(p)) roundLosses.set(p, (roundLosses.get(p) || 0) + 1); });
    continue;
  }

  // Opponent averages (used individually per player)
  const winAvg  = winners.reduce((s, p) => s + (typeof getActiveRating === "function" ? getActiveRating(p) : getRating(p)), 0) / winners.length;
  const loseAvg = losers.reduce((s, p)  => s + (typeof getActiveRating === "function" ? getActiveRating(p) : getRating(p)), 0) / losers.length;

  // Each winner: delta = K * (1 - expected)
  // Lower-rated winner vs strong opponents → higher reward
  for (const p of winners) {
    const myRating = typeof getActiveRating === "function" ? getActiveRating(p) : getRating(p);
    const expected = 1 / (1 + Math.pow(10, (loseAvg - myRating) / RATING_SPREAD));
    const delta    = Math.round(RATING_K * (1 - expected) * 100) / 100;
    setRating(p, myRating + delta);
    roundWins.set(p, (roundWins.get(p) || 0) + 1);
    roundRatingDeltas.set(p, (roundRatingDeltas.get(p) || 0) + delta);
  }

  // Each loser: delta = -K * expected
  // Higher-rated loser vs weak opponents → bigger penalty
  for (const p of losers) {
    const myRating = typeof getActiveRating === "function" ? getActiveRating(p) : getRating(p);
    const expected = 1 / (1 + Math.pow(10, (winAvg - myRating) / RATING_SPREAD));
    const delta    = Math.round(RATING_K * expected * 100) / 100;
    const updated  = Math.max(1.0, myRating - delta);
    setRating(p, updated);
    roundLosses.set(p, (roundLosses.get(p) || 0) + 1);
    roundRatingDeltas.set(p, (roundRatingDeltas.get(p) || 0) - delta);
  }
}

  // ── Update pairHistory + opponentMap for new algorithm ──
  if (!schedulerState.pairHistory) schedulerState.pairHistory = new Map();
  for (const game of games) {
    const k1 = _pairKey(game.pair1[0], game.pair1[1]);
    const k2 = _pairKey(game.pair2[0], game.pair2[1]);
    schedulerState.pairHistory.set(k1, (schedulerState.pairHistory.get(k1) || 0) + 1);
    schedulerState.pairHistory.set(k2, (schedulerState.pairHistory.get(k2) || 0) + 1);
  }

// Refresh all visible badges only for an actual Live round.
if (!liveUpdateOptions.silent) {
  syncRatings();
  updatePlayerList();
}

// Sync ratings + wins/losses to Supabase (only from nextRound, not endRounds)
if (!liveUpdateOptions.silent && isRoundIModeSession()) {
  if (!schedulerState.iModeSyncTotals) schedulerState.iModeSyncTotals = {};
  if (!Array.isArray(schedulerState.iModeRecordedRounds)) schedulerState.iModeRecordedRounds = [];
  const iModeRoundKey = String(data.round || (roundIndex + 1));
  if (!schedulerState.iModeRecordedRounds.includes(iModeRoundKey)) {
    const names = new Set([...roundWins.keys(), ...roundLosses.keys(), ...roundRatingDeltas.keys()]);
    names.forEach(function(name) {
      const current = schedulerState.iModeSyncTotals[name] || { wins:0, losses:0, delta:0 };
      current.wins += roundWins.get(name) || 0;
      current.losses += roundLosses.get(name) || 0;
      current.delta += roundRatingDeltas.get(name) || 0;
      schedulerState.iModeSyncTotals[name] = current;
    });
    schedulerState.iModeRecordedRounds.push(iModeRoundKey);
  }
} else if (!liveUpdateOptions.silent && syncToDb && typeof syncAfterRound === "function") {
  syncAfterRound(roundWins, roundLosses, roundRatingDeltas);
}

// after tracking pairs & games — same Live cycle logic, with the prepared round
// supplied explicitly when running a virtual Offline session.
checkAndResetPairCycle(schedulerState, games, roundIndex, data);
	// ✅ EXECUTE ONLY WHEN BOTH CONDITIONS ARE TRUE
const effectiveResetRest = liveUpdateOptions.resetRestOverride == null
  ? resetRest
  : !!liveUpdateOptions.resetRestOverride;
if ( effectiveResetRest === true &&
  allPairsExhausted(schedulerState.restQueue, pairPlayedSet)
) {
  schedulerState.restQueue = reorder1324(schedulerState.restQueue);

  // optional: prevent repeated execution
  //schedulerState.resetRest = false;
}
}

function createRestQueue() {
  // Return active players in their input order.
  // FIFO rotation handles fair rest distribution from here.
  return [...schedulerState.activeplayers];
}

function rebuildRestQueue(restQueue) {
  const newQueue = [];
  const active = schedulerState.activeplayers;

  // 1. Add active players based on the order in old restQueue
  for (const p of restQueue) {
    if (active.includes(p)) {
      newQueue.push(p);
    }
  }

  // 2. Add any newly active players not found in old restQueue
  for (const p of active) {
    if (!newQueue.includes(p)) {
      newQueue.push(p);
    }
  }

  return newQueue;
}




  

async function RefreshRound() {
  if (window.SCSOfflineRounds && typeof window.SCSOfflineRounds.isTemplateEditorActive === 'function' && window.SCSOfflineRounds.isTemplateEditorActive()) {
    if (typeof window.SCSOfflineRounds.templateEditorShuffleRound === 'function') {
      window.SCSOfflineRounds.templateEditorShuffleRound();
    }
    return;
  }
    // Save current position - shuffle must NOT change round number or advance index
    const savedRoundIndex = schedulerState.roundIndex;
    const savedCurrentIndex = currentRoundIndex;

    // IMPORTANT: the round dice reshuffles ONLY the players who are currently
    // on court. Manual Rest <-> Play changes are authoritative for this round.
    // Rest selection belongs to Next Round generation, not to a current-round
    // reroll. Build the playing pool directly from the visible court data so a
    // stale data.playing array can never reintroduce a resting player.
    const currentRound = allRounds[currentRoundIndex];
    if (!currentRound || !Array.isArray(currentRound.games)) return;

    const currentPlaying = [];
    const seenPlaying = new Set();
    for (const game of currentRound.games) {
      for (const name of [...(game.pair1 || []), ...(game.pair2 || [])]) {
        if (!name || name === t('emptyGame')) continue;
        const base = String(name).replace(/#\d+$/, '');
        if (!seenPlaying.has(base)) {
          seenPlaying.add(base);
          currentPlaying.push(base);
        }
      }
    }

    const preservedResting = Array.isArray(currentRound.resting)
      ? [...currentRound.resting]
      : [];

    // Use a temporary scheduler state restricted to the current playing pool.
    // This keeps all existing Standard/Balanced/typed-court generation logic,
    // but makes the number of resting players zero for this reroll. The real
    // schedulerState/restQueue remains untouched for the NEXT round.
    const rerollState = Object.assign({}, schedulerState, {
      activeplayers: [...currentPlaying],
      restQueue: [...currentPlaying],
      fixedPairs: Array.isArray(schedulerState.fixedPairs)
        ? schedulerState.fixedPairs.filter(pair => Array.isArray(pair) && pair.length >= 2 && seenPlaying.has(pair[0]) && seenPlaying.has(pair[1]))
        : [],
      roundIndex: savedRoundIndex,
    });

    // Generate a new arrangement for the CURRENT round only
    // Route by mode: competitive re-runs the rating-aware scheduler,
    // random uses the pure random shuffle
    let newRound;
    if ((typeof getPlayMode === 'function' && getPlayMode() === 'competitive') ||
        (typeof getGameGenerationMode === 'function' && getGameGenerationMode() === 'balanced')) {
      // In competitive mode the scheduler is deterministic, so we temporarily
      // mark the current round's pairs as 'used'. This forces the algorithm
      // to find a genuinely different balanced arrangement.
      // We restore pairPlayedSet immediately after so state is unchanged.
      const currentRound = allRounds[currentRoundIndex];
      const tempKeys = [];
      if (currentRound && currentRound.games) {
        for (const game of currentRound.games) {
          for (const pair of [game.pair1, game.pair2]) {
            const key = [...pair].sort().join('&');
            if (!schedulerState.pairPlayedSet.has(key)) {
              schedulerState.pairPlayedSet.add(key);
              tempKeys.push(key);
            }
          }
        }
      }
      newRound = await safeGenerateRound(rerollState);
      // Restore: remove the temporarily added keys
      for (const key of tempKeys) {
        schedulerState.pairPlayedSet.delete(key);
      }
    } else {
      // If any courts have typed assignments, use worker (typedRound)
      // Otherwise use fast client-side RandomRound
      const hasTyped = (schedulerState.courtTypes || []).some(t => t && t !== 'free') ||
                       (schedulerState.courtFormats || []).some(f => f === 'singles');
      if (hasTyped) {
        // Temporarily mark current pairs as used to force fresh pairs
        const currentRound = allRounds[currentRoundIndex];
        const tempKeys = [];
        if (currentRound && currentRound.games) {
          for (const game of currentRound.games) {
            for (const pair of [game.pair1, game.pair2]) {
              const key = [...pair].sort().join('&');
              if (!schedulerState.pairPlayedSet.has(key)) {
                schedulerState.pairPlayedSet.add(key);
                tempKeys.push(key);
              }
            }
          }
        }
        newRound = await safeGenerateRound(rerollState);
        // Restore pairPlayedSet
        for (const key of tempKeys) {
          schedulerState.pairPlayedSet.delete(key);
        }
      } else {
        newRound = RandomRound(rerollState);
      }
    }

    // Keep the round number exactly the same as before, and preserve the
    // organiser's manual Play/Rest choice. The generator is used only to form
    // new teams/courts from currentPlaying.
    newRound.round = savedRoundIndex;
    newRound.playing = [...currentPlaying];
    newRound.resting = preservedResting;

    // If worker returned fewer courts than expected, fill missing with RandomRound
    const expectedCourts = schedulerState.numCourts || 1;
    if (newRound.games && newRound.games.length < expectedCourts) {
      console.warn('Partial round — falling back to RandomRound for missing courts');
      const fallback = RandomRound(rerollState);
      if (fallback && fallback.games) {
        while (newRound.games.length < expectedCourts && fallback.games.length > 0) {
          newRound.games.push(fallback.games.shift());
        }
      }
    }

    // Restore everything - no advancement
    schedulerState.roundIndex = savedRoundIndex;
    currentRoundIndex = savedCurrentIndex;

    // Replace current round in-place
    allRounds[currentRoundIndex] = newRound;
    showRound(currentRoundIndex);
    if (typeof saveSnapshot     === 'function') saveSnapshot();
    if (!isRoundIModeSession() && typeof saveRoundsToDb === 'function') saveRoundsToDb();
}

function ratingToColor(r) {
  if (r < 2.0) return "#9e9e9e";  // grey  -- beginner
  if (r < 3.0) return "#4a9eff";  // blue  -- developing
  if (r < 4.0) return "#2dce89";  // green -- intermediate
  if (r < 4.5) return "#f5a623";  // amber -- advanced
  return "#e63757";                // red   -- elite
}

function report() {
  const container = document.getElementById("reportContainer");
  if (!container) return;
  container.innerHTML = "";

  // Guard: nothing to show if no players in session
  if (!schedulerState.allPlayers || schedulerState.allPlayers.length === 0) {
    container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:0.9rem;">' + t('noSessionData') + '</div>';
    return;
  }

  const playMode = getPlayMode(); // "competitive" | "random"

  /* ===== HEADER ===== */
  const header = document.createElement("div");
  header.className = "report-header";
  header.innerHTML = `
    <div class="header-strip"></div>
    <div class="header-rank">Rank</div>
    <div class="header-name">Name</div>
    <div class="header-wins">W</div>
    <div class="header-played">P</div>
    <div class="header-rested">R</div>
  `;
  container.appendChild(header);

  /* ===== SORT LOGIC ===== */
  let sortedPlayers = [...schedulerState.allPlayers];

  if (playMode === "competitive") {
    // 🔥 PURE WINS LADDER
    sortedPlayers.sort((a, b) => {
      const wA = schedulerState.winCount.get(a.name) || 0;
      const wB = schedulerState.winCount.get(b.name) || 0;
      return wB - wA;
    });
  } else {
    // 🎲 EXISTING FAIRNESS MODE
    sortedPlayers.sort((a, b) => {
      const playedA = schedulerState.PlayedCount.get(a.name) || 0;
      const playedB = schedulerState.PlayedCount.get(b.name) || 0;
      if (playedB !== playedA) return playedB - playedA;

      const restA = schedulerState.restCount.get(a.name) || 0;
      const restB = schedulerState.restCount.get(b.name) || 0;
      return restB - restA;
    });
  }

  /* ===== RENDER ===== */
  sortedPlayers.forEach((p, index) => {
    const wins = schedulerState.winCount.get(p.name) || 0;
    const played = schedulerState.PlayedCount.get(p.name) || 0;
    const rest = schedulerState.restCount.get(p.name) || 0;
    const isGuest = !!(p.guest || p.unrated) || /\(guest(?:\s+[a-z0-9]+)?\)$/i.test(String(p.name || ''));

    const rating   = isGuest ? null : ((typeof getRating === 'function') ? (typeof getActiveRating === "function" ? getActiveRating(p.name) : getRating(p.name)) : 1.0);
    const stripColor = isGuest ? 'rgba(255,255,255,0.18)' : ratingToColor(rating);
    const topClass = index === 0 ? "top-1" : index === 1 ? "top-2" : index === 2 ? "top-3" : "";
    const card = document.createElement("div");
    card.className = `player-card ${topClass}`;
    card.style.setProperty("--strip-color", stripColor);
    card.innerHTML = `
      <div class="rating-strip"></div>
      <div class="rank">#${index + 1}</div>
      <div class="name">${p.name}</div>
      <div class="stat wins">${wins}</div>
      <div class="stat played">${played}</div>
      <div class="stat rest">${rest}</div>
      ${isGuest ? '<span class="rating-badge">guest</span>' : `<span class="rating-badge" data-player="${p.name}">${rating.toFixed(1)}</span>`}
      <div class="stat-label lbl-wins">W</div>
      <div class="stat-label lbl-played">P</div>
      <div class="stat-label lbl-rest">R</div>
    `;
    container.appendChild(card);
  });

  setLanguage(currentLang);
}

function workedreport() {
  const container = document.getElementById("reportContainer");
  container.innerHTML = ""; // Clear old cards

  // ⭐ Add title header row
  const header = document.createElement("div");
  header.className = "report-header";
  header.innerHTML = `
    <div class="header-rank" data-i18n="rank">Rank</div>
    <div class="header-name" data-i18n="name">Name</div>
    <div class="header-played" data-i18n="played">Played</div>
    <div class="header-rested" data-i18n="rested">Rested</div>
  `;
  container.appendChild(header);

  // Sort & add players
  const sortedPlayers = [...schedulerState.allPlayers].sort((a, b) => {
    const playedA = schedulerState.PlayedCount.get(a.name) || 0;
    const playedB = schedulerState.PlayedCount.get(b.name) || 0;
    return playedB - playedA;
  });

  sortedPlayers.forEach((p, index) => {
    const played = schedulerState.PlayedCount.get(p.name) || 0;
    const rest = schedulerState.restCount.get(p.name) || 0;
    const isGuest = !!(p.guest || p.unrated) || /\(guest(?:\s+[a-z0-9]+)?\)$/i.test(String(p.name || ''));
    const rating = isGuest ? null : (typeof getRating === 'function' ? (typeof getActiveRating === "function" ? getActiveRating(p.name) : getRating(p.name)) : 1.0);
    const ratingHtml = isGuest
      ? '<span class="rating-badge">guest</span>'
      : `<span class="rating-badge" data-player="${p.name}">${Number.isFinite(rating) ? rating.toFixed(1) : '1.0'}</span>`;

    const card = document.createElement("div");
    const topClass = index === 0 ? "top-1" : index === 1 ? "top-2" : index === 2 ? "top-3" : "";
    card.className = `player-card ${topClass}`;
    card.innerHTML = `
      <div class="rank">#${index + 1}</div>
      <div class="name">${p.name.replace(/^\d+\.?\s*/, "")}</div>
      ${ratingHtml}
      <div class="stat played" style="border-color:${getPlayedColor(played)}">${played}</div>
      <div class="stat rest" style="border-color:${getRestColor(rest)}">${rest}</div>
    `;
    container.appendChild(card);
  });

  // ⭐ Important: Apply translation to new elements
  setLanguage(currentLang);
}


function resetUniqueRoundCycleKeepingSetup(state, latestRoundOverride = null, latestRoundIndexOverride = null) {
  // Restart uniqueness, not the session. Round history, results, player
  // counters, fairness queues and the current round position must survive.
  if (!(state.pairPlayedSet instanceof Set)) state.pairPlayedSet = new Set();
  if (!(state.playedTogether instanceof Map)) state.playedTogether = new Map();
  if (!(state.gamesMap instanceof Set)) state.gamesMap = new Set();
  state.pairPlayedSet.clear();
  state.playedTogether.clear();
  state.gamesMap.clear();
  state.pairHistory = new Map();
  state.reachablePairs = new Set();
  state.fixedPairGameQueue = null;
  state.fixedPairGameQueueHash = null;

  // Count the most recently completed round as the first round of the new
  // uniqueness cycle, preventing an immediate identical repeat.
  const latestRoundIndex = latestRoundIndexOverride == null
    ? allRounds.length - 1
    : latestRoundIndexOverride;
  const latestRound = latestRoundOverride || allRounds[latestRoundIndex];
  if (latestRound && Array.isArray(latestRound.games)) {
    latestRound.games.forEach(game => {
      if (!game || !Array.isArray(game.pair1) || !Array.isArray(game.pair2)) return;
      const p1 = [...game.pair1].sort().join('&');
      const p2 = [...game.pair2].sort().join('&');
      state.pairPlayedSet.add(p1);
      state.pairPlayedSet.add(p2);
      state.playedTogether.set(p1, latestRoundIndex);
      state.playedTogether.set(p2, latestRoundIndex);
      state.gamesMap.add([p1, p2].sort().join(':'));
    });
  }

  if (typeof showToast === 'function') {
    showToast((typeof t === 'function' && t('uniqueCycleRestarted')) || 'Unique matches completed — starting a new round cycle.');
  }
}

function roundContainsKnownMatch(round, state) {
  if (!round || !Array.isArray(round.games) || !(state.gamesMap instanceof Set)) return false;
  return round.games.some(game => {
    if (!game || !game.pair1 || !game.pair2) return false;
    const p1 = [...game.pair1].sort().join('&');
    const p2 = [...game.pair2].sort().join('&');
    return state.gamesMap.has([p1, p2].sort().join(':'));
  });
}

function checkAndResetPairCycle(schedulerState, games, roundIndex, latestRoundOverride = null) {
  const {
    activeplayers,
    pairPlayedSet,
    playedTogether,
    gamesMap
  } = schedulerState;

  // --- exhaustion check (INCLUDING latest round) ---
  const bases = activeplayers.map(p => p.split('#')[0]);
  const totalPossiblePairs =
    (bases.length * (bases.length - 1)) / 2;

  let totalPossibleGames = 0;
  for (let a = 0; a < bases.length; a++) {
    for (let b = a + 1; b < bases.length; b++) {
      for (let c = 0; c < bases.length; c++) {
        if (c === a || c === b) continue;
        for (let d = c + 1; d < bases.length; d++) {
          if (d === a || d === b) continue;
          totalPossibleGames++;
        }
      }
    }
  }
  totalPossibleGames = Math.floor(totalPossibleGames / 2);

  const pairsExhausted = pairPlayedSet.size >= totalPossiblePairs;
  const gamesExhausted = totalPossibleGames > 0 && gamesMap.size >= totalPossibleGames;
  if (!pairsExhausted && !gamesExhausted) return false;

  if (schedulerState.standardGamesMode) {
    resetUniqueRoundCycleKeepingSetup(
      schedulerState,
      latestRoundOverride,
      latestRoundOverride ? roundIndex : null
    );
    return true;
  }

  // --- snapshot latest round ---
  const latestPairs = [];
  const latestGames = [];

  for (const game of games) {
    const p1 = game.pair1.slice().sort().join("&");
    const p2 = game.pair2.slice().sort().join("&");

    latestPairs.push(p1, p2);
    latestGames.push([p1, p2].sort().join(":"));
  }

  // --- reset only unique pair/game memory ---
  pairPlayedSet.clear();
  playedTogether.clear();
  gamesMap.clear();

  // --- restore ONLY latest round ---
  for (const key of latestPairs) {
    pairPlayedSet.add(key);
    playedTogether.set(key, roundIndex);
  }

  for (const gk of latestGames) {
    gamesMap.add(gk);
  }

  return true; // cycle reset happened
}

/* ── Per-court dice: re-roll one court using type-aware cascade (MD/LD/XD/Free) ── */
// ═══════════════════════════════════════════════════════════════════
// _rerollCourtGetPairs — SHARED CORE (used by rerollCourt + mbmDice)
// Returns { pair1, pair2 } for a given gameIndex.
// Handles free / singles / MD / LD / XD with 3-source cascade.
// Pure logic — no UI updates.
// ═══════════════════════════════════════════════════════════════════
function _rerollCourtGetPairs(gameIndex, availablePool) {
  const data = allRounds[currentRoundIndex];
  if (!data || !data.games) return null;

  const game = data.games[gameIndex];
  if (!game) return null;

  const fmt       = (schedulerState.courtFormats || [])[gameIndex] || 'doubles';
  const need      = fmt === 'singles' ? 2 : 4;
  const courtType = (schedulerState.courtTypes   || [])[gameIndex] || 'free';

  // ── Convert opponentMap Map→plain object ──
  const oppMapRaw = schedulerState.opponentMap;
  const opponentMapPlain = {};
  if (oppMapRaw instanceof Map) {
    for (const [p, inner] of oppMapRaw) {
      opponentMapPlain[p] = inner instanceof Map ? Object.fromEntries(inner) : (inner || {});
    }
  }

  // ── Gender helpers ──
  function getGender(name) {
    const p = (schedulerState.allPlayers || []).find(pl => pl.name === name);
    return p ? (p.gender || 'Male') : 'Male';
  }
  function genderOk(name, type) {
    if (type === 'MD' || type === 'men' || type === 'singles-men') return getGender(name) === 'Male';
    if (type === 'LD' || type === 'WD' || type === 'women' || type === 'ladies' || type === 'singles-women') return getGender(name) === 'Female';
    return true;
  }

  // ── Pool sources ──
  // availablePool limits who the dice may select. The actual resting list is
  // kept separately so playing-pool candidates are not misclassified as resters.
  const courtPlayers = [...(game.pair1 || []), ...(game.pair2 || [])];
  const resting      = (data.resting || []).map(r => r.split('#')[0]);
  const candidatePool = availablePool || resting;
  const candidateSet = new Set(candidatePool.map(name => String(name).split('#')[0]));
  const freeCourtCandidates = () => {
    const names = [...courtPlayers];
    for (let index=0; index<(data.games||[]).length; index++) {
      if (index===gameIndex || ((schedulerState.courtTypes||[])[index]||'free')!=='free') continue;
      const other=data.games[index];
      for (const name of [...(other?.pair1||[]),...(other?.pair2||[])]) {
        if (candidateSet.has(String(name).split('#')[0])) names.push(name);
      }
    }
    return [...new Set(names)];
  };

  let pool;

  if (fmt === 'singles') {
    // Gendered Singles must never fall back to an unrestricted pool.
    pool = (availablePool ? freeCourtCandidates() : [...new Set([...courtPlayers, ...candidatePool])])
      .filter(player => genderOk(player, courtType));
    if (pool.length < 2) return null;

  } else if (courtType === 'free') {
    // A round-page dice may exchange players only with another Free court.
    // This prevents a Free reroll from breaking an MD/LD/XD court.
    pool = availablePool ? freeCourtCandidates() : [...new Set([...courtPlayers, ...candidatePool])];

  } else if (courtType === 'XD') {
    // XD needs exactly 2M + 2F — collect males and females separately via cascade
    const needM = 2, needF = 2;

    function cascadeXD(sourceNames) {
      return {
        males:   sourceNames.filter(p => getGender(p) === 'Male'),
        females: sourceNames.filter(p => getGender(p) === 'Female'),
      };
    }

    // Source 1: current court players
    const src1 = cascadeXD(courtPlayers);
    let males   = [...src1.males];
    let females = [...src1.females];

    // Source 2: Free courts (courts whose type is 'free')
    if (males.length < needM || females.length < needF) {
      const courtTypes = schedulerState.courtTypes || [];
      for (let i = 0; i < (data.games || []).length; i++) {
        if (i === gameIndex) continue;
        const ct = courtTypes[i] || 'free';
        if (ct !== 'free') continue; // only pull from Free courts
        const g = data.games[i];
        if (!g) continue;
        const freePlayers = [...(g.pair1 || []), ...(g.pair2 || [])];
        const fc = cascadeXD(freePlayers);
        males   = [...new Set([...males,   ...fc.males])];
        females = [...new Set([...females, ...fc.females])];
      }
    }

    // Source 3: Resting pool
    if (males.length < needM || females.length < needF) {
      const rc = cascadeXD(candidatePool);
      males   = [...new Set([...males,   ...rc.males])];
      females = [...new Set([...females, ...rc.females])];
    }

    if (males.length < needM || females.length < needF) {
      // Not enough gendered players — fall back to untyped pool
      pool = [...new Set([...courtPlayers, ...candidatePool])];
    } else {
      // Sort each group by play count
      const pc = schedulerState.PlayedCount;
      const byPC = p => (pc instanceof Map ? pc.get(p) || 0 : 0);
      males.sort((a, b) => byPC(a) - byPC(b));
      females.sort((a, b) => byPC(a) - byPC(b));
      // Interleave M-F-M-F so standard pair-finding picks valid XD combos
      pool = [males[0], females[0], males[1], females[1],
              ...males.slice(2), ...females.slice(2)];
      pool = [...new Set(pool)];
    }

  } else {
    // MD or LD: need 4 players of the correct gender via cascade

    // Source 1: gendered players already on this court
    let typed = courtPlayers.filter(p => genderOk(p, courtType));

    // Source 2: gendered players from Free courts (not typed courts)
    if (typed.length < need) {
      const courtTypes = schedulerState.courtTypes || [];
      for (let i = 0; i < (data.games || []).length; i++) {
        if (i === gameIndex) continue;
        const ct = courtTypes[i] || 'free';
        if (ct !== 'free') continue; // only steal from Free courts
        const g = data.games[i];
        if (!g) continue;
        const freePlayers = [...(g.pair1 || []), ...(g.pair2 || [])];
        const eligible = freePlayers.filter(p => genderOk(p, courtType));
        typed = [...new Set([...typed, ...eligible])];
        if (typed.length >= need) break;
      }
    }

    // Source 3: gendered players from resting pool
    if (typed.length < need) {
      const fromRest = candidatePool.filter(p => genderOk(p, courtType));
      typed = [...new Set([...typed, ...fromRest])];
    }

    if (typed.length >= need) {
      pool = typed;
    } else {
      // Not enough typed players — fall back to untyped pool
      pool = [...new Set([...courtPlayers, ...candidatePool])];
    }
  }

  if (pool.length < need) return;

  // Sort by PlayedCount ascending (least played first)
  // Note: XD pool is already interleaved M-F-M-F — sort within the full pool only for non-XD
  const pc = schedulerState.PlayedCount;
  if (courtType !== 'XD') {
    pool.sort((a, b) => ((pc instanceof Map ? pc.get(a) || 0 : 0) - (pc instanceof Map ? pc.get(b) || 0 : 0)));
  }

  let pair1, pair2;

  if (fmt === 'singles') {
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++)
      for (let j = i+1; j < pool.length; j++) {
        const met = (opponentMapPlain[pool[i]] || {})[pool[j]] || 0;
        if (-met > bestScore) { bestScore = -met; pair1 = [pool[i]]; pair2 = [pool[j]]; }
      }
  } else if (courtType === 'XD') {
    // XD: pair1 = [M, F], pair2 = [M, F] — pick best matchup from pool (M-F-M-F interleaved)
    const xdMales   = pool.filter(p => getGender(p) === 'Male');
    const xdFemales = pool.filter(p => getGender(p) === 'Female');
    if (xdMales.length >= 2 && xdFemales.length >= 2) {
      // Temp-mark current court pairs to force different result
      const tempKeys = [];
      for (const pair of [game.pair1, game.pair2]) {
        if (pair && pair.length >= 2) {
          const key = [...pair].sort().join('&');
          if (!schedulerState.pairPlayedSet.has(key)) {
            schedulerState.pairPlayedSet.add(key);
            tempKeys.push(key);
          }
        }
      }
      // Try all M×F combinations for pair1 and pair2
      let bestScore = Infinity;
      for (let mi = 0; mi < xdMales.length; mi++) {
        for (let fi = 0; fi < xdFemales.length; fi++) {
          const p1 = [xdMales[mi], xdFemales[fi]];
          for (let mj = 0; mj < xdMales.length; mj++) {
            if (mj === mi) continue;
            for (let fj = 0; fj < xdFemales.length; fj++) {
              if (fj === fi) continue;
              const p2 = [xdMales[mj], xdFemales[fj]];
              const k1 = p1.slice().sort().join('&');
              const k2 = p2.slice().sort().join('&');
              if (schedulerState.pairPlayedSet.has(k1) || schedulerState.pairPlayedSet.has(k2)) continue;
              // Score = sum of times these players have faced each other
              const oppScore = [p1[0],p1[1]].reduce((s,a) =>
                s + [p2[0],p2[1]].reduce((s2,b) =>
                  s2 + ((opponentMapPlain[a] || {})[b] || 0), 0), 0);
              if (oppScore < bestScore) { bestScore = oppScore; pair1 = p1; pair2 = p2; }
            }
          }
        }
      }
      for (const key of tempKeys) schedulerState.pairPlayedSet.delete(key);
      // Fallback
      if (!pair1) { pair1 = [xdMales[0], xdFemales[0]]; pair2 = [xdMales[1], xdFemales[1]]; }
    } else {
      pair1 = [pool[0], pool[1]]; pair2 = [pool[2], pool[3]];
    }

  } else {
    // MD / LD / Free — standard pair-finding
    const sortedPool = [...pool].sort((a, b) =>
      ((pc instanceof Map ? pc.get(a) || 0 : 0) - (pc instanceof Map ? pc.get(b) || 0 : 0)));
    const minCount = pc instanceof Map ? (pc.get(sortedPool[0]) || 0) : 0;
    const maxCount = pc instanceof Map ? (pc.get(sortedPool[sortedPool.length-1]) || 0) : 0;

    for (let threshold = minCount; threshold <= maxCount; threshold++) {
      const candidate = sortedPool.filter(p => (pc instanceof Map ? pc.get(p) || 0 : 0) <= threshold);
      if (candidate.length < 4) continue;

      // Temp-mark current court pairs as used to force a different result
      const tempKeys = [];
      for (const pair of [game.pair1, game.pair2]) {
        if (pair && pair.length >= 2) {
          const key = [...pair].sort().join('&');
          if (!schedulerState.pairPlayedSet.has(key)) {
            schedulerState.pairPlayedSet.add(key);
            tempKeys.push(key);
          }
        }
      }

      if (typeof findDisjointPairs === 'function' && typeof getMatchupScores === 'function') {
        try {
          const pairs = findDisjointPairs(candidate, schedulerState.pairPlayedSet, 2, opponentMapPlain);
          if (pairs && pairs.length >= 2) {
            const matchups = getMatchupScores(pairs, opponentMapPlain);
            if (matchups && matchups[0]) { pair1 = matchups[0].pair1; pair2 = matchups[0].pair2; }
          }
        } catch(e) {}
      }

      for (const key of tempKeys) schedulerState.pairPlayedSet.delete(key);
      if (pair1) break;
    }
    if (!pair1) { pair1 = [pool[0], pool[1]]; pair2 = [pool[2], pool[3]]; }
  }

  // Balanced dice: search every eligible local alternative, require a visible
  // change when possible, then choose the smallest team-rating gap. This is
  // intentionally local; a court reroll must not regenerate the full round.
  const isBalancedReroll = schedulerState.gameGenerationMode === 'balanced' || schedulerState.balancedGamesMode === true;
  if (isBalancedReroll && pool.length >= need) {
    const ratingOf = name => {
      const player = (schedulerState.allPlayers || []).find(item => item && item.name === name);
      const value = player && !player.guest && !player.unrated
        ? Number(player.clubRating ?? player.rating ?? 1.0)
        : 1.0;
      return Number.isFinite(value) ? value : 1.0;
    };
    const pairKeyLocal = pair => [...pair].sort().join('&');
    const matchKeyLocal = (a, b) => [pairKeyLocal(a), pairKeyLocal(b)].sort().join(':');
    const currentMatchKey = matchKeyLocal(game.pair1 || [], game.pair2 || []);
    const fixedPairs = schedulerState.fixedPairs || [];

    function fixedPairsAllowed(a, b) {
      const selected = [...a, ...b];
      for (const fixed of fixedPairs) {
        if (!Array.isArray(fixed) || fixed.length < 2) continue;
        const hasA = selected.includes(fixed[0]);
        const hasB = selected.includes(fixed[1]);
        if (hasA !== hasB) return false;
        if (hasA && !((a.includes(fixed[0]) && a.includes(fixed[1])) || (b.includes(fixed[0]) && b.includes(fixed[1])))) return false;
      }
      return true;
    }

    function candidateScore(a, b) {
      const first = a.reduce((sum, name) => sum + ratingOf(name), 0);
      const second = b.reduce((sum, name) => sum + ratingOf(name), 0);
      let opponentRepeats = 0;
      for (const left of a) for (const right of b) {
        opponentRepeats += (opponentMapPlain[left] || {})[right] || 0;
      }
      const partnerRepeats = a.length === 2
        ? Number(schedulerState.pairPlayedSet?.has(pairKeyLocal(a))) + Number(schedulerState.pairPlayedSet?.has(pairKeyLocal(b)))
        : 0;
      const playLoad = [...a, ...b].reduce((sum, name) => sum + (pc instanceof Map ? (pc.get(name) || 0) : 0), 0);
      return Math.abs(first - second) * 1000000 + opponentRepeats * 1000 + partnerRepeats * 100 + playLoad;
    }

    const alternatives = [];
    if (fmt === 'singles') {
      for (let i = 0; i < pool.length - 1; i++) {
        for (let j = i + 1; j < pool.length; j++) {
          const a = [pool[i]], b = [pool[j]];
          alternatives.push({ pair1: a, pair2: b, key: matchKeyLocal(a, b), score: candidateScore(a, b) });
        }
      }
    } else {
      for (let i = 0; i < pool.length - 3; i++) {
        for (let j = i + 1; j < pool.length - 2; j++) {
          for (let k = j + 1; k < pool.length - 1; k++) {
            for (let l = k + 1; l < pool.length; l++) {
              const four = [pool[i], pool[j], pool[k], pool[l]];
              let pairings;
              if (courtType === 'XD') {
                const males = four.filter(name => getGender(name) === 'Male');
                const females = four.filter(name => getGender(name) === 'Female');
                if (males.length !== 2 || females.length !== 2) continue;
                pairings = [
                  [[males[0], females[0]], [males[1], females[1]]],
                  [[males[0], females[1]], [males[1], females[0]]],
                ];
              } else {
                pairings = [
                  [[four[0], four[1]], [four[2], four[3]]],
                  [[four[0], four[2]], [four[1], four[3]]],
                  [[four[0], four[3]], [four[1], four[2]]],
                ];
              }
              for (const [a, b] of pairings) {
                if (!fixedPairsAllowed(a, b)) continue;
                alternatives.push({ pair1: a, pair2: b, key: matchKeyLocal(a, b), score: candidateScore(a, b) });
              }
            }
          }
        }
      }
    }

    const changed = alternatives.filter(candidate => candidate.key !== currentMatchKey);
    const eligible = changed.length ? changed : alternatives;
    eligible.sort((a, b) => a.score - b.score || a.key.localeCompare(b.key));
    if (eligible.length) {
      pair1 = [...eligible[0].pair1];
      pair2 = [...eligible[0].pair2];
    }
  }

  // Standard rerolls must preserve configured fixed pairs too. The Worker
  // already keeps them intact during round generation; without this local
  // check a later dice click could split that valid team.
  const rerollFixedPairs = schedulerState.fixedPairs || [];
  if (!isBalancedReroll && fmt === 'doubles' && rerollFixedPairs.length && pool.length >= 4) {
    const pairKeyLocal = pair => [...pair].sort().join('&');
    const matchKeyLocal = (a,b) => [pairKeyLocal(a),pairKeyLocal(b)].sort().join(':');
    const currentMatchKey = matchKeyLocal(game.pair1||[],game.pair2||[]);
    const fixedAllowed = (a,b) => rerollFixedPairs.every(fixed => {
      if (!Array.isArray(fixed)||fixed.length<2) return true;
      const selected=[...a,...b], hasFirst=selected.includes(fixed[0]), hasSecond=selected.includes(fixed[1]);
      if (hasFirst!==hasSecond) return false;
      return !hasFirst || (a.includes(fixed[0])&&a.includes(fixed[1])) || (b.includes(fixed[0])&&b.includes(fixed[1]));
    });
    const alternatives=[];
    for (let i=0;i<pool.length-3;i++) for (let j=i+1;j<pool.length-2;j++)
      for (let k=j+1;k<pool.length-1;k++) for (let l=k+1;l<pool.length;l++) {
        const four=[pool[i],pool[j],pool[k],pool[l]];
        let arrangements;
        if (courtType==='XD') {
          const males=four.filter(name=>getGender(name)==='Male');
          const females=four.filter(name=>getGender(name)==='Female');
          if (males.length!==2||females.length!==2) continue;
          arrangements=[[[males[0],females[0]],[males[1],females[1]]],[[males[0],females[1]],[males[1],females[0]]]];
        } else {
          arrangements=[[[four[0],four[1]],[four[2],four[3]]],[[four[0],four[2]],[four[1],four[3]]],[[four[0],four[3]],[four[1],four[2]]]];
        }
        for (const [a,b] of arrangements) {
          if (!fixedAllowed(a,b)) continue;
          let opponentRepeats=0;
          for (const left of a) for (const right of b) opponentRepeats+=(opponentMapPlain[left]||{})[right]||0;
          const partnerRepeats=Number(schedulerState.pairPlayedSet?.has(pairKeyLocal(a)))+Number(schedulerState.pairPlayedSet?.has(pairKeyLocal(b)));
          alternatives.push({pair1:a,pair2:b,key:matchKeyLocal(a,b),score:opponentRepeats*1000+partnerRepeats});
        }
      }
    const changed=alternatives.filter(candidate=>candidate.key!==currentMatchKey);
    const eligible=changed.length?changed:alternatives;
    eligible.sort((a,b)=>a.score-b.score||a.key.localeCompare(b.key));
    if (eligible.length) { pair1=[...eligible[0].pair1]; pair2=[...eligible[0].pair2]; }
  }

  if (!pair1 || !pair2) return null;

  return { pair1, pair2, courtPlayers, resting };
}

// ═══════════════════════════════════════════════════════════════════
// rerollCourt — ROUNDS PAGE wrapper around _rerollCourtGetPairs
// Calls core, updates data.resting/playing, refreshes rounds UI.
// ═══════════════════════════════════════════════════════════════════
async function rerollCourt(gameIndex) {
  // Build 852: a prepared Offline Round must stay exactly as prepared.
  // Online Round Manager remains unchanged.
  try {
    if (sessionStorage.getItem('scsOfflineRoundModeActive') === '1') return;
  } catch (_) {}
  const data = allRounds[currentRoundIndex];
  if (!data || !data.games) return;

  // Round dice may reshuffle only players already selected to play this round.
  // Resting players keep their rest and are never promoted by a dice click.
  const playingPool = (data.playing || [])
    .map(name => String(name).split('#')[0]);
  const result = _rerollCourtGetPairs(gameIndex, playingPool);
  if (!result) return;

  const { pair1, pair2, courtPlayers, resting } = result;
  const game   = data.games[gameIndex];
  const chosen = new Set([...pair1, ...pair2]);

  const fromThisCourt          = new Set(courtPlayers);
  const fromResting            = new Set(resting);
  const pulledFromOtherCourts  = [...chosen].filter(p => !fromThisCourt.has(p) && !fromResting.has(p));
  const displacedFromThisCourt = courtPlayers.filter(p => !chosen.has(p));
  const pulledFromResting      = [...chosen].filter(p => fromResting.has(p));

  // ── Update the target court ──
  data.games[gameIndex] = { ...game, pair1, pair2 };

  // ── Fix free courts that lost players (Source 2 pull) ──
  if (pulledFromOtherCourts.length > 0) {
    const courtTypes = schedulerState.courtTypes || [];
    let swapPool = [...displacedFromThisCourt];

    for (let i = 0; i < (data.games || []).length; i++) {
      if (i === gameIndex) continue;
      const ct = courtTypes[i] || 'free';
      if (ct !== 'free') continue;
      const g = data.games[i];
      if (!g) continue;

      const allOnCourt    = [...(g.pair1 || []), ...(g.pair2 || [])];
      const takenFromHere = allOnCourt.filter(p => pulledFromOtherCourts.includes(p));
      if (takenFromHere.length === 0) continue;

      let updatedCourt = allOnCourt.filter(p => !takenFromHere.includes(p));
      const toInsert   = swapPool.splice(0, takenFromHere.length);
      updatedCourt     = [...updatedCourt, ...toInsert];

      const unplaced = takenFromHere.slice(toInsert.length);
      data.resting   = [...(data.resting || []), ...unplaced];

      const origSize1 = (g.pair1 || []).length;
      data.games[i]   = { ...g,
        pair1: updatedCourt.slice(0, origSize1),
        pair2: updatedCourt.slice(origSize1, origSize1 * 2)
      };
    }
    if (swapPool.length > 0) data.resting = [...(data.resting || []), ...swapPool];
  } else {
    data.resting = [
      ...(data.resting || []).filter(r => !chosen.has(r.split('#')[0])),
      ...displacedFromThisCourt
    ];
  }

  data.resting = (data.resting || []).filter(r => !chosen.has(r.split('#')[0]));
  data.playing = [
    ...(data.playing || []).filter(p => !displacedFromThisCourt.includes(p.split('#')[0])),
    ...pulledFromResting
  ];

  showRound(currentRoundIndex);
  if (typeof saveSnapshot === 'function') saveSnapshot();
}
