/* ============================================================
   GAMES -- Round rendering, win marking, player swaps
   File: games.js
   ============================================================ */

let roundActive = false;

let currentState = "idle";
let roundTimerInterval = null;

function formatRoundDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.floor((Number(durationMs) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = value => String(value).padStart(2, '0');
  return hours > 0
    ? hours + ':' + pad(minutes) + ':' + pad(seconds)
    : pad(minutes) + ':' + pad(seconds);
}

function updateRoundTimerDisplay() {
  const display = document.getElementById('roundElapsedTime');
  const round = Array.isArray(allRounds) ? allRounds[currentRoundIndex] : null;
  if (!display) return;
  let elapsedMs = Number(round && round.durationMs) || 0;
  if (currentState === 'active' && round && round.startedAt) {
    elapsedMs = Math.max(0, Date.now() - Number(round.startedAt));
  }
  display.textContent = formatRoundDuration(elapsedMs);
}

function startRoundTimer() {
  const round = Array.isArray(allRounds) ? allRounds[currentRoundIndex] : null;
  if (!round) return;
  if (!round.startedAt) round.startedAt = Date.now();
  round.durationMs = 0;
  delete round.endedAt;
  clearInterval(roundTimerInterval);
  updateRoundTimerDisplay();
  roundTimerInterval = setInterval(updateRoundTimerDisplay, 1000);
}

function stopRoundTimer(reset) {
  clearInterval(roundTimerInterval);
  roundTimerInterval = null;
  const round = Array.isArray(allRounds) ? allRounds[currentRoundIndex] : null;
  if (!round) {
    updateRoundTimerDisplay();
    return;
  }
  if (reset) {
    delete round.startedAt;
    delete round.endedAt;
    delete round.durationMs;
  } else if (round.startedAt) {
    round.durationMs = Math.max(0, Date.now() - Number(round.startedAt));
    round.endedAt = Date.now();
  }
  updateRoundTimerDisplay();
}

function resumeRoundTimer() {
  clearInterval(roundTimerInterval);
  roundTimerInterval = null;
  updateRoundTimerDisplay();
  const round = Array.isArray(allRounds) ? allRounds[currentRoundIndex] : null;
  if (currentState === 'active' && round && round.startedAt) {
    roundTimerInterval = setInterval(updateRoundTimerDisplay, 1000);
  }
}
const statusEl = document.getElementById("statusDisplay");
const textEl = document.getElementById("btnText");
const btn = document.getElementById("nextBtn");
const icon = btn.querySelector(".icon");
const roundStates = {
  idle: {
    key: "nround",
    icon: "▶",
    class: ""
  },
  active: {
    key: "endrounds",
    icon: "▶",
    class: ""
  },
  done: {
    key: "endSession",
    icon: "⏹",
    class: "end"
  }
};
function getPairKey(a, b) {
  if (!a || !b) return null; // invalid pair -- no key
  return [a, b].sort().join("|");
}

// Returns true if [a,b] is a configured fixed pair (order-independent)
function isFixedPair(a, b) {
  const fixedPairs = (schedulerState && schedulerState.fixedPairs) || [];
  const baseA = a ? a.split('#')[0] : a;
  const baseB = b ? b.split('#')[0] : b;
  return fixedPairs.some(([x, y]) =>
    (x === baseA && y === baseB) || (x === baseB && y === baseA)
  );
}

// Game identity must be based on PAIR vs PAIR (not 4 flattened players)
function getGameKey(pair1Key, pair2Key) {
  return [pair1Key, pair2Key].sort().join("|");
}

/* ============================================================
   SWAP STATE — single source of truth for player & team swap
   ============================================================ */
const TAP_THRESHOLD = 8; // px — uniform across all tap handlers

const SwapState = (() => {
  let _player = null;
  let _team   = null;

  function _haptic(style) {
    try {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'haptic', style }));
      } else if (navigator.vibrate) {
        navigator.vibrate(style === 'heavy' ? 30 : style === 'medium' ? 15 : 8);
      }
    } catch (_) {}
  }

  function _clearHighlights() {
    document.querySelectorAll('.selected, .selected-team')
      .forEach(el => el.classList.remove('selected', 'selected-team'));
  }

  return {
    get player() { return _player; },
    get team()   { return _team;   },

    selectPlayer(info, el) {
      if (_team) { _clearHighlights(); _team = null; }
      const isSame = _player &&
        _player.playerName === info.playerName &&
        _player.from === info.from &&
        _player.gameIndex === info.gameIndex &&
        _player.playerIndex === info.playerIndex;
      if (isSame) {
        _player = null; _clearHighlights(); _haptic('light'); return 'deselect';
      }
      _clearHighlights();
      _player = info;
      el && el.classList.add('selected');
      _haptic('light');
      return 'select';
    },

    selectTeam(info, el) {
      if (_player) { _clearHighlights(); _player = null; }
      const isSame = _team &&
        _team.teamSide === info.teamSide &&
        _team.gameIndex === info.gameIndex;
      if (isSame) {
        _team = null; _clearHighlights(); _haptic('light'); return 'deselect';
      }
      _clearHighlights();
      _team = info;
      el && el.classList.add('selected-team');
      _haptic('light');
      return 'select';
    },

    commitPlayer() {
      _player = null;
      _clearHighlights();
      _haptic('medium');
      // Guard: block teamDiv touch events that fire on the same touch sequence
      // as the player swap (iOS fires touchstart/end on newly mounted DOM nodes
      // that appear under the finger during the same touch sequence)
      SwapState._touchGuardUntil = Date.now() + 350;
    },
    commitTeam() { _team = null; _clearHighlights(); _haptic('heavy'); },

    // True if we're inside the post-player-swap touch guard window
    get touchGuarded() { return Date.now() < (SwapState._touchGuardUntil || 0); },

    clear() { _player = null; _team = null; _clearHighlights(); }
  };
})();

const repetitionHistory = {
  pairSet: new Set(),
  gameSet: new Set(),
  builtUntilRound: -1
};

function updatePreviousHistory(currentRoundIndex) {

  // Safety reset (if reset/back navigation happens)
  if (repetitionHistory.builtUntilRound >= currentRoundIndex - 1) {
    repetitionHistory.pairSet.clear();
    repetitionHistory.gameSet.clear();
    repetitionHistory.builtUntilRound = -1;
  }

  // Build only missing rounds
  for (
    let i = repetitionHistory.builtUntilRound + 1;
    i < currentRoundIndex;
    i++
  ) {

    const round = allRounds[i];
    if (!round?.games) continue;

    for (const game of round.games) {

      const t1 = game.pair1;
      const t2 = game.pair2;

      if (!t1 || !t2) continue;

      const pair1Key = getPairKey(t1[0], t1[1]);
      const pair2Key = getPairKey(t2[0], t2[1]);

      // Store pair history
      repetitionHistory.pairSet.add(pair1Key);
      repetitionHistory.pairSet.add(pair2Key);

      // Store exact game history (pair vs pair)
      const gameKey = getGameKey(pair1Key, pair2Key);
      repetitionHistory.gameSet.add(gameKey);
    }
  }

  repetitionHistory.builtUntilRound = currentRoundIndex - 1;
}

function isPairRepeated(pair) {
  if (!pair) return false;

  const pairKey = getPairKey(pair[0], pair[1]);
  return repetitionHistory.pairSet.has(pairKey);
}

function isGameRepeated(game) {
  if (!game?.pair1 || !game?.pair2) return false;

  const pair1Key = getPairKey(game.pair1[0], game.pair1[1]);
  const pair2Key = getPairKey(game.pair2[0], game.pair2[1]);

  const gameKey = getGameKey(pair1Key, pair2Key);

  return repetitionHistory.gameSet.has(gameKey);
}





async function toggleRound() {
  // Rounds Template editor uses the exact existing Round page and swap logic,
  // but never starts/commits a live round or runs the generator.
  if (window.SCSOfflineRounds && typeof window.SCSOfflineRounds.isTemplateEditorActive === 'function' && window.SCSOfflineRounds.isTemplateEditorActive()) {
    window.SCSOfflineRounds.templateEditorNextRound();
    return;
  }

  const btn    = document.getElementById("nextBtn");
  const textEl = document.getElementById("btnText");
  const icon   = btn.querySelector(".icon");

  if (currentState === "idle") {
    // ── ENTER ACTIVE MODE (Start / begin round) ──
    // Lock removed — always unlocked

    currentState = "active";
    startRoundTimer();
    // Register the database session at the moment play actually starts. Round
    // generation can happen earlier while manager club restoration is still
    // settling, which previously left the UI LIVE without a server record.
    // Round iMode can use prepared generation while the match itself is still
    // live. Register every started round so Admin can monitor it; iMode keeps
    // its existing deferred rating/final-result sync on End.
    if (typeof ensureLiveSession === 'function') {
      await ensureLiveSession();
    }
    // Round 1 is now committed to play. Never allow setup/randomization
    // regeneration to reopen while this round is later advanced to Round 2.
    if (typeof closeRoundOneProposal === 'function') closeRoundOneProposal();

    // Disable everything except nextBtn, endBtn, win-cup and team divs (for winner marking by touch)
    document.querySelectorAll(
      "button, .player-btn, .mode-card, .lock-icon, .swap-icon, .menu-btn"
    ).forEach(el => {
      const keep = el.id === "nextBtn" || el.id === "endBtn" || el.id === "stopRoundBtn" || el.classList.contains("win-cup");
      if (!keep) {
        el.style.pointerEvents = "none";
        el.classList.add("disabled");
      }
    });

    // Re-enable team divs so tapping a team marks the winner
    document.querySelectorAll(".team").forEach(el => {
      el.style.pointerEvents = "auto";
    });

    // Show win cups only in competitive mode
    const _isComp = getPlayMode() === 'competitive';
    document.querySelectorAll(".win-cup").forEach(cup => {
      cup.style.display       = _isComp ? ''        : 'none';
      cup.style.visibility    = _isComp ? "visible"  : "hidden";
      cup.style.pointerEvents = _isComp ? "auto"     : "none";
      if (_isComp) cup.classList.add("blinking");
    });

    document.getElementById("roundsPage").classList.add("active-mode");
    _syncModeBanner();
    _syncShuffleBtn(); // disable shuffle while round is active
    if (typeof saveSnapshot === 'function') saveSnapshot();

  } else if (currentState === "active") {
    // ── RETURN TO IDLE MODE (advance round) ──

    // Require all winners marked -- competitive mode only
    const currentRoundGames = allRounds[currentRoundIndex] ? allRounds[currentRoundIndex].games : [];
    const winnersCount = currentRoundGames.filter(g => g.winner).length;
    const requireWinners = (typeof getPlayMode === 'function') && getPlayMode() === 'competitive';
    if (requireWinners && (!currentRoundGames.length || winnersCount !== currentRoundGames.length)) {
      // Shake all unmarked trophy cups
      currentRoundGames.forEach(function(g, idx) {
        if (!g.winner) {
          document.querySelectorAll('.win-cup').forEach(function(cup, ci) {
            if (ci === idx * 2 || ci === idx * 2 + 1) {
              cup.classList.remove('cup-shake');
              void cup.offsetWidth; // reflow to restart animation
              cup.classList.add('cup-shake');
              cup.style.filter = 'sepia(1) saturate(5) hue-rotate(300deg)';
              setTimeout(() => {
                cup.classList.remove('cup-shake');
                cup.style.filter = '';
              }, 800);
            }
          });
        }
      });
      // Toast message
      const existing = document.getElementById('winnerToast');
      if (existing) existing.remove();
      const toast = document.createElement('div');
      toast.id = 'winnerToast';
      toast.textContent = '🏆 Pick a winner for each court first';
      toast.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:#e63757;color:#fff;padding:10px 20px;border-radius:20px;font-size:0.88rem;font-weight:700;z-index:9999;white-space:nowrap;animation:toastIn 0.3s ease;box-shadow:0 4px 16px rgba(230,55,87,0.4);';
      document.body.appendChild(toast);
      setTimeout(() => { toast.style.opacity='0'; toast.style.transition='opacity 0.4s'; setTimeout(()=>toast.remove(),400); }, 2000);
      return;
    }

    // Update rank points -- both modes
    updatePointsAfterRound(schedulerState);

    stopRoundTimer(false);
    currentState = "idle";
    let roundAdvanceError = null;
    try {
      await nextRound();
    } catch (error) {
      roundAdvanceError = error;
      console.error('Unable to advance round:', error);
    }
    document.getElementById("roundsPage").classList.remove("active-mode");

    // Re-enable everything even when generation fails, so the UI never becomes
    // trapped after one round.
    document.querySelectorAll(".disabled").forEach(el => {
      el.style.pointerEvents = "";
      el.classList.remove("disabled");
      if (el.classList.contains("menu-btn")) {
        el.onclick = function() { showPage("settingsPage", this); };
      }
    });

    // Clear team div pointer-events override (set during live mode)
    document.querySelectorAll(".team").forEach(el => {
      el.style.pointerEvents = "";
    });

    // Hide win cups
    document.querySelectorAll(".win-cup").forEach(cup => {
      cup.style.pointerEvents = "none";
      cup.style.visibility    = "hidden";
    });

    _syncModeBanner();
    _syncShuffleBtn();
    if (typeof saveSnapshot === 'function') saveSnapshot();
    if (typeof saveRoundsToDb === 'function') saveRoundsToDb(); // persist winners

    if (roundAdvanceError) {
      const message = roundAdvanceError && roundAdvanceError.message
        ? roundAdvanceError.message
        : 'Unable to generate the next round.';
      if (typeof showToast === 'function') showToast(message);
    }

  } else if (currentState === "done") {
    // done behaves same as idle -- just re-enter active
    currentState = "idle";
    toggleRound();
    return;
  }

  // Update button label
  if (currentState === "idle") {
    const isFirst = currentRoundIndex === 0;
    btn.classList.add("start-state");
    btn.classList.remove("end", "round-active");
    textEl.removeAttribute("data-i18n");
    textEl.textContent = isFirst ? (t("startGame") || "Start") : (t("playRound") || "Play Round");
    icon.textContent = isFirst ? " ▶" : " ▶";
  } else if (currentState === "active") {
    btn.classList.remove("start-state", "end");
    btn.classList.add("round-active");
    textEl.removeAttribute("data-i18n");
    textEl.textContent = t("nextRound") || "Next Round";
    icon.textContent = " ▶▶";
  }
}





function setStatus(status) {
  //statusEl.classList.remove("status-ready", "status-progress");

  /*if (status === t("readyGame")) {
    statusEl.dataset.i18n = "statusReady";
    statusEl.classList.add("status-ready");
  } else if (status === t("inProgressGame")) {
    statusEl.dataset.i18n = "statusProgress";
    statusEl.classList.add("status-progress");
  } 
*/

  // Re-apply translations so text updates immediately
  setLanguage(currentLang);
}



function getNextFixedPairGames(schedulerState, fixedPairs, numCourts) {
  const hash = JSON.stringify(fixedPairs);

  // 🔁 Initialize OR reset when queue is empty OR pairs changed
  if (
    !schedulerState.fixedPairGameQueue ||
    schedulerState.fixedPairGameQueue.length === 0 ||
    schedulerState.fixedPairGameQueueHash !== hash
  ) {
    schedulerState.fixedPairGameQueueHash = hash;
    schedulerState.fixedPairGameQueue = [];

    // Generate ALL unique games (pair vs pair)
    for (let i = 0; i < fixedPairs.length; i++) {
      for (let j = i + 1; j < fixedPairs.length; j++) {
        schedulerState.fixedPairGameQueue.push({
          pair1: fixedPairs[i],
          pair2: fixedPairs[j],
        });
      }
    }

    // Optional shuffle (recommended)
    schedulerState.fixedPairGameQueue = shuffle(
      schedulerState.fixedPairGameQueue
    );
  }

  const games = [];
  const usedPairs = new Set();
  const remainingGames = [];

  // 🎯 Select playable games, remove ONLY played ones
  for (const game of schedulerState.fixedPairGameQueue) {
    if (games.length >= numCourts) {
      remainingGames.push(game);
      continue;
    }

    const k1 = game.pair1.join("&");
    const k2 = game.pair2.join("&");

    if (usedPairs.has(k1) || usedPairs.has(k2)) {
      // Not playable this round → keep it
      remainingGames.push(game);
      continue;
    }

    // ✅ Game is played → remove
    playername1 = "";
    playername2 = "";
    games.push({
      court: games.length + 1,
      pair1: [...game.pair1],
      pair2: [...game.pair2],
      winners: [playername1, playername2]
    });

    usedPairs.add(k1);
    usedPairs.add(k2);
  }

  // Update queue with unplayed games only
  schedulerState.fixedPairGameQueue = remainingGames;

  return games;
}


// AischedulerNextRound → defined in competitive_algorithm.js
// resetForCompetitivePhase → no longer needed


