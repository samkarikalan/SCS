/* ══════════════════════════════════════════════════════
   MBM.JS — Rolling Matches Mode
   Court cards built ONCE on init.
   Swaps only update slot content — no DOM rebuild.
   ══════════════════════════════════════════════════════ */

var mbmWaitingQueue   = [];
var mbmCompletedGames = []; // kept for compatibility
var mbmRounds         = []; // identical shape to allRounds — MBM history, report, repetition
var mbmCourtStates    = {};
var mbmPlayCount      = new Map();
var mbmScheduleCount  = new Map();
var mbmSinglesCount   = new Map(); // tracks singles games only

/* ══ SLOT IDs ══
   Each player slot has a stable ID:
   mbm-slot-{courtIdx}-{side}-{slotIdx}   e.g. mbm-slot-0-L-0
   Waiting buttons:  mbm-wait-{queueIdx}  rebuilt on queue change (small list, fine)
*/

/* ── Init: build court shells once ── */
function mbmShowRound() {
  // Sync court count display
  var countEl = document.getElementById('mbmCourtCount');
  if (countEl) countEl.textContent = schedulerState.numCourts || 1;
  mbmSyncPlayers();     // always sync active players on entry first
  mbmBuildShells(true); // force rebuild shells (courts/players may have changed)
  mbmFillAllSlots();
  mbmRenderWaiting();
}

/* ── Build fixed court card shells (called once per session) ── */
function mbmBuildShells(force) {
  var container = document.getElementById('mbm-game-results');
  if (!container) return;
  var data = allRounds[currentRoundIndex];
  if (!data || !data.games) return;

  // Rebuild if forced or court count changed
  var existing = container.querySelectorAll('.mbm-court-wrapper');
  if (!force && existing.length === data.games.length) return;

  container.innerHTML = '';
  data.games.forEach(function(game, idx) {
    container.appendChild(_mbmBuildShell(idx));
  });
}

function _mbmBuildShell(idx) {
  var fmt      = (schedulerState.courtFormats || [])[idx] || 'doubles';
  var type     = (schedulerState.courtTypes   || [])[idx] || 'free';
  var fmtLabel = fmt === 'singles' ? 'Singles' : 'Doubles';
  var typeLabel = type.charAt(0).toUpperCase() + type.slice(1);

  var wrapper = document.createElement('div');
  wrapper.className = 'mbm-court-wrapper';
  wrapper.dataset.courtIdx = idx;

  var header = document.createElement('div');
  header.className = 'courtname';
  header.innerHTML =
    '<span class="court-label">Court ' + (idx + 1) + '</span>' +
    '<span class="court-header-right">' +
      '<button class="ctp ctp-fmt-cycle ctp-fmt-' + fmt + '" onclick="ctpFormatCycle(this)">' + fmtLabel + ' ▾</button>' +
      '<button class="ctp ctp-cycle ctp-' + type + '" onclick="ctpCycle(this)">' + typeLabel + ' ▾</button>' +
    '</span>';

  // Build team divs with empty slots
  var teamsDiv = document.createElement('div');
  teamsDiv.className = 'teams';

  var makeTeamDiv = function(side, slotCount) {
    var div = document.createElement('div');
    div.className = 'team';
    div.dataset.teamSide = side;
    for (var i = 0; i < slotCount; i++) {
      div.appendChild(_mbmMakeSlot(idx, side, i));
    }
    return div;
  };

  var fmt2 = (schedulerState.courtFormats || [])[idx] || 'doubles';
  var slotsPerSide = fmt2 === 'singles' ? 1 : 2;

  var vs = document.createElement('div');
  vs.className = 'vs-divider';
  vs.innerHTML = '<div class="vs-line"></div><span>VS</span><div class="vs-line"></div>';

  teamsDiv.appendChild(makeTeamDiv('L', slotsPerSide));
  teamsDiv.appendChild(vs);
  teamsDiv.appendChild(makeTeamDiv('R', slotsPerSide));

  var btns = document.createElement('div');
  btns.className = 'mbm-court-btns';
  var makeBtn = function(label, cls, fn) {
    var b = document.createElement('button');
    b.className = 'mbm-btn ' + cls;
    b.innerHTML = label;
    b.addEventListener('click', (function(i) { return function() { fn(i); }; })(idx));
    return b;
  };
  btns.appendChild(makeBtn('▶ Play',   'mbm-play',   mbmPlay));
  btns.appendChild(makeBtn('✓ Finish', 'mbm-finish', mbmFinish));
  btns.appendChild(makeBtn('⏹ Stop',  'mbm-stop',   mbmStop));
  btns.appendChild(makeBtn('🎲',       'mbm-dice',   mbmDice));
  btns.appendChild(makeBtn('✕',        'mbm-clear',  mbmClear));

  var card = document.createElement('div');
  card.className = 'courtcard mbm-court-card court-' + (idx + 1);
  card.dataset.courtIdx = idx;
  card.dataset.mbmState = 'empty';

  mbmApplyBtnState(btns, 'empty');
  card.append(header, teamsDiv, btns);
  wrapper.appendChild(card);
  return wrapper;
}

