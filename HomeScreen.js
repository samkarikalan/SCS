/* =============================================
HomeScreen.js
Standalone home screen.
Depends on: schedulerState, allRounds (rounds.js)
getMyClub, getMyPlayer (supabase.js)
============================================= */

/* ── State ── */
var _navSource = 'home'; // 'home' | 'rounds' -- tracks where Players/Summary was opened from

function _homeT(key, fallback, values) {
  var value = (typeof t === 'function') ? t(key) : key;
  if (!value || value === key) value = fallback || key;
  return String(value).replace(/\{(\w+)\}/g, function(_, name) {
    return values && values[name] != null ? String(values[name]) : '';
  });
}

/* ── More / Help on workspace selection screen ── */
function toggleModeMore(forceOpen) {
  var section = document.getElementById('modeMoreSection');
  var label = document.getElementById('modeMoreLabel');
  if (!section) return;

  var open = typeof forceOpen === 'boolean'
    ? forceOpen
    : !section.classList.contains('is-open');

  section.classList.toggle('is-open', open);
  section.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (label) label.textContent = open ? '‹ Less' : 'More ›';
}

/* ── Show More / Less toggle for organiser home tiles ── */
var _homeMoreExpanded = false;

function homeToggleMoreTiles() {
  _homeMoreExpanded = !_homeMoreExpanded;
  var section = document.getElementById('homeMoreSection');
  var label   = document.getElementById('homeShowMoreLabel');
  if (section) {
    section.classList.toggle('home-more-collapsed', !_homeMoreExpanded);
    section.classList.toggle('home-more-expanded',   _homeMoreExpanded);
  }
  if (label) label.textContent = _homeMoreExpanded ? '‹ Less' : 'More ›';
}

/* ── Show More / Less toggle for viewer home tiles ── */
var _homeMoreExpandedV = false;

function homeToggleMoreTilesV() {
  _homeMoreExpandedV = !_homeMoreExpandedV;
  var section = document.getElementById('homeMoreSectionV');
  var label   = document.getElementById('homeShowMoreLabelV');
  if (section) {
    section.classList.toggle('home-more-collapsed', !_homeMoreExpandedV);
    section.classList.toggle('home-more-expanded',   _homeMoreExpandedV);
  }
  if (label) label.textContent = _homeMoreExpandedV ? '‹ Less' : 'More ›';
}


/* ── My Card details toggle (viewer) ── */
var _myCardDetailsOpen = false;

function setMyCardDetailsOpen(open) {
  _myCardDetailsOpen = !!open;

  var panel = document.getElementById('mcDetailsPanel');
  var arrow = document.getElementById('homeUserProfileToggle');
  var header = document.querySelector('#homePageOverlay .home-app-header');
  var ratingBreakdown = document.getElementById('mcRatingBreakdown');
  var pointsBreakdown = document.getElementById('mcPointsBreakdown');

  if (panel) panel.style.display = _myCardDetailsOpen ? '' : 'none';
  if (ratingBreakdown) ratingBreakdown.style.display = _myCardDetailsOpen ? '' : 'none';
  if (pointsBreakdown) pointsBreakdown.style.display = _myCardDetailsOpen ? '' : 'none';

  if (arrow) {
    arrow.textContent = _myCardDetailsOpen ? '⌃' : '⌄';
    arrow.setAttribute('aria-expanded', _myCardDetailsOpen ? 'true' : 'false');
    arrow.classList.toggle('open', _myCardDetailsOpen);
  }
  if (header) header.classList.toggle('profile-open', _myCardDetailsOpen);
}

function attachMyCardToUserHeader() {
  var header = document.querySelector('#homePageOverlay .home-app-header');
  var card = document.getElementById('myCardContent');
  if (!header || !card || card.parentNode === header) return;
  header.appendChild(card);
  setMyCardDetailsOpen(false);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', attachMyCardToUserHeader);
} else {
  attachMyCardToUserHeader();
}

function toggleMyCardDetails() {
  setMyCardDetailsOpen(!_myCardDetailsOpen);
}


/* Viewer Upcoming Slots UI is handled by slots.js. */



/* Return from Help to the workspace/mode selection screen. */
function closeHelpToModeSelection() {
  // Help is a normal .page. Hide it explicitly before restoring the
  // home layer; otherwise it remains above the mode-selection overlay.
  var helpPage = document.getElementById('helpPage');
  if (helpPage) helpPage.style.display = 'none';

  // Clear inner-page state, restore the app home layer, then show the
  // workspace selector from which Help was opened.
  document.body.classList.remove('home-open');
  showHomeScreen();

  if (typeof openModeSwitcher === 'function') {
    openModeSwitcher();
  }
}

var _homeSharedClubOpening = false;
var _clubInviteJoinClubId = '';
var _clubInviteJoinClubName = '';
var _clubInviteJoinClaimNickname = '';
var _clubInviteJoinSlotId = '';
var _clubInviteJoinSlot = null;

async function homeHandleSharedClubLink() {
  var clubId = typeof authGetPendingJoinClubId === 'function'
    ? authGetPendingJoinClubId()
    : sessionStorage.getItem('pending_join_club_id');
  if (!clubId || _homeSharedClubOpening) return;
  _homeSharedClubOpening = true;
  try {
    var rows = await sbGet('clubs', 'id=eq.' + encodeURIComponent(clubId) + '&select=id,name');
    if (!rows || !rows.length) throw new Error('This club invite link is no longer valid.');
    if (typeof authClearPendingJoinClub === 'function') authClearPendingJoinClub();
    else sessionStorage.removeItem('pending_join_club_id');
    history.replaceState(null, document.title, location.pathname + location.hash);
    homeGo('clubInviteJoinPage', null);
    await clubInviteJoinOpen(rows[0].id, rows[0].name);
  } catch (e) {
    if (typeof authClearPendingJoinClub === 'function') authClearPendingJoinClub();
    else sessionStorage.removeItem('pending_join_club_id');
    if (typeof showToast === 'function') showToast(e.message || 'Could not open this club invite.');
  } finally {
    _homeSharedClubOpening = false;
  }
}

function clubInviteJoinChooseNickname(nickname) {
  var input = document.getElementById('clubInviteJoinNickname');
  if (input) { input.value = String(nickname || ''); input.focus(); }
}

function clubInviteJoinAddChoice(container, nickname, isAccount) {
  nickname = String(nickname || '').trim();
  if (!container || !nickname) return;
  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'jc-nickname-pill' + (isAccount ? ' is-current' : ' is-unregistered');
  button.textContent = (isAccount ? '👤 ' : '🔐 ') + nickname;
  button.onclick = function() { clubInviteJoinChooseNickname(nickname); };
  container.appendChild(button);
}

async function clubInviteJoinOpen(clubId, clubName, slot) {
  _clubInviteJoinClubId = String(clubId || '');
  _clubInviteJoinClubName = String(clubName || 'Club');
  _clubInviteJoinClaimNickname = '';
  _clubInviteJoinSlot = slot && slot.id ? slot : null;
  _clubInviteJoinSlotId = _clubInviteJoinSlot ? String(_clubInviteJoinSlot.id) : '';
  var nameEl = document.getElementById('clubInviteJoinClubName');
  var introEl = document.getElementById('clubInviteJoinIntro');
  var input = document.getElementById('clubInviteJoinNickname');
  var choices = document.getElementById('clubInviteJoinChoices');
  var form = document.getElementById('clubInviteJoinForm');
  var password = document.getElementById('clubInviteJoinPassword');
  var feedback = document.getElementById('clubInviteJoinFeedback');
  if (nameEl) nameEl.textContent = _clubInviteJoinClubName;
  if (introEl) {
    introEl.textContent = _clubInviteJoinSlot
      ? ('Join ' + _clubInviteJoinClubName + ' and request the ' + String(_clubInviteJoinSlot.slot_date || '') + ' · ' + String(_clubInviteJoinSlot.start_time || '').slice(0,5) + ' slot.')
      : ('Choose your player in ' + _clubInviteJoinClubName + '.');
    introEl.hidden = true;
  }
  if (form) form.hidden = false;
  if (password) password.hidden = true;
  if (feedback) { feedback.hidden = true; feedback.innerHTML = ''; }
  if (input) input.value = '';
  if (choices) choices.innerHTML = '<span class="jc-nickname-loading">Loading player choices…</span>';

  var user = typeof authGetUser === 'function' ? authGetUser() : null;
  var accountNickname = user && user.nickname ? String(user.nickname).trim() : '';
  if (input && accountNickname) input.value = accountNickname;
  var accountGender = user && ['Male','Female'].includes(user.gender) ? user.gender : '';
  document.querySelectorAll('input[name="clubInviteJoinGender"]').forEach(function(radio) {
    radio.checked = radio.value === accountGender;
  });
  var ratingInput = document.getElementById('clubInviteJoinRating');
  var ratingValue = document.getElementById('clubInviteJoinRatingValue');
  if (ratingInput) { ratingInput.value = '1'; ratingInput.style.setProperty('--rating-fill','0%'); }
  if (ratingValue) ratingValue.textContent = '1.0';

  // Resolve membership before offering the join form. Invite links are often
  // reopened from old messages, so an existing member should never be asked
  // to submit another request.
  if (user && user.id) {
    var existingMemberships = await sbGet('memberships',
      'club_id=eq.' + encodeURIComponent(_clubInviteJoinClubId) +
      '&user_account_id=eq.' + encodeURIComponent(user.id) +
      '&select=player_id,nickname&limit=1'
    ).catch(function() { return []; });
    if (existingMemberships && existingMemberships.length) {
      if (_clubInviteJoinSlotId && typeof myCardSlotsJoin === 'function') {
        await myCardSlotsJoin(_clubInviteJoinSlotId);
        clubInviteJoinShowFeedback('Slot joined', 'You are already a member of ' + _clubInviteJoinClubName + ' and your slot request has been processed.', true);
        return;
      }
      clubInviteJoinShowFeedback(
        'Already a member',
        'You are already a member of ' + _clubInviteJoinClubName + '.',
        true
      );
      return;
    }

    var existingRequests = await sbGet('club_join_requests',
      'club_id=eq.' + encodeURIComponent(_clubInviteJoinClubId) +
      '&user_account_id=eq.' + encodeURIComponent(user.id) +
      '&status=eq.pending&select=id,nickname&limit=1'
    ).catch(function() { return []; });
    if (existingRequests && existingRequests.length) {
      if (_clubInviteJoinSlotId && typeof myCardSlotsJoin === 'function') {
        await myCardSlotsJoin(_clubInviteJoinSlotId);
        clubInviteJoinShowFeedback('Slot request added', 'Your club and slot requests are awaiting Club Manager approval.', true);
        return;
      }
      clubInviteJoinShowFeedback(
        'Request pending',
        'Your request to join ' + _clubInviteJoinClubName + ' is already awaiting Club Manager approval.',
        true
      );
      return;
    }
  }

  var unregistered = await sbGet('memberships',
    'club_id=eq.' + encodeURIComponent(_clubInviteJoinClubId) + '&user_account_id=is.null&select=nickname&order=nickname.asc'
  ).catch(function() { return []; });
  if (!choices) return;
  choices.innerHTML = '';
  if (accountNickname) clubInviteJoinAddChoice(choices, accountNickname, true);
  (unregistered || []).forEach(function(row) {
    var nickname = String(row && row.nickname || '').trim();
    if (nickname && nickname.toLowerCase() !== accountNickname.toLowerCase()) clubInviteJoinAddChoice(choices, nickname, false);
  });
  if (!choices.children.length) choices.innerHTML = '<span class="jc-nickname-empty">No registered players available.</span>';
}

function clubInviteJoinSetBusy(busy) {
  var button = document.getElementById('clubInviteJoinSubmitBtn');
  if (button) { button.disabled = !!busy; button.textContent = busy ? 'Sending…' : 'Request to join →'; }
}

function clubInviteJoinShowFeedback(title, message, success) {
  var form = document.getElementById('clubInviteJoinForm');
  var password = document.getElementById('clubInviteJoinPassword');
  var feedback = document.getElementById('clubInviteJoinFeedback');
  if (form) form.hidden = true;
  if (password) password.hidden = true;
  if (feedback) {
    feedback.hidden = false;
    feedback.className = 'club-invite-join-feedback ' + (success ? 'is-success' : 'is-error');
    feedback.innerHTML = '<strong>' + jcEscapeHtml(title) + '</strong><span>' + jcEscapeHtml(message) + '</span>';
  }
}

async function clubInviteJoinSubmit() {
  var input = document.getElementById('clubInviteJoinNickname');
  var nickname = String(input && input.value || '').trim();
  if (!nickname) { if (input) input.focus(); return; }
  var genderInput = document.querySelector('input[name="clubInviteJoinGender"]:checked');
  var gender = genderInput ? genderInput.value : '';
  if (!['Male','Female'].includes(gender)) {
    clubInviteJoinShowFeedback('Choose gender', 'Select Male or Female before requesting to join.', false);
    var form = document.getElementById('clubInviteJoinForm');
    if (form) form.hidden = false;
    return;
  }
  var ratingInput = document.getElementById('clubInviteJoinRating');
  var rating = Number(ratingInput && ratingInput.value);
  if (!(rating >= 1 && rating <= 5)) {
    clubInviteJoinShowFeedback('Check rating', 'Enter a rating from 1.0 to 5.0.', false);
    var ratingForm = document.getElementById('clubInviteJoinForm');
    if (ratingForm) ratingForm.hidden = false;
    if (ratingInput) ratingInput.focus();
    return;
  }
  rating = Math.round(rating * 10) / 10;
  clubInviteJoinSetBusy(true);
  try {
    var currentUser = typeof authGetUser === 'function' ? authGetUser() : null;
    if (currentUser && currentUser.id) {
      await sbPatch('user_accounts', 'id=eq.' + encodeURIComponent(currentUser.id), { gender: gender });
      currentUser.gender = gender;
      try { localStorage.setItem('auth_user', JSON.stringify(currentUser)); } catch (e) {}
    }
    var result = await authRequestJoin(_clubInviteJoinClubId, nickname, rating);
    if (result.needsPassword) {
      _clubInviteJoinClaimNickname = result.conflictNickname || nickname;
      document.getElementById('clubInviteJoinForm').hidden = true;
      document.getElementById('clubInviteJoinPassword').hidden = false;
      document.getElementById('clubInviteJoinPasswordMsg').textContent = '“' + _clubInviteJoinClaimNickname + '” is registered in this club. Enter its default password to claim it.';
      document.getElementById('clubInviteJoinPasswordInput').focus();
      return;
    }
    if (result.alreadyMember) return clubInviteJoinShowFeedback('Already a member', 'You already belong to ' + _clubInviteJoinClubName + '.', true);
    if (result.pending && !_clubInviteJoinSlotId) return clubInviteJoinShowFeedback('Request pending', 'Your request to join ' + _clubInviteJoinClubName + ' is awaiting approval.', true);
    if (result.nicknameConflict) return clubInviteJoinShowFeedback('Nickname unavailable', 'Choose another nickname and try again.', false);
    if (result.error) return clubInviteJoinShowFeedback('Could not send request', result.error, false);
    if (_clubInviteJoinSlotId && typeof myCardSlotsJoin === 'function') {
      await myCardSlotsJoin(_clubInviteJoinSlotId);
      clubInviteJoinShowFeedback('Requests sent', 'Your club and slot requests are awaiting Club Manager approval.', true);
    } else {
      clubInviteJoinShowFeedback('Request sent', 'Your request to join ' + _clubInviteJoinClubName + ' as ' + nickname + ' is awaiting Club Manager approval.', true);
    }
  } finally { clubInviteJoinSetBusy(false); }
}

async function clubInviteJoinClaim() {
  var passwordInput = document.getElementById('clubInviteJoinPasswordInput');
  var password = String(passwordInput && passwordInput.value || '');
  if (!password) { if (passwordInput) passwordInput.focus(); return; }
  var result = await authClaimAndJoin(_clubInviteJoinClubId, _clubInviteJoinClaimNickname, password);
  if (result.error) return clubInviteJoinShowFeedback('Could not verify player', result.error, false);
  clubInviteJoinShowFeedback('Joined ' + _clubInviteJoinClubName, 'Your player identity has been verified and linked.', true);
}

function clubInviteJoinBackToNickname() {
  document.getElementById('clubInviteJoinPassword').hidden = true;
  document.getElementById('clubInviteJoinForm').hidden = false;
}

function clubInviteJoinClose() {
  var page = document.getElementById('clubInviteJoinPage');
  if (page) page.style.display = 'none';
  if (typeof showHomeScreen === 'function') showHomeScreen();
}