function getPlayingAndResting(state) {

  const totalPlayers = state.activeplayers.length;
  const playersPerRound = state.courts * 4;

  let resting = [];
  let playing = [];

  if (totalPlayers > playersPerRound) {
    const needRest = totalPlayers - playersPerRound;
    // Use existing restQueue order (same logic as RandomRound)
    resting = state.restQueue.slice(0, needRest);
  }

  const restSet = new Set(resting);
  playing = state.activeplayers.filter(p => !restSet.has(p));

  return { playing, resting };
}

function extractActiveFixedPairs(state, playing) {

  const activePairs = [];
  const lockedPlayers = new Set();

  for (const pair of state.fixedPairs || []) {
    const [a, b] = pair;

    if (playing.includes(a) && playing.includes(b)) {
      activePairs.push([a, b]);
      lockedPlayers.add(a);
      lockedPlayers.add(b);
    }
  }

  return { activePairs, lockedPlayers };
}

function groupByTier(state, players) {
  // Tier boundaries based on persistent player rating (master DB)
  // 1.0 - 2.0  → Weak
  // 2.1 - 3.5  → Intermediate
  // 3.6 - 5.0  → Strong

  const strong = [];
  const inter  = [];
  const weak   = [];

  for (const p of players) {
    const rating = (typeof getActiveRating === "function" ? getActiveRating(p) : getRating(p));
    if (rating >= 3.6)      strong.push(p);
    else if (rating >= 2.1) inter.push(p);
    else                    weak.push(p);
  }

  return { strong, inter, weak };
}

function buildBestTeam(state, pool) {

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {

      const p1 = pool[i];
      const p2 = pool[j];

      const key = getPairKey(p1, p2);

      if (!state.pairPlayedSet.has(key)) {
        return [p1, p2];
      }
    }
  }

  // fallback if no unique pair
  return [pool[0], pool[1]];
}

// OLD CompetitiveRound removed -- using competitive_algorithm.js instead

function updateAfterRound(state, games) {
  for (const game of games) {

    // Handle both [team1, team2] array format AND {pair1, pair2} object format
    const team1 = Array.isArray(game) ? game[0] : game.pair1;
    const team2 = Array.isArray(game) ? game[1] : game.pair2;

    if (!team1 || !team2) continue;

    const key1 = getPairKey(team1[0], team1[1]);
    const key2 = getPairKey(team2[0], team2[1]);

    state.pairPlayedSet.add(key1);
    state.pairPlayedSet.add(key2);

    // Update opponent map safely
    for (const p1 of team1) {
      for (const p2 of team2) {

        // Ensure maps exist before accessing
        if (!state.opponentMap.has(p1)) state.opponentMap.set(p1, new Map());
        if (!state.opponentMap.has(p2)) state.opponentMap.set(p2, new Map());

        state.opponentMap.get(p1).set(p2, (state.opponentMap.get(p1).get(p2) || 0) + 1);
        state.opponentMap.get(p2).set(p1, (state.opponentMap.get(p2).get(p1) || 0) + 1);
      }
    }
  }
}


function RandomRound(schedulerState) {
  const {
    activeplayers,
    numCourts,
    fixedPairs,
    restCount,
    opponentMap,
    lastRound,
  } = schedulerState;

  const totalPlayers = activeplayers.length;
  const numPlayersPerRound = numCourts * 4;
  const numResting = Math.max(totalPlayers - numPlayersPerRound, 0);

  const fixedPairPlayers = new Set(fixedPairs.flat());
  let freePlayers = activeplayers.filter(p => !fixedPairPlayers.has(p));

  let resting = [];
  let playing = [];

  // ================= REST SELECTION (UNCHANGED) =================
  if (fixedPairs.length > 0 && numResting >= 2) {
    let needed = numResting;
    const fixedMap = new Map();
    for (const [a, b] of fixedPairs) {
      fixedMap.set(a, b);
      fixedMap.set(b, a);
    }

    for (const p of schedulerState.restQueue) {
      if (resting.includes(p)) continue;

      const partner = fixedMap.get(p);
      if (partner) {
        if (needed >= 2) {
          resting.push(p, partner);
          needed -= 2;
        }
      } else if (needed > 0) {
        resting.push(p);
        needed -= 1;
      }

      if (needed <= 0) break;
    }

    playing = activeplayers.filter(p => !resting.includes(p));
  } else {
    const sortedPlayers = [...schedulerState.restQueue];
    resting = sortedPlayers.slice(0, numResting);
    playing = activeplayers
      .filter(p => !resting.includes(p))
      .slice(0, numPlayersPerRound);
  }

  // ================= PAIR PREP =================
  const playingSet = new Set(playing);
  let fixedPairsThisRound = [];
  for (const pair of fixedPairs) {
    if (playingSet.has(pair[0]) && playingSet.has(pair[1])) {
      fixedPairsThisRound.push([pair[0], pair[1]]);
    }
  }

  const fixedPairPlayersThisRound = new Set(fixedPairsThisRound.flat());
  let freePlayersThisRound = playing.filter(
    p => !fixedPairPlayersThisRound.has(p)
  );

  freePlayersThisRound = reorderFreePlayersByLastRound(
    freePlayersThisRound,
    lastRound,
    numCourts
  );

  // ================= ALL FIXED DETECTION =================
  const allFixed =
    freePlayersThisRound.length === 0 &&
    fixedPairs.length >= numCourts * 2;

  // ================= ALL FIXED (QUEUE-BASED ROUND ROBIN) =================
  if (allFixed) {
    const games = getNextFixedPairGames(
      schedulerState,
      fixedPairs,
      numCourts
    );

    const playingPlayers = new Set(
      games.flatMap(g => [...g.pair1, ...g.pair2])
    );

    resting = activeplayers.filter(p => !playingPlayers.has(p));
    playing = [...playingPlayers];

    schedulerState.roundIndex =
      (schedulerState.roundIndex || 0) + 1;

    return {
      round: schedulerState.roundIndex,
      resting: resting.map(p => {
        const c = restCount.get(p) || 0;
        return `${p}#${c + 1}`;
      }),
      playing,
      games,
    };
  }

  // ================= ORIGINAL FREE-PAIR LOGIC =================
  const requiredPairsCount = Math.floor(numPlayersPerRound / 2);
  let neededFreePairs =
    requiredPairsCount - fixedPairsThisRound.length;

  let selectedPairs = findDisjointPairs(
    freePlayersThisRound,
    schedulerState.pairPlayedSet,
    neededFreePairs,
    opponentMap
  );

  let finalFreePairs = selectedPairs || [];

  if (finalFreePairs.length < neededFreePairs) {
    const free = freePlayersThisRound.slice();
    const usedPlayers = new Set(finalFreePairs.flat());

    for (let i = 0; i < free.length; i++) {
      const a = free[i];
      if (usedPlayers.has(a)) continue;

      for (let j = i + 1; j < free.length; j++) {
        const b = free[j];
        if (usedPlayers.has(b)) continue;

        finalFreePairs.push([a, b]);
        usedPlayers.add(a);
        usedPlayers.add(b);
        break;
      }

      if (finalFreePairs.length >= neededFreePairs) break;
    }
  }

  let allPairs = fixedPairsThisRound.concat(finalFreePairs);
  allPairs = shuffle(allPairs);

  let matchupScores = getMatchupScores(allPairs, opponentMap);
  const games = [];
  const usedPairs = new Set();

  for (const match of matchupScores) {
    const { pair1, pair2 } = match;
    const p1Key = pair1.join("&");
    const p2Key = pair2.join("&");

    if (usedPairs.has(p1Key) || usedPairs.has(p2Key)) continue;

    games.push({
      court: games.length + 1,
      pair1: [...pair1],
      pair2: [...pair2],
    });

    usedPairs.add(p1Key);
    usedPairs.add(p2Key);

    if (games.length >= numCourts) break;
  }

  const restingWithNumber = resting.map(p => {
    const c = restCount.get(p) || 0;
    return `${p}#${c + 1}`;
  });

  schedulerState.roundIndex =
    (schedulerState.roundIndex || 0) + 1;

  return {
    round: schedulerState.roundIndex,
    resting: restingWithNumber,
    playing,
    games,
  };
}




// ==============================
// Generate next round (no global updates)
// ==============================
function betaAischedulerNextRound(schedulerState) {
  const {
    activeplayers,
    numCourts,
    fixedPairs,
    restCount,
    opponentMap,
    pairPlayedSet
  } = schedulerState;

  const totalPlayers = activeplayers.length;
  const playersPerRound = numCourts * 4;
  const numResting = Math.max(totalPlayers - playersPerRound, 0);

  /* ==========================
     1️⃣ RESTING / PLAYING
  ========================== */

  let resting = [];
  let playing = [];

  if (numResting > 0) {
    resting = schedulerState.restQueue.slice(0, numResting);
    playing = activeplayers.filter(p => !resting.includes(p));
  } else {
    playing = activeplayers.slice(0, playersPerRound);
  }

  /* ==========================
     2️⃣ FIXED PAIRS
  ========================== */

  const playingSet = new Set(playing);
  const fixedPairsThisRound = fixedPairs.filter(
    ([a, b]) => playingSet.has(a) && playingSet.has(b)
  );

  const fixedPlayers = new Set(fixedPairsThisRound.flat());
  let freePlayers = playing.filter(p => !fixedPlayers.has(p));

  const requiredPairs = playersPerRound / 2;
  const neededFreePairs = requiredPairs - fixedPairsThisRound.length;

  /* ==========================
     3️⃣ BEST FREE PAIRS
  ========================== */

  let freePairs =
    findDisjointPairs(
      freePlayers,
      pairPlayedSet,
      neededFreePairs,
      opponentMap
    ) || [];

  // fallback safety
  if (freePairs.length < neededFreePairs) {
    const used = new Set(freePairs.flat());
    for (let i = 0; i < freePlayers.length; i++) {
      for (let j = i + 1; j < freePlayers.length; j++) {
        const a = freePlayers[i], b = freePlayers[j];
        if (used.has(a) || used.has(b)) continue;
        freePairs.push([a, b]);
        used.add(a); used.add(b);
        if (freePairs.length === neededFreePairs) break;
      }
      if (freePairs.length === neededFreePairs) break;
    }
  }

  const allPairs = [...fixedPairsThisRound, ...freePairs];

  /* ==========================
     4️⃣ BEST COURT MATCHUPS
  ========================== */

  const matchupScores = getMatchupScores(allPairs, opponentMap);

  const games = [];
  const usedPairs = new Set();

  for (const m of matchupScores) {
    const k1 = m.pair1.join("&");
    const k2 = m.pair2.join("&");
    if (usedPairs.has(k1) || usedPairs.has(k2)) continue;

    games.push({
      court: games.length + 1,
      pair1: [...m.pair1],
      pair2: [...m.pair2]
    });

    usedPairs.add(k1);
    usedPairs.add(k2);

    if (games.length === numCourts) break;
  }

  /* ==========================
     5️⃣ REST DISPLAY
  ========================== */

  const restingWithCount = resting.map(p => {
    const cnt = restCount.get(p) || 0;
    return `${p}#${cnt + 1}`;
  });

  schedulerState.roundIndex = (schedulerState.roundIndex || 0) + 1;

  return {
    round: schedulerState.roundIndex,
    resting: restingWithCount,
    playing,
    games
  };
}



function backupAischedulerNextRound(schedulerState) {
  const {
    activeplayers,
    numCourts,
    fixedPairs,
    restCount,
    opponentMap,
  } = schedulerState;

  const totalPlayers = activeplayers.length;
  const numPlayersPerRound = numCourts * 4;
  const numResting = Math.max(totalPlayers - numPlayersPerRound, 0);

  // Separate fixed pairs and free players
  const fixedPairPlayers = new Set(fixedPairs.flat());
let freePlayers = activeplayers.filter(p => !fixedPairPlayers.has(p));

// ... top of function (resting and playing already declared as let)
let resting = [];
let playing = [];

// 1. Select resting and playing players
if (fixedPairs.length > 0 && numResting >= 2) {

  let needed = numResting;
  const fixedMap = new Map();
    for (const [a, b] of fixedPairs) {
      fixedMap.set(a, b);
      fixedMap.set(b, a); // Must include reverse
    }

  // Use only restQueue order
 for (const p of schedulerState.restQueue) {
  if (resting.includes(p)) continue;

  const partner = fixedMap.get(p);

  if (partner) {
    // Fixed pair rule -> only rest together
    if (needed >= 2) {
      resting.push(p, partner);
      needed -= 2;
    }
    // If not enough slots -> skip both completely
  } else {
    // Only rest free players
    if (needed > 0) {
      resting.push(p);
      needed -= 1;
    }
  }

  if (needed <= 0) break;
}



  // Playing = everyone else (NO redeclaration)
  playing = activeplayers.filter(p => !resting.includes(p));

} else {

      // Use restQueue order directly (no sorting)
    const sortedPlayers = [...schedulerState.restQueue];
    
    // Assign resting players
    resting = sortedPlayers.slice(0, numResting);
    
    // Assign playing players
    playing = activeplayers
      .filter(p => !resting.includes(p))
      .slice(0, numPlayersPerRound);
}


  // 2️⃣ Prepare pairs
  const playingSet = new Set(playing);
  let fixedPairsThisRound = [];
  for (const pair of fixedPairs) {
    if (playingSet.has(pair[0]) && playingSet.has(pair[1])) {
      fixedPairsThisRound.push([pair[0], pair[1]]);
    }
  }

  const fixedPairPlayersThisRound = new Set(fixedPairsThisRound.flat());
  let freePlayersThisRound = playing.filter(p => !fixedPairPlayersThisRound.has(p));
  freePlayersThisRound = reorderFreePlayersByLastRound(
  freePlayersThisRound,
  lastRound,
  numCourts
);
  const requiredPairsCount = Math.floor(numPlayersPerRound / 2);
  let neededFreePairs = requiredPairsCount - fixedPairsThisRound.length;
  //freePlayersThisRound = reorder1324(freePlayersThisRound);
  let selectedPairs = findDisjointPairs(freePlayersThisRound, schedulerState.pairPlayedSet, neededFreePairs, opponentMap);

  let finalFreePairs = selectedPairs || [];

  // Fallback pairing for leftovers
  if (finalFreePairs.length < neededFreePairs) {
    const free = freePlayersThisRound.slice();
    const usedPlayers = new Set(finalFreePairs.flat());
    for (let i = 0; i < free.length; i++) {
      const a = free[i];
      if (usedPlayers.has(a)) continue;
      for (let j = i + 1; j < free.length; j++) {
        const b = free[j];
        if (usedPlayers.has(b)) continue;
        finalFreePairs.push([a, b]);
        usedPlayers.add(a);
        usedPlayers.add(b);
        break;
      }
      if (finalFreePairs.length >= neededFreePairs) break;
    }
  }

  // 3️⃣ Combine all pairs and shuffle
  let allPairs = fixedPairsThisRound.concat(finalFreePairs);
  allPairs = shuffle(allPairs);

  // 4️⃣ Create games (courts) using matchupScores (no updates here)
  let matchupScores = getMatchupScores(allPairs, opponentMap);
  const games = [];
  const usedPairs = new Set();
  for (const match of matchupScores) {
    const { pair1, pair2 } = match;
    const p1Key = pair1.join("&");
    const p2Key = pair2.join("&");
    if (usedPairs.has(p1Key) || usedPairs.has(p2Key)) continue;
    games.push({ court: games.length + 1, pair1: [...pair1], pair2: [...pair2] });
    usedPairs.add(p1Key);
    usedPairs.add(p2Key);
    if (games.length >= numCourts) break;
  }

  // 5️⃣ Prepare resting display with +1 for current round
  const restingWithNumber = resting.map(p => {
    const currentRest = restCount.get(p) || 0;
    return `${p}#${currentRest + 1}`;
  });

 schedulerState.roundIndex = (schedulerState.roundIndex || 0) + 1;

return {
    round: schedulerState.roundIndex,
    resting: restingWithNumber,
    playing,
    games,
  };

  
}


function reorderFreePlayersByLastRound(
  freePlayersThisRound,
  lastRound,
  numCourts
) {
  if (numCourts <= 0 || freePlayersThisRound.length === 0) {
    return [...freePlayersThisRound];
  }

  const total = freePlayersThisRound.length;

  // per-court capacity
  const base = Math.floor(total / numCourts);
  const remainder = total % numCourts;

  // court capacities
  const capacities = Array.from(
    { length: numCourts },
    (_, i) => base + (i < remainder ? 1 : 0)
  );

  // split by last round
  const lastRoundSet = new Set(lastRound);
  const nonPlayed = [];
  const played = [];

  for (const p of freePlayersThisRound) {
    (lastRoundSet.has(p) ? played : nonPlayed).push(p);
  }

  // simulate court fill
  const courts = Array.from({ length: numCourts }, () => []);
  let c = 0;

  const distribute = (list) => {
    for (const p of list) {
      while (courts[c].length >= capacities[c]) {
        c = (c + 1) % numCourts;
      }
      courts[c].push(p);
      c = (c + 1) % numCourts;
    }
  };

  distribute(nonPlayed);
  distribute(played);

  // flatten to single ordered array
  return courts.flat();
}
// ==============================