/* ── Make a single player slot button (empty initially) ── */
function _mbmMakeSlot(courtIdx, side, slotIdx) {
  var btn = document.createElement('button');
  btn.className = side === 'L' ? 'Lplayer-btn' : 'Rplayer-btn';
  btn.id = 'mbm-slot-' + courtIdx + '-' + side + '-' + slotIdx;
  btn.dataset.courtIdx = courtIdx;
  btn.dataset.side = side;
  btn.dataset.slotIdx = slotIdx;
  btn.dataset.playerName = '';

  // Rating ring placeholder
  var ring = document.createElement('span');
  ring.className = 'mbm-slot-ring';
  btn.appendChild(ring);

  var nameSpan = document.createElement('span');
  nameSpan.className = 'player-name';
  btn.appendChild(nameSpan);

  var badge = document.createElement('span');
  badge.className = 'mbm-play-count';
  badge.style.display = 'none';
  btn.appendChild(badge);

  btn.addEventListener('click', _mbmSlotClick);
  var _sy = 0, _lastTouch = 0;
  btn.addEventListener('touchstart', function(e) { _sy = e.touches[0].clientY; }, { passive: true });
  btn.addEventListener('touchend', function(e) {
    if (Math.abs(e.changedTouches[0].clientY - _sy) < 10) {
      if (Date.now() - _lastTouch > 400) { _lastTouch = Date.now(); _mbmSlotClick.call(btn, e); }
    }
  }, { passive: false });

  return btn;
}

/* ── Fill all slots from data (non-destructive — only updates text/icon) ── */
function mbmFillAllSlots() {
  var data = allRounds[currentRoundIndex];
  if (!data || !data.games) return;
  data.games.forEach(function(game, idx) {
    _mbmFillCourtSlots(idx, game);
  });
}

function _mbmFillCourtSlots(idx, game) {
  var pair1 = game.pair1 || [];
  var pair2 = game.pair2 || [];
  _mbmFillSide(idx, 'L', pair1);
  _mbmFillSide(idx, 'R', pair2);

  // Update card state
  var hasPlayers = pair1.length > 0 || pair2.length > 0;
  var state = hasPlayers ? (mbmCourtStates[idx] || 'ready') : 'empty';
  mbmCourtStates[idx] = state;
  var card = document.querySelector('#mbm-game-results .mbm-court-card[data-court-idx="' + idx + '"]');
  if (card) {
    card.dataset.mbmState = state;
    card.classList.toggle('mbm-live', state === 'live');
    mbmApplyBtnState(card.querySelector('.mbm-court-btns'), state);
  }

  // ── Repetition highlighting (same logic as rounds page) ──
  _mbmCheckRepetition(idx, pair1, pair2, card);
}

function _mbmCheckRepetition(idx, pair1, pair2, card) {
  if (!card) return;

  var teamL = card.querySelector('.team[data-team-side="L"]');
  var teamR = card.querySelector('.team[data-team-side="R"]');
  if (teamL) { teamL.classList.remove('repeated-pair'); teamL.classList.remove('fixed-pair'); }
  if (teamR) { teamR.classList.remove('repeated-pair'); teamR.classList.remove('fixed-pair'); }
  card.classList.remove('repeated-game');

  if (!pair1.length || !pair2.length) return;

  // Build lookup sets from mbmRounds (finished matches) + currently-live courts
  // (a pair already playing on another live court also counts as "already paired")
  var pairSet = new Set();
  var gameSet = new Set();
  mbmRounds.forEach(function(r) {
    (r.games || []).forEach(function(g) {
      var k1 = (g.pair1 || []).slice().sort().join('&');
      var k2 = (g.pair2 || []).slice().sort().join('&');
      if (k1) pairSet.add(k1);
      if (k2) pairSet.add(k2);
      if (k1 && k2) gameSet.add([k1, k2].sort().join(':'));
    });
  });

  var liveData = allRounds[currentRoundIndex];
  if (liveData && liveData.games) {
    liveData.games.forEach(function(g, gi) {
      if (gi === idx) return; // skip this court itself
      var k1 = (g.pair1 || []).slice().sort().join('&');
      var k2 = (g.pair2 || []).slice().sort().join('&');
      if (k1) pairSet.add(k1);
      if (k2) pairSet.add(k2);
      if (k1 && k2) gameSet.add([k1, k2].sort().join(':'));
    });
  }

  // Pair repetition — skip if this team is a configured fixed pair
  if (pair1.length >= 2) {
    if (typeof isFixedPair === 'function' && isFixedPair(pair1[0], pair1[1])) {
      if (teamL) teamL.classList.add('fixed-pair');
    } else {
      var k1 = pair1.slice().sort().join('&');
      if (pairSet.has(k1) && teamL) teamL.classList.add('repeated-pair');
    }
  }
  if (pair2.length >= 2) {
    if (typeof isFixedPair === 'function' && isFixedPair(pair2[0], pair2[1])) {
      if (teamR) teamR.classList.add('fixed-pair');
    } else {
      var k2 = pair2.slice().sort().join('&');
      if (pairSet.has(k2) && teamR) teamR.classList.add('repeated-pair');
    }
  }

  // Full game repetition
  if (pair1.length >= 2 && pair2.length >= 2) {
    var gk1 = pair1.slice().sort().join('&');
    var gk2 = pair2.slice().sort().join('&');
    if (gameSet.has([gk1, gk2].sort().join(':'))) {
      card.classList.add('repeated-game');
    }
  }
}