/* ── Main entry: show home screen ── */
function showHomeScreen() {
  if (typeof qcStop === 'function') qcStop(); // stop QC when leaving a mode
  // Auth guard
  if (typeof authIsLoggedIn === 'function' && !authIsLoggedIn()) {
    if (typeof authShowScreen === 'function') authShowScreen('welcome');
    return;
  }
  homeHandleSharedClubLink();
var homeEl = document.getElementById('homePageOverlay');
if (!homeEl) return;

// Build 908: a workspace home is the only visible navigation surface.
// Close any inner page left open by the previous workspace before painting
// My Hub / Round Manager / Slot Manager. This prevents stale Players/Rounds
// pages from flashing through or overlapping the newly selected manager.
document.querySelectorAll('.page').forEach(function(page) {
  page.style.display = 'none';
});

// Add body class so .top-bar hides
document.body.classList.add('home-open');

homeEl.style.display = 'flex';
// Always reopen a workspace at its real top. Players and other child pages can
// leave homePageOverlay with a previous scrollTop, which made Round Manager
// reappear clipped under a large blank status-area region after closing Players.
homeEl.scrollTop = 0;
if (homeEl.scrollTo) { try { homeEl.scrollTo({ top: 0, left: 0, behavior: 'auto' }); } catch (_) { homeEl.scrollTop = 0; } }
if (typeof setMyHubTopTabView === 'function') setMyHubTopTabView('home');

// Build 1068: showHomeScreen() is shared by My Hub, Round Manager and Slot Manager.
// Returning from Players calls this function directly, so it must restore the
// workspace chrome itself instead of relying on the earlier switchMode() call.
// Otherwise iOS can keep the blue Round iMode/Home colour in the status safe area.
var activeWorkspace = (typeof appMode !== 'undefined' && appMode) ? appMode : 'viewer';
if (typeof scsSetPrimarySafeArea === 'function') {
  scsSetPrimarySafeArea(activeWorkspace === 'viewer' ? 'home' : 'nonhome');
}

// Restore the shared top bars, but the branded SCS header belongs to Home only.
// Keeping it hidden here for organiser/vault also prevents a one-frame blue paint
// while Players closes and the Round Manager is being rebuilt.
document.querySelectorAll('.home-topbar, .top-bar').forEach(function(b) {
  if (b.classList.contains('home-app-header')) b.style.display = activeWorkspace === 'viewer' ? '' : 'none';
  else b.style.display = '';
});

// Mode + status bar
var isOrganiser = (typeof appMode !== 'undefined') && appMode === 'organiser';
var isVault     = (typeof appMode !== 'undefined') && appMode === 'vault';
var statusBar  = document.getElementById('homeStatusBar');
var statusName = document.getElementById('homeStatusName');
var club   = (typeof getMyClub   === 'function') ? getMyClub()   : null;
var player = (typeof getMyPlayer === 'function') ? getMyPlayer() : null;
var isAdmin = (typeof isClubAdmin === 'function') ? isClubAdmin() : false;

if (club && club.name) {
var modePrefix = isVault ? '🔑 ' : (isAdmin ? '★ ' : '');
if (statusName) statusName.textContent = modePrefix + club.name;
if (statusBar)  statusBar.classList.remove('disconnected');
} else if (player && player.displayName) {
if (statusName) statusName.textContent = player.displayName;
if (statusBar)  statusBar.classList.remove('disconnected');
} else {
if (statusName) statusName.textContent = t('notConnected') || 'Not connected';
if (statusBar)  statusBar.classList.add('disconnected');
}

// Show correct flow and grids (3 modes: viewer / organiser / vault)
var isVault   = (typeof appMode !== 'undefined') && appMode === 'vault';
var isViewer  = !isOrganiser && !isVault;

// Build 1044: keep the new persistent primary navigation in sync with the active hub.
if (typeof scsSyncPrimaryBottomNav === 'function') {
  scsSyncPrimaryBottomNav(isOrganiser ? 'organiser' : (isVault ? 'vault' : 'viewer'));
}

// My Hub always opens on current opportunities. "All Slots" remains
// available during the visit, but is never restored as the entry view.
if (isViewer && typeof myCardSlotsSetView === 'function') {
  myCardSlotsSetView('upcoming');
}

var orgFlow    = document.getElementById('homeOrganizerFlow');
var viewFlow   = document.getElementById('homeViewerFlow');
var orgGrid    = document.getElementById('homeOrgGrid');
var viewerGrid = document.getElementById('homeViewerGrid');
var vaultGrid  = document.getElementById('homeVaultGrid');

if (orgFlow)    orgFlow.style.display    = isOrganiser ? '' : 'none';
if (viewFlow)   viewFlow.style.display   = isViewer    ? '' : 'none';
if (orgGrid)    orgGrid.style.display    = isOrganiser ? '' : 'none';
if (viewerGrid) viewerGrid.style.display = isViewer    ? '' : 'none';
if (vaultGrid)  vaultGrid.style.display  = isVault     ? '' : 'none';

// Top + → Post a Slot now opens the existing Slot Manager page itself.
// The proven calendar + "Add Slot" flow remains the only creation entry point.
// Keep any legacy pending flag cleared so an older cached action cannot
// unexpectedly open the composer over the Slot Manager page.
if (isVault) {
  try { sessionStorage.removeItem('scs_home_quick_action'); } catch (e) {}
}
var orgActionBar    = document.getElementById('homeMoreSectionOrg');
var viewerActionBar = document.getElementById('homeMoreSectionV');
var vaultActionBar  = document.getElementById('homeMoreSectionVault');
// Keep exactly one fixed bottom bar visible.  A CSS class with !important
// prevents stale mode styles from leaving another bar behind during mode changes.
function setModeBarVisible(el, visible, displayValue) {
  if (!el) return;
  el.classList.toggle('scs-mode-bar-hidden', !visible);
  el.style.display = visible ? (displayValue || 'block') : 'none';
  el.setAttribute('aria-hidden', visible ? 'false' : 'true');
}
// Build 1046: the global Home / Round / Slot / Settings bar replaces the
// older per-hub shortcut bars. Keep those bars and their handlers in the DOM
// for compatibility, but do not render them.
setModeBarVisible(orgActionBar, false, 'block');
setModeBarVisible(viewerActionBar, false, 'block');
setModeBarVisible(vaultActionBar, false, 'block');
// Apply player-count gates immediately, before optional home widgets render.
// Some optional widgets can fail independently; setup controls must still
// always match the same gate used by Round/Rolling Mode.
if (isOrganiser) {
  homeUpdateStepper();
  orgInitSchedulingCarousel();
  orgRefreshSchedulingControls();
}
var modeRefreshBtn = document.getElementById('homeModeRefreshBtn');
if (modeRefreshBtn) modeRefreshBtn.style.display = '';

// Render My Card content inline on viewer home
if (isViewer && typeof renderMyCard === 'function') renderMyCard();
if (isViewer && typeof renderMyCardSlotsUI === 'function') {
  // Build 392: startup already populated the Player slot cache. Render it
  // immediately without another blocking download, then refresh quietly.
  renderMyCardSlotsUI(window.__scsWorkspacePrefetchReady ? false : true);
  if (window.__scsWorkspacePrefetchReady) {
    setTimeout(function() { renderMyCardSlotsUI('quiet'); }, 0);
  }
}
if (isViewer && typeof scsRefreshHomeQuickApprovalAction === 'function') {
  scsRefreshHomeQuickApprovalAction();
}
if (isViewer) {
  setMyCardDetailsOpen(false);
  setTimeout(function() { setMyCardDetailsOpen(false); }, 0);
}
// Assist is user-invoked only. Workspace rendering must never open guided
// functions automatically, including for a new or incomplete account.

window.homeModeManualRefresh = async function() {
  var btn = document.getElementById('homeModeRefreshBtn');
  if (btn && btn.disabled) return;
  if (btn) { btn.disabled = true; btn.classList.add('is-refreshing'); }
  try {
    if (typeof syncToLocal === 'function') await syncToLocal();
    if (typeof homeRefreshTiles === 'function') await homeRefreshTiles();
    if (typeof homeRefreshSummaryTile === 'function') homeRefreshSummaryTile();
    if (typeof homeRefreshJoinClubTile === 'function') await homeRefreshJoinClubTile();
    if (isViewer) {
      if (typeof renderMyCard === 'function') await renderMyCard();
      if (typeof myCardSlotsManualRefresh === 'function') await myCardSlotsManualRefresh();
      if (typeof scsRefreshHomeQuickApprovalAction === 'function') await scsRefreshHomeQuickApprovalAction();
    } else if (isVault) {
      if (typeof vaultHomeSlotsManualRefresh === 'function') await vaultHomeSlotsManualRefresh();
      if (typeof vaultSyncStatus === 'function') vaultSyncStatus();
    }
    if (typeof updateWelcomeWorkspaceClubNames === 'function') updateWelcomeWorkspaceClubNames();
    if (typeof showToast === 'function') showToast(isViewer ? 'Player refreshed' : (isVault ? 'Club Manager refreshed' : 'Organiser refreshed'));
  } catch (e) {
    if (typeof showToast === 'function') showToast(e.message || 'Refresh failed');
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('is-refreshing'); }
  }
};

// Show More button — organiser only; reset to collapsed each time home opens
var showMoreBtn = document.getElementById('homeShowMoreBtn');
var moreSection = document.getElementById('homeMoreSection');
var moreLabel   = document.getElementById('homeShowMoreLabel');
if (showMoreBtn) showMoreBtn.style.display = isOrganiser ? '' : 'none';
if (isOrganiser) {
  _homeMoreExpanded = false;
  if (moreSection) { moreSection.classList.add('home-more-collapsed'); moreSection.classList.remove('home-more-expanded'); }
  if (moreLabel)   moreLabel.textContent = 'More ›';
}

// The former Viewer shortcut bar is retained for compatibility but hidden;
// the global primary navigation is the only bottom bar.
var moreSectionV = document.getElementById('homeMoreSectionV');
var mcSlotsSection = document.getElementById('mcUpcomingSlots');
if (mcSlotsSection) mcSlotsSection.style.display = 'none';
if (moreSectionV) {
  setModeBarVisible(moreSectionV, false, 'block');
  moreSectionV.classList.remove('home-more-collapsed');
  moreSectionV.classList.add('home-more-expanded');
}
_homeMoreExpandedV = true;

if (isOrganiser && typeof renderLauncherStartSessionCard === 'function') {
  renderLauncherStartSessionCard();
}
homeRefreshSummaryTile();
homeRefreshTiles();
homeRefreshJoinClubTile();

// Club membership is optional. The legacy Find Club overlay is permanently
// disabled; players open club search themselves from the Clubs button.
var viewerBanner = document.getElementById('viewerNoClubBanner');
if (viewerBanner) {
  viewerBanner.hidden = true;
  viewerBanner.setAttribute('aria-hidden', 'true');
  viewerBanner.style.setProperty('display', 'none', 'important');
}
// Init subscription and show trial banner
if (typeof subInit === 'function') subInit();
if (typeof subShowTrialBanner === 'function') subShowTrialBanner();
}

// ── Organiser bottom navigation count badges ──
function _setOrganiserNavCount(id, count) {
  var el = document.getElementById(id);
  if (!el) return;
  var n = Math.max(0, parseInt(count, 10) || 0);
  el.textContent = n > 99 ? '99+' : String(n);
  el.style.display = n > 0 ? 'inline-flex' : 'none';
  el.setAttribute('aria-label', n + '');
}

function _filterActuallyLiveSessions(sessions) {
  var now = Date.now();
  var staleAfterMs = 3 * 60 * 60 * 1000;
  return (sessions || []).filter(function(session) {
    if (!session) return false;
    var status = String(session.status || 'live').toLowerCase();
    if (status !== 'live') return false;
    var stamp = session.updated_at || session.created_at || '';
    if (!stamp) return true;
    var updatedAt = new Date(stamp).getTime();
    return Number.isFinite(updatedAt) && (now - updatedAt) <= staleAfterMs;
  });
}

function refreshOrganiserLocalNavCounts() {
  var playerCount = 0;
  var pairCount = 0;
  try {
    if (typeof schedulerState !== 'undefined' && schedulerState) {
      playerCount = Array.isArray(schedulerState.activeplayers)
        ? schedulerState.activeplayers.length
        : (Array.isArray(schedulerState.allPlayers) ? schedulerState.allPlayers.length : 0);
      pairCount = Array.isArray(schedulerState.fixedPairs) ? schedulerState.fixedPairs.length : 0;
    }
  } catch (e) {}
  _setOrganiserNavCount('orgNavPlayersCount', playerCount);
  _setOrganiserNavCount('orgNavPairsCount', pairCount);

  // Keep Offline Start eligibility synchronized with the exact same player
  // refresh that drives the green Add Players badge.
  try {
    if (window.SCSOfflineRounds && typeof window.SCSOfflineRounds.refreshOfflineStartAvailability === 'function') {
      window.SCSOfflineRounds.refreshOfflineStartAvailability().then(function() {
        if (typeof window.SCSOfflineRounds.refreshStartLabel === 'function') {
          window.SCSOfflineRounds.refreshStartLabel();
        }
      });
    }
  } catch (_) {}
}


// Keep all organiser badges synchronized while the organiser workspace is open.
// Local session counts are cheap and update immediately; Supabase-backed counts
// refresh at a slower interval and whenever the app becomes active again.
var _organiserBadgeLocalTimer = null;
var _organiserBadgeRemoteTimer = null;
var _organiserBadgeRemoteBusy = false;

function _isOrganiserWorkspaceVisible() {
  try {
    if (typeof window.scsIsRoundManagerVisible === 'function' && window.scsIsRoundManagerVisible()) return false;
    if (typeof appMode === 'undefined' || appMode !== 'organiser') return false;
    var home = document.getElementById('homePageOverlay');
    if (!home) return true;
    var style = window.getComputedStyle(home);
    return style.display !== 'none' && style.visibility !== 'hidden';
  } catch (e) {
    return false;
  }
}

async function refreshOrganiserRemoteNavCounts() {
  if (_organiserBadgeRemoteBusy || !_isOrganiserWorkspaceVisible()) return;
  _organiserBadgeRemoteBusy = true;
  try {
    var club = (typeof getMyClub === 'function') ? getMyClub() : null;
    if (!club || !club.id) {
      _setOrganiserNavCount('orgNavLiveCount', 0);
      _setOrganiserNavCount('orgNavApprovalCount', 0);
      return;
    }

    var livePromise = (typeof dbGetLiveSessions === 'function')
      ? dbGetLiveSessions().catch(function(){ return []; })
      : Promise.resolve([]);
    var requestPromise = (typeof sbGet === 'function')
      ? sbGet('club_join_requests', 'club_id=eq.' + club.id + '&status=eq.pending&select=id').catch(function(){ return []; })
      : Promise.resolve([]);

    var results = await Promise.all([livePromise, requestPromise]);
    _setOrganiserNavCount('orgNavLiveCount', _filterActuallyLiveSessions(results[0]).length);
    _setOrganiserNavCount('orgNavApprovalCount', (results[1] || []).length);
  } catch (e) {
    // Keep the last successfully displayed values during a temporary network error.
  } finally {
    _organiserBadgeRemoteBusy = false;
  }
}

function startOrganiserBadgeSync() {
  if (_organiserBadgeLocalTimer) clearInterval(_organiserBadgeLocalTimer);
  if (_organiserBadgeRemoteTimer) clearInterval(_organiserBadgeRemoteTimer);

  refreshOrganiserLocalNavCounts();
  refreshOrganiserRemoteNavCounts();

  _organiserBadgeLocalTimer = setInterval(function() {
    if (_isOrganiserWorkspaceVisible()) refreshOrganiserLocalNavCounts();
  }, 700);

  _organiserBadgeRemoteTimer = setInterval(function() {
    refreshOrganiserRemoteNavCounts();
  }, 8000);
}

function stopOrganiserBadgeSync() {
  if (_organiserBadgeLocalTimer) clearInterval(_organiserBadgeLocalTimer);
  if (_organiserBadgeRemoteTimer) clearInterval(_organiserBadgeRemoteTimer);
  _organiserBadgeLocalTimer = null;
  _organiserBadgeRemoteTimer = null;
}

document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') {
    refreshOrganiserLocalNavCounts();
    refreshOrganiserRemoteNavCounts();
  }
});
window.addEventListener('focus', function() {
  refreshOrganiserLocalNavCounts();
  refreshOrganiserRemoteNavCounts();
});
// Capture taps so counts refresh immediately after Add Players, Fixed Pairs,
// Dashboard or Approve Players actions complete and the organiser page returns.
document.addEventListener('click', function() {
  if (!_isOrganiserWorkspaceVisible()) return;
  setTimeout(refreshOrganiserLocalNavCounts, 0);
  setTimeout(refreshOrganiserRemoteNavCounts, 350);
}, true);

startOrganiserBadgeSync();