function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
function findDisjointPairs(playing, usedPairsSet, requiredPairsCount, opponentMap) {
  const allPairs = [];
  const unusedPairs = [];
  const usedPairs = [];

  // Build all pairs and classify (new vs old)
  for (let i = 0; i < playing.length; i++) {
    for (let j = i + 1; j < playing.length; j++) {
      const a = playing[i], b = playing[j];
      const key = [a, b].slice().sort().join("&");
      const isNew = !usedPairsSet || !usedPairsSet.has(key);

      const pairObj = { a, b, key, isNew };
      allPairs.push(pairObj);

      if (isNew) unusedPairs.push(pairObj);
      else usedPairs.push(pairObj);
    }
  }

  // ------------------------------
  //  Opponent Freshness Score
  // ------------------------------
  function calculateOpponentFreshnessScore(currentPair, selectedPairs, opponentMap) {
    let totalScore = 0;
    const [a, b] = currentPair;

    for (const [x, y] of selectedPairs) {
      const pair1 = [x, y];
      const pair2 = [a, b];

      for (const bPlayer of pair2) {
        let newOpp = 0;
        for (const aPlayer of pair1) {
          // Your exact logic:
          if ((opponentMap.get(bPlayer)?.get(aPlayer) || 0) === 1) {
            newOpp += 1;
          }
        }
        // Your exact scoring:
        totalScore += (newOpp === 2) ? 2 : (newOpp === 1 ? 1 : 0);
      }
    }
    return totalScore;
  }

  // ------------------------------
  //  DFS Backtracking With Scoring
  // ------------------------------
function pickBestFromCandidates(candidates) {
  const usedPlayers = new Set();
  const selected = [];
  let best = null;
  const MAX_BRANCHES = 15000; // limit search
  let branches = 0;

  function dfs(startIndex, baseScore) {
    // stop explosion
    if (branches++ > MAX_BRANCHES) return;

    if (selected.length === requiredPairsCount) {
      if (!best || baseScore > best.score) {
        best = { score: baseScore, pairs: selected.slice() };
      }
      return;
    }

    // Remaining candidates insufficient → prune
    const remainingSlots = requiredPairsCount - selected.length;
    if (candidates.length - startIndex < remainingSlots) return;

    for (let i = startIndex; i < candidates.length; i++) {
      const { a, b, isNew } = candidates[i];
      if (usedPlayers.has(a) || usedPlayers.has(b)) continue;

      usedPlayers.add(a);
      usedPlayers.add(b);
      selected.push([a, b]);

      // opponent freshness score
      const oppScore = calculateOpponentFreshnessScore(
        [a, b],
        selected.slice(0, -1),
        opponentMap
      );

      // new-pair strong priority
      const newPairScore = isNew ? 100 : 0;

      dfs(i + 1, baseScore + newPairScore + oppScore);

      selected.pop();
      usedPlayers.delete(a);
      usedPlayers.delete(b);
    }
  }

  dfs(0, 0);
  return best ? best.pairs : null;
}

  // -----------------------------------
  // 1) Try unused (new) pairs only
  // -----------------------------------
  if (unusedPairs.length >= requiredPairsCount) {
    const best = pickBestFromCandidates(unusedPairs);
    if (best) return best;
  }

  // -----------------------------------
  // 2) Try unused + used
  // -----------------------------------
  const combined = [...unusedPairs, ...usedPairs];
  if (combined.length >= requiredPairsCount) {
    const best = pickBestFromCandidates(combined);
    if (best) return best;
  }

  // -----------------------------------
  // 3) Try all pairs as last fallback
  // -----------------------------------
  if (allPairs.length >= requiredPairsCount) {
    const best = pickBestFromCandidates(allPairs);
    if (best) return best;
  }

  return [];
}




function getMatchupScores(allPairs, opponentMap) {
  const matchupScores = [];
  for (let i = 0; i < allPairs.length; i++) {
    for (let j = i + 1; j < allPairs.length; j++) {
      const [a1, a2] = allPairs[i];
      const [b1, b2] = allPairs[j];
      // --- Count past encounters for each of the 4 possible sub-matchups ---
      const ab11 = opponentMap.get(a1)?.get(b1) || 0;
      const ab12 = opponentMap.get(a1)?.get(b2) || 0;
      const ab21 = opponentMap.get(a2)?.get(b1) || 0;
      const ab22 = opponentMap.get(a2)?.get(b2) || 0;
      // --- Total previous encounters (lower = better) ---
      const totalScore = ab11 + ab12 + ab21 + ab22;
      // --- Freshness: number of unseen sub-matchups (4 = completely new) ---
      const freshness =
        (ab11 === 0 ? 1 : 0) +
        (ab12 === 0 ? 1 : 0) +
        (ab21 === 0 ? 1 : 0) +
        (ab22 === 0 ? 1 : 0);
      // --- Store individual player freshness for tie-breaker ---
      const opponentFreshness = {
        a1: (ab11 === 0 ? 1 : 0) + (ab12 === 0 ? 1 : 0),
        a2: (ab21 === 0 ? 1 : 0) + (ab22 === 0 ? 1 : 0),
        b1: (ab11 === 0 ? 1 : 0) + (ab21 === 0 ? 1 : 0),
        b2: (ab12 === 0 ? 1 : 0) + (ab22 === 0 ? 1 : 0),
      };
      matchupScores.push({
        pair1: allPairs[i],
        pair2: allPairs[j],
        freshness,         // 0-4
        totalScore,        // numeric repetition penalty
        opponentFreshness, // for tie-breaking only
      });
    }
  }
  // --- Sort by freshness DESC, then totalScore ASC, then opponent freshness DESC ---
  matchupScores.sort((a, b) => {
    if (b.freshness !== a.freshness) return b.freshness - a.freshness;
    if (a.totalScore !== b.totalScore) return a.totalScore - b.totalScore;
    // Tie-breaker: sum of all 4 individual opponent freshness values
    const aSum = a.opponentFreshness.a1 + a.opponentFreshness.a2 + a.opponentFreshness.b1 + a.opponentFreshness.b2;
    const bSum = b.opponentFreshness.a1 + b.opponentFreshness.a2 + b.opponentFreshness.b1 + b.opponentFreshness.b2;
    return bSum - aSum; // prefer higher sum of unseen opponents
  });
  return matchupScores;
}


/* =========================
 
DISPLAY & UI FUNCTIONS
 
========================= */
// Main round display

function clearPreviousRound() {
  const resultsDiv = document.getElementById('game-results');

  // Remove all child nodes (old rounds)
  while (resultsDiv.firstChild) {
    resultsDiv.removeChild(resultsDiv.firstChild);
  }

  // Clear resting panel
  const restingPanel = document.getElementById('resting-panel');
  if (restingPanel) restingPanel.innerHTML = '';

  // Remove any lingering selection highlights
  SwapState.clear();
  document.querySelectorAll('.selected, .selected-team, .swapping').forEach(el => {
    el.classList.remove('selected', 'selected-team', 'swapping');
  });
  const roundTitle = document.getElementById("roundTitle");
  roundTitle.className = "roundTitle";
  roundTitle.innerText = "R";
}



// Show a round

// ============================================================

// Track last rendered round to avoid unnecessary full rebuilds
var _lastRenderedRoundIndex = -1;

function showRound(index) {
  // If MBM page is active, refresh MBM instead of rounds page
  const mbmPage = document.getElementById('mbmPage');
  if (mbmPage && mbmPage.style.display !== 'none') {
    if (typeof mbmShowRound === 'function') mbmShowRound();
    if (typeof mbmRenderWaiting === 'function') mbmRenderWaiting();
    return;
  }

  const data = allRounds[index];
  if (!data) return;

  // ── If same round already rendered, only refresh players + resting ──
  // Court headers (Doubles/MD/Free buttons) are NOT rebuilt — they stay as-is
  const resultsDiv = document.getElementById('game-results');
  const sameRound  = _lastRenderedRoundIndex === index && resultsDiv && resultsDiv.querySelector('.courtcard');

  // Court count changed (court added/removed) → full rebuild
  const renderedCourtCount = resultsDiv.querySelectorAll('.courtcard').length;
  const dataCourtCount = data.games.length;

  if (sameRound && renderedCourtCount === dataCourtCount) {
    // Only refresh player buttons inside each existing teamDiv.
    // Cups, court headers, VS divider — all stay untouched in place.
    data.games.forEach((game, gameIndex) => {
      const courtDiv = resultsDiv.querySelector(`.courtcard.court-${gameIndex + 1}`);
      if (!courtDiv) return;

      ['L', 'R'].forEach(side => {
        const teamDiv = courtDiv.querySelector(`.team[data-team-side="${side}"]`);
        if (!teamDiv) return;

        // Remove only player buttons — leave cup and everything else
        teamDiv.querySelectorAll('.Lplayer-btn, .Rplayer-btn').forEach(b => b.remove());

        // Update repeated-pair highlight
        const previousPairSet = new Set();
        for (let i = 0; i < index; i++) {
          const prev = allRounds[i];
          if (!prev?.games) continue;
          prev.games.forEach(g => {
            const k1 = getPairKey(g.pair1?.[0], g.pair1?.[1]);
            const k2 = getPairKey(g.pair2?.[0], g.pair2?.[1]);
            if (k1) previousPairSet.add(k1);
            if (k2) previousPairSet.add(k2);
          });
        }
        const teamPairs = side === 'L' ? game.pair1 : game.pair2;
        const pairKey = teamPairs?.length === 2 ? getPairKey(teamPairs[0], teamPairs[1]) : null;
        const teamIsFixed = teamPairs?.length === 2 && isFixedPair(teamPairs[0], teamPairs[1]);
        teamDiv.classList.toggle('fixed-pair', teamIsFixed);
        teamDiv.classList.toggle('repeated-pair', !teamIsFixed && !!(pairKey && previousPairSet.has(pairKey)));

        // Re-insert fresh player buttons BEFORE the cup (cup is last child)
        const cup = teamDiv.querySelector('.win-cup');
        (teamPairs || []).forEach((p, i) => {
          const btn = makePlayerButton(p, side, gameIndex, i, data, index);
          cup ? teamDiv.insertBefore(btn, cup) : teamDiv.appendChild(btn);
        });

        // Re-attach team swap handlers (new player buttons replaced the old ones,
        // but teamDiv itself is the same node so we don't need to re-attach —
        // _attachTeamTapHandlers was already called on this node at full-render time.
        // Nothing to do here.)
      });

      // Update repeated-game on courtDiv
      const previousGameSet = new Set();
      for (let i = 0; i < index; i++) {
        const prev = allRounds[i];
        if (!prev?.games) continue;
        prev.games.forEach(g => {
          const k1 = getPairKey(g.pair1?.[0], g.pair1?.[1]);
          const k2 = getPairKey(g.pair2?.[0], g.pair2?.[1]);
          if (k1 && k2) previousGameSet.add([k1, k2].sort().join('|'));
        });
      }
      const gk1 = getPairKey(game.pair1?.[0], game.pair1?.[1]);
      const gk2 = getPairKey(game.pair2?.[0], game.pair2?.[1]);
      courtDiv.classList.toggle('repeated-game',
        !!(gk1 && gk2 && previousGameSet.has([gk1, gk2].sort().join('|'))));
    });

    // Refresh resting panel
    const restingPanel = document.getElementById('resting-panel');
    if (restingPanel) {
      restingPanel.innerHTML = '';
      if (data.resting && data.resting.length !== 0) {
        const restDiv = renderRestingPlayers(data, index);
        if (restDiv) restingPanel.appendChild(restDiv);
      }
      const historyGroup = renderPlayerHistoryGroup(data, index);
      if (historyGroup) restingPanel.appendChild(historyGroup);
    }
    updateCourtPills();
    updateRoundTimerDisplay();
    return;
  }

  // ── Full rebuild (new round or first render) ──
  clearPreviousRound();
  resultsDiv.innerHTML = '';
  _lastRenderedRoundIndex = index;

  // ✅ Update round title
  const roundTitle = document.getElementById("roundTitle");
  roundTitle.className = "roundTitle";
  roundTitle.innerText = translations[currentLang].roundno + " " + data.round;

  // ✅ Create sections safely
  let restDiv = null;
  if (data.resting && data.resting.length !== 0) {
    restDiv = renderRestingPlayers(data, index);
  }

  const gamesDiv = renderGames(data, index);

  // ✅ Wrap everything
  const wrapper = document.createElement('div');
  wrapper.className = 'round-wrapper';

  // 🔒 Apply lock state globally
  // Always unlocked — no locked class added to wrapper

  // ✅ Append conditionally
  wrapper.append(gamesDiv);
  resultsDiv.append(wrapper);

  // Resting goes below the start button in #resting-panel
  const restingPanel = document.getElementById('resting-panel');
  if (restingPanel) {
    restingPanel.innerHTML = '';
    if (restDiv) restingPanel.appendChild(restDiv);
    const historyGroup = renderPlayerHistoryGroup(data, index);
    if (historyGroup) restingPanel.appendChild(historyGroup);
  }

  // Sync mode banner and shuffle after every round display
  _syncModeBanner();
  _syncShuffleBtn();
  updateRoundTimerDisplay();
  checkAllWinnersMarked();
  // Restore court type + format pills
  setTimeout(updateCourtPills, 50);
}


function goodshowRound(index) {
  clearPreviousRound();
  const resultsDiv = document.getElementById('game-results');
  resultsDiv.innerHTML = '';
  const data = allRounds[index];
  if (!data) return;
  // ✅ Update round title
  const roundTitle = document.getElementById("roundTitle");
  roundTitle.className = "roundTitle";
  roundTitle.innerText = translations[currentLang].roundno + " " + data.round;
  // ✅ Create sections safely
  let restDiv = null;
  if (data.resting && data.resting.length !== 0) {
    restDiv = renderRestingPlayers(data, index);
  }
  const gamesDiv = renderGames(data, index);
  // ✅ Wrap everything in a container to distinguish latest vs played
  const wrapper = document.createElement('div');
  const isLatest = index === allRounds.length - 1;
  var roundNum = (data.round || (index + 1));
  var roundColorClass = 'round-n-' + ((roundNum - 1) % 10 + 1);
  wrapper.className = isLatest ? 'latest-round ' + roundColorClass : 'played-round ' + roundColorClass;
  // ✅ Append conditionally
  if (restDiv) {
    wrapper.append(gamesDiv,restDiv);
  } else {
    wrapper.append(gamesDiv);
  }
  resultsDiv.append(wrapper);
  // Update pill states based on available players
  setTimeout(updateCourtPills, 50);
  // ✅ Navigation buttons
  //document.getElementById('prevBtn').disabled = index === 0;
  //document.getElementById('nextBtn').disabled = false;
}


// Resting players display
function t(key) {
  return translations[currentLang]?.[key] || key;
}


function chkrenderRestingPlayers(data, index) {
  const restDiv = document.createElement('div');
  restDiv.className = 'round-header resting-section';
  restDiv.style.paddingLeft = "12px";

  const title = document.createElement('div');
  title.dataset.i18n = 'sittingOut';
  title.textContent = t('sittingOut');
  restDiv.appendChild(title);

  const restBox = document.createElement('div');
  restBox.className = 'rest-box';

  if (!data.resting || data.resting.length === 0) {
    const span = document.createElement('span');
    span.dataset.i18n = 'none';
    span.textContent = t('none');
    restBox.appendChild(span);
  } else {
    data.resting.forEach(restName => {
      const baseName = restName.split('#')[0];

      const playerObj = schedulerState.allPlayers.find(
        p => p.name === baseName
      );

      if (playerObj) {
        restBox.appendChild(
          makeRestButton(
            { ...playerObj, displayName: restName },
            data,
            index
          )
        );
      }
    });
  }

  restDiv.appendChild(restBox);
  return restDiv;
}

