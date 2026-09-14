(function () {
  'use strict';
  const MODE_KEY = 'scs_full_schedule_mode';
  let generating = false;
  let transitioning = false;
  let fullScheduleTimerInterval = null;
  let liveTimedRoundIndex = -1;

  function enabled() { return sessionStorage.getItem(MODE_KEY) === '1'; }
  function count() { return 25; }
  function setCount() {
    const el = document.getElementById('fullScheduleRoundsValue');
    if (el) el.textContent = '25';
    return 25;
  }
  function adjustRounds() { return 25; }

  function syncSetup() {
    const section = document.getElementById('fullScheduleRoundsSection');
    if (section) section.hidden = !enabled();
    setCount(count());
    const title = document.querySelector('.org-mode-panel-offline .org-sample-copy strong');
    if (title && enabled()) title.textContent = 'Full Round Schedule';
    else if (title) title.textContent = 'Round iMode';
  }

  function openSetup() {
    sessionStorage.setItem(MODE_KEY, '1');
    if (typeof scsCloseHomeQuickMenu === 'function') scsCloseHomeQuickMenu();
    welcomeSelectedWorkspace = 'organiser';
    if (typeof scsSetPrimarySafeArea === 'function') scsSetPrimarySafeArea('nonhome');
    if (typeof switchMode === 'function') switchMode('organiser');
    setTimeout(syncSetup, 0);
  }

  function disable() {
    sessionStorage.removeItem(MODE_KEY);
    syncSetup();
  }

  // Full Schedule generation must advance the same scheduling history as
  // normal Rounds, but only inside a private planning state. This prevents
  // future scheduled rounds from being counted as already played.
  function cloneScheduleValue(value, seen) {
    if (value == null || typeof value !== 'object') return value;
    if (!seen) seen = new WeakMap();
    if (seen.has(value)) return seen.get(value);
    if (value instanceof Map) {
      const out = new Map(); seen.set(value, out);
      value.forEach((v, k) => out.set(cloneScheduleValue(k, seen), cloneScheduleValue(v, seen)));
      return out;
    }
    if (value instanceof Set) {
      const out = new Set(); seen.set(value, out);
      value.forEach(v => out.add(cloneScheduleValue(v, seen)));
      return out;
    }
    if (Array.isArray(value)) {
      const out = []; seen.set(value, out);
      value.forEach(v => out.push(cloneScheduleValue(v, seen)));
      return out;
    }
    const out = Object.create(Object.getPrototypeOf(value));
    seen.set(value, out);
    Object.keys(value).forEach(k => { out[k] = cloneScheduleValue(value[k], seen); });
    return out;
  }

  function cloneSchedulerStateForFullSchedule() {
    return cloneScheduleValue(schedulerState);
  }

  // New dashboard commit path: exactly one completed scheduled round is fed
  // through the normal Rounds state updater. Future rounds remain proposals.
  function updateDashboardLikeRounds(roundIndex) {
    const round = allRounds[roundIndex];
    if (!round || round._fullScheduleStateCommitted) return;
    if (typeof updSchedule === 'function') {
      updSchedule(roundIndex, schedulerState, !isRoundIModeSession());
    }
    round._fullScheduleStateCommitted = true;
    if (typeof updateSummaryPageAccess === 'function') updateSummaryPageAccess();
    if (typeof saveSnapshot === 'function') saveSnapshot();
  }

  function setFullScheduleTimerDisplay() {
    const display = document.getElementById('roundElapsedTime');
    if (!display || !Array.isArray(allRounds) || !allRounds.length) return;
    const viewed = allRounds[currentRoundIndex];
    if (!viewed) { display.textContent = '00:00'; return; }
    let ms = Number(viewed.durationMs) || 0;
    if (currentRoundIndex === liveTimedRoundIndex && viewed.startedAt && !viewed._fullScheduleCompleted) {
      ms = Math.max(0, Date.now() - Number(viewed.startedAt));
    }
    if (typeof formatRoundDuration === 'function') display.textContent = formatRoundDuration(ms);
    else {
      const sec = Math.max(0, Math.floor(ms / 1000));
      display.textContent = String(Math.floor(sec / 60)).padStart(2,'0') + ':' + String(sec % 60).padStart(2,'0');
    }
  }

  function startFullScheduleTimer(roundIndex) {
    if (!Array.isArray(allRounds) || !allRounds[roundIndex]) return;
    clearInterval(fullScheduleTimerInterval);
    liveTimedRoundIndex = roundIndex;
    const round = allRounds[roundIndex];
    round.startedAt = Date.now();
    round.durationMs = 0;
    delete round.endedAt;
    setFullScheduleTimerDisplay();
    fullScheduleTimerInterval = setInterval(setFullScheduleTimerDisplay, 1000);
  }

  function stopFullScheduleTimer(roundIndex) {
    if (!Array.isArray(allRounds) || !allRounds[roundIndex]) return;
    const round = allRounds[roundIndex];
    if (round.startedAt && !round.endedAt) {
      round.durationMs = Math.max(0, Date.now() - Number(round.startedAt));
      round.endedAt = Date.now();
    }
    if (liveTimedRoundIndex === roundIndex) {
      clearInterval(fullScheduleTimerInterval);
      fullScheduleTimerInterval = null;
      liveTimedRoundIndex = -1;
    }
    setFullScheduleTimerDisplay();
  }

  function showRoundTransition(completedNumber, nextNumber) {
    return new Promise(resolve => {
      let overlay = document.getElementById('fullScheduleTransition');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'fullScheduleTransition';
        overlay.className = 'full-schedule-transition';
        overlay.innerHTML = '<div class="full-schedule-transition-card"><div class="full-schedule-transition-check">✓</div><div id="fullScheduleTransitionTitle" class="full-schedule-transition-title"></div><div id="fullScheduleTransitionSub" class="full-schedule-transition-sub"></div></div>';
        document.body.appendChild(overlay);
      }
      const title = document.getElementById('fullScheduleTransitionTitle');
      const sub = document.getElementById('fullScheduleTransitionSub');
      if (title) title.textContent = 'Round ' + completedNumber + ' Completed';
      if (sub) sub.textContent = nextNumber ? 'Starting Round ' + nextNumber + '…' : 'Schedule Completed';
      overlay.classList.remove('show');
      void overlay.offsetWidth;
      overlay.classList.add('show');
      setTimeout(() => {
        overlay.classList.remove('show');
        setTimeout(resolve, 180);
      }, 1050);
    });
  }

  function renderDashboardRound(index) {
    if (!enabled() || !allRounds.length) return;
    currentRoundIndex = Math.max(0, Math.min(index, allRounds.length - 1));
    // Force the normal Rounds renderer to rebuild the complete round card,
    // rather than taking its same-round players/resting-only fast path.
    if (typeof _lastRenderedRoundIndex !== 'undefined') _lastRenderedRoundIndex = -1;
    showRound(currentRoundIndex);
    applyDashboard();
    setFullScheduleTimerDisplay();
  }

  async function generateRemaining() {
    if (!enabled() || generating) return;
    generating = true;
    try {
      if (!window.SCSOfflineRounds || typeof window.SCSOfflineRounds.fullScheduleTemplateRounds !== 'function') {
        throw new Error('Rounds Template service is unavailable.');
      }
      const templateRounds = await window.SCSOfflineRounds.fullScheduleTemplateRounds();
      if (!Array.isArray(templateRounds) || !templateRounds.length) {
        throw new Error('Matching Rounds Template returned no rounds.');
      }

      // Full Schedule is a read-ahead view of the prepared template. None of
      // these future rounds are committed to pair/rest/opponent history until
      // Mark Completed is pressed.
      allRounds.length = 0;
      templateRounds.slice(0, 25).forEach(function(round, index) {
        const copy = cloneScheduleValue(round);
        copy.round = index + 1;
        delete copy._fullScheduleCompleted;
        delete copy._fullScheduleStateCommitted;
        allRounds.push(copy);
      });
      currentRoundIndex = 0;
      renderDashboardRound(0);
      applyDashboard();
      if (typeof saveSnapshot === 'function') saveSnapshot();
    } catch (error) {
      console.error('Full Round Schedule template load failed:', error);
      if (typeof showToast === 'function') showToast(error.message || 'Could not load full schedule');
      else alert(error.message || 'Could not load full schedule');
    } finally { generating = false; }
  }

  function applyDashboard() {
    const on = enabled() && Array.isArray(allRounds) && allRounds.length > 0;
    const dash = document.getElementById('fullScheduleDashboard');
    if (dash) dash.hidden = !on;
    const action = document.getElementById('nextBtn')?.closest('.action-card') || document.querySelector('#roundsPage .action-card');
    if (action) action.style.display = on ? 'none' : '';
    ['roundShufle','courtMinus','courtPlus'].forEach(id => {
      const el = document.getElementById(id); if (el) el.style.display = on ? 'none' : '';
    });
    const courtCounter = document.querySelector('#roundsPage .round-court-counter');
    if (courtCounter) courtCounter.style.display = on ? 'none' : '';
    const settings = document.querySelector('#roundsPage .rtb-settings[aria-label="Settings"]');
    if (settings) settings.style.display = on ? 'none' : '';
    document.body.classList.toggle('full-schedule-readonly', !!on);
    updatePosition();
  }

  function getCurrentPlayableRoundIndex() {
    if (!Array.isArray(allRounds) || !allRounds.length) return 0;
    const firstOpen = allRounds.findIndex(round => !round?._fullScheduleCompleted);
    return firstOpen >= 0 ? firstOpen : allRounds.length - 1;
  }

  function updatePosition() {
    if (!enabled() || !Array.isArray(allRounds) || !allRounds.length) return;
    const pos = document.getElementById('fullSchedulePosition');
    if (pos) pos.hidden = true;

    const currentPlayableIndex = getCurrentPlayableRoundIndex();
    const prev = document.getElementById('fullSchedulePrev');
    const next = document.getElementById('fullScheduleNext');
    if (prev) prev.disabled = transitioning || currentRoundIndex <= 0;
    if (next) {
      const canGoForward = currentRoundIndex < currentPlayableIndex;
      next.hidden = !canGoForward;
      next.disabled = transitioning || !canGoForward;
    }

    const complete = document.getElementById('fullScheduleComplete');
    const round = allRounds[currentRoundIndex];
    const isCompleted = !!(round && round._fullScheduleCompleted);
    const isCurrentPlayable = currentRoundIndex === currentPlayableIndex && !isCompleted;
    document.body.classList.toggle('full-schedule-round-completed', isCompleted);
    if (complete) {
      complete.textContent = isCompleted ? '✓ Completed' : '✓ Mark Completed';
      complete.disabled = transitioning || !isCurrentPlayable;
      complete.hidden = !isCurrentPlayable && !isCompleted;
    }
    document.body.classList.toggle('full-schedule-current-live', currentRoundIndex === liveTimedRoundIndex && !isCompleted);
    setFullScheduleTimerDisplay();
  }

  function showAt(index) {
    if (!enabled() || !allRounds.length) return;
    const currentPlayableIndex = getCurrentPlayableRoundIndex();
    const safeIndex = Math.max(0, Math.min(Number(index) || 0, currentPlayableIndex));
    renderDashboardRound(safeIndex);
  }
  function previous() { showAt(currentRoundIndex - 1); }
  function next() { showAt(currentRoundIndex + 1); }
  async function completeCurrent() {
    if (transitioning || !enabled() || !allRounds[currentRoundIndex]) return;
    const completingIndex = currentRoundIndex;
    const currentPlayableIndex = getCurrentPlayableRoundIndex();
    if (completingIndex !== currentPlayableIndex || allRounds[completingIndex]._fullScheduleCompleted) return;

    transitioning = true;
    updatePosition();

    // If this round was timed (all rounds after the first completion), freeze
    // its final duration before committing it.
    stopFullScheduleTimer(completingIndex);
    updateDashboardLikeRounds(completingIndex);
    allRounds[completingIndex]._fullScheduleCompleted = true;
    if (typeof saveSnapshot === 'function') saveSnapshot();

    const nextIndex = completingIndex < allRounds.length - 1 ? completingIndex + 1 : -1;
    await showRoundTransition(completingIndex + 1, nextIndex >= 0 ? nextIndex + 1 : null);

    if (nextIndex >= 0) {
      renderDashboardRound(nextIndex);
      // Mark Completed is the boundary: the next round timer begins only now,
      // after the completion transition has finished.
      startFullScheduleTimer(nextIndex);
      if (typeof saveSnapshot === 'function') saveSnapshot();
    } else {
      updatePosition();
    }

    transitioning = false;
    updatePosition();
  }

  // Reuse the existing Round page generation path. Once Round 1 exists, build
  // the requested remainder with the same hybrid source: prepared template
  // while available, then the existing live generator when needed.
  window.addEventListener('load', function () {
    syncSetup();
    const originalGoToRounds = window.goToRounds;
    if (typeof originalGoToRounds === 'function' && !originalGoToRounds._fullScheduleWrapped) {
      const wrapped = async function () {
        const result = await originalGoToRounds.apply(this, arguments);
        if (enabled()) await generateRemaining();
        return result;
      };
      wrapped._fullScheduleWrapped = true;
      window.goToRounds = wrapped;
    }
    const originalShowRound = window.showRound;
    if (typeof originalShowRound === 'function' && !originalShowRound._fullScheduleWrapped) {
      const wrappedShow = function () {
        const result = originalShowRound.apply(this, arguments);
        if (enabled()) setTimeout(applyDashboard, 0);
        return result;
      };
      wrappedShow._fullScheduleWrapped = true;
      window.showRound = wrappedShow;
    }
  });

  window.SCSFullSchedule = { openSetup, disable, enabled, adjustRounds, generateRemaining, previous, next, completeCurrent, applyDashboard, updateDashboardLikeRounds };
})();