function _mbmFillSide(courtIdx, side, players) {
  var slotsPerSide = players.length || ((schedulerState.courtFormats || [])[courtIdx] === 'singles' ? 1 : 2);
  for (var i = 0; i < slotsPerSide; i++) {
    var slotId = 'mbm-slot-' + courtIdx + '-' + side + '-' + i;
    var btn = document.getElementById(slotId);
    if (!btn) continue;
    var name = players[i] || '';
    _mbmUpdateSlot(btn, name);
  }
}

/* ── Update a single slot's content (name, icon, badge) ── */
function _mbmUpdateSlot(btn, name) {
  var baseName = name ? name.split('#')[0] : '';
  btn.dataset.playerName = name;

  // Rating ring
  var ring = btn.querySelector('.mbm-slot-ring');
  if (ring) {
    ring.innerHTML = '';
    if (name && typeof createRatingRing === 'function') {
      var playerObj = (schedulerState.allPlayers || []).find(function(x) { return x.name === baseName; });
      var gender = playerObj ? playerObj.gender : 'Male';
      ring.appendChild(createRatingRing(name, gender));
    }
  }

  // Name
  var nameSpan = btn.querySelector('.player-name');
  if (nameSpan) nameSpan.textContent = baseName;

  // Play count badge
  var badge = btn.querySelector('.mbm-play-count');
  if (badge) {
    var count = name ? (mbmPlayCount.get(baseName) || 0) : 0;
    if (count > 0) { badge.textContent = count; badge.style.display = ''; }
    else badge.style.display = 'none';
  }

  // Dim empty slots
  btn.style.opacity = name ? '1' : '0.25';
  btn.style.pointerEvents = name ? '' : 'none';
}

/* ── Single unified tap handler for all court slots ── */
function _mbmSlotClick(e) {
  e.preventDefault();
  e.stopPropagation();
  var btn = this;
  var courtIdx = parseInt(btn.dataset.courtIdx);
  var side     = btn.dataset.side;
  var slotIdx  = parseInt(btn.dataset.slotIdx);
  var name     = btn.dataset.playerName;

  if (!name) return; // empty slot — ignore
  if (mbmCourtStates[courtIdx] === 'live') return; // live court locked

  if (window.selectedPlayer) {
    var src = window.selectedPlayer;
    _mbmClearSel();

    if (src.from === 'court') {
      if (src.courtIdx === courtIdx && src.side === side && src.slotIdx === slotIdx) return;
      if (mbmCourtStates[src.courtIdx] === 'live') return;
      // Court ↔ Court swap
      _mbmDoSwapCourtCourt(src.courtIdx, src.side, src.slotIdx, courtIdx, side, slotIdx);
    } else if (src.from === 'rest') {
      // Rest → Court swap
      _mbmDoSwapRestCourt(src.playerName, courtIdx, side, slotIdx);
    }
  } else {
    window.selectedPlayer = { from: 'court', playerName: name, courtIdx: courtIdx, side: side, slotIdx: slotIdx };
    btn.classList.add('selected');
  }
}

/* ── Swap data + update only affected slots ── */
function _mbmDoSwapCourtCourt(cA, sA, iA, cB, sB, iB) {
  var data = allRounds[currentRoundIndex];
  if (!data) return;
  var kA = sA === 'L' ? 'pair1' : 'pair2';
  var kB = sB === 'L' ? 'pair1' : 'pair2';
  var nameA = data.games[cA][kA][iA];
  var nameB = data.games[cB][kB][iB];
  if (!nameA || !nameB) return;

  data.games[cA][kA][iA] = nameB;
  data.games[cB][kB][iB] = nameA;

  _mbmUpdateSlot(document.getElementById('mbm-slot-' + cA + '-' + sA + '-' + iA), nameB);
  _mbmUpdateSlot(document.getElementById('mbm-slot-' + cB + '-' + sB + '-' + iB), nameA);

  // Re-check repetition on both affected courts
  var cardA = document.querySelector('#mbm-game-results .mbm-court-card[data-court-idx="' + cA + '"]');
  var cardB = document.querySelector('#mbm-game-results .mbm-court-card[data-court-idx="' + cB + '"]');
  _mbmCheckRepetition(cA, data.games[cA].pair1 || [], data.games[cA].pair2 || [], cardA);
  if (cB !== cA) _mbmCheckRepetition(cB, data.games[cB].pair1 || [], data.games[cB].pair2 || [], cardB);
}