/* ── Refresh all tile subtitles with live data ── */
async function homeRefreshTiles() {
refreshOrganiserLocalNavCounts();
var isOrganiser = (typeof appMode !== 'undefined') && appMode === 'organiser';

// ── Vault ──
var club   = (typeof getMyClub   === 'function') ? getMyClub()   : null;
var isAdmin = (typeof isClubAdmin === 'function') ? isClubAdmin() : false;
var vaultSub = document.getElementById('tileSubVault');
if (vaultSub) {
if (club && club.name) {
vaultSub.textContent = club.name + (isAdmin ? ' ' + t('adminRole') : ' ' + t('userRole'));
} else {
vaultSub.textContent = t('notConnected') || 'Not connected';
}
}

// ── Vault -- show/hide no-club state vs tiles ──
var vaultNoClub  = document.getElementById('vaultNoClubState');
var vaultTileGrid = document.getElementById('vaultTileGrid');
var vaultStatusTile = document.getElementById('vaultClubStatusTile');
var roundsTemplateAction = document.querySelector('.vault-action-template');
var selectedVaultClubId = localStorage.getItem('kbrr_vault_club_id') || (club && club.id) || '';
var roundsTemplateClubId = window.SCS_ROUNDS_TEMPLATE_CLUB_ID || '';
if (roundsTemplateAction) {
var roundsTemplateAllowed = String(selectedVaultClubId) === String(roundsTemplateClubId);
roundsTemplateAction.hidden = !roundsTemplateAllowed;
roundsTemplateAction.style.display = roundsTemplateAllowed ? '' : 'none';
}

if (club && club.id) {
// Has club -- show tiles, hide create form
if (vaultNoClub)    vaultNoClub.style.display    = 'none';
if (vaultTileGrid)  vaultTileGrid.style.display  = '';
if (vaultStatusTile) vaultStatusTile.style.display = '';
} else {
// No club -- show create form, hide tiles
if (vaultNoClub)    vaultNoClub.style.display    = '';
if (vaultTileGrid)  vaultTileGrid.style.display  = 'none';
if (vaultStatusTile) vaultStatusTile.style.display = 'none';
}

// ── Vault club status tile ──
var vctName  = document.getElementById('vctName');
var vctBadge = document.getElementById('vctBadge');
var vctDot   = document.getElementById('vctDot');
if (vctName) {
if (club && club.name) {
vctName.textContent = club.name;
var vaultWorkspaceTitle = document.getElementById('vaultWorkspaceTitle');
if (vaultWorkspaceTitle) vaultWorkspaceTitle.textContent = club.name;
// Build 1094: on the Manage / Club Slot workspace, the header title is the selected club name.
if (isVault) {
  var vaultHeaderName = document.getElementById('homeUserHeaderName');
  if (vaultHeaderName) vaultHeaderName.textContent = club.name;
}
if (vctDot) vctDot.style.background = '#2dce89';
if (vctBadge) {
vctBadge.textContent = t('adminBadge') || 'ADMIN';
vctBadge.style.background = '#2dce89';
vctBadge.style.color = '#000';
vctBadge.style.display = '';
}
} else {
vctName.textContent = t('noClubSelected');
var vaultWorkspaceTitleEmpty = document.getElementById('vaultWorkspaceTitle');
if (vaultWorkspaceTitleEmpty) vaultWorkspaceTitleEmpty.textContent = t('noClubSelected') || 'No club selected';
if (vctBadge) vctBadge.style.display = 'none';
if (vctDot) vctDot.style.background = '#888';
}
}

// ── Organiser club tile (home-tile style) ──
var orgVctName  = document.getElementById('orgVctName');
var orgVctBadge = document.getElementById('orgVctBadge');
var orgTileIcon = document.getElementById('orgTileIcon');
if (orgVctName) {
if (club && club.name) {
orgVctName.textContent  = club.name;
if (orgVctBadge) orgVctBadge.textContent = '✅ ' + (t('connectClub') || 'Connected');
if (orgTileIcon) orgTileIcon.textContent  = '🏢';
} else {
orgVctName.textContent  = t('clubLabel') || 'Club';
if (orgVctBadge) orgVctBadge.textContent = t('tapConnect');
if (orgTileIcon) orgTileIcon.textContent  = '🏢';
}
}

// ── Vault gradient tiles -- load live stats ──
if (club && club.id) {
homeRefreshVaultTiles(club.id);
if (typeof vaultSlotsRenderMiniTile === 'function') vaultSlotsRenderMiniTile(club.id);
}

// ── Players ──
var playersSub = document.getElementById('tileSubPlayers');
if (playersSub) {
if (typeof schedulerState !== 'undefined' && schedulerState.allPlayers) {
var total  = schedulerState.allPlayers.length;
var active = schedulerState.activeplayers.length;
_setOrganiserNavCount('orgNavPlayersCount', active);
playersSub.textContent = total > 0
? total + ' ' + t('playerPlural') + ' · ' + active + ' ' + t('playersActive')
: (t('addRemove') || 'Add · Remove');
} else {
playersSub.textContent = t('addRemove');
_setOrganiserNavCount('orgNavPlayersCount', 0);
}
}

// ── Fixed Pairs ──
var pairsSub = document.getElementById('tileSubPairs');
if (pairsSub) {
var pairCount = (typeof schedulerState !== 'undefined' && schedulerState.fixedPairs)
? schedulerState.fixedPairs.length : 0;
_setOrganiserNavCount('orgNavPairsCount', pairCount);
pairsSub.textContent = pairCount > 0
? pairCount + ' ' + (pairCount === 1 ? (t('pairSet') || 'pair set') : (t('pairsSet') || 'pairs set'))
: t('optional');
}

// ── Settings ──
var settingsSub = document.getElementById('tileSubSettings');
var settingsSubV = document.getElementById('tileSubSettingsV');
var settingsText = '';
if (settingsSub || settingsSubV) {
var theme    = localStorage.getItem('app-theme')    || 'dark';
var fontSize = localStorage.getItem('appFontSize')  || 'medium';
settingsText = (theme.charAt(0).toUpperCase() + theme.slice(1))
+ ' · ' + (fontSize.charAt(0).toUpperCase() + fontSize.slice(1));
if (settingsSub)  settingsSub.textContent  = settingsText;
if (settingsSubV) settingsSubV.textContent = settingsText;
}

// ── My Card tile (organiser grid only — viewer home uses renderMyCard directly) ──
var tileRating  = document.getElementById('homeTileRating');
var tileName    = document.getElementById('homeTileName');
var tileAvatar  = document.getElementById('homeTileAvatar');
var tileIcon    = document.getElementById('homeTileIcon');
var player = (typeof getMyPlayer === 'function') ? getMyPlayer() : null;

function _setMyCardTileBase(name, avatar, icon, rating, p) {
if (!name) return;
if (p) {
if (name)   name.textContent = p.name;
if (avatar) { avatar.src = p.gender === 'Female' ? 'female.png' : 'male.png'; avatar.style.display = 'block'; }
if (icon)   icon.style.display = 'none';
if (rating) rating.textContent = t('loading');
} else {
if (name)   name.textContent = t('myCard');
if (avatar) avatar.style.display = 'none';
if (icon)   { icon.style.display = ''; icon.textContent = '👤'; }
if (rating) rating.textContent = t('notSelected');
}
}
_setMyCardTileBase(tileName, tileAvatar, tileIcon, tileRating, player);

// Auto-fetch rating from all memberships (no live session needed)
if (player) {
(async function() {
try {
var user = (typeof authGetUser === 'function') ? authGetUser() : null;
var bestRating = null;
var bestClubName = null;
var wins = 0, losses = 0;

    if (user) {
      // Use the ACTIVE club specifically, not the highest-rated one
      var activeClub = (typeof getMyClub === 'function') ? getMyClub() : null;
      var mems = await sbGet('memberships',
        'user_account_id=eq.' + user.id +
        '&select=club_id,club_rating,nickname,player_id').catch(function(){ return []; });

      if (mems && mems.length) {
        // Fetch club names separately
        var clubIds = mems.map(function(m){ return m.club_id; });
        var clubRows = await sbGet('clubs', 'id=in.(' + clubIds.join(',') + ')&select=id,name').catch(function(){ return []; });
        var clubMap = {};
        (clubRows || []).forEach(function(c){ clubMap[c.id] = c.name; });

        // Find the active club's membership first, fall back to highest rating
        var activeMem = activeClub && activeClub.id
          ? mems.find(function(m){ return m.club_id === activeClub.id; })
          : null;
        var bestMem = activeMem || mems.reduce(function(best, m) {
          return (!best || parseFloat(m.club_rating) > parseFloat(best.club_rating)) ? m : best;
        }, null);

        bestRating = parseFloat(bestMem.club_rating) || 1.0;
        bestClubName = clubMap[bestMem.club_id] || null;

        // Wins/losses from the linked player record
        var pid = bestMem.player_id;
        if (pid) {
          var prows = await sbGet('players', 'id=eq.' + pid + '&select=wins,losses').catch(function(){ return []; });
          if (prows && prows[0]) {
            wins   = prows[0].wins   || 0;
            losses = prows[0].losses || 0;
          }
        }
      }
    }

    // Fallback to local cache if Supabase gave nothing
    if (bestRating === null) {
      var master = JSON.parse(localStorage.getItem('newImportHistory') || '[]');
      var hp = master.find(function(h) {
        return h.displayName && h.displayName.trim().toLowerCase() === player.name.trim().toLowerCase();
      });
      bestRating = parseFloat(hp && hp.clubRating) || 1.0;
    }

    var label = bestClubName ? bestClubName + '  ·  ' + bestRating.toFixed(1) : 'Club ' + bestRating.toFixed(1);
    if (wins || losses) label += '  ·  ' + t('winsShort') + ':' + wins + ' ' + t('lossesShort') + ':' + losses;

    if (tileRating)  tileRating.textContent  = label;
  } catch(e) {
    if (tileRating)  tileRating.textContent  = t('loading') || 'Tap to view';
  }
})();

}

// ── Clubs -- show joined-club count on the Player navigation button ──
var clubCountBadge = document.getElementById('tileClubCountBadge');
var clubCountMeta  = document.getElementById('tileSubJoinClub');
if (clubCountBadge || clubCountMeta) {
  try {
    var joinedClubIds = (typeof dbGetMyJoinedClubIds === 'function')
      ? await dbGetMyJoinedClubIds()
      : [];
    var joinedClubCount = joinedClubIds.length;
    if (clubCountBadge) {
      clubCountBadge.textContent = joinedClubCount;
      clubCountBadge.style.display = '';
      clubCountBadge.setAttribute('aria-label', joinedClubCount + ' clubs joined');
    }
    if (clubCountMeta) {
      clubCountMeta.textContent = joinedClubCount + ' ' + (joinedClubCount === 1 ? 'club' : 'clubs') + ' joined';
    }
  } catch (e) {
    if (clubCountBadge) clubCountBadge.style.display = 'none';
  }
}

// ── Dashboard -- async fetch live session count ──
var dashSub  = document.getElementById('tileSubDashboard');
var dashSubV = document.getElementById('tileSubDashboardV');
if (dashSub || dashSubV) {
if (dashSub)  dashSub.textContent  = t('loading');
if (dashSubV) dashSubV.textContent = t('loading');
try {
var sessions = (typeof dbGetLiveSessions === 'function') ? await dbGetLiveSessions() : [];
var count = _filterActuallyLiveSessions(sessions).length;
_setOrganiserNavCount('orgNavLiveCount', count);
var dashText = count > 0
? count + ' ' + t('liveSession') + (count !== 1 ? 's' : '')
: t('noLiveSessions');
if (dashSub)  dashSub.textContent  = dashText;
if (dashSubV) dashSubV.textContent = dashText;
} catch(e) {
if (dashSub)  dashSub.textContent  = t('liveSessions');
if (dashSubV) dashSubV.textContent = t('liveSessions');
}
}
}

/* ── Hide home screen (go to inner page) ── */
function homeHideScreen() {
var homeEl = document.getElementById('homePageOverlay');
if (homeEl) homeEl.style.display = 'none';
document.body.classList.remove('home-open');
// Players/Register and every other inner page use the normal app safe area,
// never the blue Home status-bar background.
if (typeof scsSetPrimarySafeArea === 'function') scsSetPrimarySafeArea('nonhome');
}

var _myHubEmbeddedPages = {};

function _myHubMountExistingPage(view) {
  var map = {
    clubs: { pageId: 'joinClubPage', hostId: 'myHubClubsView' },
    report: { pageId: 'vaultReport2Page', hostId: 'myHubReportView' }
  };
  var cfg = map[view];
  if (!cfg) return null;

  var page = document.getElementById(cfg.pageId);
  var host = document.getElementById(cfg.hostId);
  if (!page || !host) return null;

  if (!_myHubEmbeddedPages[cfg.pageId]) {
    _myHubEmbeddedPages[cfg.pageId] = {
      parent: page.parentNode,
      next: page.nextSibling,
      style: page.getAttribute('style') || '',
      className: page.className
    };
  }

  if (page.parentNode !== host) host.appendChild(page);
  page.classList.add('myhub-embedded-page');
  page.style.display = 'block';
  return page;
}

function _myHubRestoreEmbeddedPages(exceptView) {
  var keepId = exceptView === 'clubs' ? 'joinClubPage' : (exceptView === 'report' ? 'vaultReport2Page' : null);
  ['joinClubPage','vaultReport2Page'].forEach(function(pageId) {
    if (pageId === keepId) return;
    var rec = _myHubEmbeddedPages[pageId];
    var page = document.getElementById(pageId);
    if (!rec || !page) return;
    page.classList.remove('myhub-embedded-page');
    page.setAttribute('style', rec.style);
    if (rec.next && rec.next.parentNode === rec.parent) rec.parent.insertBefore(page, rec.next);
    else rec.parent.appendChild(page);
  });
}

