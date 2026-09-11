/* ============================================================
   offline-rounds.js — prepared round reserve for court use

   The private scheduling algorithm remains on the Worker.
   This module only:
     1) asks the existing Worker to prepare a reserve while online,
     2) stores returned round results in IndexedDB,
     3) chooses/adapts the closest stored result when Worker is unavailable.
============================================================ */
(function () {
  'use strict';

  let preparing = false;
  const ACTIVE_KEY = 'scsOfflineRoundModeActive';
  const ALG_KEY = 'scsOfflineRoundAlgorithm';
  const RANDOM_KEY = 'scsOfflineRandomOrder';
  const WINNER_KEY = 'scsOfflineWinner';
  const SESSION_KEY = 'scsOfflineRoundSessionInProgress';
  const DATASET_KEY = 'scsOfflineSelectedDataset';
  const SESSION_DATASET_KEY = 'scsOfflineSessionDataset';
  const GAME_TYPE_KEY = 'scsOfflineGameType';
  const UNIQUE_KEY = 'scsOfflineUniquePairMode';
  const USE_TEMPLATES_KEY = 'scsOfflineUseTemplates';
  const USE_TEMPLATES_PREF_VERSION_KEY = 'scsOfflineUseTemplatesPrefV2';
  const FIXED_PAIR_COUNT_KEY = 'scsOfflineFixedPairCount';
  const COURT_COUNT_KEY = 'scsOfflineCourtCount';
  const TOP_RATED_COUNT_KEY = 'scsOfflineTopRatedCount';
  const BOTTOM_RATED_COUNT_KEY = 'scsOfflineBottomRatedCount';
  const TEMP_META_KEY = 'offlineTempSessionMeta';
  const LIVE_CONTEXT_KEY = 'scsIModeLiveSessionContext';

  function canManageTemplatesForSelectedClub() {
    const selectedClubId = localStorage.getItem('kbrr_vault_club_id') || localStorage.getItem('kbrr_org_club_id') || '';
    return !!selectedClubId && String(selectedClubId) === String(window.SCS_ROUNDS_TEMPLATE_CLUB_ID || '');
  }

  // Build 976 — temporarily disable iMode crash/reload recovery without deleting
  // the recovery implementation. Set this back to true when recovery is ready
  // to be re-enabled. A normal in-page iMode session is unaffected.
  const ENABLE_IMODE_RECOVERY = false;

  function discardPersistedIModeRecoveryOnBoot() {
    if (ENABLE_IMODE_RECOVERY) return;
    // SESSION_KEY/SESSION_DATASET_KEY are persistence markers used only to
    // continue an iMode session after the document is recreated. Clear them
    // at module boot so a killed/reloaded PWA always returns to a fresh iMode
    // start. Keep datasets/templates themselves untouched.
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_DATASET_KEY);
    localStorage.removeItem(LIVE_CONTEXT_KEY);
    try { sessionStorage.removeItem(ACTIVE_KEY); } catch (_) {}
  }

  discardPersistedIModeRecoveryOnBoot();

  // Build 878 — Slot Manager Rounds Template editor.
  // It deliberately reuses the existing Round page and its proven swap handlers.
  let templatePickerMode = false;
  let templatePickerAction = 'auto';
  let templateEditor = null;
  let templateEditorBackup = null;
  let templateEditorDirty = false;
  let libraryMatchRequestId = 0;
  let offlineStartRequestId = 0;
  let autoLibraryInstallPromise = null;

  function settleWithin(promise, ms, fallback) {
    let timer = null;
    return Promise.race([
      Promise.resolve(promise),
      new Promise(resolve => { timer = setTimeout(() => resolve(fallback), Math.max(250, Number(ms) || 1500)); })
    ]).finally(() => { if (timer) clearTimeout(timer); });
  }

  async function fetchWithin(url, options, ms) {
    if (typeof AbortController === 'undefined') return fetch(url, options);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(ms) || 5000));
    try {
      return await fetch(url, Object.assign({}, options || {}, { signal: controller.signal }));
    } finally {
      clearTimeout(timer);
    }
  }



  function saveLiveIModeContext() {
    if (typeof schedulerState === 'undefined' || !schedulerState) return false;
    try {
      const active = Array.isArray(schedulerState.activeplayers)
        ? schedulerState.activeplayers.map(baseName).filter(Boolean) : [];
      const allPlayers = Array.isArray(schedulerState.allPlayers)
        ? schedulerState.allPlayers.map(function(player) { return player ? Object.assign({}, player) : player; }).filter(Boolean)
        : [];
      if (!active.length && !allPlayers.length) return false;
      const context = {
        version: 1,
        savedAt: Date.now(),
        activeplayers: active,
        allPlayers: allPlayers,
        fixedPairs: Array.isArray(schedulerState.fixedPairs)
          ? schedulerState.fixedPairs.map(function(pair) { return Array.isArray(pair) ? pair.map(baseName) : pair; }) : [],
        numCourts: getCourtCount(),
        gameType: getGameType(),
        algorithm: getAlgorithm(),
        randomOrder: getRandomOrder(),
        uniquePairMode: getOfflineUniquePairMode(),
        winner: getWinner()
      };
      localStorage.setItem(LIVE_CONTEXT_KEY, JSON.stringify(context));
      return true;
    } catch (_) {
      return false;
    }
  }

  function restoreLiveIModeContext() {
    if (!ENABLE_IMODE_RECOVERY) return false;
    if (typeof schedulerState === 'undefined' || !schedulerState) return false;

    const currentActive = Array.isArray(schedulerState.activeplayers)
      ? schedulerState.activeplayers.map(baseName).filter(Boolean) : [];
    const currentPlayers = Array.isArray(schedulerState.allPlayers)
      ? schedulerState.allPlayers.filter(Boolean) : [];

    // During iMode recovery, the saved live-session context is authoritative.
    // Do not short-circuit just because schedulerState already contains a
    // default/stale roster from normal app startup; that was the reason the
    // Continue card showed the wrong players, Fixed Pairs and court count.
    let context = null;
    try { context = JSON.parse(localStorage.getItem(LIVE_CONTEXT_KEY) || 'null'); } catch (_) {}

    // Compatibility fallback for live sessions started before this build.
    if (!context) {
      try {
        const snapshot = JSON.parse(localStorage.getItem('kbrr_snapshot') || 'null');
        if (snapshot && snapshot.schedulerState) {
          const state = snapshot.schedulerState;
          context = {
            activeplayers: Array.isArray(state.activeplayers) ? state.activeplayers : [],
            allPlayers: Array.isArray(state.allPlayers) ? state.allPlayers : [],
            fixedPairs: Array.isArray(state.fixedPairs) ? state.fixedPairs : [],
            numCourts: Number(state.numCourts) || getCourtCount(),
            algorithm: state.gameGenerationMode || getAlgorithm()
          };
        }
      } catch (_) {}
    }
    if (!context) {
      try {
        const cached = JSON.parse(localStorage.getItem('schedulerPlayers') || '[]');
        if (Array.isArray(cached) && cached.length) {
          context = {
            allPlayers: cached,
            activeplayers: cached.filter(function(player) { return player && player.active; }).map(function(player) { return player.name; }),
            fixedPairs: [],
            numCourts: getCourtCount(),
            algorithm: getAlgorithm()
          };
        }
      } catch (_) {}
    }
    if (!context) {
      // If there is genuinely no persisted recovery context, keep a fully
      // populated schedulerState rather than destroying a valid live roster.
      return currentActive.length > 0 && currentPlayers.length > 0;
    }

    const allPlayers = Array.isArray(context.allPlayers) ? context.allPlayers.filter(Boolean) : [];
    const activeNames = Array.isArray(context.activeplayers) ? context.activeplayers.map(baseName).filter(Boolean) : [];
    if (!allPlayers.length && !activeNames.length) return false;

    if (allPlayers.length) {
      schedulerState.allPlayers = allPlayers.map(function(player) { return Object.assign({}, player); });
    }
    if (activeNames.length) {
      if (!Array.isArray(schedulerState.activeplayers)) schedulerState.activeplayers = [];
      schedulerState.activeplayers.splice(0, schedulerState.activeplayers.length, ...activeNames);
      const activeSet = new Set(activeNames.map(function(name) { return String(name).trim().toLowerCase(); }));
      if (Array.isArray(schedulerState.allPlayers)) {
        schedulerState.allPlayers.forEach(function(player) {
          if (player && player.name) player.active = activeSet.has(String(player.name).trim().toLowerCase());
        });
      }
    }
    schedulerState.fixedPairs = Array.isArray(context.fixedPairs)
      ? context.fixedPairs.map(function(pair) { return Array.isArray(pair) ? pair.map(baseName) : pair; }) : [];
    schedulerState.fixedMap = new Map();
    schedulerState.fixedPairs.forEach(function(pair) {
      if (!Array.isArray(pair) || pair.length !== 2) return;
      schedulerState.fixedMap.set(pair[0], pair[1]);
      schedulerState.fixedMap.set(pair[1], pair[0]);
    });

    const courtCount = Math.max(1, Number(context.numCourts) || getCourtCount());

    // Restore the iMode controls as well as schedulerState. The organiser card
    // reads these localStorage preferences, so without this synchronization it
    // could visually show 1 court / no Fixed Pairs while Continue used the
    // recovered session internally.
    localStorage.setItem(COURT_COUNT_KEY, String(courtCount));
    localStorage.setItem(FIXED_PAIR_COUNT_KEY, String(schedulerState.fixedPairs.length));
    if (context.gameType) localStorage.setItem(GAME_TYPE_KEY, ['doubles','mixed','singles'].includes(context.gameType) ? context.gameType : 'doubles');
    if (context.algorithm) localStorage.setItem(ALG_KEY, context.algorithm === 'balanced' ? 'balanced' : 'standard');
    if (typeof context.randomOrder === 'boolean') localStorage.setItem(RANDOM_KEY, context.randomOrder ? '1' : '0');
    if (typeof context.uniquePairMode === 'boolean') localStorage.setItem(UNIQUE_KEY, context.uniquePairMode ? '1' : '0');
    if (typeof context.winner === 'boolean') localStorage.setItem(WINNER_KEY, context.winner ? '1' : '0');

    schedulerState.numCourts = courtCount;
    schedulerState.courts = courtCount;
    schedulerState.courtFormats = Array(courtCount).fill('doubles');
    schedulerState.courtTypes = Array(courtCount).fill((context.gameType || getGameType()) === 'mixed' ? 'XD' : 'free');
    if (!Array.isArray(schedulerState.restQueue) || !schedulerState.restQueue.length) {
      schedulerState.restQueue = activeNames.slice();
    }

    const liveCourtsText = document.getElementById('num-courts');
    if (liveCourtsText) liveCourtsText.textContent = String(courtCount);
    try { if (typeof courts !== 'undefined') courts = courtCount; } catch (_) {}
    refreshControls();
    try { if (typeof refreshOrganiserLocalNavCounts === 'function') refreshOrganiserLocalNavCounts(); } catch (_) {}
    return activeNames.length > 0;
  }

  function isTemplateEditorActive() { return !!templateEditor; }
  function markTemplateDirty() {
    if (!templateEditor) return;
    templateEditorDirty = true;
    const liveText = document.querySelector('#sessionLiveBar .rtb-live-txt');
    if (liveText) liveText.textContent = 'EDIT •';
  }

  function isActive() { return sessionStorage.getItem(ACTIVE_KEY) === '1'; }
  function hasSessionInProgress() { return localStorage.getItem(SESSION_KEY) === '1'; }
  function isIModeActive() { return isActive() || hasSessionInProgress(); }
  function isTemplateSessionActive() {
    return isIModeActive() && !!localStorage.getItem(SESSION_DATASET_KEY);
  }
  function activate() { sessionStorage.setItem(ACTIVE_KEY, '1'); }
  function deactivate() { sessionStorage.removeItem(ACTIVE_KEY); }
  function getAlgorithm() { return localStorage.getItem(ALG_KEY) === 'balanced' ? 'balanced' : 'standard'; }
  function getRandomOrder() { return localStorage.getItem(RANDOM_KEY) !== '0'; }
  function getWinner() { return localStorage.getItem(WINNER_KEY) === '1'; }
  function getGameType() { const v=localStorage.getItem(GAME_TYPE_KEY); return ['doubles','singles','mixed'].includes(v) ? v : 'doubles'; }
  function getOfflineUniquePairMode() { return localStorage.getItem(UNIQUE_KEY) !== '0'; }
  function getUseTemplates() {
    if (!canManageTemplatesForSelectedClub()) return false;
    // Round iMode is live/online-first. When the device is offline, templates
    // become the automatic fallback regardless of the online preference.
    if (!navigator.onLine) return true;
    // V2 intentionally ignores the old default-ON value once, so existing
    // installs also move to the new online-first default after this update.
    if (localStorage.getItem(USE_TEMPLATES_PREF_VERSION_KEY) !== '2') {
      localStorage.setItem(USE_TEMPLATES_KEY, '0');
      localStorage.setItem(USE_TEMPLATES_PREF_VERSION_KEY, '2');
      return false;
    }
    return localStorage.getItem(USE_TEMPLATES_KEY) === '1';
  }
  function setUseTemplates(enabled) {
    if (!canManageTemplatesForSelectedClub()) {
      localStorage.setItem(USE_TEMPLATES_KEY, '0');
      refreshControls();
      return;
    }
    // Build 975 — keep the iMode setup controls usable after a PWA recovery.
    // Changing this switch during an existing session only changes the saved
    // preference for the next iMode start; the recovered session itself keeps
    // its already-selected live/template source in SESSION_DATASET_KEY.
    localStorage.setItem(USE_TEMPLATES_KEY, enabled ? '1' : '0');
    localStorage.setItem(USE_TEMPLATES_PREF_VERSION_KEY, '2');
    if (!enabled) {
      localStorage.removeItem(DATASET_KEY);
      const info = document.getElementById('offlineTemplateMatch');
      if (info) {
        info.textContent = t('templatesOff') + ' · ' + t('liveRoundMode');
        info.classList.remove('is-ready');
      }
    }
    refreshControls();
    refreshOfflineStartAvailability();
    refreshStartLabel();
  }
  function getCourtCount() {
    const stored = Number(localStorage.getItem(COURT_COUNT_KEY));
    return Math.max(1, Math.min(20, Number.isFinite(stored) && stored > 0 ? stored : 2));
  }
  function currentCourtLimit(type) {
    const gameType = type || getGameType();
    const activeCount = currentActivePlayers().length;
    if (gameType === 'singles') return Math.floor(activeCount / 2);
    if (gameType === 'mixed') {
      const genders = currentGenderCounts();
      return Math.min(Math.floor(genders.men / 2), Math.floor(genders.women / 2));
    }
    return Math.floor(activeCount / 4);
  }
  function setCourtCount(count) {
    const limit = currentCourtLimit();
    const maximum = Math.max(1, Math.min(20, limit || 1));
    const normalized = Math.max(1, Math.min(maximum, Number(count) || 1));
    localStorage.setItem(COURT_COUNT_KEY, String(normalized));
    const prepareInput = document.getElementById('offlineCourtsCount');
    if (prepareInput && [...prepareInput.options].some(option => Number(option.value) === normalized && !option.disabled)) {
      prepareInput.value = String(normalized);
    }
    refreshControls();
    refreshMatchAfterControlChange();
    refreshStartLabel();
  }
  function adjustCourtCount(delta) { setCourtCount(getCourtCount() + (Number(delta) || 0)); }
  function requestedFixedPairCount() {
    const input = document.getElementById('offlinePrepareFixedPairs');
    const stored = Number(localStorage.getItem(FIXED_PAIR_COUNT_KEY) || 0);
    const count = Number(input && input.value);
    return Math.max(0, Math.min(5, Number.isFinite(count) ? count : stored));
  }
  function setFixedPairCount(count) {
    const genderCounts = requestedPrepareGenderCounts();
    const maximum = getGameType() === 'mixed'
      ? Math.min(5, genderCounts.men, genderCounts.women)
      : Math.min(5, Math.floor(requestedPreparePlayerCount() / 2));
    const normalized = Math.max(0, Math.min(maximum, Number(count) || 0));
    localStorage.setItem(FIXED_PAIR_COUNT_KEY, String(normalized));
    const input = document.getElementById('offlinePrepareFixedPairs');
    if (input) input.value = String(normalized);
    refreshMatchAfterControlChange();
  }
  function prepareOverlayOpen() {
    const overlay = document.getElementById('offlinePrepareOverlay');
    return !!(overlay && !overlay.hidden);
  }
  function refreshMatchAfterControlChange() {
    if (prepareOverlayOpen()) refreshLibraryMatchFromControls();
  }
  function setGameType(type) {
    const nextType = ['doubles','singles','mixed'].includes(type) ? type : 'doubles';
    if (nextType === 'mixed') {
      const genders = currentGenderCounts();
      if (!(genders.men >= 2 * getCourtCount() && genders.women >= 2 * getCourtCount())) return;
    }
    localStorage.setItem(GAME_TYPE_KEY, nextType);
    const limit = currentCourtLimit(nextType);
    if (getCourtCount() > Math.max(1, limit || 1)) localStorage.setItem(COURT_COUNT_KEY, String(Math.max(1, limit || 1)));
    refreshControls();
    refreshPrepareCourtLimit();
    refreshMatchAfterControlChange();
    refreshStartLabel();
  }

  function refreshControls() {
    const algorithm = getAlgorithm();
    ['sampleOfflineGameModeStandard','sampleOfflineGameModeBalanced'].forEach(function(id) {
      const el = document.getElementById(id);
      if (!el) return;
      const selected = id.endsWith('Balanced') ? algorithm === 'balanced' : algorithm !== 'balanced';
      el.classList.toggle('is-active', selected);
      const marker = el.querySelector('span');
      if (marker) marker.textContent = selected ? '◉' : '○';
    });
    let gameType = getGameType();
    const genderCounts = currentGenderCounts();
    const mixedRequiredPerGender = 2 * getCourtCount();
    const mixedAvailable = genderCounts.men >= mixedRequiredPerGender && genderCounts.women >= mixedRequiredPerGender;
    if (gameType === 'mixed' && !mixedAvailable) {
      gameType = 'doubles';
      localStorage.setItem(GAME_TYPE_KEY, gameType);
    }
    ['Doubles','Mixed','Singles'].forEach(function(name) {
      const el = document.getElementById('sampleOfflineFormat' + name);
      if (!el) return;
      const selected = gameType === name.toLowerCase();
      const disabled = name === 'Mixed' && !mixedAvailable;
      el.disabled = disabled;
      el.setAttribute('aria-disabled', disabled ? 'true' : 'false');
      el.classList.toggle('is-disabled', disabled);
      el.classList.toggle('is-active', selected);
      const marker = el.querySelector('span');
      if (marker) marker.textContent = selected ? '◉' : '○';
    });
    const cardUnique = document.getElementById('sampleOfflineUniquePairMode');
    if (cardUnique) { cardUnique.checked = getOfflineUniquePairMode(); cardUnique.disabled = algorithm === 'balanced'; }
    const prepDoubles = document.getElementById('offlinePrepareDoubles');
    const prepMixed = document.getElementById('offlinePrepareMixed');
    if (prepDoubles) prepDoubles.classList.toggle('is-active', gameType === 'doubles');
    if (prepMixed) prepMixed.classList.toggle('is-active', gameType === 'mixed');
    const mixedCounts = document.getElementById('offlinePrepareMixedCounts');
    if (mixedCounts) mixedCounts.hidden = gameType !== 'mixed';
    const balancedCounts = document.getElementById('offlinePrepareBalancedCounts');
    if (balancedCounts) balancedCounts.hidden = algorithm !== 'balanced';
    const topWrap = document.getElementById('offlineRequirementTopWrap');
    const bottomWrap = document.getElementById('offlineRequirementBottomWrap');
    if (topWrap) topWrap.hidden = algorithm !== 'balanced';
    if (bottomWrap) bottomWrap.hidden = algorithm !== 'balanced';
    const prepStd = document.getElementById('offlinePrepareStandard');
    const prepBal = document.getElementById('offlinePrepareBalanced');
    if (prepStd) prepStd.classList.toggle('is-active', algorithm !== 'balanced');
    if (prepBal) prepBal.classList.toggle('is-active', algorithm === 'balanced');
    const useTemplates = document.getElementById('sampleOfflineUseTemplates');
    if (useTemplates) {
      // Template usage is available to every club. Only template management
      // (create/edit/delete) remains restricted to the configured SCS club.
      useTemplates.checked = getUseTemplates();
      useTemplates.disabled = false;
      useTemplates.setAttribute('aria-disabled', 'false');
      const templatesRow = useTemplates.closest('.org-sample-winner-row');
      if (templatesRow) {
        templatesRow.hidden = false;
        templatesRow.style.display = '';
      }
    }
    const random = document.getElementById('sampleOfflinePlayerOrderToggle');
    if (random) random.checked = getRandomOrder();
    const prepRandom = document.getElementById('offlinePreparePlayerOrderToggle');
    if (prepRandom) prepRandom.checked = getRandomOrder();
    const unique = document.getElementById('offlinePrepareUniqueToggle');
    if (unique) unique.checked = getOfflineUniquePairMode();
    const fixedCount = document.getElementById('offlinePrepareFixedPairs');
    if (fixedCount) fixedCount.value = String(requestedFixedPairCount());
    const courtLimit = currentCourtLimit(gameType);
    const maxCourts = Math.max(1, Math.min(20, courtLimit || 1));
    if (getCourtCount() > maxCourts) localStorage.setItem(COURT_COUNT_KEY, String(maxCourts));
    const shownCourts = getCourtCount();
    const courtValue = document.getElementById('sampleOfflineCourtsValue');
    if (courtValue) courtValue.textContent = String(shownCourts);
    const courtMinus = document.getElementById('sampleOfflineCourtsMinus');
    const courtPlus = document.getElementById('sampleOfflineCourtsPlus');
    if (courtMinus) courtMinus.disabled = shownCourts <= 1;
    if (courtPlus) courtPlus.disabled = courtLimit < 1 || shownCourts >= maxCourts;
    const prepareCourtCount = document.getElementById('offlineCourtsCount');
    if (prepareCourtCount && [...prepareCourtCount.options].some(option => Number(option.value) === getCourtCount())) {
      prepareCourtCount.value = String(getCourtCount());
    }
    const winner = document.getElementById('sampleOfflineWinner');
    if (winner) winner.checked = getWinner();
    const summary = document.getElementById('offlineModeSummary');
    if (summary) summary.textContent = [gameType === 'mixed' ? t('mixed') : (gameType === 'singles' ? t('singles') : (gameType === 'both' ? t('both') : t('doubles'))), getCourtCount() + ' ' + t(getCourtCount() === 1 ? 'court' : 'courtsLabel'), t(algorithm === 'balanced' ? 'balancedMode' : 'standardMode'), t(getUseTemplates() ? 'templatesOn' : 'templatesOff'), t(getRandomOrder() ? 'randomOn' : 'randomOff'), t(getWinner() ? 'winnerOn' : 'winnerOff')].join(' · ');
  }

  function setAlgorithm(mode) {
    localStorage.setItem(ALG_KEY, mode === 'balanced' ? 'balanced' : 'standard');
    refreshControls();
    refreshMatchAfterControlChange();
    refreshStartLabel();
  }
  function setRandomOrder(on) { localStorage.setItem(RANDOM_KEY, on ? '1' : '0'); refreshControls(); refreshMatchAfterControlChange(); refreshStartLabel(); }
  function setOfflineUniquePairMode(on) { localStorage.setItem(UNIQUE_KEY, on ? '1' : '0'); refreshControls(); refreshMatchAfterControlChange(); refreshStartLabel(); }
  function setWinner(on) { localStorage.setItem(WINNER_KEY, on ? '1' : '0'); refreshControls(); }

  function cloneValue(value) {
    if (value == null) return value;
    if (value instanceof Map) return new Map([...value.entries()].map(([k,v]) => [k, cloneValue(v)]));
    if (value instanceof Set) return new Set([...value].map(cloneValue));
    if (Array.isArray(value)) return value.map(cloneValue);
    if (typeof value === 'object') {
      const out = {};
      Object.keys(value).forEach(key => { out[key] = cloneValue(value[key]); });
      return out;
    }
    return value;
  }

  function cloneSchedulerState(source) {
    const state = cloneValue(source || {});
    state.activeplayers = [...((source && source.activeplayers) || [])];
    state.allPlayers = ((source && source.allPlayers) || []).map(p => ({...p}));
    state.fixedPairs = ((source && source.fixedPairs) || []).map(pair => Array.isArray(pair) ? [...pair] : pair);
    state.restQueue = Array.isArray(source && source.restQueue) ? [...source.restQueue] : [...state.activeplayers];
    state.PlayedCount = cloneValue(source && source.PlayedCount instanceof Map ? source.PlayedCount : new Map());
    state.restCount = cloneValue(source && source.restCount instanceof Map ? source.restCount : new Map());
    state.PlayerScoreMap = cloneValue(source && source.PlayerScoreMap instanceof Map ? source.PlayerScoreMap : new Map());
    state.playedTogether = cloneValue(source && source.playedTogether instanceof Map ? source.playedTogether : new Map());
    state.opponentMap = cloneValue(source && source.opponentMap instanceof Map ? source.opponentMap : new Map());
    state.fixedMap = cloneValue(source && source.fixedMap instanceof Map ? source.fixedMap : new Map());
    state.pairPlayedSet = cloneValue(source && source.pairPlayedSet instanceof Set ? source.pairPlayedSet : new Set());
    state.gamesMap = cloneValue(source && source.gamesMap instanceof Set ? source.gamesMap : new Set());
    state.pairHistory = cloneValue(source && source.pairHistory instanceof Map ? source.pairHistory : new Map());
    return state;
  }

  function baseName(name) { return String(name == null ? '' : name).split('#')[0]; }
  function pairKey(a,b) { return [a,b].sort().join('&'); }

  function advancePreparedState(state, round, roundIndex) { // legacy fallback; Build 845 preparation no longer uses this
    const games = (round && round.games) || [];
    const resting = ((round && round.resting) || []).map(baseName);
    const active = new Set(state.activeplayers || []);

    if (!(state.restCount instanceof Map)) state.restCount = new Map();
    resting.forEach(name => state.restCount.set(name, (state.restCount.get(name) || 0) + 1));

    let queue = Array.isArray(state.restQueue) ? state.restQueue.map(baseName) : [...active];
    const restSet = new Set(resting);
    queue = queue.filter(name => !restSet.has(baseName(name)));
    resting.forEach(name => { if (active.has(name)) queue.push(name); });
    state.restQueue = queue;

    if (!(state.PlayedCount instanceof Map)) state.PlayedCount = new Map();
    if (!(state.opponentMap instanceof Map)) state.opponentMap = new Map();
    if (!(state.pairPlayedSet instanceof Set)) state.pairPlayedSet = new Set();
    if (!(state.gamesMap instanceof Set)) state.gamesMap = new Set();
    if (!(state.playedTogether instanceof Map)) state.playedTogether = new Map();
    if (!(state.pairHistory instanceof Map)) state.pairHistory = new Map();

    games.forEach(game => {
      const p1 = [...(game.pair1 || [])];
      const p2 = [...(game.pair2 || [])];
      [...p1, ...p2].forEach(name => {
        state.PlayedCount.set(name, (state.PlayedCount.get(name) || 0) + 1);
        if (!state.opponentMap.has(name)) state.opponentMap.set(name, new Map());
      });
      p1.forEach(a => p2.forEach(b => {
        const am = state.opponentMap.get(a); const bm = state.opponentMap.get(b);
        am.set(b, (am.get(b) || 0) + 1);
        bm.set(a, (bm.get(a) || 0) + 1);
      }));
      [p1,p2].forEach(pair => {
        if (pair.length < 2) return;
        const key = pairKey(pair[0], pair[1]);
        state.pairPlayedSet.add(key);
        state.playedTogether.set(key, roundIndex);
        state.pairHistory.set(key, (state.pairHistory.get(key) || 0) + 1);
      });
      const g1 = p1.slice().sort().join('&');
      const g2 = p2.slice().sort().join('&');
      if (g1 && g2) state.gamesMap.add([g1,g2].sort().join(':'));
    });
  }

  async function getDatasets() {
    if (!window.SCSOfflineDB) return [];
    let datasets = await window.SCSOfflineDB.getMeta('offlineDatasets').catch(() => null);
    datasets = Array.isArray(datasets) ? datasets : [];

    // One-time migration of the previous single preparedBatch format.
    if (!datasets.length) {
      const legacy = await window.SCSOfflineDB.getMeta('preparedBatch').catch(() => null);
      if (legacy && legacy.batchId) {
        const rows = await window.SCSOfflineDB.getPreparedRounds().catch(() => []);
        const legacyRows = rows.filter(row => row.batchId === legacy.batchId || (!row.batchId && rows.length));
        datasets = [{
          id: legacy.batchId,
          batchId: legacy.batchId,
          createdAt: legacy.createdAt || Date.now(),
          count: legacy.count || legacyRows.length,
          players: legacy.players || [],
          allPlayers: legacy.allPlayers || [],
          fixedPairs: legacy.fixedPairs || [],
          numCourts: Number(legacy.numCourts) || Number(legacyRows[0] && legacyRows[0].numCourts) || 1,
          algorithm: legacy.algorithm || (legacyRows[0] && legacyRows[0].algorithm) || 'standard',
          gameType: legacy.gameType || 'doubles',
          randomOrder: legacy.randomOrder !== false
        }];
        await window.SCSOfflineDB.saveMeta('offlineDatasets', datasets);
      }
    }
    return datasets;
  }

  async function saveDatasets(datasets) {
    await window.SCSOfflineDB.saveMeta('offlineDatasets', Array.isArray(datasets) ? datasets : []);
  }

  function datasetLabel(data) {
    if (!data) return 'Offline Data';
    const type = data.gameType === 'mixed' ? 'Mixed Doubles' : 'Doubles';
    const players = Array.isArray(data.players) ? data.players.length : 0;
    const courts = Number(data.numCourts) || 1;
    return type + ' · ' + players + ' ' + (players === 1 ? 'Player' : 'Players') +
      ' · ' + courts + ' ' + (courts === 1 ? 'Court' : 'Courts');
  }

  function datasetDetail(data, readyCount) {
    if (!data) return 'No prepared rounds';
    const algorithm = data.algorithm === 'balanced' ? 'Balanced' : 'Standard';
    const randomText = data.randomOrder === false ? 'Random OFF' : 'Random ON';
    const rounds = Number(readyCount == null ? data.count : readyCount) || 0;
    return algorithm + ' · ' + randomText + ' · ' + rounds + ' ' + (rounds === 1 ? 'round' : 'rounds');
  }

  function playerRating(name, catalog) {
    const p=(catalog||[]).find(item=>item&&baseName(item.name)===baseName(name));
    const v=p&&!p.guest&&!p.unrated?Number(p.activeRating ?? p.clubRating ?? p.rating ?? 1):1;
    return Number.isFinite(v)?v:1;
  }

  function currentBalancedCounts() {
    const active = currentActivePlayers();
    const catalog = (typeof schedulerState !== 'undefined' && Array.isArray(schedulerState.allPlayers))
      ? schedulerState.allPlayers : [];
    let top = 0;
    active.forEach(function(name) {
      if (playerRating(name, catalog) >= 3.5) top++;
    });
    return { top: top, bottom: active.length - top };
  }

  function mapOfflinePlayers(template,currentState) {
    const oldPlayers=(template.players||[]).map(baseName);
    const newPlayers=currentActivePlayers();
    if (oldPlayers.length!==newPlayers.length) throw new Error('Current player count must match this Offline Data.');

    const oldAll=template.allPlayers||[], newAll=currentState.allPlayers||[];
    const balanced=template.algorithm==='balanced', mixed=template.gameType==='mixed';
    const mapping=new Map();
    const oldFixed=(template.fixedPairs||[]).filter(pair=>Array.isArray(pair)&&pair.length===2).map(pair=>pair.map(baseName));
    const activeSet=new Set(newPlayers.map(baseName));
    const newFixed=(currentState.fixedPairs||[]).filter(pair=>Array.isArray(pair)&&pair.length===2&&pair.every(name=>activeSet.has(baseName(name)))).map(pair=>pair.map(baseName));
    if (oldFixed.length!==newFixed.length) throw new Error('Current Fixed Pair count must match this Offline Data ('+oldFixed.length+').');

    function ordered(names,catalog){
      return balanced ? [...names].sort((a,b)=>playerRating(b,catalog)-playerRating(a,catalog)||names.indexOf(a)-names.indexOf(b)) : [...names];
    }
    function bind(a,b){
      if (a.length!==b.length) throw new Error('Current players do not match this Offline Data gender structure.');
      const aa=ordered(a,oldAll), bb=ordered(b,newAll);
      aa.forEach((name,i)=>mapping.set(baseName(name),baseName(bb[i])));
    }

    function pairRating(pair,catalog){ return playerRating(pair[0],catalog)+playerRating(pair[1],catalog); }
    function orientMixedPair(pair,catalog){
      const first=genderBucket((catalog.find(player=>player&&baseName(player.name)===pair[0])||{}).gender);
      const second=genderBucket((catalog.find(player=>player&&baseName(player.name)===pair[1])||{}).gender);
      if (first===second || !first || !second) throw new Error('Every Mixed Fixed Pair must contain one man and one woman.');
      return first==='male' ? [...pair] : [pair[1],pair[0]];
    }
    const orderedOldFixed=balanced?[...oldFixed].sort((a,b)=>pairRating(b,oldAll)-pairRating(a,oldAll)):oldFixed;
    const orderedNewFixed=balanced?[...newFixed].sort((a,b)=>pairRating(b,newAll)-pairRating(a,newAll)):newFixed;
    orderedOldFixed.forEach((pair,index)=>{
      let target=orderedNewFixed[index];
      if (mixed) { pair=orientMixedPair(pair,oldAll); target=orientMixedPair(target,newAll); }
      if (balanced && !mixed && playerRating(pair[0],oldAll)<playerRating(pair[1],oldAll)) pair=[pair[1],pair[0]];
      if (balanced && !mixed && playerRating(target[0],newAll)<playerRating(target[1],newAll)) target.reverse();
      mapping.set(pair[0],target[0]);
      mapping.set(pair[1],target[1]);
    });

    const usedOld=new Set(oldFixed.flat());
    const usedNew=new Set(newFixed.flat());
    const oldFree=oldPlayers.filter(name=>!usedOld.has(name));
    const newFree=newPlayers.filter(name=>!usedNew.has(name));

    if (!mixed) bind(oldFree,newFree);
    else {
      const oldMen=oldFree.filter(n=>genderBucket((oldAll.find(p=>p&&baseName(p.name)===n)||{}).gender)==='male');
      const oldWomen=oldFree.filter(n=>genderBucket((oldAll.find(p=>p&&baseName(p.name)===n)||{}).gender)==='female');
      const newMen=newFree.filter(n=>genderBucket((newAll.find(p=>p&&baseName(p.name)===n)||{}).gender)==='male');
      const newWomen=newFree.filter(n=>genderBucket((newAll.find(p=>p&&baseName(p.name)===n)||{}).gender)==='female');
      bind(oldMen,newMen); bind(oldWomen,newWomen);
    }
    return mapping;
  }

  function remapValue(value,mapping) {
    if (Array.isArray(value)) return value.map(v=>remapValue(v,mapping));
    if (value&&typeof value==='object') { const out={}; Object.keys(value).forEach(k=>out[k]=remapValue(value[k],mapping)); return out; }
    if (typeof value!=='string') return value;
    const m=value.match(/^(.*?)(#\d+)?$/), raw=baseName(m?m[1]:value), next=mapping.get(raw);
    return next ? next+((m&&m[2])||'') : value;
  }

  async function createTempDatasetFromSelected() {
    const template=await getSelectedDataset();
    if (!template) throw new Error('Please select Offline Data first.');
    const mapping=mapOfflinePlayers(template,schedulerState);
    const rows=await rowsForDataset(template,true);
    if (!rows.length) throw new Error('Selected Offline Data has no rounds.');

    await window.SCSOfflineDB.clearTempPreparedRounds();
    const tempBatch='temp-'+Date.now();
    for (const row of rows) {
      const mapped=remapValue(cloneValue(row),mapping);
      mapped.id=tempBatch+'-'+String(row.sequence||0).padStart(3,'0');
      mapped.batchId=tempBatch;
      mapped.sourceBatchId=String(template.batchId||template.id||'');
      mapped.used=false;
      delete mapped.usedAt;
      await window.SCSOfflineDB.saveTempPreparedRound(mapped);
    }

    const mappedPlayers=(template.players||[]).map(n=>mapping.get(baseName(n))||baseName(n));
    const tempMeta={...cloneValue(template),id:tempBatch,batchId:tempBatch,sourceBatchId:String(template.batchId||template.id||''),players:mappedPlayers,isTemp:true};
    tempMeta.allPlayers=mappedPlayers.map(name=>{
      const p=(schedulerState.allPlayers||[]).find(x=>x&&baseName(x.name)===name)||{};
      return {name,gender:p.gender||null,rating:p.rating==null?1:p.rating,activeRating:p.activeRating??null,clubRating:p.clubRating??null,guest:!!p.guest,unrated:!!p.unrated};
    });
    tempMeta.fixedPairs=(template.fixedPairs||[]).map(pair=>pair.map(name=>mapping.get(baseName(name))||baseName(name)));
    await window.SCSOfflineDB.saveMeta(TEMP_META_KEY,tempMeta);
    return tempMeta;
  }

  async function getTempDatasetMeta() {
    return window.SCSOfflineDB ? window.SCSOfflineDB.getMeta(TEMP_META_KEY).catch(()=>null) : null;
  }

  async function tempRows(includeUsed) {
    if (!window.SCSOfflineDB||typeof window.SCSOfflineDB.getTempPreparedRounds!=='function') return [];
    const rows=await window.SCSOfflineDB.getTempPreparedRounds();
    return rows.filter(r=>includeUsed||!r.used);
  }

  async function clearTempDataset() {
    if (!window.SCSOfflineDB) return;
    if (typeof window.SCSOfflineDB.clearTempPreparedRounds==='function') await window.SCSOfflineDB.clearTempPreparedRounds();
    await window.SCSOfflineDB.saveMeta(TEMP_META_KEY,null);
  }

  async function getSelectedDataset() {
    const datasets = await getDatasets();
    if (!datasets.length) return null;
    const lockedId = hasSessionInProgress() ? localStorage.getItem(SESSION_DATASET_KEY) : '';
    const selectedId = lockedId || localStorage.getItem(DATASET_KEY);
    let selected = datasets.find(data => String(data.id || data.batchId) === String(selectedId || ''));
    if (!selected) {
      selected = datasets[0];
      localStorage.setItem(DATASET_KEY, String(selected.id || selected.batchId));
    }
    return selected;
  }

  async function rowsForDataset(dataset, includeUsed) {
    if (!dataset || !window.SCSOfflineDB) return [];
    const id = String(dataset.batchId || dataset.id || '');
    const rows = await window.SCSOfflineDB.getPreparedRounds();
    return rows.filter(row => String(row.batchId || '') === id && (includeUsed || !row.used));
  }

  async function resetDatasetUsage(dataset) {
    if (!dataset || !window.SCSOfflineDB) return;
    const rows = await rowsForDataset(dataset, true);
    for (const row of rows) {
      row.used = false;
      delete row.usedAt;
      delete row.lastOfflineRank;
      delete row.lastOfflineScore;
      await window.SCSOfflineDB.savePreparedRound(row);
    }
  }

  async function deleteSelectedDataset() {
    if (hasSessionInProgress()) {
      alert('Offline Data cannot be deleted while rounds are in progress.');
      return;
    }
    if (!window.SCSOfflineDB) return;

    const selected = await getSelectedDataset();
    if (!selected) {
      alert('No Offline Data selected.');
      return;
    }

    const label = datasetLabel(selected);
    if (!confirm('Delete this prepared offline data?\n\n' + label)) return;

    try {
      const id = String(selected.id || selected.batchId || '');
      const batchId = String(selected.batchId || selected.id || '');

      if (typeof window.SCSOfflineDB.deletePreparedRoundsByBatch === 'function') {
        await window.SCSOfflineDB.deletePreparedRoundsByBatch(batchId);
      } else {
        const rows = await window.SCSOfflineDB.getPreparedRounds();
        await window.SCSOfflineDB.clearPreparedRounds();
        for (const row of rows) {
          if (String(row.batchId || '') !== batchId) {
            await window.SCSOfflineDB.savePreparedRound(row);
          }
        }
      }

      let datasets = await getDatasets();
      datasets = datasets.filter(data => String(data.id || data.batchId || '') !== id);
      await saveDatasets(datasets);

      const currentSelected = localStorage.getItem(DATASET_KEY);
      if (String(currentSelected || '') === id) {
        if (datasets.length) localStorage.setItem(DATASET_KEY, String(datasets[0].id || datasets[0].batchId));
        else localStorage.removeItem(DATASET_KEY);
      }

      if (datasets.length) await window.SCSOfflineDB.saveMeta('preparedBatch', datasets[0]);
      else await window.SCSOfflineDB.saveMeta('preparedBatch', null);

      await refreshStatus();

      if (typeof showToast === 'function') showToast('Prepared offline data deleted.');
    } catch (error) {
      alert('Could not delete Offline Data.\n' + (error && error.message ? error.message : error));
    }
  }

  async function selectDataset(id) {
    if (hasSessionInProgress()) return;
    const datasets = await getDatasets();
    if (!datasets.some(data => String(data.id || data.batchId) === String(id))) return;
    localStorage.setItem(DATASET_KEY, String(id));
    await refreshStatus();
    await refreshOfflineStartAvailability();
    refreshStartLabel();
  }

  function genderBucket(value) {
    const text = String(value || '').trim().toLowerCase();
    if (text === 'female' || text === 'f' || text === 'woman' || text === 'women') return 'female';
    if (text === 'male' || text === 'm' || text === 'man' || text === 'men') return 'male';
    return '';
  }

  function requestedPreparePlayerCount() {
    const input = document.getElementById('offlinePreparePlayers');
    const fallback = (typeof schedulerState !== 'undefined' && Array.isArray(schedulerState.activeplayers))
      ? schedulerState.activeplayers.length : 10;
    return Math.max(4, Math.min(100, Number(input && input.value) || fallback || 10));
  }

  function currentPreparePlayers() {
    return (typeof schedulerState !== 'undefined' && Array.isArray(schedulerState.activeplayers))
      ? schedulerState.activeplayers.map(baseName) : [];
  }

  function requestedPrepareGenderCounts() {
    const menEl = document.getElementById('offlinePrepareMen');
    const womenEl = document.getElementById('offlinePrepareWomen');
    return {
      men: Math.max(0, Math.min(60, Number(menEl && menEl.value) || 0)),
      women: Math.max(0, Math.min(60, Number(womenEl && womenEl.value) || 0))
    };
  }

  function clampLinkedCount(value, total) {
    const numeric = Number(value);
    return Math.max(0, Math.min(total, Number.isFinite(numeric) ? Math.round(numeric) : 0));
  }

  function syncLinkedPrepareCounts(changedId) {
    const total = requestedPreparePlayerCount();
    let primaryId = '';
    let secondaryId = '';
    if (changedId === 'offlinePrepareMen') { primaryId = 'offlinePrepareMen'; secondaryId = 'offlinePrepareWomen'; }
    else if (changedId === 'offlinePrepareWomen') { primaryId = 'offlinePrepareWomen'; secondaryId = 'offlinePrepareMen'; }
    else if (changedId === 'offlinePrepareTopRated') { primaryId = 'offlinePrepareTopRated'; secondaryId = 'offlinePrepareBottomRated'; }
    else if (changedId === 'offlinePrepareBottomRated') { primaryId = 'offlinePrepareBottomRated'; secondaryId = 'offlinePrepareTopRated'; }
    if (!primaryId) return;
    const primary = document.getElementById(primaryId);
    const secondary = document.getElementById(secondaryId);
    if (!primary || !secondary) return;
    const primaryValue = clampLinkedCount(primary.value, total);
    primary.value = String(primaryValue);
    secondary.value = String(total - primaryValue);
  }

  function syncLinkedCountsAfterPlayerChange() {
    if (getGameType() === 'mixed') syncLinkedPrepareCounts('offlinePrepareMen');
    if (getAlgorithm() === 'balanced') syncLinkedPrepareCounts('offlinePrepareTopRated');
  }

  function requestedBalancedCounts() {
    const players = requestedPreparePlayerCount();
    const topInput = document.getElementById('offlinePrepareTopRated');
    const bottomInput = document.getElementById('offlinePrepareBottomRated');
    const storedTop = Number(localStorage.getItem(TOP_RATED_COUNT_KEY));
    const storedBottom = Number(localStorage.getItem(BOTTOM_RATED_COUNT_KEY));
    const top = Math.max(0, Math.min(players, Number(topInput && topInput.value) || storedTop || Math.ceil(players / 2)));
    const bottom = Math.max(0, Math.min(players, Number(bottomInput && bottomInput.value) || storedBottom || (players - top)));
    return { top, bottom };
  }

  function persistBalancedCounts() {
    const counts = requestedBalancedCounts();
    localStorage.setItem(TOP_RATED_COUNT_KEY, String(counts.top));
    localStorage.setItem(BOTTOM_RATED_COUNT_KEY, String(counts.bottom));
    return counts;
  }

  function maxPrepareCourts() {
    const requestedCount = requestedPreparePlayerCount();
    if (getGameType() !== 'mixed') return Math.max(1, Math.floor(requestedCount / 4));
    const counts = requestedPrepareGenderCounts();
    return Math.max(0, Math.min(Math.floor(counts.men / 2), Math.floor(counts.women / 2), Math.floor(requestedCount / 4)));
  }

  function validatePrepareInputs(updateUi) {
    const total = requestedPreparePlayerCount();
    const courtsEl = document.getElementById('offlineCourtsCount');
    const courts = Math.max(1, Number(courtsEl && courtsEl.value) || 1);
    let message = '';
    if (total < courts * 4) message = 'Not enough players for ' + courts + ' court' + (courts === 1 ? '' : 's') + '.';
    if (!message && getGameType() === 'mixed') {
      const counts = requestedPrepareGenderCounts();
      if (counts.men + counts.women !== total) message = 'Men + Women must equal Total Players (' + total + ').';
      else if (counts.men < courts * 2 || counts.women < courts * 2) message = 'Mixed Doubles needs at least ' + (courts * 2) + ' men and ' + (courts * 2) + ' women for ' + courts + ' court' + (courts === 1 ? '' : 's') + '.';
    }
    if (!message && getAlgorithm() === 'balanced') {
      const counts = requestedBalancedCounts();
      if (counts.top + counts.bottom !== total) message = 'Top Rated + Bottom Rated must equal Total Players (' + total + ').';
    }
    if (updateUi) {
      const btn = document.getElementById('prepareOfflineRoundsBtn');
      const status = document.getElementById('offlineRoundsStatus');
      if (btn && !preparing) btn.disabled = !!message;
      if (status && message) status.textContent = message;
    }
    return { ok: !message, message: message };
  }

  function refreshPrepareCourtLimit() {
    const courts = document.getElementById('offlineCourtsCount');
    if (!courts) return;
    const fixedPairs = document.getElementById('offlinePrepareFixedPairs');
    if (fixedPairs) {
      const counts = requestedPrepareGenderCounts();
      const maxFixedPairs = getGameType() === 'mixed'
        ? Math.min(5, counts.men, counts.women)
        : Math.min(5, Math.floor(requestedPreparePlayerCount() / 2));
      [...fixedPairs.options].forEach(option => { option.disabled = Number(option.value) > maxFixedPairs; });
      if (Number(fixedPairs.value) > maxFixedPairs) setFixedPairCount(maxFixedPairs);
    }
    const maxCourts = maxPrepareCourts();
    [...courts.options].forEach(option => {
      const courtNo = Number(option.value);
      option.hidden = courtNo > maxCourts;
      option.disabled = courtNo > maxCourts;
    });
    if (maxCourts <= 0) {
      courts.value = '1';
      courts.disabled = true;
    } else {
      courts.disabled = false;
      const current = Math.max(1, Number(courts.value) || 1);
      courts.value = String(Math.min(current, maxCourts));
    }
    const courtValue = document.getElementById('offlineCourtsValue');
    const minus = document.getElementById('offlineCourtsMinus');
    const plus = document.getElementById('offlineCourtsPlus');
    const currentCourt = Math.max(1, Number(courts.value) || 1);
    if (courtValue) courtValue.textContent = String(currentCourt);
    if (minus) minus.disabled = maxCourts <= 0 || currentCourt <= 1;
    if (plus) plus.disabled = maxCourts <= 0 || currentCourt >= maxCourts;
    validatePrepareInputs(true);
  }

  function adjustPrepareCourts(delta) {
    const courts = document.getElementById('offlineCourtsCount');
    if (!courts || courts.disabled) return;
    const maxCourts = Math.max(1, maxPrepareCourts());
    const current = Math.max(1, Number(courts.value) || 1);
    const next = Math.max(1, Math.min(maxCourts, current + Number(delta || 0)));
    if (next === current) { refreshPrepareCourtLimit(); return; }
    courts.value = String(next);
    courts.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function templatePairKey(a, b) {
    const aa = baseName(a), bb = baseName(b);
    return aa < bb ? aa + '||' + bb : bb + '||' + aa;
  }

  function templateTargetPairs(state, gameType, fixedPairs) {
    const active = Array.isArray(state && state.activeplayers) ? state.activeplayers.map(baseName) : [];
    const fixed = Array.isArray(fixedPairs) ? fixedPairs.filter(pair => Array.isArray(pair) && pair.length === 2) : [];
    const fixedPlayers = new Set();
    const targets = new Set();
    fixed.forEach(function(pair) {
      const a = baseName(pair[0]), b = baseName(pair[1]);
      fixedPlayers.add(a); fixedPlayers.add(b);
      targets.add(templatePairKey(a, b));
    });
    const free = active.filter(name => !fixedPlayers.has(name));
    if (gameType === 'mixed') {
      const genderByName = new Map((state.allPlayers || []).map(player => [baseName(player && player.name), String(player && player.gender || '').toLowerCase()]));
      for (let i = 0; i < free.length; i++) {
        for (let j = i + 1; j < free.length; j++) {
          const ga = genderByName.get(free[i]) || '';
          const gb = genderByName.get(free[j]) || '';
          if ((ga.startsWith('m') && gb.startsWith('f')) || (ga.startsWith('f') && gb.startsWith('m'))) {
            targets.add(templatePairKey(free[i], free[j]));
          }
        }
      }
    } else {
      for (let i = 0; i < free.length; i++) {
        for (let j = i + 1; j < free.length; j++) targets.add(templatePairKey(free[i], free[j]));
      }
    }
    return targets;
  }

  function addRoundPairsToSet(round, set) {
    ((round && round.games) || []).forEach(function(game) {
      [game.pair1, game.pair2].forEach(function(pair) {
        if (Array.isArray(pair) && pair.length === 2) set.add(templatePairKey(pair[0], pair[1]));
      });
    });
  }

  function templateCycleLengthFromPayload(payload) {
    const dataset = payload && payload.dataset;
    const records = payload && Array.isArray(payload.records) ? payload.records : [];
    const cycleLength = Math.max(0, Number(dataset && dataset.cycleLength) || Number(dataset && dataset.count) || 0);
    return cycleLength > 0 ? Math.min(cycleLength, records.length) : records.length;
  }

  function templatePayloadRecords(payload) {
    const records = payload && Array.isArray(payload.records) ? payload.records : [];
    return records.slice(0, templateCycleLengthFromPayload(payload));
  }

  function offlineLibrarySpec(roundCount, courtCount) {
    const playerCount = requestedPreparePlayerCount();
    const gameType = getGameType();
    const courts = Math.max(1, Math.min(20, Number(courtCount) || 1));
    // Rounds Templates use the same supported player/court envelope as Round Manager.
    // Do not artificially restrict template creation to 2 courts: the selected
    // court count is part of the stored template specification/file key.
    if ((gameType !== 'doubles' && gameType !== 'mixed') || playerCount < 4 || playerCount > 100 || playerCount < courts * 4) return null;
    const algorithm = getAlgorithm();
    const genderCounts = requestedPrepareGenderCounts();
    const balancedCounts = requestedBalancedCounts();
    if (gameType === 'mixed' && (genderCounts.men + genderCounts.women !== playerCount || genderCounts.men < courts * 2 || genderCounts.women < courts * 2)) return null;
    if (algorithm === 'balanced' && balancedCounts.top + balancedCounts.bottom !== playerCount) return null;
    return {
      playerCount: playerCount,
      courtCount: courts,
      // Keep the deployed Worker contract unchanged. Rounds Templates always
      // use the shared 25-round library bucket; the actual unique cycle length
      // is stored inside payload.dataset.cycleLength and used locally.
      roundCount: templatePickerMode ? 25 : Math.max(1, Math.min(100, Number(roundCount) || 30)),
      gameType: gameType,
      algorithm: algorithm,
      randomOrder: getRandomOrder(),
      uniquePairMode: algorithm === 'standard' && getOfflineUniquePairMode(),
      fixedPairCount: requestedFixedPairCount(),
      menCount: gameType === 'mixed' ? genderCounts.men : 0,
      womenCount: gameType === 'mixed' ? genderCounts.women : 0,
      topRatedCount: algorithm === 'balanced' ? balancedCounts.top : 0,
      bottomRatedCount: algorithm === 'balanced' ? balancedCounts.bottom : 0
    };
  }

  function detectedOfflineRequirements() {
    const active = currentActivePlayers();
    const format = (typeof orgGetRoundFormat === 'function') ? orgGetRoundFormat() : 'doubles';
    const algorithm = (typeof getGameGenerationMode === 'function') ? getGameGenerationMode() : getAlgorithm();
    const randomOrder = (typeof orgGetInitialPlayerOrder === 'function')
      ? orgGetInitialPlayerOrder() === 'random' : getRandomOrder();
    const uniquePairMode = algorithm !== 'balanced' &&
      ((typeof getUniquePairMode === 'function') ? getUniquePairMode() : true);
    const activeNames = new Set(active.map(baseName));
    const fixedPairCount = Array.isArray(typeof schedulerState !== 'undefined' && schedulerState.fixedPairs)
      ? schedulerState.fixedPairs.filter(pair => Array.isArray(pair) && pair.length === 2 && pair.every(name => activeNames.has(baseName(name)))).length
      : 0;
    const genderCounts = currentGenderCounts();
    return {
      players: active.length,
      courts: getCourtCount(),
      format: format,
      algorithm: algorithm === 'balanced' ? 'balanced' : 'standard',
      randomOrder: randomOrder,
      uniquePairMode: uniquePairMode,
      fixedPairCount: Math.min(5, fixedPairCount),
      menCount: genderCounts.men,
      womenCount: genderCounts.women,
      topRatedCount: algorithm === 'balanced' ? currentBalancedCounts().top : 0,
      bottomRatedCount: algorithm === 'balanced' ? currentBalancedCounts().bottom : 0
    };
  }

  function setRequirementText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  async function refreshAutoRequirements() {
    const requirements = detectedOfflineRequirements();
    const playersInput = document.getElementById('offlinePreparePlayers');
    const courtsInput = document.getElementById('offlineCourtsCount');
    const roundsInput = document.getElementById('offlineRoundsCount');
    if (playersInput && requirements.players > 0) playersInput.value = String(requirements.players);
    localStorage.setItem(GAME_TYPE_KEY, 'doubles');
    localStorage.setItem(ALG_KEY, requirements.algorithm);
    localStorage.setItem(RANDOM_KEY, requirements.randomOrder ? '1' : '0');
    localStorage.setItem(UNIQUE_KEY, requirements.uniquePairMode ? '1' : '0');
    localStorage.setItem(FIXED_PAIR_COUNT_KEY, String(requirements.fixedPairCount));
    const menInput = document.getElementById('offlinePrepareMen');
    const womenInput = document.getElementById('offlinePrepareWomen');
    if (menInput && requirements.menCount) menInput.value = String(requirements.menCount);
    if (womenInput && requirements.womenCount) womenInput.value = String(requirements.womenCount);
    const topInput = document.getElementById('offlinePrepareTopRated');
    const bottomInput = document.getElementById('offlinePrepareBottomRated');
    if (topInput && requirements.topRatedCount) topInput.value = String(requirements.topRatedCount);
    if (bottomInput && requirements.bottomRatedCount) bottomInput.value = String(requirements.bottomRatedCount);
    persistBalancedCounts();
    refreshPrepareCourtLimit();
    if (courtsInput && [...courtsInput.options].some(option => Number(option.value) === requirements.courts && !option.disabled)) {
      courtsInput.value = String(requirements.courts);
    }
    if (roundsInput) roundsInput.value = '30';
    const fixedInput = document.getElementById('offlinePrepareFixedPairs');
    if (fixedInput) fixedInput.value = String(requirements.fixedPairCount);
    refreshControls();

    await refreshLibraryMatchFromControls();
  }

  async function refreshLibraryMatchFromControls() {
    ensureExistingTemplateActions(false);
    const requestId = ++libraryMatchRequestId;
    // Keep the async result tied to the page that requested it. Switching
    // quickly between Create and Edit must not restore the previous page's
    // labels or destructive actions after its library request completes.
    const pickerAction = templatePickerAction;
    const requirements = {
      players: requestedPreparePlayerCount(),
      courts: Math.max(1, Number(document.getElementById('offlineCourtsCount')?.value) || 1),
      format: getGameType(),
      algorithm: getAlgorithm(),
      randomOrder: getRandomOrder(),
      uniquePairMode: getAlgorithm() === 'standard' && getOfflineUniquePairMode(),
      fixedPairCount: requestedFixedPairCount()
    };
    const balancedCounts = requestedBalancedCounts();
    requirements.topRatedCount = requirements.algorithm === 'balanced' ? balancedCounts.top : 0;
    requirements.bottomRatedCount = requirements.algorithm === 'balanced' ? balancedCounts.bottom : 0;

    setRequirementText('offlineRequirementPlayers', requirements.players ? String(requirements.players) : 'None');
    setRequirementText('offlineRequirementCourts', String(requirements.courts));
    setRequirementText('offlineRequirementFormat', requirements.format === 'doubles' ? 'Doubles' : requirements.format);
    setRequirementText('offlineRequirementAlgorithm', requirements.algorithm === 'balanced' ? 'Balanced' : 'Standard');
    setRequirementText('offlineRequirementOrder', requirements.randomOrder ? 'Random ON' : 'Keep List Order');
    setRequirementText('offlineRequirementUnique', requirements.uniquePairMode ? 'ON' : 'OFF');
    setRequirementText('offlineRequirementFixedPairs', String(requirements.fixedPairCount));
    setRequirementText('offlineRequirementTop', String(requirements.topRatedCount));
    setRequirementText('offlineRequirementBottom', String(requirements.bottomRatedCount));

    const badge = document.getElementById('offlineRequirementBadge');
    const message = document.getElementById('offlineRequirementMessage');
    const button = document.getElementById('prepareOfflineRoundsBtn');
    if (badge) badge.className = 'offline-requirement-badge';

    let blocked = '';
    if (requirements.players < 4) blocked = 'Add players to Round Manager first.';
    else if (requirements.format !== 'doubles' && requirements.format !== 'mixed') blocked = 'Select Doubles or Mixed Doubles.';
    else if (requirements.players < requirements.courts * 4) blocked = 'Not enough players for ' + requirements.courts + ' courts.';
    else if (requirements.fixedPairCount * 2 > requirements.players) blocked = 'Too many fixed pairs for ' + requirements.players + ' players.';
    else if (requirements.algorithm === 'balanced' && requirements.topRatedCount + requirements.bottomRatedCount !== requirements.players) blocked = 'Top Rated + Bottom Rated must equal ' + requirements.players + ' players.';
    else if (requirements.format === 'mixed') {
      const counts = requestedPrepareGenderCounts();
      if (counts.men + counts.women !== requirements.players) blocked = 'Men + Women must equal ' + requirements.players + ' players.';
      else if (counts.men < requirements.courts * 2 || counts.women < requirements.courts * 2) blocked = 'Mixed Doubles needs at least ' + (requirements.courts * 2) + ' men and women.';
      else if (requirements.fixedPairCount > Math.min(counts.men, counts.women)) blocked = 'Too many mixed fixed pairs for this gender split.';
    }
    if (blocked) {
      if (badge) { badge.textContent = 'Action needed'; badge.classList.add('is-blocked'); }
      if (message) message.textContent = blocked;
      if (button) { button.disabled = true; button.textContent = 'Requirements not ready'; }
      return;
    }

    const roundsInput = document.getElementById('offlineRoundsCount');
    const roundCount = Math.max(1, Number(roundsInput && roundsInput.value) || 30);
    const spec = offlineLibrarySpec(roundCount, requirements.courts);
    if (templatePickerMode && !spec) {
      if (badge) { badge.textContent = 'Not available'; badge.classList.add('is-blocked'); }
      if (message) message.textContent = 'This setup is not valid for the selected number of players and courts.';
      if (button) { button.disabled = true; button.textContent = 'No Template'; }
      return;
    }
    if (!spec) {
      if (badge) { badge.textContent = 'Generate locally'; badge.classList.add('is-generate'); }
      if (message) message.textContent = 'No shared template matches this setup yet. Create it once using the same Round Manager generator.';
      if (button) { button.disabled = false; button.textContent = templatePickerMode ? 'Generate Unique Pair Cycle' : ('Generate ' + roundCount + ' Offline Rounds'); }
      return;
    }

    if (badge) badge.textContent = 'Checking library';
    if (message) message.textContent = 'Looking for an exact shared-library match…';
    if (button) button.disabled = true;
    const payload = await fetchOfflineLibrary(spec);
    if (requestId !== libraryMatchRequestId) return;
    if (payload) {
      if (badge) { badge.textContent = templatePickerMode ? 'Template found' : 'Library ready'; badge.classList.add('is-found'); }
      if (message) message.textContent = templatePickerMode
        ? (pickerAction === 'create'
            ? 'A template already exists for this setup. Open it to edit instead of creating a duplicate.'
            : 'Exact template found. Open it in the Round page to review and fine-tune every round.')
        : 'Exact match found. The rounds will be downloaded and saved on this device.';
      if (button) {
        button.disabled = false;
        button.textContent = templatePickerMode ? (pickerAction === 'create' ? 'Edit Existing Template' : 'Edit Template') : ('Download & Use ' + roundCount + ' Rounds');
        button.dataset.templateAction = templatePickerMode ? 'edit' : '';
      }
      ensureExistingTemplateActions(templatePickerMode ? pickerAction : false);
    } else {
      ensureExistingTemplateActions(false);
      if (templatePickerMode) {
        if (badge) { badge.textContent = 'Not found'; badge.classList.add('is-blocked'); }
        if (message) message.textContent = pickerAction === 'edit'
          ? 'No stored template matches this exact setup.'
          : 'No template exists for this setup. You can create it now.';
        if (button) {
          button.dataset.templateAction = 'create';
          button.disabled = pickerAction === 'edit';
          button.textContent = pickerAction === 'edit' ? 'No Template Available' : '＋ Create Template';
        }
        if (pickerAction === 'edit') ensureExistingTemplateActions('edit-missing');
      } else {
        if (badge) { badge.textContent = 'Generate once'; badge.classList.add('is-generate'); }
        if (message) message.textContent = 'No exact match yet. Generate once and the anonymous template will be saved for future use.';
        if (button) { button.disabled = false; button.textContent = templatePickerMode ? 'Generate & Save Unique Pair Cycle' : ('Generate & Save ' + roundCount + ' Rounds'); }
      }
    }
  }

  function ensureExistingTemplateActions(action) {
    const primary = document.getElementById('prepareOfflineRoundsBtn');
    if (!primary) return;
    let wrap = document.getElementById('existingTemplateActions');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'existingTemplateActions';
      wrap.className = 'offline-template-actions';
      wrap.innerHTML = '<button id="overwriteExistingTemplateBtn" type="button" class="offline-template-secondary">Overwrite Existing Template</button>' +
        '<button id="deleteExistingTemplateBtn" type="button" class="offline-template-danger">Delete Template</button>';
      primary.insertAdjacentElement('afterend', wrap);
      document.getElementById('overwriteExistingTemplateBtn').addEventListener('click', overwriteExistingTemplate);
      document.getElementById('deleteExistingTemplateBtn').addEventListener('click', deleteExistingTemplate);
    }
    const overwrite = document.getElementById('overwriteExistingTemplateBtn');
    const remove = document.getElementById('deleteExistingTemplateBtn');
    const show = action === 'create' || action === 'edit' || action === 'edit-missing';
    wrap.hidden = !show;
    if (overwrite) overwrite.hidden = action !== 'create';
    if (remove) {
      remove.hidden = !show;
      remove.disabled = action === 'edit-missing';
      remove.textContent = action === 'edit-missing' ? 'No Template to Delete' : 'Delete Template';
    }
  }

  async function overwriteExistingTemplate() {
    const rounds = document.getElementById('offlineRoundsCount');
    const courts = document.getElementById('offlineCourtsCount');
    const spec = offlineLibrarySpec(Math.max(1, Number(rounds && rounds.value) || 25), Math.max(1, Number(courts && courts.value) || 1));
    if (!spec) return;
    if (!confirm('Overwrite this exact Rounds Template?\n\nThe existing rounds will be replaced.')) return;
    // prepare() uses the proven Round generator and storeOfflineLibrary() upserts
    // the same exact signature, so only this template is replaced.
    await prepare(25, spec.courtCount);
    await syncFullOfflineLibrary().catch(() => false);
    await refreshLibraryMatchFromControls();
  }

  async function deleteOfflineLibrary(spec) {
    if (!spec || !navigator.onLine || typeof WORKER_URL === 'undefined') return false;
    const response = await fetch(WORKER_URL + '/offline-library/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({}, offlineLibraryIdentity(), { spec: spec }))
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    if (!data || data.deleted !== true || !data.signature) return false;
    return data;
  }

  async function removeCachedOfflineLibrary(signature) {
    if (!signature || !window.SCSOfflineDB) return;
    const datasets = await getDatasets();
    const removed = datasets.filter(function(dataset) {
      return dataset && dataset.libraryManaged === true && dataset.librarySignature === signature;
    });
    if (!removed.length) return;
    await saveDatasets(datasets.filter(function(dataset) {
      return !dataset || dataset.libraryManaged !== true || dataset.librarySignature !== signature;
    }));
    for (const dataset of removed) {
      const batchId = String(dataset.batchId || dataset.id || '');
      if (batchId) await window.SCSOfflineDB.deletePreparedRoundsByBatch(batchId).catch(() => 0);
      if (localStorage.getItem(DATASET_KEY) === String(dataset.id || dataset.batchId || '')) {
        localStorage.removeItem(DATASET_KEY);
      }
    }
    // Force the next sync to compare against the server after this deletion.
    await window.SCSOfflineDB.saveMeta('offlineLibraryVersionToken', '').catch(() => false);
  }

  async function deleteExistingTemplate() {
    const rounds = document.getElementById('offlineRoundsCount');
    const courts = document.getElementById('offlineCourtsCount');
    const spec = offlineLibrarySpec(Math.max(1, Number(rounds && rounds.value) || 25), Math.max(1, Number(courts && courts.value) || 1));
    if (!spec) return;
    if (!confirm('Delete this exact Rounds Template?\n\nThis cannot be undone.')) return;
    const removeButton = document.getElementById('deleteExistingTemplateBtn');
    if (removeButton) { removeButton.disabled = true; removeButton.textContent = 'Deleting…'; }
    try {
      const result = await deleteOfflineLibrary(spec);
      if (!result) throw new Error('The server did not confirm the deletion.');
      await removeCachedOfflineLibrary(result.signature);
      await syncFullOfflineLibrary().catch(() => false);
      ensureExistingTemplateActions(false);
      await refreshLibraryMatchFromControls();
      if (typeof showToast === 'function') showToast('Rounds Template deleted.');
    } catch (error) {
      alert('Could not delete Rounds Template.\n' + (error && error.message ? error.message : error));
      await refreshLibraryMatchFromControls().catch(() => false);
    }
  }

  function offlineLibraryIdentity() {
    const user = (typeof authGetUser === 'function') ? authGetUser() : null;
    const accountId = String((user && user.id) || localStorage.getItem('scs_sub_account_id') || '').trim();
    const sessionToken = (typeof _getLocalToken === 'function') ? String(_getLocalToken() || '') : String(localStorage.getItem('scs_session_token') || '');
    return { accountId: accountId, userAccountId: accountId, sessionToken: sessionToken };
  }

  function libraryBatchId(signature) {
    let hash = 2166136261;
    const text = String(signature || '');
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return 'offline-library-managed-' + (hash >>> 0).toString(16).padStart(8, '0');
  }

  let fullLibrarySyncPromise = null;
  const FULL_LIBRARY_METADATA_VERSION = 'balanced-bands-v1';
  async function syncFullOfflineLibrary() {
    if (!navigator.onLine || !window.SCSOfflineDB || typeof WORKER_URL === 'undefined') return false;
    const identity = offlineLibraryIdentity();
    if (!identity.accountId || !identity.sessionToken) return false;
    if (fullLibrarySyncPromise) return fullLibrarySyncPromise;

    fullLibrarySyncPromise = (async function() {
      const storedVersion = String(await window.SCSOfflineDB.getMeta('offlineLibraryVersionToken').catch(() => '') || '');
      const metadataVersion = String(await window.SCSOfflineDB.getMeta('offlineLibraryMetadataVersion').catch(() => '') || '');
      const localVersion = metadataVersion === FULL_LIBRARY_METADATA_VERSION ? storedVersion : '';
      let manifestResponse;
      try {
        manifestResponse = await fetchWithin(WORKER_URL + '/offline-library/manifest', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(identity)
        }, 5000);
      } catch (error) {
        console.warn('Template manifest unavailable:', error);
        return false;
      }
      if (!manifestResponse.ok) return false;
      const manifest = await manifestResponse.json().catch(() => null);
      if (!manifest || !manifest.versionToken) return false;
      if (localVersion && localVersion === String(manifest.versionToken)) return true;

      const response = await fetchWithin(WORKER_URL + '/offline-library/all', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({}, identity, { versionToken: localVersion || null }))
      }, 8000);
      if (!response.ok) throw new Error('Template library download failed: HTTP ' + response.status);
      const data = await response.json();
      if (data && data.unchanged) {
        await window.SCSOfflineDB.saveMeta('offlineLibraryVersionToken', data.versionToken || manifest.versionToken);
        return true;
      }
      const libraries = data && Array.isArray(data.libraries) ? data.libraries : [];
      const existingDatasets = await getDatasets();
      const managed = existingDatasets.filter(data => data && data.libraryManaged === true);
      const preserved = existingDatasets.filter(data => !data || data.libraryManaged !== true);

      // Write the new encrypted library first. Existing managed data remains usable
      // until the replacement is complete, so an interrupted download cannot empty iMode.
      const newDatasets = [];
      for (const library of libraries) {
        if (!library || !library.signature || !library.spec || !library.payload || !library.payload.dataset) continue;
        const spec = library.spec;
        const payload = library.payload;
        const installRecords = payload.dataset.isUniqueCycleTemplate ? templatePayloadRecords(payload) : (payload.records || []);
        const batchId = libraryBatchId(library.signature);
        const createdAt = Date.now();
        await window.SCSOfflineDB.deletePreparedRoundsByBatch(batchId).catch(() => 0);
        for (let index = 0; index < installRecords.length; index++) {
          const source = cloneValue(installRecords[index]);
          source.id = batchId + '-' + String(index + 1).padStart(3, '0');
          source.batchId = batchId;
          source.sequence = index + 1;
          source.createdAt = createdAt;
          source.used = false;
          delete source.usedAt;
          await window.SCSOfflineDB.savePreparedRound(source); // AES-GCM encrypted at rest
        }
        newDatasets.push(Object.assign({}, cloneValue(payload.dataset), {
          id: batchId, batchId: batchId, count: installRecords.length,
          cycleLength: Number(payload.dataset.cycleLength) || installRecords.length,
          isUniqueCycleTemplate: !!payload.dataset.isUniqueCycleTemplate,
          createdAt: createdAt, numCourts: spec.courtCount, gameType: spec.gameType,
          algorithm: spec.algorithm, randomOrder: spec.randomOrder,
          uniquePairMode: !!spec.uniquePairMode, fixedPairs: cloneValue(payload.dataset.fixedPairs || []),
          topRatedCount: Number(spec.topRatedCount) || 0,
          bottomRatedCount: Number(spec.bottomRatedCount) || 0,
          libraryManaged: true, librarySignature: library.signature, libraryUpdatedAt: library.updatedAt || null
        }));
      }

      await saveDatasets(newDatasets.concat(preserved));
      for (const old of managed) {
        const oldBatch = String(old.batchId || old.id || '');
        if (oldBatch && !newDatasets.some(item => String(item.batchId) === oldBatch)) {
          await window.SCSOfflineDB.deletePreparedRoundsByBatch(oldBatch).catch(() => 0);
        }
      }
      const versionToken = String((data && data.versionToken) || manifest.versionToken || '');
      await window.SCSOfflineDB.saveMeta('offlineLibraryVersionToken', versionToken);
      await window.SCSOfflineDB.saveMeta('offlineLibraryMetadataVersion', FULL_LIBRARY_METADATA_VERSION);
      await window.SCSOfflineDB.saveMeta('offlineLibraryDownloadedAt', Date.now());
      await window.SCSOfflineDB.saveMeta('offlineLibraryTemplateCount', newDatasets.length);
      if (newDatasets.length && !localStorage.getItem(DATASET_KEY)) localStorage.setItem(DATASET_KEY, String(newDatasets[0].id));
      return true;
    })().catch(function(error) {
      console.warn('Full template library sync unavailable:', error);
      return false;
    }).finally(function() { fullLibrarySyncPromise = null; });
    return fullLibrarySyncPromise;
  }

  async function fetchOfflineLibrary(spec) {
    if (!spec || !navigator.onLine || typeof WORKER_URL === 'undefined') return null;
    try {
      const response = await fetch(WORKER_URL + '/offline-library/get', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({}, offlineLibraryIdentity(), { spec: spec }))
      });
      if (!response.ok) {
        console.warn('Offline library lookup failed: HTTP ' + response.status);
        return null;
      }
      const data = await response.json();
      return data && data.found && data.payload ? data.payload : null;
    } catch (error) {
      console.warn('Offline library lookup unavailable:', error);
      return null;
    }
  }

  async function storeOfflineLibrary(spec, dataset, records) {
    if (!spec || !navigator.onLine || typeof WORKER_URL === 'undefined') return false;
    const payload = {
      dataset: {
        count: dataset.count,
        cycleLength: Number(dataset.cycleLength) || 0,
        isUniqueCycleTemplate: !!dataset.isUniqueCycleTemplate,
        players: cloneValue(dataset.players),
        allPlayers: cloneValue(dataset.allPlayers),
        numCourts: dataset.numCourts,
        algorithm: dataset.algorithm,
        gameType: dataset.gameType,
        randomOrder: dataset.randomOrder,
        fixedPairs: cloneValue(dataset.fixedPairs || [])
      },
      records: (function() {
        const sourceRecords = records.map(function(record) {
          return {
            sequence: record.sequence,
            playerPool: cloneValue(record.playerPool),
            numCourts: record.numCourts,
            courtTypes: cloneValue(record.courtTypes),
            courtFormats: cloneValue(record.courtFormats),
            algorithm: record.algorithm,
            gameType: record.gameType,
            randomOrder: record.randomOrder,
            round: cloneValue(record.round)
          };
        });
        if (!dataset.isUniqueCycleTemplate || spec.roundCount !== 25 || !sourceRecords.length) return sourceRecords;
        // The current Worker requires records.length === roundCount. Keep only
        // the real cycle logically, but repeat it inside the 25-row transport
        // bucket so no Worker change is needed. Retrieval trims back to
        // dataset.cycleLength before installing/playing the template.
        return Array.from({ length: 25 }, function(_, index) {
          const item = cloneValue(sourceRecords[index % sourceRecords.length]);
          item.sequence = index + 1;
          return item;
        });
      })()
    };
    try {
      const response = await fetch(WORKER_URL + '/offline-library/put', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({}, offlineLibraryIdentity(), { spec: spec, payload: payload }))
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return true;
    } catch (error) {
      // Library storage is an optimization only. Local preparation remains valid.
      console.warn('Offline library storage unavailable:', error);
      return false;
    }
  }

  async function installOfflineLibrary(payload, spec, status, skipRefresh) {
    if (!payload || !Array.isArray(payload.records) || !payload.dataset) return false;
    const batchId = 'offline-library-' + Date.now();
    const createdAt = Date.now();
    const installRecords = payload.dataset && payload.dataset.isUniqueCycleTemplate ? templatePayloadRecords(payload) : payload.records;
    for (let index = 0; index < installRecords.length; index++) {
      const source = cloneValue(installRecords[index]);
      source.id = batchId + '-' + String(index + 1).padStart(3, '0');
      source.batchId = batchId;
      source.sequence = index + 1;
      source.createdAt = createdAt;
      source.used = false;
      delete source.usedAt;
      await window.SCSOfflineDB.savePreparedRound(source);
    }
    const dataset = Object.assign({}, cloneValue(payload.dataset), {
      id: batchId,
      batchId: batchId,
      count: installRecords.length,
      cycleLength: Number(payload.dataset && payload.dataset.cycleLength) || installRecords.length,
      isUniqueCycleTemplate: !!(payload.dataset && payload.dataset.isUniqueCycleTemplate),
      createdAt: createdAt,
      numCourts: spec.courtCount,
      gameType: spec.gameType,
      algorithm: spec.algorithm,
      randomOrder: spec.randomOrder,
      uniquePairMode: !!spec.uniquePairMode,
      topRatedCount: Number(spec.topRatedCount) || 0,
      bottomRatedCount: Number(spec.bottomRatedCount) || 0,
      fixedPairs: cloneValue(payload.dataset.fixedPairs || [])
    });
    const datasets = await getDatasets();
    datasets.unshift(dataset);
    await saveDatasets(datasets);
    await window.SCSOfflineDB.saveMeta('preparedBatch', dataset);
    localStorage.setItem(DATASET_KEY, batchId);
    if (status) status.textContent = installRecords.length + (dataset.isUniqueCycleTemplate ? ' round unique-pair cycle loaded' : ' rounds loaded from library');
    closePrepare();
    if (!skipRefresh) await refreshStatus();
    return dataset;
  }

  function togglePreparedDetails(button) {
    const details = document.getElementById('offlinePreparedDetails');
    const trigger = button || document.getElementById('offlinePreparedSummary');
    if (!details || !trigger) return;

    // During a running Offline session, Prepared Data is view-only and locked.
    if (hasSessionInProgress()) {
      details.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      return;
    }

    const willOpen = details.hidden;
    details.hidden = !willOpen;
    trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  }

  function setPreparedDetailsLocked(locked) {
    const details = document.getElementById('offlinePreparedDetails');
    const trigger = document.getElementById('offlinePreparedSummary');
    const select = document.getElementById('offlineDatasetSelect');
    const prepare = document.getElementById('openPrepareOfflineBtn');
    const deleteBtn = document.getElementById('deleteOfflineDatasetBtn');

    if (trigger) trigger.classList.toggle('is-locked', !!locked);
    if (details) {
      details.classList.toggle('is-locked', !!locked);
      if (locked) {
        details.hidden = false;
        if (trigger) trigger.setAttribute('aria-expanded', 'true');
      }
    }
    if (select) select.disabled = !!locked || !select.options.length;
    if (prepare) prepare.disabled = !!locked;
    if (deleteBtn) deleteBtn.disabled = !!locked || !localStorage.getItem(DATASET_KEY);
  }

  async function refreshStatus() {
    const status = document.getElementById('offlineRoundsStatus');
    const useStatus = document.getElementById('offlineUseStatus');
    const select = document.getElementById('offlineDatasetSelect');
    if (!window.SCSOfflineDB) return;

    // Recovery UI must not wait for any template-library read. The active
    // scheduler snapshot / Temp DB is already the source of truth for a running
    // session, so show Continue immediately after a cold PWA restart.
    if (hasSessionInProgress()) {
      // Restore live roster/settings before painting the Continue card so the
      // Add Players badge, Fixed Pairs badge and court selector immediately
      // reflect the recovered session after a cold PWA restart.
      if (!isTemplateSessionActive()) restoreLiveIModeContext();
      if (status) status.textContent = 'Round iMode session in progress';
      if (useStatus) useStatus.textContent = isTemplateSessionActive() ? 'Prepared session ready' : 'Live session ready';
      if (select) select.disabled = true;
      const openPrepare = document.getElementById('openPrepareOfflineBtn');
      if (openPrepare) openPrepare.disabled = true;
      const deleteBtn = document.getElementById('deleteOfflineDatasetBtn');
      if (deleteBtn) deleteBtn.disabled = true;
      setPreparedDetailsLocked(true);
      await refreshOfflineStartAvailability();
      refreshStartLabel();
      return;
    }

    try {
      const datasets = await getDatasets();
      const selected = (hasSessionInProgress() && !isTemplateSessionActive())
        ? null
        : await getSelectedDataset();

      if (select) {
        const currentValue = selected ? String(selected.id || selected.batchId) : '';
        select.innerHTML = datasets.length
          ? datasets.map(data => {
              const id = String(data.id || data.batchId);
              return '<option value="' + id.replace(/"/g,'&quot;') + '">' + datasetLabel(data) + '</option>';
            }).join('')
          : '<option value="">No offline data</option>';
        select.value = currentValue;
        select.disabled = hasSessionInProgress() || !datasets.length;
      }

      const openPrepare = document.getElementById('openPrepareOfflineBtn');
      if (openPrepare) openPrepare.disabled = hasSessionInProgress();

      const deleteBtn = document.getElementById('deleteOfflineDatasetBtn');
      if (deleteBtn) deleteBtn.disabled = hasSessionInProgress() || !selected;

      let total = 0, unused = 0;
      if (hasSessionInProgress() && isTemplateSessionActive()) {
        const rows = await tempRows(true);
        total = rows.length;
        unused = rows.filter(row => !row.used).length;
      } else if (selected) {
        const rows = await rowsForDataset(selected, true);
        total = rows.length;
        unused = rows.filter(row => !row.used).length;
      }

      const text = selected
        ? (hasSessionInProgress() ? (unused + ' of ' + total + ' rounds remaining') : (total + ' rounds ready'))
        : 'No offline data prepared';
      const detailText = selected
        ? (hasSessionInProgress()
            ? datasetDetail(selected, total) + ' · ' + unused + ' remaining'
            : datasetDetail(selected, total))
        : 'Prepare data before starting';

      if (status) status.textContent = text;
      if (useStatus) useStatus.textContent = detailText;

      const summaryText = document.getElementById('offlinePreparedSummaryText');
      if (summaryText) {
        summaryText.textContent = selected
          ? (datasetLabel(selected) + ' · ' + (selected.algorithm === 'balanced' ? 'Balanced' : 'Standard') +
             ' · ' + (selected.randomOrder === false ? 'Random OFF' : 'Random ON') + ' · ' + total + ' rounds')
          : 'No offline data prepared';
      }

      setPreparedDetailsLocked(hasSessionInProgress());
      updateOfflineUseUi(total, unused);
      await refreshOfflineStartAvailability();
      refreshStartLabel();
    } catch (error) {
      if (status) status.textContent = 'Offline store unavailable';
      if (useStatus) useStatus.textContent = 'Offline store unavailable';
      const summaryText = document.getElementById('offlinePreparedSummaryText');
      if (summaryText) summaryText.textContent = 'Offline store unavailable';
      setPreparedDetailsLocked(hasSessionInProgress());
      updateOfflineUseUi(0, 0);
    }
  }

  function resetTemplateGenerationUi() {
    const progress = document.getElementById('offlineRoundsProgress');
    const result = document.getElementById('offlineRoundsResult');
    const bar = document.getElementById('offlineRoundsProgressBar');
    const count = document.getElementById('offlineRoundsProgressCount');
    const detail = document.getElementById('offlineRoundsProgressDetail');
    const title = document.getElementById('offlineRoundsProgressTitle');
    if (progress) progress.hidden = true;
    if (result) { result.hidden = true; result.textContent = ''; result.classList.remove('is-success','is-error'); }
    if (bar) bar.style.width = '0%';
    if (count) count.textContent = '0 / 25';
    if (detail) detail.textContent = 'Preparing…';
    if (title) title.textContent = 'Generating rounds…';
  }

  async function showTemplateGenerationProgress(roundNo, maxRounds, covered, target) {
    const progress = document.getElementById('offlineRoundsProgress');
    const bar = document.getElementById('offlineRoundsProgressBar');
    const count = document.getElementById('offlineRoundsProgressCount');
    const detail = document.getElementById('offlineRoundsProgressDetail');
    if (progress) progress.hidden = false;
    if (count) count.textContent = String(roundNo) + ' / ' + String(maxRounds);
    if (bar) bar.style.width = Math.max(0, Math.min(100, (roundNo / Math.max(1, maxRounds)) * 100)) + '%';
    if (detail) detail.textContent = String(covered) + ' / ' + String(target) + ' unique pairs covered';
    await new Promise(function(resolve) {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function(){ resolve(); });
      else setTimeout(resolve, 0);
    });
  }

  function showTemplateGenerationResult(cycleLength, storedRounds, covered, target, capped) {
    const progress = document.getElementById('offlineRoundsProgress');
    const bar = document.getElementById('offlineRoundsProgressBar');
    const count = document.getElementById('offlineRoundsProgressCount');
    const detail = document.getElementById('offlineRoundsProgressDetail');
    const title = document.getElementById('offlineRoundsProgressTitle');
    const result = document.getElementById('offlineRoundsResult');
    if (progress) progress.hidden = false;
    if (bar) bar.style.width = '100%';
    if (count) count.textContent = String(storedRounds) + ' / 25';
    if (title) title.textContent = 'Generation complete';
    if (detail) detail.textContent = String(covered) + ' / ' + String(target) + ' unique pairs covered';
    if (result) {
      result.hidden = false;
      result.classList.add('is-success');
      result.textContent = capped
        ? '25 rounds generated · unique-pair cycle did not fully complete within the 25-round maximum.'
        : ('Unique-pair cycle completed at Round ' + cycleLength + ' · template stored as 25 rounds.');
    }
  }

  async function prepare(count, courtCount) {
    const existingResult = document.getElementById('offlineRoundsResult');
    const existingBtn = document.getElementById('prepareOfflineRoundsBtn');
    if (templatePickerMode && existingResult && !existingResult.hidden && existingBtn && existingBtn.textContent === 'Done') {
      closePrepare();
      return;
    }
    count = templatePickerMode ? 25 : Math.max(1, Math.min(100, Number(count) || 30));
    courtCount = Math.max(1, Math.min(12, Number(courtCount) || Number((typeof schedulerState !== 'undefined' && schedulerState.numCourts) || 0) || 1));
    if (preparing) return;
    if (!navigator.onLine) {
      alert('Internet is required only while preparing Round iMode.');
      return;
    }
    if (!window.SCSOfflineDB || typeof safeGenerateRound !== 'function' || typeof schedulerState === 'undefined') {
      alert('Offline preparation is not ready yet.');
      return;
    }

    const btn = document.getElementById('prepareOfflineRoundsBtn');
    const status = document.getElementById('offlineRoundsStatus');
    preparing = true;
    if (templatePickerMode) resetTemplateGenerationUi();
    if (btn) btn.disabled = true;

    try {
      const validation = validatePrepareInputs(true);
      if (!validation.ok) { alert(validation.message); return; }
      const tempState = cloneSchedulerState(schedulerState);
      const requestedPlayers = requestedPreparePlayerCount();

      // Offline preparation is template-based. The entered Players count is
      // the source of truth; it does not depend on the app's current player list.
      const templateNames = Array.from({ length: requestedPlayers }, function(_, pi) {
        return 'Offline Player ' + (pi + 1);
      });

      tempState.activeplayers = templateNames.slice().reverse();
      tempState.allPlayers = templateNames.map(function(name, pi) {
        // Mixed template alternates M/F so the existing XD generator receives
        // the same gender structure it expects. Standard Doubles does not care.
        const genderCounts = requestedPrepareGenderCounts();
        const mixedGender = pi < genderCounts.men ? 'Male' : 'Female';

        // Balanced template needs an ordering signal. Give stable descending
        // template ratings; later Temp DB mapping replaces slots by current rating rank.
        const balancedCounts = requestedBalancedCounts();
        const templateRating = pi < balancedCounts.top ? 5.0 : 2.5;

        return {
          name: name,
          gender: getGameType() === 'mixed' ? mixedGender : null,
          rating: templateRating,
          activeRating: templateRating,
          clubRating: templateRating,
          guest: false,
          unrated: false,
          active: true
        };
      }).reverse();

      const fixedPairCount = requestedFixedPairCount();
      const templateGenderCounts = requestedPrepareGenderCounts();
      const canonicalFixedPairs = Array.from({length:fixedPairCount}, function(_, index) {
        return getGameType() === 'mixed'
          ? ['Offline Player ' + (index + 1), 'Offline Player ' + (templateGenderCounts.men + index + 1)]
          : ['Offline Player ' + (index * 2 + 1), 'Offline Player ' + (index * 2 + 2)];
      });
      tempState.fixedPairs = cloneValue(canonicalFixedPairs);
      tempState.fixedMap = new Map();
      // Offline reserves are generated for the court count explicitly chosen
      // in the Offline Rounds card, independent of the live session court count.
      tempState.numCourts = courtCount;
      tempState.courts = courtCount;

      const gameType = getGameType();
      const offlineAlgorithm = getAlgorithm();
      tempState.gameGenerationMode = offlineAlgorithm;
      tempState.standardGamesMode = offlineAlgorithm === 'standard';
      tempState.balancedGamesMode = offlineAlgorithm === 'balanced';

      // True virtual Live session: start from the same clean scheduler state
      // as normal Round Mode, not from cloned historical session counters/maps.
      tempState.fixedPairs = cloneValue(canonicalFixedPairs);
      tempState.fixedMap = new Map();
      if (typeof initSchedulerState !== 'function') {
        throw new Error('Live scheduler initializer is unavailable.');
      }
      initSchedulerState(tempState, courtCount, {
        formats: Array(courtCount).fill('doubles'),
        types: Array(courtCount).fill(gameType === 'mixed' ? 'XD' : 'free')
      });
      tempState.gameGenerationMode = offlineAlgorithm;
      tempState.standardGamesMode = offlineAlgorithm === 'standard';
      tempState.uniqueGamesMode = offlineAlgorithm === 'standard' && getOfflineUniquePairMode();
      tempState.balancedGamesMode = offlineAlgorithm === 'balanced';


      // Reuse the normal Round Mode Round-1 ordering function exactly once
      // before generating this Offline dataset.
      const offlineRandomOrder = getRandomOrder();
      if (typeof applyRoundOneInitialOrder === 'function') {
        applyRoundOneInitialOrder(tempState, offlineRandomOrder ? 'random' : 'keep');
      }

      const requiredPlayers = courtCount * 4;
      if (requiredPlayers > requestedPlayers) {
        alert('Not enough players for ' + courtCount + ' court' + (courtCount === 1 ? '' : 's') + '.');
        return;
      }
      const tempRounds = [];
      const batchId = 'offline-' + Date.now();
      const records = [];
      const librarySpec = offlineLibrarySpec(count, courtCount);
      if (librarySpec) {
        if (status) status.textContent = 'Checking shared round libraryâ€¦';
        const libraryPayload = await fetchOfflineLibrary(librarySpec);
        if (libraryPayload && await installOfflineLibrary(libraryPayload, librarySpec, status)) return;
      }

      const uniqueCycleTemplate = !!templatePickerMode;
      const targetPairs = uniqueCycleTemplate ? templateTargetPairs(tempState, gameType, canonicalFixedPairs) : new Set();
      const coveredPairs = new Set();

      const templateSafetyLimit = uniqueCycleTemplate ? 25 : count;
      let stalledRounds = 0;
      let completedCycleLength = 0;
      for (let i = 0; i < templateSafetyLimit; i++) {
        if (status) status.textContent = uniqueCycleTemplate
          ? ('Generating unique-pair cycle · round ' + (i + 1) + ' · ' + coveredPairs.size + ' / ' + targetPairs.size + ' pairs')
          : ('Preparing ' + (i + 1) + ' / ' + count + '…');
        if (uniqueCycleTemplate) {
          await showTemplateGenerationProgress(i + 1, 25, coveredPairs.size, targetPairs.size);
        }
        tempState.roundIndex = tempRounds.length + 1;
        // Generate with the exact same Online Round helper used by nextRound().
        // Offline preparation only supplies its isolated history/state; it does
        // not own a second pairing, XD, fairness, retry, or cycle algorithm.
        if (typeof generateRoundWithLiveRules !== 'function') {
          throw new Error('Online round generator is unavailable.');
        }
        const round = await generateRoundWithLiveRules(tempState, {
          historyRounds: tempRounds,
          offlinePreparation: true
        });

        round.round = i + 1;
        tempRounds.push(cloneValue(round));
        records.push({
          id: batchId + '-' + String(i + 1).padStart(3, '0'),
          batchId,
          sequence: i + 1,
          createdAt: Date.now(),
          used: false,
          playerPool: [...tempState.activeplayers],
          numCourts: tempState.numCourts,
          courtTypes: [...(tempState.courtTypes || [])],
          courtFormats: [...(tempState.courtFormats || [])],
          algorithm: offlineAlgorithm,
          gameType: gameType,
          randomOrder: offlineRandomOrder,
          round: cloneValue(round)
        });
        // Use the exact Live post-round scheduler update. This updates rest
        // rotation, played counts, opponent history, pair history, game history
        // and uniqueness-cycle state before generating the next Offline round.
        const playingSlots = Math.min(tempState.activeplayers.length, courtCount * 4);
        const virtualRestCount = Math.max(tempState.activeplayers.length - playingSlots, 0);
        const virtualResetRest = virtualRestCount >= playingSlots;
        updSchedule(i, tempState, false, {
          data: round,
          silent: true,
          resetRestOverride: virtualResetRest
        });

        if (uniqueCycleTemplate) {
          const beforePairCount = coveredPairs.size;
          addRoundPairsToSet(round, coveredPairs);
          stalledRounds = coveredPairs.size > beforePairCount ? 0 : stalledRounds + 1;
          let complete = targetPairs.size > 0;
          if (complete) {
            for (const key of targetPairs) {
              if (!coveredPairs.has(key)) { complete = false; break; }
            }
          }
          if (complete) {
            completedCycleLength = records.length;
            break;
          }
          // The 25-round template maximum is authoritative for this flow.
        }
      }

      if (uniqueCycleTemplate && !records.length) {
        throw new Error('Could not generate a unique-pair cycle for this setup.');
      }

      const logicalCycleLength = uniqueCycleTemplate
        ? (completedCycleLength || Math.min(records.length, 25))
        : 0;

      // Worker stays unchanged: a template key of 25 requires 25 records.
      // If uniqueness completed early, repeat that exact cycle to fill rows 1–25.
      if (uniqueCycleTemplate && completedCycleLength > 0 && records.length < 25) {
        const cycleSource = records.slice(0, completedCycleLength).map(cloneValue);
        while (records.length < 25) {
          const index = records.length;
          const copy = cloneValue(cycleSource[index % cycleSource.length]);
          copy.id = batchId + '-' + String(index + 1).padStart(3, '0');
          copy.sequence = index + 1;
          copy.createdAt = Date.now();
          copy.used = false;
          delete copy.usedAt;
          if (copy.round) copy.round.round = index + 1;
          records.push(copy);
        }
      }

      for (const record of records) await window.SCSOfflineDB.savePreparedRound(record);

      const dataset = {
        id: batchId,
        batchId,
        count: records.length,
        cycleLength: uniqueCycleTemplate ? logicalCycleLength : 0,
        isUniqueCycleTemplate: uniqueCycleTemplate,
        createdAt: Date.now(),
        players: [...tempState.activeplayers],
        allPlayers: (tempState.allPlayers || []).map(function(player) {
          return {
            name: player.name, gender: player.gender || null, rating: player.rating == null ? 1 : player.rating,
            clubRating: player.clubRating == null ? null : player.clubRating, guest: !!player.guest, unrated: !!player.unrated
          };
        }),
        numCourts: tempState.numCourts,
        algorithm: offlineAlgorithm,
        gameType: gameType,
        randomOrder: offlineRandomOrder,
        uniquePairMode: offlineAlgorithm === 'standard' && getOfflineUniquePairMode(),
        fixedPairs: cloneValue(canonicalFixedPairs)
      };

      const datasets = await getDatasets();
      datasets.unshift(dataset);
      await saveDatasets(datasets);
      await window.SCSOfflineDB.saveMeta('preparedBatch', dataset); // compatibility only
      localStorage.setItem(DATASET_KEY, batchId);
      if (librarySpec) {
        if (status) status.textContent = (uniqueCycleTemplate ? (records.length + '-round unique-pair cycle ready') : (count + ' rounds ready')) + ' · saving to shared library…';
        const storedInLibrary = await storeOfflineLibrary(librarySpec, dataset, records);
        // Creating a Rounds Template is different from preparing local iMode data:
        // a template is not successfully created until the shared copy is stored.
        if (templatePickerMode && !storedInLibrary) {
          if (status) status.textContent = 'Template generated, but could not be saved';
          alert('The rounds were generated, but the Rounds Template could not be saved to the shared library.\n\nThe deployed Worker must support the selected court count.');
          return;
        }
      }
      if (status) status.textContent = uniqueCycleTemplate
        ? ('Template ready · ' + records.length + ' stored rounds')
        : (count + ' rounds ready');
      if (uniqueCycleTemplate) {
        showTemplateGenerationResult(logicalCycleLength, records.length, coveredPairs.size, targetPairs.size, completedCycleLength === 0);
        if (btn) btn.textContent = 'Done';
      } else {
        closePrepare();
      }
      await refreshStatus();
    } catch (error) {
      console.error('Offline round preparation failed:', error);
      alert('Could not prepare Round iMode.\n' + (error && error.message ? error.message : error));
      await refreshStatus();
    } finally {
      preparing = false;
      if (btn) btn.disabled = false;
      validatePrepareInputs(true);
    }
  }

  function roundPlayingNames(round) {
    const names = [];
    ((round && round.games) || []).forEach(game => {
      (game.pair1 || []).forEach(n => names.push(baseName(n)));
      (game.pair2 || []).forEach(n => names.push(baseName(n)));
    });
    return names;
  }

  function updateOfflineUseUi(total, unused) {
    const startBtn = document.getElementById('sampleStartOfflineRound');
    const inProgress = hasSessionInProgress();

    if (startBtn) {
      const hasPrepared = Number(total || 0) > 0 && Number(unused || 0) > 0;
      startBtn.disabled = !hasPrepared;
      startBtn.setAttribute('aria-disabled', hasPrepared ? 'false' : 'true');
      const label = startBtn.querySelector('.org-start-label');
      if (label) label.textContent = t(inProgress ? 'continueRoundIMode' : 'startRoundIMode');
    }

    // While an offline session is in progress, the Offline card is the only
    // scheduling mode available. Preparation remains accessible from this card.
    const carousel = document.getElementById('orgModeCarousel');
    if (carousel) carousel.classList.toggle('offline-session-locked', inProgress);

    document.querySelectorAll('.org-carousel-arrow').forEach(function(button) {
      button.disabled = inProgress;
      button.setAttribute('aria-disabled', inProgress ? 'true' : 'false');
    });
    document.querySelectorAll('.org-carousel-dots button').forEach(function(button, index) {
      const disabled = inProgress && index !== 1;
      button.disabled = disabled;
      button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    });

    if (inProgress && typeof orgSetSchedulingSlide === 'function') {
      const carouselNow = document.getElementById('orgModeCarousel');
      if (carouselNow && String(carouselNow.dataset.activeSlide || '') !== '1') {
        orgSetSchedulingSlide(1);
      }
    }
  }

  async function markPreparedUsed(row) {
    row.used = true;
    row.usedAt = Date.now();
    localStorage.setItem(SESSION_KEY, '1');
    if (!localStorage.getItem(SESSION_DATASET_KEY) && row.sourceBatchId) {
      localStorage.setItem(SESSION_DATASET_KEY, String(row.sourceBatchId));
      localStorage.setItem(DATASET_KEY, String(row.sourceBatchId));
    }
    if (row.sourceBatchId && window.SCSOfflineDB.saveTempPreparedRound) await window.SCSOfflineDB.saveTempPreparedRound(row);
    else await window.SCSOfflineDB.savePreparedRound(row);
    await refreshStatus();
  }

  async function pickRound(state) {
    if (!window.SCSOfflineDB) return null;
    const dataset = await getTempDatasetMeta();
    if (!dataset) return null;

    // Offline playback is intentionally NOT a scheduler. The Online generator
    // already created every round during preparation. Temp DB only remaps the
    // template player names to the current roster while preserving the exact
    // stored courts, pairs, opponents, resting players, XD/free type and order.
    let rows = (await tempRows(false))
      .filter(row => row && row.round)
      .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
    if (!rows.length && (dataset.isUniqueCycleTemplate || Number(dataset.cycleLength) > 0)) {
      // Unique-cycle templates never run out. Once the final stored round has
      // been consumed, reopen only those same rows and continue from Round 1.
      await resetPreparedUsage();
      rows = (await tempRows(false))
        .filter(row => row && row.round)
        .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
    }
    if (!rows.length) return null;

    const row = rows[0];
    const source = cloneValue(row.round);
    const expectedCourts = Math.max(1, Number(dataset.numCourts) || Number(state.numCourts) || 1);
    if (!Array.isArray(source.games) || source.games.length !== expectedCourts) return null;

    // Guard only; never repair/rebuild a prepared round at playback time.
    const activeSet = new Set((state.activeplayers || []).map(baseName));
    const storedNames = roundPlayingNames(source);
    if (storedNames.some(name => !activeSet.has(baseName(name)))) return null;

    // Restore the exact per-court format/type that was captured beside this
    // Online-generated round.  Offline must never infer or default XD to Free.
    // These arrays are sidecar metadata from the original Online generator state
    // and survive player-name remapping unchanged in the Temp DB.
    const storedFormats = Array.isArray(row.courtFormats) ? row.courtFormats : [];
    const storedTypes = Array.isArray(row.courtTypes) ? row.courtTypes : [];
    if (storedFormats.length >= expectedCourts) {
      state.courtFormats = storedFormats.slice(0, expectedCourts);
    }
    if (storedTypes.length >= expectedCourts) {
      state.courtTypes = storedTypes.slice(0, expectedCourts);
    }

    source.round = Number(state.roundIndex) || Number(row.sequence) || 1;
    source._offlinePrepared = true;
    source._offlinePreparedId = row.id;
    await markPreparedUsed(row);
    noteGenerationSource('prepared');
    return source;
  }

  function noteGenerationSource(source) {
    const info = document.getElementById('offlineTemplateMatch');
    if (!info) return;
    info.textContent = source === 'live' ? 'Round iMode · Live generated' : 'Round iMode · Prepared';
    info.classList.add('is-ready');
  }

  async function endSession(shuttleData = null) {
    let synced = true;
    if (typeof syncRoundIModeSession === 'function') synced = await syncRoundIModeSession(shuttleData);
    if (!synced) {
      if (typeof saveSnapshot === 'function') saveSnapshot();
      if (typeof showToast === 'function') showToast('Round iMode saved locally · End & Sync when online');
      else alert('Round iMode is saved locally. Reopen it and use End when online to sync.');
      return false;
    }
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_DATASET_KEY);
    localStorage.removeItem(LIVE_CONTEXT_KEY);
    deactivate();
    await clearTempDataset();
    if (typeof clearSnapshot === 'function') clearSnapshot();
    await refreshStatus();
    refreshStartLabel();
    if (typeof orgSetSchedulingSlide === 'function') orgSetSchedulingSlide(0);
    return true;
  }

  async function resetPreparedUsage() {
    const rows=await tempRows(true);
    for (const row of rows) {
      row.used=false;
      delete row.usedAt;
      delete row.lastOfflineRank;
      delete row.lastOfflineScore;
      await window.SCSOfflineDB.saveTempPreparedRound(row);
    }
  }

  async function resetSession() {
    if (!confirm('Reset Round iMode to Round 0?\nPrepared rounds will be kept.')) return;
    try {
      // Prepared database stays, but every prepared round becomes available again.
      await clearTempDataset();

      // Clear only the active offline play session and its lock.
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SESSION_DATASET_KEY);
      localStorage.removeItem(LIVE_CONTEXT_KEY);
      deactivate();

      // Return round/session state to a true fresh start.
      if (typeof allRounds !== 'undefined' && Array.isArray(allRounds)) allRounds.length = 0;
      if (typeof lastRound !== 'undefined' && Array.isArray(lastRound)) lastRound.length = 0;
      if (typeof currentRoundIndex !== 'undefined') currentRoundIndex = 0;
      try {
        if (typeof sessionFinished !== 'undefined') sessionFinished = false;
      } catch (_) {}

      if (typeof schedulerState !== 'undefined' && schedulerState) {
        let meta = null;
        try { meta = await getSelectedDataset(); } catch (_) {}

        // Rebuild the local scheduler from the PREPARED database configuration,
        // so the next Start Offline Round always begins correctly at Round 1.
        if (meta && Array.isArray(meta.players) && meta.players.length) {
          schedulerState.activeplayers = meta.players.map(baseName);
        }

        const courtCount = Math.max(
          1,
          Number(meta && meta.numCourts) ||
          Number(schedulerState.numCourts) ||
          1
        );
        const formats = Array(courtCount).fill('doubles');
        const types = Array(courtCount).fill(meta && meta.gameType === 'mixed' ? 'XD' : 'free');

        if (typeof initScheduler === 'function') {
          initScheduler(courtCount, { formats, types });
        } else {
          schedulerState.numCourts = courtCount;
          schedulerState.courts = courtCount;
          schedulerState.roundIndex = 0;
          schedulerState.restQueue = [...(schedulerState.activeplayers || [])];
          schedulerState.restCount = new Map((schedulerState.activeplayers || []).map(name => [name, 0]));
          schedulerState.PlayedCount = new Map((schedulerState.activeplayers || []).map(name => [name, 0]));
          schedulerState.pairHistory = new Map();
          schedulerState.pairPlayedSet = new Set();
          schedulerState.gamesMap = new Set();
          schedulerState.playedTogether = new Map();
          schedulerState.opponentMap = new Map();
        }
        schedulerState.roundIndex = 0;
      }

      // Remove only live round/session snapshots; prepared IndexedDB data is untouched.
      try {
        localStorage.removeItem('allRounds');
        localStorage.removeItem('currentRoundIndex');
        localStorage.removeItem('isOnPage2');
      } catch (_) {}

      // Restore normal app access and make Offline Mode immediately usable again.
      await refreshStatus();
      refreshStartLabel();
      if (typeof orgSetSchedulingSlide === 'function') orgSetSchedulingSlide(1);

      if (typeof showToast === 'function') {
        showToast('Offline round reset. Ready to start again from Round 1.');
      } else {
        alert('Offline round reset. Ready to start again from Round 1.');
      }
    } catch (error) {
      alert('Could not reset Round iMode.\n' + (error && error.message ? error.message : error));
    }
  }

  function applyOfflineSettings() {
    if (typeof schedulerState === 'undefined' || !schedulerState) return false;
    const courtCount = Math.max(1, Number(schedulerState.numCourts) || 1);
    if (!schedulerState.activeplayers || schedulerState.activeplayers.length < courtCount * 4) {
      alert('Not enough selected players for ' + courtCount + ' doubles court' + (courtCount === 1 ? '' : 's') + '.');
      return false;
    }
    schedulerState.numCourts = courtCount;
    schedulerState.courts = courtCount;
    schedulerState.courtFormats = Array(courtCount).fill('doubles');
    schedulerState.courtTypes = Array(courtCount).fill(getGameType() === 'mixed' ? 'XD' : 'free');
    const algorithm = getAlgorithm();
    schedulerState.gameGenerationMode = algorithm;
    schedulerState.standardGamesMode = algorithm === 'standard';
    schedulerState.balancedGamesMode = algorithm === 'balanced';
    try { localStorage.setItem('roundFormatPreset', 'doubles'); } catch (_) {}
    try { localStorage.setItem('initialPlayerOrder', getRandomOrder() ? 'random' : 'keep'); } catch (_) {}
    const winnerSource = document.getElementById('stepModeToggle');
    if (winnerSource) {
      winnerSource.checked = getWinner();
      winnerSource.dispatchEvent(new Event('change', { bubbles:true }));
    } else {
      schedulerState.markingWinnerMode = getWinner();
    }
    const courtsText = document.getElementById('num-courts');
    if (courtsText) courtsText.textContent = String(courtCount);
    if (typeof courts !== 'undefined') courts = courtCount;

    // Round iMode restores the session's mapped Fixed Pairs immediately before
    // this function runs. Do not clear them here: normal Round Mode keeps the
    // same fixed-pair state for the whole session, and iMode must do the same
    // so paired players render/behave as one unit and Pairing History excludes
    // them just like normal Round Mode.
    schedulerState.fixedPairs = Array.isArray(schedulerState.fixedPairs)
      ? schedulerState.fixedPairs.filter(pair => Array.isArray(pair) && pair.length === 2)
      : [];
    schedulerState.fixedMap = new Map();
    schedulerState.fixedPairs.forEach(function(pair) {
      schedulerState.fixedMap.set(pair[0], pair[1]);
      schedulerState.fixedMap.set(pair[1], pair[0]);
    });
    return true;
  }

  async function restorePreparedContextForOfflineStart() {
    if (!window.SCSOfflineDB || typeof schedulerState === 'undefined' || !schedulerState) return false;
    const meta = await getTempDatasetMeta();
    if (!meta || !Array.isArray(meta.players) || !meta.players.length) return false;

    schedulerState.activeplayers = meta.players.map(baseName);

    if (Array.isArray(meta.allPlayers) && meta.allPlayers.length) {
      schedulerState.allPlayers = meta.allPlayers.map(function(player) {
        return {
          name: player.name,
          gender: player.gender || null,
          rating: player.rating == null ? 1 : player.rating,
          clubRating: player.clubRating == null ? null : player.clubRating,
          guest: !!player.guest,
          unrated: !!player.unrated,
          active: true
        };
      });
    }

    schedulerState.fixedPairs = Array.isArray(meta.fixedPairs)
      ? meta.fixedPairs.map(pair => Array.isArray(pair) ? pair.map(baseName) : pair)
      : [];

    const storedCourts = Math.max(1, Number(meta.numCourts) || 1);
    schedulerState.numCourts = storedCourts;
    schedulerState.courts = storedCourts;
    schedulerState.courtFormats = Array(storedCourts).fill('doubles');
    schedulerState.courtTypes = Array(storedCourts).fill(meta.gameType === 'mixed' ? 'XD' : 'free');

    setAlgorithm(meta.algorithm === 'balanced' ? 'balanced' : 'standard');
    localStorage.setItem(GAME_TYPE_KEY, meta.gameType === 'mixed' ? 'mixed' : 'doubles');
    setRandomOrder(meta.randomOrder !== false);
    try { localStorage.setItem('initialPlayerOrder', meta.randomOrder === false ? 'keep' : 'random'); } catch (_) {}
    schedulerState.fixedMap = new Map();
    schedulerState.fixedPairs.forEach(function(pair) {
      if (!Array.isArray(pair) || pair.length !== 2) return;
      schedulerState.fixedMap.set(pair[0], pair[1]);
      schedulerState.fixedMap.set(pair[1], pair[0]);
    });
    return true;
  }

  async function start() {
    if (!window.SCSOfflineDB) { alert('Offline database is not available.'); return; }

    // Build 972 — continuation is a recovery path, not a new template lookup.
    // A live iMode session has no SESSION_DATASET_KEY, so resume it immediately
    // from the restored scheduler snapshot without touching the template DB.
    // A prepared session already has its mapped Temp DB; resume from that local
    // copy directly and never re-read/revalidate the full template library.
    if (hasSessionInProgress()) {
      if (!isTemplateSessionActive()) {
        const restoredLive = restoreLiveIModeContext();
        if (!restoredLive) {
          localStorage.removeItem(SESSION_KEY);
          deactivate();
          const info = document.getElementById('offlineTemplateMatch');
          if (info) { info.textContent = 'Live session data unavailable · add players to start'; info.classList.remove('is-ready'); }
          await refreshOfflineStartAvailability();
          refreshStartLabel();
          return;
        }
        activate();
        const info = document.getElementById('offlineTemplateMatch');
        if (info) { info.textContent = 'Round iMode · Live session ready'; info.classList.add('is-ready'); }
        if (typeof stepCourtsDone === 'function') stepCourtsDone();
        return;
      }

      const restored = await settleWithin(restorePreparedContextForOfflineStart().catch(() => false), 2500, false);
      if (!restored) { alert('Round iMode session data is unavailable.'); return; }
      const rows = await settleWithin(tempRows(false).catch(() => []), 2500, []);
      if (!rows.length) { alert('No temporary offline rounds are available.'); return; }
      if (!applyOfflineSettings()) return;
      activate();
      const info = document.getElementById('offlineTemplateMatch');
      if (info) { info.textContent = 'Round iMode · Prepared session ready'; info.classList.add('is-ready'); }
      if (typeof stepCourtsDone === 'function') stepCourtsDone();
      return;
    }

    let dataset = getUseTemplates() ? await selectMatchingDatasetForCurrentConfig() : null;

    // True hybrid iMode: when no prepared template matches, keep the selected
    // iMode settings and enter the existing proven live Round Mode generator.
    if (!dataset && !hasSessionInProgress()) {
      if (typeof schedulerState !== 'undefined' && schedulerState) {
        schedulerState.numCourts = getCourtCount();
        schedulerState.courts = getCourtCount();
        schedulerState.gameGenerationMode = getAlgorithm();
        schedulerState.standardGamesMode = getAlgorithm() === 'standard';
        schedulerState.balancedGamesMode = getAlgorithm() === 'balanced';
        schedulerState.uniquePairMode = getOfflineUniquePairMode();
        schedulerState.iModeSyncTotals = {};
        schedulerState.iModeRecordedRounds = [];
      }
      try { localStorage.setItem('initialPlayerOrder', getRandomOrder() ? 'random' : 'keep'); } catch (_) {}

      // Templates-OFF iMode enters the normal live Round Mode page. That page's
      // existing Round 1 path reads the visible #num-courts value, so keep it
      // synchronized with the iMode court selector before navigation. Without
      // this, schedulerState can correctly hold 3 courts while the Round page
      // still reads its stale default of 1 and generates only Court 1.
      const liveCourtCount = getCourtCount();
      const liveCourtsText = document.getElementById('num-courts');
      if (liveCourtsText) liveCourtsText.textContent = String(liveCourtCount);
      if (typeof courts !== 'undefined') courts = liveCourtCount;

      // iMode keeps its Game Format in scsOfflineGameType, while the proven
      // live Round generator reads schedulerState.courtFormats/courtTypes (and
      // roundFormatPreset when it fills missing courts). Bridge those two
      // existing states before entering the Round page. Without this bridge,
      // choosing Singles in iMode still enters live generation as Doubles.
      const liveGameType = getGameType();
      if (typeof schedulerState !== 'undefined' && schedulerState && liveGameType === 'singles') {
        schedulerState.courtFormats = Array(liveCourtCount).fill('singles');
        schedulerState.courtTypes = Array(liveCourtCount).fill('singles-free');
        try { localStorage.setItem('roundFormatPreset', 'singles'); } catch (_) {}
      } else if (typeof schedulerState !== 'undefined' && schedulerState && liveGameType === 'doubles') {
        schedulerState.courtFormats = Array(liveCourtCount).fill('doubles');
        schedulerState.courtTypes = Array(liveCourtCount).fill('free');
        try { localStorage.setItem('roundFormatPreset', 'doubles'); } catch (_) {}
      }

      // Persist the selected live roster/settings BEFORE marking the session active.
      // This survives a PWA kill/update even when Round 1 has not yet been generated,
      // which means saveSnapshot() does not exist yet.
      saveLiveIModeContext();
      localStorage.removeItem(SESSION_DATASET_KEY);
      localStorage.setItem(SESSION_KEY, '1');
      activate();
      if (typeof stepCourtsDone === 'function') stepCourtsDone();
      return;
    }
    if (!dataset) { alert('Round iMode session data is unavailable.'); return; }

    if (!hasSessionInProgress()) {
      const validation = offlineStartValidation(dataset);
      if (!validation.ok) {
        alert(validation.reason);
        await refreshOfflineStartAvailability();
        refreshStartLabel();
        return;
      }

      try {
        await createTempDatasetFromSelected();
        localStorage.removeItem(LIVE_CONTEXT_KEY);
        localStorage.setItem(SESSION_DATASET_KEY,String(dataset.id||dataset.batchId));
        if (typeof schedulerState !== 'undefined' && schedulerState) {
          schedulerState.iModeSyncTotals = {};
          schedulerState.iModeRecordedRounds = [];
        }
      } catch(error) {
        alert('Could not map current players to this Offline Data.\n'+(error&&error.message?error.message:error));
        return;
      }
    }

    await restorePreparedContextForOfflineStart();
    const rows=await tempRows(false);
    if (!rows.length) { alert('No temporary offline rounds are available.'); return; }
    if (!applyOfflineSettings()) return;
    activate();
    if (typeof stepCourtsDone === 'function') stepCourtsDone();
  }

  function selectedDatasetPlayerCount(dataset) {
    return dataset && Array.isArray(dataset.players) ? dataset.players.length : 0;
  }

  function currentActivePlayers() {
    if (typeof schedulerState === 'undefined' || !schedulerState) return [];

    // Build 941 — iMode setup must use the complete selected-player roster.
    // During player-manager -> Round Manager navigation, activeplayers can briefly
    // contain an older/smaller list while allPlayers already has the new active flags.
    // Use whichever source currently contains the larger valid active roster.
    const activeFromState = Array.isArray(schedulerState.activeplayers)
      ? schedulerState.activeplayers.map(baseName).filter(Boolean) : [];
    const activeFromCatalog = Array.isArray(schedulerState.allPlayers)
      ? schedulerState.allPlayers
          .filter(function(player) { return player && player.active; })
          .map(function(player) { return baseName(player.name); })
          .filter(Boolean)
      : [];

    return activeFromCatalog.length >= activeFromState.length ? activeFromCatalog : activeFromState;
  }

  function currentGenderCounts() {
    const active = currentActivePlayers();
    const all = (typeof schedulerState !== 'undefined' && schedulerState && Array.isArray(schedulerState.allPlayers))
      ? schedulerState.allPlayers : [];
    let men = 0, women = 0, unknown = 0;
    active.forEach(function(name) {
      const p = all.find(function(item) { return item && baseName(item.name) === name; });
      const g = genderBucket(p && p.gender);
      if (g === 'male') men++;
      else if (g === 'female') women++;
      else unknown++;
    });
    return { men, women, unknown };
  }

  function templateGenderCounts(dataset) {
    if (!dataset || dataset.gameType !== 'mixed') return null;
    const all = Array.isArray(dataset.allPlayers) ? dataset.allPlayers : [];
    let men = 0, women = 0;
    (dataset.players || []).forEach(function(name) {
      const p = all.find(function(item) { return item && baseName(item.name) === baseName(name); });
      const g = genderBucket(p && p.gender);
      if (g === 'male') men++;
      else if (g === 'female') women++;
    });

    // Legacy/template fallback: neutral Mixed templates alternate gender.
    if (!men && !women) {
      const count = selectedDatasetPlayerCount(dataset);
      men = Math.ceil(count / 2);
      women = Math.floor(count / 2);
    }
    return { men, women };
  }

  function applyMatchedTemplateConfig(dataset) {
    if (!dataset) return;
    const algorithm = dataset.algorithm === 'balanced' ? 'balanced' : 'standard';
    localStorage.setItem(ALG_KEY, algorithm);
    // iMode controls describe the template that will actually be used.
    // Standard templates prefer Unique ON; Random OFF is preferred for either mode.
    if (algorithm === 'standard') localStorage.setItem(UNIQUE_KEY, dataset.uniquePairMode === false ? '0' : '1');
    localStorage.setItem(RANDOM_KEY, dataset.randomOrder === false ? '0' : '1');
    refreshControls();
  }

  async function selectMatchingDatasetForCurrentConfig() {
    if (!getUseTemplates()) {
      localStorage.removeItem(DATASET_KEY);
      const info = document.getElementById('offlineTemplateMatch');
      if (info) {
        info.textContent = t('templatesOff') + ' · ' + t('liveRoundMode');
        info.classList.remove('is-ready');
      }
      return null;
    }

    // Build 972 — iMode must never block the UI while checking the remote
    // template library. Read the already-downloaded encrypted library first
    // and let the online refresh happen independently in the background.
    // This also makes cold PWA restores deterministic when the network/auth
    // session is still waking up after an app kill or update.
    if (navigator.onLine) {
      syncFullOfflineLibrary().catch(() => false);
    }
    const datasets = await settleWithin(getDatasets(), 1500, []);
    const activeCount = currentActivePlayers().length;
    const courts = getCourtCount();
    const gameType = getGameType();
    const algorithm = getAlgorithm();
    const balancedCounts = algorithm === 'balanced' ? currentBalancedCounts() : { top: 0, bottom: 0 };
    const activeNames = new Set(currentActivePlayers().map(baseName));
    const currentFixedPairCount = (schedulerState.fixedPairs || []).filter(pair =>
      Array.isArray(pair) && pair.length === 2 && pair.every(name => activeNames.has(baseName(name)))).length;

    // Match the structural setup first. Unique/Random are template capabilities,
    // not hard gates in iMode. Priority: Unique ON before OFF, Random OFF before ON.
    const candidates = datasets.filter(function(data) {
      const count = selectedDatasetPlayerCount(data);
      return count === activeCount && Math.max(1, Number(data.numCourts) || 1) === courts &&
        (data.gameType || 'doubles') === gameType &&
        (data.algorithm === 'balanced' ? 'balanced' : 'standard') === algorithm &&
        (Array.isArray(data.fixedPairs) ? data.fixedPairs.length : 0) === currentFixedPairCount &&
        (algorithm !== 'balanced' ||
          (Number(data.topRatedCount) === balancedCounts.top && Number(data.bottomRatedCount) === balancedCounts.bottom));
    });
    candidates.sort(function(a, b) {
      if (algorithm === 'standard') {
        const au = a.uniquePairMode == null ? true : !!a.uniquePairMode;
        const bu = b.uniquePairMode == null ? true : !!b.uniquePairMode;
        if (au !== bu) return au ? -1 : 1;
      }
      const ar = a.randomOrder !== false;
      const br = b.randomOrder !== false;
      if (ar !== br) return ar ? 1 : -1;
      return (Number(b.count) || 0) - (Number(a.count) || 0);
    });
    const match = candidates[0] || null;

    if (match) {
      localStorage.setItem(DATASET_KEY, String(match.id || match.batchId));
      applyMatchedTemplateConfig(match);
    } else {
      localStorage.removeItem(DATASET_KEY);
    }
    const info = document.getElementById('offlineTemplateMatch');
    if (info) {
      info.textContent = match ? ('Template available · ' + (Number(match.count)||0) + ' rounds') : 'Live Round Mode fallback';
      info.classList.toggle('is-ready', !!match);
    }
    return match;
  }

  function offlineStartValidation(dataset) {
    if (!dataset) {
      return { ok:false, reason:'No template available' };
    }

    const required = selectedDatasetPlayerCount(dataset);
    const active = currentActivePlayers();

    if (!active.length) {
      return { ok:false, reason:'Add ' + required + ' players' };
    }
    if (active.length !== required) {
      return { ok:false, reason:'Needs ' + required + ' players' };
    }
    const activeNames = new Set(active.map(baseName));
    const currentFixedPairCount = (schedulerState.fixedPairs || []).filter(pair =>
      Array.isArray(pair) && pair.length === 2 && pair.every(name => activeNames.has(baseName(name)))).length;
    const requiredFixedPairCount = Array.isArray(dataset.fixedPairs) ? dataset.fixedPairs.length : 0;
    if (currentFixedPairCount !== requiredFixedPairCount) {
      return { ok:false, reason:'Needs ' + requiredFixedPairCount + ' Fixed Pair' + (requiredFixedPairCount === 1 ? '' : 's') };
    }

    if (dataset.gameType === 'mixed') {
      const current = currentGenderCounts();
      const expected = templateGenderCounts(dataset);
      if (current.unknown > 0) {
        return { ok:false, reason:'Set player gender first' };
      }
      if (!expected || current.men !== expected.men || current.women !== expected.women) {
        return { ok:false, reason:'Needs ' + expected.men + ' men · ' + expected.women + ' women' };
      }
    }

    return { ok:true, reason:'' };
  }

  async function refreshOfflineStartAvailability() {
    const btn = document.getElementById('sampleStartOfflineRound');
    if (!btn) return;
    const label = btn.querySelector('.org-start-label');
    const requestId = ++offlineStartRequestId;

    // A live Offline session must remain continuable even though the mapped
    // Temp DB is now the active roster.
    if (hasSessionInProgress()) {
      if (!isTemplateSessionActive()) restoreLiveIModeContext();
      btn.disabled = false;
      btn.removeAttribute('data-disabled-reason');
      btn.classList.remove('is-live-round-start', 'is-template-round-start');
      btn.classList.add('is-continue');
      if (label) label.textContent = t('continueIRounds');
      const info = document.getElementById('offlineTemplateMatch');
      if (info) {
        info.textContent = isTemplateSessionActive()
          ? 'Round iMode · Prepared session ready'
          : 'Round iMode · Live session ready';
        info.classList.add('is-ready');
      }
      return;
    }

    let dataset = null;
    if (getUseTemplates()) {
      try { dataset = await selectMatchingDatasetForCurrentConfig(); } catch (_) {}
    } else {
      const info = document.getElementById('offlineTemplateMatch');
      if (info) {
        info.textContent = t('templatesOff') + ' · ' + t('liveRoundMode');
        info.classList.remove('is-ready');
      }
    }
    // A newer settings/status refresh owns the presentation now. Ignoring this
    // result prevents an older async lookup from flashing the fallback label.
    if (requestId !== offlineStartRequestId) return;
    btn.classList.remove('is-continue');
    btn.classList.toggle('is-template-round-start', !!dataset);
    btn.classList.toggle('is-live-round-start', !dataset);
    btn.dataset.roundSource = dataset ? 'template' : 'live';
    if (label) label.textContent = t(dataset ? 'startIRounds' : 'startRounds');
    // No template is not an iMode failure: live Round Mode is the fallback.
    const active = currentActivePlayers();
    let liveValidation;
    if (getGameType() === 'singles') {
      const needed = getCourtCount() * 2;
      liveValidation = { ok: active.length >= needed, reason: active.length >= needed ? '' : (active.length ? ('Needs ' + needed + ' players') : 'Add players') };
    } else if (getGameType() === 'mixed') {
      const genders = currentGenderCounts();
      const neededEach = getCourtCount() * 2;
      const ok = genders.unknown === 0 && genders.men >= neededEach && genders.women >= neededEach;
      liveValidation = { ok: ok, reason: ok ? '' : (genders.unknown > 0 ? 'Set player gender first' : ('Needs ' + neededEach + ' men · ' + neededEach + ' women')) };
    } else {
      const needed = getCourtCount() * 4;
      liveValidation = { ok: active.length >= needed, reason: active.length >= needed ? '' : (active.length ? ('Needs ' + needed + ' players') : 'Add players') };
    }
    const validation = dataset ? offlineStartValidation(dataset) : liveValidation;
    btn.disabled = !validation.ok;

    if (validation.reason) {
      btn.setAttribute('data-disabled-reason', validation.reason);
      btn.setAttribute('title', validation.reason);
    } else {
      btn.removeAttribute('data-disabled-reason');
      btn.removeAttribute('title');
    }
  }

  function refreshStartLabel() {
    const btn = document.getElementById('sampleStartOfflineRound');
    if (!btn) return;
    const label = btn.querySelector('.org-start-label');

    if (hasSessionInProgress()) {
      if (label) label.textContent = t('continueIRounds');
      btn.disabled = false;
      return;
    }

    // Preserve the last confirmed source while the next async lookup runs.
    // The initial HTML already provides the safe live-fallback label.
    if (label && btn.dataset.roundSource === 'template') label.textContent = t('startIRounds');
    else if (label && btn.dataset.roundSource === 'live') label.textContent = t('startRounds');
    refreshOfflineStartAvailability();
  }

  function limitPrepareCourtOptions() { refreshPrepareCourtLimit(); }

  function setPrepareSheetMode(mode, action) {
    templatePickerMode = mode === 'template';
    templatePickerAction = templatePickerMode ? (action || 'auto') : 'auto';
    const sheet = document.querySelector('#offlinePrepareOverlay .offline-prepare-sheet');
    if (sheet) sheet.classList.toggle('rounds-template-config-mode', templatePickerMode);
    const title = document.getElementById('offlinePrepareTitle');
    const subtitle = title && title.parentElement ? title.parentElement.querySelector('small') : null;
    if (title) {
      title.textContent = templatePickerMode
        ? (templatePickerAction === 'create' ? 'Create Rounds Template' : templatePickerAction === 'edit' ? 'Edit Rounds Template' : 'Rounds Template')
        : 'Prepare Round iMode';
    }
    if (subtitle) {
      subtitle.textContent = templatePickerMode
        ? (templatePickerAction === 'create'
            ? 'Choose the setup once, then create the template.'
            : 'Choose the saved setup, then open it for editing.')
        : 'Settings start from Round Mode. Adjust them to find an exact shared-library match.';
    }
  }

  function closeTemplateActions() {
    const overlay = document.getElementById('roundsTemplateActionOverlay');
    if (overlay) overlay.hidden = true;
  }

  function openTemplateEditorPicker() {
    if (!canManageTemplatesForSelectedClub()) {
      alert(t('roundsTemplateSCSOnly'));
      return;
    }
    if (!navigator.onLine) {
      alert('Internet is required to get and save a Rounds Template.');
      return;
    }
    if (hasSessionInProgress()) {
      alert('Finish the current Round iMode session before editing a template.');
      return;
    }
    const overlay = document.getElementById('roundsTemplateActionOverlay');
    if (overlay) overlay.hidden = false;
  }

  function openTemplatePickerAction(action) {
    if (!canManageTemplatesForSelectedClub()) {
      alert(t('roundsTemplateSCSOnly'));
      return;
    }
    if (!navigator.onLine) {
      alert('Internet is required to get and save a Rounds Template.');
      return;
    }
    if (hasSessionInProgress()) {
      alert('Finish the current Round iMode session before editing a template.');
      return;
    }
    closeTemplateActions();
    setPrepareSheetMode('template', action);
    const overlay = document.getElementById('offlinePrepareOverlay');
    if (!overlay) return;
    overlay.hidden = false;
    const sheet = overlay.querySelector('.offline-prepare-sheet');
    if (sheet) sheet.scrollTop = 0;
    refreshControls();
    refreshPrepareCourtLimit();
    refreshLibraryMatchFromControls();
  }

  function openTemplateCreatePicker() { openTemplatePickerAction('create'); }
  function openTemplateEditPicker() { openTemplatePickerAction('edit'); }

  function restoreTemplateEditorUi() {
    const bar = document.getElementById('sessionLiveBar');
    if (bar) {
      bar.classList.remove('template-edit-live');
      const liveText = bar.querySelector('.rtb-live-txt');
      if (liveText) liveText.textContent = 'LIVE';
      const end = document.getElementById('endBtn');
      if (end) {
        end.textContent = (typeof t === 'function' ? t('endBtn') : 'End');
        end.setAttribute('onclick', 'endSession()');
        end.disabled = false;
      }
      const close = document.getElementById('templateEditorCloseBtn');
      if (close) close.remove();
    }
    const next = document.getElementById('nextBtn');
    const text = document.getElementById('btnText');
    if (next) next.disabled = false;
    if (text) text.textContent = (typeof t === 'function' ? t('start') : 'Start');
    const dice = document.getElementById('roundShufle');
    if (dice) dice.disabled = false;
    const minus = document.getElementById('courtMinus');
    const plus = document.getElementById('courtPlus');
    if (minus) minus.disabled = false;
    if (plus) plus.disabled = false;
    const roundActions = document.getElementById('templateEditorRoundActions');
    if (roundActions) roundActions.remove();
  }

  function restoreTemplateEditorState() {
    if (!templateEditorBackup) return;
    try {
      allRounds.length = 0;
      templateEditorBackup.rounds.forEach(function(round) { allRounds.push(cloneValue(round)); });
      currentRoundIndex = templateEditorBackup.currentRoundIndex;
      currentState = templateEditorBackup.currentState;
      sessionFinished = templateEditorBackup.sessionFinished;
      Object.keys(schedulerState).forEach(function(key) { delete schedulerState[key]; });
      Object.assign(schedulerState, cloneSchedulerState(templateEditorBackup.schedulerState));
    } catch (error) {
      console.warn('Could not fully restore previous round state:', error);
    }
    templateEditorBackup = null;
  }

  async function openTemplateEditorFromControls() {
    if (!navigator.onLine) { alert('Internet is required to get a Rounds Template.'); return; }
    const validation = validatePrepareInputs(true);
    if (!validation.ok) { alert(validation.message); return; }
    const roundsInput = document.getElementById('offlineRoundsCount');
    const courtsInput = document.getElementById('offlineCourtsCount');
    const roundCount = Math.max(1, Number(roundsInput && roundsInput.value) || 30);
    const courtCount = Math.max(1, Number(courtsInput && courtsInput.value) || 2);
    const spec = offlineLibrarySpec(roundCount, courtCount);
    if (!spec) { alert('This setup does not have a shared Rounds Template.'); return; }

    const btn = document.getElementById('prepareOfflineRoundsBtn');
    const status = document.getElementById('offlineRoundsStatus');
    if (btn) btn.disabled = true;
    if (status) status.textContent = 'Getting template…';
    try {
      const payload = await fetchOfflineLibrary(spec);
      if (!payload || !Array.isArray(payload.records) || !payload.dataset) {
        alert('No stored template matches this exact setup.');
        return;
      }

      templateEditorBackup = {
        rounds: cloneValue(typeof allRounds !== 'undefined' ? allRounds : []),
        currentRoundIndex: typeof currentRoundIndex === 'number' ? currentRoundIndex : 0,
        currentState: typeof currentState === 'string' ? currentState : 'idle',
        sessionFinished: typeof sessionFinished === 'boolean' ? sessionFinished : false,
        schedulerState: cloneSchedulerState(typeof schedulerState !== 'undefined' ? schedulerState : {})
      };

      // Editor shows the complete 25 stored rows. Runtime playback continues
      // to use dataset.cycleLength for the logical unique-cycle loop.
      const editorPayload = cloneValue(payload);
      templateEditor = { spec: cloneValue(spec), payload: editorPayload };
      templateEditorDirty = false;
      closePrepare();

      const datasetPlayers = Array.isArray(payload.dataset.players) && payload.dataset.players.length
        ? payload.dataset.players.map(baseName)
        : Array.from({length: spec.playerCount}, function(_, i) { return 'Offline Player ' + (i + 1); });
      schedulerState.activeplayers = datasetPlayers.slice();
      // Shared offline templates intentionally store only anonymous roster metadata.
      // Older/current library rows may not include the live-session `active` flag.
      // The normal Dashboard treats missing `active` as inactive, so normalize only
      // the Template Editor roster here. Normal Round Mode data/state is untouched.
      const templatePlayerSet = new Set(datasetPlayers);
      schedulerState.allPlayers = Array.isArray(payload.dataset.allPlayers) && payload.dataset.allPlayers.length
        ? cloneValue(payload.dataset.allPlayers).map(function(player) {
            const name = baseName(player && player.name);
            return Object.assign({}, player, {
              name: name,
              active: templatePlayerSet.has(name)
            });
          })
        : datasetPlayers.map(function(name) { return { name:name, active:true, rating:1 }; });
      schedulerState.fixedPairs = cloneValue(payload.dataset.fixedPairs || []);
      if (typeof initSchedulerState === 'function') {
        initSchedulerState(schedulerState, spec.courtCount, {
          formats: Array(spec.courtCount).fill('doubles'),
          types: Array(spec.courtCount).fill('free')
        });
      }
      schedulerState.gameGenerationMode = spec.algorithm;
      schedulerState.standardGamesMode = spec.algorithm === 'standard';
      schedulerState.balancedGamesMode = spec.algorithm === 'balanced';
      schedulerState.uniqueGamesMode = spec.algorithm === 'standard' && !!spec.uniquePairMode;

      allRounds.length = 0;
      templateEditor.payload.records.forEach(function(record, index) {
        const round = cloneValue(record.round);
        round.round = index + 1;
        allRounds.push(round);
      });
      currentRoundIndex = 0;
      currentState = 'idle';
      sessionFinished = false;
      if (typeof _lastRenderedRoundIndex !== 'undefined') _lastRenderedRoundIndex = -1;

      if (typeof homeHideScreen === 'function') homeHideScreen();
      document.querySelectorAll('.page').forEach(function(page) { page.style.display = 'none'; });
      const roundsPage = document.getElementById('roundsPage');
      if (roundsPage) {
        roundsPage.style.display = 'block';
        roundsPage.classList.remove('active-mode');
      }
      document.querySelectorAll('.home-topbar, .top-bar').forEach(function(bar) { bar.style.display = 'none'; });

      const live = document.getElementById('sessionLiveBar');
      if (live) {
        live.style.display = 'flex';
        live.classList.add('template-edit-live');
        const liveText = live.querySelector('.rtb-live-txt');
        if (liveText) liveText.textContent = 'EDIT';
      }
      const end = document.getElementById('endBtn');
      if (end) {
        end.textContent = 'Save';
        end.disabled = false;
        end.setAttribute('onclick', 'SCSOfflineRounds.saveTemplateChanges()');
        if (!document.getElementById('templateEditorCloseBtn')) {
          const close = document.createElement('button');
          close.id = 'templateEditorCloseBtn';
          close.className = 'rtb-end template-editor-close';
          close.textContent = 'Close';
          close.setAttribute('onclick', 'SCSOfflineRounds.closeTemplateEditor()');
          end.insertAdjacentElement('afterend', close);
        }
      }
      const dice = document.getElementById('roundShufle');
      if (dice) dice.disabled = false;
      const minus = document.getElementById('courtMinus');
      const plus = document.getElementById('courtPlus');
      if (minus) minus.disabled = true;
      if (plus) plus.disabled = true;
      const titleCard = document.querySelector('#roundsPage .title-card');
      if (titleCard && !document.getElementById('templateEditorRoundActions')) {
        const actions = document.createElement('div');
        actions.id = 'templateEditorRoundActions';
        actions.className = 'template-editor-round-actions';
        actions.innerHTML = '<button type="button" onclick="SCSOfflineRounds.templateEditorBalanceOpponents()" aria-label="Balance opponents">Balance Opponents</button>' +
          '<button type="button" onclick="SCSOfflineRounds.templateEditorDeleteRound()" aria-label="Delete current round">− Round</button>' +
          '<button type="button" onclick="SCSOfflineRounds.templateEditorAddRound()" aria-label="Add round">+ Round</button>';
        titleCard.appendChild(actions);
      }
      const stop = document.getElementById('stopRoundBtn');
      if (stop) stop.style.display = 'none';

      showRound(0);
      templateEditorNextRound(true);
    } catch (error) {
      console.error('Rounds Template open failed:', error);
      templateEditor = null;
      restoreTemplateEditorState();
      alert('Could not open Rounds Template.\n' + (error && error.message ? error.message : error));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function ensureTemplateDashboard() {
    if (!templateEditor || !allRounds.length) return;
    const panel = document.getElementById('resting-panel');
    if (!panel || panel.querySelector('.player-history-group')) return;
    if (typeof renderPlayerHistoryGroup !== 'function') return;
    const data = allRounds[currentRoundIndex];
    if (!data) return;
    const historyGroup = renderPlayerHistoryGroup(data, currentRoundIndex);
    if (historyGroup) panel.appendChild(historyGroup);
  }

  function templateEditorNextRound(renderOnly) {
    if (!templateEditor || !allRounds.length) return;
    if (!renderOnly && currentRoundIndex < allRounds.length - 1) {
      currentRoundIndex += 1;
      if (typeof _lastRenderedRoundIndex !== 'undefined') _lastRenderedRoundIndex = -1;
      showRound(currentRoundIndex);
    }
    // Template edit mode keeps the normal Dashboard with Round History and
    // Pairing History. Re-add it only if another render path removed it.
    ensureTemplateDashboard();
    const next = document.getElementById('nextBtn');
    const text = document.getElementById('btnText');
    const icon = next ? next.querySelector('.icon') : null;
    if (text) text.textContent = currentRoundIndex < allRounds.length - 1 ? 'Next Round' : 'Last Round';
    if (icon) icon.textContent = currentRoundIndex < allRounds.length - 1 ? '  ›' : ' ✓';
    if (next) next.disabled = currentRoundIndex >= allRounds.length - 1;
  }

  function templateEditorShuffleRound() {
    if (!templateEditor || !allRounds.length) return;
    const round = cloneValue(allRounds[currentRoundIndex]);
    const games = Array.isArray(round.games) ? round.games : [];
    const players = [];
    games.forEach(function(game) {
      (game.pair1 || []).forEach(function(name) { players.push(name); });
      (game.pair2 || []).forEach(function(name) { players.push(name); });
    });
    for (let i = players.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = players[i]; players[i] = players[j]; players[j] = tmp;
    }
    let offset = 0;
    games.forEach(function(game) {
      const pairSize = String(game.format || 'doubles') === 'singles' ? 1 : 2;
      game.pair1 = players.slice(offset, offset + pairSize); offset += pairSize;
      game.pair2 = players.slice(offset, offset + pairSize); offset += pairSize;
    });
    allRounds[currentRoundIndex] = round;
    templateEditorDirty = true;
    if (typeof _lastRenderedRoundIndex !== 'undefined') _lastRenderedRoundIndex = -1;
    showRound(currentRoundIndex);
    templateEditorNextRound(true);
  }

  function templateEditorBalanceOpponents() {
    if (!templateEditor || !allRounds.length) return;
    const roundTeams = allRounds.map(function(round) {
      const teams = [];
      (Array.isArray(round.games) ? round.games : []).forEach(function(game) {
        if (Array.isArray(game.pair1) && game.pair1.length) teams.push(cloneValue(game.pair1));
        if (Array.isArray(game.pair2) && game.pair2.length) teams.push(cloneValue(game.pair2));
      });
      return teams;
    });
    if (roundTeams.some(function(teams) { return teams.length !== 6; })) {
      alert('Balance Opponents currently requires exactly 3 courts in every round.');
      return;
    }

    const names = [];
    const nameIndex = new Map();
    roundTeams.forEach(function(teams) {
      teams.forEach(function(team) {
        team.forEach(function(name) {
          const key = baseName(name);
          if (!nameIndex.has(key)) {
            nameIndex.set(key, names.length);
            names.push(key);
          }
        });
      });
    });
    const relationshipIndexes = new Map();
    let relationshipCount = 0;
    for (let a = 0; a < names.length; a++) {
      for (let b = a + 1; b < names.length; b++) relationshipIndexes.set(a + ':' + b, relationshipCount++);
    }
    function relationshipIndex(left, right) {
      const a = nameIndex.get(baseName(left));
      const b = nameIndex.get(baseName(right));
      return relationshipIndexes.get(Math.min(a, b) + ':' + Math.max(a, b));
    }
    function buildMatchings(items) {
      if (!items.length) return [[]];
      const first = items[0];
      const out = [];
      for (let i = 1; i < items.length; i++) {
        const rest = items.slice(1, i).concat(items.slice(i + 1));
        buildMatchings(rest).forEach(function(matching) { out.push([[first, items[i]]].concat(matching)); });
      }
      return out;
    }
    const matchings = buildMatchings([0, 1, 2, 3, 4, 5]);
    const contributions = roundTeams.map(function(teams) {
      return matchings.map(function(matching) {
        const list = [];
        matching.forEach(function(teamPair) {
          teams[teamPair[0]].forEach(function(left) {
            teams[teamPair[1]].forEach(function(right) {
              const index = relationshipIndex(left, right);
              if (typeof index === 'number') list.push(index);
            });
          });
        });
        return list;
      });
    });
    const encounterTotal = contributions.reduce(function(total, round) { return total + round[0].length; }, 0);
    const average = relationshipCount ? encounterTotal / relationshipCount : 0;
    const minimum = Math.floor(average);
    const maximum = Math.ceil(average);
    function penalty(value) {
      if (value < minimum) return Math.pow(minimum - value, 2);
      if (value > maximum) return Math.pow(value - maximum, 2);
      return 0;
    }
    let seed = 1002;
    function random() {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    }
    let best = null;
    for (let restart = 0; restart < 1600; restart++) {
      const state = contributions.map(function() { return Math.floor(random() * matchings.length); });
      const counts = new Int16Array(relationshipCount);
      contributions.forEach(function(round, roundIndex) {
        round[state[roundIndex]].forEach(function(index) { counts[index] += 1; });
      });
      for (let pass = 0; pass < 36; pass++) {
        let changed = false;
        for (let step = 0; step < state.length; step++) {
          const roundIndex = (step + Math.floor(random() * state.length)) % state.length;
          const oldChoice = state[roundIndex];
          contributions[roundIndex][oldChoice].forEach(function(index) { counts[index] -= 1; });
          let bestChoice = oldChoice;
          let bestDelta = Infinity;
          for (let choice = 0; choice < matchings.length; choice++) {
            let delta = 0;
            contributions[roundIndex][choice].forEach(function(index) {
              delta += penalty(counts[index] + 1) - penalty(counts[index]);
            });
            if (delta < bestDelta || (delta === bestDelta && random() < 0.05)) {
              bestDelta = delta;
              bestChoice = choice;
            }
          }
          contributions[roundIndex][bestChoice].forEach(function(index) { counts[index] += 1; });
          if (bestChoice !== oldChoice) {
            state[roundIndex] = bestChoice;
            changed = true;
          }
        }
        if (!changed) break;
      }
      const score = Array.from(counts).reduce(function(total, count) { return total + penalty(count); }, 0);
      if (!best || score < best.score) best = { score: score, state: state.slice(), counts: Array.from(counts) };
      if (score === 0) break;
    }

    allRounds.forEach(function(round, roundIndex) {
      const games = Array.isArray(round.games) ? round.games : [];
      const teams = roundTeams[roundIndex];
      matchings[best.state[roundIndex]].forEach(function(teamPair, gameIndex) {
        if (!games[gameIndex]) return;
        games[gameIndex].pair1 = cloneValue(teams[teamPair[0]]);
        games[gameIndex].pair2 = cloneValue(teams[teamPair[1]]);
      });
    });
    templateEditorDirty = true;
    if (typeof _lastRenderedRoundIndex !== 'undefined') _lastRenderedRoundIndex = -1;
    showRound(currentRoundIndex);
    templateEditorNextRound(true);
    const distribution = best.counts.reduce(function(out, count) {
      out[count] = (out[count] || 0) + 1;
      return out;
    }, {});
    const summary = Object.keys(distribution).sort(function(a, b) { return Number(a) - Number(b); }).map(function(count) {
      return distribution[count] + ' pairs met ' + count + ' times';
    }).join(', ');
    if (typeof showToast === 'function') showToast('Opponents balanced: ' + summary + '. Review, then Save.');
  }

  function templateEditorAddRound() {
    if (!templateEditor || !allRounds.length) return;
    const source = cloneValue(allRounds[currentRoundIndex]);
    allRounds.splice(currentRoundIndex + 1, 0, source);
    allRounds.forEach(function(round, index) { round.round = index + 1; });
    currentRoundIndex += 1;
    templateEditorDirty = true;
    templateEditorShuffleRound();
  }

  function templateEditorDeleteRound() {
    if (!templateEditor || !allRounds.length) return;
    if (allRounds.length <= 1) { alert('A template must contain at least one round.'); return; }
    if (!confirm('Delete Round ' + (currentRoundIndex + 1) + '?')) return;
    allRounds.splice(currentRoundIndex, 1);
    allRounds.forEach(function(round, index) { round.round = index + 1; });
    currentRoundIndex = Math.min(currentRoundIndex, allRounds.length - 1);
    templateEditorDirty = true;
    if (typeof _lastRenderedRoundIndex !== 'undefined') _lastRenderedRoundIndex = -1;
    showRound(currentRoundIndex);
    templateEditorNextRound(true);
  }

  function closeTemplateEditor() {
    if (!templateEditor) return;
    if (templateEditorDirty && !confirm('Close without saving your template changes?')) return;
    templateEditor = null;
    templateEditorDirty = false;
    restoreTemplateEditorUi();
    restoreTemplateEditorState();
    setPrepareSheetMode('offline');
    if (typeof showHomeScreen === 'function') showHomeScreen();
  }

  async function persistTemplateEditor(closeAfter) {
    if (!templateEditor) return;
    if (!navigator.onLine) {
      alert('Internet is required to save the Rounds Template.');
      return;
    }
    const end = document.getElementById('endBtn');
    if (end) { end.disabled = true; end.textContent = 'Saving…'; }
    try {
      const spec = cloneValue(templateEditor.spec);
      const original = cloneValue(templateEditor.payload);
      const records = allRounds.map(function(round, index) {
        const source = original.records[index] || original.records[index % Math.max(1, original.records.length)] || {};
        const out = cloneValue(source);
        out.sequence = index + 1;
        out.round = cloneValue(round);
        out.round.round = index + 1;
        return out;
      });
      const dataset = Object.assign({}, cloneValue(original.dataset), {
        count: records.length,
        cycleLength: Math.max(1, Math.min(records.length, Number(original.dataset && original.dataset.cycleLength) || records.length)),
        isUniqueCycleTemplate: true,
        numCourts: spec.courtCount,
        algorithm: spec.algorithm,
        gameType: spec.gameType,
        randomOrder: spec.randomOrder,
        fixedPairs: cloneValue(original.dataset.fixedPairs || [])
      });
      const ok = await storeOfflineLibrary(spec, dataset, records);
      if (!ok) throw new Error('Could not write the template to the shared database.');

      templateEditorDirty = false;
      templateEditor.payload = Object.assign({}, original, { dataset: cloneValue(dataset), records: cloneValue(records) });
      if (end) { end.disabled = false; end.textContent = 'Save'; }
      if (closeAfter) {
        templateEditor = null;
        restoreTemplateEditorUi();
        restoreTemplateEditorState();
        setPrepareSheetMode('offline');
        if (typeof showHomeScreen === 'function') showHomeScreen();
      }
      if (typeof showToast === 'function') showToast('Rounds Template saved.');
      else alert('Rounds Template saved.');
    } catch (error) {
      console.error('Rounds Template save failed:', error);
      alert('Could not save Rounds Template.\n' + (error && error.message ? error.message : error));
      if (end) { end.disabled = false; end.textContent = 'Save'; }
    }
  }

  async function saveTemplateChanges() { await persistTemplateEditor(false); }
  async function saveTemplateAndClose() { await persistTemplateEditor(true); }

  function openPrepare() {
    setPrepareSheetMode('offline');
    if (hasSessionInProgress()) return;
    const details = document.getElementById('offlinePreparedDetails');
    const summary = document.getElementById('offlinePreparedSummary');
    if (details) details.hidden = false;
    if (summary) summary.setAttribute('aria-expanded', 'true');

    const overlay = document.getElementById('offlinePrepareOverlay');
    if (!overlay) return;
    overlay.hidden = false;
    refreshAutoRequirements();
  }

  function closePrepare() {
    const overlay = document.getElementById('offlinePrepareOverlay');
    if (overlay) overlay.hidden = true;
  }

  function injectUi() {
    // A locally saved Round iMode session survives an app close. Restore its
    // mode lock before the first resume/start-label refresh.
    if (hasSessionInProgress()) activate();
    const btn = document.getElementById('prepareOfflineRoundsBtn');
    if (btn && !btn.dataset.offlineBound) {
      btn.dataset.offlineBound = '1';
      btn.addEventListener('click', async function () {
        if (templatePickerMode) {
          if (btn.dataset.templateAction === 'create') {
            const rounds = document.getElementById('offlineRoundsCount');
            const courts = document.getElementById('offlineCourtsCount');
            await prepare(rounds ? rounds.value : 30, courts ? courts.value : 2);
            setPrepareSheetMode('template', 'edit');
            const overlay = document.getElementById('offlinePrepareOverlay');
            if (overlay) overlay.hidden = false;
            await refreshLibraryMatchFromControls();
          } else {
            await openTemplateEditorFromControls();
          }
          return;
        }
        const rounds = document.getElementById('offlineRoundsCount');
        const courts = document.getElementById('offlineCourtsCount');
        await prepare(rounds ? rounds.value : 30, courts ? courts.value : 1);
        await refreshStatus();
      });
    }
    const playerCountInput = document.getElementById('offlinePreparePlayers');
    if (playerCountInput && !playerCountInput.dataset.offlineBound) {
      playerCountInput.dataset.offlineBound = '1';
      playerCountInput.addEventListener('input', function() { syncLinkedCountsAfterPlayerChange(); refreshPrepareCourtLimit(); refreshLibraryMatchFromControls(); });
      playerCountInput.addEventListener('change', function() {
        playerCountInput.value = String(requestedPreparePlayerCount());
        syncLinkedCountsAfterPlayerChange();
        if (getAlgorithm() === 'balanced') persistBalancedCounts();
        refreshPrepareCourtLimit();
        refreshLibraryMatchFromControls();
      });
    }
    ['offlinePrepareMen','offlinePrepareWomen'].forEach(function(id) {
      const input = document.getElementById(id);
      if (input && !input.dataset.offlineBound) {
        input.dataset.offlineBound = '1';
        input.addEventListener('input', function() { syncLinkedPrepareCounts(id); refreshPrepareCourtLimit(); refreshLibraryMatchFromControls(); });
        input.addEventListener('change', function() { syncLinkedPrepareCounts(id); refreshPrepareCourtLimit(); refreshLibraryMatchFromControls(); });
      }
    });
    ['offlinePrepareTopRated','offlinePrepareBottomRated'].forEach(function(id) {
      const input = document.getElementById(id);
      if (input && !input.dataset.offlineBound) {
        input.dataset.offlineBound = '1';
        input.addEventListener('input', function() { syncLinkedPrepareCounts(id); persistBalancedCounts(); validatePrepareInputs(true); refreshLibraryMatchFromControls(); });
        input.addEventListener('change', function() { syncLinkedPrepareCounts(id); persistBalancedCounts(); validatePrepareInputs(true); refreshLibraryMatchFromControls(); });
      }
    });
    const prepareCourts = document.getElementById('offlineCourtsCount');
    if (prepareCourts && !prepareCourts.dataset.validationBound) {
      prepareCourts.dataset.validationBound = '1';
      prepareCourts.addEventListener('change', function() { refreshPrepareCourtLimit(); validatePrepareInputs(true); refreshLibraryMatchFromControls(); });
    }
    const prepareRounds = document.getElementById('offlineRoundsCount');
    if (prepareRounds && !prepareRounds.dataset.libraryBound) {
      prepareRounds.dataset.libraryBound = '1';
      prepareRounds.addEventListener('change', refreshLibraryMatchFromControls);
    }
    const overlay = document.getElementById('offlinePrepareOverlay');
    if (overlay && !overlay.dataset.offlineBound) {
      overlay.dataset.offlineBound = '1';
      overlay.addEventListener('click', function(event) {
        if (event.target === overlay) closePrepare();
      });
    }
    refreshControls();
    refreshStatus();
    refreshStartLabel();

    // Keep iMode source/status in sync when connectivity changes. Online uses
    // the user's online preference (default OFF); offline automatically uses
    // prepared templates when available.
    if (!window.__scsIModeConnectivityBound) {
      window.__scsIModeConnectivityBound = true;
      const refreshConnectivityMode = function() {
        if (hasSessionInProgress()) return;
        refreshControls();
        refreshOfflineStartAvailability();
        refreshStartLabel();
      };
      window.addEventListener('online', refreshConnectivityMode);
      window.addEventListener('offline', refreshConnectivityMode);
    }
  }

  window.SCSOfflineRounds = {
    prepare, pickRound, refreshStatus, refreshControls, setAlgorithm, setGameType, setRandomOrder, setOfflineUniquePairMode, setFixedPairCount, adjustPrepareCourts,
    setWinner, setCourtCount, adjustCourtCount, getUseTemplates, setUseTemplates, canManageTemplatesForSelectedClub, selectDataset, deleteSelectedDataset, togglePreparedDetails, mapOfflinePlayers, refreshOfflineStartAvailability, refreshStartLabel, start, resetSession, endSession, isActive, isIModeActive, isTemplateSessionActive, activate, deactivate, hasSessionInProgress, noteGenerationSource, openPrepare, closePrepare,
    openTemplateEditorPicker, openTemplateCreatePicker, openTemplateEditPicker, closeTemplateActions, overwriteExistingTemplate, deleteExistingTemplate, isTemplateEditorActive, markTemplateDirty, templateEditorNextRound,
    templateEditorShuffleRound, templateEditorBalanceOpponents, templateEditorAddRound, templateEditorDeleteRound, saveTemplateChanges, saveTemplateAndClose, closeTemplateEditor
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectUi);
  else injectUi();
})();