function _mbmDoSwapRestCourt(waitingName, courtIdx, side, slotIdx) {
  var data = allRounds[currentRoundIndex];
  if (!data) return;
  var key = side === 'L' ? 'pair1' : 'pair2';
  var courtName = data.games[courtIdx][key][slotIdx];
  if (!courtName) return;

  var queueIdx = mbmWaitingQueue.indexOf(waitingName);
  if (queueIdx === -1) return;

  data.games[courtIdx][key][slotIdx] = waitingName;
  mbmWaitingQueue[queueIdx] = courtName;

  _mbmUpdateSlot(document.getElementById('mbm-slot-' + courtIdx + '-' + side + '-' + slotIdx), waitingName);

  // Re-check repetition on affected court
  var card = document.querySelector('#mbm-game-results .mbm-court-card[data-court-idx="' + courtIdx + '"]');
  _mbmCheckRepetition(courtIdx, data.games[courtIdx].pair1 || [], data.games[courtIdx].pair2 || [], card);

  mbmRenderWaiting();
}

/* ── Render waiting pool ── */
function mbmRenderWaiting() {
  var panel = document.getElementById('mbmWaitingPanel');
  var list  = document.getElementById('mbmWaitingList');
  if (!panel || !list) return;
  if (mbmWaitingQueue.length === 0) { panel.style.display = 'none'; return; }
  panel.style.display = '';
  list.innerHTML = '';
  mbmWaitingQueue.forEach(function(p) { list.appendChild(mbmMakeWaitingBtn(p)); });
}

/* ── Waiting pool button ── */
function mbmMakeWaitingBtn(name) {
  var baseName = name.split('#')[0];
  var playerObj = (schedulerState.allPlayers || []).find(function(x) { return x.name === baseName; });
  var gender = playerObj ? playerObj.gender : 'Male';

  var btn = document.createElement('button');
  btn.className = 'rest-btn';
  btn.dataset.playerName = name;

  if (typeof createRatingRing === 'function') btn.appendChild(createRatingRing(name, gender));
  var span = document.createElement('span');
  span.textContent = baseName;
  btn.appendChild(span);
  var count = mbmPlayCount.get(baseName) || 0;
  if (count > 0) {
    var badge = document.createElement('span');
    badge.className = 'mbm-play-count';
    badge.textContent = count;
    btn.appendChild(badge);
  }

  var handleTap = function(e) {
    e.preventDefault();
    if (window.selectedPlayer) {
      var src = window.selectedPlayer;
      _mbmClearSel();
      if (src.from === 'court') {
        if (mbmCourtStates[src.courtIdx] === 'live') return;
        _mbmDoSwapRestCourt(name, src.courtIdx, src.side, src.slotIdx);
      } else if (src.from === 'rest') {
        if (src.playerName === name) return;
        var iA = mbmWaitingQueue.indexOf(src.playerName);
        var iB = mbmWaitingQueue.indexOf(name);
        if (iA !== -1 && iB !== -1) {
          mbmWaitingQueue[iA] = name;
          mbmWaitingQueue[iB] = src.playerName;
          mbmRenderWaiting();
        }
      }
    } else {
      window.selectedPlayer = { from: 'rest', playerName: name };
      btn.classList.add('selected');
    }
  };

  var _sy = 0, _lastTouch = 0;
  btn.addEventListener('click', function(e) {
    if (Date.now() - _lastTouch < 400) return;
    handleTap(e);
  });
  btn.addEventListener('touchstart', function(e) { _sy = e.touches[0].clientY; }, { passive: true });
  btn.addEventListener('touchend', function(e) {
    if (Math.abs(e.changedTouches[0].clientY - _sy) < 8) { _lastTouch = Date.now(); handleTap(e); }
  }, { passive: false });

  return btn;
}

/* ── Clear selection ── */
function _mbmClearSel() {
  window.selectedPlayer = null;
  document.querySelectorAll('.mbm-court-card .selected, #mbmWaitingList .selected')
    .forEach(function(b) { b.classList.remove('selected'); });
}

function _mbmIsLive(gameIndex) {
  return mbmCourtStates[gameIndex] === 'live';
}

/* ── Button visibility by state ── */
function mbmApplyBtnState(btnsDiv, state) {
  if (!btnsDiv) return;
  var play   = btnsDiv.querySelector('.mbm-play');
  var finish = btnsDiv.querySelector('.mbm-finish');
  var stop   = btnsDiv.querySelector('.mbm-stop');
  var dice   = btnsDiv.querySelector('.mbm-dice');
  var clear  = btnsDiv.querySelector('.mbm-clear');

  [play, finish, stop, dice, clear].forEach(function(b) { if (b) b.style.display = 'none'; });

  if (state === 'empty') {
    if (dice) dice.style.display = '';
  } else if (state === 'ready') {
    if (play)  play.style.display  = '';
    if (dice)  dice.style.display  = '';
    if (clear) clear.style.display = '';
  } else if (state === 'live') {
    if (finish) finish.style.display = '';
    if (stop)   stop.style.display   = '';
  }
}