// ── Fallback: full teamsDiv rebuild (used only when court count changes) ──
function _renderTeamsDiv(game, gameIndex, data, roundIndex) {
  const previousPairSet = new Set();
  for (let i = 0; i < roundIndex; i++) {
    const prev = allRounds[i];
    if (!prev?.games) continue;
    prev.games.forEach(g => {
      if (!g?.pair1 || !g?.pair2) return;
      const k1 = getPairKey(g.pair1[0], g.pair1[1]);
      const k2 = getPairKey(g.pair2[0], g.pair2[1]);
      if (k1) previousPairSet.add(k1);
      if (k2) previousPairSet.add(k2);
    });
  }
  const teamsDiv = document.createElement('div');
  teamsDiv.className = 'teams';

  const makeTeam = (teamSide) => {
    const teamDiv = document.createElement('div');
    teamDiv.className = 'team';
    teamDiv.dataset.teamSide = teamSide;
    teamDiv.dataset.gameIndex = gameIndex;
    const teamPairs = teamSide === 'L' ? game.pair1 : game.pair2;
    if (teamPairs && teamPairs.length === 2) {
      if (isFixedPair(teamPairs[0], teamPairs[1])) {
        teamDiv.classList.add('fixed-pair');
      } else {
        const pairKey = getPairKey(teamPairs[0], teamPairs[1]);
        if (pairKey && previousPairSet.has(pairKey)) teamDiv.classList.add('repeated-pair');
      }
    }
    teamPairs.forEach((p, i) => {
      teamDiv.appendChild(makePlayerButton(p, teamSide, gameIndex, i, data, roundIndex));
    });
    // ✅ FIX: attach team swap handlers here too (partial refresh path)
    _attachTeamTapHandlers(teamDiv, teamSide, gameIndex, data, roundIndex, () => game);
    return teamDiv;
  };

  const vsDivider = document.createElement('div');
  vsDivider.className = 'vs-divider';
  vsDivider.innerHTML = `<div class="vs-line"></div><span>${typeof t === 'function' ? t('vsLabel') : 'VS'}</span><div class="vs-line"></div>`;

  teamsDiv.append(makeTeam('L'), vsDivider, makeTeam('R'));

  // Game repetition
  if (game?.pair1 && game?.pair2 && game.pair1.length === 2 && game.pair2.length === 2) {
    const previousGameSet = new Set();
    for (let i = 0; i < roundIndex; i++) {
      const prev = allRounds[i];
      if (!prev?.games) continue;
      prev.games.forEach(g => {
        if (!g?.pair1 || !g?.pair2) return;
        const k1 = getPairKey(g.pair1[0], g.pair1[1]);
        const k2 = getPairKey(g.pair2[0], g.pair2[1]);
        if (k1 && k2) previousGameSet.add([k1,k2].sort().join('|'));
      });
    }
    const gk1 = getPairKey(game.pair1[0], game.pair1[1]);
    const gk2 = getPairKey(game.pair2[0], game.pair2[1]);
    if (gk1 && gk2 && previousGameSet.has([gk1,gk2].sort().join('|'))) {
      teamsDiv.closest('.courtcard')?.classList.add('repeated-game');
    }
  }

  return teamsDiv;
}

function renderGames(data, roundIndex) {

  const wrapper = document.createElement('div');
  const playmode = getPlayMode();

  // ⭐ Build previous history
  const previousPairSet = new Set();
  const previousGameSet = new Set();

  for (let i = 0; i < roundIndex; i++) {
    const prev = allRounds[i];
    if (!prev?.games) continue;

    prev.games.forEach(g => {
      if (!g?.pair1 || !g?.pair2) return;

      const pair1Key = getPairKey(g.pair1[0], g.pair1[1]);
      const pair2Key = getPairKey(g.pair2[0], g.pair2[1]);

      if (pair1Key) previousPairSet.add(pair1Key);
      if (pair2Key) previousPairSet.add(pair2Key);

      // ✅ FIXED -- store game as pair-vs-pair (NOT 4 flattened players)
      if (pair1Key && pair2Key) {
        const gameKey = [pair1Key, pair2Key].sort().join("|");
        previousGameSet.add(gameKey);
      }
    });
  }

  data.games.forEach((game, gameIndex) => {

    const courtDiv = document.createElement('div');
    courtDiv.className = `courtcard court-${gameIndex + 1}`;

    const courtName = document.createElement('div');
    courtName.classList.add('courtname');
    const _genders = new Set((schedulerState.allPlayers || [])
      .filter(p => (schedulerState.activeplayers || []).some(a => a.split('#')[0] === p.name))
      .map(p => p.gender || 'Male'));
    const _showType = _genders.size > 1;
    // Restore saved court type instead of always defaulting to 'free'
    const _savedType = (schedulerState.courtTypes || [])[gameIndex] || 'free';
    const _savedFmt  = (schedulerState.courtFormats || [])[gameIndex] || 'doubles';
    const _typeInfo  = (typeof _CTP_ALL !== 'undefined' ? _CTP_ALL : []).find(t => t.key === _savedType) || { label: 'Free', cls: 'ctp-free' };
    const _fmtLabel  = _savedFmt === 'singles' ? t('singles') : t('doubles');
    const _offlineLocked = _isOfflinePreparedRoundLocked();
    courtName.innerHTML =
      `<span class="court-label">${t('courtSingle')} ${gameIndex + 1}</span>` +
      `<span class="court-header-right">` +
        (_offlineLocked ? '' : `<button class="ctp ctp-court-dice" onclick="rerollCourt(${gameIndex})" title="Re-roll this court">🎲</button>`) +
        (_offlineLocked
          ? `<span class="ctp ctp-fmt-cycle ctp-fmt-${_savedFmt} ctp-fixed">${_fmtLabel}</span>`
          : `<button class="ctp ctp-fmt-cycle ctp-fmt-${_savedFmt}" onclick="ctpFormatCycle(this)">${_fmtLabel} ▾</button>`) +
        (_showType ? (_offlineLocked
          ? `<span class="ctp ctp-cycle ${_typeInfo.cls} ctp-fixed">${_typeInfo.label}</span>`
          : `<button class="ctp ctp-cycle ${_typeInfo.cls}" onclick="ctpCycle(this)">${_typeInfo.label} ▾</button>`) : '') +
      `</span>`;

    const teamsDiv = document.createElement('div');
    teamsDiv.className = 'teams';

    const makeTeamDiv = (teamSide) => {

      const teamDiv = document.createElement('div');
      teamDiv.className = 'team';
      teamDiv.dataset.teamSide = teamSide;
      teamDiv.dataset.gameIndex = gameIndex;

      const teamPairs = teamSide === 'L' ? game.pair1 : game.pair2;

      // ⭐ Pair repetition detection (skip if this is a fixed pair)
      if (teamPairs && teamPairs.length === 2) {
        if (isFixedPair(teamPairs[0], teamPairs[1])) {
          teamDiv.classList.add('fixed-pair');
        } else {
          const pairKey = getPairKey(teamPairs[0], teamPairs[1]);
          if (pairKey && previousPairSet.has(pairKey)) {
            teamDiv.classList.add('repeated-pair');
          }
        }
      }

      teamPairs.forEach((p, i) => {
        teamDiv.appendChild(
          makePlayerButton(p, teamSide, gameIndex, i, data, roundIndex)
        );

      });

      const isCompetitive = (typeof getPlayMode === 'function') && getPlayMode() === 'competitive';

      const winCup = document.createElement('img');
      winCup.src = 'win-cup.png';
      winCup.className = 'win-cup blinking';
      winCup.title = t('markWinner');
      winCup.style.visibility = isCompetitive ? 'hidden' : 'hidden';
      winCup.style.pointerEvents = 'none';
      if (!isCompetitive) winCup.style.display = 'none';

      if (game.winner === teamSide) {
        winCup.classList.add('active');
        winCup.classList.remove('blinking');
      }

      const toggleWinner = (e) => {
        if (getPlayMode() !== 'competitive') return;
        if (typeof appMode !== 'undefined' && appMode === 'viewer') return;
        if (currentState !== "active") return;
        e.stopPropagation();
        e.preventDefault();

        const allCups = teamDiv.parentElement.querySelectorAll('.win-cup');
        const isActive = winCup.classList.contains('active');

        if (!isActive) {
          allCups.forEach(cup => {
            cup.classList.remove('active', 'blinking');
            cup.style.visibility = 'hidden';
            cup.style.pointerEvents = 'none';
          });

          winCup.classList.add('active');
          winCup.classList.remove('blinking');
          winCup.style.visibility = 'visible';
          winCup.style.pointerEvents = 'auto';

          game.winner = teamSide;
          game.winners = teamPairs.slice();
          if (typeof saveRoundsToDb === "function") saveRoundsToDb();
          checkAllWinnersMarked();
        } else {
          allCups.forEach(cup => {
            cup.classList.remove('active');
            cup.classList.add('blinking');
            cup.style.visibility = 'visible';
            cup.style.pointerEvents = 'auto';
          });

          game.winner = undefined;
          game.winners = [];
          if (typeof saveRoundsToDb === "function") saveRoundsToDb();
          checkAllWinnersMarked();
        }
      };

      winCup.addEventListener('click', toggleWinner);
      teamDiv.addEventListener('click', toggleWinner);

      teamDiv.appendChild(winCup);

      // ── Team swap — tap to select, tap another team to swap ──
      // Normal Round Mode remains latest-round-only. Template Editor must allow
      // the stored round currently being reviewed to use the same proven team swap.
      const isTemplateEditRound_ts = !!(window.SCSOfflineRounds &&
        typeof window.SCSOfflineRounds.isTemplateEditorActive === 'function' &&
        window.SCSOfflineRounds.isTemplateEditorActive());
      const isLatestRound_ts = roundIndex === allRounds.length - 1 || isTemplateEditRound_ts;
      if (isLatestRound_ts) {
        _attachTeamTapHandlers(teamDiv, teamSide, gameIndex, data, roundIndex, () => game);
      }

      return teamDiv;
    };

    const teamLeft = makeTeamDiv('L');
    const teamRight = makeTeamDiv('R');

    // ⭐ FIXED -- Exact game repetition detection
    if (game?.pair1 && game?.pair2) {

      const pair1Key = getPairKey(game.pair1[0], game.pair1[1]);
      const pair2Key = getPairKey(game.pair2[0], game.pair2[1]);

      if (pair1Key && pair2Key) {
        const currentGameKey = [pair1Key, pair2Key].sort().join("|");
        if (previousGameSet.has(currentGameKey)) {
          courtDiv.classList.add('repeated-game');
        }
      }
    }

    const vsDivider = document.createElement('div');
    vsDivider.className = 'vs-divider';
    vsDivider.innerHTML = `<div class="vs-line"></div><span>${t('vsLabel')}</span><div class="vs-line"></div>`;

    teamsDiv.append(teamLeft, vsDivider, teamRight);
    courtDiv.append(courtName, teamsDiv);
    wrapper.appendChild(courtDiv);
  });

  return wrapper;
}
function updateWinCupVisibility() {
  const playmode = getPlayMode();
  document.querySelectorAll('.win-cup').forEach(cup => {
    cup.style.display = playmode === "competitive" ? "" : "none";
  });
}


function renderRestingPlayers(data, index) {
  const restDiv = document.createElement('div');
  restDiv.className = 'round-header resting-section';
  restDiv.style.paddingLeft = "12px";

  const restCount = data.resting ? data.resting.length : 0;

  // Collapsible title row
  const title = document.createElement('button');
  title.className = 'resting-toggle-btn';
  title.innerHTML =
    '<span class="round-card-icon resting-card-icon" aria-hidden="true"><svg viewBox="0 0 32 32"><circle cx="11" cy="11" r="5"></circle><circle cx="22" cy="12" r="4.5"></circle><path d="M2.5 27c.4-6 3.7-9 8.6-9s8.1 3 8.5 9"></path><path d="M17 20c1.4-1.4 3.1-2 5.1-2 4.3 0 7 2.7 7.4 8"></path></svg></span>' +
    '<span class="round-card-copy"><span class="resting-toggle-label">' + t('sittingOut') + ' <span class="resting-toggle-count">(' + restCount + ')</span></span><span class="round-card-subtitle">' + t('restingPlayersHint') + '</span></span>' +
    '<span class="resting-toggle-arrow">▾</span>';

  const restBox = document.createElement('div');
  restBox.className = 'rest-box';
  // Restore user's last preference — default closed
  const restOpen = localStorage.getItem('restingOpen') === 'true';
  if (!restOpen) restBox.classList.add('rest-collapsed');
  title.querySelector('.resting-toggle-arrow').textContent = restOpen ? '▴' : '▾';

  title.onclick = function() {
    const isCollapsed = restBox.classList.contains('rest-collapsed');
    restBox.classList.toggle('rest-collapsed', !isCollapsed);
    title.querySelector('.resting-toggle-arrow').textContent = isCollapsed ? '▴' : '▾';
    localStorage.setItem('restingOpen', isCollapsed ? 'true' : 'false');
  };

  restDiv.appendChild(title);

  if (!data.resting || data.resting.length === 0) {
    const span = document.createElement('span');
    span.innerText = t('noneGame');
    restBox.appendChild(span);
  } else {
    data.resting.forEach(restName => {
      // 🔑 Extract real player name (before #)
      const baseName = restName.split('#')[0];

      const playerObj = schedulerState.allPlayers.find(
        p => p.name === baseName
      );

      if (playerObj) {
        restBox.appendChild(
          makeRestButton(
            { ...playerObj, displayName: restName }, // keep #count
            data,
            index
          )
        );
      }
    });
  }

  restDiv.appendChild(restBox);
  return restDiv;
}



