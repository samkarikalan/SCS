/* ══════════════════════════════════════════════
   SCS GLOBAL NOTIFICATION MANAGER
   - Runs at app level, not only on Slots/My Card page
   - Shows one-time popup for newly posted future slots
   - Works while user is on Home, Players, Settings, etc.
   - Uses localStorage seen-list, so no DB migration is required
══════════════════════════════════════════════ */
(function() {
  if (window.__scsGlobalNotificationsLoaded) return;
  window.__scsGlobalNotificationsLoaded = true;

  var POLL_MS = 60000;
  var AUTO_REFRESH_MIN_MS = 30000;
  var LOOKAHEAD_DAYS = 90;
  var pollTimer = null;
  var checking = false;
  var lastSignature = '';
  var latestSlots = [];
  var startupRetryTimer = null;
  var startupRetryCount = 0;
  var lastCheckAt = 0;

  function esc(s) {
    if (typeof _vsEscape === 'function') return _vsEscape(s);
    return String(s == null ? '' : s).replace(/[&<>'"]/g, function(c) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[c];
    });
  }

  function tr(key, fallback) {
    try { return (typeof t === 'function' && t(key)) || fallback; } catch(e) { return fallback; }
  }

  function dateStr(d) {
    if (typeof _vsDateStr === 'function') return _vsDateStr(d.getFullYear(), d.getMonth(), d.getDate());
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function addDaysStr(start, days) {
    var d = new Date(String(start) + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return dateStr(d);
  }

  function todayStr() {
    return dateStr(new Date());
  }

  function fmtTime(v) {
    if (typeof _vsFormatTime === 'function') return _vsFormatTime(v);
    return String(v || '').slice(0, 5);
  }

  function fmtDate(v) {
    var out = String(v || '');
    try {
      out = new Date(out + 'T00:00:00').toLocaleDateString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric'
      });
    } catch(e) {}
    return out;
  }

  function currentUserKey() {
    try {
      var u = (typeof authGetUser === 'function') ? authGetUser() : null;
      u = u || window.currentUser || null;
      return String((u && (u.id || u.user_id || u.uid || u.email)) || '').trim();
    } catch(e) { return ''; }
  }

  function seenKey() {
    return 'scs_seen_slot_announcements_' + String(currentUserKey() || 'guest');
  }

  // The Welcome/My Hub indicator has its own read state. Dismissing the popup
  // must not clear the information from the Welcome screen. It is cleared only
  // when the player actually opens My Hub.
  function welcomeSeenKey() {
    return 'scs_seen_welcome_slots_' + String(currentUserKey() || 'guest');
  }

  function getWelcomeSeen() {
    try {
      var raw = localStorage.getItem(welcomeSeenKey());
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.map(String) : [];
    } catch(e) { return []; }
  }

  function isOwnSlot(slot) {
    if (!slot) return false;
    var uid = currentUserKey();
    if (!uid) return false;
    return String(slot.created_by || slot.createdBy || slot.creator_id || '').trim() === uid;
  }

  function isPostedFutureSlot(slot) {
    if (!slot || !slot.id) return false;
    var status = String(slot.status || '').toLowerCase().trim();
    // Critical: drafts must never create a popup.
    if (status !== 'posted') return false;
    if (slot.played_session_id) return false;
    return String(slot.slot_date || '') >= todayStr();
  }

  function forceViewerHome() {
    try {
      if (typeof applyMode === 'function') applyMode('viewer');
      if (typeof updateModePill === 'function') updateModePill('viewer');
      if (typeof appMode !== 'undefined') appMode = 'viewer';
      sessionStorage.setItem('appMode', 'viewer');
      localStorage.setItem('kbrr_app_mode', 'viewer');
      document.body.classList.add('viewer-mode');
      document.body.classList.remove('organiser-tabs', 'vault-mode');
    } catch(e) {}
    try { if (typeof showHomeScreen === 'function') showHomeScreen(); } catch(e) {}
  }

  function getSeen() {
    try {
      var raw = localStorage.getItem(seenKey());
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.map(String) : [];
    } catch(e) { return []; }
  }

  function updateWelcomeNewSlotsInfo(slots) {
    var info = document.getElementById('simpleNewSlotsInfo');
    var text = document.getElementById('simpleNewSlotsText');
    if (!info || !text) return;
    var seen = getWelcomeSeen();
    var count = (slots || latestSlots || []).filter(function(slot) {
      return slot && slot.id && seen.indexOf(String(slot.id)) < 0;
    }).length;
    if (count > 0) {
      var singular = (typeof t === 'function' ? t('newSlotAvailableToBook') : '') || '1 new slot available to book';
      var plural = (typeof t === 'function' ? t('newSlotsAvailableToBook') : '') || '{count} new slots available to book';
      text.textContent = count === 1 ? singular : plural.replace('{count}', String(count));
      info.hidden = false;
      if (info.dataset.lastCount !== String(count)) {
        info.classList.remove('is-new-flash');
        void info.offsetWidth;
        info.classList.add('is-new-flash');
        window.setTimeout(function() { info.classList.remove('is-new-flash'); }, 30000);
      }
      info.dataset.lastCount = String(count);
    } else {
      info.hidden = true;
      info.dataset.lastCount = '0';
      info.classList.remove('is-new-flash');
    }
  }

  function markSeen(slotId) {
    if (!slotId) return;
    try {
      var seen = getSeen();
      var sid = String(slotId);
      if (seen.indexOf(sid) < 0) seen.unshift(sid);
      localStorage.setItem(seenKey(), JSON.stringify(seen.slice(0, 300)));
    } catch(e) {}
    updateWelcomeNewSlotsInfo(latestSlots);
  }

  function markWelcomeSlotsViewed() {
    try {
      var ids = (latestSlots || []).filter(function(slot) {
        return slot && slot.id;
      }).map(function(slot) { return String(slot.id); });
      localStorage.setItem(welcomeSeenKey(), JSON.stringify(ids.slice(0, 300)));
    } catch(e) {}
    updateWelcomeNewSlotsInfo(latestSlots);
  }

  function isAppReady() {
    return typeof sbGet === 'function' &&
           typeof dbGetVisibleSlotsForRange === 'function';
  }

  function isPlayerWorkspace() {
    if (typeof appMode !== 'undefined' && appMode) return appMode === 'viewer';
    return document.body.classList.contains('viewer-mode');
  }

  async function loadVisibleSlotsForNotification() {
    if (!isAppReady()) return [];

    var first = todayStr();
    var last = addDaysStr(first, LOOKAHEAD_DAYS);
    var memberships = [];
    var clubIds = [];

    // Reuse My Card slot eligibility state, but run it globally.
    try {
      if (typeof _mcsGetPlayerClubMemberships === 'function') {
        memberships = await _mcsGetPlayerClubMemberships();
      }
    } catch(e) { memberships = []; }

    window._mcsCurrentPlayersByClub = window._mcsCurrentPlayersByClub || {};
    window._mcsClubsById = window._mcsClubsById || {};
    window._mcsCurrentPlayer = null;

    (memberships || []).forEach(function(player, idx) {
      var cid = String(player && player.clubId || '').trim();
      if (!cid) return;
      if (clubIds.indexOf(cid) < 0) clubIds.push(cid);
      window._mcsCurrentPlayersByClub[cid] = player;
      window._mcsClubsById[cid] = {
        id: cid,
        name: player.clubName || ('Club ' + (idx + 1)),
        color: player.clubColor || (typeof _mcsClubColor === 'function' ? _mcsClubColor(idx) : '#4a9eff')
      };
      if (!window._mcsCurrentPlayer) window._mcsCurrentPlayer = player;
    });

    try {
      if (typeof _mcsGetPublicPlayer === 'function') {
        window._mcsPublicPlayer = await _mcsGetPublicPlayer(false);
        if (!window._mcsCurrentPlayer) window._mcsCurrentPlayer = window._mcsPublicPlayer;
      }
    } catch(e) {}

    var allSlots = await dbGetVisibleSlotsForRange(first, last).catch(function(){ return []; });
    var filtered = (allSlots || []).filter(function(slot) {
      if (!slot || !slot.id) return false;
      if (!isPostedFutureSlot(slot)) return false;

      var cid = String(slot.club_id || slot._viewerClubId || '').trim();
      var isMyClub = clubIds.indexOf(cid) >= 0;
      // Public slots stay discoverable in My Hub, but announcements are only
      // for verified members of the club that posted the slot.
      if (!isMyClub) return false;

      var club = window._mcsClubsById && window._mcsClubsById[cid];
      if (club) {
        slot._viewerClubId = cid;
        slot._viewerClubName = club.name;
        slot._viewerClubColor = club.color;
      }
      slot._clubFilterMatched = isMyClub;

      if (typeof _mcsIsEligibleSlot === 'function') {
        var player = (typeof _mcsPlayerForSlot === 'function') ? _mcsPlayerForSlot(slot) : window._mcsCurrentPlayer;
        if (!_mcsIsEligibleSlot(slot, player)) return false;
      }

      if (typeof _mcsViewerClaim === 'function' && _mcsViewerClaim(slot)) return false;
      return true;
    });

    filtered.sort(function(a, b) {
      return String(a.slot_date || '').localeCompare(String(b.slot_date || '')) ||
             String(a.start_time || '').localeCompare(String(b.start_time || ''));
    });

    latestSlots = filtered;
    updateWelcomeNewSlotsInfo(filtered);
    return filtered;
  }

  function findUnseen(slots) {
    var seen = getSeen();
    return (slots || []).find(function(slot) {
      return slot && slot.id && seen.indexOf(String(slot.id)) < 0;
    }) || null;
  }

  function countText(slot) {
    var confirmed = Number(slot && slot.confirmedCount || 0);
    var max = Number(slot && slot.max_players || 0);
    return confirmed + '/' + (max || '—');
  }

  function slotClub(slot) {
    if (typeof _mcsClubForSlot === 'function') return _mcsClubForSlot(slot) || {};
    return { name: (slot && (slot._viewerClubName || 'Club')) || 'Club' };
  }

  function showPopup(slot) {
    if (!slot || !slot.id) return;
    if (document.getElementById('mcsSlotAnnouncementOverlay')) return;

    var club = slotClub(slot);
    var overlay = document.createElement('div');
    overlay.id = 'mcsSlotAnnouncementOverlay';
    overlay.className = 'mcs-ann-overlay';
    overlay.innerHTML =
      '<div class="mcs-ann-card" onclick="event.stopPropagation()">' +
        '<div class="mcs-ann-kicker">📢 ' + esc(tr('newSlot', 'New Slot')) + '</div>' +
        '<div class="mcs-ann-title">' + esc(club.name || slot._viewerClubName || 'Club') + '</div>' +
        '<div class="mcs-ann-row"><span>📅</span><strong>' + esc(fmtDate(slot.slot_date)) + '</strong></div>' +
        '<div class="mcs-ann-row"><span>🕒</span><strong>' + esc(fmtTime(slot.start_time) + ' – ' + fmtTime(slot.end_time)) + '</strong></div>' +
        '<div class="mcs-ann-row"><span>📍</span><strong>' + esc(slot.venue || '') + '</strong></div>' +
        '<div class="mcs-ann-pills">' +
          '<span>' + esc(typeof _vsSlotVisibilityLabel === 'function' ? _vsSlotVisibilityLabel(slot) : (slot.visibility || 'Private')) + '</span>' +
          '<span>' + esc(typeof _vsSlotGenderLabel === 'function' ? _vsSlotGenderLabel(slot) : (slot.gender_filter || 'All')) + '</span>' +
          '<span>' + esc(countText(slot)) + '</span>' +
        '</div>' +
        '<div class="mcs-ann-actions">' +
          '<button class="mcs-ann-later" type="button" data-action="later">' + esc(tr('later', 'Later')) + '</button>' +
          '<button class="mcs-ann-join" type="button" data-action="join">' + esc(tr('joinBtn', 'Join')) + '</button>' +
          '<button class="mcs-ann-view" type="button" data-action="view">' + esc(tr('viewSlot', 'View Slot')) + '</button>' +
        '</div>' +
      '</div>';

    // Button clicks are handled on the card itself because the card stops
    // propagation to prevent accidental outside-tap dismissal.
    var card = overlay.querySelector('.mcs-ann-card');
    if (card) {
      card.addEventListener('click', async function(e) {
        e.stopPropagation();
        var btn = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
        var action = btn && btn.getAttribute('data-action');
        if (!action) return;
        if (action === 'join') {
          card.querySelectorAll('button').forEach(function(button) { button.disabled = true; });
          btn.textContent = tr('joinBtn', 'Join') + '...';
          if (typeof myCardSlotsJoin === 'function') await myCardSlotsJoin(slot.id);
          var updatedSlot = await loadOneSlotForQuickView(slot.id);
          var joinedClaim = updatedSlot && typeof _mcsViewerClaim === 'function' ? _mcsViewerClaim(updatedSlot) : null;
          if (joinedClaim && (joinedClaim.status === 'confirmed' || joinedClaim.status === 'waitlist')) {
            markSeen(slot.id);
            overlay.remove();
            if (typeof showToast === 'function') {
              showToast(tr('joined', 'Joined'));
            }
            return;
          }
          card.querySelectorAll('button').forEach(function(button) { button.disabled = false; });
          btn.textContent = tr('joinBtn', 'Join');
          return;
        }
        dismiss(slot.id, action === 'view');
      });
    }

    document.body.appendChild(overlay);
  }

  function quickSlotOverlay() {
    var old = document.getElementById('scsQuickSlotPage');
    if (old) old.remove();
    var page = document.createElement('div');
    page.id = 'scsQuickSlotPage';
    page.className = 'scs-quick-slot-page';
    page.innerHTML =
      '<div class="scs-quick-slot-header">' +
        '<button class="scs-quick-slot-close" type="button" data-qs-close>‹ Close</button>' +
        '<div class="scs-quick-slot-title">' + esc(tr('slotDetails', 'Slot Details')) + '</div>' +
        '<div class="scs-quick-slot-spacer"></div>' +
      '</div>' +
      '<div class="scs-quick-slot-body">' +
        '<div class="scs-quick-slot-loading">' + esc(tr('loadingSlots', 'Loading slots...')) + '</div>' +
      '</div>';
    document.body.appendChild(page);
    page.querySelector('[data-qs-close]').addEventListener('click', function(){ closeQuickSlot(); });
    return page;
  }

  function closeQuickSlot() {
    var page = document.getElementById('scsQuickSlotPage');
    if (page) page.remove();
  }

  async function loadOneSlotForQuickView(slotId) {
    var source = (latestSlots || []).find(function(s) { return String(s && s.id) === String(slotId); }) || null;
    var slot = null;
    if (typeof vaultSlotsLoadOne === 'function') {
      slot = await vaultSlotsLoadOne(slotId).catch(function(){ return null; });
    }
    slot = slot || source;
    if (!slot) return null;

    // vaultSlotsLoadOne returns the slot, but not always the viewer club metadata.
    // Preserve the metadata discovered by the notification eligibility load.
    if (source) {
      slot._viewerClubId = slot._viewerClubId || source._viewerClubId || source.club_id;
      slot._viewerClubName = slot._viewerClubName || source._viewerClubName;
      slot._viewerClubColor = slot._viewerClubColor || source._viewerClubColor;
      slot._clubFilterMatched = source._clubFilterMatched;
    }

    // Ensure public/player profiles exist for the existing MyCard action helpers.
    try {
      if (typeof _mcsGetPublicPlayer === 'function' && !window._mcsPublicPlayer) {
        window._mcsPublicPlayer = await _mcsGetPublicPlayer(false);
      }
    } catch(e) {}
    return slot;
  }

  async function renderQuickSlot(slotId) {
    var page = document.getElementById('scsQuickSlotPage') || quickSlotOverlay();
    var body = page.querySelector('.scs-quick-slot-body');
    if (!body) return;

    var slot = await loadOneSlotForQuickView(slotId);
    if (!slot) {
      body.innerHTML = '<div class="scs-quick-slot-empty">' + esc(tr('slotNotFound', 'Slot not found')) + '</div>';
      return;
    }

    window._scsQuickSlotCurrent = slot;
    var prevExpanded = window._mcsExpandedSlotId;
    window._mcsExpandedSlotId = String(slot.id);

    var html = '';
    if (typeof _mcsRenderSlotCard === 'function') {
      html = _mcsRenderSlotCard(slot).replace(/onclick="myCardSlotsToggleDetails\('[^']*'\)"/g, '');
    } else {
      html = '<div class="mc-slot-card is-expanded"><div class="mc-slot-titlebar"><span>' + esc(slot._viewerClubName || 'Club') + '</span></div>' +
        '<div class="mc-slot-card-head"><div class="mc-slot-title">' + esc(slot.visibility || 'Slot') + '</div></div></div>';
    }
    window._mcsExpandedSlotId = prevExpanded;

    body.innerHTML = '<div class="scs-quick-slot-card-wrap">' + html + '</div>';
    if (typeof _mcsNormalizeSlotActionLabels === 'function') _mcsNormalizeSlotActionLabels(body);

    // Use the existing join/leave functions, but keep the user on this one-slot page.
    body.querySelectorAll('.mc-slot-action-btn').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        var current = window._scsQuickSlotCurrent || slot;
        var claim = (typeof _mcsViewerClaim === 'function') ? _mcsViewerClaim(current) : null;
        try {
          if (claim && (claim.status === 'confirmed' || claim.status === 'waitlist')) {
            if (typeof myCardSlotsCancel === 'function') await myCardSlotsCancel(current.id);
          } else {
            if (typeof myCardSlotsJoin === 'function') await myCardSlotsJoin(current.id);
          }
        } finally {
          await renderQuickSlot(current.id);
        }
      }, true);
    });
  }

  async function openSlot(slotId) {
    // Notification View Slot opens a focused one-slot page.
    // It does not switch Home/Players/Vault, so the user returns exactly to the
    // page they were working on by pressing Close.
    quickSlotOverlay();
    await renderQuickSlot(slotId);
  }

  function dismiss(slotId, view) {
    markSeen(slotId);
    var overlay = document.getElementById('mcsSlotAnnouncementOverlay');
    if (overlay) overlay.remove();
    if (view) openSlot(slotId);
  }

  async function checkNow(force) {
    if (checking || document.hidden) return;
    if (typeof window.scsIsRoundManagerVisible === 'function' && window.scsIsRoundManagerVisible()) return;
    if (!isAppReady()) return;
    var now = Date.now();
    if (!force && lastCheckAt && now - lastCheckAt < AUTO_REFRESH_MIN_MS) return;
    lastCheckAt = now;
    // Always refresh the Welcome/My Hub information, regardless of the currently
    // selected workspace. Popups remain limited to the Player workspace.
    checking = true;
    try {
      var slots = await loadVisibleSlotsForNotification();
      var sig = JSON.stringify((slots || []).map(function(s) {
        return [s.id, s.slot_date, s.start_time, s.status, s.visibility, s.confirmedCount || 0, s.waitlistCount || 0];
      }));
      if (force || sig !== lastSignature) {
        lastSignature = sig;
        if (isPlayerWorkspace()) {
          var unseen = findUnseen(slots);
          if (unseen) showPopup(unseen);
        }
      }
    } catch(e) {
      console.log('[SCS Notifications] check failed', e);
    } finally {
      checking = false;
      // Join Probability shares this single background refresh cycle instead
      // of running a second independent database poller.
      if (typeof window.scsJoinProbabilityCheckNow === 'function') {
        window.scsJoinProbabilityCheckNow(false);
      }
    }
  }

  function start() {
    if (pollTimer) clearInterval(pollTimer);
    if (startupRetryTimer) clearInterval(startupRetryTimer);

    // Login, profile and club memberships often finish after DOMContentLoaded.
    // Retry quickly during startup so the Welcome tile is populated without
    // requiring the player to enter My Hub first.
    startupRetryCount = 0;
    setTimeout(function(){ checkNow(false); }, 800);
    startupRetryTimer = setInterval(function(){
      startupRetryCount += 1;
      checkNow(false);
      if (startupRetryCount >= 3) {
        clearInterval(startupRetryTimer);
        startupRetryTimer = null;
      }
    }, 5000);

    pollTimer = setInterval(function(){ checkNow(false); }, POLL_MS);
  }

  window.scsNotificationsCheckNow = function() { return checkNow(true); };
  window.scsNotificationsMarkSlotSeen = markSeen;
  window.scsNotificationsOpenSlot = openSlot;
  window.scsNotificationsRefreshOpenSlot = renderQuickSlot;
  window.scsNotificationsUpdateWelcomeInfo = function() { updateWelcomeNewSlotsInfo(latestSlots); };
  window.scsNotificationsMarkWelcomeViewed = markWelcomeSlotsViewed;

  document.addEventListener('DOMContentLoaded', start);
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) setTimeout(function(){ checkNow(false); }, 400);
  });
  window.addEventListener('focus', function(){ setTimeout(function(){ checkNow(false); }, 400); });
  window.addEventListener('pageshow', function(){ setTimeout(function(){ checkNow(false); }, 300); });
  window.addEventListener('scs:workspace-prefetch-ready', function(){ setTimeout(function(){ checkNow(false); }, 100); });
  window.addEventListener('scs:data-synced', function(){ setTimeout(function(){ checkNow(false); }, 100); });
})();