/* ── Play ── */
function mbmPlay(idx) {
  _mbmClearSel();
  mbmCourtStates[idx] = 'live';
  var card = document.querySelector('#mbm-game-results .mbm-court-card[data-court-idx="' + idx + '"]');
  if (!card) return;
  card.dataset.mbmState = 'live';
  card.classList.add('mbm-live');
  mbmApplyBtnState(card.querySelector('.mbm-court-btns'), 'live');

  // ── Competitive: show winner cups, grey out Finish until winner picked ──
  if (typeof getPlayMode === 'function' && getPlayMode() === 'competitive') {
    var finishBtn = card.querySelector('.mbm-finish');
    if (finishBtn) { finishBtn.disabled = true; finishBtn.style.opacity = '0.4'; }

    card.querySelectorAll('.team').forEach(function(teamDiv) {
      if (teamDiv.querySelector('.mbm-win-cup')) return; // already added
      (function(td, i) {
        var side = td.dataset.teamSide;
        var cup = document.createElement('button');
        cup.className = 'mbm-win-cup win-cup blinking';
        cup.style.visibility = 'visible';
        cup.style.pointerEvents = 'auto';
        cup.innerHTML = '<img src="win-cup.png" style="width:28px;height:28px;">';
        cup.title = 'Mark as winner';
        cup.addEventListener('click', function(e) { e.stopPropagation(); _mbmMarkWinner(i, side); });
        td.insertBefore(cup, td.firstChild);
        // Also tap anywhere on the team div marks winner
        td.addEventListener('click', function(e) {
          // Only fire if click is NOT on a slot button (those stop propagation)
          // We check if the court is live — only then winner marking is relevant
          if (mbmCourtStates[i] !== 'live') return;
          var tag = (e.target.tagName || '').toUpperCase();
          if (tag === 'BUTTON' || tag === 'IMG') return;
          _mbmMarkWinner(i, side);
        });
      })(teamDiv, idx);
    });
  }
}

function _mbmMarkWinner(idx, side) {
  var data = allRounds[currentRoundIndex];
  if (!data || !data.games[idx]) return;

  var card = document.querySelector('#mbm-game-results .mbm-court-card[data-court-idx="' + idx + '"]');
  if (!card) return;

  var allCups    = card.querySelectorAll('.mbm-win-cup');
  var tapCup     = card.querySelector('.team[data-team-side="' + side + '"] .mbm-win-cup');
  var isActive   = tapCup && tapCup.classList.contains('active');
  var finishBtn  = card.querySelector('.mbm-finish');

  if (!isActive) {
    // Mark this side as winner — hide other cup
    allCups.forEach(function(c) {
      c.classList.remove('active', 'blinking');
      c.style.visibility = 'hidden';
      c.style.pointerEvents = 'none';
    });
    if (tapCup) {
      tapCup.classList.add('active');
      tapCup.style.visibility = 'visible';
      tapCup.style.pointerEvents = 'auto';
    }
    card.querySelectorAll('.team').forEach(function(t) {
      t.classList.toggle('winner', t.dataset.teamSide === side);
      t.classList.toggle('loser',  t.dataset.teamSide !== side);
    });
    data.games[idx].winner = side;
    if (finishBtn) { finishBtn.disabled = false; finishBtn.style.opacity = ''; }
  } else {
    // Unmark — show both cups blinking again
    allCups.forEach(function(c) {
      c.classList.remove('active');
      c.classList.add('blinking');
      c.style.visibility = 'visible';
      c.style.pointerEvents = 'auto';
    });
    card.querySelectorAll('.team').forEach(function(t) {
      t.classList.remove('winner', 'loser');
    });
    data.games[idx].winner = undefined;
    if (finishBtn) { finishBtn.disabled = true; finishBtn.style.opacity = '0.4'; }
  }
}

/* ── Stop ── */
function mbmStop(idx) {
  _mbmClearSel();
  mbmCourtStates[idx] = 'ready';
  var card = document.querySelector('#mbm-game-results .mbm-court-card[data-court-idx="' + idx + '"]');
  if (!card) return;
  card.dataset.mbmState = 'ready';
  card.classList.remove('mbm-live');
  mbmApplyBtnState(card.querySelector('.mbm-court-btns'), 'ready');

  // Remove cups and reset winner
  card.querySelectorAll('.mbm-win-cup').forEach(function(c) { c.remove(); });
  card.querySelectorAll('.team').forEach(function(t) {
    t.classList.remove('winner', 'loser');
  });
  var data = allRounds[currentRoundIndex];
  if (data && data.games[idx]) delete data.games[idx].winner;
}