// Compact, display-only player round history. Replaces the old "Rested" pool.
// Shows every active player, total played/rested counts, and one marker per round:
// ● played, × rested.
function renderRestedPlayers(data, index) {
  const players = (schedulerState.allPlayers || []).filter(p => p && p.name);
  if (!players.length) return null;

  // Newest first keeps the current round visible on narrow mobile screens.
  const rounds = allRounds
    .slice(0, Math.min(index + 1, allRounds.length))
    .reverse();
  const rows = players.map(player => {
    const name = player.name;

    // Inactive players are shown for completeness, but have no round status.
    if (!player.active) {
      return { name, played: '', rested: '', marks: rounds.map(() => ''), inactive: true };
    }

    let played = 0;
    let rested = 0;
    const marks = rounds.map(round => {
      const resting = (round?.resting || []).some(n => String(n).split('#')[0] === name);
      if (resting) {
        rested++;
        return 'rest';
      }
      const inGame = (round?.games || []).some(g =>
        [...(g.pair1 || []), ...(g.pair2 || [])].some(n => String(n).split('#')[0] === name)
      );
      if (inGame) {
        played++;
        return 'played';
      }
      return '';
    });
    return { name, played, rested, marks };
  });

  const section = document.createElement('div');
  section.className = 'round-header rested-info-section player-history-section';

  const title = document.createElement('button');
  title.className = 'resting-toggle-btn rested-info-title player-history-title';
  title.innerHTML =
    '<span class="resting-toggle-label">' + t('roundHistory') + ' <span class="resting-toggle-count">(' + players.length + ')</span></span>' +
    '<span class="resting-toggle-arrow">▾</span>';

  const box = document.createElement('div');
  box.className = 'rested-info-box player-history-box';
  const open = localStorage.getItem('restedOpen') === 'true';
  if (!open) box.classList.add('rest-collapsed');
  title.querySelector('.resting-toggle-arrow').textContent = open ? '▴' : '▾';
  title.onclick = function() {
    const isCollapsed = box.classList.contains('rest-collapsed');
    box.classList.toggle('rest-collapsed', !isCollapsed);
    title.querySelector('.resting-toggle-arrow').textContent = isCollapsed ? '▴' : '▾';
    localStorage.setItem('restedOpen', isCollapsed ? 'true' : 'false');
  };
  section.appendChild(title);

  const scroll = document.createElement('div');
  scroll.className = 'player-history-scroll';
  const table = document.createElement('table');
  table.className = 'player-history-table';

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  [t('players'), t('played'), t('rested')].forEach(label => {
    const th = document.createElement('th'); th.textContent = label; hr.appendChild(th);
  });
  rounds.forEach((round, i) => {
    const th = document.createElement('th');
    th.textContent = (translations[currentLang]?.roundShort || 'R') + (round?.round || (rounds.length - i));
    hr.appendChild(th);
  });
  thead.appendChild(hr); table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach(row => {
    const tr = document.createElement('tr');
    if (row.inactive) tr.classList.add('player-history-inactive');
    const nameTd = document.createElement('td'); nameTd.textContent = row.name; nameTd.className = 'player-history-name'; tr.appendChild(nameTd);
    const playedTd = document.createElement('td'); playedTd.textContent = row.played; playedTd.className = 'player-history-played-count'; tr.appendChild(playedTd);
    const restedTd = document.createElement('td'); restedTd.textContent = row.rested; restedTd.className = 'player-history-rested-count'; tr.appendChild(restedTd);
    row.marks.forEach(mark => {
      const td = document.createElement('td');
      if (mark === 'played') { td.textContent = '●'; td.className = 'player-history-played'; }
      else if (mark === 'rest') { td.textContent = '×'; td.className = 'player-history-rest'; }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  scroll.appendChild(table);
  box.appendChild(scroll);
  section.appendChild(box);
  return section;
}



// Display-only partner coverage. Reads existing completed/current round pair history only.
// Does not influence scheduling, fairness, rest order, or round generation.
function renderNotYetPaired(data, index, forcedRelationshipMode = null) {
  // Singles has only opponent history. Doubles/XD can switch between
  // teammate Pairing History and Opponent History. This is display-only.
  const courtFormats = (schedulerState && schedulerState.courtFormats) || [];
  const activeCourtCount = Math.max(0, Number((schedulerState && schedulerState.numCourts) || courtFormats.length || 0));
  const sessionIsSingles = activeCourtCount > 0 &&
    Array.from({ length: activeCourtCount }, (_, i) => courtFormats[i] || 'doubles')
      .every(format => format === 'singles');

  let relationshipMode = forcedRelationshipMode || (sessionIsSingles
    ? 'opponent'
    : (localStorage.getItem('relationshipHistoryMode') === 'opponent' ? 'opponent' : 'pairing'));
  const relationshipModeLocked = forcedRelationshipMode === 'pairing' || forcedRelationshipMode === 'opponent';

  const allActivePlayers = (schedulerState.allPlayers || []).filter(p => p && p.name && p.active);
  if (allActivePlayers.length < 2) return null;

  const fixedPairPlayers = new Set();
  ((schedulerState && schedulerState.fixedPairs) || []).forEach(pair => {
    if (!Array.isArray(pair) || pair.length < 2) return;
    const a = String(pair[0] || '').split('#')[0];
    const b = String(pair[1] || '').split('#')[0];
    if (a && b) { fixedPairPlayers.add(a); fixedPairPlayers.add(b); }
  });

  const playerByName = new Map(allActivePlayers.map(p => [p.name, p]));
  const rounds = allRounds.slice(0, Math.min(index + 1, allRounds.length));

  const offlineMixed = (() => {
    try {
      return sessionStorage.getItem('scsOfflineRoundModeActive') === '1' &&
             localStorage.getItem('scsOfflineGameType') === 'mixed';
    } catch (_) { return false; }
  })();
  const doublesCourtTypes = (schedulerState.courtTypes || []).filter((_, i) =>
    ((schedulerState.courtFormats || [])[i] || 'doubles') !== 'singles'
  );
  const mixedDoublesHistory = offlineMixed ||
    (doublesCourtTypes.length > 0 && doublesCourtTypes.every(type => type === 'XD'));

  const genderCode = name => {
    const g = String(playerByName.get(name)?.gender || '').toLowerCase();
    return g === 'female' ? 'F' : g === 'male' ? 'M' : '';
  };
  const genderClass = name => {
    const code = genderCode(name);
    return code === 'F' ? 'pairing-row-female' : code === 'M' ? 'pairing-row-male' : '';
  };
  const genderIconSrc = name => genderCode(name) === 'F' ? 'female.png' : 'male.png';
  const appendGenderName = (container, name, compact = false) => {
    const icon = document.createElement('img');
    icon.src = genderIconSrc(name);
    icon.alt = genderCode(name) === 'F' ? 'Female' : 'Male';
    icon.className = compact ? 'pairing-gender-icon pairing-gender-icon-chip' : 'pairing-gender-icon';
    container.appendChild(icon);
    const label = document.createElement('span');
    label.textContent = name;
    container.appendChild(label);
  };

  const section = document.createElement('div');
  section.className = 'round-header not-yet-paired-section';

  const title = document.createElement('button');
  title.className = 'resting-toggle-btn not-yet-paired-title';

  const box = document.createElement('div');
  box.className = 'not-yet-paired-box';
  const open = localStorage.getItem('notYetPairedOpen') === 'true';
  if (!open) box.classList.add('rest-collapsed');

  const scroll = document.createElement('div');
  scroll.className = 'not-yet-paired-scroll';
  const table = document.createElement('table');
  table.className = 'not-yet-paired-table';
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  const playerTh = document.createElement('th');
  playerTh.textContent = t('playerSingular');
  const countTh = document.createElement('th');
  const partnerTh = document.createElement('th');
  partnerTh.className = 'not-yet-paired-partner-heading';
  hr.append(playerTh, countTh, partnerTh);
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  scroll.appendChild(table);
  box.appendChild(scroll);

  const savedRelationshipFilter = localStorage.getItem('notYetPairedView');
  let viewMode = ['all', '0', '1', '2', '3plus'].includes(savedRelationshipFilter)
    ? savedRelationshipFilter
    : (savedRelationshipFilter === 'missing' ? '0' : 'all');

  function buildRelationshipData() {
    const isOpponent = relationshipMode === 'opponent';
    // Fixed-pair players are omitted from Pairing History because their partner
    // is intentionally fixed, but remain visible in Opponent History.
    const players = allActivePlayers.filter(p => isOpponent || !fixedPairPlayers.has(p.name));
    const names = players.map(p => p.name);
    const relation = new Map(names.map(name => [name, new Set()]));
    const relationCounts = new Map(names.map(name => [name, new Map()]));

    const incrementRelation = (a, b) => {
      if (!a || !b || a === b || !relation.has(a) || !relation.has(b)) return;
      relation.get(a).add(b);
      relation.get(b).add(a);
      relationCounts.get(a).set(b, (relationCounts.get(a).get(b) || 0) + 1);
      relationCounts.get(b).set(a, (relationCounts.get(b).get(a) || 0) + 1);
    };

    const eligibleFor = name => names.filter(other => {
      if (other === name) return false;
      if (isOpponent || sessionIsSingles) return true;
      if (!mixedDoublesHistory) return true;
      const mine = genderCode(name);
      const theirs = genderCode(other);
      return !!mine && !!theirs && mine !== theirs;
    });

    rounds.forEach(round => {
      (round?.games || []).forEach(game => {
        const p1 = Array.isArray(game?.pair1) ? game.pair1.map(v => String(v || '').split('#')[0]).filter(Boolean) : [];
        const p2 = Array.isArray(game?.pair2) ? game.pair2.map(v => String(v || '').split('#')[0]).filter(Boolean) : [];

        if (isOpponent || sessionIsSingles) {
          // Every player on one side has faced every player on the other side.
          p1.forEach(a => p2.forEach(b => {
            incrementRelation(a, b);
          }));
        } else {
          // Pairing History: teammates on each side.
          [p1, p2].forEach(pair => {
            if (pair.length < 2) return;
            const a = pair[0], b = pair[1];
            incrementRelation(a, b);
          });
        }
      });
    });

    return names.map(name => {
      const eligible = eligibleFor(name);
      const missing = eligible.filter(other => !relation.get(name).has(other));
      return { name, eligible, missing, relation, relationCounts };
    });
  }

  const controls = document.createElement('div');
  controls.className = 'relationship-history-controls';
  box.insertBefore(controls, scroll);

  function renderHeader() {
    const isOpponent = relationshipMode === 'opponent';
    const historyTitle = t(isOpponent ? 'opponentHistory' : 'pairingHistory');
    // Keep the history title row identical to Round History. Controls live on
    // their own row below so narrow iPhone layouts never squeeze/overlap it.
    title.innerHTML =
      '<span class="resting-toggle-label">' + historyTitle + '</span>' +
      '<span class="resting-toggle-arrow">' + (box.classList.contains('rest-collapsed') ? '▾' : '▴') + '</span>';

    const modeSwitch = (sessionIsSingles || relationshipModeLocked) ? '' :
      '<span class="relationship-history-toggle" role="group" aria-label="History type">' +
        '<span class="relationship-mode-btn relationship-mode-pairing" role="button" tabindex="0">' + t('pairing') + '</span>' +
        '<span class="relationship-mode-btn relationship-mode-opponent" role="button" tabindex="0">' + t('opponent') + '</span>' +
      '</span>';

    const rows = buildRelationshipData();
    const bucketAvailable = { all: true, '0': false, '1': false, '2': false, '3plus': false };
    rows.forEach(row => {
      row.eligible.forEach(other => {
        const count = row.relationCounts.get(row.name).get(other) || 0;
        if (count === 0) bucketAvailable['0'] = true;
        else if (count === 1) bucketAvailable['1'] = true;
        else if (count === 2) bucketAvailable['2'] = true;
        else if (count >= 3) bucketAvailable['3plus'] = true;
      });
    });
    if (viewMode !== 'all' && !bucketAvailable[viewMode]) viewMode = 'all';

    const labels = isOpponent
      ? { all: t('all'), '0': t('against0'), '1': t('against1'), '2': t('against2'), '3plus': t('against3Plus') }
      : { all: t('all'), '0': t('paired0'), '1': t('paired1'), '2': t('paired2'), '3plus': t('paired3Plus') };
    const filterButton = key =>
      '<span class="not-yet-paired-view-btn' + (bucketAvailable[key] ? '' : ' disabled') + '" data-view="' + key + '" role="button" tabindex="' + (bucketAvailable[key] ? '0' : '-1') + '" aria-disabled="' + (bucketAvailable[key] ? 'false' : 'true') + '">' + labels[key] + '</span>';

    controls.innerHTML =
      modeSwitch +
      '<span class="pairing-header-toggle relationship-count-filter" role="group" aria-label="' + historyTitle + ' view">' +
        filterButton('all') +
        filterButton('0') +
        filterButton('1') +
        filterButton('2') +
        filterButton('3plus') +
      '</span>';

    const pairingModeBtn = controls.querySelector('.relationship-mode-pairing');
    const opponentModeBtn = controls.querySelector('.relationship-mode-opponent');
    if (pairingModeBtn) pairingModeBtn.classList.toggle('active', relationshipMode === 'pairing');
    if (opponentModeBtn) opponentModeBtn.classList.toggle('active', relationshipMode === 'opponent');

    controls.querySelectorAll('.not-yet-paired-view-btn[data-view]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewMode);
    });

    if (pairingModeBtn) pairingModeBtn.addEventListener('click', event => {
      event.stopPropagation();
      relationshipMode = 'pairing';
      localStorage.setItem('relationshipHistoryMode', relationshipMode);
      renderAll();
    });
    if (opponentModeBtn) opponentModeBtn.addEventListener('click', event => {
      event.stopPropagation();
      relationshipMode = 'opponent';
      localStorage.setItem('relationshipHistoryMode', relationshipMode);
      renderAll();
    });

    controls.querySelectorAll('.not-yet-paired-view-btn[data-view]').forEach(btn => {
      btn.addEventListener('click', event => {
        event.stopPropagation();
        if (btn.classList.contains('disabled')) return;
        viewMode = btn.dataset.view || 'all';
        localStorage.setItem('notYetPairedView', viewMode);
        renderAll();
      });
    });
  }

  function renderRows() {
    const isOpponent = relationshipMode === 'opponent';
    const rows = buildRelationshipData();
    tbody.innerHTML = '';
    countTh.textContent = t(isOpponent ? 'unplayed' : 'unpaired');
    partnerTh.textContent = viewMode === 'all'
      ? t('allPlayers')
      : t(isOpponent ? 'opponents' : 'pairedPlayers');

    rows.forEach(row => {
      const tr = document.createElement('tr');
      const rowGenderClass = genderClass(row.name);
      if (rowGenderClass) tr.classList.add(rowGenderClass);

      const nameTd = document.createElement('td');
      nameTd.className = 'not-yet-paired-name';
      appendGenderName(nameTd, row.name);
      tr.appendChild(nameTd);

      const countTd = document.createElement('td');
      countTd.className = 'not-yet-paired-count';
      countTd.textContent = row.missing.length;
      tr.appendChild(countTd);

      const relationsTd = document.createElement('td');
      relationsTd.className = 'not-yet-paired-with';
      const shownNames = row.eligible.filter(other => {
        if (viewMode === 'all') return true;
        const count = row.relationCounts.get(row.name).get(other) || 0;
        if (viewMode === '0') return count === 0;
        if (viewMode === '1') return count === 1;
        if (viewMode === '2') return count === 2;
        if (viewMode === '3plus') return count >= 3;
        return true;
      });

      if (viewMode !== 'all' && !shownNames.length) return;

      if (shownNames.length) {
        shownNames.forEach(other => {
          const chip = document.createElement('span');
          const count = row.relationCounts.get(row.name).get(other) || 0;
          const already = count > 0;
          chip.className = 'not-yet-paired-chip relationship-player-card ' + (already ? 'paired-chip' : 'unpaired-chip');
          appendGenderName(chip, other, true);

          // Show the exact pairing/opponent count on every visible relationship card.
          if (viewMode !== '0') {
            const countPill = document.createElement('span');
            const countTone = count <= 0 ? 'zero' : (count === 1 ? 'one' : (count === 2 ? 'two' : (count === 3 ? 'three' : 'many')));
            countPill.className = 'relationship-count-pill relationship-count-' + countTone;
            countPill.dataset.count = String(count);
            countPill.textContent = String(count);
            countPill.title = isOpponent
              ? `${other} played against ${row.name} ${count} time${count === 1 ? '' : 's'}`
              : `${other} paired with ${row.name} ${count} time${count === 1 ? '' : 's'}`;
            chip.appendChild(countPill);
          }
          relationsTd.appendChild(chip);
        });
      } else {
        const done = document.createElement('span');
        done.className = 'not-yet-paired-complete';
        done.textContent = isOpponent
          ? '✓ Played everyone'
          : (mixedDoublesHistory ? '✓ Paired with every eligible partner' : '✓ Paired with everyone');
        relationsTd.appendChild(done);
      }

      tr.appendChild(relationsTd);
      tbody.appendChild(tr);
    });
  }

  function renderAll() {
    renderHeader();
    renderRows();
  }

  title.onclick = function(event) {
    const isCollapsed = box.classList.contains('rest-collapsed');
    box.classList.toggle('rest-collapsed', !isCollapsed);
    const arrow = title.querySelector('.resting-toggle-arrow');
    if (arrow) arrow.textContent = isCollapsed ? '▴' : '▾';
    localStorage.setItem('notYetPairedOpen', isCollapsed ? 'true' : 'false');
  };

  section.appendChild(title);
  section.appendChild(box);
  renderAll();
  return section;
}



function renderPlayerHistoryGroup(data, index) {
  const roundHistory = renderRestedPlayers(data, index);

  const courtFormats = (schedulerState && schedulerState.courtFormats) || [];
  const activeCourtCount = Math.max(0, Number((schedulerState && schedulerState.numCourts) || courtFormats.length || 0));
  const sessionIsSingles = activeCourtCount > 0 &&
    Array.from({ length: activeCourtCount }, (_, i) => courtFormats[i] || 'doubles')
      .every(format => format === 'singles');

  const pairingHistory = sessionIsSingles ? null : renderNotYetPaired(data, index, 'pairing');
  const opponentHistory = renderNotYetPaired(data, index, 'opponent');
  if (!roundHistory && !pairingHistory && !opponentHistory) return null;

  const group = document.createElement('div');
  group.className = 'player-history-group dashboard-tabs-group';

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'player-history-group-title';

  const body = document.createElement('div');
  body.className = 'player-history-group-body dashboard-tabs-body';

  const open = localStorage.getItem('playerHistoryGroupOpen') !== 'false';
  if (!open) body.classList.add('rest-collapsed');

  header.innerHTML =
    '<span class="round-card-icon dashboard-card-icon" aria-hidden="true"><svg viewBox="0 0 32 32"><rect x="4" y="18" width="6" height="10" rx="1"></rect><rect x="13" y="10" width="6" height="18" rx="1"></rect><rect x="22" y="4" width="6" height="24" rx="1"></rect></svg></span>' +
    '<span class="round-card-copy"><span class="round-card-title">' + t('dashboard') + '</span><span class="round-card-subtitle">' + t('dashboardHistoryHint') + '</span></span>' +
    '<span class="player-history-group-arrow">' + (open ? '▴' : '▾') + '</span>';

  header.onclick = function() {
    const isCollapsed = body.classList.contains('rest-collapsed');
    body.classList.toggle('rest-collapsed', !isCollapsed);
    header.querySelector('.player-history-group-arrow').textContent = isCollapsed ? '▴' : '▾';
    localStorage.setItem('playerHistoryGroupOpen', isCollapsed ? 'true' : 'false');
  };

  const tabs = document.createElement('div');
  tabs.className = 'dashboard-history-tabs';
  tabs.setAttribute('role', 'tablist');

  const panels = document.createElement('div');
  panels.className = 'dashboard-history-panels';

  const entries = [
    ['rounds', t('rounds'), roundHistory],
    ...(pairingHistory ? [['pairing', t('pairing'), pairingHistory]] : []),
    ['opponents', t('opponents'), opponentHistory]
  ].filter(entry => entry[2]);

  let activeTab = localStorage.getItem('dashboardHistoryTab') || 'rounds';
  if (!entries.some(entry => entry[0] === activeTab)) activeTab = entries[0][0];

  const activateTab = key => {
    activeTab = key;
    localStorage.setItem('dashboardHistoryTab', key);
    tabs.querySelectorAll('.dashboard-history-tab').forEach(btn => {
      const active = btn.dataset.tab === key;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    panels.querySelectorAll('.dashboard-history-panel').forEach(panel => {
      panel.classList.toggle('active', panel.dataset.panel === key);
    });
  };

  entries.forEach(([key, label, content]) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'dashboard-history-tab';
    tab.dataset.tab = key;
    tab.setAttribute('role', 'tab');
    tab.textContent = label;
    tab.onclick = event => {
      event.stopPropagation();
      activateTab(key);
    };
    tabs.appendChild(tab);

    const panel = document.createElement('div');
    panel.className = 'dashboard-history-panel dashboard-history-panel-' + key;
    panel.dataset.panel = key;
    panel.setAttribute('role', 'tabpanel');

    // The Dashboard tabs replace the old per-card title bars. Keep each
    // existing history table/logic intact and simply expose its content.
    const innerTitle = content.querySelector(':scope > .resting-toggle-btn');
    if (innerTitle) innerTitle.classList.add('dashboard-inner-history-title');
    const innerBox = content.querySelector(':scope > .rested-info-box, :scope > .not-yet-paired-box');
    if (innerBox) innerBox.classList.remove('rest-collapsed');

    panel.appendChild(content);
    panels.appendChild(panel);
  });

  body.append(tabs, panels);
  group.append(header, body);
  activateTab(activeTab);
  return group;
}

function getGenderByName(playerName) {
  const p = schedulerState.allPlayers.find(pl => pl.name === playerName);
  return p ? p.gender : null; // "Male" | "Female"
}

function getTeamTypeFromPairs(playerNames) {
  let hasMale = false;
  let hasFemale = false;

  for (const name of playerNames) {
    const gender = getGenderByName(name);

    if (gender === "Male") hasMale = true;
    if (gender === "Female") hasFemale = true;
  }

  if (hasMale && hasFemale) return "mixed";
  if (hasMale) return "men";
  if (hasFemale) return "women";

  return "unknown";
}


/* ── Rating Ring Helper ──────────────────────────────────────────────────── */
function _isGuestRoundPlayerName(name) {
  const key = String(name || '').trim().toLowerCase();
  const p = (schedulerState.allPlayers || []).find(pl => String(pl.name || '').trim().toLowerCase() === key);
  return !!(p && (p.guest || p.unrated)) || /\(guest(?:\s+[a-z0-9]+)?\)$/i.test(String(name || ''));
}

function createRatingRing(playerName, gender, ratingOverride = null) {
  const hasRatingOverride = ratingOverride !== null && ratingOverride !== undefined && Number.isFinite(Number(ratingOverride));
  if (_isGuestRoundPlayerName(playerName) && !hasRatingOverride) {
    const iconSrcGuest = gender === 'Female' ? 'female.png' : 'male.png';
    const wrapGuest = document.createElement('div');
    wrapGuest.className = 'rating-ring-wrap';
    wrapGuest.innerHTML = '<img src="' + iconSrcGuest + '" alt="' + (gender || 'Male') + '" class="gender-icon rating-ring-icon"/>';
    return wrapGuest;
  }
  const rating  = hasRatingOverride ? Number(ratingOverride) : (typeof getActiveRating === 'function' ? getActiveRating(playerName) : 1.0);
  const pct     = Math.max(0, Math.min(1, (rating - 1.0) / 4.0));
  const size    = 30;
  const r       = 13;
  const cx = size / 2, cy = size / 2;
  const circ    = 2 * Math.PI * r;
  const dash    = circ * pct;
  const gap     = circ - dash;
  const segG    = 1.5;
  const segs    = 12;
  const segL    = (circ / segs) - segG;
  let color = '#f44336';
  if (rating >= 4.0)      color = '#4caf50';
  else if (rating >= 3.0) color = '#2196f3';
  else if (rating >= 2.0) color = '#ff9800';
  const iconSrc = gender === 'Female' ? 'female.png' : 'male.png';
  const wrap = document.createElement('div');
  wrap.className = 'rating-ring-wrap';
  wrap.innerHTML = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"
         style="position:absolute;top:0;left:0;transform:rotate(-90deg)">
      <circle cx="${cx}" cy="${cy}" r="${r}"
        fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="3"
        stroke-dasharray="${segL.toFixed(1)} ${segG}"
        stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="${r}"
        fill="none" stroke="${color}" stroke-width="3"
        stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}"
        stroke-linecap="round" opacity="0.9"/>
    </svg>
    <img src="${iconSrc}" alt="${gender || 'Male'}"
         class="gender-icon rating-ring-icon"/>
  `;
  return wrap;
}

/* ── Rating Ring ── */
function createRatingRing(playerName, gender, ratingOverride = null) {
  const hasRatingOverride = ratingOverride !== null && ratingOverride !== undefined && Number.isFinite(Number(ratingOverride));
  if (_isGuestRoundPlayerName(playerName) && !hasRatingOverride) {
    const iconSrcGuest = gender === 'Female' ? 'female.png' : 'male.png';
    const wrapGuest = document.createElement('div');
    wrapGuest.className = 'rating-ring-wrap';
    wrapGuest.innerHTML = '<img src="' + iconSrcGuest + '" alt="' + (gender || 'Male') + '" class="gender-icon rating-ring-icon"/>';
    return wrapGuest;
  }
  const rating  = hasRatingOverride ? Number(ratingOverride) : (typeof getActiveRating === 'function' ? getActiveRating(playerName) : 1.0);
  const pct     = Math.max(0, Math.min(1, (rating - 1.0) / 4.0));
  const size    = 30; const r = 13; const cx = 15; const cy = 15;
  const circ    = 2 * Math.PI * r;
  const dash    = circ * pct; const gap = circ - dash;
  const segG    = 1.5; const segL = (circ / 12) - segG;
  let color = '#f44336';
  if (rating >= 4.0) color = '#4caf50';
  else if (rating >= 3.0) color = '#2196f3';
  else if (rating >= 2.0) color = '#ff9800';
  const iconSrc = gender === 'Female' ? 'female.png' : 'male.png';
  const wrap = document.createElement('div');
  wrap.className = 'rating-ring-wrap';
  wrap.innerHTML =
    '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" style="position:absolute;top:0;left:0;transform:rotate(-90deg)">' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="3" stroke-dasharray="' + segL.toFixed(1) + ' ' + segG + '" stroke-linecap="round"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="3" stroke-dasharray="' + dash.toFixed(2) + ' ' + gap.toFixed(2) + '" stroke-linecap="round" opacity="0.9"/>' +
    '</svg>' +
    '<img src="' + iconSrc + '" alt="' + (gender||'Male') + '" class="gender-icon rating-ring-icon"/>';
  return wrap;
}

// Balanced mode uses temporary per-round display ratings after resting is
// selected. These values never change the player's stored club rating.
function getBalancedUiRating(data, playerName) {
  const balanced = schedulerState && (
    schedulerState.gameGenerationMode === 'balanced' ||
    schedulerState.balancedGamesMode === true
  );
  if (!balanced || !data) return null;

  const baseName = String(playerName || '').split('#')[0];

  // Preferred path: every generated Balanced round carries the frozen map
  // created from ALL selected players before rest/court assignment.
  const frozen = data.balancedRatingMap;
  if (frozen && Object.prototype.hasOwnProperty.call(frozen, baseName)) {
    const value = Number(frozen[baseName]);
    return Number.isFinite(value) ? value : null;
  }

  // Compatibility fallback for rounds saved before the frozen-map update:
  // reproduce the same full selected-player split, never a `playing`-only
  // split.  This keeps resting and playing players in one classification.
  const active = [...new Set((schedulerState.activeplayers || [])
    .map(name => String(name).split('#')[0]))];
  const originalOrder = new Map(active.map((name, index) => [name, index]));
  const ratingOf = name => {
    const player = (schedulerState.allPlayers || []).find(item => item && item.name === name);
    const value = Number(player?.clubRating ?? player?.rating ?? 1.0);
    return Number.isFinite(value) ? value : 1.0;
  };
  active.sort((a, b) =>
    ratingOf(b) - ratingOf(a) ||
    (originalOrder.get(a) ?? 0) - (originalOrder.get(b) ?? 0)
  );
  const index = active.indexOf(baseName);
  if (index < 0) return null;
  return index < Math.ceil(active.length / 2) ? 5.0 : 2.5;
}

function appendBalancedUiRating(button, data, playerName) {
  const temporaryRating = getBalancedUiRating(data, playerName);
  if (!Number.isFinite(temporaryRating)) return;
  button.dataset.balancedRating = temporaryRating.toFixed(1);
  const badge = document.createElement('span');
  badge.className = 'balanced-ui-rating';
  badge.textContent = temporaryRating.toFixed(1);
  badge.setAttribute('aria-label', `Balanced rating ${temporaryRating.toFixed(1)}`);
  button.appendChild(badge);
}

function makeRestButton(player, data, index, interactive = true) {
  const btn = document.createElement('button');
  btn.className = 'rest-btn';

  const restName = player.displayName || player.name || '';
  // The #restCount suffix is display-only. Rating and gender lookups must use
  // the player's original base name, otherwise the lookup falls back to 1.0.
  const baseRestName = String(player.name || restName).split('#')[0];
  const basePlayer = (schedulerState.allPlayers || []).find(p => p.name === baseRestName);
  const restGender = basePlayer?.gender || player?.gender || 'Male';
  btn.appendChild(createRatingRing(baseRestName, restGender, getBalancedUiRating(data, baseRestName)));

  const label = player.displayName || player.name;
  const textNode = document.createElement('span');
  textNode.innerText = label;
  btn.appendChild(textNode);

  const restMatch = label.match(/#(\d+)/);
  const restCount = restMatch ? parseInt(restMatch[1], 10) : 0;

  if (IS_MIXED_SESSION && player?.gender) {
    const hue = player.gender === "Male" ? 200 : 330;
    const lightness = Math.min(90, 65 + restCount * 5);
    btn.style.backgroundColor = `hsl(${hue}, 70%, ${lightness}%)`;
    btn.style.color = "#000";
  } else {
    if (restMatch) {
      const hue = (restCount * 40) % 360;
      btn.style.backgroundColor = `hsl(${hue}, 60%, 85%)`;
    } else {
      btn.style.backgroundColor = '#eee';
    }
    btn.style.color = "#000";
  }

  if (!interactive) {
    btn.classList.add('rested-info-player');
    btn.type = 'button';
    btn.tabIndex = -1;
    btn.setAttribute('aria-disabled', 'true');
    return btn;
  }

  const isTemplateEditRound = !!(window.SCSOfflineRounds &&
    typeof window.SCSOfflineRounds.isTemplateEditorActive === 'function' &&
    window.SCSOfflineRounds.isTemplateEditorActive());
  const isLatestRound = index === allRounds.length - 1 || isTemplateEditRound;
  if (!isLatestRound) return btn;

  const handleTap = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const src = SwapState.player;
    if (src) {
      // Something is already selected — complete the swap
      if (src.from === 'team') {
        // Team player → resting slot: move them out, bring rest player in
        handleDropRestToTeam(e, src.teamSide, src.gameIndex, src.playerIndex, data, index, label);
        SwapState.commitPlayer();
      } else {
        // Rest → Rest: no-op, just deselect
        SwapState.clear();
      }
    } else {
      // Nothing selected — select this rest player
      SwapState.selectPlayer({ playerName: label, from: 'rest' }, btn);
    }
  };

  // iOS-quality tap: touchstart records position, touchend fires if barely moved.
  // Mobile browsers also synthesize a click after touchend; suppress that duplicate.
  let _sy = 0, _sx = 0, _lastTouchTapAt = 0;
  btn.addEventListener('touchstart', e => {
    _sy = e.touches[0].clientY;
    _sx = e.touches[0].clientX;
  }, { passive: true });
  btn.addEventListener('touchend', e => {
    const dy = Math.abs(e.changedTouches[0].clientY - _sy);
    const dx = Math.abs(e.changedTouches[0].clientX - _sx);
    if (dx < TAP_THRESHOLD && dy < TAP_THRESHOLD) {
      _lastTouchTapAt = Date.now();
      handleTap(e);
    }
  }, { passive: false });
  btn.addEventListener('click', e => {
    if (Date.now() - _lastTouchTapAt < 700) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    handleTap(e);
  });

  return btn;
}

function makePlayerButton(name, teamSide, gameIndex, playerIndex, data, index) {
  const btn = document.createElement('button');

  const baseName = name.split('#')[0];
  const player = schedulerState.allPlayers.find(p => p.name === baseName);

  btn.className = teamSide === 'L' ? 'Lplayer-btn' : 'Rplayer-btn';
  btn.appendChild(createRatingRing(baseName, player?.gender || 'Male', getBalancedUiRating(data, baseName)));

  const nameSpan = document.createElement('span');
  nameSpan.className = 'player-name';
  nameSpan.textContent = baseName;
  nameSpan.title = name;
  btn.appendChild(nameSpan);

  const isTemplateEditRound = !!(window.SCSOfflineRounds &&
    typeof window.SCSOfflineRounds.isTemplateEditorActive === 'function' &&
    window.SCSOfflineRounds.isTemplateEditorActive());
  const isLatestRound = index === allRounds.length - 1 || isTemplateEditRound;
  if (!isLatestRound) return btn;

  const handleTap = (e) => {
    // During a live winner-enabled round, the whole visible team—including
    // its player buttons—is the winner target. Player buttons previously
    // stopped propagation for swap handling, leaving only the tiny cup/empty
    // space clickable and making winner selection appear broken.
    if (currentState === 'active' && getPlayMode() === 'competitive' &&
        (typeof appMode === 'undefined' || appMode !== 'viewer')) {
      e.preventDefault();
      e.stopPropagation();
      const team = btn.closest('.team');
      if (team) team.click();
      return;
    }
    e.preventDefault();
    e.stopPropagation(); // never let tap bubble to teamDiv

    const src = SwapState.player;
    if (src) {
      // Tapping the already-selected court player again means deselect.
      // Do not route it through the swap code as a self-swap.
      const isSamePlayer =
        src.from === 'team' &&
        src.teamSide === teamSide &&
        src.gameIndex === gameIndex &&
        src.playerIndex === playerIndex;
      if (isSamePlayer) {
        SwapState.clear();
        return;
      }

      // Complete the player swap
      if (src.from === 'rest') {
        handleDropRestToTeam(e, teamSide, gameIndex, playerIndex, data, index, src.playerName);
      } else {
        handleDropBetweenTeams(e, teamSide, gameIndex, playerIndex, data, index, src);
      }
      SwapState.commitPlayer();
    } else {
      // Select this player — SwapState handles deselect-on-same-tap & cancels any team selection
      SwapState.selectPlayer({ playerName: name, teamSide, gameIndex, playerIndex, from: 'team' }, btn);
    }
  };

  let _sy = 0, _sx = 0, _lastTouchTapAt = 0;
  btn.addEventListener('touchstart', e => {
    _sy = e.touches[0].clientY;
    _sx = e.touches[0].clientX;
  }, { passive: true });
  btn.addEventListener('touchend', e => {
    const dy = Math.abs(e.changedTouches[0].clientY - _sy);
    const dx = Math.abs(e.changedTouches[0].clientX - _sx);
    if (dx < TAP_THRESHOLD && dy < TAP_THRESHOLD) {
      _lastTouchTapAt = Date.now();
      handleTap(e);
    }
  }, { passive: false });
  btn.addEventListener('click', e => {
    if (Date.now() - _lastTouchTapAt < 700) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    handleTap(e);
  });

  return btn;
}
// ── Shared team-tap handler — used by renderGames AND _renderTeamsDiv ─────────
// This is the fix for the critical bug where partial refresh (showRound same-round)
// rebuilt teamDivs via _renderTeamsDiv but lost the swap touch listeners.
function _attachTeamTapHandlers(teamDiv, teamSide, gameIndex, data, roundIndex, getGame) {
  let _sx = 0, _sy = 0;

  teamDiv.addEventListener('touchstart', e => {
    const game = getGame();
    if (game && game.winner) return;
    if (e.target.closest('.win-cup, .mbm-win-cup')) return;
    _sx = e.touches[0].clientX;
    _sy = e.touches[0].clientY;
  }, { passive: true });

  teamDiv.addEventListener('touchend', e => {
    const game = getGame();
    if (currentState === 'active') return; // live mode — no swap
    if (game && game.winner) return;
    if (e.target.closest('.win-cup, .mbm-win-cup')) return;

    // Guard: ignore touches that are part of the same sequence as a just-completed
    // player swap. iOS fires touchstart/touchend on newly mounted DOM nodes that
    // appear under the finger mid-sequence, causing ghost team selections.
    if (SwapState.touchGuarded) return;

    const dx = Math.abs(e.changedTouches[0].clientX - _sx);
    const dy = Math.abs(e.changedTouches[0].clientY - _sy);
    if (dx > TAP_THRESHOLD || dy > TAP_THRESHOLD) return; // scroll — ignore

    // If a player is mid-selection, cancel it and start team mode
    if (SwapState.player) {
      SwapState.clear();
    }

    const src = SwapState.team;
    if (src) {
      if (src.gameIndex === gameIndex && src.teamSide === teamSide) {
        // Same team tapped again → deselect
        SwapState.selectTeam({ teamSide, gameIndex }, teamDiv);
      } else {
        // Different team → execute swap
        handleTeamSwapAcrossCourts(src, { teamSide, gameIndex }, data, roundIndex);
        SwapState.commitTeam();
      }
    } else {
      SwapState.selectTeam({ teamSide, gameIndex }, teamDiv);
    }
  }, { passive: false });

  teamDiv.addEventListener('touchcancel', () => { _sx = 0; _sy = 0; }, { passive: true });
}

// ── Update restQueue after a manual player swap ──────────────────────────────
// Called whenever a player moves between rest and court mid-round.
// Only restQueue is updated — opponentMap/pairPlayedSet wait until round ends.
function _updateRestQueueForSwap(goingToRest, goingToCourt) {
  const rq = schedulerState.restQueue;
  if (!Array.isArray(rq)) return;

  // Strip any #N suffix to get base names
  const restName  = goingToRest  ? goingToRest.split('#')[0]  : null;
  const courtName = goingToCourt ? goingToCourt.split('#')[0] : null;

  // Remove both from their current positions
  const filtered = rq.filter(p => p !== restName && p !== courtName);

  // A player manually pulled from rest did not complete that rest turn.
  // Put them first so Random mode rests them in the next round.
  // The player moved off court completes the current rest at the back.
  const updated = [
    ...(courtName ? [courtName] : []),
    ...filtered,
    ...(restName  ? [restName]  : []),
  ];

  schedulerState.restQueue = updated;

  // The organiser's manual playing/resting choice is now the authoritative
  // FIFO order for subsequent rounds. Persist it immediately so reopening or
  // navigating away cannot restore the pre-swap rotation.
  if (!(window.SCSOfflineRounds && typeof window.SCSOfflineRounds.isTemplateEditorActive === 'function' && window.SCSOfflineRounds.isTemplateEditorActive())) {
    if (typeof saveSnapshot === 'function') saveSnapshot();
  }
}

// Manual swaps change the current round locally; persist that revised round
// so Player Hub devices receive the same teams/resting list as Summary.
let _manualRoundSaveTimer = null;
function _saveManualRoundChange() {
  // In Rounds Template edit mode the in-memory template is authoritative.
  // Do not sync anonymous template names to the normal live-session tables.
  if (window.SCSOfflineRounds && typeof window.SCSOfflineRounds.isTemplateEditorActive === 'function' && window.SCSOfflineRounds.isTemplateEditorActive()) {
    if (typeof window.SCSOfflineRounds.markTemplateDirty === 'function') window.SCSOfflineRounds.markTemplateDirty();
    return;
  }
  if (_manualRoundSaveTimer) clearTimeout(_manualRoundSaveTimer);
  _manualRoundSaveTimer = setTimeout(() => {
    _manualRoundSaveTimer = null;
    if (typeof saveRoundsToDb === 'function') saveRoundsToDb();
  }, 200);
}

function handleDropRestToTeam(
  e, teamSide, gameIndex, playerIndex, data, roundIndex, movingPlayer = null
) {
  const drop = !movingPlayer && e.dataTransfer
    ? JSON.parse(e.dataTransfer.getData('text/plain'))
    : { type: 'rest', player: movingPlayer };

  if (drop.type !== 'rest' || !drop.player) return;

  const teamKey = teamSide === 'L' ? 'pair1' : 'pair2';

  const newPlayer = drop.player.replace(/#\d+$/, '');
  const oldPlayer = data.games[gameIndex][teamKey][playerIndex];

  // Remove the new player from data.resting
  data.resting = data.resting.filter(p => !p.startsWith(newPlayer));

  // Insert new player into team
  data.games[gameIndex][teamKey][playerIndex] = newPlayer;

  // ---------------------------------------------
  // 🔥 schedulerState.restCount is READ-ONLY
  // ---------------------------------------------
  const { restCount } = schedulerState;

  if (oldPlayer && oldPlayer !== t('emptyGame')) {

    // Read only value
    const stored = restCount.get(oldPlayer) || 0;

    // UI number = scheduler stored + 1
    const nextNum = stored + 1;

    // Add to data.resting
    data.resting.push(`${oldPlayer}#${nextNum}`);
  }

  // Update restQueue: newPlayer just went to court, oldPlayer just went to rest
  _updateRestQueueForSwap(oldPlayer, newPlayer);

  showRound(roundIndex);
  _saveManualRoundChange();
}

function handleDropBetweenTeams(e, teamSide, gameIndex, playerIndex, data, index, src) {
  // src contains info about the player you selected first
  const { teamSide: fromTeamSide, gameIndex: fromGameIndex, playerIndex: fromPlayerIndex, playerName: player } = src;
  if (!player || player === t('emptyGame')) return;
  const fromTeamKey = fromTeamSide === 'L' ? 'pair1' : 'pair2';
  const toTeamKey = teamSide === 'L' ? 'pair1' : 'pair2';
  const fromTeam = data.games[fromGameIndex][fromTeamKey];
  const toTeam = data.games[gameIndex][toTeamKey];
  // No need to strip #index anymore
  const movedPlayer = player;
  const targetPlayer = toTeam[playerIndex];
  // ✅ Swap players
  toTeam[playerIndex] = movedPlayer;
  fromTeam[fromPlayerIndex] = targetPlayer && targetPlayer !== t('emptyGame') ? targetPlayer : t('emptyGame');

  // restQueue: both players stay on court — no rest change needed for court↔court swap.
  // Exception: if target slot was empty, movedPlayer effectively came off rest.
  if (!targetPlayer || targetPlayer === t('emptyGame')) {
    _updateRestQueueForSwap(null, movedPlayer);
  }

  showRound(index);
  _saveManualRoundChange();
}

// Add a global flag to prevent concurrent swaps
let swapInProgress = false;
const swapQueue = [];

function handleTeamSwapAcrossCourts(src, target, data, index) {
  if (!src || !target) return;
  if (src.gameIndex === target.gameIndex && src.teamSide === target.teamSide) return;

  // Queue the swap if another is in progress
  if (swapInProgress) {
    swapQueue.push({ src, target, data, index });
    return;
  }

  swapInProgress = true;

  const srcKey = src.teamSide === 'L' ? 'pair1' : 'pair2';
  const targetKey = target.teamSide === 'L' ? 'pair1' : 'pair2';

  // Fetch teams immediately before swapping
  const srcTeam = data.games[src.gameIndex][srcKey];
  const targetTeam = data.games[target.gameIndex][targetKey];

  // Animation highlight
  const srcDiv = document.querySelector(`.team[data-game-index="${src.gameIndex}"][data-team-side="${src.teamSide}"]`);
  const targetDiv = document.querySelector(`.team[data-game-index="${target.gameIndex}"][data-team-side="${target.teamSide}"]`);
  [srcDiv, targetDiv].forEach(div => {
    div.classList.add('swapping');
    setTimeout(() => div.classList.remove('swapping'), 600);
  });

  setTimeout(() => {
    // Swap teams safely using temporary variable
    const temp = data.games[src.gameIndex][srcKey];
    data.games[src.gameIndex][srcKey] = data.games[target.gameIndex][targetKey];
    data.games[target.gameIndex][targetKey] = temp;

    // Refresh the round
    showRound(index);
    _saveManualRoundChange();

    swapInProgress = false;

    // Process next swap in queue if any
    if (swapQueue.length > 0) {
      const nextSwap = swapQueue.shift();
      handleTeamSwapAcrossCourts(nextSwap.src, nextSwap.target, nextSwap.data, nextSwap.index);
    }
  }, 300);
}


/* =========================
 
MOBILE BEHAVIOR
 
========================= */
function enableTouchDrag(el) {
  let offsetX = 0, offsetY = 0;
  let clone = null;
  let isDragging = false;
  const startDrag = (x, y) => {
    const rect = el.getBoundingClientRect();
    offsetX = x - rect.left;
    offsetY = y - rect.top;
    clone = el.cloneNode(true);
    clone.style.position = 'fixed';
    clone.style.left = `${rect.left}px`;
    clone.style.top = `${rect.top}px`;
    clone.style.width = `${rect.width}px`;
    clone.style.opacity = '0.7';
    clone.style.zIndex = 9999;
    clone.classList.add('dragging');
    document.body.appendChild(clone);
    isDragging = true;
  };
  const moveDrag = (x, y) => {
    if (!clone) return;
    clone.style.left = `${x - offsetX}px`;
    clone.style.top = `${y - offsetY}px`;
  };
  const endDrag = () => {
    if (clone) {
      clone.remove();
      clone = null;
    }
    isDragging = false;
  };
  // --- Touch Events ---
  // 300ms long-press before drag activates — longer than player swap (200ms)
  // so the two interactions feel clearly distinct. Quick swipe = scroll.
  let _dragLongPressTimer = null;
  let _dragTouchStartX = 0;
  let _dragTouchStartY = 0;
  const DRAG_LONG_PRESS_MS = 300;
  const DRAG_MOVE_CANCEL_PX = 6;

  el.addEventListener('touchstart', e => {
    const touch = e.touches[0];
    _dragTouchStartX = touch.clientX;
    _dragTouchStartY = touch.clientY;
    // Don't preventDefault yet — let browser decide scroll vs drag
    _dragLongPressTimer = setTimeout(() => {
      startDrag(touch.clientX, touch.clientY);
      if (navigator.vibrate) navigator.vibrate(40); // stronger haptic than player swap
    }, DRAG_LONG_PRESS_MS);
  }, { passive: true });

  el.addEventListener('touchmove', e => {
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - _dragTouchStartX);
    const dy = Math.abs(touch.clientY - _dragTouchStartY);
    if (!isDragging) {
      // Cancel long-press if finger moved before threshold
      if (dx > DRAG_MOVE_CANCEL_PX || dy > DRAG_MOVE_CANCEL_PX) {
        clearTimeout(_dragLongPressTimer);
        _dragLongPressTimer = null;
      }
      return; // not dragging yet — don't block scroll
    }
    e.preventDefault(); // drag active — block scroll
    moveDrag(touch.clientX, touch.clientY);
  }, { passive: false });

  el.addEventListener('touchend', e => {
    clearTimeout(_dragLongPressTimer);
    _dragLongPressTimer = null;
    endDrag();
  }, { passive: true });

  el.addEventListener('touchcancel', e => {
    clearTimeout(_dragLongPressTimer);
    _dragLongPressTimer = null;
    endDrag();
  }, { passive: true });
  // --- Mouse Events ---
  el.addEventListener('mousedown', e => {
    startDrag(e.clientX, e.clientY);
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (isDragging) moveDrag(e.clientX, e.clientY);
  });
  document.addEventListener('mouseup', endDrag);
}


let interactionLocked = false; // Always unlocked — pill hidden

// Apply initial state
// document.body.classList.add('locked'); // Always unlocked

const lockBtn = document.getElementById('lockToggleBtn');

lockBtn.addEventListener('click', () => {
  if (typeof appMode !== 'undefined' && appMode === 'viewer') return;
  // Cannot unlock during active round
  if (currentState === "active") return;
  interactionLocked = !interactionLocked;
  document.body.classList.toggle('locked', interactionLocked);
  lockBtn.src = interactionLocked ? 'lock.png' : 'unlock.png';
  lockBtn.alt = interactionLocked ? 'Lock' : t('unlockBtn');
  _syncModeBanner();
  _syncShuffleBtn();
});

// ── Mode banner sync ──────────────────────────────────────────
function undoStartRound() {
  if (currentState !== 'active') return;
  stopRoundTimer(true);
  currentState = 'idle';

  // Re-enable all disabled elements
  document.querySelectorAll('.disabled').forEach(el => {
    el.style.pointerEvents = '';
    el.classList.remove('disabled');
  });
  document.querySelectorAll('.team').forEach(el => {
    el.style.pointerEvents = '';
  });

  // Hide win cups
  document.querySelectorAll('.win-cup').forEach(cup => {
    cup.style.pointerEvents = 'none';
    cup.style.visibility = 'hidden';
  });

  // Clear winners from current round
  const round = allRounds[currentRoundIndex];
  if (round && round.games) {
    round.games.forEach(g => { g.winner = undefined; g.winners = []; });
  }

  // Reset button to idle state
  const btn    = document.getElementById('nextBtn');
  const textEl = document.getElementById('btnText');
  const icon   = btn ? btn.querySelector('.icon') : null;
  if (btn)    { btn.classList.add('start-state'); btn.classList.remove('end', 'round-active'); }
  if (textEl) textEl.textContent = currentRoundIndex === 0 ? (t('startGame') || 'Start') : (t('playRound') || 'Play Round');
  if (icon)   icon.textContent = ' ▶';

  document.getElementById('roundsPage')?.classList.remove('active-mode');
  _syncModeBanner();
  _syncShuffleBtn();
  if (typeof saveSnapshot === 'function') saveSnapshot();
}

function _syncModeBanner() {
  const badge = document.getElementById('roundModeBadge');

  // Show/hide stop pill
  const stopBtn = document.getElementById('stopRoundBtn');
  if (stopBtn) stopBtn.style.display = currentState === 'active' ? 'flex' : 'none';

  if (!badge) return;

  if (currentState === "active") {
    badge.className = 'mode-banner-badge live-mode';
    badge.textContent = t('liveBadge') || 'LIVE';
  } else if (!interactionLocked) {
    badge.className = 'mode-banner-badge setup-mode';
    badge.textContent = t('setupBadge') || 'SETUP';
  } else {
    badge.className = 'mode-banner-badge ready-mode';
    badge.textContent = t('readyBadge') || 'READY';
  }
}

// ── Shuffle button sync ───────────────────────────────────────
function _syncShuffleBtn() {
  const btn = document.getElementById('roundShufle');
  if (!btn) return;
  // Shuffle allowed in idle regardless of lock state; disabled during active round
  const allow = currentState !== "active";
  btn.disabled = !allow;
  btn.classList.toggle('disabled-btn', !allow);
}









function getPlayMode() {
  return document.getElementById("modeToggle").checked
    ? "competitive"
    : "random";
}

function getGameGenerationMode() {
  const savedMode = localStorage.getItem("gameGenerationMode");
  if (savedMode === "balanced") return "balanced";
  // Legacy Unique mode is now part of Standard mode.
  return "standard";
}

function getStandardGamesMode() {
  return getGameGenerationMode() === "standard";
}

function getUniquePairMode() {
  // Default ON to preserve the established Standard behaviour.
  return localStorage.getItem("uniquePairMode") !== "off";
}

function setUniquePairMode(enabled, persist) {
  const on = enabled !== false;
  if (persist !== false) localStorage.setItem("uniquePairMode", on ? "on" : "off");
  if (typeof schedulerState !== "undefined") schedulerState.uniqueGamesMode = on;
  if (persist !== false && typeof allRounds !== "undefined" && allRounds.length && typeof saveSnapshot === "function") {
    saveSnapshot();
  }
}

function generateBalancedGames() {
  // Balanced generation is performed by the stateless worker.
  // This function keeps the UI mode hook active.
  return true;
}

function syncGameGenerationRadios(mode) {
  document.querySelectorAll('input[type="radio"][value="' + mode + '"]').forEach(radio => {
    if (radio.name === "homeGameGenerationMode" || radio.name === "roundGameGenerationMode") {
      radio.checked = true;
    }
  });
}

function setGameGenerationMode(mode, persist) {
  // The app now has exactly two generation modes: Standard and Balanced.
  // Any legacy "unique" value is migrated to Standard.
  const selected = mode === "balanced" ? "balanced" : "standard";
  syncGameGenerationRadios(selected);
  if (persist !== false) localStorage.setItem("gameGenerationMode", selected);

  // Standard uses the existing combined standard + unique-game scheduler path.
  const standardEnabled = selected === "standard";
  if (typeof schedulerState !== "undefined") {
    schedulerState.gameGenerationMode = selected;
    schedulerState.standardGamesMode = standardEnabled;
    schedulerState.balancedGamesMode = !standardEnabled;
  }

  if (persist !== false && typeof allRounds !== "undefined" && allRounds.length && typeof saveSnapshot === "function") {
    saveSnapshot();
  }

  if (selected === "balanced") generateBalancedGames();
}


// Build 527: robust touch/click wiring for both Game Generation radio groups.
// The inline change handlers remain as a fallback; this listener guarantees
// selection also works when tapping the text or anywhere in the row on iOS PWA.
document.addEventListener("change", function (event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type !== "radio") return;
  if (target.name !== "homeGameGenerationMode" && target.name !== "roundGameGenerationMode") return;
  setGameGenerationMode(target.value, true);
});

