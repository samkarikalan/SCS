(function () {
  'use strict';
  const MODE_KEY = 'scs_full_schedule_mode';
  const COUNT_KEY = 'scs_full_schedule_count';
  let generating = false;

  function enabled() { return sessionStorage.getItem(MODE_KEY) === '1'; }
  function count() { return Math.max(1, Math.min(50, Number(sessionStorage.getItem(COUNT_KEY) || 10))); }
  function setCount(value) {
    const n = Math.max(1, Math.min(50, Number(value) || 1));
    sessionStorage.setItem(COUNT_KEY, String(n));
    const el = document.getElementById('fullScheduleRoundsValue');
    if (el) el.textContent = String(n);
    return n;
  }
  function adjustRounds(delta) { setCount(count() + Number(delta || 0)); }

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
    if (!sessionStorage.getItem(COUNT_KEY)) sessionStorage.setItem(COUNT_KEY, '10');
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

  async function generateRemaining() {
    if (!enabled() || generating || !Array.isArray(window.allRounds || allRounds) || !allRounds.length) return;
    generating = true;
    try {
      const target = count();
      while (allRounds.length < target) {
        schedulerState.roundIndex = allRounds.length + 1;
        const round = await generateRoundWithLiveRules(schedulerState);
        if (!round) throw new Error('Round generation returned no round.');
        round.round = allRounds.length + 1;
        allRounds.push(round);
      }
      currentRoundIndex = Math.min(currentRoundIndex || 0, allRounds.length - 1);
      showRound(currentRoundIndex);
      applyDashboard();
      if (typeof saveSnapshot === 'function') saveSnapshot();
    } catch (error) {
      console.error('Full Round Schedule generation failed:', error);
      if (typeof showToast === 'function') showToast(error.message || 'Could not generate full schedule');
      else alert(error.message || 'Could not generate full schedule');
    } finally { generating = false; }
  }

  function applyDashboard() {
    const on = enabled() && Array.isArray(allRounds) && allRounds.length > 0;
    const dash = document.getElementById('fullScheduleDashboard');
    if (dash) dash.hidden = !on;
    const action = document.querySelector('#roundsPage > .action-card');
    if (action) action.style.display = on ? 'none' : '';
    ['roundShufle','courtMinus','courtPlus'].forEach(id => {
      const el = document.getElementById(id); if (el) el.style.display = on ? 'none' : '';
    });
    const settings = document.querySelector('#roundsPage .rtb-settings[aria-label="Settings"]');
    if (settings) settings.style.display = on ? 'none' : '';
    document.body.classList.toggle('full-schedule-readonly', !!on);
    updatePosition();
  }

  function updatePosition() {
    if (!enabled() || !Array.isArray(allRounds) || !allRounds.length) return;
    const pos = document.getElementById('fullSchedulePosition');
    if (pos) pos.textContent = `Round ${currentRoundIndex + 1} of ${allRounds.length}`;
    const prev = document.getElementById('fullSchedulePrev');
    const next = document.getElementById('fullScheduleNext');
    if (prev) prev.disabled = currentRoundIndex <= 0;
    if (next) next.disabled = currentRoundIndex >= allRounds.length - 1;
    const complete = document.getElementById('fullScheduleComplete');
    const round = allRounds[currentRoundIndex];
    if (complete) {
      complete.textContent = round && round._fullScheduleCompleted ? '✓ Completed' : '✓ Mark Completed';
      complete.disabled = !!(round && round._fullScheduleCompleted);
    }
  }

  function showAt(index) {
    if (!enabled() || !allRounds.length) return;
    currentRoundIndex = Math.max(0, Math.min(index, allRounds.length - 1));
    showRound(currentRoundIndex);
    applyDashboard();
  }
  function previous() { showAt(currentRoundIndex - 1); }
  function next() { showAt(currentRoundIndex + 1); }
  function completeCurrent() {
    if (!enabled() || !allRounds[currentRoundIndex]) return;
    allRounds[currentRoundIndex]._fullScheduleCompleted = true;
    if (typeof updSchedule === 'function') {
      try { updSchedule(currentRoundIndex, schedulerState, false); } catch (_) {}
    }
    if (typeof saveSnapshot === 'function') saveSnapshot();
    if (currentRoundIndex < allRounds.length - 1) showAt(currentRoundIndex + 1);
    else updatePosition();
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

  window.SCSFullSchedule = { openSetup, disable, enabled, adjustRounds, generateRemaining, previous, next, completeCurrent, applyDashboard };
})();