/* ── Clear: free players, no history ── */
function mbmClear(idx) {
  _mbmClearSel();
  var data = allRounds[currentRoundIndex];
  if (!data || !data.games[idx]) return;
  var freed = (data.games[idx].pair1 || []).concat(data.games[idx].pair2 || []);
  // Cleared players go to FRONT of queue — they haven't played, highest priority
  var toAddFront = freed.filter(function(p) { return p && !mbmWaitingQueue.includes(p); });
  mbmWaitingQueue = toAddFront.concat(mbmWaitingQueue);
  data.games[idx] = { pair1: [], pair2: [], court: idx + 1 };
  mbmCourtStates[idx] = 'empty';
  _mbmFillCourtSlots(idx, data.games[idx]);
  var clearedCard2 = document.querySelector('#mbm-game-results .mbm-court-card[data-court-idx="' + idx + '"]');
  if (clearedCard2) {
    clearedCard2.querySelectorAll('.mbm-win-cup').forEach(function(c) { c.remove(); });
    clearedCard2.querySelectorAll('.team').forEach(function(t) { t.classList.remove('winner','loser'); });
  }
  mbmRenderWaiting();
}

/* ── Finish: store in mbmCompletedGames, update state directly ── */
function mbmFinish(idx) {
  _mbmClearSel();
  var data = allRounds[currentRoundIndex];
  if (!data || !data.games[idx]) return;
  var game = data.games[idx];
  if (!game.pair1 || !game.pair1.length || !game.pair2 || !game.pair2.length) return;

  var pair1 = game.pair1.slice();
  var pair2 = game.pair2.slice();

  var winner = game.winner || null;

  // ── Store in mbmRounds ──
  mbmRounds.push({
    round:   mbmRounds.length + 1,
    games:   [{ pair1: pair1, pair2: pair2, court: idx + 1, winner: winner }],
    resting: [],
    playing: pair1.concat(pair2),
    isMbm:   true,
  });

  // ── Update schedulerState identically to rounds module (court-by-court) ──
  var mbmRoundIdx = allRounds.length;
  allRounds.push({ games: [{ pair1: pair1, pair2: pair2, court: idx + 1, winner: winner }], resting: [], isMbm: true });
  updSchedule(mbmRoundIdx, schedulerState, false);



  // ── Increment MBM play counts and return to waiting queue ──
  var all = pair1.concat(pair2);
  var _isSinglesGame = (schedulerState.courtFormats || [])[idx] === 'singles';
  all.forEach(function(p) {
    if (!p) return;
    var base = p.split('#')[0];
    mbmPlayCount.set(base, (mbmPlayCount.get(base) || 0) + 1);
    mbmScheduleCount.set(base, (mbmScheduleCount.get(base) || 0) + 1);
    if (_isSinglesGame) mbmSinglesCount.set(base, (mbmSinglesCount.get(base) || 0) + 1);
    if (!mbmWaitingQueue.includes(p)) mbmWaitingQueue.push(p);
  });

  // ── Clear the court slot ──
  data.games[idx] = { pair1: [], pair2: [], court: idx + 1 };
  mbmCourtStates[idx] = 'empty';
  _mbmFillCourtSlots(idx, data.games[idx]);
  // Remove cups from cleared court
  var clearedCard = document.querySelector('#mbm-game-results .mbm-court-card[data-court-idx="' + idx + '"]');
  if (clearedCard) {
    clearedCard.querySelectorAll('.mbm-win-cup').forEach(function(c) { c.remove(); });
    clearedCard.querySelectorAll('.team').forEach(function(t) { t.classList.remove('winner','loser'); });
  }
  mbmRenderWaiting();
}