function setMyHubTopTabView(view) {
  if (!view) view = 'home';
  // Personal My Slots gets its own page tint; all other user tabs keep the normal Home background.
  document.body.classList.toggle('my-slots-view', view === 'slots');
  if (view === 'clubs' || view === 'report') _myHubMountExistingPage(view);
  _myHubRestoreEmbeddedPages(view);

  document.querySelectorAll('.myhub-tab-view').forEach(function(panel) {
    var active = panel.getAttribute('data-myhub-view') === view;
    panel.classList.toggle('is-active', active);
    panel.setAttribute('aria-hidden', active ? 'false' : 'true');
  });

  document.querySelectorAll('.myhub-top-tab').forEach(function(btn){
    var label = btn.textContent.trim().toLowerCase();
    var active = label === view;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  if (view === 'clubs' && typeof joinClubPageOpen === 'function') {
    try { joinClubPageOpen(); } catch(e) { console.warn('My Hub clubs load failed', e); }
  }
  if (view === 'report' && typeof r2Init === 'function') {
    try { r2Init(); } catch(e) { console.warn('My Hub report load failed', e); }
  }
}

function homeOpenMyHubTab(view) {
  if (typeof showHomeScreen === 'function') showHomeScreen();
  setMyHubTopTabView(view);
}

/* Open the existing My Hub slot calendar instead of duplicating a slots page. */
function homeOpenViewerSlots() {
  homeOpenMyHubTab('slots');
  if (typeof myCardSlotsSetView === 'function') myCardSlotsSetView('upcoming');
  if (typeof renderMyCardSlotsUI === 'function') renderMyCardSlotsUI(false);
}

/* ── Navigate to an inner page ── */
function homeGo(pageId, tabId) {
if (!pageId) return;
if (pageId === 'settingsPage' && typeof scsCaptureSettingsReturnState === 'function') scsCaptureSettingsReturnState();
if (pageId === 'joinClubPage') { homeOpenMyHubTab('clubs'); return; }
if (pageId === 'vaultReport2Page') { homeOpenMyHubTab('report'); return; }
homeHideScreen();
_navSource = 'home';
if (pageId === 'playersPage') window.__scsPlayersReturnSource = 'home';
var tabEl = tabId ? document.getElementById(tabId) : null;
showPage(pageId, tabEl);
_updateDynamicBackBtns(pageId);
}

/* ── Organiser navigation ── */
function homeGuideOpenPlayersFromNav() {
  // When Players is opened from Round Manager, preserve Round as its owner so
  // the Players close button returns to Round Manager (not a previously opened Settings page).
  var roundNav = document.getElementById('scsNavRound');
  var fromRoundManager = !!(roundNav && roundNav.classList.contains('is-active')) ||
    (typeof appMode !== 'undefined' && appMode === 'organiser');
  if (fromRoundManager) {
    roundsGoPlayers();
    return;
  }
  homeGo('playersPage', 'tabBtnPlayers');
}

function homeGuideOpenPairsFromNav() {
  if (schedulerState.activeplayers.length < 4) {
    if (typeof showToast === 'function') showToast(_homeT('addAtLeast4Step', 'Add at least 4 players first.'));
    return;
  }
  homeGo('fixedPairsPage', 'tabBtnFixedPairs');
}

function homeApplyPlayerSetupGates(enoughPlayers) {
  var courtsCard = document.getElementById('organiserCourtsCard');
  var pairsBtn = document.getElementById('orgNavFixedPairs');

  if (pairsBtn) {
    pairsBtn.disabled = !enoughPlayers;
    pairsBtn.setAttribute('aria-disabled', enoughPlayers ? 'false' : 'true');
    pairsBtn.classList.toggle('organiser-step-disabled', !enoughPlayers);
  }
  if (courtsCard) {
    courtsCard.classList.toggle('organiser-step-disabled', !enoughPlayers);
    courtsCard.setAttribute('aria-disabled', enoughPlayers ? 'false' : 'true');
    courtsCard.querySelectorAll('button,input').forEach(function(control) {
      control.disabled = !enoughPlayers;
    });
  }
}

/* ── Return from an inner page ── */
function homeBack() {
showHomeScreen();
}

/* Keep functional player-count gates synchronized. */
function homeUpdateStepper() {
  homeUpdateGoRoundsBtn();
}

/* ── Enable/disable mode buttons — mutual exclusion between Rounds and MBM ── */
function homeUpdateGoRoundsBtn() {
  var enough       = schedulerState.activeplayers.length >= 4;
  var mbmActive    = !!schedulerState.mbmActive;
  var roundsActive = Array.isArray(allRounds) && allRounds.filter(function(r) { return !r.isMbm; }).length > 0;

  // Use the same player-count gate as Round/Rolling Mode for the setup controls.
  homeApplyPlayerSetupGates(enough);

  var roundsBtn = document.getElementById('gotoRoundsBtn');
  var mbmBtn    = document.getElementById('gotoMbmBtn');

  var roundsEndBtn = document.getElementById('roundsEndBtn');
  var mbmEndBtn2   = document.getElementById('mbmEndBtn2');

  if (roundsBtn) {
    var roundsOk = enough && !mbmActive;
    roundsBtn.disabled      = !roundsOk;
    roundsBtn.style.opacity = roundsOk ? '1' : '0.45';
    roundsBtn.style.cursor  = roundsOk ? 'pointer' : 'not-allowed';
    roundsBtn.title = mbmActive ? (t('rollingActiveEndFirst') || 'Rolling Matches session is active. End it first.') : '';
  }
  // Show End button only when rounds session is active
  if (roundsEndBtn) roundsEndBtn.style.display = roundsActive ? 'flex' : 'none';

  if (mbmBtn) {
    var mbmOk = enough && !roundsActive;
    mbmBtn.disabled      = !mbmOk;
    mbmBtn.style.opacity = mbmOk ? '1' : '0.45';
    mbmBtn.style.cursor  = mbmOk ? 'pointer' : 'not-allowed';
    mbmBtn.title = roundsActive ? (t('roundActiveEndFirst') || 'Round Mode session is active. End it first.') : '';
  }
  // Show End button only when MBM session is active
  if (mbmEndBtn2) mbmEndBtn2.style.display = mbmActive ? 'flex' : 'none';
  if (typeof orgRefreshSchedulingControls === 'function') orgRefreshSchedulingControls();
}

async function mbmGo() {
  // Rolling Mode owns its court count on the Rolling Matches page.
  var numCourts = Math.max(1, schedulerState.numCourts || 1);
  schedulerState.numCourts = numCourts;
  var totalPlayers = schedulerState.activeplayers.length;
  if (!totalPlayers) { alert('Please add players first!'); return; }

  homeHideScreen();
  showPage('mbmPage', null);
  _updateDynamicBackBtns('mbmPage');

  var mbmBar = document.getElementById('mbmLiveBar');
  if (mbmBar) mbmBar.style.display = '';

  if (!schedulerState.mbmActive) {
    // Fresh start — always reinitialise cleanly
    if (orgGetInitialPlayerOrder() === 'random') {
      for (var playerIndex = schedulerState.activeplayers.length - 1; playerIndex > 0; playerIndex--) {
        var randomIndex = Math.floor(Math.random() * (playerIndex + 1));
        var player = schedulerState.activeplayers[playerIndex];
        schedulerState.activeplayers[playerIndex] = schedulerState.activeplayers[randomIndex];
        schedulerState.activeplayers[randomIndex] = player;
      }
    }
    initScheduler(numCourts);
    allRounds.length = 0;
    currentRoundIndex = 0;

    mbmWaitingQueue = [];
    mbmCourtStates  = {};
    if (typeof mbmPlayCount      !== 'undefined') mbmPlayCount      = new Map();
    if (typeof mbmScheduleCount  !== 'undefined') mbmScheduleCount  = new Map();
    if (typeof mbmCompletedGames !== 'undefined') mbmCompletedGames = [];
    if (typeof mbmRounds         !== 'undefined') mbmRounds         = [];

    var round = await safeGenerateRound(schedulerState);
    if (!round || !round.games) {
      alert('Failed to generate initial round. Please try again.');
      showHomeScreen();
      return;
    }
    allRounds.push(round);
    if (Array.isArray(allRounds)) allRounds.forEach(function(r) { r.isMbm = true; });

    schedulerState.mbmActive = true;
    ensureLiveSession();

    var data = allRounds[0];
    if (data && data.resting) {
      data.resting.forEach(function(r) {
        var base = r.split('#')[0];
        if (!mbmWaitingQueue.includes(base)) mbmWaitingQueue.push(base);
      });
    }
  }

  // Always re-render existing state
  if (typeof mbmShowRound === 'function') mbmShowRound();
}

/* ── Round preferences panel ── */
function homeShowCourtsPanel() {
  var mainToggle = document.getElementById('modeToggle');
  var stepToggle = document.getElementById('stepModeToggle');
  if (mainToggle && stepToggle) stepToggle.checked = mainToggle.checked;

  if (typeof setGameGenerationMode === 'function' && typeof getGameGenerationMode === 'function') {
    setGameGenerationMode(getGameGenerationMode(), false);
  }
}

function stepSyncMode() {
  var stepToggle = document.getElementById('stepModeToggle');
  var mainToggle = document.getElementById('modeToggle');
  if (stepToggle && mainToggle) {
    mainToggle.checked = stepToggle.checked;
    localStorage.setItem('playMode', stepToggle.checked ? 'competitive' : 'random');
    mainToggle.dispatchEvent(new Event('change'));
  }
}

function stepSyncGameGeneration(mode) {
  if (typeof setGameGenerationMode === 'function') {
    setGameGenerationMode(mode, true);
  }
}

var _orgSchedulingSlide = 0;
function orgSetSchedulingSlide(index) {
  var requestedSlide = Math.max(0, Math.min(2, Number(index) || 0));
  if (window.SCSOfflineRounds &&
      typeof window.SCSOfflineRounds.hasSessionInProgress === 'function' &&
      window.SCSOfflineRounds.hasSessionInProgress() &&
      requestedSlide !== 1) {
    requestedSlide = 1;
  }
  _orgSchedulingSlide = requestedSlide;
  var carousel = document.getElementById('orgModeCarousel');
  if (!carousel) return;
  carousel.dataset.activeSlide = String(_orgSchedulingSlide);
  var track = carousel.querySelector('.org-mode-track');
  if (track) track.style.transform = 'translateX(' + (_orgSchedulingSlide * -100) + '%)';
  document.querySelectorAll('.org-carousel-dots button').forEach(function(dot, dotIndex) {
    dot.classList.toggle('is-active', dotIndex === _orgSchedulingSlide);
    dot.setAttribute('aria-selected', dotIndex === _orgSchedulingSlide ? 'true' : 'false');
  });
}

function orgSetUniquePairMode(checked) {
  if (typeof setUniquePairMode === 'function') setUniquePairMode(!!checked, true);
  if (typeof requestRoundOneSetupRegeneration === 'function') requestRoundOneSetupRegeneration();
  orgRefreshUniquePairControl();
}

function orgRefreshUniquePairControl() {
  var rollingToggle = document.getElementById('sampleRollingUniquePairMode');
  if (!rollingToggle) {
    var sourceRow = document.querySelector('.org-mode-panel-round:not(.org-mode-panel-offline) .org-unique-pair-setting');
    var rollingSection = document.querySelector('.org-mode-panel-rolling .org-color-algorithm-section');
    if (sourceRow && rollingSection) {
      var rollingRow = sourceRow.cloneNode(true);
      rollingToggle = rollingRow.querySelector('input');
      if (rollingToggle) {
        rollingToggle.id = 'sampleRollingUniquePairMode';
        rollingToggle.onchange = function() { orgSetUniquePairMode(this.checked); };
      }
      rollingSection.appendChild(rollingRow);
    }
  }
  var enabled = (typeof getUniquePairMode === 'function') ? getUniquePairMode() : true;
  var standard = (typeof getGameGenerationMode === 'function') ? getGameGenerationMode() !== 'balanced' : true;
  ['sampleUniquePairMode', 'sampleRollingUniquePairMode'].forEach(function(id) {
    var toggle = document.getElementById(id);
    if (!toggle) return;
    toggle.checked = !!enabled;
    toggle.disabled = !standard;
    var row = toggle.closest('.org-unique-pair-setting');
    if (row) row.classList.toggle('is-disabled', !standard);
  });
}

function orgSelectGameStyle(mode) {
  var source = document.getElementById(mode === 'balanced' ? 'homeGameModeBalanced' : 'homeGameModeStandard');
  if (source) {
    source.checked = true;
    source.dispatchEvent(new Event('change', { bubbles: true }));
  }
  ['sampleGameModeStandard', 'sampleRollingGameModeStandard'].forEach(function(id) {
    var button = document.getElementById(id);
    if (button) button.classList.toggle('is-active', mode !== 'balanced');
  });
  ['sampleGameModeBalanced', 'sampleRollingGameModeBalanced'].forEach(function(id) {
    var button = document.getElementById(id);
    if (button) button.classList.toggle('is-active', mode === 'balanced');
  });
  orgRefreshUniquePairControl();
  orgUpdateModeSummaries();
}

function orgGetInitialPlayerOrder() {
  return localStorage.getItem('initialPlayerOrder') === 'keep' ? 'keep' : 'random';
}

function orgPaintInitialPlayerOrder(mode) {
  mode = mode === 'keep' ? 'keep' : 'random';
  [
    ['samplePlayerOrderRandom', 'random'], ['samplePlayerOrderKeep', 'keep'],
    ['sampleRollingPlayerOrderRandom', 'random'], ['sampleRollingPlayerOrderKeep', 'keep']
  ].forEach(function(entry) {
    var button = document.getElementById(entry[0]);
    if (!button) return;
    var selected = entry[1] === mode;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-checked', selected ? 'true' : 'false');
    var marker = button.querySelector('span');
    if (marker) marker.textContent = selected ? '◉' : '○';
  });
  ['sampleRoundPlayerOrderToggle', 'sampleRollingPlayerOrderToggle'].forEach(function(id) {
    var toggle = document.getElementById(id);
    if (toggle) toggle.checked = mode !== 'keep';
  });
}

function orgSelectInitialPlayerOrder(mode) {
  mode = mode === 'keep' ? 'keep' : 'random';
  localStorage.setItem('initialPlayerOrder', mode);
  orgPaintInitialPlayerOrder(mode);
  if (typeof requestRoundOneSetupRegeneration === 'function') requestRoundOneSetupRegeneration();
  orgUpdateModeSummaries();
}

function orgSetRandomPlayerOrder(checked) {
  orgSelectInitialPlayerOrder(checked ? 'random' : 'keep');
}

function orgGetRoundFormat() {
  var saved = localStorage.getItem('roundFormatPreset');
  return saved === 'doubles' || saved === 'singles' ? saved : 'both';
}

function orgPaintRoundFormat(mode) {
  ['doubles','singles','both'].forEach(function(value) {
    var button = document.getElementById('sampleRoundFormat' + value.charAt(0).toUpperCase() + value.slice(1));
    if (!button) return;
    button.classList.toggle('is-active', value === mode);
    var marker = button.querySelector('span');
    if (marker) marker.textContent = value === mode ? '◉' : '○';
  });
}

function orgAdjustCourtCount(delta) {
  var current = Math.max(1, Number(typeof courts !== 'undefined' ? courts : (typeof schedulerState !== 'undefined' ? schedulerState.numCourts : 1)) || 1);
  orgSetCourtCount(current + (Number(delta) || 0));
}

function orgSetCourtCount(value) {
  var next = Math.max(1, Math.min(6, parseInt(value, 10) || 1));
  var totalPlayers = (typeof schedulerState !== 'undefined' && Array.isArray(schedulerState.activeplayers)) ? schedulerState.activeplayers.length : 0;
  var maxCourts = totalPlayers > 0 ? Math.max(1, Math.min(6, Math.floor(totalPlayers / 2))) : 6;
  next = Math.min(next, maxCourts);

  if (typeof courts !== 'undefined') courts = next;
  if (typeof schedulerState !== 'undefined') {
    schedulerState.numCourts = next;
    schedulerState.courts = next;
    if (!Array.isArray(schedulerState.courtFormats)) schedulerState.courtFormats = [];
    if (!Array.isArray(schedulerState.courtTypes)) schedulerState.courtTypes = [];
    var preset = orgGetRoundFormat();
    while (schedulerState.courtFormats.length < next) {
      var format = preset === 'singles' ? 'singles' : 'doubles';
      schedulerState.courtFormats.push(format);
      schedulerState.courtTypes.push(format === 'singles' ? 'singles-free' : 'free');
    }
    schedulerState.courtFormats = schedulerState.courtFormats.slice(0, next);
    schedulerState.courtTypes = schedulerState.courtTypes.slice(0, next);
  }
  var roundCount = document.getElementById('num-courts');
  if (roundCount) roundCount.textContent = String(next);
  orgRefreshCourtSelectors();
  if (typeof updateCourtButtons === 'function') updateCourtButtons();
}

function orgRefreshCourtSelectors() {
  var count = Math.max(1, Number(typeof courts !== 'undefined' ? courts : (typeof schedulerState !== 'undefined' ? schedulerState.numCourts : 1)) || 1);
  var totalPlayers = (typeof schedulerState !== 'undefined' && Array.isArray(schedulerState.activeplayers)) ? schedulerState.activeplayers.length : 0;
  var maxCourts = totalPlayers > 0 ? Math.max(1, Math.min(6, Math.floor(totalPlayers / 2))) : 6;
  var shown = Math.min(count, maxCourts, 6);
  [
    ['sampleRoundCourtsValue','sampleRoundCourtsMinus','sampleRoundCourtsPlus'],
    ['sampleRollingCourtsValue','sampleRollingCourtsMinus','sampleRollingCourtsPlus']
  ].forEach(function(ids) {
    var value = document.getElementById(ids[0]);
    var minus = document.getElementById(ids[1]);
    var plus = document.getElementById(ids[2]);
    if (value) value.textContent = String(shown);
    if (minus) minus.disabled = shown <= 1;
    if (plus) plus.disabled = shown >= maxCourts;
  });
}

function orgSelectRoundFormat(mode) {
  mode = mode === 'doubles' || mode === 'singles' ? mode : 'both';
  localStorage.setItem('roundFormatPreset', mode);
  if (mode !== 'both' && typeof schedulerState !== 'undefined') {
    var courtCount = Math.max(1, Number(typeof courts !== 'undefined' ? courts : schedulerState.numCourts) || 1);
    schedulerState.courtFormats = Array(courtCount).fill(mode);
    schedulerState.courtTypes = Array(courtCount).fill(mode === 'singles' ? 'singles-free' : 'free');
    if (typeof updateCourtPills === 'function') updateCourtPills();
  }
  orgPaintRoundFormat(mode);
  orgPaintRollingRoundFormat(mode);
  orgUpdateModeSummaries();
}

function orgPaintRollingRoundFormat(mode) {
  ['doubles', 'singles', 'both'].forEach(function(value) {
    var suffix = value.charAt(0).toUpperCase() + value.slice(1);
    var button = document.getElementById('sampleRollingFormat' + suffix);
    if (!button) return;
    var selected = value === mode;
    button.classList.toggle('is-active', selected);
    var marker = button.querySelector('span');
    if (marker) marker.textContent = selected ? '◉' : '○';
  });
}

function orgSetWinnerMode(checked) {
  var source = document.getElementById('stepModeToggle');
  if (source) {
    source.checked = !!checked;
    source.dispatchEvent(new Event('change', { bubbles: true }));
  }
  ['sampleRoundWinner', 'sampleRollingWinner'].forEach(function(id) {
    var toggle = document.getElementById(id);
    if (toggle) toggle.checked = !!checked;
  });
  orgUpdateModeSummaries();
}

function orgUpdateModeSummaries() {
  var format = orgGetRoundFormat();
  var formatText = format === 'doubles' ? 'Doubles' : (format === 'singles' ? 'Singles' : 'Both');
  var style = (typeof getGameGenerationMode === 'function') ? getGameGenerationMode() : 'standard';
  var styleText = style === 'balanced' ? 'Balanced' : 'Standard';
  var randomText = orgGetInitialPlayerOrder() === 'keep' ? 'Random OFF' : 'Random ON';
  var winner = document.getElementById('stepModeToggle');
  var winnerText = 'Winner ' + (winner && winner.checked ? 'ON' : 'OFF');
  var text = [formatText, styleText, randomText, winnerText].join(' · ');
  ['roundModeSummary','rollingModeSummary'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  });
  if (window.SCSOfflineRounds && typeof window.SCSOfflineRounds.refreshControls === 'function') window.SCSOfflineRounds.refreshControls();
}

function orgToggleModeDetails(button, event) {
  if (event) event.stopPropagation();
  var panel = button && button.closest('.org-mode-panel');
  if (!panel) return;
  var expanded = !panel.classList.contains('is-expanded');
  document.querySelectorAll('.org-mode-panel-round, .org-mode-panel-rolling').forEach(function(modePanel) {
    modePanel.classList.toggle('is-expanded', expanded);
    var disclosure = modePanel.querySelector('.org-mode-summary');
    if (!disclosure) return;
    disclosure.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    var modeName = modePanel.classList.contains('org-mode-panel-rolling') ? 'Rolling Mode' : (modePanel.classList.contains('org-mode-panel-offline') ? 'Round Mode Offline' : 'Round Mode');
    disclosure.setAttribute('aria-label', (expanded ? 'Hide ' : 'Show ') + modeName + ' settings');
  });
}

function orgRefreshSchedulingControls() {
  var style = (typeof getGameGenerationMode === 'function') ? getGameGenerationMode() : 'standard';
  var standardButton = document.getElementById('sampleGameModeStandard');
  var balancedButton = document.getElementById('sampleGameModeBalanced');
  if (standardButton) standardButton.classList.toggle('is-active', style !== 'balanced');
  if (balancedButton) balancedButton.classList.toggle('is-active', style === 'balanced');
  var rollingStandardButton = document.getElementById('sampleRollingGameModeStandard');
  var rollingBalancedButton = document.getElementById('sampleRollingGameModeBalanced');
  if (rollingStandardButton) rollingStandardButton.classList.toggle('is-active', style !== 'balanced');
  if (rollingBalancedButton) rollingBalancedButton.classList.toggle('is-active', style === 'balanced');
  orgRefreshUniquePairControl();
  orgPaintRoundFormat(orgGetRoundFormat());
  orgRefreshCourtSelectors();
  orgPaintRollingRoundFormat(orgGetRoundFormat());
  orgPaintInitialPlayerOrder(orgGetInitialPlayerOrder());
  var winner = document.getElementById('stepModeToggle');
  ['sampleRoundWinner', 'sampleRollingWinner'].forEach(function(id) {
    var toggle = document.getElementById(id);
    if (toggle && winner) toggle.checked = winner.checked;
  });
  var selectedFormat = orgGetRoundFormat();
  var minimumPlayers = selectedFormat === 'singles' ? 2 : 4;
  var enough = schedulerState.activeplayers.length >= minimumPlayers;
  var roundStart = document.getElementById('sampleStartRound');
  var rollingStart = document.getElementById('sampleStartRolling');
  if (roundStart) {
    var roundHistory = (typeof allRounds !== 'undefined' && Array.isArray(allRounds))
      ? allRounds.filter(function(round) { return !round || !round.isMbm; })
      : [];
    var existingSessionId = (typeof getMySessionId === 'function') ? getMySessionId() : null;
    // A stale/releasing database session must never bypass the player gate
    // after End Session has cleared the local roster.
    var roundSessionLive = enough && !!(existingSessionId || roundHistory.length) &&
      (typeof sessionFinished === 'undefined' || !sessionFinished) &&
      !schedulerState.mbmActive;
    var nextRoundNumber = Math.max(1, roundHistory.length + 1);
    var label = roundStart.querySelector('.org-start-label');
    if (label) label.textContent = roundSessionLive ? ((t('continueToRound') || 'Continue to Round') + ' ' + nextRoundNumber) : (t('startRound') || 'Start Round');
    roundStart.classList.toggle('is-continue', roundSessionLive);
    roundStart.setAttribute('aria-label', roundSessionLive ? ((t('continueToRound') || 'Continue to Round') + ' ' + nextRoundNumber) : (t('startRound') || 'Start Round'));
    roundStart.disabled = roundSessionLive ? false : (!enough || !!schedulerState.mbmActive);
  }
  if (rollingStart) rollingStart.disabled = !enough || (Array.isArray(allRounds) && allRounds.some(function(r) { return !r.isMbm; }));
  orgUpdateModeSummaries();
}

function orgInitSchedulingCarousel() {
  var carousel = document.getElementById('orgModeCarousel');
  if (!carousel || carousel.dataset.swipeReady === '1') return;
  carousel.dataset.swipeReady = '1';
  var startX = 0;
  carousel.addEventListener('touchstart', function(event) { startX = event.changedTouches[0].clientX; }, { passive: true });
  carousel.addEventListener('touchend', function(event) {
    var delta = event.changedTouches[0].clientX - startX;
    if (Math.abs(delta) > 42) orgSetSchedulingSlide(_orgSchedulingSlide + (delta < 0 ? 1 : -1));
  }, { passive: true });
}

function orgStartOnlineRound() {
  if (window.SCSOfflineRounds && typeof window.SCSOfflineRounds.deactivate === 'function') window.SCSOfflineRounds.deactivate();
  stepCourtsDone();
}

function orgStartRollingMode() {
  if (window.SCSOfflineRounds && typeof window.SCSOfflineRounds.deactivate === 'function') window.SCSOfflineRounds.deactivate();
  mbmGo();
}

function stepCourtsDone() {
homeGo('roundsPage', 'tabBtnRounds');
}

/* ── Summary navigation ── */
function homeGoSummary() {
_navSource = 'home';
homeGo('summaryPage', 'tabBtnSummary');
}

function roundsGoSummary() {
_navSource = 'rounds';
homeHideScreen();
showPage('summaryPage', null);
_updateDynamicBackBtns('summaryPage');
}

/* ── Players navigation from Rounds ── */
function roundsGoPlayers() {
_navSource = 'rounds';
window.__scsPlayersReturnSource = 'rounds';
homeHideScreen();
showPage('playersPage', null);
_updateDynamicBackBtns('playersPage');
}

function roundsGoFixedPairs() {
_navSource = 'rounds';
homeHideScreen();
showPage('fixedPairsPage', null);
_updateDynamicBackBtns('fixedPairsPage');
}

/* ── Update dynamic back button labels ── keep ✕ always */
function _updateDynamicBackBtns(pageId) {
  // No-op: buttons always show ✕, navBack() handles routing
}

/* ── Back navigation -- goes to correct origin ── */
function navBack() {
var playersPage = document.getElementById('playersPage');
var playersVisible = !!(playersPage && getComputedStyle(playersPage).display !== 'none');
if (playersVisible && window.__scsPlayersReturnSource) {
  var playerReturn = window.__scsPlayersReturnSource;
  window.__scsPlayersReturnSource = null;
  if (playerReturn === 'rounds') {
    // Round Manager is a primary workspace on homePageOverlay, not the legacy
    // roundsPage game screen. Returning Players to roundsPage left the new
    // workspace hidden and could make the Players sheet appear not to close.
    _navSource = 'rounds';
    if (playersPage) {
      playersPage.style.display = 'none';
      playersPage.classList.remove('scs-assist-child-page');
    }
    document.body.classList.remove('scs-guide-child-open');
    if (typeof appMode !== 'undefined') appMode = 'organiser';
    try {
      sessionStorage.setItem('appMode', 'organiser');
      localStorage.setItem('kbrr_app_mode', 'organiser');
    } catch (_) {}
    if (typeof showHomeScreen === 'function') showHomeScreen();
    if (typeof scsSyncPrimaryBottomNav === 'function') scsSyncPrimaryBottomNav('organiser');
    return;
  }
  if (playerReturn === 'settings') {
    _navSource = 'settings';
    showPage('settingsPage', null);
    return;
  }
  _navSource = 'home';
  showHomeScreen();
  return;
}
if (_navSource === 'rounds') {
  showPage('roundsPage', null);
} else if (_navSource === 'settings') {
  showPage('settingsPage', null);
} else {
  showHomeScreen();
}
}

/* ── Refresh Summary tile -- always active since it fetches from Supabase ── */
function homeRefreshSummaryTile() {
document.querySelectorAll('.home-tile-summary').forEach(function(tile) {
tile.style.opacity       = '1';
tile.style.pointerEvents = '';
});
}

/* Language is now handled in Settings page */
function homeLangToggle() {}
function homeLangSelect() {}

/* ══════════════════════════════════════════════
JOIN CLUB PAGE -- Viewer mode tile & full page
══════════════════════════════════════════════ */

/* Called every time home screen opens -- show/hide tile, refresh status */
async function vclSetActiveClub(clubId, clubName) {
if (typeof setMyClub === 'function') setMyClub(clubId, clubName);
localStorage.setItem('kbrr_club_mode', 'user');
// Sync players from the newly active club
if (typeof syncToLocal === 'function') syncToLocal();
// Refresh join club tile first to re-render active highlight immediately
await homeRefreshJoinClubTile();
// Then refresh full home screen -- updates My Card rating to active club
if (typeof homeRefreshScreen === 'function') await homeRefreshScreen();
// Also update profile button in top bar
if (typeof updateProfileBtn === 'function') updateProfileBtn();
}

/* ── QC dot indicators ── */
function viewerQCAddDots() {
  var configs = [
    { elId: 'myCardQC',  sel: '[onclick*="myCardPage"]' },
    { elId: 'dashQC',    sel: '[onclick*="dashboardPage"]' },
    { elId: 'clubsQC',   sel: '#joinClubTileRow' },
    { elId: 'reportQC',  sel: '[onclick*="vaultReport2Page"]' },
  ];
  configs.forEach(function(d) {
    if (document.getElementById(d.elId)) return;
    var tile = document.querySelector(d.sel);
    if (!tile) return;
    tile.style.position = 'relative';
    var dot = document.createElement('div');
    dot.id = d.elId;
    dot.style.cssText = 'position:absolute;top:8px;right:8px;width:8px;height:8px;border-radius:50%;display:none;z-index:10;';
    tile.appendChild(dot);
  });
}

async function homeRefreshJoinClubTile() {
var sub     = document.getElementById('tileSubJoinClub');
var listEl  = document.getElementById('vcl-list-inner');
if (!sub) return;

var user = (typeof authGetUser === 'function') ? authGetUser() : null;
if (user) {
try {
var memberships = await sbGet('memberships',
'user_account_id=eq.' + user.id + '&select=club_id,nickname');
var pending = await sbGet('club_join_requests',
'user_account_id=eq.' + user.id + '&status=eq.pending&select=club_id').catch(function(){ return []; });
var pendingIds = (pending || []).map(function(p){ return p.club_id; });

  var allIds = [...new Set([
    ...(memberships||[]).map(function(m){ return m.club_id; }),
    ...pendingIds
  ])];

  if (allIds.length) {
    var clubRows = await sbGet('clubs', 'id=in.(' + allIds.join(',') + ')&select=id,name').catch(function(){ return []; });
    var clubMap = {};
    clubRows.forEach(function(c){ clubMap[c.id] = c.name; });

    // Subtitle: all club names joined by ·
    var memCount = (memberships||[]).length;
    var pendCount = pendingIds.filter(function(id){ return !(memberships||[]).find(function(m){ return m.club_id===id; }); }).length;
    if (memCount > 0) {
      sub.textContent = memCount + ' club' + (memCount !== 1 ? 's' : '') + (pendCount > 0 ? ' · ' + pendCount + ' pending' : '');
    } else if (pendCount > 0) {
      sub.textContent = pendCount + ' pending · Tap to view';
    } else {
      sub.textContent = 'Join or view your clubs';
    }

    // Inline list (max 10)
    if (listEl) {
      var activeClubId = (typeof getMyClub === 'function') ? (getMyClub().id || null) : null;
      var items = [];
      (memberships||[]).slice(0,10).forEach(function(m) {
        items.push({ id: m.club_id, name: clubMap[m.club_id]||m.club_id, nick: m.nickname, pending: false });
      });
      pendingIds.filter(function(id){ return !(memberships||[]).find(function(m){ return m.club_id===id; }); })
        .slice(0, 10 - items.length).forEach(function(id) {
          items.push({ id: id, name: clubMap[id]||id, nick: null, pending: true });
        });

      if (listEl) listEl.innerHTML = '';
    }
    return;
  }
} catch(e) { /* offline -- fall through */ }

}

// Fallback
if (listEl) listEl.innerHTML = '';
var pending = localStorage.getItem('kbrr_pending_club_name');
if (pending) { sub.textContent = t('pendingPrefix') + pending; return; }
sub.textContent = t('findRequest');
}

/* ── Join Club Page -- initialise when page opens ── */
async function joinClubPageOpen() {
// Reset search + feedback
var searchInput = document.getElementById('joinClubPageSearch');
if (searchInput) searchInput.value = '';
var results = document.getElementById('joinClubPageResults');
if (results) { results.style.display = 'none'; results.innerHTML = ''; }
var errEl = document.getElementById('joinClubPageError');
if (errEl) errEl.style.display = 'none';
var fbEl = document.getElementById('joinClubPageFeedback');
if (fbEl) fbEl.style.display = 'none';
var nickEl = document.getElementById('joinClubNicknameSection');
if (nickEl) nickEl.style.display = 'none';
var nickEntryEl = document.getElementById('joinClubNicknameEntrySection');
if (nickEntryEl) nickEntryEl.style.display = 'none';
var pwEl = document.getElementById('joinClubPasswordSection');
if (pwEl) pwEl.style.display = 'none';

// Load all my clubs
await _renderMyClubsList();
}

function jcActivateClub(row) {
  var id   = row.getAttribute('data-cid');
  var name = row.getAttribute('data-cname');
  if (!id) return;
  // Update all rows instantly
  document.querySelectorAll('.jc-club-item').forEach(function(r) {
    var rid         = r.getAttribute('data-cid');
    var isNowActive = rid === id;
    var badge       = r.querySelector('.jc-club-badge');
    r.querySelector('.jc-club-icon').textContent = isNowActive ? '✅' : '🏸';
    if (badge) {
      badge.style.background = '';
      badge.style.color = '';
      badge.className = isNowActive ? 'jc-club-badge jc-badge-active' : 'jc-club-badge jc-badge-member';
      badge.textContent = isNowActive ? (t('active')||'Active') : (t('badgeMember')||'Member');
    }
    if (isNowActive) { r.removeAttribute('onclick'); r.style.cursor = ''; }
    else { r.setAttribute('onclick', 'jcActivateClub(this)'); r.style.cursor = 'pointer'; }
  });
  if (typeof vclSetActiveClub === 'function') vclSetActiveClub(id, name);
}

function jcEscapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function jcLeaveClub(button) {
  var row = button && button.closest ? button.closest('.jc-club-item') : null;
  var clubId = row && row.getAttribute('data-cid');
  var clubName = row && row.getAttribute('data-cname');
  var user = (typeof authGetUser === 'function') ? authGetUser() : null;
  if (!clubId || !user || !user.id) return;
  if (!confirm((t('leaveClubConfirm') || 'Leave this club?') + '\n\n' + (clubName || ''))) return;

  var originalText = button.textContent;
  button.disabled = true;
  button.textContent = t('pleaseWait') || 'Please wait...';

  try {
    // A club's player list is its memberships. Removing this row removes the
    // player from this club without deleting their shared player identity or
    // memberships in other clubs.
    var leavingMemberships = await sbGet('memberships',
      'club_id=eq.' + encodeURIComponent(clubId) + '&user_account_id=eq.' + encodeURIComponent(user.id) + '&select=player_id'
    ).catch(function(){ return []; });
    if (leavingMemberships && leavingMemberships[0] && leavingMemberships[0].player_id) {
      await sbPatch('players', 'id=eq.' + encodeURIComponent(leavingMemberships[0].player_id), {
        user_account_id: user.id
      }).catch(function(){});
    }
    await sbDelete('memberships', 'club_id=eq.' + encodeURIComponent(clubId) + '&user_account_id=eq.' + encodeURIComponent(user.id));
    await sbDelete('club_join_requests', 'club_id=eq.' + encodeURIComponent(clubId) + '&user_account_id=eq.' + encodeURIComponent(user.id)).catch(function(){});
    await sbDelete('user_club_roles', 'club_id=eq.' + encodeURIComponent(clubId) + '&user_account_id=eq.' + encodeURIComponent(user.id)).catch(function(){});

    localStorage.removeItem('kbrr_cache_players');
    localStorage.removeItem('kbrr_cache_ts');
    localStorage.removeItem('kbrr_cache_club_id');

    var activeClub = (typeof getMyClub === 'function') ? getMyClub() : null;
    if (activeClub && String(activeClub.id || '') === String(clubId)) {
      var remaining = await sbGet('memberships',
        'user_account_id=eq.' + encodeURIComponent(user.id) + '&select=club_id&limit=1').catch(function(){ return []; });
      if (remaining && remaining.length) {
        var nextId = remaining[0].club_id;
        var nextClubs = await sbGet('clubs', 'id=eq.' + encodeURIComponent(nextId) + '&select=id,name').catch(function(){ return []; });
        var nextName = nextClubs && nextClubs.length ? nextClubs[0].name : nextId;
        if (typeof setMyClub === 'function') setMyClub(nextId, nextName);
      } else if (typeof clearMyClub === 'function') {
        clearMyClub();
        if (typeof updateWelcomeWorkspaceClubNames === 'function') updateWelcomeWorkspaceClubNames();
      }
    }

    // Organiser access is membership-based; refresh it immediately after a
    // player leaves so stale access to the departed club cannot remain cached.
    if (typeof syncOrganiserMembershipAccess === 'function') {
      await syncOrganiserMembershipAccess(user);
    }
    if (typeof updateWelcomeWorkspaceClubNames === 'function') {
      updateWelcomeWorkspaceClubNames();
    }

    await _renderMyClubsList();
    if (typeof homeRefreshJoinClubTile === 'function') await homeRefreshJoinClubTile();
    if (typeof myCardSlotsScheduleRefresh === 'function') myCardSlotsScheduleRefresh(true);
    if (typeof showToast === 'function') showToast((t('leaveClub') || 'Leave') + ': ' + (clubName || 'Club'));
  } catch (e) {
    button.disabled = false;
    button.textContent = originalText;
    alert((e && e.message) || (t('somethingWentWrong') || 'Something went wrong'));
  }
}

async function jcCancelJoinRequest(button) {
  var row = button && button.closest ? button.closest('.jc-club-row') : null;
  var clubId = row && row.getAttribute('data-cid');
  var clubName = row && row.getAttribute('data-cname');
  var user = (typeof authGetUser === 'function') ? authGetUser() : null;
  if (!clubId || !user || !user.id) return;
  if (!confirm((t('cancelJoinRequestConfirm') || 'Cancel your request to join this club?') + '\n\n' + (clubName || ''))) return;

  var originalText = button.textContent;
  button.disabled = true;
  button.textContent = t('pleaseWait') || 'Please wait...';

  try {
    await sbDelete('club_join_requests',
      'club_id=eq.' + encodeURIComponent(clubId) +
      '&user_account_id=eq.' + encodeURIComponent(user.id) +
      '&status=eq.pending'
    );

    if (String(localStorage.getItem('kbrr_pending_club_id') || '') === String(clubId)) {
      localStorage.removeItem('kbrr_pending_club_id');
      localStorage.removeItem('kbrr_pending_club_name');
    }

    await _renderMyClubsList();
    if (typeof homeRefreshJoinClubTile === 'function') await homeRefreshJoinClubTile();
    if (typeof updateWelcomeWorkspaceClubNames === 'function') updateWelcomeWorkspaceClubNames();
    if (typeof _scsGuideOrganiserClubsLoadedAt !== 'undefined') _scsGuideOrganiserClubsLoadedAt = 0;
    if (typeof _scsGuideLoadOrganiserClubs === 'function') {
      _scsGuideLoadOrganiserClubs(true).catch(function(){});
    }
    if (typeof showToast === 'function') showToast(t('joinRequestCancelled') || 'Join request cancelled');
  } catch (e) {
    button.disabled = false;
    button.textContent = originalText;
    alert((e && e.message) || (t('somethingWentWrong') || 'Something went wrong'));
  }
}

async function _renderMyClubsList() {
var inner = document.getElementById('myClubsListInner');
if (!inner) return;
inner.innerHTML = '<div class="jc-empty">Loading...</div>';

var user = (typeof authGetUser === 'function') ? authGetUser() : null;
if (!user) {
inner.innerHTML = '<div class="jc-empty">' + t('loginToSeeClubs') + '</div>';
return;
}

try {
// Get all memberships for this user
var memberships = await sbGet('memberships',
'user_account_id=eq.' + user.id + '&select=club_id,nickname');

// Also check pending requests
var pending = await sbGet('club_join_requests',
  'user_account_id=eq.' + user.id + '&status=eq.pending&select=club_id').catch(function(){ return []; });
var pendingIds = (pending || []).map(function(p){ return p.club_id; });

if ((!memberships || !memberships.length) && !pendingIds.length) {
  inner.innerHTML = '<div class="jc-empty">' + t('noClubsYetSearch') + '</div>';
  return;
}

// Fetch club names
var allIds = [...new Set([
  ...(memberships||[]).map(function(m){ return m.club_id; }),
  ...pendingIds
])];
var clubs = allIds.length
  ? await sbGet('clubs', 'id=in.(' + allIds.join(',') + ')&select=id,name').catch(function(){ return []; })
  : [];
var clubMap = {};
clubs.forEach(function(c){ clubMap[c.id] = c.name; });

var activeClubId2 = (typeof getMyClub === 'function') ? ((getMyClub()||{}).id||null) : null;
var html = '';

// Member clubs — tick on active, tap others to activate
(memberships || []).forEach(function(m) {
  var cname    = clubMap[m.club_id] || m.club_id;
  var isActive = m.club_id === activeClubId2;
  var icon     = isActive ? '✅' : '🏸';
  var badge    = isActive
    ? '<span class="jc-club-badge jc-badge-active">' + (t('active')||'Active') + '</span>'
    : '<span class="jc-club-badge jc-badge-member">' + t('badgeMember') + '</span>';
  html += '<div class="jc-club-row jc-club-item"' +
    (isActive ? '' : ' style="cursor:pointer;" onclick="jcActivateClub(this)"') +
    ' data-cid="' + jcEscapeHtml(m.club_id) + '" data-cname="' + jcEscapeHtml(cname) + '">' +
    '<div class="jc-club-icon">' + icon + '</div>' +
    '<div class="jc-club-info">' +
      '<div class="jc-club-name">' + jcEscapeHtml(cname) + '</div>' +
      '<div class="jc-club-nick">' + jcEscapeHtml(t('asNick')) + ' ' + jcEscapeHtml(m.nickname) + '</div>' +
    '</div>' +
    '<div class="jc-club-actions">' + badge +
      '<button type="button" class="jc-club-leave-btn" onclick="event.stopPropagation();jcLeaveClub(this)">' + jcEscapeHtml(t('leaveClub') || 'Leave') + '</button>' +
    '</div>' +
  '</div>';
});

// Pending clubs
pendingIds.forEach(function(cid) {
  if ((memberships||[]).find(function(m){ return m.club_id === cid; })) return; // already shown
  var cname = clubMap[cid] || cid;
  html += '<div class="jc-club-row jc-club-pending-row" data-cid="' + jcEscapeHtml(cid) + '" data-cname="' + jcEscapeHtml(cname) + '">' +
    '<div class="jc-club-icon">⏳</div>' +
    '<div class="jc-club-info">' +
      '<div class="jc-club-name">' + jcEscapeHtml(cname) + '</div>' +
      '<div class="jc-club-nick">' + jcEscapeHtml(t('requestPendingText')) + '</div>' +
    '</div>' +
    '<div class="jc-club-actions">' +
      '<span class="jc-club-pending">' + jcEscapeHtml(t('badgePending')) + '</span>' +
      '<button type="button" class="jc-club-cancel-request-btn" onclick="event.stopPropagation();jcCancelJoinRequest(this)">' + jcEscapeHtml(t('cancel') || 'Cancel') + '</button>' +
    '</div>' +
  '</div>';
});

inner.innerHTML = html || '<div class="jc-empty">' + t('noClubsYet') + '</div>';

} catch(e) {
inner.innerHTML = '<div class="jc-empty">' + t('couldNotLoadClubs') + '</div>';
}
}

function _joinClubShowStatus(state, clubName) {
var icon  = document.getElementById('joinClubStatusIcon');
var title = document.getElementById('joinClubStatusTitle');
var msg   = document.getElementById('joinClubStatusMsg');
var leave = document.getElementById('joinClubLeaveBtn');
var card  = document.getElementById('joinClubStatusCard');

if (state === 'joined') {
if (icon)  icon.textContent  = '✅';
if (title) title.textContent = t('joined') + ': ' + clubName;
if (msg)   msg.textContent   = t('memberMsg') || 'You are a member of this club.';
if (leave) leave.style.display = '';
if (card)  card.style.borderColor = '#2dce89';
} else if (state === 'pending') {
if (icon)  icon.textContent  = '⏳';
if (title) title.textContent = t('requestPending');
if (msg)   msg.textContent   = t('yourRequestToJoin') + ' "' + clubName + '" ' + t('awaitingApproval');
if (leave) leave.style.display = '';
if (card)  card.style.borderColor = '#e6a817';
}
}

/* ── Search clubs as user types ── */
var _joinClubSearchTimer = null;
async function joinClubQuickSearch(clubName) {
  var input = document.getElementById('joinClubPageSearch');
  if (input) input.value = clubName;
  clearTimeout(_joinClubSearchTimer);

  var resultsEl = document.getElementById('joinClubPageResults');
  var errEl = document.getElementById('joinClubPageError');
  if (errEl) errEl.style.display = 'none';
  if (resultsEl) {
    resultsEl.style.display = '';
    resultsEl.innerHTML = '<div style="padding:12px;text-align:center;color:var(--muted);font-size:0.85rem;">' + t('searching') + '</div>';
  }

  var result = (typeof authSearchClubs === 'function') ? await authSearchClubs(clubName) : { clubs: [] };
  if (result.error) {
    if (resultsEl) resultsEl.style.display = 'none';
    if (errEl) { errEl.textContent = result.error; errEl.style.display = ''; }
    return;
  }

  var clubs = result.clubs || [];
  var wanted = String(clubName || '').trim().toLocaleLowerCase();
  var exact = clubs.find(function(c) {
    return String(c.name || '').trim().toLocaleLowerCase() === wanted;
  });

  // Quick club buttons already identify the club, so skip the intermediate
  // "Request to Join" search result and go straight to player selection.
  if (exact) {
    if (resultsEl) { resultsEl.style.display = 'none'; resultsEl.innerHTML = ''; }
    joinClubShowNicknameEntry(exact.id, exact.name);
    return;
  }

  // If the configured quick club name is unavailable, keep the normal search
  // result behaviour so the user can still see what was returned.
  _joinClubDoSearch(clubName);
}

function joinClubPageSearchUI(query) {
clearTimeout(_joinClubSearchTimer);
var errEl = document.getElementById('joinClubPageError');
if (errEl) errEl.style.display = 'none';
var fbEl = document.getElementById('joinClubPageFeedback');
if (fbEl) fbEl.style.display = 'none';

if (!query || (query.trim().length < 2 && query.trim() !== '*')) {
var r = document.getElementById('joinClubPageResults');
if (r) { r.style.display = 'none'; r.innerHTML = ''; }
return;
}
_joinClubSearchTimer = setTimeout(function() { _joinClubDoSearch(query); }, 350);
}

async function _joinClubDoSearch(query) {
var resultsEl = document.getElementById('joinClubPageResults');
var errEl     = document.getElementById('joinClubPageError');
if (!resultsEl) return;

resultsEl.innerHTML = '<div style="padding:12px;text-align:center;color:var(--muted);font-size:0.85rem;">' + t('searching') + '</div>';
resultsEl.style.display = '';

var result = (typeof authSearchClubs === 'function') ? await authSearchClubs(query) : { clubs: [] };

if (result.error) {
resultsEl.style.display = 'none';
if (errEl) { errEl.textContent = result.error; errEl.style.display = ''; }
return;
}

var clubs = result.clubs || [];
if (!clubs.length) {
resultsEl.innerHTML = '<div style="padding:14px;text-align:center;color:var(--muted);font-size:0.85rem;">' + t('noClubsFoundFor') + ' "' + query + '"</div>';
return;
}

resultsEl.innerHTML = clubs.map(function(c) {
return '<div onclick="joinClubShowNicknameEntry(\'' + c.id + '\',\'' + c.name.replace(/\'/g, "\\'") + '\')" class="jc-club-row" style="cursor:pointer;justify-content:space-between;">' +
'<div><div class="jc-club-name">' + c.name + '</div></div>' +
'<span style="color:var(--accent,#6c63ff);font-size:0.82rem;font-weight:600;">' + t('requestToJoin') + '</span>' +
'</div>';
}).join('');
}

/* ── Stores clubId/Name while user picks a new nickname ── */
var _pendingJoinClubId       = null;
var _pendingJoinClubName     = null;
var _pendingJoinNickname     = null;
var _joinClubChoiceLoadId    = 0;

function joinClubChooseNickname(nickname) {
  var input = document.getElementById('joinClubNicknameEntryInput');
  if (input) input.value = String(nickname || '');
  joinClubSubmitNicknameEntry();
}

function _joinClubAddNicknamePill(container, nickname, isCurrent) {
  if (!container || !nickname) return;
  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'jc-nickname-pill' + (isCurrent ? ' is-current' : ' is-unregistered');
  button.textContent = (isCurrent ? '👤 ' : '🔐 ') + nickname;
  button.setAttribute('aria-label', nickname);
  button.addEventListener('click', function() { joinClubChooseNickname(nickname); });
  container.appendChild(button);
}

function _joinClubNicknameKey(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, '');
}

function _joinClubNicknameSimilarity(profileNickname, clubNickname) {
  var a = _joinClubNicknameKey(profileNickname);
  var b = _joinClubNicknameKey(clubNickname);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return Math.min(a.length, b.length) / Math.max(a.length, b.length) + .18;

  var previous = Array.from({ length: b.length + 1 }, function(_, i){ return i; });
  for (var i = 1; i <= a.length; i++) {
    var current = [i];
    for (var j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return 1 - (previous[b.length] / Math.max(a.length, b.length));
}

function _joinClubRenderNicknameMatches(container, names, profileNickname) {
  if (!container) return;
  var ranked = names.map(function(name, index) {
    return { name: name, index: index, score: _joinClubNicknameSimilarity(profileNickname, name) };
  }).sort(function(a, b) { return b.score - a.score || a.index - b.index; });
  var suggested = ranked.slice(0, 4);

  var title = document.createElement('div');
  title.className = 'jc-nickname-group-title';
  title.textContent = _homeT('suggestedClubNicknames', 'Suggested club nicknames');
  container.appendChild(title);
  suggested.forEach(function(item){ _joinClubAddNicknamePill(container, item.name, false); });

  if (ranked.length > suggested.length) {
    var reveal = document.createElement('button');
    reveal.type = 'button';
    reveal.className = 'jc-nickname-show-all';
    reveal.textContent = _homeT('showAllClubPlayers', 'Show all {count} players', { count: ranked.length });
    reveal.addEventListener('click', function() {
      reveal.remove();
      ranked.slice(suggested.length).forEach(function(item){ _joinClubAddNicknamePill(container, item.name, false); });
    });
    container.appendChild(reveal);
  }
}

/* ── Step 1: Show nickname entry after tapping Request to Join ── */
async function joinClubShowNicknameEntry(clubId, clubName) {
  if (typeof isDemoMode === 'function' && isDemoMode()) {
    alert('🎮 ' + _homeT('demoJoinUnavailable', 'Joining clubs is not available in demo mode.\n\nSign up free to join and manage your own clubs!'));
    return;
  }
  _pendingJoinClubId   = clubId;
  _pendingJoinClubName = clubName;

  // Hide results, show nickname entry
  var resultsEl = document.getElementById('joinClubPageResults');
  if (resultsEl) resultsEl.style.display = 'none';

  // Reset all other sections
  ['joinClubPasswordSection','joinClubNicknameSection','joinClubNicknameEntrySection','joinClubPageFeedback','joinClubPageError'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  var section = document.getElementById('joinClubNicknameEntrySection');
  var msg     = document.getElementById('joinClubNicknameEntryMsg');
  var input   = document.getElementById('joinClubNicknameEntryInput');
  var choices = document.getElementById('joinClubNicknameChoices');

  // Pre-fill with user's account nickname as default
  var _defaultNick = '';
  var _u = (typeof authGetUser === 'function') ? authGetUser() : null;
  if (_u && _u.nickname) _defaultNick = _u.nickname;
  if (!_defaultNick) { var _p = (typeof getMyPlayer === 'function') ? getMyPlayer() : null; if (_p && _p.name) _defaultNick = _p.name; }

  if (msg) { msg.textContent = _homeT('choosePlayerForClub', 'Choose your player in "{club}":', { club: clubName }); msg.style.color = ''; }
  if (input) input.value = _defaultNick;
  if (choices) {
    choices.innerHTML = '';
    var loading = document.createElement('div');
    loading.className = 'jc-nickname-loading';
    loading.textContent = _homeT('loadingUnregisteredPlayers', 'Loading unregistered players...');
    choices.appendChild(loading);
  }
  if (section) section.style.display = '';

  var loadId = ++_joinClubChoiceLoadId;
  try {
    var unregistered = await sbGet('memberships',
      'club_id=eq.' + encodeURIComponent(clubId) + '&user_account_id=is.null&select=nickname&order=nickname.asc'
    ).catch(function(){ return []; });
    if (loadId !== _joinClubChoiceLoadId || _pendingJoinClubId !== clubId || !choices) return;

    var loadingEl = choices.querySelector('.jc-nickname-loading');
    if (loadingEl) loadingEl.remove();
    var seen = new Set();
    var names = (unregistered || []).map(function(row){ return String(row.nickname || '').trim(); }).filter(function(name) {
      if (!name) return false;
      var key = name.toLocaleLowerCase();
      if (seen.has(key) || (_defaultNick && key === _defaultNick.toLocaleLowerCase())) return false;
      seen.add(key);
      return true;
    });
    if (names.length) {
      _joinClubRenderNicknameMatches(choices, names, _defaultNick);
    } else {
      var empty = document.createElement('div');
      empty.className = 'jc-nickname-empty';
      empty.textContent = _homeT('noUnregisteredPlayers', 'No unregistered players available.');
      choices.appendChild(empty);
    }
  } catch (e) {
    var pendingLoading = choices && choices.querySelector('.jc-nickname-loading');
    if (pendingLoading) pendingLoading.remove();
  }
}

/* ── Step 2: User submitted nickname — proceed with join request ── */
function joinClubSubmitNicknameEntry() {
  var input   = document.getElementById('joinClubNicknameEntryInput');
  var errEl   = document.getElementById('joinClubPageError');
  var section = document.getElementById('joinClubNicknameEntrySection');
  var nickname = input ? input.value.trim() : '';

  if (!nickname) {
    // Show error inside entry section, not the global error element
    var entryMsg = document.getElementById('joinClubNicknameEntryMsg');
    if (entryMsg) { entryMsg.textContent = _homeT('enterYourNickname', 'Please enter your nickname.'); entryMsg.style.color = '#e63757'; }
    if (input) input.focus();
    return;
  }

  if (section) section.style.display = 'none';
  joinClubPageRequest(_pendingJoinClubId, _pendingJoinClubName, nickname);
}

async function joinClubPageRequest(clubId, clubName, customNickname) {
if (typeof isDemoMode === 'function' && isDemoMode()) {
  alert('🎮 ' + _homeT('demoJoinUnavailable', 'Joining clubs is not available in demo mode.\n\nSign up free to join and manage your own clubs!'));
  return;
}
var fbEl      = document.getElementById('joinClubPageFeedback');
var fbIcon    = document.getElementById('joinClubPageFeedbackIcon');
var fbTitle   = document.getElementById('joinClubPageFeedbackTitle');
var fbMsg     = document.getElementById('joinClubPageFeedbackMsg');
var resultsEl = document.getElementById('joinClubPageResults');
var errEl     = document.getElementById('joinClubPageError');
var nickEl    = document.getElementById('joinClubNicknameSection');

if (errEl) errEl.style.display = 'none';
if (nickEl) nickEl.style.display = 'none';
var nickEntrySectionReset = document.getElementById('joinClubNicknameEntrySection');
if (nickEntrySectionReset) nickEntrySectionReset.style.display = 'none';
var pwSectionReset = document.getElementById('joinClubPasswordSection');
if (pwSectionReset) pwSectionReset.style.display = 'none';

// Show loading
if (fbEl) {
if (fbIcon)  fbIcon.textContent  = '⏳';
if (fbTitle) fbTitle.textContent = t('checking');
if (fbMsg)   fbMsg.textContent   = '';
fbEl.style.display = '';
}
if (resultsEl) resultsEl.style.display = 'none';

var result = (typeof authRequestJoin === 'function')
? await authRequestJoin(clubId, customNickname)
: { error: t('notAvailable') };

if (result.alreadyMember) {
_joinClubShowStatus('joined', clubName);
document.getElementById('joinClubStatusCard').style.display = '';
document.getElementById('joinClubSearchSection').style.display = 'none';
if (fbEl) fbEl.style.display = 'none';
homeRefreshJoinClubTile();
if (typeof scsGuideJoinClubCompleted === 'function' && scsGuideJoinClubCompleted()) return;
return;
}

if (result.autoLinked) {
if (typeof setMyClub === 'function') setMyClub(result.clubId, result.clubName);
if (typeof setMyPlayer === 'function') setMyPlayer({ name: result.nickname, gender: 'Male' });
if (fbEl) {
if (fbIcon)  fbIcon.textContent  = '✅';
if (fbTitle) fbTitle.textContent = t('joined') + ' ' + result.clubName;
if (fbMsg)   fbMsg.textContent   = t('welcomeBack') + ', ' + result.nickname + '!';
fbEl.style.display = '';
}
homeRefreshJoinClubTile();
_renderMyClubsList();
if (typeof scsGuideJoinClubCompleted === 'function' && scsGuideJoinClubCompleted()) return;
return;
}

if (result.needsPassword) {
// Unclaimed player found -- ask for default password to verify identity
if (fbEl) fbEl.style.display = 'none';
_pendingJoinClubId   = clubId;
_pendingJoinClubName = clubName;
_pendingJoinNickname = result.conflictNickname;
var pwSection = document.getElementById('joinClubPasswordSection');
var pwMsg     = document.getElementById('joinClubPasswordMsg');
var pwInput   = document.getElementById('joinClubPasswordInput');
if (nickEl) nickEl.style.display = 'none';
if (pwMsg) pwMsg.textContent = '"' + result.conflictNickname + '" ' + (t('foundInClub') || 'found in') + ' ' + clubName + '. ' + (t('enterDefaultPwClaim') || 'Enter your default password to join:');
if (pwInput) pwInput.value = '';
if (pwSection) pwSection.style.display = '';
return;
}

if (result.nicknameConflict) {
// Nickname truly taken by someone else -- ask for different nickname
if (fbEl) fbEl.style.display = 'none';
_pendingJoinClubId   = clubId;
_pendingJoinClubName = clubName;
var pwSection2 = document.getElementById('joinClubPasswordSection');
if (pwSection2) pwSection2.style.display = 'none';
if (nickEl) {
var msgEl  = document.getElementById('joinClubNicknameMsg');
var inputEl = document.getElementById('joinClubNicknameInput');
if (msgEl)  msgEl.textContent = '"' + result.conflictNickname + '" ' + t('alreadyTaken') + ' ' + clubName + '. ' + t('chooseDifferentNickname') + ':';
if (inputEl) inputEl.value = '';
nickEl.style.display = '';
}
return;
}

if (result.pending || result.success) {
localStorage.setItem('kbrr_pending_club_id',   clubId);
localStorage.setItem('kbrr_pending_club_name', clubName);
if (fbIcon)  fbIcon.textContent  = '⏳';
if (fbTitle) fbTitle.textContent = t('requestSentTitle');
if (fbMsg)   fbMsg.textContent   = t('waitingAdminApproval');
homeRefreshJoinClubTile();
if (typeof scsGuideReturnFromJoinClub === 'function') {
  try { if (sessionStorage.getItem('scs_join_club_from_assist') === '1') { setTimeout(scsGuideReturnFromJoinClub, 650); return; } } catch(e) {}
}
return;
}

if (result.error) {
if (fbEl) fbEl.style.display = 'none';
if (resultsEl) resultsEl.style.display = '';
if (errEl) { errEl.textContent = result.error; errEl.style.display = ''; }
}
}

/* ── Called when user submits their chosen nickname ── */
function joinClubSubmitNickname() {
var inputEl = document.getElementById('joinClubNicknameInput');
var nickname = inputEl ? inputEl.value.trim() : '';
if (!nickname) {
var errEl = document.getElementById('joinClubPageError');
if (errEl) { errEl.textContent = t('nicknameNotFound') || 'Please enter a nickname.'; errEl.style.display = ''; }
return;
}
joinClubPageRequest(_pendingJoinClubId, _pendingJoinClubName, nickname);
}

/* ── Called when user submits default password to claim their player ── */
async function joinClubSubmitPassword() {
var pwInput = document.getElementById('joinClubPasswordInput');
var errEl   = document.getElementById('joinClubPageError');
var password = pwInput ? pwInput.value.trim() : '';

if (!password) {
if (errEl) { errEl.textContent = t('enterPasswordHint'); errEl.style.display = ''; }
return;
}

var fbEl    = document.getElementById('joinClubPageFeedback');
var fbIcon  = document.getElementById('joinClubPageFeedbackIcon');
var fbTitle = document.getElementById('joinClubPageFeedbackTitle');
var fbMsg   = document.getElementById('joinClubPageFeedbackMsg');
var pwSection = document.getElementById('joinClubPasswordSection');

if (fbIcon)  fbIcon.textContent  = '⏳';
if (fbTitle) fbTitle.textContent = t('checking');
if (fbMsg)   fbMsg.textContent   = '';
if (fbEl)    fbEl.style.display  = '';
if (pwSection) pwSection.style.display = 'none';

var result = (typeof authClaimAndJoin === 'function')
? await authClaimAndJoin(_pendingJoinClubId, _pendingJoinNickname, password)
: { error: t('notAvailable') };

if (result.success) {
if (typeof setMyClub === 'function') setMyClub(result.clubId, result.clubName);
if (typeof setMyPlayer === 'function') setMyPlayer({ name: result.nickname, gender: 'Male' });
if (fbIcon)  fbIcon.textContent  = '✅';
if (fbTitle) fbTitle.textContent = t('joined') + ' ' + result.clubName;
if (fbMsg)   fbMsg.textContent   = t('welcomeBack') + ', ' + result.nickname + '!';
homeRefreshJoinClubTile();
_renderMyClubsList();
if (typeof scsGuideJoinClubCompleted === 'function' && scsGuideJoinClubCompleted()) return;
return;
}

// Error -- show password section again
if (pwSection) pwSection.style.display = '';
if (fbEl) fbEl.style.display = 'none';
if (errEl) { errEl.textContent = result.error; errEl.style.display = ''; }
}

/* ── Leave club ── */
async function joinClubLeave() {
if (!confirm(t('leaveClubConfirm'))) return;

var pendingClubId = localStorage.getItem('kbrr_pending_club_id');
var myClub = (typeof getMyClub === 'function') ? getMyClub() : null;
var clubId = (myClub && myClub.id) || pendingClubId;
var user   = (typeof authGetUser === 'function') ? authGetUser() : null;

// Delete from DB: player row and join request
if (clubId && user) {
try {
// Delete player row for this user in this club
await sbDelete('memberships', 'club_id=eq.' + clubId + '&user_account_id=eq.' + user.id);
await sbDelete('user_club_roles', 'club_id=eq.' + clubId + '&user_account_id=eq.' + user.id);
} catch(e) { /* silent */ }
try {
// Delete join request so it doesn't restore on next login
await sbDelete('club_join_requests', 'club_id=eq.' + clubId + '&user_account_id=eq.' + user.id);
} catch(e) { /* silent */ }
}

// Clear localStorage
localStorage.removeItem('kbrr_pending_club_id');
localStorage.removeItem('kbrr_pending_club_name');
localStorage.removeItem('kbrr_cache_players');
localStorage.removeItem('kbrr_cache_ts');
if (typeof clearMyClub === 'function') clearMyClub();
else {
localStorage.removeItem('kbrr_my_club_id');
localStorage.removeItem('kbrr_my_club_name');
}

// Reset page view
document.getElementById('joinClubStatusCard').style.display = 'none';
document.getElementById('joinClubSearchSection').style.display = '';
homeRefreshJoinClubTile();
}

/* ── Load live stats into vault gradient tiles ── */
async function homeRefreshVaultTiles(clubId) {
try {
// Playing count
var playing = await sbGet('memberships', 'club_id=eq.' + clubId + '&is_playing=eq.true&select=id').catch(() => []);
var playingCount = (playing || []).length;
var vtBadgePlaying = document.getElementById('vtBadgePlaying');
if (vtBadgePlaying) vtBadgePlaying.style.display = playingCount > 0 ? '' : 'none';
var tileSubPlaying = document.getElementById('tileSubPlaying');
if (tileSubPlaying) tileSubPlaying.textContent = playingCount + ' ' + t('playersActive');

// Total players (register + modify share same count)
var members = await sbGet('memberships', 'club_id=eq.' + clubId + '&select=id').catch(() => []);
var memberCount = (members || []).length;
var vtRegister = document.getElementById('vtStatRegister');
if (vtRegister) vtRegister.textContent = memberCount;
var vtModify = document.getElementById('vtStatModify');
if (vtModify) vtModify.textContent = memberCount;

// Pending requests
var requests = await sbGet('club_join_requests', 'club_id=eq.' + clubId + '&status=eq.pending&select=id').catch(() => []);
var reqCount = (requests || []).length;
var vtRequests = document.getElementById('vtStatRequests');
if (vtRequests) vtRequests.textContent = reqCount;
var vtBadgeReq = document.getElementById('vtBadgeRequests');
if (vtBadgeReq) vtBadgeReq.style.display = reqCount > 0 ? '' : 'none';
// Also update organiser home request tile
var orgReqSub   = document.getElementById('tileSubRequestsOrg');
var orgReqBadge = document.getElementById('vtBadgeRequestsOrg');
if (orgReqSub)   orgReqSub.textContent        = reqCount > 0 ? reqCount + ' pending' : 'Join requests';
if (orgReqBadge) orgReqBadge.style.display     = reqCount > 0 ? '' : 'none';
_setOrganiserNavCount('orgNavApprovalCount', reqCount);

} catch(e) { /* silent */ }
}

/* ── Quick Create Club from Vault home (first time user) ── */
async function vaultQuickCreateClub() {
var name    = (document.getElementById('vaultQuickClubName')?.value || '').trim();
var adminPw  = (document.getElementById('vaultQuickAdminPw')?.value || '').trim();
var fb = document.getElementById('vaultQuickFeedback');
var setFb = function(msg, ok) {
if (fb) { fb.textContent = msg; fb.style.color = ok ? 'var(-green,#2dce89)' : 'var(-red,#e63757)'; }
};

if (!name)    { setFb(t('enterClubName'), false); return; }
if (!adminPw)  { setFb(t('enterAdminPw'), false); return; }

setFb(t('creatingClub'), true);
try {
var club = await dbAddClub(name, null, adminPw);
if (typeof setMyClub  === 'function') setMyClub(club.id, club.name);
localStorage.setItem('kbrr_vault_club_id', club.id);
localStorage.setItem('kbrr_vault_club_name', club.name || '');
localStorage.setItem('kbrr_club_mode', 'admin');
if (typeof saveUserClubRole === 'function') await saveUserClubRole(club.id, 'vault');
setFb('✅ ' + club.name + ' created!', true);
// Clear fields
document.getElementById('vaultQuickClubName').value  = '';
document.getElementById('vaultQuickAdminPw').value   = '';
// Refresh home to show vault tiles
// Set vault mode so pill shows correctly
if (typeof appMode !== 'undefined') appMode = 'vault';
sessionStorage.setItem('appMode', 'vault');
localStorage.setItem('kbrr_app_mode', 'vault');
if (typeof updateModePill === 'function') updateModePill('vault');
setTimeout(function() { homeRefreshTiles(); showHomeScreen(); }, 600);
} catch(e) {
setFb('❌ ' + e.message, false);
}
}

/* ── Vault -- Leave/Logout Club ── */
function vaultLogoutClub() {
if (!confirm(t('leaveVaultConfirm'))) return;
var vaultId = localStorage.getItem('kbrr_vault_club_id') || '';
if (vaultId && typeof revokeUserClubRole === 'function') {
  revokeUserClubRole(vaultId, 'vault').catch(function(e) {
    console.warn('Could not revoke Vault auto-login:', e.message || e);
  });
}
// Clear only vault-specific state
localStorage.removeItem('kbrr_vault_club_id');
localStorage.removeItem('kbrr_vault_club_name');
localStorage.removeItem('kbrr_club_mode');
localStorage.removeItem('kbrr_club_trusted');
sessionStorage.removeItem('scs_vault_verified');
localStorage.removeItem('scs_vault_verified');
// Clear the shared active club after leaving this workspace.
if (typeof clearMyClub === 'function') clearMyClub();
// Clear cached Welcome Slot Manager data immediately so old slot / approval
// badges cannot remain visible after the club workspace has been logged out.
if (window.__scsWelcomeHubData) window.__scsWelcomeHubData.vault = {};
var simpleSlotStatus = document.getElementById('simpleSlotStatus');
var simpleSlotNext = document.getElementById('simpleSlotNext');
var simpleSlotPending = document.getElementById('simpleSlotPending');
if (simpleSlotNext) { simpleSlotNext.hidden = true; simpleSlotNext.textContent = ''; simpleSlotNext.dataset.slotId = ''; }
if (simpleSlotPending) { simpleSlotPending.hidden = true; simpleSlotPending.textContent = ''; simpleSlotPending.dataset.slotId = ''; }
if (simpleSlotStatus) simpleSlotStatus.hidden = true;
if (typeof vaultSyncStatus === 'function') vaultSyncStatus();
// Go to mode selector front page
var overlay = document.getElementById('modeSelectOverlay');
if (overlay) {
if (typeof mlSyncLangDisplay === 'function') mlSyncLangDisplay();
overlay.style.display = 'flex';
}
}

function organiserLogoutClub() {
if (typeof isDemoMode === 'function' && isDemoMode()) {
  alert('🎮 You cannot leave the organiser in demo mode.\n\nSign up free to manage your own clubs!');
  return;
}
if (!confirm(t('leaveOrganiserConfirm'))) return;
var organiserId = localStorage.getItem('kbrr_org_club_id') || '';
if (organiserId && typeof revokeUserClubRole === 'function') {
  revokeUserClubRole(organiserId, 'organiser').catch(function(e) {
    console.warn('Could not revoke Organiser auto-login:', e.message || e);
  });
}
// Clear only organiser-specific state
localStorage.removeItem('kbrr_org_club_id');
localStorage.removeItem('kbrr_org_club_name');
sessionStorage.removeItem('scs_organiser_verified');
localStorage.removeItem('scs_organiser_verified');
// Go to mode selector front page
var overlay = document.getElementById('modeSelectOverlay');
if (overlay) {
if (typeof mlSyncLangDisplay === 'function') mlSyncLangDisplay();
overlay.style.display = 'flex';
}
}

/* ── Club Management -- show panel by tile tap ── */
function clubMgmtShowPanel(panel) {
['connect','create','delete'].forEach(function(p) {
var el = document.getElementById('clubMgmt' + p.charAt(0).toUpperCase() + p.slice(1) + 'Panel');
if (el) el.style.display = p === panel ? '' : 'none';
});
// Load clubs for connect panel
if (panel === 'connect' && typeof viewerLoadClubs === 'function') viewerLoadClubs();
// Load clubs for delete panel
if (panel === 'delete' && typeof sbPopulateDeleteDropdown === 'function') sbPopulateDeleteDropdown();
}

/* ══════════════════════════════════════════════════════════
   VIEWER NO-CLUB OVERLAY — vncb* functions
   Full-screen join flow shown to first-time viewer with no club
   Reuses same backend logic as joinClubPage but independent IDs
   ══════════════════════════════════════════════════════════ */

var _vncbPendingClubId   = null;
var _vncbPendingClubName = null;
var _vncbPendingNickname = null;
var _vncbSearchTimer     = null;

function vncbSearchUI(query) {
  var resultsEl = document.getElementById('vncbResults');
  var errorEl   = document.getElementById('vncbError');
  if (errorEl)   errorEl.style.display = 'none';
  // Reset steps
  ['vncbNicknameSection','vncbPasswordSection','vncbNicknameAltSection','vncbFeedback'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  _vncbPendingClubId = null; _vncbPendingClubName = null;

  if (!query || query.trim().length < 1) {
    if (resultsEl) resultsEl.style.display = 'none';
    return;
  }
  clearTimeout(_vncbSearchTimer);
  _vncbSearchTimer = setTimeout(function() { _vncbDoSearch(query.trim()); }, 350);
}

async function _vncbDoSearch(query) {
  var resultsEl = document.getElementById('vncbResults');
  var errorEl   = document.getElementById('vncbError');
  if (!resultsEl) return;
  resultsEl.innerHTML = '<div style="padding:12px 14px;font-size:0.82rem;color:var(--muted);">' + _homeT('searching', 'Searching...') + '</div>';
  resultsEl.style.display = '';
  try {
    var clubs = await sbGet('clubs', 'select=id,name&order=name.asc');
    var q = query.toLowerCase();
    var matched = (clubs || []).filter(function(c) { return c.name && c.name.toLowerCase().includes(q); });
    if (!matched.length) {
      resultsEl.innerHTML = '<div style="padding:12px 14px;font-size:0.82rem;color:var(--muted);">' + _homeT('noClubsFoundFor', 'No clubs found for "{query}"', { query: query }) + '</div>';
      return;
    }
    resultsEl.innerHTML = matched.map(function(c) {
      return '<div onclick="vncbSelectClub(\'' + c.id + '\',\'' + c.name.replace(/'/g,"&#39;") + '\')" ' +
        'style="padding:12px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border);transition:background 0.12s;" ' +
        'onmousedown="this.style.background=\'var(--surface3)\'" onmouseup="this.style.background=\'\'">' +
        '<span style="font-size:1.1rem;">🏸</span>' +
        '<span style="font-size:0.88rem;font-weight:600;color:var(--text);">' + c.name + '</span>' +
        '<span style="margin-left:auto;font-size:0.75rem;color:var(--accent);">' + _homeT('join', 'Join') + ' →</span>' +
        '</div>';
    }).join('');
  } catch(e) {
    if (errorEl) { errorEl.textContent = _homeT('couldNotLoadClubsMessage', 'Could not load clubs: {message}', { message: e.message }); errorEl.style.display = ''; }
    if (resultsEl) resultsEl.style.display = 'none';
  }
}

function vncbSelectClub(clubId, clubName) {
  _vncbPendingClubId   = clubId;
  _vncbPendingClubName = clubName;
  var resultsEl = document.getElementById('vncbResults');
  if (resultsEl) resultsEl.style.display = 'none';
  var searchEl = document.getElementById('vncbSearch');
  if (searchEl) searchEl.value = clubName;
  // Show nickname entry
  var ns = document.getElementById('vncbNicknameSection');
  var nm = document.getElementById('vncbNicknameMsg');
  if (nm) nm.textContent = _homeT('nicknameInClubPrompt', 'What is your nickname in "{club}"? (as added by your organiser)', { club: clubName });
  if (ns) ns.style.display = '';
  var ni = document.getElementById('vncbNicknameInput');
  if (ni) { ni.value = ''; setTimeout(function() { ni.focus(); }, 100); }
}

function vncbSubmitNickname() {
  var ni = document.getElementById('vncbNicknameInput');
  var nickname = ni ? ni.value.trim() : '';
  if (!nickname) { var el = document.getElementById('vncbNicknameInput'); if (el) el.focus(); return; }
  _vncbPendingNickname = nickname;
  _vncbRequest(_vncbPendingClubId, _vncbPendingClubName, nickname);
}

function vncbSubmitNicknameAlt() {
  var ni = document.getElementById('vncbNicknameAltInput');
  var nickname = ni ? ni.value.trim() : '';
  if (!nickname) return;
  _vncbPendingNickname = nickname;
  _vncbRequest(_vncbPendingClubId, _vncbPendingClubName, nickname);
}

async function vncbSubmitPassword() {
  var pi = document.getElementById('vncbPasswordInput');
  var password = pi ? pi.value.trim() : '';
  if (!password) { if (pi) pi.focus(); return; }
  try {
    var result = (typeof authClaimAndJoin === 'function')
      ? await authClaimAndJoin(_vncbPendingClubId, _vncbPendingNickname, password)
      : await joinClubPageRequest(_vncbPendingClubId, _vncbPendingClubName, _vncbPendingNickname);
    _vncbShowFeedback('✅', _homeT('joined', 'Joined!'), _homeT('joinedClubAs', 'You have joined "{club}" as {nickname}', { club: _vncbPendingClubName, nickname: _vncbPendingNickname }));
    setTimeout(function() { _vncbOnJoined(); }, 1500);
  } catch(e) {
    var errorEl = document.getElementById('vncbError');
    if (errorEl) { errorEl.textContent = '❌ ' + e.message; errorEl.style.display = ''; }
  }
}

async function _vncbRequest(clubId, clubName, nickname) {
  _vncbShowFeedback('⏳', _homeT('sendingRequest', 'Sending request...'), _homeT('pleaseWait', 'Please wait'));
  try {
    if (typeof authRequestJoin !== 'function') {
      _vncbShowFeedback('✅', _homeT('joined', 'Joined!'), _homeT('joinedClubAs', 'You have joined "{club}" as {nickname}', { club: clubName, nickname: nickname }));
      setTimeout(function() { _vncbOnJoined(); }, 1500);
      return;
    }
    var result = await authRequestJoin(clubId, nickname);

    if (result.alreadyMember) {
      // Already approved — go straight to home
      _vncbShowFeedback('✅', _homeT('welcomeBack', 'Welcome back!'), _homeT('alreadyMemberOfClub', 'You are already a member of "{club}".', { club: clubName }));
      setTimeout(function() { _vncbOnJoined(); }, 800);
      return;
    }
    if (result.needsPassword) {
      // Unclaimed player — show password step
      var fb = document.getElementById('vncbFeedback');
      if (fb) fb.style.display = 'none';
      _vncbPendingNickname = result.conflictNickname || nickname;
      var pm = document.getElementById('vncbPasswordMsg');
      var ps = document.getElementById('vncbPasswordSection');
      if (pm) pm.textContent = _homeT('playerExistsClaim', 'A player named "{nickname}" exists in this club. Enter the default password to claim this account.', { nickname: _vncbPendingNickname });
      if (ps) ps.style.display = '';
      return;
    }
    if (result.nicknameConflict) {
      // Nickname taken — show alt nickname step
      var fb = document.getElementById('vncbFeedback');
      if (fb) fb.style.display = 'none';
      var am = document.getElementById('vncbNicknameAltMsg');
      var as = document.getElementById('vncbNicknameAltSection');
      if (am) am.textContent = _homeT('nicknameTakenChooseAnother', 'The nickname "{nickname}" is already taken in this club. Please choose a different one.', { nickname: result.conflictNickname || nickname });
      if (as) as.style.display = '';
      return;
    }
    if (result.error) {
      _vncbShowFeedback('❌', _homeT('error', 'Error'), result.error);
      return;
    }
    // Success — request sent, pending approval
    _vncbShowFeedback('📨', _homeT('requestSent', 'Request Sent!'), _homeT('joinRequestAwaiting', 'Your request to join "{club}" as "{nickname}" is awaiting approval from the organiser.', { club: clubName, nickname: nickname }));
  } catch(e) {
    _vncbShowFeedback('❌', _homeT('error', 'Error'), e.message || _homeT('somethingWentWrong', 'Something went wrong.'));
  }
}

function _vncbShowFeedback(icon, title, msg) {
  ['vncbNicknameSection','vncbPasswordSection','vncbNicknameAltSection'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  var fb = document.getElementById('vncbFeedback');
  var fi = document.getElementById('vncbFeedbackIcon');
  var ft = document.getElementById('vncbFeedbackTitle');
  var fm = document.getElementById('vncbFeedbackMsg');
  if (fi) fi.textContent = icon;
  if (ft) ft.textContent = title;
  if (fm) fm.textContent = msg;
  if (fb) fb.style.display = '';
}

function _vncbOnJoined() {
  // Ensure club is set in localStorage before returning to home
  if (_vncbPendingClubId && _vncbPendingClubName) {
    if (typeof setMyClub === 'function') setMyClub(_vncbPendingClubId, _vncbPendingClubName);
  }
  var banner = document.getElementById('viewerNoClubBanner');
  if (banner) banner.style.display = 'none';
  if (typeof homeRefreshJoinClubTile === 'function') homeRefreshJoinClubTile();
  if (typeof homeRefreshTiles        === 'function') homeRefreshTiles();
  if (typeof showHomeScreen          === 'function') showHomeScreen();
}

/* ── Register page: smart close (return to source page) ── */
function vaultRegisterClose() {
  var src = window._regNavSource || null;
  window._regNavSource = null;
  if (src === 'organiserHome') {
    showHomeScreen();
    return;
  }
  if (src) {
    homeHideScreen();
    showPage(src, null);
    _updateDynamicBackBtns(src);
  } else {
    showHomeScreen();
  }
}

/* ── Register page: add newly registered player to today's session ── */
function vaultRegisterAndAddToSession(btn) {
  var name   = btn.dataset.name;
  var gender = btn.dataset.gender || 'Male';
  if (!name) return;

  var nameKey = name.toLowerCase();
  var exists  = schedulerState.allPlayers.some(function(p) {
    return p.name.trim().toLowerCase() === nameKey;
  });
  if (!exists) {
    schedulerState.allPlayers.push({ name: name, gender: gender, active: true });
  }
  schedulerState.activeplayers.splice(
    0, schedulerState.activeplayers.length,
    ...schedulerState.allPlayers.filter(function(p) { return p.active; }).map(function(p) { return p.name; }).reverse()
  );

  // Sync restQueue after activeplayers change — only during an active session
  if (typeof rebuildRestQueue === 'function' &&
      Array.isArray(schedulerState.restQueue) && allRounds.length > 0) {
    schedulerState.restQueue = rebuildRestQueue(schedulerState.restQueue);
  }

  if (typeof updatePlayerList  === 'function') updatePlayerList();
  if (typeof syncRatings       === 'function') syncRatings();
  if (typeof homeUpdateStepper === 'function') homeUpdateStepper();
  if (typeof dbClaimSessionSlots === 'function') {
    dbClaimSessionSlots(schedulerState.allPlayers.filter(function(p){return p.active;}).map(function(p){return p.name;}));
  }

  btn.textContent = '✅ Added to session!';
  btn.disabled = true;
}

/* ── Bulk register: add all successfully registered players to session ── */
function vaultBulkAddToSession(players, btn) {
  var added = 0;
  players.forEach(function(p) {
    var nameKey = p.name.toLowerCase();
    var exists  = schedulerState.allPlayers.some(function(e) {
      return e.name.trim().toLowerCase() === nameKey;
    });
    if (!exists) {
      schedulerState.allPlayers.push({ name: p.name, gender: p.gender || 'Male', active: true });
      added++;
    }
  });

  schedulerState.activeplayers.splice(
    0, schedulerState.activeplayers.length,
    ...schedulerState.allPlayers.filter(function(p) { return p.active; }).map(function(p) { return p.name; }).reverse()
  );

  // Sync restQueue after activeplayers change — only during an active session
  if (typeof rebuildRestQueue === 'function' &&
      Array.isArray(schedulerState.restQueue) && allRounds.length > 0) {
    schedulerState.restQueue = rebuildRestQueue(schedulerState.restQueue);
  }

  if (typeof updatePlayerList  === 'function') updatePlayerList();
  if (typeof syncRatings       === 'function') syncRatings();
  if (typeof homeUpdateStepper === 'function') homeUpdateStepper();
  if (typeof dbClaimSessionSlots === 'function') {
    dbClaimSessionSlots(schedulerState.allPlayers.filter(function(p){return p.active;}).map(function(p){return p.name;}));
  }

  btn.textContent = '✅ ' + added + ' player' + (added !== 1 ? 's' : '') + ' added to session!';
  btn.disabled = true;
}

// Build 773: tapping the compact mode header expands/collapses settings.
document.addEventListener('click', function(event) {
  var intro = event.target.closest && event.target.closest('.org-mode-panel .org-mode-intro');
  if (!intro || event.target.closest('.org-mode-expand')) return;
  var button = intro.querySelector('.org-mode-expand');
  if (button) orgToggleModeDetails(button, event);
});

/* Build 51: My Hub quick-action accordions. These are independent from the full Slots tab. */
function myHubToggleQuickGroup(kind) {
  var ids = { new:'myHubNewSlotsGroup', today:'myHubTodaySlotsGroup', live:'myHubLiveGroup' };
  var el = document.getElementById(ids[kind]);
  if (!el) return;
  var opening = !el.classList.contains('is-open');
  Object.keys(ids).forEach(function(k){ var x=document.getElementById(ids[k]); if(x && x!==el) x.classList.remove('is-open'); });
  el.classList.toggle('is-open', opening);
  if (opening && kind === 'live') myHubRefreshLiveQuickList();
  if (opening && (kind === 'new' || kind === 'today') && typeof myHubRenderQuickSlots === 'function') myHubRenderQuickSlots();
}

async function myHubRefreshLiveQuickList() {
  var list = document.getElementById('myHubLiveList');
  var count = document.getElementById('myHubLiveCount');
  if (!list || !count) return;
  list.innerHTML = '<div class="myhub-home-empty">Loading…</div>';
  try {
    var sessions = (typeof dbGetLiveSessions === 'function') ? await dbGetLiveSessions() : [];
    sessions = (typeof _filterActuallyLiveSessions === 'function') ? _filterActuallyLiveSessions(sessions) : (sessions || []);
    count.textContent = sessions.length;
    if (!sessions.length) { list.innerHTML = '<div class="myhub-home-empty">No live sessions right now</div>'; return; }
    list.innerHTML = sessions.map(function(sess){
      var club = sess.club_name || sess.clubName || sess.name || 'Live session';
      var starter = sess.started_by || sess.starter || '';
      return '<div class="myhub-live-item"><span><strong>'+String(club).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];})+'</strong><small>'+ (starter ? 'Started by '+String(starter).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}) : 'In progress') +'</small></span><button class="myhub-live-open" onclick="homeGo(\'dashboardPage\',\'tabBtnDashboard\')">View</button></div>';
    }).join('');
  } catch(e) { count.textContent='0'; list.innerHTML='<div class="myhub-home-empty">Unable to load live sessions</div>'; }
}