document.addEventListener("click", function (event) {
  const row = event.target.closest && event.target.closest(".game-mode-radio-row");
  if (!row) return;
  const radio = row.querySelector('input[type="radio"]');
  if (!radio || radio.disabled) return;
  if (!radio.checked) {
    radio.checked = true;
    setGameGenerationMode(radio.value, true);
  }
});

const modeToggle = document.getElementById("modeToggle");
const modeLabel  = document.getElementById("modeLabel");

// Restore saved winner-marking mode
modeToggle.checked = localStorage.getItem("playMode") === "competitive";
updateModeLabel();
toggleMinRoundsVisibility(); // ← restore on load

modeToggle.addEventListener("change", () => {
  localStorage.setItem("playMode", getPlayMode());
  updateModeLabel();
  toggleMinRoundsVisibility();
  document.querySelectorAll('#stepModeToggle').forEach(toggle => { toggle.checked = modeToggle.checked; });
  if (currentState === "active") {
    const isComp = getPlayMode() === 'competitive';
    document.querySelectorAll('.win-cup').forEach(cup => {
      cup.style.display       = isComp ? ''        : 'none';
      cup.style.visibility    = isComp ? 'visible'  : 'hidden';
      cup.style.pointerEvents = isComp ? 'auto'     : 'none';
    });
  }
});