/* ── Dice: fill court from waiting pool ── */
async function mbmDice(idx) {
  _mbmClearSel();
  var data = allRounds[currentRoundIndex];
  if (!data) return;

  var fmt       = (schedulerState.courtFormats || [])[idx] || 'doubles';
  var courtType = (schedulerState.courtTypes   || [])[idx] || 'free';
  var need      = fmt === 'singles' ? 2 : 4;

  var game = data.games[idx] || {};
  var thisCourtPlayers = (game.pair1 || []).concat(game.pair2 || []).filter(Boolean);

  // ── Build locked set: players on OTHER live courts ──
  var lockedPlayers = new Set();
  (data.games || []).forEach(function(g, i) {
    if (i === idx) return;
    if (mbmCourtStates[i] === 'live') {
      (g.pair1 || []).forEach(function(p) { lockedPlayers.add(p.split('#')[0]); });
      (g.pair2 || []).forEach(function(p) { lockedPlayers.add(p.split('#')[0]); });
    }
  });

  var activeSet = new Set(schedulerState.activeplayers.map(function(p) { return p.split('#')[0]; }));

  // ── Pool: waiting queue (active, not locked) + players already on THIS court ──
  // Queue order preserved — fairness priority
  var pool = mbmWaitingQueue.filter(function(p) {
    var base = p.split('#')[0];
    return activeSet.has(base) && !lockedPlayers.has(base);
  });
  thisCourtPlayers.forEach(function(p) {
    var base = p.split('#')[0];
    if (activeSet.has(base) && !lockedPlayers.has(base) && !pool.includes(p)) pool.push(p);
  });

  // ── Gender helper ──
  function _mbmGender(name) {
    var base = name.split('#')[0];
    var pl = (schedulerState.allPlayers || []).find(function(p) { return p.name === base; });
    return pl ? pl.gender : 'Male';
  }

  // ── Filter pool by court type before sending to worker ──
  // Worker getGender does not strip # — so we pre-filter here.
  // Free/Singles: full pool — worker handles naturally.
  // MD: males only. LD: females only. XD: males first then females.
  var workerPool;
  if (courtType === 'MD') {
    workerPool = pool.filter(function(p) { return _mbmGender(p) === 'Male'; });
  } else if (courtType === 'LD') {
    workerPool = pool.filter(function(p) { return _mbmGender(p) === 'Female'; });
  } else if (courtType === 'XD') {
    var xMen   = pool.filter(function(p) { return _mbmGender(p) === 'Male'; });
    var xWomen = pool.filter(function(p) { return _mbmGender(p) === 'Female'; });
    workerPool = xMen.concat(xWomen);
  } else {
    workerPool = pool;
  }

  if (workerPool.length < need) {
    alert('Not enough ' + (courtType !== 'free' ? courtType + ' ' : '') + 'players (' + workerPool.length + ' available, need ' + need + ')');
    return;
  }

  // ── Call worker via _mbmCall fast path ──
  // Worker's mbmBestGame scores every C(pool,4) combination × 3 pairings.
  // Priority: 1. opponent freshness  2. partner age  3. wait queue position
  // activeplayers = full workerPool (worker picks best 4, not just first 4).
  // _mbmWaitQueue = mbmWaitingQueue so worker can use wait time as tiebreaker.
  // ── Identify fixed pairs where both members are in workerPool ──
  var workerPoolBase = workerPool.map(function(p) { return p.split('#')[0]; });
  var mbmFixedPairs = (schedulerState.fixedPairs || []).filter(function(pair) {
    return workerPoolBase.includes(pair[0]) && workerPoolBase.includes(pair[1]);
  });

  var mbmState = Object.assign({}, schedulerState, {
    activeplayers: workerPool,
    numCourts:     1,
    courts:        1,
    courtFormats:  [fmt],
    courtTypes:    [courtType],
    fixedPairs:    mbmFixedPairs,
    restQueue:     [],  // everyone in pool should play — no resting
  });
  var pair1 = null, pair2 = null;

  // ── Singles: pick fairest matchup locally — no worker needed ──
  if (fmt === 'singles') {
    var best = null;
    for (var i = 0; i < workerPool.length - 1; i++) {
      for (var j = i + 1; j < workerPool.length; j++) {
        var a = workerPool[i];
        var b = workerPool[j];
        var aCount = mbmSinglesCount.get(a) || 0;
        var bCount = mbmSinglesCount.get(b) || 0;
        // Prefer players who haven't played singles yet, then least singles played, then queue order
        var fresh = (aCount === 0 ? 1 : 0) + (bCount === 0 ? 1 : 0);
        var score = fresh * 100000 - (aCount + bCount) * 100 - i - j;
        if (!best || score > best.score) {
          best = { score, pair1: [a], pair2: [b] };
        }
      }
    }
    if (best) { pair1 = best.pair1; pair2 = best.pair2; }
  }

  // ── Doubles: use worker mbmBestGame ──
  if (!pair1) {
    try {
      var result = await safeGenerateRound(mbmState);
      if (result && result.games && result.games[0] &&
          result.games[0].pair1 && result.games[0].pair1.length) {
        pair1 = result.games[0].pair1;
        pair2 = result.games[0].pair2;
      }
    } catch(e) {
      console.error('MBM dice error:', e);
      return;
    }
  }

  if (!pair1) return;

  // ── Update waiting queue ──
  // Strip #N suffix for all comparisons — worker returns plain names,
  // thisCourtPlayers may have suffixes, mbmWaitingQueue has plain names.
  var chosen = pair1.concat(pair2 || []).map(function(p) { return p.split('#')[0]; });

  // Players bumped off this court (not chosen) → go back to waiting
  var displaced = thisCourtPlayers
    .map(function(p) { return p.split('#')[0]; })
    .filter(function(p) { return !chosen.includes(p); });

  // Also: any pool players not chosen (e.g. 4 in pool but singles only takes 2)
  // must go back to waiting so they don't disappear
  var poolBase = pool.map(function(p) { return p.split('#')[0]; });
  poolBase.forEach(function(p) {
    if (!chosen.includes(p) && !displaced.includes(p)) displaced.push(p);
  });

  // Remove chosen from queue, add displaced to back
  mbmWaitingQueue = mbmWaitingQueue
    .map(function(p) { return p.split('#')[0]; })
    .filter(function(p) { return !chosen.includes(p); });
  displaced.forEach(function(p) { if (!mbmWaitingQueue.includes(p)) mbmWaitingQueue.push(p); });

  mbmCourtStates[idx] = 'ready';
  data.games[idx] = { pair1: pair1, pair2: pair2 || [], court: idx + 1 };
  _mbmFillCourtSlots(idx, data.games[idx]);
  mbmRenderWaiting();
}



/* ── Sync active players ── */
function mbmSyncPlayers() {
  var data = allRounds[currentRoundIndex];
  var isMbmActive = document.getElementById('mbmPage') &&
    document.getElementById('mbmPage').style.display !== 'none';
  if (!data) return;

  var activeSet = new Set(schedulerState.activeplayers.map(function(p) { return p.split('#')[0]; }));

  var onCourt = new Set();
  (data.games || []).forEach(function(g) {
    (g.pair1 || []).forEach(function(p) { onCourt.add(p.split('#')[0]); });
    (g.pair2 || []).forEach(function(p) { onCourt.add(p.split('#')[0]); });
  });

  mbmWaitingQueue = mbmWaitingQueue.filter(function(p) { return activeSet.has(p.split('#')[0]); });

  (data.games || []).forEach(function(g, idx) {
    var changed = false;
    ['pair1', 'pair2'].forEach(function(key) {
      var before = (g[key] || []).length;
      g[key] = (g[key] || []).filter(function(p) { return activeSet.has(p.split('#')[0]); });
      if (g[key].length !== before) changed = true;
    });
    if (changed) {
      if (!g.pair1.length && !g.pair2.length) mbmCourtStates[idx] = 'empty';
      // Only update slots if shells already exist
      if (isMbmActive && document.getElementById('mbm-slot-' + idx + '-L-0')) _mbmFillCourtSlots(idx, g);
    }
  });

  var currentMin = 0;
  if (mbmScheduleCount.size > 0) {
    currentMin = Math.min.apply(null, Array.from(mbmScheduleCount.values()));
  }
  schedulerState.activeplayers.forEach(function(p) {
    var base = p.split('#')[0];
    var inQueue = mbmWaitingQueue.some(function(q) { return q.split('#')[0] === base; });
    var inCourt = onCourt.has(base);
    if (!inQueue && !inCourt) {
      mbmWaitingQueue.push(base);
      if (!mbmScheduleCount.has(base)) mbmScheduleCount.set(base, currentMin);
    }
  });

  // mbmShowRound will call mbmRenderWaiting after building shells
  if (isMbmActive && document.getElementById('mbm-slot-0-L-0')) mbmRenderWaiting();
}

/* ── MBM Past Matches History ── */
function showMbmHistory() {
  var overlay = document.getElementById('roundHistoryOverlay');
  var container = document.getElementById('roundHistoryContainer');
  var titleEl = overlay ? overlay.querySelector('.bottom-sheet-title') : null;
  if (!overlay || !container) return;

  // Retitle for MBM context
  if (titleEl) titleEl.textContent = '🕓 Past Matches';

  container.innerHTML = '';

  // Filter only MBM entries from allRounds
  var mbmEntries = [];
  for (var i = 0; i < allRounds.length; i++) {
    var r = allRounds[i];
    if (r && r.isMbm && r.games && r.games.length === 1) {
      mbmEntries.push(r);
    }
  }

  if (!mbmEntries.length) {
    var empty = document.createElement('div');
    empty.style.cssText = 'color:var(--muted);text-align:center;padding:24px;font-size:0.9rem;';
    empty.textContent = 'No matches played yet.';
    container.appendChild(empty);
  } else {
    var label = document.createElement('div');
    label.style.cssText = 'font-size:0.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-weight:600;margin:14px 0 8px;padding-top:12px;border-top:1px solid var(--border2);';
    label.textContent = 'Match History';
    container.appendChild(label);

    window._vRoundsData = allRounds;
    // Render newest first, label as Match 1, Match 2...
    for (var j = mbmEntries.length - 1; j >= 0; j--) {
      if (typeof _vBuildRound === 'function') {
        var matchNum = j + 1;
        var el = _vBuildRound(mbmEntries[j]);
        // Override "Round X" header → "Match X"
        var hdr = el.querySelector('.round-header');
        if (hdr) hdr.textContent = 'Match ' + matchNum;
        container.appendChild(el);
      }
    }
  }

  overlay.style.display = 'flex';
}

/* ── Adjust court count during MBM session ── */
function mbmAdjCourts(delta) {
  var current = schedulerState.numCourts || 1;
  var next = Math.max(1, current + delta);
  if (next === current) return;

  schedulerState.numCourts = next;

  var data = allRounds[currentRoundIndex];
  if (!data) return;

  // Add or remove game slots from current round
  while (data.games.length < next) {
    data.games.push({ pair1: [], pair2: [], court: data.games.length + 1 });
  }
  while (data.games.length > next) {
    var removed = data.games.pop();
    // Return any players in removed court back to waiting queue
    var freed = (removed.pair1 || []).concat(removed.pair2 || []);
    // Cleared players go to FRONT of queue — they haven't played, highest priority
  var toAddFront = freed.filter(function(p) { return p && !mbmWaitingQueue.includes(p); });
  mbmWaitingQueue = toAddFront.concat(mbmWaitingQueue);
  }

  // Update court count display
  var countEl = document.getElementById('mbmCourtCount');
  if (countEl) countEl.textContent = next;

  mbmBuildShells(true);
  mbmFillAllSlots();
  mbmRenderWaiting();
}