// Restore and synchronize the two game-generation radio groups.
setGameGenerationMode(getGameGenerationMode(), false);

// Min Rounds value
// minRoundsRow removed from UI -- no warm-up concept



function toggleMinRoundsVisibility() {
  // no-op: minRoundsRow removed
}

function updateModeLabel() {
  const lbl = document.getElementById('modeLabel');
  if (lbl) lbl.textContent = "";
}

// Check if all games in current round have winners -- enable End button
function checkAllWinnersMarked() {
  const round = allRounds[currentRoundIndex];
  if (!round || !round.games || !round.games.length) return;
  const allMarked = round.games.every(g => g.winner);
  const endBtn = document.getElementById('endBtn');
  if (endBtn) {
    endBtn.style.opacity = allMarked ? '1' : '';
    endBtn.style.boxShadow = allMarked ? '0 0 0 2px #2dce89' : '';
    endBtn.title = allMarked ? '' : '';
  }
  // Save snapshot whenever winner state changes
  if (typeof saveSnapshot === 'function') saveSnapshot();
}

// toggleRoundSettings -- unified version
function toggleRoundSettings() {
  const overlay = document.getElementById('roundSettingsOverlay');
  if (!overlay) return;
  const isOpen = overlay.style.display === 'flex';
  if (isOpen) {
    closeRoundSettings();
  } else {
    overlay.style.display = 'flex';
    updateGearPairsSub();
    // Sync courts variable from schedulerState before updating buttons
    if (typeof courts !== 'undefined' && schedulerState && schedulerState.numCourts) {
      courts = schedulerState.numCourts;
      const el = document.getElementById('num-courts');
      if (el) el.textContent = courts;
    }
    if (typeof updateCourtButtons === 'function') updateCourtButtons();
  }
}

function closeRoundSettings(e) {
  // Called directly from × button (no event) or from overlay backdrop click
  if (e && e.target !== document.getElementById('roundSettingsOverlay')) return;
  const overlay = document.getElementById('roundSettingsOverlay');
  if (overlay) overlay.style.display = 'none';
}

function showRoundHistory() {
  renderRoundHistory();
  const overlay = document.getElementById('roundHistoryOverlay');
  if (overlay) overlay.style.display = 'flex';
}

function closeRoundHistory(e) {
  // Called directly from × button (no event) or from overlay backdrop click
  if (e && e.target !== document.getElementById('roundHistoryOverlay')) return;
  const overlay = document.getElementById('roundHistoryOverlay');
  if (overlay) overlay.style.display = 'none';
}

/* ── Update Fixed Pairs subtitle in gear panel ── */
function updateGearPairsSub() {
  const el = document.getElementById('gearSubPairs');
  if (!el) return;
  const n = (typeof schedulerState !== 'undefined' && schedulerState.fixedPairs)
    ? schedulerState.fixedPairs.length : 0;
  el.textContent = n > 0
    ? n + ' ' + (n === 1 ? (t('pairSet')||'pair set') : (t('pairsSet')||'pairs set'))
    : (t('optional')||'Optional');
}

/* ── Round History -- same style as Summary, no ranking, newest first ── */
function renderRoundHistory() {
  const container = document.getElementById('roundHistoryContainer');
  if (!container) return;
  container.innerHTML = '';

  if (!Array.isArray(allRounds) || allRounds.length === 0) return;

  // Only show PAST completed rounds -- skip current active round
  // A round is completed if all its games have a winner marked
  const pastRounds = [];
  for (let i = 0; i < allRounds.length; i++) {
    const round = allRounds[i];
    if (!round || !round.games || !round.games.length) continue;
    if (i === currentRoundIndex) continue;
    pastRounds.push({ round, index: i });
  }

  if (!pastRounds.length) return;

  // Visual separator between settings and rounds history
  const sep = document.createElement('div');
  sep.style.cssText = 'margin:14px 0 10px;border-top:1px solid var(--border2);padding-top:12px;';
  const sepLabel = document.createElement('div');
  sepLabel.style.cssText = 'font-size:0.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-bottom:8px;';
  sepLabel.textContent = t('roundsLabel') || 'Round History';
  sep.appendChild(sepLabel);
  container.appendChild(sep);

  // Set _vRoundsData so _vBuildRound can work
  window._vRoundsData = allRounds;

  // Render past rounds newest first
  for (let i = pastRounds.length - 1; i >= 0; i--) {
    if (typeof _vBuildRound === 'function') {
      const roundEl = _vBuildRound(pastRounds[i].round);
      container.appendChild(roundEl);
    }
  }
}

// ── Points helpers ────────────────────────────────────────────
function applyResult(player, isWin, rankPoints, streakMap) {
  const streak = streakMap.get(player) || 0;
  let delta = isWin ? 2 : -2;
  if (isWin && streak > 0)  delta += 1;
  if (!isWin && streak < 0) delta -= 1;
  streakMap.set(player, isWin ? Math.max(streak, 0) + 1 : Math.min(streak, 0) - 1);
  rankPoints.set(player, (rankPoints.get(player) || 100) + delta);
}

function updatePointsAfterRound(state) {
  const round = allRounds[allRounds.length - 1];
  if (!round?.games) return;
  for (const game of round.games) {
    if (!game.winner || !game.pair1 || !game.pair2) continue;
    const winners = game.winner === 'L' ? game.pair1 : game.pair2;
    const losers  = game.winner === 'L' ? game.pair2 : game.pair1;
    for (const p of winners) applyResult(p, true,  state.rankPoints, state.streakMap);
    for (const p of losers)  applyResult(p, false, state.rankPoints, state.streakMap);
  }
}

/* ── Court Type Pill Functions ── */

// Build 851: prepared Offline Round sessions are read-only at court level.
// Keep the online Round Manager controls and behaviour unchanged.
function _isOfflinePreparedRoundLocked() {
  try {
    return sessionStorage.getItem('scsOfflineRoundModeActive') === '1';
  } catch (_) {
    return false;
  }
}

// Doubles types
const _CTP_DOUBLES = [
  { key: 'free', label: 'Free', cls: 'ctp-free' },
  { key: 'MD',   label: 'MD',   cls: 'ctp-md'   },
  { key: 'LD',   label: 'LD',   cls: 'ctp-ld'   },
  { key: 'XD',   label: 'XD',   cls: 'ctp-xd'   },
];
// Singles types
const _CTP_SINGLES = [
  { key: 'singles-free', label: 'Free',  cls: 'ctp-free'   },
  { key: 'singles-men',  label: 'Men',   cls: 'ctp-md'     },
  { key: 'singles-women',label: 'Women', cls: 'ctp-ld'     },
];
// Combined lookup
const _CTP_ALL = [..._CTP_DOUBLES, ..._CTP_SINGLES];

// Get court index from pill button (0-based)
function _ctpCourtIndex(btn) {
  const courtCard = btn.closest('.courtcard') || btn.closest('.mbm-court-card');
  if (!courtCard) return -1;
  // Rounds page: court-N class; MBM: data-court-idx
  const match = courtCard.className.match(/court-(\d+)/);
  if (match) return parseInt(match[1]) - 1;
  if (courtCard.dataset.courtIdx !== undefined) return parseInt(courtCard.dataset.courtIdx);
  return -1;
}

// Get which types are currently enabled for a court index
function _ctpEnabledTypes(courtIdx) {
  if (typeof schedulerState === 'undefined') return ['free'];
  const allPlayers    = schedulerState.allPlayers || [];
  const activePlayers = Array.from(schedulerState.activeplayers || []);
  const courtTypes    = schedulerState.courtTypes || [];
  const numCourts     = schedulerState.numCourts || 0;
  const restQueue     = Array.isArray(schedulerState.restQueue) ? schedulerState.restQueue : [];

  function getGender(name) {
    const p = allPlayers.find(p => p.name === name);
    return p ? p.gender : null;
  }

  // Use ALL active players (not just playing) for pill availability
  // Court type overrides rest queue — algorithm picks best gender players
  const totalMen   = activePlayers.filter(p => getGender(p) === 'Male').length;
  const totalWomen = activePlayers.filter(p => getGender(p) === 'Female').length;

  // Consume players from courts before this one
  let usedMen = 0, usedWomen = 0, usedAny = 0;
  for (let i = 0; i < courtIdx; i++) {
    const t = courtTypes[i] || 'free';
    if (t === 'MD')                 { usedMen += 4; usedAny += 4; }
    else if (t === 'LD')            { usedWomen += 4; usedAny += 4; }
    else if (t === 'XD')            { usedMen += 2; usedWomen += 2; usedAny += 4; }
    else if (t === 'singles-free')  { usedAny += 2; }
    else if (t === 'singles-men')   { usedMen += 2; usedAny += 2; }
    else if (t === 'singles-women') { usedWomen += 2; usedAny += 2; }
    else                            { usedAny += 4; } // free doubles
  }

  const remMen   = totalMen   - usedMen;
  const remWomen = totalWomen - usedWomen;
  const remTotal = (totalMen + totalWomen) - usedAny;

  // Get format for this court
  const fmt = (schedulerState.courtFormats || [])[courtIdx] || 'doubles';

  if (fmt === 'singles') {
    const enabled = ['singles-free'];
    if (remMen   >= 2) enabled.push('singles-men');
    if (remWomen >= 2) enabled.push('singles-women');
    return enabled;
  } else {
    const enabled = ['free'];
    if (remMen   >= 4)                  enabled.push('MD');
    if (remWomen >= 4)                  enabled.push('LD');
    if (remMen   >= 2 && remWomen >= 2) enabled.push('XD');
    return enabled;
  }
}

// Cycle to next available type
function ctpCycle(btn) {
  if (_isOfflinePreparedRoundLocked()) return;
  const idx = _ctpCourtIndex(btn);
  if (idx < 0) return;
  if (!Array.isArray(schedulerState.courtTypes)) schedulerState.courtTypes = [];

  const enabled    = _ctpEnabledTypes(idx);
  const current    = schedulerState.courtTypes[idx] || 'free';
  const currentPos = enabled.indexOf(current);
  const nextKey    = enabled[(currentPos + 1) % enabled.length];

  // Update state
  schedulerState.courtTypes[idx] = nextKey;

  // Update pill label + color class
  const typeInfo = _CTP_ALL.find(t => t.key === nextKey) || _CTP_ALL[0];
  btn.textContent = typeInfo.label + ' ▾';
  btn.className   = 'ctp ctp-cycle ' + typeInfo.cls;

  // Recalculate subsequent courts
  updateCourtPills();
}

// Called by updateCourtPills to refresh pill label/class without cycling
function _ctpRefreshBtn(btn, courtIdx) {
  const type     = (schedulerState.courtTypes || [])[courtIdx] || 'free';
  const enabled  = _ctpEnabledTypes(courtIdx);
  // If current type no longer enabled, reset to free
  const finalType = enabled.includes(type) ? type : 'free';
  if (finalType !== type) schedulerState.courtTypes[courtIdx] = finalType;
  const typeInfo  = _CTP_ALL.find(t => t.key === finalType) || _CTP_ALL[0];
  btn.textContent = typeInfo.label + ' ▾';
  btn.className   = 'ctp ctp-cycle ' + typeInfo.cls;
}

// Cycle format between Doubles and Singles
async function ctpFormatCycle(btn) {
  if (_isOfflinePreparedRoundLocked()) return;
  const courtCard = btn.closest('.courtcard') || btn.closest('.mbm-court-card');
  if (!courtCard) return;
  // Rounds page uses court-N class; MBM uses data-court-idx
  let idx;
  const match = courtCard.className.match(/court-(\d+)/);
  if (match) {
    idx = parseInt(match[1]) - 1;
  } else if (courtCard.dataset.courtIdx !== undefined) {
    idx = parseInt(courtCard.dataset.courtIdx);
  } else return;

  if (!Array.isArray(schedulerState.courtFormats)) schedulerState.courtFormats = [];
  const current = schedulerState.courtFormats[idx] || 'doubles';
  const next    = current === 'doubles' ? 'singles' : 'doubles';

  const roundsPageEl = document.getElementById('roundsPage');
  const roundsPageOpen = roundsPageEl && roundsPageEl.style.display !== 'none';
  if (roundsPageOpen && typeof currentState !== 'undefined' && currentState === 'active') return;
  if (roundsPageOpen && typeof roundCanUseFormat === 'function' && !roundCanUseFormat(idx, next)) {
    alert('Not enough selected players to change this court to Doubles.');
    return;
  }

  // Save new format
  schedulerState.courtFormats[idx] = next;

  // Update button label + class
  btn.textContent = next === 'singles' ? t('singles') + ' ▾' : t('doubles') + ' ▾';
  btn.className   = 'ctp ctp-fmt-cycle ' + (next === 'singles' ? 'ctp-fmt-singles' : 'ctp-fmt-doubles');

  // Reset type pill to free for new format
  if (!Array.isArray(schedulerState.courtTypes)) schedulerState.courtTypes = [];
  schedulerState.courtTypes[idx] = next === 'singles' ? 'singles-free' : 'free';

  // Refresh type pill
  const cyclePill = courtCard.querySelector('.ctp-cycle');
  if (cyclePill) _ctpRefreshBtn(cyclePill, idx);

  updateCourtPills();
  if (typeof updateCourtButtons === 'function') updateCourtButtons();

  // MBM: clear court players and rebuild shell for new format
  const mbmPageEl = document.getElementById('mbmPage');
  if (mbmPageEl && mbmPageEl.style.display !== 'none') {
    const data = allRounds[currentRoundIndex];
    if (data && data.games[idx]) {
      // Return players to waiting queue
      const freed = (data.games[idx].pair1 || []).concat(data.games[idx].pair2 || []);
      freed.forEach(function(p) {
        if (p && !mbmWaitingQueue.includes(p)) mbmWaitingQueue.push(p);
      });
      data.games[idx] = { pair1: [], pair2: [], court: idx + 1 };
    }
    if (typeof mbmBuildShells === 'function') mbmBuildShells(true);
    if (typeof mbmFillAllSlots === 'function') mbmFillAllSlots();
    if (typeof mbmRenderWaiting === 'function') mbmRenderWaiting();
  } else if (roundsPageOpen && typeof regenerateCurrentRoundForCourtSetup === 'function') {
    await regenerateCurrentRoundForCourtSetup();
  }
}

/* ── Cascading pill refresh ── */
function updateCourtPills() {
  if (typeof schedulerState === 'undefined') return;
  const numCourts = schedulerState.numCourts || 0;
  for (let i = 0; i < numCourts; i++) {
    const courtCard = document.querySelector(`.courtcard.court-${i + 1}`);
    if (!courtCard) continue;

    // Restore format button (Doubles/Singles)
    const fmtBtn = courtCard.querySelector('.ctp-fmt-cycle');
    if (fmtBtn) {
      const fmt = (schedulerState.courtFormats || [])[i] || 'doubles';
      const offlineLocked = _isOfflinePreparedRoundLocked();
      fmtBtn.textContent = fmt === 'singles' ? t('singles') + (offlineLocked ? '' : ' ▾') : t('doubles') + (offlineLocked ? '' : ' ▾');
      fmtBtn.className   = 'ctp ctp-fmt-cycle ' + (fmt === 'singles' ? 'ctp-fmt-singles' : 'ctp-fmt-doubles') + (offlineLocked ? ' ctp-fixed' : '');
    }

    // Restore type pill (Free/MD/LD/XD/Singles-Free/Men/Women)
    const typeBtn = courtCard.querySelector('.ctp-cycle');
    if (!typeBtn) continue;
    if (_isOfflinePreparedRoundLocked()) {
      const type = (schedulerState.courtTypes || [])[i] || 'free';
      const typeInfo = _CTP_ALL.find(t => t.key === type) || _CTP_ALL[0];
      typeBtn.textContent = typeInfo.label;
      typeBtn.className = 'ctp ctp-cycle ' + typeInfo.cls + ' ctp-fixed';
    } else {
      _ctpRefreshBtn(typeBtn, i);
    }
  }
}


// Build 530: expandable Round Settings card on the Organiser dashboard.
function setOrgRoundSettingsExpanded(expanded, persist) {
  const card = document.getElementById('organiserCourtsCard');
  const header = document.getElementById('orgRoundSettingsHeader');
  const body = document.getElementById('orgRoundSettingsBody');
  if (!card || !header || !body) return;

  card.classList.toggle('is-collapsed', !expanded);
  header.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  body.setAttribute('aria-hidden', expanded ? 'false' : 'true');

  if (persist !== false) {
    try { localStorage.setItem('scsOrgRoundSettingsExpanded', expanded ? '1' : '0'); } catch (_) {}
  }
}

function toggleOrgRoundSettings() {
  const card = document.getElementById('organiserCourtsCard');
  if (!card) return;
  setOrgRoundSettingsExpanded(card.classList.contains('is-collapsed'), true);
}

document.addEventListener('DOMContentLoaded', function () {
  let expanded = false;
  try { expanded = localStorage.getItem('scsOrgRoundSettingsExpanded') === '1'; } catch (_) {}
  setOrgRoundSettingsExpanded(expanded, false);
});
