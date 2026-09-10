/* ══════════════════════════════════════════════
   VAULT SLOTS — open-play slot booking
   Tables:
     slots        (id, club_id, slot_date, venue, start_time, end_time,
                    max_players, created_by, created_at)
     slot_claims  (id, slot_id, player_id, status, claimed_at)
       status: 'confirmed' | 'waitlist' | 'cancelled' | 'late_cancelled'
══════════════════════════════════════════════ */

// ── State for the currently-viewed month on the full calendar page ──
var _vsCalYear  = null;
var _vsCalMonth = null; // 0-11
var _vsSlotsByDate = {}; // 'YYYY-MM-DD' -> [slot, ...] for the currently loaded month
var _vsSelectedDateStr = null;
var _vsSoftRefreshTimer = null;

function _vsT(key, fallback, values) {
  var value = (typeof t === 'function') ? t(key) : key;
  if (!value || value === key) value = fallback || key;
  return String(value).replace(/\{(\w+)\}/g, function(_, name) {
    return values && values[name] != null ? String(values[name]) : '';
  });
}

function _vsScheduledPostIsoFromInput(value) {
  value = String(value || '').trim();
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function _vsScheduledPostInputValue(slot) {
  const raw = slot && slot.scheduled_post_at;
  const d = raw ? new Date(raw) : new Date(Date.now() + 60 * 60 * 1000);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

async function _vsPublishDueScheduledSlots(slots) {
  if (!Array.isArray(slots) || typeof sbPatch !== 'function') return slots || [];
  const now = Date.now();
  const due = slots.filter(slot => {
    if (!slot || String(slot.status || '').toLowerCase() !== 'scheduled') return false;
    const ms = Date.parse(slot.scheduled_post_at || '');
    return Number.isFinite(ms) && ms <= now;
  });
  if (!due.length) return slots;
  await Promise.all(due.map(slot =>
    sbPatch('slots', `id=eq.${slot.id}`, { status: 'posted', scheduled_post_at: null }).catch(() => null)
  ));
  due.forEach(slot => {
    slot.status = 'posted';
    slot.scheduled_post_at = null;
  });
  return slots;
}

function _vsGuestTag(id) {
  const raw = String(id || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  return raw ? raw.slice(-4).padStart(4, '0') : 'GUEST';
}

function _vsGuestName(name, id) {
  name = String(name || 'Player').trim() || 'Player';
  if (/\(guest(?:\s+[A-Z0-9]+)?\)$/i.test(name)) return name;
  return name + ' (guest ' + _vsGuestTag(id) + ')';
}

async function _vsBuildClaimPlayerMeta(claims, clubId) {
  const pids = [...new Set((claims || []).map(c => c.player_id).filter(Boolean).map(String))];
  const playerMeta = {};
  if (!pids.length) return playerMeta;

  if (clubId) {
    const clubMembers = await sbGet('memberships',
      `club_id=eq.${clubId}&player_id=in.(${pids.join(',')})&select=player_id,nickname,club_rating,players(id,gender,global_rating,name)`
    ).catch(() => []);
    (clubMembers || []).forEach(m => {
      playerMeta[String(m.player_id)] = {
        name: m.nickname || (m.players && m.players.name) || 'Player',
        clubRating: m.club_rating || (m.players && m.players.global_rating),
        gender: m.players && m.players.gender
      };
    });
  }

  const missingAfterClub = pids.filter(pid => !playerMeta[pid]);
  if (missingAfterClub.length) {
    const players = await sbGet('players',
      `id=in.(${missingAfterClub.join(',')})&select=id,name,gender,global_rating,user_account_id`
    ).catch(() => []);

    const repairedByPlayerId = {};
    if (clubId) {
      const accountIds = [...new Set((players || [])
        .map(p => p && p.user_account_id)
        .filter(Boolean)
        .map(String))];
      if (accountIds.length) {
        const linkedMembers = await sbGet('memberships',
          `club_id=eq.${clubId}&user_account_id=in.(${accountIds.join(',')})&select=player_id,nickname,club_rating,user_account_id,players(id,gender,global_rating,name)`
        ).catch(() => []);
        const memberByAccount = {};
        (linkedMembers || []).forEach(m => {
          const key = String(m.user_account_id || '');
          if (key && !memberByAccount[key]) memberByAccount[key] = m;
        });
        (players || []).forEach(p => {
          const m = memberByAccount[String(p.user_account_id || '')];
          if (!m || !m.player_id) return;
          repairedByPlayerId[String(p.id)] = {
            claimPlayerId: String(p.id),
            memberPlayerId: String(m.player_id),
            meta: {
              name: m.nickname || (m.players && m.players.name) || p.name || 'Player',
              clubRating: m.club_rating || (m.players && m.players.global_rating),
              gender: (m.players && m.players.gender) || p.gender
            }
          };
        });
      }
    }

    Object.keys(repairedByPlayerId).forEach(oldPlayerId => {
      const repair = repairedByPlayerId[oldPlayerId];
      playerMeta[oldPlayerId] = repair.meta;
      const claim = (claims || []).find(c => String(c.player_id) === oldPlayerId);
      if (claim && claim.id && typeof sbPatch === 'function') {
        sbPatch('slot_claims', `id=eq.${claim.id}`, { player_id: repair.memberPlayerId }).catch(() => {});
      }
    });

    (players || []).forEach(p => {
      if (repairedByPlayerId[String(p.id)]) return;
      playerMeta[String(p.id)] = {
        name: _vsGuestName(p.name || 'Player', p.id),
        clubRating: null,
        gender: p.gender,
        guest: true,
        userAccountId: p.user_account_id || null
      };
    });

    const guestAccountIds = [...new Set((players || [])
      .map(p => p && p.user_account_id)
      .filter(Boolean)
      .map(String))];
    if (clubId && guestAccountIds.length) {
      const joinRequests = await sbGet('club_join_requests',
        `club_id=eq.${clubId}&user_account_id=in.(${guestAccountIds.join(',')})&status=eq.pending&select=id,user_account_id,nickname,status`
      ).catch(() => []);
      const requestByAccount = {};
      (joinRequests || []).forEach(req => { requestByAccount[String(req.user_account_id)] = req; });
      (players || []).forEach(p => {
        const meta = playerMeta[String(p.id)];
        const request = requestByAccount[String(p.user_account_id || '')];
        if (meta && request) meta.clubJoinRequest = request;
      });
    }
  }

  return playerMeta;
}

/* ── DB: fetch all slots (+ claim counts) for a club within a date range ── */
async function dbGetSlotsForRange(clubId, startDateStr, endDateStr) {
  return vaultSlotsLoadRange({ clubId, startDateStr, endDateStr });
}

function _vsSlotCourtCount(slot) {
  const n = parseInt(slot && slot.court_count, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function _vsSlotSessionMode(slot) {
  const mode = String(slot && slot.session_mode || 'round').toLowerCase();
  if (mode === 'rolling') return 'rolling';
  return mode === 'balanced' ? 'balanced' : 'standard';
}

function _vsSessionModeLabel(mode) {
  const normalized = _vsSlotSessionMode({ session_mode: mode });
  if (normalized === 'rolling') return t('rollingMode') || 'Rolling';
  return normalized === 'balanced' ? (t('balancedMode') || 'Balanced') : (t('standardMode') || 'Standard');
}

function _vsSessionMetaHtml(slot, courtOnly) {
  const courts = _vsSlotCourtCount(slot);
  const courtWord = courts === 1 ? (t('courtSingle') || 'court') : (t('courtPlural') || 'courts');
  return '<div class="mc-slot-meta-row">' +
    '<span>' + courts + ' ' + courtWord + '</span>' +
    (courtOnly ? '<span class="mc-slot-level-pill">' + _vsEscape(_mcsSlotLevelText(slot)) + '</span>' : '') +
    (courtOnly ? '' : '<span>' + _vsEscape(_vsSessionModeLabel(_vsSlotSessionMode(slot))) + '</span>') +
  '</div>';
}

function _vsVenueForSlot(slot) {
  if (!slot) return null;
  var id = String(slot.venue_id || '').trim();
  if (id && Array.isArray(_vaultVenuesCache)) {
    var byId = _vaultVenuesCache.find(function(v){ return String(v.id) === id; });
    if (byId) return byId;
  }
  var name = String(slot.venue || '').trim();
  if (name && Array.isArray(_vaultVenuesCache)) {
    return _vaultVenuesCache.find(function(v){
      return _venueDisplayName(v) === name || v.name === name || v.english_name === name || v.japanese_name === name;
    }) || null;
  }
  return null;
}

function _vsSlotVenueName(slot) {
  var venue = _vsVenueForSlot(slot);
  return venue ? _venueDisplayName(venue) : String((slot && slot.venue) || '').trim();
}

function _vsVenueIsJapanese() {
  var lang = (typeof currentLang !== 'undefined' && currentLang) || localStorage.getItem('appLanguage') || 'en';
  return String(lang).toLowerCase() === 'jp' || String(lang).toLowerCase() === 'ja';
}

function _venueDisplayNameForLang(v) {
  if (!v) return '';
  if (_vsVenueIsJapanese()) {
    return String(v.japanese_name || v.name || v.english_name || '').trim();
  }
  return String(v.english_name || v.name || v.japanese_name || '').trim();
}

function _venueAddressForLang(v) {
  if (!v) return '';
  if (_vsVenueIsJapanese()) {
    return String(v.address_ja || v.address || '').trim();
  }
  return String(v.address || v.address_ja || '').trim();
}

function _vsSlotVenueAddress(slot) {
  var venue = _vsVenueForSlot(slot);
  if (!venue) return '';
  return _venueAddressForLang(venue) || ((venue.latitude != null && venue.longitude != null) ? (venue.latitude + ', ' + venue.longitude) : '');
}

function _vsAllRenderedSlots() {
  var list = [];
  [_vsSlotsByDate, _mcsSlotsByDate, _vhsSlotsByDate].forEach(function(group) {
    Object.keys(group || {}).forEach(function(dateStr) {
      list = list.concat(group[dateStr] || []);
    });
  });
  if (_vsManageDraft && _vsManageDraft.slot) list.push(_vsManageDraft.slot);
  return list;
}

function vaultSlotsOpenSlotMap(slotId) {
  var slot = _vsAllRenderedSlots().find(function(s){ return String(s && s.id) === String(slotId); });
  var venue = _vsVenueForSlot(slot);
  if (venue && venue.maps_url) window.open(venue.maps_url, '_blank');
}

function _vsSlotVenueHtml(slot) {
  var name = _vsSlotVenueName(slot);
  var address = _vsSlotVenueAddress(slot);
  var venue = _vsVenueForSlot(slot);
  var mapBtn = venue && venue.maps_url
    ? '<button type="button" class="mc-slot-map-btn" onclick="event.stopPropagation();vaultSlotsOpenSlotMap(\'' + _vsEscape(slot.id) + '\')">' + _vsEscape(t('openMap') || 'Map') + '</button>'
    : '';
  return '<div class="mc-slot-venue-block">' +
    '<div class="mc-slot-venue">' + _vsEscape(name || '') + '</div>' +
    ((address || mapBtn) ? '<div class="mc-slot-venue-detail">' + (address ? '<span>' + _vsEscape(address) + '</span>' : '') + mapBtn + '</div>' : '') +
  '</div>';
}

function _vsSlotCostPerPlayer(slot) {
  const raw = slot && (
    slot.cost_per_player ||
    (slot.session && slot.session.shuttle_data && slot.session.shuttle_data.cost_per_player) ||
    (slot._session && slot._session.shuttle_data && slot._session.shuttle_data.cost_per_player)
  );
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function _vsSlotCostLabel(slot) {
  const cost = _vsSlotCostPerPlayer(slot);
  return cost ? '¥' + Math.round(cost).toLocaleString() : '';
}

function _vsClaimPaid(claim) {
  return !!(claim && claim.paid_at);
}

function _vsIsActiveClaim(claim) {
  const status = String((claim && claim.status) || '').toLowerCase();
  return status === 'confirmed' || status === 'waitlist';
}

function _vsIsQueuedClaim(claim) {
  const status = String((claim && claim.status) || '').toLowerCase();
  return status === 'pending' || status === 'confirmed' || status === 'waitlist';
}

function _vsActiveClaims(claims) {
  return (claims || []).filter(_vsIsActiveClaim);
}

async function _vsFetchSlotClaims(filter) {
  if (typeof sbGet !== 'function' || !filter) return [];
  const order = '&order=claimed_at.asc,id.asc';
  const withProbability = filter + '&select=id,slot_id,player_id,status,claimed_at,paid_at,join_probability,join_probability_updated_at' + order;
  let rows = await sbGet('slot_claims', withProbability).catch(() => null);
  if (rows !== null) return rows || [];
  const withPayment = filter + '&select=id,slot_id,player_id,status,claimed_at,paid_at' + order;
  rows = await sbGet('slot_claims', withPayment).catch(() => null);
  if (rows !== null) return rows || [];
  const withoutPayment = filter + '&select=id,slot_id,player_id,status,claimed_at' + order;
  return await sbGet('slot_claims', withoutPayment).catch(() => []);
}

function _vsSlotStartMs(slot) {
  if (!slot || !slot.slot_date || !slot.start_time) return NaN;
  const parts = String(slot.start_time || '').match(/^(\d{1,2}):(\d{2})/);
  if (!parts) return NaN;
  const d = new Date(String(slot.slot_date) + 'T00:00:00');
  d.setHours(parseInt(parts[1], 10) || 0, parseInt(parts[2], 10) || 0, 0, 0);
  return d.getTime();
}

function _vsCanFreeCancelSlot(slot, claim) {
  if (!slot || !claim) return false;
  if (String(claim.status || '').toLowerCase() === 'waitlist') return true;
  const waitlistCount = (slot.claims || []).filter(c => c && c.status === 'waitlist' && String(c.id) !== String(claim.id)).length;
  const startMs = _vsSlotStartMs(slot);
  const hasThirtyMinutes = Number.isFinite(startMs) && (startMs - Date.now()) >= 30 * 60 * 1000;
  return waitlistCount > 0 && hasThirtyMinutes;
}

/* ── DB: create a new slot ── */
async function dbCreateSlot(clubId, slotDate, venue, startTime, endTime, maxPlayers, genderFilter, minRating, visibility, courtCount, sessionMode, initialPlayers, createMode, scheduledPostAt, venueId) {
  if (!venue || !venue.trim()) throw new Error(t('enterVenueName') || 'Enter a venue name');
  if (!startTime || !endTime) throw new Error(t('enterSlotTimes') || 'Enter start and end time');
  if (!maxPlayers || maxPlayers < 1) throw new Error(t('enterMaxPlayers') || 'Enter max players');

  const cleanCourtCount = Math.max(1, Math.min(20, parseInt(courtCount || 1, 10) || 1));
  const cleanSessionMode = _vsSlotSessionMode({ session_mode: sessionMode });
  const user = (typeof authGetUser === 'function') ? authGetUser() : null;
  const payload = {
    club_id: clubId,
    slot_date: slotDate,
    venue: venue.trim(),
    start_time: startTime,
    end_time: endTime,
    max_players: maxPlayers,
    status: 'draft',
    gender_filter: genderFilter || 'all',
    min_rating: parseFloat(minRating) || 0,
    visibility: visibility || 'private',
    court_count: cleanCourtCount,
    session_mode: cleanSessionMode,
  };
  if (venueId) payload.venue_id = venueId;
  if (createMode === 'posted') payload.status = 'posted';
  if (createMode === 'scheduled') {
    payload.status = 'scheduled';
    payload.scheduled_post_at = scheduledPostAt;
  }
  if (user && user.id) payload.created_by = user.id;

  let created = null;
  try {
    created = await sbPost('slots', payload);
  } catch (e) {
    if (payload.venue_id) {
      delete payload.venue_id;
      created = await sbPost('slots', payload);
    } else {
      throw e;
    }
  }
  const slot = Array.isArray(created) ? created[0] : created;

  if (slot && slot.id && Array.isArray(initialPlayers) && initialPlayers.length) {
    await vaultSlotsCreateInitialClaims(slot.id, clubId, initialPlayers, maxPlayers);
  }

  // Preserve creator metadata so notifications can stay quiet in management
  // workspaces. Do not mark the slot as seen here: the same account may switch
  // to Player and should then receive the player-side new-slot notification.
  if (slot && slot.id) {
    if (!slot.created_by && payload.created_by) slot.created_by = payload.created_by;
  }

  return slot;
}

/* Create and immediately post a normal slot when Round Manager starts directly.
   This deliberately reuses the existing slot creation + initial-claim flow. */
async function vaultSlotsCreatePostedFromRoundManager() {
  const club = (typeof getMyClub === 'function') ? getMyClub() : null;
  if (!club || !club.id) return null;

  const activeNames = (typeof schedulerState !== 'undefined' && Array.isArray(schedulerState.activeplayers))
    ? schedulerState.activeplayers.slice()
    : [];
  if (!activeNames.length) return null;

  // Preserve the registered player id when creating the parallel slot.
  // Round Manager stores its active selection as names, while slot_claims is
  // keyed by player_id.  Passing names only makes claim creation depend on a
  // second nickname lookup and can leave the posted slot with 0 players even
  // though the Round Manager session has the full roster.
  const allPlayers = (typeof schedulerState !== 'undefined' && Array.isArray(schedulerState.allPlayers))
    ? schedulerState.allPlayers
    : [];
  const playerByName = new Map(allPlayers.map(player => [
    String((player && player.name) || '').trim().toLowerCase(),
    player
  ]));
  const initialPlayers = activeNames.map(name => {
    const player = playerByName.get(String(name || '').trim().toLowerCase());
    return {
      playerId: player && (player.id || player.playerId || player.player_id) ? String(player.id || player.playerId || player.player_id) : '',
      name: String(name || '').trim()
    };
  });

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const slotDate = (typeof localDateStr === 'function')
    ? localDateStr()
    : `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const startTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const end = new Date(now.getTime() + (2 * 60 * 60 * 1000));
  const endTime = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
  const venue = String(club.name || club.club_name || 'Round Manager').trim() || 'Round Manager';
  const courtCount = Math.max(1, parseInt((typeof courts !== 'undefined' ? courts : 1), 10) || 1);
  const maxPlayers = Math.max(1, activeNames.length);

  return dbCreateSlot(
    club.id, slotDate, venue, startTime, endTime, maxPlayers,
    'all', 0, 'private', courtCount, 'round', initialPlayers,
    'posted', null, null
  );
}

function _vsSelectedPlayerName(player) {
  if (typeof player === 'string') return player.trim();
  return String(player && (player.displayName || player.name || player.nickname || '') || '').trim();
}

function _vsSelectedPlayerId(player) {
  if (!player || typeof player === 'string') return '';
  return String(player.playerId || player.player_id || player.id || '').trim();
}

function _vsAddMemberNameAlias(map, key, member) {
  key = String(key || '').trim().toLowerCase();
  if (key && member && member.player_id && !map[key]) map[key] = member;
}

function _vsBuildMemberLookup(members) {
  const byId = {};
  const byName = {};
  (members || []).forEach(m => {
    if (!m || !m.player_id) return;
    byId[String(m.player_id)] = m;
    _vsAddMemberNameAlias(byName, m.nickname, m);
    _vsAddMemberNameAlias(byName, m.players && m.players.name, m);
  });
  return { byId, byName };
}

async function vaultSlotsCreateInitialClaims(slotId, clubId, initialPlayers, maxPlayers) {
  const selectedPlayers = (initialPlayers || []).filter(p => _vsSelectedPlayerName(p) || _vsSelectedPlayerId(p));
  if (!slotId || !clubId || !selectedPlayers.length) return;

  const members = await sbGet('memberships', `club_id=eq.${clubId}&select=player_id,nickname,players(id,name)`).catch(() => []);
  const memberLookup = _vsBuildMemberLookup(members);

  const rows = [];
  const used = new Set();
  const now = Date.now();
  selectedPlayers.forEach((player, idx) => {
    const playerId = _vsSelectedPlayerId(player);
    const name = _vsSelectedPlayerName(player);
    const m = (playerId && memberLookup.byId[playerId]) || memberLookup.byName[name.toLowerCase()];
    if (!m || !m.player_id) return;
    const pid = String(m.player_id);
    if (used.has(pid)) return;
    used.add(pid);
    rows.push({
      slot_id: slotId,
      player_id: m.player_id,
      status: idx < maxPlayers ? 'confirmed' : 'waitlist',
      claimed_at: new Date(now + idx).toISOString()
    });
  });

  if (rows.length) await sbPost('slot_claims', rows);
  await vaultSlotsRebalanceClaims(slotId);
}

async function vaultSlotsRebalanceClaims(slotId) {
  if (!slotId || typeof sbGet !== 'function' || typeof sbPatch !== 'function') return;

  const slots = await sbGet('slots', `id=eq.${slotId}&select=id,max_players`).catch(() => []);
  if (!slots || !slots.length) return;
  const maxPlayers = Math.max(0, parseInt(slots[0].max_players || 0, 10));

  const claims = await sbGet('slot_claims',
    `slot_id=eq.${slotId}&status=in.(pending,confirmed,waitlist,late_cancelled)&select=id,status,claimed_at&order=claimed_at.asc,id.asc`
  ).catch(() => []);
  if (!claims || !claims.length) return;

  const ordered = _vsSortClaimsQueue((claims || []).filter(_vsIsQueuedClaim));
  const lateCancelled = _vsSortClaimsQueue((claims || []).filter(c => String(c.status || '').toLowerCase() === 'late_cancelled'));
  let lastQueueMs = 0;
  const patches = [];
  let confirmedCount = 0;
  for (let i = 0; i < ordered.length; i++) {
    const claim = ordered[i];
    // Pending requests reserve their exact queue position but remain pending
    // until the Slot Manager approves or rejects them.
    const nextStatus = claim.status === 'pending' ? 'pending' : (i < maxPlayers ? 'confirmed' : 'waitlist');
    const patch = {};
    if (claim.status !== nextStatus) patch.status = nextStatus;
    if (i < maxPlayers) confirmedCount++;

    let queueMs = _vsClaimQueueMs(claim);
    if (queueMs <= lastQueueMs) {
      queueMs = lastQueueMs + 1;
      patch.claimed_at = new Date(queueMs).toISOString();
    }
    lastQueueMs = queueMs;

    if (Object.keys(patch).length) patches.push(sbPatch('slot_claims', `id=eq.${claim.id}`, patch));
  }

  const coveredLateCancellations = Math.max(0, confirmedCount + lateCancelled.length - maxPlayers);
  if (coveredLateCancellations > 0) {
    lateCancelled.slice(0, coveredLateCancellations).forEach(claim => {
      if (claim && claim.id) patches.push(sbPatch('slot_claims', `id=eq.${claim.id}`, { status: 'cancelled' }));
    });
  }

  if (patches.length) await Promise.all(patches);
}

function vaultSlotsClaimsNeedRebalance(slot, claims) {
  const maxPlayers = Math.max(0, parseInt((slot && slot.max_players) || 0, 10));
  const queued = _vsSortClaimsQueue((claims || []).filter(_vsIsQueuedClaim));
  const lateCancelled = (claims || []).filter(c => String(c.status || '').toLowerCase() === 'late_cancelled').length;
  const misplaced = queued.some((claim, index) => {
    if (String(claim.status || '').toLowerCase() === 'pending') return false;
    return claim.status !== (index < maxPlayers ? 'confirmed' : 'waitlist');
  });
  return misplaced || (Math.min(maxPlayers, queued.length) + lateCancelled > maxPlayers);
}

function _vsClaimQueueMs(claim) {
  const ms = Date.parse((claim && claim.claimed_at) || '');
  return Number.isFinite(ms) ? ms : 0;
}

function _vsSortClaimsQueue(claims) {
  return (claims || []).slice().sort((a, b) => {
    const at = _vsClaimQueueMs(a);
    const bt = _vsClaimQueueMs(b);
    if (at !== bt) return at - bt;
    return String((a && a.id) || '').localeCompare(String((b && b.id) || ''));
  });
}

async function vaultSlotsAttachClaims(slots, claims) {
  slots = slots || [];
  claims = claims || [];
  if (!slots.length) return [];

  const slotClubById = {};
  (slots || []).forEach(slot => {
    slotClubById[String(slot.id)] = String(slot.club_id || slot._viewerClubId || '');
  });

  const claimsByClub = {};
  (claims || []).forEach(claim => {
    const cid = slotClubById[String(claim.slot_id)] || '';
    (claimsByClub[cid] = claimsByClub[cid] || []).push(claim);
  });

  const playerMetaByClub = {};
  for (const cid of Object.keys(claimsByClub)) {
    playerMetaByClub[cid] = await _vsBuildClaimPlayerMeta(claimsByClub[cid], cid || null);
  }

  const claimsBySlot = {};
  (claims || []).forEach(claim => {
    (claimsBySlot[String(claim.slot_id)] = claimsBySlot[String(claim.slot_id)] || []).push(claim);
  });

  if (!Object.keys(playerMetaByClub).length) {
    Object.keys(claimsByClub).forEach(cid => { playerMetaByClub[cid] = {}; });
  }

  return slots.map(slot => {
    const cid = String(slot.club_id || slot._viewerClubId || '');
    const meta = playerMetaByClub[cid] || {};
    const slotClaims = _vsSortClaimsQueue(claimsBySlot[String(slot.id)] || [])
      .map(c => ({ ...c, player: meta[String(c.player_id)] || null }));
    return {
      ...slot,
      // Pending requests occupy queue places, so capacity and waiting counts
      // match the order in which people joined.
      confirmedCount: Math.min(Math.max(0, parseInt(slot.max_players || 0, 10)), slotClaims.filter(_vsIsQueuedClaim).length),
      waitlistCount: Math.max(0, slotClaims.filter(_vsIsQueuedClaim).length - Math.max(0, parseInt(slot.max_players || 0, 10))),
      claims: slotClaims
    };
  });
}


/* ── Automatic slot/session expiry cleanup ─────────────────────────────
   1) A posted/scheduled slot that reaches its end time without starting
      is marked cancelled.
   2) A linked live session still open one hour after the slot end time is
      marked completed.
   This is intentionally idempotent and throttled, so any open SCS client can
   safely keep the database tidy without repeatedly writing the same rows. */
var _vsExpiryCleanupLastRun = 0;
var _vsExpiryCleanupPromise = null;

function _vsSlotLocalDateTime(slotDate, timeValue) {
  var dateParts = String(slotDate || '').split('-').map(Number);
  var timeParts = String(timeValue || '00:00').split(':').map(Number);
  if (dateParts.length < 3 || !dateParts[0] || !dateParts[1] || !dateParts[2]) return null;
  var value = new Date(
    dateParts[0], dateParts[1] - 1, dateParts[2],
    timeParts[0] || 0, timeParts[1] || 0, timeParts[2] || 0, 0
  );
  return Number.isNaN(value.getTime()) ? null : value;
}

async function vaultSlotsCleanupExpired(force) {
  if (typeof sbGet !== 'function' || typeof sbPatch !== 'function') return;
  var nowMs = Date.now();
  if (!force && _vsExpiryCleanupPromise) return _vsExpiryCleanupPromise;
  if (!force && nowMs - _vsExpiryCleanupLastRun < 60000) return;
  _vsExpiryCleanupLastRun = nowMs;

  _vsExpiryCleanupPromise = (async function() {
    var today = _vsTodayStr();
    var rows = await sbGet('slots',
      'slot_date=lte.' + today +
      '&status=in.(posted,scheduled,played)' +
      '&select=id,club_id,slot_date,start_time,end_time,status,played_session_id'
    ).catch(function(){ return []; });
    if (!rows || !rows.length) return;

    var now = Date.now();
    var sessionIds = [];
    var sessionSlotMap = {};
    var jobs = [];

    rows.forEach(function(slot) {
      if (!slot || !slot.id) return;
      var endAt = _vsSlotLocalDateTime(slot.slot_date, slot.end_time || slot.start_time);
      if (!endAt) return;
      var status = String(slot.status || '').toLowerCase();
      var sessionId = slot.played_session_id ? String(slot.played_session_id) : '';

      // Never started by the scheduled end time.
      if (!sessionId && (status === 'posted' || status === 'scheduled') && now >= endAt.getTime()) {
        jobs.push(sbPatch('slots', 'id=eq.' + slot.id, { status: 'cancelled' }).catch(function(){ return null; }));
        return;
      }

      // Started, but still not explicitly finished one hour after slot end.
      if (sessionId && status === 'played' && now >= endAt.getTime() + 60 * 60 * 1000) {
        sessionIds.push(sessionId);
        sessionSlotMap[sessionId] = slot;
      }
    });

    if (sessionIds.length) {
      var uniqueIds = Array.from(new Set(sessionIds));
      var sessions = await sbGet('sessions',
        'id=in.(' + uniqueIds.join(',') + ')&status=eq.live&select=id,club_id,status'
      ).catch(function(){ return []; });
      (sessions || []).forEach(function(session) {
        if (!session || !session.id) return;
        jobs.push(sbPatch('sessions', 'id=eq.' + session.id, {
          status: 'completed',
          updated_at: new Date().toISOString()
        }).catch(function(){ return null; }));
        var clubId = session.club_id || (sessionSlotMap[String(session.id)] || {}).club_id;
        if (clubId) {
          jobs.push(sbPatch('memberships',
            'club_id=eq.' + clubId + '&is_playing=eq.true',
            { is_playing: false }
          ).catch(function(){ return null; }));
        }
      });
    }

    if (jobs.length) await Promise.all(jobs);
  })().finally(function() {
    _vsExpiryCleanupPromise = null;
  });

  return _vsExpiryCleanupPromise;
}

async function vaultSlotsLoadRange(opts) {
  opts = opts || {};
  await vaultSlotsCleanupExpired(false).catch(function(){});
  if (typeof sbGet !== 'function') return [];

  const startDateStr = opts.startDateStr;
  const endDateStr = opts.endDateStr;
  const clubId = opts.clubId ? String(opts.clubId) : '';
  const includeAllClubs = !!opts.includeAllClubs;
  if (!startDateStr || !endDateStr) return [];

  let query = `slot_date=gte.${startDateStr}&slot_date=lte.${endDateStr}`;
  if (!includeAllClubs && clubId) query = `club_id=eq.${clubId}&` + query;
  query += `&select=id,club_id,slot_date,venue,venue_id,start_time,end_time,max_players,court_count,session_mode,created_by,created_at,posted_at,status,gender_filter,min_rating,visibility,played_session_id,scheduled_post_at,join_probability_requested_at,join_probability_reminder_at&order=slot_date.asc,start_time.asc`;

  let slots = await sbGet('slots', query).catch(() => null);
  if (slots === null) {
    query = query.replace(',posted_at', '');
    query = query.replace(',scheduled_post_at', '');
    query = query.replace(',venue_id', '');
    slots = await sbGet('slots', query).catch(() => []);
  }
  if (!slots || !slots.length) return [];
  await _vsPublishDueScheduledSlots(slots);
  if (typeof vaultVenuesLoad === 'function') await vaultVenuesLoad(false).catch(function(){});

  const sessionIds = [...new Set((slots || [])
    .map(s => s && s.played_session_id)
    .filter(Boolean)
    .map(String))];
  const sessionsById = {};
  if (sessionIds.length) {
    const sessions = await sbGet('sessions',
      `id=in.(${sessionIds.join(',')})&select=id,status,shuttle_data`
    ).catch(() => []);
    (sessions || []).forEach(sess => { if (sess && sess.id) sessionsById[String(sess.id)] = sess; });
  }

  const clubIds = [...new Set((slots || []).map(s => String(s.club_id || '')).filter(Boolean))];
  const clubMap = {};
  if (clubIds.length) {
    const clubs = await sbGet('clubs', `id=in.(${clubIds.join(',')})&select=id,name`).catch(() => []);
    (clubs || []).forEach(c => { clubMap[String(c.id)] = c; });
  }

  const slotIds = slots.map(s => s.id).filter(Boolean);
  let claims = [];
  if (slotIds.length) {
    claims = await _vsFetchSlotClaims(`slot_id=in.(${slotIds.join(',')})&status=in.(pending,confirmed,waitlist,late_cancelled)`);
  }

  let changed = false;
  for (const slot of slots) {
    const slotClaims = (claims || []).filter(c => String(c.slot_id) === String(slot.id));
    if (vaultSlotsClaimsNeedRebalance(slot, slotClaims)) {
      await vaultSlotsRebalanceClaims(slot.id);
      changed = true;
    }
  }
  if (changed && slotIds.length) {
    claims = await _vsFetchSlotClaims(`slot_id=in.(${slotIds.join(',')})&status=in.(pending,confirmed,waitlist,late_cancelled)`);
  }

  const decorated = slots.map((s, idx) => {
    const club = clubMap[String(s.club_id)] || { id: s.club_id, name: 'Club' };
    return {
      ...s,
      _session: sessionsById[String(s.played_session_id || '')] || null,
      _viewerClubId: String(s.club_id || ''),
      _viewerClubName: club.name || 'Club',
      _viewerClubColor: typeof _mcsClubColor === 'function' ? _mcsClubColor(idx) : '#4a9eff'
    };
  });

  return vaultSlotsAttachClaims(decorated, claims);
}

async function vaultSlotsLoadOne(slotId) {
  await vaultSlotsCleanupExpired(false).catch(function(){});
  if (!slotId || typeof sbGet !== 'function') return null;
  let rows = await sbGet('slots',
    `id=eq.${slotId}&select=id,club_id,slot_date,venue,venue_id,start_time,end_time,max_players,court_count,session_mode,created_by,created_at,posted_at,status,gender_filter,min_rating,visibility,played_session_id,scheduled_post_at,join_probability_requested_at,join_probability_reminder_at`
  ).catch(() => null);
  if (rows === null) {
    rows = await sbGet('slots',
      `id=eq.${slotId}&select=id,club_id,slot_date,venue,start_time,end_time,max_players,court_count,session_mode,created_by,created_at,status,gender_filter,min_rating,visibility,played_session_id`
    ).catch(() => []);
  }
  if (!rows || !rows.length) return null;
  await _vsPublishDueScheduledSlots(rows);
  if (typeof vaultVenuesLoad === 'function') await vaultVenuesLoad(false).catch(function(){});
  const slot = rows[0];
  let claims = await _vsFetchSlotClaims(`slot_id=eq.${slotId}&status=in.(pending,confirmed,waitlist,late_cancelled)`);
  if (vaultSlotsClaimsNeedRebalance(slot, claims)) {
    await vaultSlotsRebalanceClaims(slotId);
    claims = await _vsFetchSlotClaims(`slot_id=eq.${slotId}&status=in.(pending,confirmed,waitlist,late_cancelled)`);
  }
  if (slot.played_session_id) {
    const sessions = await sbGet('sessions',
      `id=eq.${slot.played_session_id}&select=id,status,shuttle_data`
    ).catch(() => []);
    slot._session = sessions && sessions.length ? sessions[0] : null;
  }
  const withClaims = await vaultSlotsAttachClaims([slot], claims);
  return withClaims[0] || null;
}

/* ── DB: delete a slot (and its claims) ── */
async function dbDeleteSlot(slotId) {
  if (!slotId) return;
  await sbPatch('sessions', `source_slot_id=eq.${slotId}`, { source_slot_id: null }).catch(() => {});
  await sbPatch('slots', `id=eq.${slotId}`, { played_session_id: null }).catch(() => {});
  await sbDelete('slot_claims', `slot_id=eq.${slotId}`);
  await sbDelete('slots', `id=eq.${slotId}`);
}

/* ══════════════════════════════════════════════
   DATE HELPERS (local time, matches localDateStr style)
══════════════════════════════════════════════ */
function _vsDateStr(y, m, d) {
  const date = new Date(y, m, d);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function _vsTodayStr() {
  return (typeof localDateStr === 'function') ? localDateStr() : _vsDateStr(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
}
function _vsAppLocale() {
  var code = (typeof currentLang !== 'undefined' ? currentLang : 'en');
  return ({ en:'en-US', jp:'ja-JP', kr:'ko-KR', vi:'vi-VN', zh:'zh-CN' })[code] || 'en-US';
}
function _vsMonthLabel(y, m) {
  return new Date(y, m, 1).toLocaleString(_vsAppLocale(), { month: 'long', year: 'numeric' });
}

function _vsUpcomingDateText(count) {
  if (!count) return t('noUpcomingSlots') || 'No upcoming slots';
  return count + ' ' + (t('upcomingDates') || 'upcoming dates');
}

function _vsWeekdayLabels() {
  var code = (typeof currentLang !== 'undefined' ? currentLang : 'en');
  return ({
    en:['Su','Mo','Tu','We','Th','Fr','Sa'],
    jp:['日','月','火','水','木','金','土'],
    kr:['일','월','화','수','목','금','토'],
    vi:['CN','T2','T3','T4','T5','T6','T7'],
    zh:['日','一','二','三','四','五','六']
  })[code] || ['Su','Mo','Tu','We','Th','Fr','Sa'];
}

function _vsRenderWeekdayLabels(section) {
  if (!section) return;
  var row = section.querySelector('.mc-slots-weekdays');
  if (row) row.innerHTML = _vsWeekdayLabels().map(function(d){ return '<div>' + d + '</div>'; }).join('');
}

function _vsSlotGenderKey(slot) {
  var g = String((slot && slot.gender_filter) || 'all').toLowerCase();
  if (g === 'male' || g === 'men' || g === 'm') return 'men';
  if (g === 'female' || g === 'women' || g === 'f') return 'women';
  return 'all';
}

function _vsDateGenderClass(daySlots) {
  daySlots = daySlots || [];
  if (!daySlots.length) return '';
  if (daySlots.some(function(s){ return _vsSlotGenderKey(s) === 'men'; })) return 'vs-cal-men';
  if (daySlots.some(function(s){ return _vsSlotGenderKey(s) === 'women'; })) return 'vs-cal-women';
  return 'vs-cal-all';
}

function _vsSlotGenderLabel(slot) {
  var key = _vsSlotGenderKey(slot);
  if (key === 'men') return t('male') || 'Men';
  if (key === 'women') return t('female') || 'Women';
  return t('both') || 'All';
}

function _vsSlotFillPercent(slot) {
  var max = Number(slot && slot.max_players || 0);
  if (!max) return 0;
  return Math.max(0, Math.min(100, Math.round((Number(slot.confirmedCount || 0) / max) * 100)));
}

function _vsSlotFillColor(slot) {
  var pct = _vsSlotFillPercent(slot);
  if (pct >= 100) return '#ef4444';
  if (pct >= 70) return '#f59e0b';
  if (pct > 0) return '#2dce89';
  return '#4a9eff';
}

/* ══════════════════════════════════════════════
   FULL MONTH CALENDAR — inside the Vault home tile
   Shows the current month at a glance (read-only — tapping
   the tile navigates to the full Slots page as before;
   individual dates are not clickable from the tile itself).
══════════════════════════════════════════════ */
async function vaultSlotsRenderMiniTile(clubId) {
  const labelEl = document.getElementById('vtSlotsCalMonthLabel');
  const gridEl  = document.getElementById('vtSlotsCalGrid');
  if (!gridEl) return;

  const today = new Date();
  const year  = today.getFullYear();
  const month = today.getMonth(); // 0-11
  if (labelEl) labelEl.textContent = _vsMonthLabel(year, month);

  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth   = new Date(year, month + 1, 0);
  const startWeekday  = firstOfMonth.getDay(); // 0=Sun
  const daysInMonth   = lastOfMonth.getDate();
  const todayStr = _vsTodayStr();

  const rangeStart = _vsDateStr(year, month, 1);
  const rangeEnd    = _vsDateStr(year, month, daysInMonth);

  let byDate = {};
  try {
    const slots = await dbGetSlotsForRange(clubId, rangeStart, rangeEnd);
    slots.forEach(s => { (byDate[s.slot_date] = byDate[s.slot_date] || []).push(s); });
  } catch (e) { /* fail quiet on tile — show blank dots */ }

  let html = '';
  for (let i = 0; i < startWeekday; i++) {
    html += '<div class="vt-slots-cal-day vt-slots-cal-empty"></div>';
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dStr = _vsDateStr(year, month, d);
    const isToday = dStr === todayStr;
    const isPast  = dStr < todayStr;
    const daySlots = byDate[dStr] || [];

    let dotHtml = '';
    if (daySlots.length) {
      const dotClass = isPast ? 'vs-dot-completed' : 'vs-dot-upcoming';
      dotHtml = '<i class="vt-slots-cal-dot ' + dotClass + '"></i>';
    }

    html += '<div class="vt-slots-cal-day' + (isToday ? ' vt-slots-cal-today' : '') + (isPast ? ' vt-slots-cal-past' : '') + '">' +
              d + dotHtml +
            '</div>';
  }
  gridEl.innerHTML = html;

  // Summary sub-text: count upcoming slots in the next 30 days
  const summaryEl = document.getElementById('vtSlotsSummary');
  if (summaryEl) {
    try {
      const future = new Date(today);
      future.setDate(today.getDate() + 30);
      const futureStr = _vsDateStr(future.getFullYear(), future.getMonth(), future.getDate());
      const upcoming = await dbGetSlotsForRange(clubId, todayStr, futureStr);
      summaryEl.textContent = upcoming.length
        ? upcoming.length + ' ' + (t('upcomingSlots') || 'upcoming slot(s)')
        : (t('postAndManageSlots') || 'Post and manage open play slots');
    } catch (e) {
      summaryEl.textContent = t('postAndManageSlots') || 'Post and manage open play slots';
    }
  }
}

/* ══════════════════════════════════════════════
   FULL CALENDAR PAGE
══════════════════════════════════════════════ */
async function vaultSlotsOpenPage() {
  const today = new Date();
  if (_vsCalYear === null) { _vsCalYear = today.getFullYear(); _vsCalMonth = today.getMonth(); }
  await vaultSlotsRenderMonth();
}

async function vaultSlotsChangeMonth(delta) {
  _vsCalMonth += delta;
  if (_vsCalMonth < 0)  { _vsCalMonth = 11; _vsCalYear--; }
  if (_vsCalMonth > 11) { _vsCalMonth = 0;  _vsCalYear++; }
  await vaultSlotsRenderMonth();
}

async function vaultSlotsRenderMonth() {
  const labelEl = document.getElementById('vsCalMonthLabel');
  const gridEl  = document.getElementById('vsCalGrid');
  if (!gridEl) return;

  if (labelEl) labelEl.textContent = _vsMonthLabel(_vsCalYear, _vsCalMonth);

  const club = (typeof getMyClub === 'function') ? getMyClub() : null;
  const firstOfMonth = new Date(_vsCalYear, _vsCalMonth, 1);
  const lastOfMonth  = new Date(_vsCalYear, _vsCalMonth + 1, 0);
  const startWeekday = firstOfMonth.getDay(); // 0=Sun
  const daysInMonth   = lastOfMonth.getDate();
  const todayStr = _vsTodayStr();

  const rangeStart = _vsDateStr(_vsCalYear, _vsCalMonth, 1);
  const rangeEnd    = _vsDateStr(_vsCalYear, _vsCalMonth, daysInMonth);

  _vsSlotsByDate = {};
  if (club && club.id) {
    try {
      const slots = await dbGetSlotsForRange(club.id, rangeStart, rangeEnd);
      slots
        .filter(s => typeof _vhsIsVisibleVaultSlot === 'function' ? _vhsIsVisibleVaultSlot(s) : !s.played_session_id)
        .forEach(s => { (_vsSlotsByDate[s.slot_date] = _vsSlotsByDate[s.slot_date] || []).push(s); });
    } catch (e) { /* show empty calendar on failure */ }
  }

  let html = '';
  for (let i = 0; i < startWeekday; i++) {
    html += '<div class="vs-cal-day vs-cal-empty"></div>';
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dStr = _vsDateStr(_vsCalYear, _vsCalMonth, d);
    const isToday = dStr === todayStr;
    const isPast  = dStr < todayStr;
    const daySlots = _vsSlotsByDate[dStr] || [];

    const statusClass = _vsDateGenderClass(daySlots);

    html += '<div class="vs-cal-day' + (statusClass ? ' ' + statusClass : '') + (isToday ? ' vs-cal-today' : '') + (isPast ? ' vs-cal-past' : '') + '" ' +
            'onclick="vaultSlotsOpenDateSheet(\'' + dStr + '\')">' +
              '<span class="vs-cal-num">' + d + '</span>' +
            '</div>';
  }
  gridEl.innerHTML = html;
}

/* ══════════════════════════════════════════════
   DATE DETAIL BOTTOM SHEET
   - existing slots -> list with claim counts + manage actions
   - no slots + date >= today -> post-new-slot form
   - no slots + date < today -> simple empty state
══════════════════════════════════════════════ */
function vaultSlotsOpenDateSheet(dateStr) {
  _vsSelectedDateStr = dateStr;
  const overlay = document.getElementById('vsDateSheetOverlay');
  const titleEl = document.getElementById('vsDateSheetTitle');
  const contentEl = document.getElementById('vsDateSheetContent');
  if (!overlay || !contentEl) return;

  // Vault home now uses the Viewer-style calendar. The original bottom-sheet
  // markup lives inside #vaultSlotsPage, which is hidden when the user is on
  // the Vault home page. If we only set overlay.display = flex, the sheet stays
  // invisible because its parent page has display:none. Move the reusable sheet
  // overlay to <body> once, so both the old Slots page and the Vault home
  // calendar can open the same create/manage sheet.
  if (overlay.parentElement && overlay.parentElement.id === 'vaultSlotsPage') {
    document.body.appendChild(overlay);
  }

  const d = new Date(dateStr + 'T00:00:00');
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (titleEl) titleEl.textContent = dayNames[d.getDay()] + ', ' + monthNames[d.getMonth()] + ' ' + d.getDate();

  const todayStr = _vsTodayStr();
  const isPast = dateStr < todayStr;
  const daySlots = _vsSlotsByDate[dateStr] || [];

  let html = '';

  if (daySlots.length) {
    daySlots.forEach(s => {
      const isFull = s.confirmedCount >= s.max_players;
      const slotStatus = String(s.status || 'draft').toLowerCase();
      const isDraft = slotStatus === 'draft';
      const isScheduled = slotStatus === 'scheduled';
      const isCancelled = slotStatus === 'cancelled';
      const isPlayed = _mcsIsPlayedSlot(s);
      const statusClass = isCancelled ? 'vs-status-cancelled' : (isPlayed ? 'vs-status-played' : (isScheduled ? 'vs-status-scheduled' : (isDraft ? 'vs-status-draft' : 'vs-status-posted')));
      const statusLabel = isCancelled ? (t('cancelled') || 'Cancelled') : (isPlayed ? (t('slotPlayed') || 'Played') : (isScheduled ? (t('scheduled') || 'Scheduled') : (isDraft ? (t('draft') || 'Draft') : (t('posted') || 'Posted'))));
      var genderClass = _vsDateGenderClass([s]);
      var clubForSlot = (typeof _mcsClubForSlot === 'function') ? _mcsClubForSlot(s) : { name: 'Club' };
      html += '<div class="vs-slot-card' + (genderClass ? ' ' + genderClass : '') + '">' +
                '<div class="mc-slot-titlebar"><span>' + _vsEscape(clubForSlot.name || 'Club') + '</span><strong>' + _vsEscape(_vsSlotGenderLabel(s)) + '</strong></div>' +
                '<div class="vs-slot-card-body">' +
                  '<div class="vs-slot-card-top">' +
                    '<div>' +
                      '<div class="vs-slot-venue">' + _vsEscape(_vsSlotVisibilityLabel(s)) +
                        ' <span class="vs-status-badge ' + statusClass + '">' + statusLabel + '</span>' +
                      '</div>' +
                      '<div class="vs-slot-time">' + _vsEscape(_mcsFormatDateTitle(s.slot_date)) + ' · ' + _vsFormatTime(s.start_time) + ' – ' + _vsFormatTime(s.end_time) + '</div>' +
                      _vsSlotVenueHtml(s) +
                      _vsSessionMetaHtml(s) +
                    '</div>' +
                    '<div class="vs-slot-count ' + (isFull ? 'vs-count-full' : 'vs-count-open') + '">' +
                      s.confirmedCount + '/' + s.max_players +
                      (s.waitlistCount ? ' · ' + s.waitlistCount + ' waiting' : '') +
                    '</div>' +
                  '</div>' +
                  '<div class="vs-slot-actions">' +
                    ((isDraft || isScheduled) ? '<button class="vs-btn vs-btn-post" onclick="vaultSlotsViewSlot(\'' + s.id + '\')">' + (t('post') || 'Post') + '</button>' : '') +
                    '<button class="vs-btn vs-btn-primary" onclick="vaultSlotsViewSlot(\'' + s.id + '\')">' + (t('manage') || 'Manage') + '</button>' +
                    '<button class="vs-btn vs-btn-danger" onclick="vaultSlotsDeleteSlot(\'' + s.id + '\')">' + (t('delete') || 'Delete') + '</button>' +
                  '</div>' +
                '</div>' +
              '</div>';
    });

    if (!isPast) {
      html += '<button class="vs-btn vs-btn-secondary" style="width:100%;margin-top:4px;" onclick="vaultSlotsShowPostForm()">+ ' + (t('addAnotherSlot') || 'Add another slot') + '</button>';
    }

  } else if (isPast) {
    html = '<div style="text-align:center;color:var(--muted);padding:24px 0;">' + (t('noSlotsThisDate') || 'No slots were posted on this date.') + '</div>';

  } else {
    html = _vsPostFormHtml();
  }

  contentEl.innerHTML = html;
  overlay.style.display = 'flex';
}


function _vsCreateSectionsComplete() {
  var venue = document.getElementById('vsFormVenue');
  var start = document.getElementById('vsFormStart');
  var end = document.getElementById('vsFormEnd');
  var sessionComplete = !!(venue && String(venue.value || '').trim() && start && end && _vsTimeMinutes(end.value) > _vsTimeMinutes(start.value));
  var playersComplete = !!(_vsInitialPlayers && _vsInitialPlayers.length);
  // Adding players before posting is optional. Players can join after the slot is posted.
  return { session: sessionComplete, players: playersComplete, post: sessionComplete };
}

function vaultSlotsRefreshCreateTabs() {
  var form = document.querySelector('#vsDateSheetContent .vs-post-sample-layout');
  if (!form) return;
  var state = _vsCreateSectionsComplete();
  var post = form.querySelector('.vs-create-tab-post');
  if (post) {
    post.disabled = !state.post;
    post.classList.toggle('is-locked', !state.post);
    post.setAttribute('aria-disabled', state.post ? 'false' : 'true');
  }
}

function vaultSlotsSetCreateTab(tab) {
  var form = document.querySelector('#vsDateSheetContent .vs-post-sample-layout');
  if (!form) return;
  vaultSlotsRefreshCreateTabs();
  if (tab === 'post' && !_vsCreateSectionsComplete().post) return;
  var tabs = form.querySelectorAll('.vs-create-tab');
  var panels = form.querySelectorAll('.vs-create-tab-panel');
  tabs.forEach(function(btn){ btn.classList.toggle('is-active', btn.getAttribute('data-tab') === tab); });
  panels.forEach(function(panel){ panel.classList.toggle('is-active', panel.getAttribute('data-panel') === tab); });
  var scroll = document.getElementById('vsDateSheetContent');
  if (scroll) scroll.scrollTop = 0;
}

function vaultSlotsShowPostForm() {
  const contentEl = document.getElementById('vsDateSheetContent');
  if (contentEl) contentEl.innerHTML = _vsPostFormHtml();
}

function _vsPostFormHtml() {
  _vsFormGenderChoice = 'all';
  _vsFormRatingChoice = '0';
  _vsFormVisibilityChoice = 'private';
  _vsFormSessionModeChoice = 'standard';
  _vsInitialPlayers = [];

  const tpl = document.getElementById('vsPostFormTemplate');
  let html = tpl ? tpl.innerHTML : '';
  if (!html) {
    html = '<div class="vs-post-form-compact"><div class="vs-form-feedback">Slot form template missing.</div></div>';
  }
  html = html.replace(/__SLOT_DATE__/g, _vsSelectedDateStr ? _vsEscape(_vsSelectedDateStr) : 'New Slot');
  html = html.replace(/__INITIAL_PLAYERS__/g, _vsInitialPlayersHtml());
  html = html.replace(/__SCHEDULE_VALUE__/g, _vsScheduledPostInputValue(null));
  const defaultTimes = _vsDefaultSlotTimes();
  html = html.replace(/__START_TIME__/g, defaultTimes.start);
  html = html.replace(/__END_TIME__/g, defaultTimes.end);
  html = html.replace(/__START_LABEL__/g, _vsFormatTime(defaultTimes.start));
  html = html.replace(/__END_LABEL__/g, _vsFormatTime(defaultTimes.end));
  setTimeout(function(){ _vsInitSegThumbs(); if (typeof vaultSlotsPopulateVenueSelect === 'function') vaultSlotsPopulateVenueSelect(); vaultSlotsRefreshCreateTabs(); }, 0);
  return html;
}

var _vsInitialPlayers = [];

function _vsInitialPlayerGenderIcon(player) {
  var gender = String((player && player.gender) || '').toLowerCase();
  var img = gender === 'female' ? 'female.png' : 'male.png';
  var alt = gender === 'female' ? 'Female' : 'Male';
  return '<span class="mc-slot-avatar mc-slot-gender-avatar vs-initial-gender"><img src="' + img + '" class="gender-icon mc-slot-gender-img" alt="' + alt + '"></span>';
}

function _vsInitialPlayerRatingText(player) {
  var raw = player && (player.rating ?? player.clubRating ?? player.activeRating ?? player.global_rating);
  var n = Number(raw);
  return Number.isFinite(n) ? n.toFixed(1) : '1.0';
}

function _vsInitialPlayersHtml() {
  if (!_vsInitialPlayers || !_vsInitialPlayers.length) {
    return '<div class="vs-form-hint">' + (t('addPlayersBeforePostingHint') || 'Optional: add confirmed players before posting.') + '</div>';
  }
  return '<div class="vs-initial-count">👥 ' + _vsInitialPlayers.length + ' ' + (t('players') || 'Players') + '</div>' +
    '<div class="vs-initial-player-list">' +
      _vsInitialPlayers.map(function(p, i) {
        var name = _vsEscape((p && (p.displayName || p.name || p.nickname)) || 'Player');
        var rating = _vsEscape(_vsInitialPlayerRatingText(p));
        return '<div class="mc-slot-player-row is-confirmed vs-initial-player-row">' +
          '<div class="mc-slot-player-left">' + _vsInitialPlayerGenderIcon(p) + '<span class="mc-slot-player-name">' + name + '</span></div>' +
          '<span class="mc-slot-rating-badge">' + rating + '</span>' +
          '<button type="button" class="vs-remove-mini" onclick="vaultSlotsRemoveInitialPlayer(' + i + ')">×</button>' +
        '</div>';
      }).join('') +
    '</div>';
}

function vaultSlotsRefreshInitialPlayersBox() {
  var box = document.getElementById('vsInitialPlayersBox');
  if (box) box.innerHTML = _vsInitialPlayersHtml();
  vaultSlotsRefreshCreateTabs();
}

function vaultSlotsRemoveInitialPlayer(index) {
  _vsInitialPlayers.splice(index, 1);
  vaultSlotsRefreshInitialPlayersBox();
}

function vaultSlotsAddPlayersBeforePosting() {
  window._vsAddPlayersTargetSlotId = null;
  window._newImportReturnMode = 'vaultSlot';
  if (typeof newImportShowModal !== 'function') {
    alert('Add Players screen is not available.');
    return;
  }
  newImportShowModal();
  var modal = document.getElementById('newImportModal');
  if (modal) {
    modal.dataset.returnMode = 'vaultSlot';
    delete modal.dataset.targetSlotId;
  }
  setTimeout(function() {
    if (typeof newImportState !== 'undefined') {
      newImportState.slotUnavailablePlayers = new Set();
      newImportState.selectedPlayers = (_vsInitialPlayers || []).map(function(p) {
        return { displayName: p.displayName || p.name, gender: p.gender || 'Male', rating: p.rating || 1.0 };
      });
      if (typeof newImportRefreshSelectedCards === 'function') newImportRefreshSelectedCards();
      if (typeof addPlayersShowTab === 'function') addPlayersShowTab('browse');
    }
    var addBtn = document.getElementById('newImportAddBtn');
    if (addBtn) addBtn.textContent = t('done') || 'Done';
  }, 80);
}

function vaultSlotsAddPlayersToManage(slotId) {
  window._vsAddPlayersTargetSlotId = slotId;
  window._newImportReturnMode = 'vaultSlot';
  if (typeof newImportShowModal !== 'function') {
    alert('Add Players screen is not available.');
    return;
  }

  // The import modal already exists near the end of index.html. The manage sheet
  // is appended later with the same z-index, so the import modal was opening
  // behind it. Put import modal above the manage sheet and keep the sheet alive
  // underneath so users return to the refreshed manage screen after Done.
  newImportShowModal();
  var modal = document.getElementById('newImportModal');
  if (modal) {
    modal.classList.add('vs-import-over-manage');
    modal.style.zIndex = '30000';
    modal.dataset.returnMode = 'vaultSlot';
    modal.dataset.targetSlotId = slotId;
  }

  setTimeout(function() {
    if (typeof newImportState !== 'undefined') {
      newImportState.selectedPlayers = [];
      newImportState.slotUnavailablePlayers = new Set(
        (window._vsManageSlotSelectedPlayers || [])
          .map(function(p) { return String(p.displayName || p.name || '').trim().toLowerCase(); })
          .filter(Boolean)
      );
      if (typeof newImportRefreshSelectCards === 'function') newImportRefreshSelectCards();
      if (typeof newImportRefreshSelectedCards === 'function') newImportRefreshSelectedCards();
      if (typeof addPlayersShowTab === 'function') addPlayersShowTab('browse');
    }
    var addBtn = document.getElementById('newImportAddBtn');
    if (addBtn) addBtn.textContent = t('done') || 'Done';
  }, 80);
}

async function vaultSlotsReceiveImportedPlayers(players) {
  var modal = document.getElementById('newImportModal');
  var targetSlotId = window._vsAddPlayersTargetSlotId || (modal && modal.dataset ? modal.dataset.targetSlotId : '');
  if (targetSlotId) {
    window._vsAddPlayersTargetSlotId = null;
    if (modal) {
      modal.classList.remove('vs-import-over-manage');
      modal.style.zIndex = '';
      modal.style.display = 'none';
      delete modal.dataset.returnMode;
      delete modal.dataset.targetSlotId;
    }
    try {
      if (_vsManageDraft && String(_vsManageDraft.slotId) === String(targetSlotId)) {
        vaultSlotsDraftAddPlayers(targetSlotId, players || []);
        if (typeof newImportState !== 'undefined') {
          newImportState.selectedPlayers = [];
          newImportState.slotUnavailablePlayers = new Set();
        }
        return;
      }
      await vaultSlotsAddPlayersToExistingSlot(targetSlotId, players || []);
      await vaultSlotsViewSlot(targetSlotId);
      vaultSlotsScheduleSoftRefresh(targetSlotId);
    } catch(e) {
      alert('Failed to add players: ' + (e.message || e));
    }
    return;
  }

  if (modal) {
    modal.classList.remove('vs-import-over-manage');
    modal.style.zIndex = '';
    modal.style.display = 'none';
    if (modal.dataset) {
      delete modal.dataset.returnMode;
      delete modal.dataset.targetSlotId;
    }
  }
  _vsInitialPlayers = (players || []).map(function(p) {
    return { displayName: p.displayName || p.name, gender: p.gender || 'Male', rating: p.rating || 1.0 };
  });
  vaultSlotsRefreshInitialPlayersBox();
  if (typeof newImportState !== 'undefined') {
    newImportState.selectedPlayers = [];
    newImportState.slotUnavailablePlayers = new Set();
  }
}

async function vaultSlotsAddPlayersToExistingSlot(slotId, players) {
  const club = (typeof getMyClub === 'function') ? getMyClub() : null;
  if (!club || !club.id) throw new Error('Club not found');

  const selectedPlayers = (players || []).filter(p => _vsSelectedPlayerName(p) || _vsSelectedPlayerId(p));
  if (!slotId || !selectedPlayers.length) return;

  const slot = await vaultSlotsLoadOne(slotId);
  if (!slot) throw new Error('Slot not found');
  const maxPlayers = parseInt(slot.max_players || 8, 10);

  const existingClaims = slot.claims || [];
  const existingIds = new Set((existingClaims || []).map(c => String(c.player_id)));
  let confirmedCount = (existingClaims || []).filter(c => c.status === 'confirmed').length;

  const members = await sbGet('memberships', `club_id=eq.${club.id}&select=player_id,nickname,players(id,name)`).catch(() => []);
  const memberLookup = _vsBuildMemberLookup(members);

  const candidates = [];
  const picked = new Set();
  selectedPlayers.forEach((player, idx) => {
    const playerId = _vsSelectedPlayerId(player);
    const name = _vsSelectedPlayerName(player);
    const m = (playerId && memberLookup.byId[playerId]) || memberLookup.byName[String(name).toLowerCase()];
    if (!m || !m.player_id) return;
    const pid = String(m.player_id);
    if (existingIds.has(pid) || picked.has(pid)) return;
    picked.add(pid);
    const status = confirmedCount < maxPlayers ? 'confirmed' : 'waitlist';
    if (status === 'confirmed') confirmedCount++;
    candidates.push({ player_id: m.player_id, status, idx });
  });

  const rows = [];
  const cancelledByPlayer = {};
  if (candidates.length) {
    const candidateIds = candidates.map(c => String(c.player_id));
    const cancelledClaims = await sbGet('slot_claims',
      `slot_id=eq.${slotId}&player_id=in.(${candidateIds.join(',')})&status=eq.cancelled&select=id,player_id`
    ).catch(() => []);
    (cancelledClaims || []).forEach(c => {
      if (c && c.player_id && c.id) cancelledByPlayer[String(c.player_id)] = c;
    });
  }

  const now = Date.now();
  const patchJobs = [];
  for (const candidate of candidates) {
    const claimedAt = new Date(now + candidate.idx).toISOString();
    const cancelled = cancelledByPlayer[String(candidate.player_id)];
    if (cancelled && cancelled.id) {
      patchJobs.push(sbPatch('slot_claims', `id=eq.${cancelled.id}`, {
        status: candidate.status,
        claimed_at: claimedAt
      }));
    } else {
      rows.push({
        slot_id: slotId,
        player_id: candidate.player_id,
        status: candidate.status,
        claimed_at: claimedAt
      });
    }
  }

  if (patchJobs.length) await Promise.all(patchJobs);
  if (rows.length) await sbPost('slot_claims', rows);
  await vaultSlotsRebalanceClaims(slotId);
}

async function vaultSlotsUpdateCachedSlot(slotId) {
  if (!slotId) return null;
  const slot = await vaultSlotsLoadOne(slotId).catch(() => null);
  if (!slot || !slot.slot_date) return null;
  vaultSlotsCacheSlot(slot);
  return slot;
}

function vaultSlotsCacheSlot(slot) {
  if (!slot || !slot.slot_date) return;
  const list = _vsSlotsByDate[slot.slot_date] || [];
  const idx = list.findIndex(s => String(s.id) === String(slot.id));
  if (idx >= 0) list[idx] = slot;
  else list.push(slot);
  _vsSlotsByDate[slot.slot_date] = list.sort((a, b) => String(a.start_time || '').localeCompare(String(b.start_time || '')));

  if (_vsSelectedDateStr === slot.slot_date &&
      document.getElementById('vsDateSheetOverlay')?.style.display !== 'none' &&
      !document.getElementById('vsManageOverlay')) {
    vaultSlotsOpenDateSheet(slot.slot_date);
  }
}

function vaultSlotsScheduleSoftRefresh(slotId) {
  clearTimeout(_vsSoftRefreshTimer);
  _vsSoftRefreshTimer = setTimeout(function() {
    if (typeof myCardSlotsScheduleRefresh === 'function') myCardSlotsScheduleRefresh(true);
  }, 250);
}

var _vsFormGenderChoice = 'all';
var _vsFormRatingChoice = '0';
var _vsFormVisibilityChoice = 'private';
var _vsFormSessionModeChoice = 'standard';
var _vsManageDraft = null;
function _vsPositionSegThumb(container) {
  if (!container) return;
  var thumb = container.querySelector('.vs-segmented-thumb');
  var active = container.querySelector('.vs-pill.vs-pill-active');
  if (!thumb || !active) return;
  thumb.style.width = active.offsetWidth + 'px';
  thumb.style.left = active.offsetLeft + 'px';
}
function _vsInitSegThumbs(root) {
  (root || document).querySelectorAll('.vs-segmented').forEach(function(c) { _vsPositionSegThumb(c); });
}
window.addEventListener('resize', function() { _vsInitSegThumbs(); });

function _vsFormSelectGender(val) {
  _vsFormGenderChoice = val;
  var c = document.getElementById('vsFormGenderPills');
  if (!c) return;
  c.querySelectorAll('.vs-pill').forEach(btn => btn.classList.toggle('vs-pill-active', btn.dataset.val === val));
  _vsPositionSegThumb(c);
}
function _vsFormSelectRating(val) {
  _vsFormRatingChoice = val;
  var c = document.getElementById('vsFormRatingPills');
  if (!c) return;
  c.querySelectorAll('.vs-pill').forEach(btn => btn.classList.toggle('vs-pill-active', btn.dataset.val === val));
  _vsPositionSegThumb(c);
}
function _vsFormSelectVisibility(val) {
  _vsFormVisibilityChoice = val;
  var c = document.getElementById('vsFormVisibilityCards');
  if (!c) return;
  c.querySelectorAll('.vs-pill').forEach(btn => btn.classList.toggle('vs-pill-active', btn.dataset.val === val));
  _vsPositionSegThumb(c);
  var hint = document.getElementById('vsFormVisibilityHint');
  if (hint) hint.textContent = val === 'public' ? (t('publicSlotHint') || 'Anyone can see and join this slot') : (t('privateSlotHint') || 'Only club players can see and join');
}
function _vsFormSelectSessionMode(val) {
  _vsFormSessionModeChoice = _vsSlotSessionMode({ session_mode: val });
  var c = document.getElementById('vsFormSessionModePills');
  if (!c) return;
  c.querySelectorAll('.vs-pill').forEach(btn => btn.classList.toggle('vs-pill-active', btn.dataset.val === _vsFormSessionModeChoice));
  _vsPositionSegThumb(c);
}

/* ══════════════════════════════════════════════
   CUSTOM TIME PICKER — flat list, 15-minute increments
   (replaces native <input type="time"> which opens the
   OS wheel picker on iOS — not what we want here)
══════════════════════════════════════════════ */
var _vsTimePickerTarget = null; // 'start' | 'end'

function _vsBuildTimeOptions() {
  const opts = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 15, 30, 45]) {
      opts.push(String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'));
    }
  }
  return opts;
}

function _vsTimeMinutes(value) {
  const parts = String(value || '').split(':');
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function _vsMinutesTime(totalMinutes) {
  totalMinutes = Math.max(0, Math.min(23 * 60 + 45, Number(totalMinutes) || 0));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0');
}

function _vsDefaultSlotTimes() {
  const now = new Date();
  let startMinutes = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15;
  if (startMinutes >= 24 * 60) startMinutes = 0;
  // Keep at least one valid 15-minute end option on the same slot date.
  startMinutes = Math.min(startMinutes, 23 * 60 + 30);
  const endMinutes = Math.min(startMinutes + 2 * 60, 23 * 60 + 45);
  return { start: _vsMinutesTime(startMinutes), end: _vsMinutesTime(endMinutes) };
}

function _vsSetTimeField(target, value) {
  const ids = _vsTimePickerFieldIds(target);
  const input = document.getElementById(ids.input);
  const label = document.getElementById(ids.label);
  if (input) input.value = value;
  if (label) label.textContent = _vsFormatTime(value);
}

function _vsKeepEndAfterStart(startTarget, endTarget) {
  const startIds = _vsTimePickerFieldIds(startTarget);
  const endIds = _vsTimePickerFieldIds(endTarget);
  const startInput = document.getElementById(startIds.input);
  const endInput = document.getElementById(endIds.input);
  const startMinutes = _vsTimeMinutes(startInput && startInput.value);
  const endMinutes = _vsTimeMinutes(endInput && endInput.value);
  if (startMinutes === null || (endMinutes !== null && endMinutes > startMinutes)) return;
  const nextEnd = _vsMinutesTime(Math.min(startMinutes + 2 * 60, 23 * 60 + 45));
  _vsSetTimeField(endTarget, nextEnd);
}

// Maps a picker target key to its hidden input + visible label element IDs
function _vsTimePickerFieldIds(target) {
  const map = {
    start:   { input: 'vsFormStart', label: 'vsFormStartLabel' },
    end:     { input: 'vsFormEnd',   label: 'vsFormEndLabel'   },
    mgStart: { input: 'vsMgStart',   label: 'vsMgStartLabel'   },
    mgEnd:   { input: 'vsMgEnd',     label: 'vsMgEndLabel'     },
  };
  return map[target] || map.start;
}

function vsTimePickerOpen(target) {
  _vsTimePickerTarget = target;
  const ids = _vsTimePickerFieldIds(target);
  const hiddenInput = document.getElementById(ids.input);
  const currentVal = hiddenInput ? hiddenInput.value : '09:00';

  const existing = document.getElementById('vsTimePickerOverlay');
  if (existing) existing.remove();

  let options = _vsBuildTimeOptions();
  if (target === 'start' || target === 'mgStart') {
    options = options.filter(function(value) { return _vsTimeMinutes(value) < 23 * 60 + 45; });
  }
  if (target === 'end' || target === 'mgEnd') {
    const startTarget = target === 'end' ? 'start' : 'mgStart';
    const startIds = _vsTimePickerFieldIds(startTarget);
    const startInput = document.getElementById(startIds.input);
    const startMinutes = _vsTimeMinutes(startInput && startInput.value);
    if (startMinutes !== null) {
      options = options.filter(function(value) { return _vsTimeMinutes(value) > startMinutes; });
    }
  }
  let listHtml = options.map(function(t24) {
    const isSelected = t24 === currentVal;
    return '<div class="vs-time-option' + (isSelected ? ' vs-time-option-selected' : '') + '" ' +
           'data-time="' + t24 + '" onclick="vsTimePickerSelect(\'' + t24 + '\')">' +
             (isSelected ? '✓ ' : '') + _vsFormatTime(t24) +
           '</div>';
  }).join('');

  const overlay = document.createElement('div');
  overlay.id = 'vsTimePickerOverlay';
  overlay.className = 'vs-time-picker-overlay';
  overlay.onclick = function(e) { if (e.target === overlay) vsTimePickerClose(); };
  overlay.innerHTML = '<div class="vs-time-picker-sheet" id="vsTimePickerSheet">' + listHtml + '</div>';
  document.body.appendChild(overlay);

  // Scroll the selected option into view, centered
  requestAnimationFrame(function() {
    const sel = overlay.querySelector('.vs-time-option-selected');
    if (sel) sel.scrollIntoView({ block: 'center' });
  });
}

function vsTimePickerSelect(t24) {
  const ids = _vsTimePickerFieldIds(_vsTimePickerTarget);
  const hiddenInput = document.getElementById(ids.input);
  const labelEl = document.getElementById(ids.label);
  if (hiddenInput) hiddenInput.value = t24;
  if (labelEl) labelEl.textContent = _vsFormatTime(t24);
  if (_vsTimePickerTarget === 'start') _vsKeepEndAfterStart('start', 'end');
  if (_vsTimePickerTarget === 'mgStart') _vsKeepEndAfterStart('mgStart', 'mgEnd');
  if (_vsTimePickerTarget === 'mgStart' || _vsTimePickerTarget === 'mgEnd') {
    vaultSlotsDraftFieldChanged();
  }
  vsTimePickerClose();
}

function vsTimePickerClose() {
  const overlay = document.getElementById('vsTimePickerOverlay');
  if (overlay) overlay.remove();
  _vsTimePickerTarget = null;
}

function vaultSlotsAdjustMax(delta) {
  const el = document.getElementById('vsFormMaxValue');
  if (!el) return;
  let val = parseInt(el.textContent || '8', 10) + delta;
  if (val < 2) val = 2;
  if (val > 20) val = 20;
  el.textContent = val;
}

function vaultSlotsAdjustCourts(delta) {
  const el = document.getElementById('vsFormCourtValue');
  if (!el) return;
  let val = parseInt(el.textContent || '1', 10) + delta;
  if (val < 1) val = 1;
  if (val > 20) val = 20;
  el.textContent = val;
}

async function vaultSlotsSubmitNewSlot(mode) {
  mode = mode || 'draft';
  const venue = document.getElementById('vsFormVenue')?.value || '';
  const selectedVenue = (typeof _vaultSlotsSelectedVenue === 'function') ? _vaultSlotsSelectedVenue() : null;
  const venueId = selectedVenue && selectedVenue.id ? selectedVenue.id : null;
  const start = document.getElementById('vsFormStart')?.value || '';
  const end   = document.getElementById('vsFormEnd')?.value || '';
  const max   = parseInt(document.getElementById('vsFormMaxValue')?.textContent || '8', 10);
  const courts = parseInt(document.getElementById('vsFormCourtValue')?.textContent || '1', 10);
  const scheduledAt = _vsScheduledPostIsoFromInput(document.getElementById('vsFormScheduledPostAt')?.value || '');
  const fb    = document.getElementById('vsFormFeedback');
  const setFb = (msg, ok) => { if (fb) { fb.textContent = msg; fb.style.color = ok ? '#2dce89' : '#e63757'; } };

  const club = (typeof getMyClub === 'function') ? getMyClub() : null;
  if (!club || !club.id) { setFb(t('noClubSelected') || 'No club selected', false); return; }

  if (_vsTimeMinutes(end) <= _vsTimeMinutes(start)) {
    setFb(t('endTimeAfterStart') || 'End time must be after start time', false);
    return;
  }

  if (mode === 'scheduled' && !scheduledAt) { setFb(t('enterScheduledPostTime') || 'Enter scheduled post time', false); return; }

  setFb(mode === 'posted' ? (t('postingDot') || 'Posting...') : (t('savingDot') || 'Saving...'), true);
  try {
    await dbCreateSlot(club.id, _vsSelectedDateStr, venue, start, end, max, _vsFormGenderChoice, _vsFormRatingChoice, _vsFormVisibilityChoice, courts, _vsFormSessionModeChoice, _vsInitialPlayers, mode, scheduledAt, venueId);
    setFb('✅ ' + (mode === 'posted'
      ? (t('slotPosted') || 'Slot posted')
      : (mode === 'scheduled' ? (t('slotScheduled') || 'Slot scheduled') : (t('slotSavedAsDraft') || 'Saved as draft'))), true);
    await vaultSlotsRenderMonth();
    if (typeof myCardSlotsScheduleRefresh === 'function') myCardSlotsScheduleRefresh(true);
    // Return directly to the normal Vault slot card. Reopening the legacy date
    // sheet here showed a duplicate management card after every create.
    var dateSheet = document.getElementById('vsDateSheetOverlay');
    if (dateSheet) dateSheet.style.display = 'none';
    if (typeof renderVaultHomeSlotsUI === 'function') await renderVaultHomeSlotsUI(true);
    if (typeof showToast === 'function') {
      showToast(mode === 'posted'
        ? (t('slotPosted') || 'Slot posted')
        : (mode === 'scheduled' ? (t('slotScheduled') || 'Slot scheduled') : (t('slotSavedAsDraft') || 'Saved as draft')));
    }
  } catch (e) {
    setFb(e.message || (t('somethingWentWrong') || 'Something went wrong'), false);
  }
}

async function vaultSlotsDeleteSlot(slotId) {
  if (!confirm(t('confirmDeleteSlot') || 'Delete this slot? This cannot be undone.')) return;
  try {
    await dbDeleteSlot(slotId);
    await vaultSlotsRenderMonth();
    if (typeof myCardSlotsScheduleRefresh === 'function') myCardSlotsScheduleRefresh(true);
    vaultSlotsOpenDateSheet(_vsSelectedDateStr);
  } catch (e) {
    alert(e.message || (t('somethingWentWrong') || 'Something went wrong'));
  }
}

function vaultSlotsCreateManageDraft(slot) {
  const draftSlot = { ...(slot || {}) };
  draftSlot.claims = _vsSortClaimsQueue((slot && slot.claims) || []).map(c => ({
    ...c,
    player: c.player ? { ...c.player } : null,
    _draftOriginal: true
  }));
  const originalIds = new Set(draftSlot.claims.map(c => String(c.id || '')).filter(Boolean));
  return {
    slotId: String(draftSlot.id || ''),
    originalSlot: { ...(slot || {}), claims: ((slot && slot.claims) || []).map(c => ({ ...c })) },
    originalClaimIds: originalIds,
    slot: draftSlot,
    removedClaimIds: new Set(),
    dirty: false
  };
}

function vaultSlotsDraftRebalance(draft) {
  if (!draft || !draft.slot) return;
  const maxPlayers = Math.max(0, parseInt(draft.slot.max_players || 0, 10));
  const pending = (draft.slot.claims || []).filter(claim => String(claim.status || '').toLowerCase() === 'pending');
  const active = _vsSortClaimsQueue((draft.slot.claims || []).filter(claim => String(claim.status || '').toLowerCase() !== 'pending')).map((claim, idx) => ({
    ...claim,
    status: idx < maxPlayers ? 'confirmed' : 'waitlist'
  }));
  draft.slot.claims = _vsSortClaimsQueue(active.concat(pending));
}

function vaultSlotsDraftClaimKey(player, idx) {
  return 'draft-' + Date.now() + '-' + idx + '-' + Math.random().toString(36).slice(2);
}

function vaultSlotsDraftAddPlayers(slotId, players) {
  const draft = _vsManageDraft;
  if (!draft || String(draft.slotId) !== String(slotId)) return false;

  const existingIds = new Set((draft.slot.claims || []).map(c => String(c.player_id || '')).filter(Boolean));
  const existingNames = new Set((draft.slot.claims || []).map(c => String((c.player && c.player.name) || '').trim().toLowerCase()).filter(Boolean));
  const now = Date.now();
  let added = false;

  (players || []).forEach((p, idx) => {
    const name = _vsSelectedPlayerName(p);
    const pid = _vsSelectedPlayerId(p);
    const nameKey = String(name || '').trim().toLowerCase();
    if ((pid && existingIds.has(String(pid))) || (!pid && nameKey && existingNames.has(nameKey))) return;

    const ratingNum = Number(p && p.rating);
    draft.slot.claims.push({
      id: vaultSlotsDraftClaimKey(p, idx),
      slot_id: slotId,
      player_id: pid || ('draft-player-' + now + '-' + idx),
      status: 'waitlist',
      claimed_at: new Date(now + idx).toISOString(),
      player: {
        name: name || 'Player',
        gender: (p && p.gender) || 'Male',
        clubRating: Number.isFinite(ratingNum) ? ratingNum : null,
        guest: !!(p && p.guest),
        unrated: !!(p && p.unrated)
      },
      _draftAdded: true,
      _draftPlayer: { ...(p || {}), displayName: name, playerId: pid }
    });
    if (pid) existingIds.add(String(pid));
    if (nameKey) existingNames.add(nameKey);
    added = true;
  });

  if (added) {
    draft.dirty = true;
    vaultSlotsDraftRebalance(draft);
    vaultSlotsRefreshManagePlayers(draft);
  }
  return true;
}

function vaultSlotsDraftRemoveClaim(claimId, slotId) {
  const draft = _vsManageDraft;
  if (!draft || String(draft.slotId) !== String(slotId)) return false;
  const before = (draft.slot.claims || []).length;
  const claim = (draft.slot.claims || []).find(c => String(c.id) === String(claimId));
  draft.slot.claims = (draft.slot.claims || []).filter(c => String(c.id) !== String(claimId));
  if (claim && !claim._draftAdded && claim.id) draft.removedClaimIds.add(String(claim.id));
  if (draft.slot.claims.length !== before) {
    draft.dirty = true;
    vaultSlotsDraftRebalance(draft);
    vaultSlotsRefreshManagePlayers(draft);
  }
  return true;
}

function vaultSlotsManagePlayersHtml(draft) {
  if (!draft || !draft.slot) return '';
  const slot = draft.slot;
  const slotId = draft.slotId;
  const queueClaims = _vsSortClaimsQueue(slot.claims || []);
  const confirmedClaims = queueClaims.filter(c => c.status === 'confirmed');
  const waitlistClaims = queueClaims.filter(c => c.status === 'waitlist');
  const pendingClaims = queueClaims.filter(c => c.status === 'pending');
  const claimDisplayName = function(c) {
    return (c && c.player && c.player.name) || (c && c.player_id) || 'Player';
  };

  window._vsManageSlotSelectedPlayers = queueClaims.map(function(c) {
    const ratingNum = Number(c.player && c.player.clubRating);
    return {
      displayName: claimDisplayName(c),
      gender: c.player && c.player.gender || 'Male',
      rating: Number.isFinite(ratingNum) ? ratingNum : null,
      guest: !!(c.player && c.player.guest),
      unrated: !!(c.player && (c.player.guest || c.player.unrated))
    };
  });

  const playerRows = function(list, label) {
    if (!list.length) return '';
    return '<div class="vs-manage-section-label">' + label + '</div>' + list.map(function(c, i) {
      const rowKind = c.status === 'waitlist' ? 'waitlist' : 'confirmed';
      const name = claimDisplayName(c);
      const isGuest = !!(c.player && (c.player.guest || c.player.unrated)) || /\(guest(?:\s+[a-z0-9]+)?\)$/i.test(String(name || ''));
      const ratingNum = Number(c.player && c.player.clubRating);
      const paidHtml = _vsClaimPaid(c)
        ? '<span class="mc-slot-paid-badge">' + _vsEscape(t('paid') || 'Paid') + '</span>'
        : (rowKind === 'confirmed' && _vsSlotCostPerPlayer(slot) ? '<span class="mc-slot-unpaid-badge">' + _vsEscape(t('unpaid') || 'Unpaid') + '</span>' : '');
      const ratingHtml = (!isGuest && Number.isFinite(ratingNum)) ? '<span class="mc-slot-rating-badge">' + ratingNum.toFixed(1) + '</span>' : '';
      const prefix = rowKind === 'waitlist'
        ? '<span class="mc-slot-wait-num">⏳' + (i + 1) + '</span>'
        : '<span class="mc-slot-confirm-icon">✓</span><span class="mc-slot-avatar mc-slot-gender-avatar">' + _mcsGenderIcon(c) + '</span>';
      return '<div class="mc-slot-player-row vs-manage-player-row ' + (rowKind === 'waitlist' ? 'is-waitlist' : 'is-confirmed') + '">' +
        '<div class="mc-slot-player-left">' + prefix + '<span class="mc-slot-player-name vs-manage-player-name">' + _vsEscape(name) + '</span></div>' +
        paidHtml + ratingHtml +
        '<button class="vs-remove-mini" onclick="vaultSlotsRemoveClaim(\'' + _vsEscape(c.id) + '\',\'' + _vsEscape(slotId) + '\')" title="Remove">−</button>' +
      '</div>';
    }).join('');
  };

  const pendingRows = function(list) {
    if (!list.length) return '';
    return '<div class="vs-manage-section-label">🕒 ' + (t('pendingApproval') || 'Pending approval') + ' (' + list.length + ')</div>' + list.map(function(c) {
      const name = claimDisplayName(c);
      const combined = !!(c.player && c.player.clubJoinRequest);
      const approveLabel = combined ? _vsT('approveClubAndSlot', 'Approve Club & Slot') : _vsT('approveSlot', 'Approve Slot');
      return '<div class="mc-slot-player-row vs-manage-player-row mc-slot-player-row-pending-review is-pending">' +
        '<div class="mc-slot-player-left"><span class="mc-slot-avatar mc-slot-gender-avatar">' + _mcsGenderIcon(c) + '</span><span class="mc-slot-player-name vs-manage-player-name">' + _vsEscape(name) + '</span></div>' +
        '<div class="vs-approval-actions"><button type="button" class="vs-approve-mini' + (combined ? ' is-combined-approval' : '') + '" onclick="vaultSlotsReviewClaim(\'' + _vsEscape(c.id) + '\',\'' + _vsEscape(slotId) + '\',true)">' + _vsEscape(approveLabel) + '</button>' +
        '<button type="button" class="vs-reject-mini" onclick="vaultSlotsReviewClaim(\'' + _vsEscape(c.id) + '\',\'' + _vsEscape(slotId) + '\',false)">' + (t('reject') || 'Reject') + '</button></div>' +
      '</div>';
    }).join('');
  };

  const costLabel = _vsSlotCostLabel(slot);
  const costSummary = costLabel
    ? '<div class="mc-slot-payment-summary"><span>' + _vsEscape(t('cost') || 'Cost') + '</span><strong>' + _vsEscape(costLabel) + '</strong></div>'
    : '';
  return costSummary +
    pendingRows(pendingClaims) +
    playerRows(confirmedClaims, '✅ ' + (t('confirmed') || 'Confirmed') + ' (' + confirmedClaims.length + '/' + slot.max_players + ')') +
    playerRows(waitlistClaims, '⏳ ' + (t('waiting') || 'Waiting') + ' (' + waitlistClaims.length + ')') +
    (!queueClaims.length ? '<div style="color:var(--text-dim);font-size:0.85rem;text-align:center;padding:12px 0">' + (t('noBookingsYet') || 'No bookings yet') + '</div>' : '');
}

async function vaultSlotsReviewClaim(claimId, slotId, approve, stayOnSlotCard) {
  if (!claimId || !slotId || typeof sbPatch !== 'function') return;
  try {
    const slotRows = await sbGet('slots', `id=eq.${slotId}&select=id,club_id`).catch(() => []);
    const claimRows = await sbGet('slot_claims', `id=eq.${claimId}&status=eq.pending&select=id,player_id`).catch(() => []);
    const slot = slotRows && slotRows[0];
    const claim = claimRows && claimRows[0];
    let clubRequest = null;
    if (slot && claim && claim.player_id) {
      const playerRows = await sbGet('players', `id=eq.${claim.player_id}&select=id,user_account_id`).catch(() => []);
      const guestAccountId = playerRows && playerRows[0] && playerRows[0].user_account_id;
      if (guestAccountId) {
        const requestRows = await sbGet('club_join_requests',
          `club_id=eq.${slot.club_id}&user_account_id=eq.${guestAccountId}&status=eq.pending&select=id,user_account_id,nickname,status`
        ).catch(() => []);
        clubRequest = requestRows && requestRows[0];
      }
    }

    if (!approve) {
      if (clubRequest && typeof authRejectRequest === 'function') {
        const rejected = await authRejectRequest(clubRequest.id);
        if (rejected && rejected.error) throw new Error(rejected.error);
      }
      await sbPatch('slot_claims', `id=eq.${claimId}&status=eq.pending`, { status: 'cancelled' });
      await vaultSlotsRebalanceClaims(slotId);
      if (typeof showToast === 'function') showToast(clubRequest
        ? (t('clubAndSlotRequestRejected') || 'Club and slot requests rejected')
        : (t('slotRequestRejected') || 'Slot request rejected'));
    } else {
      if (clubRequest) {
        if (typeof authAcceptRequest !== 'function') throw new Error('Club approval is not available');
        const accepted = await authAcceptRequest(clubRequest.id, slot.club_id, clubRequest.user_account_id, clubRequest.nickname);
        if (accepted && accepted.error) throw new Error(accepted.error);
        const memberships = await sbGet('memberships',
          `club_id=eq.${slot.club_id}&user_account_id=eq.${clubRequest.user_account_id}&select=player_id`
        );
        if (!memberships || !memberships[0] || !memberships[0].player_id) throw new Error('Club membership could not be linked');
        await sbPatch('slot_claims', `id=eq.${claimId}&status=eq.pending`, {
          player_id: memberships[0].player_id,
          status: 'confirmed'
        });
      } else {
        // Preserve claimed_at: queue priority is the original request time.
        await sbPatch('slot_claims', `id=eq.${claimId}&status=eq.pending`, { status: 'confirmed' });
      }
      await vaultSlotsRebalanceClaims(slotId);
      if (typeof showToast === 'function') showToast(clubRequest
        ? (t('clubAndSlotRequestApproved') || 'Club membership and slot approved')
        : (t('slotRequestApproved') || 'Slot request approved'));
    }
    if (stayOnSlotCard) {
      await renderVaultHomeSlotsUI(true);
    } else {
      await vaultSlotsViewSlot(slotId);
      vaultSlotsScheduleSoftRefresh(slotId);
    }
  } catch (e) {
    alert((t('slotRequestReviewFailed') || 'Could not review request') + ': ' + (e.message || e));
  }
}

function vaultSlotsRefreshManagePlayers(draft) {
  const playersEl = document.getElementById('vsManagePlayers');
  if (!playersEl || !_vsManageDraft || String(_vsManageDraft.slotId) !== String(draft.slotId)) {
    vaultSlotsRenderManageDraft(draft);
    return;
  }
  playersEl.innerHTML = vaultSlotsManagePlayersHtml(draft);
  const dirtyEl = document.getElementById('vsMgDirtyNote');
  if (dirtyEl) dirtyEl.innerHTML = draft.dirty
    ? '<span class="vs-status-badge vs-status-draft">' + (t('unsavedChanges') || 'Unsaved') + '</span>'
    : '';
}

function vaultSlotsRenderManageDraft(draft) {
  if (!draft || !draft.slot) return;
  const slot = draft.slot;
  const slotId = draft.slotId;
  const existing = document.getElementById('vsManageOverlay');
  const previousManageScroll = existing && existing.querySelector('.vs-manage-scroll')
    ? existing.querySelector('.vs-manage-scroll').scrollTop
    : 0;
  const previousPageScrollX = window.scrollX || 0;
  const previousPageScrollY = window.scrollY || 0;
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'vsManageOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(4px)';

  const queueClaims = _vsSortClaimsQueue(slot.claims || []);
  const confirmedClaims = queueClaims.filter(c => c.status === 'confirmed');
  const waitlistClaims  = queueClaims.filter(c => c.status === 'waitlist');
  const claimDisplayName = function(c) {
    return (c && c.player && c.player.name) || (c && c.player_id) || 'Player';
  };
  window._vsManageSlotSelectedPlayers = queueClaims.map(function(c) {
    const ratingRaw = c.player && c.player.clubRating;
    const ratingNum = Number(ratingRaw);
    return {
      displayName: claimDisplayName(c),
      gender: c.player && c.player.gender || 'Male',
      rating: Number.isFinite(ratingNum) ? ratingNum : null,
      guest: !!(c.player && c.player.guest),
      unrated: !!(c.player && (c.player.guest || c.player.unrated))
    };
  });

  const slotStatus = String(slot.status || 'draft').toLowerCase();
  const isDraft = slotStatus === 'draft';
  const isScheduled = slotStatus === 'scheduled';
  const isCancelled = slotStatus === 'cancelled';
  const manageStatusClass = isCancelled ? 'vs-status-cancelled' : (_mcsIsPlayedSlot(slot) ? 'vs-status-played' : (isScheduled ? 'vs-status-scheduled' : (isDraft ? 'vs-status-draft' : 'vs-status-posted')));
  const manageStatusLabel = isCancelled ? (t('cancelled') || 'Cancelled') : (_mcsIsPlayedSlot(slot) ? (t('slotPlayed') || 'Played') : (isScheduled ? (t('scheduled') || 'Scheduled') : (isDraft ? (t('draft') || 'Draft') : (t('posted') || 'Posted'))));
  const dirtyNote = draft.dirty ? '<span class="vs-status-badge vs-status-draft">' + (t('unsavedChanges') || 'Unsaved') + '</span>' : '';
  const costLabel = _vsSlotCostLabel(slot);
  const costSummary = costLabel
    ? `<div class="mc-slot-payment-summary"><span>${_vsEscape(t('cost') || 'Cost')}</span><strong>${_vsEscape(costLabel)}</strong></div>`
    : '';
  const mgVenue = _vsVenueForSlot(slot);
  const mgVenueName = mgVenue ? _venueDisplayName(mgVenue) : String(slot.venue || '');
  const mgVenueId = mgVenue && mgVenue.id ? String(mgVenue.id) : String(slot.venue_id || '');
  const mgVenueAddress = mgVenue ? (_venueAddressForLang(mgVenue) || ((mgVenue.latitude != null && mgVenue.longitude != null) ? (mgVenue.latitude + ', ' + mgVenue.longitude) : (t('savedVenue') || 'Saved venue'))) : '';
  const mgVenueInfoStyle = mgVenue ? 'display:flex;' : 'display:none;';
  const mgVenueMapStyle = mgVenue && mgVenue.maps_url ? '' : 'display:none;';

  const playerRows = (list, label) => list.length ? `
    <div class="vs-manage-section-label">${label}</div>
    ${list.map((c, i) => {
      const rowKind = c.status === 'waitlist' ? 'waitlist' : 'confirmed';
      const name = claimDisplayName(c);
      const isGuest = !!(c.player && (c.player.guest || c.player.unrated)) || /\(guest(?:\s+[a-z0-9]+)?\)$/i.test(String(name || ''));
      const ratingRaw = c.player && c.player.clubRating;
      const ratingNum = Number(ratingRaw);
      const paidHtml = _vsClaimPaid(c)
        ? `<span class="mc-slot-paid-badge">${_vsEscape(t('paid') || 'Paid')}</span>`
        : (rowKind === 'confirmed' && _vsSlotCostPerPlayer(slot) ? `<span class="mc-slot-unpaid-badge">${_vsEscape(t('unpaid') || 'Unpaid')}</span>` : '');
      const ratingHtml = (!isGuest && isFinite(ratingNum)) ? `<span class="mc-slot-rating-badge">${ratingNum.toFixed(1)}</span>` : '';
      const prefix = rowKind === 'waitlist'
        ? `<span class="mc-slot-wait-num">⏳${i + 1}</span>`
        : `<span class="mc-slot-confirm-icon">✓</span><span class="mc-slot-avatar mc-slot-gender-avatar">${_mcsGenderIcon(c)}</span>`;
      return `<div class="mc-slot-player-row vs-manage-player-row ${rowKind === 'waitlist' ? 'is-waitlist' : 'is-confirmed'}">
        <div class="mc-slot-player-left">${prefix}<span class="mc-slot-player-name vs-manage-player-name">${_vsEscape(name)}</span></div>
        ${paidHtml}
        ${ratingHtml}
        <button class="vs-remove-mini" onclick="vaultSlotsRemoveClaim('${c.id}','${slotId}')" title="Remove">−</button>
      </div>`;
    }).join('')}` : '';

  const genderOptions = [
    { val: 'Male',   label: t('male')   || 'Male',   icon: '♂' },
    { val: 'Female', label: t('female') || 'Female', icon: '♀' },
    { val: 'all',    label: t('both')   || 'Both',   icon: '👥' },
  ];
  const ratingOptions = [
    { val: '2', label: '2.0+' }, { val: '3', label: '3.0+' },
    { val: '4', label: '4.0+' }, { val: '0', label: t('any') || 'Any' },
  ];
  const curGender = slot.gender_filter || 'all';
  const curRating = String(Math.round(slot.min_rating || 0));
  const curVisibility = slot.visibility || 'private';
  const curSessionMode = _vsSlotSessionMode(slot);
  _vsMgGenderChoice = curGender;
  _vsMgRatingChoice = curRating;
  _vsMgVisibilityChoice = curVisibility;
  _vsMgSessionModeChoice = curSessionMode === 'rolling' ? 'standard' : curSessionMode;

  overlay.innerHTML = `
    <div class="vs-manage-sheet" id="vsManageSheet">
      <div class="vs-sheet-handle"></div>
      <div class="vs-manage-header">
        <span class="vs-manage-title">${_vsEscape(mgVenueName || slot.venue)} <span class="vs-status-badge ${manageStatusClass}">${manageStatusLabel}</span> <span id="vsMgDirtyNote">${dirtyNote}</span></span>
        <button class="vs-manage-close" onclick="document.getElementById('vsManageOverlay').remove()">✕</button>
      </div>

      <div class="vs-manage-scroll">
        <div class="vs-section">
          <div class="vs-section-head"><span class="vs-section-icon">📍</span><span class="vs-section-title">${t('sessionDetails') || 'Session Details'}</span></div>
          <div class="vs-form-row">
            <label class="vs-form-label">${t('venue') || 'Venue'}</label>
            <input type="hidden" id="vsMgVenue" value="${_vsEscape(mgVenueName)}">
            <input type="hidden" id="vsMgVenueId" value="${_vsEscape(mgVenueId)}">
            <button type="button" id="vsMgVenuePickerBtn" class="vs-sample-input vs-venue-picker-btn" onclick="vaultSlotsOpenVenuePicker('manage')">
              <span id="vsMgVenuePickerLabel">${mgVenue ? ((t('venue') || 'Venue') + ': ' + _vsEscape(mgVenueName)) : (t('tapToSelectVenue') || 'Tap to select venue')}</span>
              <span class="vs-venue-picker-arrow">&gt;</span>
            </button>
            <div class="vs-venue-inline" id="vsMgVenueInfo" style="${mgVenueInfoStyle}">
              <span id="vsMgVenueAddress">${_vsEscape(mgVenueAddress)}</span>
              <button type="button" id="vsMgVenueMapBtn" style="${mgVenueMapStyle}" onclick="vaultSlotsOpenSelectedVenueMap('manage')">Open Map</button>
            </div>
            <div class="vs-form-hint">${t('venuePickerHint') || 'Favorites appear first. Manage them from Vault Venues.'}</div>
          </div>

          <div class="vs-form-row-split vs-form-row-last">
            <div>
              <label class="vs-form-label">${t('startTime') || 'Start time'}</label>
              <div class="vs-time-picker-field" id="vsMgStartField" onclick="vsTimePickerOpen('mgStart')">
                <span class="vs-time-icon">🕐</span><span id="vsMgStartLabel">${_vsFormatTime(slot.start_time)}</span><span class="vs-time-chevron">▾</span>
              </div>
              <input type="hidden" id="vsMgStart" value="${(slot.start_time || '').slice(0,5)}">
            </div>
            <div>
              <label class="vs-form-label">${t('endTime') || 'End time'}</label>
              <div class="vs-time-picker-field" id="vsMgEndField" onclick="vsTimePickerOpen('mgEnd')">
                <span class="vs-time-icon">🕐</span><span id="vsMgEndLabel">${_vsFormatTime(slot.end_time)}</span><span class="vs-time-chevron">▾</span>
              </div>
              <input type="hidden" id="vsMgEnd" value="${(slot.end_time || '').slice(0,5)}">
            </div>
          </div>
        </div>

        <div class="vs-section">
          <div class="vs-section-head"><span class="vs-section-icon">👥</span><span class="vs-section-title">${t('capacityFormat') || 'Capacity & Format'}</span></div>
          <div class="vs-capacity-grid">
            <div class="vs-form-row">
              <label class="vs-form-label">${t('maxPlayers') || 'Max players'}</label>
              <div class="vs-stepper">
                <button class="vs-stepper-btn" onclick="vaultSlotsMgAdjustMax(-1)">−</button>
                <div class="vs-stepper-value" id="vsMgMaxValue">${slot.max_players || 8}</div>
                <button class="vs-stepper-btn" onclick="vaultSlotsMgAdjustMax(1)">+</button>
              </div>
              <div class="vs-form-hint">2 - 20 ${t('players') || 'players'}</div>
            </div>

            <div class="vs-form-row">
              <label class="vs-form-label">${t('courtsLabel') || 'Courts'}</label>
              <div class="vs-stepper">
                <button class="vs-stepper-btn" onclick="vaultSlotsMgAdjustCourts(-1)">-</button>
                <div class="vs-stepper-value" id="vsMgCourtValue">${_vsSlotCourtCount(slot)}</div>
                <button class="vs-stepper-btn" onclick="vaultSlotsMgAdjustCourts(1)">+</button>
              </div>
              <div class="vs-form-hint">${t('slotCourtsHint') || 'Used when organiser starts session'}</div>
            </div>
          </div>

          <div class="vs-form-row vs-form-row-last">
            <label class="vs-form-label">${t('gameAlgorithm') || 'Game Algorithm'}</label>
            <div class="vs-segmented" id="vsMgSessionModePills">
              <div class="vs-segmented-thumb"></div>
              <button class="vs-pill${curSessionMode === 'standard' || curSessionMode === 'rolling' ? ' vs-pill-active' : ''}" data-val="standard" onclick="_vsMgSelectSessionMode('standard')">${t('standardMode') || 'Standard'}</button>
              <button class="vs-pill${curSessionMode === 'balanced' ? ' vs-pill-active' : ''}" data-val="balanced" onclick="_vsMgSelectSessionMode('balanced')">${t('balancedMode') || 'Balanced'}</button>
            </div>
          </div>
        </div>

        <div class="vs-section">
          <div class="vs-section-head"><span class="vs-section-icon">🎯</span><span class="vs-section-title">${t('eligibility') || 'Eligibility'}</span></div>
          <div class="vs-form-row">
            <label class="vs-form-label">${t('gender') || 'Gender'}</label>
            <div class="vs-segmented" id="vsMgGenderPills">
              <div class="vs-segmented-thumb"></div>
              ${genderOptions.map(o => `<button class="vs-pill${o.val === curGender ? ' vs-pill-active' : ''}" data-val="${o.val}" onclick="_vsMgSelectGender('${o.val}')">${o.icon} ${o.label}</button>`).join('')}
            </div>
          </div>

          <div class="vs-form-row vs-form-row-last">
            <label class="vs-form-label">${t('minRating') || 'Min Rating'}</label>
            <div class="vs-segmented" id="vsMgRatingPills">
              <div class="vs-segmented-thumb"></div>
              ${ratingOptions.map(o => `<button class="vs-pill${o.val === curRating ? ' vs-pill-active' : ''}" data-val="${o.val}" onclick="_vsMgSelectRating('${o.val}')">${o.label}</button>`).join('')}
            </div>
            <div class="vs-form-hint">${t('minRatingHint') || 'Players must have this minimum rating to join.'}</div>
          </div>
        </div>

        <div class="vs-section">
          <div class="vs-section-head"><span class="vs-section-icon">🔒</span><span class="vs-section-title">${t('visibility') || 'Visibility'}</span></div>
          <div class="vs-form-row vs-form-row-last">
            <div class="vs-segmented vs-segmented-visibility" id="vsMgVisibilityCards">
              <div class="vs-segmented-thumb"></div>
              <button class="vs-pill ${curVisibility === 'public' ? 'vs-pill-active' : ''}" data-val="public" onclick="_vsMgSelectVisibility('public')">🌐 ${t('public') || 'Public'}</button>
              <button class="vs-pill ${curVisibility !== 'public' ? 'vs-pill-active' : ''}" data-val="private" onclick="_vsMgSelectVisibility('private')">🔒 ${t('private') || 'Private'}</button>
            </div>
            <div class="vs-form-hint" id="vsMgVisibilityHint">${curVisibility === 'public' ? (t('publicSlotHint') || 'Anyone can see and join this slot') : (t('privateSlotHint') || 'Only club players can see and join')}</div>
          </div>
        </div>

        <div class="vs-section">
          <div class="vs-section-head"><span class="vs-section-icon">🧑‍🤝‍🧑</span><span class="vs-section-title">${t('players') || 'Players'}</span></div>
          <div class="vs-form-row vs-form-row-last">
            <label class="vs-form-label">${t('schedulePostAt') || 'Schedule post at'}</label>
            <div class="vs-datetime-shell"><input type="datetime-local" id="vsMgScheduledPostAt" class="vs-form-input" value="${_vsScheduledPostInputValue(slot)}" oninput="vaultSlotsDraftFieldChanged()"></div>
            <div class="vs-form-hint">${t('scheduledPostHint') || 'Players can see and join only after this time.'}</div>
          </div>
          <div class="vs-form-row vs-form-row-last vs-manage-add-players-block">
            <button type="button" class="vs-btn vs-btn-secondary vs-btn-main" onclick="vaultSlotsAddPlayersToManage('${slotId}')">👥 ${t('addPlayers') || 'Add Players'}</button>
          </div>
        </div>

        <div id="vsMgFeedback" style="min-height:18px;font-size:0.82rem;margin-bottom:10px;color:var(--red)"></div>

        <div class="vs-manage-actions">
          <button class="vs-btn vs-btn-danger" onclick="vaultSlotsDeleteFromManage('${slotId}')">${t('delete') || 'Delete'}</button>
          <button class="vs-btn vs-btn-primary" onclick="vaultSlotsSaveManage('${slotId}', false)">${t('save') || 'Save'}</button>
          ${(isDraft || isScheduled) ? `<button class="vs-btn vs-btn-secondary" onclick="vaultSlotsSaveManage('${slotId}', 'scheduled')">${t('schedulePost') || 'Schedule Post'}</button>` : ''}
          ${(isDraft || isScheduled) ? `<button class="vs-btn vs-btn-post" onclick="vaultSlotsSaveManage('${slotId}', true)">${t('post') || 'Post'}</button>` : ''}
        </div>

        <div class="vs-manage-players" id="vsManagePlayers">
          ${costSummary}
          ${playerRows(confirmedClaims, '✅ ' + (t('confirmed') || 'Confirmed') + ' (' + confirmedClaims.length + '/' + slot.max_players + ')')}
          ${playerRows(waitlistClaims,  '⏳ ' + (t('waiting') || 'Waiting') + ' (' + waitlistClaims.length + ')')}
          ${!queueClaims.length ? '<div style="color:var(--text-dim);font-size:0.85rem;text-align:center;padding:12px 0">' + (t('noBookingsYet') || 'No bookings yet') + '</div>' : ''}
        </div>
      </div>
    </div>`;

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  document.getElementById('vsManageSheet').addEventListener('click', e => e.stopPropagation());
  _vsInitSegThumbs(overlay);
  requestAnimationFrame(function() {
    const manageScroll = overlay.querySelector('.vs-manage-scroll');
    if (manageScroll) manageScroll.scrollTop = previousManageScroll;
    if ((window.scrollX || 0) !== previousPageScrollX || (window.scrollY || 0) !== previousPageScrollY) {
      window.scrollTo(previousPageScrollX, previousPageScrollY);
    }
  });
}

async function vaultSlotsViewSlot(slotId) {
  // ── Load slot data ──
  const club = (typeof getMyClub === 'function') ? getMyClub() : null;
  if (!club || !club.id) return;

  let slot = null, claims = [];
  try {
    slot = await vaultSlotsLoadOne(slotId);
    if (!slot) return;
    vaultSlotsCacheSlot(slot);
    claims = slot.claims || [];
    _vsManageDraft = vaultSlotsCreateManageDraft(slot);
    vaultSlotsRenderManageDraft(_vsManageDraft);
    return;
  } catch(e) { alert('Failed to load slot: ' + e.message); return; }

  // ── Resolve player names from memberships ──
  // ── Build manage sheet ──
  const existing = document.getElementById('vsManageOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'vsManageOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(4px)';

  const queueClaims = _vsSortClaimsQueue(claims);
  const confirmedClaims = queueClaims.filter(c => c.status === 'confirmed');
  const waitlistClaims  = queueClaims.filter(c => c.status === 'waitlist');
  const claimDisplayName = function(c) {
    return (c && c.player && c.player.name) || (c && c.player_id) || 'Player';
  };
  window._vsManageSlotSelectedPlayers = queueClaims.map(function(c) {
    const ratingRaw = c.player && c.player.clubRating;
    const ratingNum = Number(ratingRaw);
    return {
      displayName: claimDisplayName(c),
      gender: c.player && c.player.gender || 'Male',
      rating: Number.isFinite(ratingNum) ? ratingNum : null,
      guest: !!(c.player && c.player.guest),
      unrated: !!(c.player && (c.player.guest || c.player.unrated))
    };
  });
  const isDraft = (slot.status || 'draft') === 'draft';

  const playerRows = (list, label) => list.length ? `
    <div class="vs-manage-section-label">${label}</div>
    ${list.map((c, i) => {
      const rowKind = c.status === 'waitlist' ? 'waitlist' : 'confirmed';
      const name = claimDisplayName(c);
      const isGuest = !!(c.player && (c.player.guest || c.player.unrated)) || /\(guest(?:\s+[a-z0-9]+)?\)$/i.test(String(name || ''));
      const ratingRaw = c.player && c.player.clubRating;
      const ratingNum = Number(ratingRaw);
      const ratingHtml = (!isGuest && isFinite(ratingNum)) ? `<span class="mc-slot-rating-badge">${ratingNum.toFixed(1)}</span>` : '';
      const prefix = rowKind === 'waitlist'
        ? `<span class="mc-slot-wait-num">⏳${i + 1}</span>`
        : `<span class="mc-slot-confirm-icon">✓</span><span class="mc-slot-avatar mc-slot-gender-avatar">${_mcsGenderIcon(c)}</span>`;
      return `<div class="mc-slot-player-row vs-manage-player-row ${rowKind === 'waitlist' ? 'is-waitlist' : 'is-confirmed'}">
        <div class="mc-slot-player-left">${prefix}<span class="mc-slot-player-name vs-manage-player-name">${_vsEscape(name)}</span></div>
        ${ratingHtml}
        <button class="vs-remove-mini" onclick="vaultSlotsRemoveClaim('${c.id}','${slotId}')" title="Remove">−</button>
      </div>`;
    }).join('')}` : '';

  const genderOptions = [
    { val: 'Male',   label: t('male')   || 'Male',   icon: '♂' },
    { val: 'Female', label: t('female') || 'Female', icon: '♀' },
    { val: 'all',    label: t('both')   || 'Both',   icon: '👥' },
  ];
  const ratingOptions = [
    { val: '2', label: '2.0+' }, { val: '3', label: '3.0+' },
    { val: '4', label: '4.0+' }, { val: '0', label: t('any') || 'Any' },
  ];
  const curGender = slot.gender_filter || 'all';
  const curRating = String(Math.round(slot.min_rating || 0));
  const curVisibility = slot.visibility || 'private';
  _vsMgGenderChoice = curGender;
  _vsMgRatingChoice = curRating;
  _vsMgVisibilityChoice = curVisibility;

  overlay.innerHTML = `
    <div class="vs-manage-sheet" id="vsManageSheet">
      <div class="vs-sheet-handle"></div>
      <div class="vs-manage-header">
        <span class="vs-manage-title">${_vsEscape(slot.venue)} <span class="vs-status-badge ${isDraft ? 'vs-status-draft' : 'vs-status-posted'}">${isDraft ? (t('draft') || 'Draft') : (t('posted') || 'Posted')}</span></span>
        <button class="vs-manage-close" onclick="document.getElementById('vsManageOverlay').remove()">✕</button>
      </div>

      <div class="vs-manage-scroll">

        <!-- Edit venue -->
        <div class="vs-form-row">
          <label class="vs-form-label">${t('venue') || 'Venue'}</label>
          <input type="text" id="vsMgVenue" class="vs-form-input" value="${_vsEscape(slot.venue)}">
        </div>

        <!-- Edit times -->
        <div class="vs-form-row-split">
          <div>
            <label class="vs-form-label">${t('startTime') || 'Start time'}</label>
            <div class="vs-time-picker-field" id="vsMgStartField" onclick="vsTimePickerOpen('mgStart')">
              <span id="vsMgStartLabel">${_vsFormatTime(slot.start_time)}</span><span class="vs-time-chevron">▾</span>
            </div>
            <input type="hidden" id="vsMgStart" value="${(slot.start_time || '').slice(0,5)}">
          </div>
          <div>
            <label class="vs-form-label">${t('endTime') || 'End time'}</label>
            <div class="vs-time-picker-field" id="vsMgEndField" onclick="vsTimePickerOpen('mgEnd')">
              <span id="vsMgEndLabel">${_vsFormatTime(slot.end_time)}</span><span class="vs-time-chevron">▾</span>
            </div>
            <input type="hidden" id="vsMgEnd" value="${(slot.end_time || '').slice(0,5)}">
          </div>
        </div>

        <!-- Edit max players -->
        <div class="vs-form-row">
          <label class="vs-form-label">${t('maxPlayers') || 'Max players'}</label>
          <div class="vs-stepper">
            <button class="vs-stepper-btn" onclick="vaultSlotsMgAdjustMax(-1)">−</button>
            <div class="vs-stepper-value" id="vsMgMaxValue">${slot.max_players || 8}</div>
            <button class="vs-stepper-btn" onclick="vaultSlotsMgAdjustMax(1)">+</button>
          </div>
          <div class="vs-form-hint">2 – 20 ${t('players') || 'players'}</div>
        </div>

        <!-- Gender -->
        <div class="vs-form-row">
          <label class="vs-form-label">${t('gender') || 'Gender'}</label>
          <div class="vs-pill-row" id="vsMgGenderPills">
            ${genderOptions.map(o => `<button class="vs-pill${o.val === curGender ? ' vs-pill-active' : ''}" data-val="${o.val}" onclick="_vsMgSelectGender('${o.val}')">${o.icon} ${o.label}</button>`).join('')}
          </div>
        </div>

        <!-- Min rating -->
        <div class="vs-form-row">
          <label class="vs-form-label">${t('minRating') || 'Min Rating'}</label>
          <div class="vs-pill-row" id="vsMgRatingPills">
            ${ratingOptions.map(o => `<button class="vs-pill${o.val === curRating ? ' vs-pill-active' : ''}" data-val="${o.val}" onclick="_vsMgSelectRating('${o.val}')">${o.label}</button>`).join('')}
          </div>
          <div class="vs-form-hint">${t('minRatingHint') || 'Players must have this minimum rating to join.'}</div>
        </div>

        <!-- Visibility -->
        <div class="vs-form-row">
          <label class="vs-form-label">${t('visibility') || 'Visibility'}</label>
          <div class="vs-visibility-grid" id="vsMgVisibilityCards">
            <button class="vs-visibility-card ${curVisibility === 'public' ? 'vs-visibility-active' : ''}" data-val="public" onclick="_vsMgSelectVisibility('public')"><span class="vs-vis-icon">🌐</span><span><b>${t('public') || 'Public'}</b><small>${t('publicSlotHint') || 'Anyone can see and join this slot'}</small></span></button>
            <button class="vs-visibility-card ${curVisibility !== 'public' ? 'vs-visibility-active' : ''}" data-val="private" onclick="_vsMgSelectVisibility('private')"><span class="vs-vis-icon">🔒</span><span><b>${t('private') || 'Private'}</b><small>${t('privateSlotHint') || 'Only club players can see and join'}</small></span></button>
          </div>
        </div>

        <!-- Add Players -->
        <div class="vs-form-row vs-manage-add-players-block">
          <label class="vs-form-label">${t('players') || 'Players'}</label>
          <button type="button" class="vs-btn vs-btn-secondary vs-btn-main" onclick="vaultSlotsAddPlayersToManage('${slotId}')">👥 ${t('addPlayers') || 'Add Players'}</button>
        </div>

        <div id="vsMgFeedback" style="min-height:18px;font-size:0.82rem;margin-bottom:10px;color:var(--red)"></div>

        <div class="vs-manage-actions">
          <button class="vs-btn vs-btn-danger" onclick="vaultSlotsDeleteFromManage('${slotId}')">${t('delete') || 'Delete'}</button>
          <button class="vs-btn vs-btn-primary" onclick="vaultSlotsSaveManage('${slotId}', false)">${t('save') || 'Save'}</button>
          ${isDraft ? `<button class="vs-btn vs-btn-post" onclick="vaultSlotsSaveManage('${slotId}', true)">${t('post') || 'Post'}</button>` : ''}
        </div>

        <!-- Players -->
        <div class="vs-manage-players">
          ${playerRows(confirmedClaims, '✅ ' + (t('confirmed') || 'Confirmed') + ' (' + confirmedClaims.length + '/' + slot.max_players + ')')}
          ${playerRows(waitlistClaims,  '⏳ ' + (t('waiting') || 'Waiting') + ' (' + waitlistClaims.length + ')')}
          ${!claims.length ? '<div style="color:var(--text-dim);font-size:0.85rem;text-align:center;padding:12px 0">' + (t('noBookingsYet') || 'No bookings yet') + '</div>' : ''}
        </div>

      </div>
    </div>`;

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  document.getElementById('vsManageSheet').addEventListener('click', e => e.stopPropagation());
}

var _vsMgGenderChoice = 'all';
var _vsMgRatingChoice = '0';
var _vsMgVisibilityChoice = 'private';
var _vsMgSessionModeChoice = 'standard';

function _vsMgSelectGender(val) {
  _vsMgGenderChoice = val;
  var c = document.getElementById('vsMgGenderPills');
  if (c) {
    c.querySelectorAll('.vs-pill').forEach(btn => btn.classList.toggle('vs-pill-active', btn.dataset.val === val));
    _vsPositionSegThumb(c);
  }
  vaultSlotsDraftFieldChanged();
}
function _vsMgSelectRating(val) {
  _vsMgRatingChoice = val;
  var c = document.getElementById('vsMgRatingPills');
  if (c) {
    c.querySelectorAll('.vs-pill').forEach(btn => btn.classList.toggle('vs-pill-active', btn.dataset.val === val));
    _vsPositionSegThumb(c);
  }
  vaultSlotsDraftFieldChanged();
}
function _vsMgSelectVisibility(val) {
  _vsMgVisibilityChoice = val;
  var c = document.getElementById('vsMgVisibilityCards');
  if (c) {
    c.querySelectorAll('.vs-pill').forEach(btn => btn.classList.toggle('vs-pill-active', btn.dataset.val === val));
    _vsPositionSegThumb(c);
  }
  var hint = document.getElementById('vsMgVisibilityHint');
  if (hint) hint.textContent = val === 'public' ? (t('publicSlotHint') || 'Anyone can see and join this slot') : (t('privateSlotHint') || 'Only club players can see and join');
  vaultSlotsDraftFieldChanged();
}
function _vsMgSelectSessionMode(val) {
  _vsMgSessionModeChoice = _vsSlotSessionMode({ session_mode: val });
  var c = document.getElementById('vsMgSessionModePills');
  if (c) {
    c.querySelectorAll('.vs-pill').forEach(btn => btn.classList.toggle('vs-pill-active', btn.dataset.val === _vsMgSessionModeChoice));
    _vsPositionSegThumb(c);
  }
  vaultSlotsDraftFieldChanged();
}

function vaultSlotsDraftReadForm() {
  const draft = _vsManageDraft;
  if (!draft || !draft.slot) return null;
  const venue = document.getElementById('vsMgVenue')?.value.trim();
  const venueId = document.getElementById('vsMgVenueId')?.value.trim();
  const start = document.getElementById('vsMgStart')?.value;
  const end = document.getElementById('vsMgEnd')?.value;
  const max = parseInt(document.getElementById('vsMgMaxValue')?.textContent, 10);
  const courts = parseInt(document.getElementById('vsMgCourtValue')?.textContent, 10);
  const scheduledPostAt = _vsScheduledPostIsoFromInput(document.getElementById('vsMgScheduledPostAt')?.value || '');
  if (venue !== undefined) draft.slot.venue = venue;
  if (venueId !== undefined) draft.slot.venue_id = venueId || null;
  if (start) draft.slot.start_time = start;
  if (end) draft.slot.end_time = end;
  if (max) draft.slot.max_players = max;
  if (courts) draft.slot.court_count = Math.max(1, courts);
  draft.slot.gender_filter = _vsMgGenderChoice;
  draft.slot.min_rating = parseFloat(_vsMgRatingChoice) || 0;
  draft.slot.visibility = _vsMgVisibilityChoice || 'private';
  draft.slot.session_mode = _vsMgSessionModeChoice || 'standard';
  draft.slot.scheduled_post_at = scheduledPostAt;
  vaultSlotsDraftRebalance(draft);
  return draft;
}

function vaultSlotsDraftFieldChanged() {
  const draft = vaultSlotsDraftReadForm();
  if (draft) draft.dirty = true;
}

function vaultSlotsMgAdjustMax(delta) {
  const el = document.getElementById('vsMgMaxValue');
  if (!el) return;
  let val = parseInt(el.textContent || '8', 10) + delta;
  if (val < 2) val = 2;
  if (val > 20) val = 20;
  el.textContent = val;
  const draft = vaultSlotsDraftReadForm();
  if (draft) {
    draft.dirty = true;
    // Max-player changes can rebalance confirmed/waitlist players, but the
    // manage sheet itself must stay mounted. Re-rendering the whole sheet
    // reinitialises every segmented thumb and causes visible blinking.
    vaultSlotsRefreshManagePlayers(draft);
  }
}

function vaultSlotsMgAdjustCourts(delta) {
  const el = document.getElementById('vsMgCourtValue');
  if (!el) return;
  let val = parseInt(el.textContent || '1', 10) + delta;
  if (val < 1) val = 1;
  if (val > 20) val = 20;
  el.textContent = val;
  const draft = vaultSlotsDraftReadForm();
  if (draft) draft.dirty = true;
}

async function vaultSlotsDeleteFromManage(slotId) {
  if (!confirm(t('confirmDeleteSlot') || 'Delete this slot? This cannot be undone.')) return;
  try {
    await dbDeleteSlot(slotId);
    document.getElementById('vsManageOverlay')?.remove();
    await vaultSlotsRefresh();
  } catch (e) {
    alert(e.message || (t('somethingWentWrong') || 'Something went wrong'));
  }
}

async function vaultSlotsSaveManage(slotId, andPost) {
  const draft = vaultSlotsDraftReadForm();
  const slotData = (draft && String(draft.slotId) === String(slotId)) ? draft.slot : null;
  const venue = slotData ? String(slotData.venue || '').trim() : document.getElementById('vsMgVenue')?.value.trim();
  const start = slotData ? slotData.start_time : document.getElementById('vsMgStart')?.value;
  const end   = slotData ? slotData.end_time : document.getElementById('vsMgEnd')?.value;
  const max   = slotData ? parseInt(slotData.max_players || 0, 10) : parseInt(document.getElementById('vsMgMaxValue')?.textContent, 10);
  const courts = slotData ? _vsSlotCourtCount(slotData) : parseInt(document.getElementById('vsMgCourtValue')?.textContent || '1', 10);
  const fb    = document.getElementById('vsMgFeedback');
  const setFb = (msg, ok) => { if (fb) { fb.textContent = msg; fb.style.color = ok ? '#2dce89' : '#e63757'; } };

  if (!venue) { setFb(t('enterVenueName') || 'Enter venue name', false); return; }
  if (!start || !end) { setFb(t('enterSlotTimes') || 'Enter start and end time', false); return; }
  if (_vsTimeMinutes(end) <= _vsTimeMinutes(start)) { setFb(t('endTimeAfterStart') || 'End time must be after start time', false); return; }
  if (!max || max < 2) { setFb(t('enterMaxPlayers') || 'Enter max players', false); return; }
  const scheduleMode = andPost === 'scheduled';
  const scheduledPostAt = slotData ? slotData.scheduled_post_at : _vsScheduledPostIsoFromInput(document.getElementById('vsMgScheduledPostAt')?.value || '');
  if (scheduleMode && !scheduledPostAt) { setFb(t('enterScheduledPostTime') || 'Enter scheduled post time', false); return; }

  const payload = {
    venue, start_time: start, end_time: end, max_players: max,
    gender_filter: slotData ? (slotData.gender_filter || 'all') : _vsMgGenderChoice,
    min_rating: slotData ? (parseFloat(slotData.min_rating) || 0) : (parseFloat(_vsMgRatingChoice) || 0),
    visibility: slotData ? (slotData.visibility || 'private') : (_vsMgVisibilityChoice || 'private'),
    court_count: Math.max(1, parseInt(courts || 1, 10) || 1),
    session_mode: slotData ? _vsSlotSessionMode(slotData) : (_vsMgSessionModeChoice || 'standard'),
  };
  if (slotData && slotData.venue_id) payload.venue_id = slotData.venue_id;
  if (andPost === true) {
    payload.status = 'posted';
    payload.scheduled_post_at = null;
  } else if (scheduleMode) {
    payload.status = 'scheduled';
    payload.scheduled_post_at = scheduledPostAt;
  } else if (slotData && String(slotData.status || '').toLowerCase() === 'scheduled') {
    payload.scheduled_post_at = scheduledPostAt || null;
  }

  setFb(andPost === true ? (t('postingDot') || 'Posting...') : (t('savingDot') || 'Saving...'), true);
  try {
    await sbPatch('slots', `id=eq.${slotId}`, payload);
    if (draft && String(draft.slotId) === String(slotId)) {
      const removedIds = Array.from(draft.removedClaimIds || []);
      if (removedIds.length) {
        await Promise.all(removedIds.map(id => sbPatch('slot_claims', `id=eq.${id}`, { status: 'cancelled' })));
      }
      const addedPlayers = (draft.slot.claims || [])
        .filter(c => c && c._draftAdded)
        .map(c => c._draftPlayer || {
          displayName: c.player && c.player.name,
          playerId: c.player_id,
          gender: c.player && c.player.gender,
          rating: c.player && c.player.clubRating
        });
      if (addedPlayers.length) await vaultSlotsAddPlayersToExistingSlot(slotId, addedPlayers);
      else await vaultSlotsRebalanceClaims(slotId);
    } else {
      await vaultSlotsRebalanceClaims(slotId);
    }
    setFb('OK ' + (andPost === true ? (t('slotPosted') || 'Slot posted') : (scheduleMode ? (t('slotScheduled') || 'Slot scheduled') : (t('saved') || 'Saved!'))), true);
    const refreshedSlot = await vaultSlotsLoadOne(slotId).catch(() => null);
    if (refreshedSlot) vaultSlotsCacheSlot(refreshedSlot);
    if (andPost === true || scheduleMode) {
      _vsManageDraft = null;
      await vaultSlotsViewSlot(slotId);
    } else if (refreshedSlot) {
      _vsManageDraft = vaultSlotsCreateManageDraft(refreshedSlot);
      vaultSlotsRefreshManagePlayers(_vsManageDraft);
      setFb(t('saved') || 'Saved!', true);
    }
    vaultSlotsScheduleSoftRefresh(slotId);
  } catch(e) { setFb('Failed: ' + e.message, false); }
}
async function vaultSlotsRemoveClaim(claimId, slotId) {
  if (!confirm('Remove this player from the slot?')) return;
  if (vaultSlotsDraftRemoveClaim(claimId, slotId)) return;
  try {
    await sbPatch('slot_claims', `id=eq.${claimId}`, { status: 'cancelled' });
    await vaultSlotsRebalanceClaims(slotId);
    await vaultSlotsViewSlot(slotId);
    vaultSlotsScheduleSoftRefresh(slotId);
  } catch(e) { alert('Failed to remove: ' + e.message); }
}

async function vaultSlotsStartRoundsFromSlot(slotId) {
  const club = (typeof getMyClub === 'function') ? getMyClub() : null;
  if (!club || !club.id) { alert(t('noClubSelected') || 'No club selected'); return; }
  if (typeof schedulerState === 'undefined' || typeof goToRounds !== 'function') {
    alert(t('roundsUnavailable') || 'Rounds are not available yet.');
    return;
  }
  if (schedulerState.mbmActive) {
    alert(t('rollingActiveEndFirst') || 'Rolling Matches session is active. Please end it first.');
    return;
  }

  try {
    const slot = await vaultSlotsLoadOne(slotId);
    if (!slot) throw new Error('Slot not found');
    if (slot.played_session_id || String(slot.status || '').toLowerCase() === 'played') {
      alert(t('slotAlreadyStarted') || 'This slot has already been started.');
      if (typeof renderLauncherStartSessionCard === 'function') renderLauncherStartSessionCard();
      if (typeof renderDashboard === 'function') renderDashboard();
      return;
    }
    const sessionMode = _vsSlotSessionMode(slot);
    const claims = (slot.claims || []).filter(c => c.status === 'confirmed');

    // Use the same permission rule as the Dashboard Start Session action:
    // the signed-in player must be one of the confirmed slot players.
    const authUser = (typeof authGetUser === 'function') ? authGetUser() : null;
    if (authUser && authUser.id) {
      const myMemberships = await sbGet('memberships',
        `club_id=eq.${club.id}&user_account_id=eq.${authUser.id}&select=player_id`
      ).catch(() => []);
      const myPlayerIds = new Set((myMemberships || []).map(m => String(m.player_id || '')).filter(Boolean));
      const joined = claims.some(c => myPlayerIds.has(String(c.player_id || '')));
      if (!joined) {
        alert(t('joinSlotToStart') || 'Join this slot to start');
        return;
      }
    }
    const playerIds = [...new Set((claims || []).map(c => c.player_id).filter(Boolean).map(String))];
    if (playerIds.length < 4) {
      alert(t('need4ConfirmedSlotPlayers') || 'Need at least 4 confirmed players to start rounds from this slot.');
      return;
    }

    const members = await sbGet('memberships',
      `club_id=eq.${club.id}&player_id=in.(${playerIds.join(',')})&select=player_id,nickname,club_rating,players(id,gender,global_rating)`
    ).catch(() => []);
    const memberByPlayer = {};
    (members || []).forEach(m => { memberByPlayer[String(m.player_id)] = m; });
    const players = _vsSortClaimsQueue(claims || [])
      .filter(c => c && c.player_id && (memberByPlayer[String(c.player_id)] || c.player))
      .map(c => {
        const m = memberByPlayer[String(c.player_id)];
        const meta = c.player || {};
        const isGuest = !m && !!meta.guest;
        const rating = isGuest ? null : (parseFloat(m && m.club_rating) || parseFloat(meta.clubRating) || parseFloat(m && m.players && m.players.global_rating) || 1.0);
        return {
          name: (m && m.nickname) || meta.name || String(c.player_id),
          gender: (m && m.players && m.players.gender) || meta.gender || 'Male',
          rating,
          clubRating: rating,
          activeRating: rating,
          guest: isGuest,
          unrated: isGuest,
          active: true
        };
      });

    const unique = [];
    const seen = new Set();
    players.forEach(p => {
      const key = String(p.name || '').trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      unique.push(p);
    });

    if (unique.length < 4) {
      alert(t('need4ConfirmedClubPlayers') || 'Need at least 4 confirmed club players to start rounds from this slot.');
      return;
    }

    const hasExistingSession = (Array.isArray(allRounds) && allRounds.length > 0) ||
      (schedulerState.allPlayers && schedulerState.allPlayers.length > 0);
    if (hasExistingSession && !confirm(t('startSlotReplaceConfirm') || 'Start rounds from this slot? This will replace the current session players and reset current rounds.')) {
      return;
    }

    // Create and link the live session before changing the local round state.
    // This prevents a failed DB start from merely importing players and allows
    // the slot to become unavailable immediately after a successful start.
    if (typeof setMySessionId === 'function') setMySessionId(null);
    const sessionId = (typeof dbStartSession === 'function') ? await dbStartSession(slotId) : null;
    if (!sessionId) {
      alert(t('linkedSessionCreateFailed') || 'Could not create a linked session for this slot. Please check connection and try again.');
      return;
    }

    schedulerState.allPlayers.splice(0, schedulerState.allPlayers.length, ...unique);
    schedulerState.activeplayers.splice(
      0, schedulerState.activeplayers.length,
      ...unique.filter(p => p.active).map(p => p.name).reverse()
    );
    if (typeof allRounds !== 'undefined') allRounds.length = 0;
    if (typeof currentRoundIndex !== 'undefined') currentRoundIndex = 0;
    if (typeof _lastRenderedRoundIndex !== 'undefined') _lastRenderedRoundIndex = -1;
    if (typeof sessionFinished !== 'undefined') sessionFinished = false;
    if (typeof currentState !== 'undefined') currentState = 'idle';
    if (typeof roundActive !== 'undefined') roundActive = false;
    schedulerState.mbmActive = false;
    schedulerState.fixedPairs = [];

    const allowedCourts = Math.max(1, Math.floor(unique.length / 4));
    const courts = Math.max(1, Math.min(_vsSlotCourtCount(slot), allowedCourts));
    const courtEl = document.getElementById('num-courts');
    if (courtEl) courtEl.textContent = courts;
    const stepCourtEl = document.getElementById('stepNumCourts');
    if (stepCourtEl) stepCourtEl.textContent = courts;

    if (typeof updatePlayerList === 'function') updatePlayerList();
    if (typeof updateFixedPairSelectors === 'function') updateFixedPairSelectors();
    if (typeof clearFixedPairsUI === 'function') clearFixedPairsUI();
    if (typeof syncRatings === 'function') syncRatings();
    if (typeof homeUpdateStepper === 'function') homeUpdateStepper();
    if (typeof dbClaimSessionSlots === 'function') dbClaimSessionSlots(unique.map(p => p.name));
    if (typeof saveRoundsToDb === 'function') await saveRoundsToDb();

    // Refresh both cards from the DB immediately. The linked slot is now marked
    // played, so it disappears and cannot be started a second time.
    if (typeof renderLauncherStartSessionCard === 'function') renderLauncherStartSessionCard();
    if (typeof renderDashboard === 'function') renderDashboard();

    document.getElementById('vsManageOverlay')?.remove();
    const dateSheet = document.getElementById('vsDateSheetOverlay');
    if (dateSheet) dateSheet.style.display = 'none';
    if (sessionMode === 'rolling') {
      if (typeof mbmGo !== 'function') {
        alert(t('roundsUnavailable') || 'Rounds are not available yet.');
        return;
      }
      await mbmGo();
      if (typeof saveRoundsToDb === 'function') await saveRoundsToDb();
    } else {
      if (typeof setGameGenerationMode === 'function') {
        setGameGenerationMode(sessionMode === 'balanced' ? 'balanced' : 'standard', true);
      }
      if (typeof homeHideScreen === 'function') homeHideScreen();
      if (typeof showPage === 'function') showPage('roundsPage', document.getElementById('tabBtnRounds'));
    }
  } catch (e) {
    alert((t('failedStartSlotRounds') || 'Failed to start rounds from slot: ') + (e.message || e));
  }
}

async function vaultSlotsRefresh() {
  await vaultSlotsRenderMonth();
  const sheet = document.getElementById('vsDateSheetOverlay');
  if (_vsSelectedDateStr && sheet && sheet.style.display !== 'none') {
    vaultSlotsOpenDateSheet(_vsSelectedDateStr);
  }
  const vaultHome = document.getElementById('vaultUpcomingSlots');
  if (vaultHome && vaultHome.offsetParent !== null && typeof renderVaultHomeSlotsUI === 'function') {
    await renderVaultHomeSlotsUI(true);
  }
  if (typeof myCardSlotsScheduleRefresh === 'function') myCardSlotsScheduleRefresh(true);
  const dashPage = document.getElementById('dashboardPage');
  if (dashPage && dashPage.style.display !== 'none' && typeof renderDashboard === 'function') {
    renderDashboard();
  }
}

function vaultSlotsCloseDateSheet(e) {
  if (e && e.target !== document.getElementById('vsDateSheetOverlay')) return;

  // Create Slot is a child sheet of Slot Manager.  Closing this sheet must
  // always return to Slot Manager, including when Slot Manager itself was
  // opened from Assist.  The Slot Manager close button is responsible for
  // returning one level further to Assist.  Previously this function consumed
  // scs_slot_from_assist and closed the entire Slot Manager, which caused the
  // same blank/incorrect-return behavior that Round Manager Assist used to
  // have.
  if (typeof vsTimePickerClose === 'function') vsTimePickerClose();
  if (typeof vaultSlotsCloseVenuePicker === 'function') vaultSlotsCloseVenuePicker();
  var importModal = document.getElementById('newImportModal');
  if (importModal && importModal.dataset && importModal.dataset.returnMode === 'vaultSlot') {
    if (typeof newImportHideModal === 'function') newImportHideModal();
    else importModal.style.display = 'none';
  }

  const overlay = document.getElementById('vsDateSheetOverlay');
  if (overlay) overlay.style.display = 'none';
}

/* ══════════════════════════════════════════════
   SMALL HELPERS
══════════════════════════════════════════════ */
function _vsEscape(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
function _vsFormatTime(t24) {
  if (!t24) return '';
  const [h, m] = t24.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + ':' + String(m).padStart(2, '0') + ' ' + period;
}

/* Hook: whenever the Slots page is shown via homeGo(), load the calendar */
document.addEventListener('DOMContentLoaded', function() {
  var origHomeGo = window.homeGo;
  if (typeof origHomeGo === 'function') {
    window.homeGo = function(pageId, tabId) {
      origHomeGo(pageId, tabId);
      if (pageId === 'vaultSlotsPage') vaultSlotsOpenPage();
    };
  }
});

/* ══════════════════════════════════════════════
   VIEWER MYCARD SLOTS — join-side calendar + booking
   Rules:
     - MyCard only shows posted, future slots the player can join.
     - Gender filter must match unless slot is "all".
     - Min rating uses club_rating from memberships.
     - Already joined slots are always shown so player can manage status.
     - If confirmed seats are full, joining creates waitlist status.
══════════════════════════════════════════════ */
var _mcsCalYear = null;
var _mcsCalMonth = null; // 0-11
var _mcsSelectedDateStr = null;
var _mcsSlotsByDate = {};
var _mcsCurrentPlayer = null; // kept for backward compatibility; first membership/player
var _mcsPublicPlayer = null;  // separate no-membership guest player for public non-club joins
var _mcsCurrentPlayersByClub = {};
var _mcsClubsById = {};
var _mcsBusySlotId = null;
var _mcsProbabilityBusyClaimId = null;
var _mcsExpandedSlotId = null;
var _mcsCarouselSlotId = null;
var _mcsAutoSyncTimer = null;
var _mcsAutoSyncBusy = false;
var _mcsLastAutoSyncAt = 0;
// Build 490: no independent Profile/My slots sync interval.
// Automatic refresh is controlled only by the Settings sync gateway.
var _mcsDebugInfo = null; // temporary diagnostics for club filtering
var _mcsRefreshQueued = false;
var _mcsRefreshTimer = null;
var _mcsDataSignature = '';
var _mcsManualRefreshBusy = false;
var _mcsSlotView = (function() {
  try { return localStorage.getItem('scs_my_slots_view') === 'all' ? 'all' : 'upcoming'; }
  catch (e) { return 'upcoming'; }
})();
var _mcsSlotLayout = (function() {
  try { return localStorage.getItem('scs_my_slots_layout') === 'calendar' ? 'calendar' : 'compact'; }
  catch (e) { return 'compact'; }
})();

function _mcsUpdateLayoutControls() {
  var compactBtn = document.getElementById('mcSlotsLayoutCompact');
  var calendarBtn = document.getElementById('mcSlotsLayoutCalendar');
  var panel = document.querySelector('#mcUpcomingSlots .mc-slots-calendar-panel');
  var isCalendar = _mcsSlotLayout === 'calendar';
  if (compactBtn) { compactBtn.classList.toggle('is-active', !isCalendar); compactBtn.setAttribute('aria-selected', isCalendar ? 'false' : 'true'); }
  if (calendarBtn) { calendarBtn.classList.toggle('is-active', isCalendar); calendarBtn.setAttribute('aria-selected', isCalendar ? 'true' : 'false'); }
  if (panel) panel.hidden = !isCalendar;
}

function myCardSlotsSetLayout(layout) {
  var next = layout === 'calendar' ? 'calendar' : 'compact';
  if (_mcsSlotLayout === next) return;
  _mcsSlotLayout = next;
  try { localStorage.setItem('scs_my_slots_layout', next); } catch (e) {}
  _mcsUpdateLayoutControls();
  renderMyCardSlotsUI(false);
}

function _mcsIsPlayedForViewer(slot) {
  if (!_mcsIsPlayedSlot(slot)) return false;

  // Build 895: played history must survive payment.  The pending-payment view
  // intentionally disappears after paid_at is set, but All Slots is history and
  // must keep the same linked slot.  Read the raw claim here instead of relying
  // on _mcsViewerClaim(), whose active-claim helper is intended for live/join UI.
  var player = _mcsPlayerForSlot(slot);
  var playerId = player && player.playerId;
  if (!playerId) return false;

  var claim = (slot.claims || []).find(function(c) {
    if (!c || String(c.player_id) !== String(playerId)) return false;
    var status = String(c.status || '').toLowerCase();
    return status === 'confirmed' || !!c.paid_at;
  });
  return !!claim;
}

function _mcsUpdateViewControls() {
  var upcomingBtn = document.getElementById('mcSlotsFilterUpcoming');
  var allBtn = document.getElementById('mcSlotsFilterAll');
  var title = document.querySelector('#mcUpcomingSlots .mc-slots-title');
  var isAll = _mcsSlotView === 'all';
  if (upcomingBtn) { upcomingBtn.classList.toggle('is-active', !isAll); upcomingBtn.setAttribute('aria-selected', isAll ? 'false' : 'true'); }
  if (allBtn) { allBtn.classList.toggle('is-active', isAll); allBtn.setAttribute('aria-selected', isAll ? 'true' : 'false'); }
  if (title) title.textContent = isAll ? (t('allSlotsTitle') || '📅 All Slots') : (t('upcomingSlotsTitle') || '📅 Upcoming Slots');
}

function myCardSlotsSetView(view) {
  var next = view === 'all' ? 'all' : 'upcoming';
  if (_mcsSlotView === next) return;
  _mcsSlotView = next;
  try { localStorage.setItem('scs_my_slots_view', next); } catch (e) {}
  _mcsCarouselSlotId = null;
  _mcsSelectedDateStr = null;
  _mcsUpdateViewControls();
  renderMyCardSlotsUI(true);
}



/* ── Slots-only in-app announcement popup ─────────────────────────────
   Shows a one-time popup to players when a new posted future slot appears.
   Uses localStorage only, so no DB migration is needed.
*/
var _mcsSlotAnnouncementBusy = false;

function _mcsCurrentUserKey() {
  try {
    var u = (typeof authGetUser === 'function') ? authGetUser() : null;
    u = u || window.currentUser || null;
    return String((u && (u.id || u.user_id || u.uid || u.email)) || '').trim();
  } catch(e) { return ''; }
}

function _mcsIsOwnCreatedSlot(slot) {
  if (!slot) return false;
  var uid = _mcsCurrentUserKey();
  if (!uid) return false;
  return String(slot.created_by || slot.createdBy || slot.creator_id || '').trim() === uid;
}

function _mcsSlotAnnouncementKey() {
  return 'scs_seen_slot_announcements_' + String(_mcsCurrentUserKey() || 'guest');
}

function _mcsGetSeenSlotAnnouncements() {
  try {
    var raw = localStorage.getItem(_mcsSlotAnnouncementKey());
    var arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch(e) { return []; }
}

function _mcsMarkSlotAnnouncementSeen(slotId) {
  if (!slotId) return;
  try {
    var seen = _mcsGetSeenSlotAnnouncements();
    var sid = String(slotId);
    if (seen.indexOf(sid) < 0) seen.unshift(sid);
    localStorage.setItem(_mcsSlotAnnouncementKey(), JSON.stringify(seen.slice(0, 250)));
  } catch(e) {}
}

function _mcsFlattenVisibleSlots() {
  var out = [];
  Object.keys(_mcsSlotsByDate || {}).forEach(function(dateStr) {
    (_mcsSlotsByDate[dateStr] || []).forEach(function(slot) { if (slot) out.push(slot); });
  });
  return out;
}

function _mcsFindUnseenPostedSlot() {
  var seen = _mcsGetSeenSlotAnnouncements();
  var slots = _mcsFlattenVisibleSlots().filter(function(slot) {
    if (!slot || !slot.id) return false;
    if (seen.indexOf(String(slot.id)) >= 0) return false;
    if (!_mcsIsPostedFutureSlot(slot)) return false;
    // Do not popup for slots created by this same logged-in user.
    if (_mcsIsOwnCreatedSlot(slot)) return false;
    // Do not popup for slots the viewer already joined/waitlisted.
    return !_mcsViewerClaim(slot);
  });
  slots.sort(function(a, b) {
    return String(a.slot_date || '').localeCompare(String(b.slot_date || '')) ||
      String(a.start_time || '').localeCompare(String(b.start_time || ''));
  });
  return slots[0] || null;
}

function _mcsShowSlotAnnouncement(slot) {
  if (!slot || !slot.id || document.getElementById('mcsSlotAnnouncementOverlay')) return;
  var club = _mcsClubForSlot(slot);
  var confirmed = Number(slot.confirmedCount || 0);
  var max = Number(slot.max_players || 0);
  var date = String(slot.slot_date || '');
  var prettyDate = date;
  try {
    var d = new Date(date + 'T00:00:00');
    prettyDate = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  } catch(e) {}
  var overlay = document.createElement('div');
  overlay.id = 'mcsSlotAnnouncementOverlay';
  overlay.className = 'mcs-ann-overlay';
  overlay.innerHTML =
    '<div class="mcs-ann-card">' +
      '<div class="mcs-ann-kicker">📢 ' + _vsEscape(t('newSlot') || 'New Slot') + '</div>' +
      '<div class="mcs-ann-title">' + _vsEscape(club.name || 'Club') + '</div>' +
      '<div class="mcs-ann-row"><span>📅</span><strong>' + _vsEscape(prettyDate) + '</strong></div>' +
      '<div class="mcs-ann-row"><span>🕒</span><strong>' + _vsEscape(_vsFormatTime(slot.start_time) + ' – ' + _vsFormatTime(slot.end_time)) + '</strong></div>' +
      '<div class="mcs-ann-row"><span>📍</span><strong>' + _vsEscape(slot.venue || '') + '</strong></div>' +
      '<div class="mcs-ann-pills">' +
        '<span>' + _vsEscape(_vsSlotVisibilityLabel(slot)) + '</span>' +
        '<span>' + _vsEscape(_vsSlotGenderLabel(slot)) + '</span>' +
        '<span>' + confirmed + '/' + (max || '—') + '</span>' +
      '</div>' +
      '<div class="mcs-ann-actions">' +
        '<button class="mcs-ann-later" onclick="_mcsDismissSlotAnnouncement(\'' + _vsEscape(slot.id) + '\', false)">' + _vsEscape(t('later') || 'Later') + '</button>' +
        '<button class="mcs-ann-view" onclick="_mcsDismissSlotAnnouncement(\'' + _vsEscape(slot.id) + '\', true)">' + _vsEscape(t('viewSlot') || 'View Slot') + '</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
}

function _mcsDismissSlotAnnouncement(slotId, viewSlot) {
  _mcsMarkSlotAnnouncementSeen(slotId);
  var overlay = document.getElementById('mcsSlotAnnouncementOverlay');
  if (overlay) overlay.remove();
  if (!viewSlot) return;
  var target = null;
  _mcsFlattenVisibleSlots().some(function(slot) {
    if (String(slot && slot.id) === String(slotId)) { target = slot; return true; }
    return false;
  });
  if (target) {
    _mcsSelectedDateStr = target.slot_date || _mcsSelectedDateStr;
    _mcsExpandedSlotId = String(target.id || slotId);
    renderMyCardSlotsUI(false);
    setTimeout(function() {
      var el = document.querySelector('.mc-slot-card[data-slot-id="' + String(slotId).replace(/"/g, '\\"') + '"]');
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
  }
}

function _mcsMaybeShowSlotAnnouncement() {
  // Global notifications.js now owns slot popups app-wide.
  // Keep this function as a no-op so MyCard/Slots rendering does not show
  // duplicate popups or accidentally notify for drafts while a page refreshes.
  if (window.__scsGlobalNotificationsLoaded) return;
  if (_mcsSlotAnnouncementBusy) return;
  _mcsSlotAnnouncementBusy = true;
  setTimeout(function() {
    _mcsSlotAnnouncementBusy = false;
    var slot = _mcsFindUnseenPostedSlot();
    if (slot) _mcsShowSlotAnnouncement(slot);
  }, 250);
}

function myCardSlotsChangeMonth(delta) {
  var today = new Date();
  if (_mcsCalYear === null || _mcsCalMonth === null) {
    _mcsCalYear = today.getFullYear();
    _mcsCalMonth = today.getMonth();
  }
  _mcsCalMonth += delta;
  if (_mcsCalMonth < 0) { _mcsCalMonth = 11; _mcsCalYear--; }
  if (_mcsCalMonth > 11) { _mcsCalMonth = 0; _mcsCalYear++; }
  _mcsSelectedDateStr = null;
  _mcsCarouselSlotId = null;
  renderMyCardSlotsUI(true);
}
function mcSlotsChangeMonth(delta) { myCardSlotsChangeMonth(delta); }

function myCardSlotsSelectDate(dateStr) {
  _mcsSelectedDateStr = dateStr;
  _mcsCarouselSlotId = null;

  // Next-month dates can appear in the last row.
  // When tapped, move the calendar to that month and load its slots.
  var d = new Date(String(dateStr || '') + 'T00:00:00');
  if (!isNaN(d.getTime()) &&
      (d.getFullYear() !== _mcsCalYear || d.getMonth() !== _mcsCalMonth)) {
    _mcsCalYear = d.getFullYear();
    _mcsCalMonth = d.getMonth();
    renderMyCardSlotsUI(true);
    return;
  }

  renderMyCardSlotsUI(false);
}
function mcSlotsSelectDate(dateStr) { myCardSlotsSelectDate(dateStr); }

function myCardSlotsToggleDetails(slotId) {
  slotId = String(slotId || '');
  _mcsCarouselSlotId = slotId;
  _mcsExpandedSlotId = (_mcsExpandedSlotId === slotId) ? null : slotId;
  renderMyCardSlotsUI(false);
}
function mcSlotsToggleDetails(slotId) { myCardSlotsToggleDetails(slotId); }

function _mcsIsViewerSlotsVisible() {
  var section = document.getElementById('mcUpcomingSlots');
  if (!section) return false;
  if (section.style.display === 'none') return false;
  var home = document.getElementById('homePageOverlay');
  if (home && home.style.display === 'none') return false;
  if (typeof appMode !== 'undefined' && appMode === 'vault') return false;
  if (typeof appMode !== 'undefined' && appMode === 'organiser') return false;
  if (typeof authIsLoggedIn === 'function' && !authIsLoggedIn()) return false;
  return true;
}

async function myCardSlotsRefreshAll(force) {
  // Single refresh path for MyCard/Profile slots.
  // This reloads the slot cache and redraws BOTH the calendar and selected-day list,
  // so dots, colors, counts, button state, and expanded player lists stay in sync.
  if (_mcsAutoSyncBusy) {
    _mcsRefreshQueued = true;
    return;
  }
  if (!_mcsIsViewerSlotsVisible() && !force) return;

  var now = Date.now();
  if (!force && now - _mcsLastAutoSyncAt < 3000) return;

  _mcsAutoSyncBusy = true;
  _mcsLastAutoSyncAt = now;
  try {
    await renderMyCardSlotsUI(force ? true : 'quiet');
  } catch (e) {
    // Keep the Profile page quiet; the next sync will retry.
  } finally {
    _mcsAutoSyncBusy = false;
    if (_mcsRefreshQueued) {
      _mcsRefreshQueued = false;
      setTimeout(function(){ myCardSlotsRefreshAll(true); }, 100);
    }
  }
}

async function myCardSlotsManualRefresh() {
  if (_mcsManualRefreshBusy) return;
  _mcsManualRefreshBusy = true;
  var btn = document.getElementById('mcSlotsRefreshBtn');
  if (btn) {
    btn.classList.add('is-refreshing');
    btn.disabled = true;
  }
  try {
    await myCardSlotsRefreshAll(true);
  } finally {
    _mcsManualRefreshBusy = false;
    if (btn) {
      btn.classList.remove('is-refreshing');
      btn.disabled = false;
    }
  }
}

function myCardSlotsScheduleRefresh(force) {
  if (_mcsRefreshTimer) clearTimeout(_mcsRefreshTimer);
  _mcsRefreshTimer = setTimeout(function() {
    _mcsRefreshTimer = null;
    myCardSlotsRefreshAll(!!force);
  }, force ? 80 : 500);
}

async function myCardSlotsAutoSyncNow(force) {
  return myCardSlotsRefreshAll(force);
}

function myCardSlotsStartAutoSync() {
  // Intentionally no timer here. The Settings sync gateway is the only
  // automatic scheduler, so the selected interval (including Never) is obeyed.
  if (_mcsAutoSyncTimer) clearInterval(_mcsAutoSyncTimer);
  _mcsAutoSyncTimer = null;
}

function myCardSlotsStopAutoSync() {
  if (_mcsAutoSyncTimer) clearInterval(_mcsAutoSyncTimer);
  _mcsAutoSyncTimer = null;
}

function _mcsNormalizeGender(g) {
  g = String(g || '').trim().toLowerCase();
  if (g === 'f' || g === 'female' || g === 'woman' || g === 'women') return 'Female';
  if (g === 'm' || g === 'male' || g === 'man' || g === 'men') return 'Male';
  return g ? (g.charAt(0).toUpperCase() + g.slice(1)) : 'Male';
}

function _mcsPlayerGenderKey(player) {
  var g = String((player && player.gender) || '').trim().toLowerCase();
  if (g === 'm' || g === 'male' || g === 'man' || g === 'men') return 'men';
  if (g === 'f' || g === 'female' || g === 'woman' || g === 'women') return 'women';
  return '';
}

function _mcsClubColor(index) {
  var colors = ['#4a9eff', '#8b5cf6', '#ef4444', '#14b8a6', '#f59e0b', '#ec4899', '#22c55e', '#6366f1', '#06b6d4', '#f97316'];
  return colors[Math.abs(Number(index) || 0) % colors.length];
}

async function _mcsGetPlayerClubMemberships() {
  var user = (typeof authGetUser === 'function') ? authGetUser() : null;
  if (!user || typeof sbGet !== 'function') return [];

  // Profile/MyCard is player based.  The correct first source of truth is
  // memberships.user_account_id, because this is how the logged-in app user is
  // linked to a club player.  Do not depend on Vault/getMyClub() here.
  var userIds = [];
  function addUserId(v) {
    v = String(v || '').trim();
    if (v && userIds.indexOf(v) < 0) userIds.push(v);
  }
  addUserId(user.id);
  addUserId(user.userId);
  addUserId(user.account_id);
  addUserId(user.user_account_id);

  var selectPlain = 'select=id,club_id,player_id,nickname,club_rating,user_account_id';
  var rows = [];
  var seen = {};

  function addRows(list) {
    (list || []).forEach(function(m) {
      if (!m || !m.club_id) return;
      var playerKey = m.player_id ? String(m.player_id) : ('nick:' + String(m.nickname || ''));
      var key = String(m.club_id) + '|' + playerKey;
      if (seen[key]) return;
      seen[key] = true;
      rows.push(m);
    });
  }

  // Use the same simple membership source as the My Clubs screen first.  A club
  // membership is enough to show private slots, even if older rows are missing
  // player_id or rating details.
  if (user.id) {
    var simpleLinked = await sbGet('memberships',
      'user_account_id=eq.' + user.id + '&select=id,club_id,player_id,nickname,club_rating,user_account_id'
    ).catch(function(e) {
      console.log('[MyCardSlots] simple membership lookup failed', e);
      return [];
    });
    addRows(simpleLinked);
  }

  // 1) Normal path: linked memberships for this logged-in account.
  for (var ui = 0; ui < userIds.length; ui++) {
    var linked = await sbGet('memberships',
      'user_account_id=eq.' + encodeURIComponent(userIds[ui]) + '&' + selectPlain + '&order=nickname.asc'
    ).catch(function(e) {
      console.log('[MyCardSlots] linked membership lookup failed', e);
      return [];
    });
    addRows(linked);
  }

  // 2) Nickname fallback for older rows that are not linked yet. This must only
  // accept unlinked rows or rows already linked to this login.
  var names = [];
  function addName(v) {
    v = String(v || '').trim();
    if (!v) return;
    var exists = names.some(function(n){ return n.toLowerCase() === v.toLowerCase(); });
    if (!exists) names.push(v);
  }
  var profile = (typeof getMyPlayer === 'function') ? getMyPlayer() : null;
  addName(user.nickname);
  addName(user.displayName);
  addName(user.name);
  addName(profile && profile.name);
  addName(profile && profile.nickname);
  addName(profile && profile.displayName);
  (rows || []).forEach(function(m){ addName(m.nickname); });

  for (var ni = 0; ni < names.length; ni++) {
    var byNick = await sbGet('memberships',
      'nickname=ilike.' + encodeURIComponent(names[ni]) + '&' + selectPlain + '&order=nickname.asc'
    ).catch(function(){ return []; });

    byNick = (byNick || []).filter(function(m) {
      if (!m.user_account_id) return true;
      return userIds.indexOf(String(m.user_account_id)) >= 0;
    });
    addRows(byNick);
  }

  // 3) Player-account fallback, for schemas where players are linked but
  // memberships are not.
  for (var pi = 0; pi < userIds.length; pi++) {
    var linkedPlayers = await sbGet('players',
      'user_account_id=eq.' + encodeURIComponent(userIds[pi]) + '&select=id,gender,global_rating'
    ).catch(function(){ return []; });
    var pids = [...new Set((linkedPlayers || []).map(function(p){ return p && p.id; }).filter(Boolean).map(String))];
    if (pids.length) {
      var byPlayer = await sbGet('memberships',
        'player_id=in.(' + pids.join(',') + ')&' + selectPlain + '&order=nickname.asc'
      ).catch(function(){ return []; });
      addRows(byPlayer);
    }
  }

  if (!rows.length) {
    console.log('[MyCardSlots] no memberships found for user', user);
    return [];
  }

  var bestByClub = {};
  rows.forEach(function(m) {
    var cid = String(m.club_id || '');
    if (!cid) return;
    var existing = bestByClub[cid];
    if (!existing || (!existing.player_id && m.player_id)) bestByClub[cid] = m;
  });
  rows = Object.keys(bestByClub).map(function(cid) { return bestByClub[cid]; });

  // Best effort: link unlinked nickname matches to this account.
  var primaryUserId = userIds[0] || null;
  if (primaryUserId && typeof sbPatch === 'function') {
    rows.forEach(function(m) {
      if (!m.user_account_id && m.id) {
        sbPatch('memberships', 'id=eq.' + m.id, { user_account_id: primaryUserId }).catch(function(){});
      }
    });
  }

  var playerIds = [...new Set(rows.map(function(m){ return m.player_id; }).filter(Boolean).map(String))];
  var playerMap = {};
  if (playerIds.length) {
    var players = await sbGet('players',
      'id=in.(' + playerIds.join(',') + ')&select=id,gender,global_rating'
    ).catch(function(){ return []; });
    (players || []).forEach(function(p){ playerMap[String(p.id)] = p; });
  }

  var clubIds = [...new Set(rows.map(function(m){ return String(m.club_id); }).filter(Boolean))];
  var clubMap = {};
  if (clubIds.length) {
    var clubs = await sbGet('clubs', 'id=in.(' + clubIds.join(',') + ')&select=id,name').catch(function(){ return []; });
    (clubs || []).forEach(function(c){ clubMap[String(c.id)] = c; });
  }

  var profileGender = (profile && profile.gender) || null;
  return rows.map(function(m, idx) {
    var cid = String(m.club_id);
    var club = clubMap[cid] || { id: cid, name: 'Club' };
    var prow = playerMap[String(m.player_id)] || {};
    return {
      membershipId: m.id,
      clubId: cid,
      clubName: club.name || ('Club ' + (idx + 1)),
      clubColor: _mcsClubColor(idx),
      playerId: m.player_id,
      name: m.nickname || user.nickname || 'Player',
      gender: _mcsNormalizeGender(prow.gender || profileGender),
      clubRating: parseFloat(m.club_rating) || 1.0
    };
  });
}
async function _mcsResolveActiveClub() {
  // Vault uses one selected club. MyCard no longer depends on this, but keep
  // the function for old calls and for join/cancel fallbacks.
  var club = (typeof getMyClub === 'function') ? getMyClub() : null;
  if (club && club.id) return club;

  var memberships = await _mcsGetPlayerClubMemberships();
  if (!memberships.length) return null;

  var first = memberships[0];
  if (typeof setMyClub === 'function') setMyClub(first.clubId, first.clubName);
  if (typeof setMyPlayer === 'function') setMyPlayer({ name: first.name, gender: first.gender });
  return { id: first.clubId, name: first.clubName };
}

async function _mcsGetCurrentPlayer(clubId) {
  clubId = String(clubId || '');
  if (_mcsCurrentPlayersByClub && _mcsCurrentPlayersByClub[clubId]) return _mcsCurrentPlayersByClub[clubId];

  var memberships = await _mcsGetPlayerClubMemberships();
  memberships.forEach(function(p) {
    _mcsCurrentPlayersByClub[String(p.clubId)] = p;
    _mcsClubsById[String(p.clubId)] = { id: p.clubId, name: p.clubName, color: p.clubColor };
  });
  return _mcsCurrentPlayersByClub[clubId] || null;
}

async function _mcsGetPublicPlayer(createIfMissing) {
  var user = (typeof authGetUser === 'function') ? authGetUser() : null;
  if (!user || typeof sbGet !== 'function') return null;

  var profile = (typeof getMyPlayer === 'function') ? getMyPlayer() : null;
  var displayName = String(
    (profile && (profile.name || profile.nickname || profile.displayName)) ||
    user.nickname ||
    user.displayName ||
    user.name ||
    (user.email ? user.email.split('@')[0] : '') ||
    'Player'
  ).trim();
  var publicNameCheck = typeof scsNormalizePlayerName === 'function'
    ? scsNormalizePlayerName(displayName)
    : { name:displayName, valid:!!displayName };
  if (!publicNameCheck.valid) return null;
  displayName = publicNameCheck.name;
  var gender = _mcsNormalizeGender((profile && profile.gender) || user.gender || 'Male');

  var rows = [];
  var storageKey = user.id ? 'scs_public_player_id_' + user.id : null;
  var storedPlayerId = storageKey ? localStorage.getItem(storageKey) : null;
  if (storedPlayerId) {
    rows = await sbGet('players', 'id=eq.' + encodeURIComponent(storedPlayerId) + '&select=id,name,gender,global_rating').catch(function(){ return []; });
    if (rows && rows.length) {
      var linkedMemberships = await sbGet('memberships', 'player_id=eq.' + encodeURIComponent(rows[0].id) + '&select=id').catch(function(){ return []; });
      if (linkedMemberships && linkedMemberships.length) {
        localStorage.removeItem(storageKey);
        rows = [];
      }
    }
  }
  if ((!rows || !rows.length) && user.id) {
    var accountPlayers = await sbGet('players',
      'user_account_id=eq.' + encodeURIComponent(user.id) + '&select=id,name,gender,global_rating'
    ).catch(function(){ return []; });
    var accountPlayerIds = (accountPlayers || []).map(function(p){ return p && p.id; }).filter(Boolean).map(String);
    var memberPlayerIds = {};
    if (accountPlayerIds.length) {
      var memberRows = await sbGet('memberships', 'player_id=in.(' + accountPlayerIds.join(',') + ')&select=player_id').catch(function(){ return []; });
      (memberRows || []).forEach(function(m){ memberPlayerIds[String(m.player_id)] = true; });
    }
    rows = (accountPlayers || []).filter(function(p){ return p && p.id && !memberPlayerIds[String(p.id)]; });
  }

  if ((!rows || !rows.length) && createIfMissing && typeof sbPost === 'function') {
    var payload = {
      name: displayName,
      gender: gender,
      global_rating: 1.0,
      global_points: 0
    };
    if (user.id) payload.user_account_id = user.id;
    rows = await sbPost('players', payload).catch(function(){ return []; });
  }

  if (!rows || !rows.length || !rows[0].id) {
    if (!createIfMissing) {
      // Browsing public slots must not require club membership or a database
      // player row. The permanent public player is created only on Join.
      var viewer = {
        membershipId: null,
        clubId: null,
        clubName: 'Public',
        clubColor: '#4a9eff',
        playerId: null,
        name: displayName,
        gender: gender,
        rating: null,
        clubRating: null,
        activeRating: null,
        guest: true,
        localViewer: true
      };
      _mcsPublicPlayer = viewer;
      if (!_mcsCurrentPlayer) _mcsCurrentPlayer = viewer;
      return viewer;
    }
    return null;
  }
  var row = rows[0];
  if (storageKey) localStorage.setItem(storageKey, row.id);
  var player = {
    membershipId: null,
    clubId: null,
    clubName: 'Public',
    clubColor: '#4a9eff',
    playerId: row.id,
    name: _vsGuestName(row.name || displayName, row.id),
    gender: _mcsNormalizeGender(row.gender || gender),
    rating: null,
    clubRating: null,
    activeRating: null,
    guest: true
  };
  _mcsPublicPlayer = player;
  if (!_mcsCurrentPlayer) _mcsCurrentPlayer = player;
  return player;
}

async function _mcsResolvePlayerForSlot(slot, createPublicGuest) {
  var cid = String((slot && (slot.club_id || slot._viewerClubId)) || '');
  if (!slot) return null;

  var member = (_mcsCurrentPlayersByClub && _mcsCurrentPlayersByClub[cid]) || await _mcsGetCurrentPlayer(cid);
  if (member && member.playerId) return member;

  var isPublicSlot = String(slot.visibility || 'private').toLowerCase() === 'public';
  if (!isPublicSlot) return null;

  if (_mcsPublicPlayer && _mcsPublicPlayer.playerId) return _mcsPublicPlayer;
  return await _mcsGetPublicPlayer(!!createPublicGuest);
}

function _mcsIsPostedFutureSlot(slot) {
  return String((slot && slot.status) || '').toLowerCase().trim() === 'posted' && !slot.played_session_id && String(slot.slot_date || '') >= _vsTodayStr();
}

function _mcsIsPlayedSlot(slot) {
  var status = String((slot && slot.status) || '').toLowerCase();
  return !!(slot && (slot.played_session_id || status === 'played'));
}

var _mcsProbabilityQueueKey = 'scs_join_probability_sync_v1';
var _mcsProbabilitySyncing = false;
var _mcsProbabilityRetryTimer = null;

function _mcsReadProbabilityQueue() {
  try {
    var parsed = JSON.parse(localStorage.getItem(_mcsProbabilityQueueKey) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) { return {}; }
}

function _mcsWriteProbabilityQueue(queue) {
  if (queue && Object.keys(queue).length) localStorage.setItem(_mcsProbabilityQueueKey, JSON.stringify(queue));
  else localStorage.removeItem(_mcsProbabilityQueueKey);
}

function _mcsQueueProbabilitySync(item) {
  var queue = _mcsReadProbabilityQueue();
  queue[String(item.claimId)] = item;
  _mcsWriteProbabilityQueue(queue);
}

function _mcsApplyPendingProbability(claim) {
  if (!claim || claim.id == null) return claim;
  var pending = _mcsReadProbabilityQueue()[String(claim.id)];
  if (!pending) return claim;
  var serverTime = Date.parse(claim.join_probability_updated_at || '') || 0;
  var localTime = Date.parse(pending.updatedAt || '') || 0;
  if (serverTime <= localTime) {
    claim.join_probability = Number(pending.value);
    claim.join_probability_updated_at = pending.updatedAt;
  }
  return claim;
}

function _mcsApplyPendingProbabilities(slots) {
  (slots || []).forEach(function(slot) {
    (slot && slot.claims || []).forEach(_mcsApplyPendingProbability);
  });
  return slots;
}

function _mcsScheduleProbabilityRetry() {
  if (_mcsProbabilityRetryTimer) return;
  _mcsProbabilityRetryTimer = setTimeout(function() {
    _mcsProbabilityRetryTimer = null;
    _mcsFlushProbabilityQueue();
  }, 5000);
}

async function _mcsFlushProbabilityQueue() {
  if (_mcsProbabilitySyncing || typeof sbPatch !== 'function') return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    _mcsScheduleProbabilityRetry();
    return;
  }
  var queue = _mcsReadProbabilityQueue();
  var items = Object.keys(queue).map(function(key) { return queue[key]; });
  if (!items.length) return;
  _mcsProbabilitySyncing = true;
  var failed = false;
  try {
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      try {
        await sbPatch('slot_claims',
          'id=eq.' + encodeURIComponent(item.claimId) + '&player_id=eq.' + encodeURIComponent(item.playerId), {
            join_probability: Number(item.value),
            join_probability_updated_at: item.updatedAt
          });
        var latest = _mcsReadProbabilityQueue();
        if (latest[String(item.claimId)] && latest[String(item.claimId)].updatedAt === item.updatedAt) {
          delete latest[String(item.claimId)];
          _mcsWriteProbabilityQueue(latest);
        }
        if (typeof vaultHomeSlotsRefresh === 'function') vaultHomeSlotsRefresh();
        if (typeof vaultSlotsRefresh === 'function') vaultSlotsRefresh();
        if (typeof window.scsNotificationsRefreshOpenSlot === 'function' &&
            window._scsQuickSlotCurrent && String(window._scsQuickSlotCurrent.id) === String(item.slotId)) {
          window.scsNotificationsRefreshOpenSlot(item.slotId).catch(function(){});
        }
      } catch (e) {
        failed = true;
        _mcsScheduleProbabilityRetry();
        break;
      }
    }
  } finally {
    _mcsProbabilitySyncing = false;
    if (Object.keys(_mcsReadProbabilityQueue()).length) {
      if (failed) _mcsScheduleProbabilityRetry();
      else setTimeout(_mcsFlushProbabilityQueue, 0);
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', _mcsFlushProbabilityQueue);
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) _mcsFlushProbabilityQueue();
  });
  setTimeout(_mcsFlushProbabilityQueue, 500);
}

function _mcsPlayerClaim(slot, playerId) {
  if (!slot || !playerId) return null;
  var claim = (slot.claims || []).find(function(c) {
    return String(c.player_id) === String(playerId) && (_vsIsActiveClaim(c) || String(c.status || '').toLowerCase() === 'pending');
  }) || null;
  return _mcsApplyPendingProbability(claim);
}

function _mcsIsEligibleSlot(slot, player) {
  if (!slot || !player) return false;
  var claim = _mcsPlayerClaim(slot, player.playerId);
  if (claim) return true; // always show already joined / waitlisted slots

  var slotGender = (typeof _vsSlotGenderKey === 'function') ? _vsSlotGenderKey(slot) : String(slot.gender_filter || 'all').toLowerCase();
  if (slotGender && slotGender !== 'all') {
    var playerGender = _mcsPlayerGenderKey(player);
    if (playerGender !== slotGender) return false;
  }

  var minRating = parseFloat(slot.min_rating) || 0;
  if (minRating && !player.guest && (parseFloat(player.clubRating) || 0) < minRating) return false;

  return true;
}

async function dbGetJoinableSlotsForRange(clubId, startDateStr, endDateStr, player) {
  var slots = await dbGetSlotsForRange(clubId, startDateStr, endDateStr);
  return (slots || []).filter(function(s) {
    return _mcsIsPostedFutureSlot(s) && _mcsIsEligibleSlot(s, player);
  });
}

function _mcsGroupSlotsByDate(slots) {
  var byDate = {};
  (slots || []).forEach(function(s) {
    (byDate[s.slot_date] = byDate[s.slot_date] || []).push(s);
  });
  Object.keys(byDate).forEach(function(k) {
    byDate[k].sort(function(a, b) { return String(a.start_time || '').localeCompare(String(b.start_time || '')); });
  });
  return byDate;
}

function _mcsBuildSlotsSignature(byDate) {
  return JSON.stringify(Object.keys(byDate || {}).sort().map(function(date) {
    return [date, (byDate[date] || []).map(function(s) {
      return [
        s.id,
        s.club_id || s._viewerClubId || '',
        s.slot_date,
        s.start_time,
        s.end_time,
        s.max_players,
        s.status,
        s.visibility,
        s.confirmedCount || 0,
        s.waitlistCount || 0,
        s.played_session_id || '',
        _mcsIsRecentlyPostedSlot(s),
        _vsSlotCostPerPlayer(s) || 0,
        (s.claims || []).map(function(c) {
          return [c.id, c.player_id, c.status, c.claimed_at || '', c.paid_at || '', c.join_probability || '', c.join_probability_updated_at || ''];
        })
      ];
    })];
  }));
}

function _mcsMonthVisibleEndDateStr(year, month) {
  var firstOfMonth = new Date(year, month, 1);
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var usedCells = firstOfMonth.getDay() + daysInMonth;
  var remainder = usedCells % 7;

  // Only fill the remaining cells of the last visible row with next-month days.
  // Do not add an extra row just for next month.
  if (!remainder) return _vsDateStr(year, month, daysInMonth);

  var nextDays = 7 - remainder;
  return _vsDateStr(year, month + 1, nextDays);
}

function _mcsMonthDataEndDateStr(year, month) {
  return _vsDateStr(year, month + 2, 0);
}

function _mcsAddDaysStr(dateStr, days) {
  var d = new Date(String(dateStr) + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return _vsDateStr(d.getFullYear(), d.getMonth(), d.getDate());
}



/* DEBUG / STEP TEST:
   Load all visible-range slots directly for MyCard, without club membership,
   gender, rating, or eligibility filtering. This is temporary so we can prove
   whether the Profile calendar/render path works before adding filters back
   one by one. */
async function dbGetAllSlotsForRangeDebug(startDateStr, endDateStr) {
  return dbGetVisibleSlotsForRange(startDateStr, endDateStr);
}

async function dbGetVisibleSlotsForRange(startDateStr, endDateStr) {
  return vaultSlotsLoadRange({
    startDateStr: startDateStr,
    endDateStr: endDateStr,
    includeAllClubs: true
  });
}

async function _mcsLoadMonthSlots() {
  var monthFirst = _vsDateStr(_mcsCalYear, _mcsCalMonth, 1);
  var last = _mcsMonthDataEndDateStr(_mcsCalYear, _mcsCalMonth);
  // Upcoming must query only today-forward data. Loading from the first day of
  // the month pulled old claims into the shared response and could hit the
  // PostgREST 1,000-row cap before recent bookings were returned.
  var today = _vsTodayStr();
  var first = _mcsSlotView === 'upcoming' && monthFirst < today ? today : monthFirst;

  _mcsSlotsByDate = {};
  _mcsCurrentPlayer = null;
  _mcsPublicPlayer = null;
  _mcsCurrentPlayersByClub = {};
  _mcsClubsById = {};
  _mcsDebugInfo = null;

  if (typeof sbGet !== 'function') return;
  if (first > last) {
    _mcsDataSignature = _mcsBuildSlotsSignature(_mcsSlotsByDate);
    return;
  }

  try {
    var memberships = await _mcsGetPlayerClubMemberships();
    if (!memberships || !memberships.length) {
      console.log('[MyCardSlots] No linked club memberships found; showing public slots only.');
    }

    var clubIds = [];
    (memberships || []).forEach(function(player, idx) {
      var cid = String(player.clubId || '').trim();
      if (!cid) return;
      if (clubIds.indexOf(cid) < 0) clubIds.push(cid);

      // Keep the player profile per club. This is needed later for Join/Cancel
      // and for the next filters: gender + club rating.
      _mcsCurrentPlayersByClub[cid] = player;
      _mcsClubsById[cid] = {
        id: cid,
        name: player.clubName || ('Club ' + (idx + 1)),
        color: player.clubColor || _mcsClubColor(idx)
      };
      if (!_mcsCurrentPlayer) _mcsCurrentPlayer = player;
    });

    _mcsPublicPlayer = await _mcsGetPublicPlayer(false);
    if (!_mcsCurrentPlayer) _mcsCurrentPlayer = _mcsPublicPlayer;


    // Important: load visible slots first, then filter in JS by club_id.
    // This avoids PostgREST query differences and proves the calendar/render path
    // is independent from membership lookup.
    var allSlots = _mcsApplyPendingProbabilities(await dbGetVisibleSlotsForRange(first, last));
    var filteredSlots = (allSlots || []).filter(function(slot) {
      var cid = String(slot.club_id || slot._viewerClubId || '').trim();
      var isPrivate = String(slot.visibility || 'private').toLowerCase() !== 'public';
      var isMyClub = clubIds.indexOf(cid) >= 0;
      if (isPrivate && !isMyClub) return false;

      var club = _mcsClubsById[cid];
      if (club) {
        slot._viewerClubId = cid;
        slot._viewerClubName = club.name;
        slot._viewerClubColor = club.color;
      }
      slot._clubFilterMatched = isMyClub;
      if (_mcsIsPostedFutureSlot(slot)) return _mcsIsEligibleSlot(slot, _mcsPlayerForSlot(slot));
      if (_mcsSlotView === 'all') return _mcsIsPlayedForViewer(slot);
      return _mcsIsPlayedUnpaidForViewer(slot);
    });

    _mcsSlotsByDate = _mcsGroupSlotsByDate(filteredSlots);
    _mcsDataSignature = _mcsBuildSlotsSignature(_mcsSlotsByDate);
    _mcsMaybeShowSlotAnnouncement();
    _mcsFlushProbabilityQueue();
  } catch (e) {
    console.log('[MyCardSlots] load month failed', e);
    _mcsSlotsByDate = {};
    _mcsCurrentPlayersByClub = {};
    _mcsClubsById = {};
    _mcsDataSignature = _mcsBuildSlotsSignature(_mcsSlotsByDate);
  }
}

function _mcsSlotLevelText(slot) {
  var min = Number(slot.min_rating || 0);
  if (!min) return t('allLevel') || 'All Level';
  return _vsT('minClubRating', 'Min club rating {rating}+', { rating: min.toFixed(min % 1 ? 1 : 0) });
}

function _vsSlotVisibilityLabel(slot) {
  var vis = String((slot && slot.visibility) || 'private').toLowerCase();
  return vis === 'public' ? (t('public') || 'Public') : (t('private') || 'Private');
}

function _mcsSlotTitle(slot) {
  return _vsSlotVisibilityLabel(slot);
}

function _mcsPlayerForSlot(slot) {
  var cid = String((slot && (slot.club_id || slot._viewerClubId)) || '');
  var member = (_mcsCurrentPlayersByClub && _mcsCurrentPlayersByClub[cid]) || null;
  if (member) return member;
  var isPublicSlot = String(slot && slot.visibility || 'private').toLowerCase() === 'public';
  return isPublicSlot ? (_mcsPublicPlayer || null) : null;
}

function _mcsClubForSlot(slot) {
  var cid = String((slot && (slot.club_id || slot._viewerClubId)) || '');
  return (_mcsClubsById && _mcsClubsById[cid]) || {
    id: cid,
    name: (slot && slot._viewerClubName) || 'Club',
    color: (slot && slot._viewerClubColor) || '#4a9eff'
  };
}

function _mcsClaimStatusText(slot) {
  var player = _mcsPlayerForSlot(slot);
  var claim = _mcsPlayerClaim(slot, player && player.playerId);
  if (!claim) return '';
  if (claim.status === 'pending') return t('pendingApproval') || 'Pending approval';
  return claim.status === 'confirmed' ? (t('confirmed') || 'Confirmed') : (t('waitlisted') || 'Waitlisted');
}

function _mcsViewerClaim(slot) {
  var player = _mcsPlayerForSlot(slot);
  return _mcsPlayerClaim(slot, player && player.playerId);
}

function _mcsIsPlayedUnpaidForViewer(slot) {
  if (!_mcsIsPlayedSlot(slot)) return false;
  if (!_vsSlotCostPerPlayer(slot)) return false;
  var claim = _mcsViewerClaim(slot);
  return !!(claim && claim.status === 'confirmed' && !_vsClaimPaid(claim));
}

function _mcsRenderActionButton(slot) {
  var player = _mcsPlayerForSlot(slot);
  var claim = _mcsPlayerClaim(slot, player && player.playerId);
  var clubId = String((slot && (slot.club_id || slot._viewerClubId)) || '');
  var isPublicNonMember = String((slot && slot.visibility) || 'private').toLowerCase() === 'public' &&
    !(_mcsCurrentPlayersByClub && _mcsCurrentPlayersByClub[clubId]);
  var busy = _mcsBusySlotId && String(_mcsBusySlotId) === String(slot.id);
  if (busy) return '<button class="mc-slot-action-btn is-busy" disabled>...</button>';

  if (_mcsIsPlayedSlot(slot)) {
    if (!claim || claim.status !== 'confirmed') return '';
    if (_vsClaimPaid(claim)) {
      return '<button class="mc-slot-action-btn is-paid" disabled>' + _vsEscape(t('paid') || 'Paid') + '</button>';
    }
    return '<button class="mc-slot-action-btn is-payment" onclick="myCardSlotsMarkPaid(\'' + _vsEscape(slot.id) + '\')">' + _vsEscape(t('markPaid') || 'Mark Paid') + '</button>';
  }

  if (claim) {
    var leaveClass = claim.status === 'waitlist' ? ' is-waitlist' : (claim.status === 'pending' ? ' is-pending' : ' is-joined');
    var leaveLabel = claim.status === 'pending' ? (t('removePendingRequest') || 'Remove Request') : (t('leaveSlotBtn') || 'Leave Slot');
    return '<button class="mc-slot-action-btn' + leaveClass + '" onclick="myCardSlotsCancel(\'' + _vsEscape(slot.id) + '\')">' + _vsEscape(leaveLabel) + '</button>';
  }

  var confirmed = Number(slot.confirmedCount || 0);
  var max = Number(slot.max_players || 0);
  var full = max && confirmed >= max;
  if (isPublicNonMember) {
    return '<span class="mc-slot-public-actions">' +
      '<button class="mc-slot-action-btn is-guest-join' + (full ? ' is-waitlist' : '') + '" onclick="myCardSlotsJoin(\'' + _vsEscape(slot.id) + '\')">' +
        _vsEscape(_vsT('joinAsGuestBtn', 'Join as Guest')) + '</button>' +
      '<button class="mc-slot-action-btn is-join-club-slot' + (full ? ' is-waitlist' : '') + '" onclick="myCardSlotsJoinClubAndSlot(\'' + _vsEscape(slot.id) + '\')">' +
        _vsEscape(_vsT('joinClubAndSlotBtn', 'Join Club & Slot')) + '</button>' +
    '</span>';
  }
  return '<button class="mc-slot-action-btn' + (full ? ' is-waitlist' : '') + '" onclick="myCardSlotsJoin(\'' + _vsEscape(slot.id) + '\')">' +
    _vsEscape(full ? (t('joinWaitlistBtn') || 'Join Waitlist') : (t('joinSlotBtn') || 'Join Slot')) + '</button>';
}
function _mcsRenderJoinProbability(slot, claim) {
  if (!claim || claim.status !== 'confirmed' || _mcsIsPlayedSlot(slot)) return '';
  var selected = Number(claim.join_probability);
  var busy = String(_mcsProbabilityBusyClaimId || '') === String(claim.id || '');
  var options = [100, 75, 50, 25].map(function(value) {
    var active = selected === value;
    return '<button type="button" class="mc-slot-probability-pill probability-' + value + (active ? ' is-selected' : '') + '" ' +
      'role="radio" aria-checked="' + (active ? 'true' : 'false') + '" ' + (busy ? 'disabled ' : '') +
      'onclick="event.stopPropagation();myCardSlotsSetJoinProbability(\'' + _vsEscape(slot.id) + '\',\'' + _vsEscape(claim.id) + '\',' + value + ')">' + value + '%</button>';
  }).join('');
  return '<div class="mc-slot-probability-picker" onclick="event.stopPropagation()">' +
    '<div class="mc-slot-probability-label">' + _vsEscape(t('joinProbability') || 'Join Probability') + '</div>' +
    '<div class="mc-slot-probability-pills" role="radiogroup" aria-label="' + _vsEscape(t('joinProbability') || 'Join Probability') + '">' + options + '</div>' +
  '</div>';
}

function _mcsUpdateProbabilityPicker(slotId, selectedValue, busy) {
  document.querySelectorAll('.mc-slot-card[data-slot-id]').forEach(function(card) {
    if (String(card.getAttribute('data-slot-id') || '') !== String(slotId || '')) return;
    card.querySelectorAll('.mc-slot-probability-pill').forEach(function(button) {
      var valueMatch = String(button.className || '').match(/probability-(25|50|75|100)/);
      var value = valueMatch ? Number(valueMatch[1]) : 0;
      var selected = Number(selectedValue) === value;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-checked', selected ? 'true' : 'false');
      button.disabled = !!busy;
    });
  });
}

function _mcsUpdateProbabilityDistribution(slot) {
  if (!slot) return;
  var html = _mcsRenderProbabilityDistribution(slot);
  document.querySelectorAll('.mc-slot-card[data-slot-id]').forEach(function(card) {
    if (String(card.getAttribute('data-slot-id') || '') !== String(slot.id || '')) return;
    var current = card.querySelector('.mc-slot-probability-distribution');
    if (current && html) current.outerHTML = html;
  });
}

function myCardSlotsSetJoinProbability(slotId, claimId, value) {
  value = Number(value);
  if ([25, 50, 75, 100].indexOf(value) < 0) return;
  var slot = _mcsFlattenVisibleSlots().find(function(item) {
    return String(item && item.id) === String(slotId);
  });
  if (!slot && window._scsQuickSlotCurrent &&
      String(window._scsQuickSlotCurrent.id) === String(slotId)) {
    slot = window._scsQuickSlotCurrent;
  }
  var player = slot ? _mcsPlayerForSlot(slot) : null;
  var claim = slot ? _mcsPlayerClaim(slot, player && player.playerId) : null;
  if (!claim || claim.status !== 'confirmed' || String(claim.id) !== String(claimId)) return;

  var updatedAt = new Date().toISOString();
  claim.join_probability = value;
  claim.join_probability_updated_at = updatedAt;
  _mcsQueueProbabilitySync({
    claimId: String(claim.id),
    slotId: String(slotId),
    playerId: String(player.playerId),
    value: value,
    updatedAt: updatedAt
  });
  _mcsUpdateProbabilityPicker(slotId, value, false);
  _mcsUpdateProbabilityDistribution(slot);
  if (typeof showToast === 'function') showToast((t('joinProbability') || 'Going?') + ': ' + value + '%');
  _mcsFlushProbabilityQueue();
}

function _mcsClaimPlayerName(claim) {
  return (claim && claim.player && claim.player.name) || (claim && claim.nickname) || 'Player';
}

function _mcsClaimRatingText(claim) {
  var raw = claim && claim.player && claim.player.clubRating;
  if (raw === null || raw === undefined || raw === '') return '';
  var n = Number(raw);
  if (!isFinite(n)) return '';
  return n.toFixed(1);
}

function _mcsInitial(name) {
  name = String(name || 'P').trim();
  return (name.charAt(0) || 'P').toUpperCase();
}

function _mcsGenderIcon(claim) {
  var gender = '';
  if (claim && claim.player && claim.player.gender) gender = String(claim.player.gender);
  gender = gender.toLowerCase();
  var img = gender === 'female' ? 'female.png' : 'male.png';
  return '<img src="' + img + '" class="gender-icon mc-slot-gender-img" alt="' + (gender === 'female' ? 'Female' : 'Male') + '">';
}

function _mcsRenderClaimRow(claim, idx, kind) {
  var name = _mcsClaimPlayerName(claim);
  var rating = _mcsClaimRatingText(claim);
  var probability = Number(claim && claim.join_probability);
  var hasProbability = [25,50,75,100].indexOf(probability) >= 0;
  var probabilityClass = hasProbability ? ' probability-' + probability : ' is-pending';
  var rowClass = kind === 'waitlist' ? ' is-waitlist' : (kind === 'late_cancelled' ? ' is-late-cancelled' : ' is-confirmed');
  if (_vsClaimPaid(claim)) rowClass += ' is-paid';
  var prefix = kind === 'waitlist'
    ? '<span class="mc-slot-wait-num">⏳' + (idx + 1) + '</span><span class="mc-slot-avatar mc-slot-gender-avatar">' + _mcsGenderIcon(claim) + '</span>'
    : (kind === 'late_cancelled'
      ? '<span class="mc-slot-wait-num">Late</span><span class="mc-slot-avatar mc-slot-gender-avatar">' + _mcsGenderIcon(claim) + '</span>'
      : '<span class="mc-slot-confirm-icon' + probabilityClass + '">✓</span><span class="mc-slot-avatar mc-slot-gender-avatar">' + _mcsGenderIcon(claim) + '</span>');
  var paidHtml = _vsClaimPaid(claim)
    ? '<span class="mc-slot-paid-badge">' + _vsEscape(t('paid') || 'Paid') + '</span>'
    : '<span class="mc-slot-unpaid-badge">' + _vsEscape(t('unpaid') || 'Unpaid') + '</span>';
  var probabilityHtml = hasProbability
    ? '<span class="mc-slot-probability-badge probability-' + probability + '">' + probability + '%</span>'
    : '<span class="mc-slot-probability-badge is-pending">—</span>';
  var metaParts = [];
  if (probabilityHtml) metaParts.push(probabilityHtml);
  if (paidHtml) metaParts.push(paidHtml);
  if (rating) metaParts.push('<span class="mc-slot-rating-badge"><span class="mc-slot-rating-star">★</span>' + _vsEscape(rating) + '</span>');
  var metaHtml = metaParts.join('<span class="mc-slot-meta-separator" aria-hidden="true">•</span>');
  return '<div class="mc-slot-player-row mc-slot-player-row-two-line' + rowClass + '">' +
    '<div class="mc-slot-player-icons">' + prefix + '</div>' +
    '<div class="mc-slot-player-content">' +
      '<div class="mc-slot-player-name">' + _vsEscape(name) + '</div>' +
      (metaHtml ? '<div class="mc-slot-player-meta">' + metaHtml + '</div>' : '') +
    '</div>' +
  '</div>';
}

function _mcsRenderClaimList(slot, canReviewPending) {
  var claims = _vsSortClaimsQueue(slot.claims || []);
  var maxPlayers = Math.max(0, Number(slot.max_players || 0));
  var queue = claims.filter(_vsIsQueuedClaim);
  var playerList = queue.slice(0, maxPlayers);
  var waiting = queue.slice(maxPlayers);
  var lateCancelled = claims.filter(function(c){ return c.status === 'late_cancelled'; });
  var costLabel = _vsSlotCostLabel(slot);
  var costSummary = costLabel
    ? '<div class="mc-slot-payment-summary"><span>' + _vsEscape(t('cost') || 'Cost') + '</span><strong>' + _vsEscape(costLabel) + '</strong></div>'
    : '';
  var renderQueueRow = function(c, i, kind) {
    if (c.status !== 'pending') return _mcsRenderClaimRow(c, i, kind);
    var combined = !!(c.player && c.player.clubJoinRequest);
    var approveLabel = combined ? _vsT('approveClubAndSlot', 'Approve Club & Slot') : _vsT('approveSlot', 'Approve Slot');
    var actions = canReviewPending
      ? '<div class="vs-approval-actions"><button type="button" class="vs-approve-mini' + (combined ? ' is-combined-approval' : '') + '" onclick="event.stopPropagation();vaultSlotsReviewClaim(\'' + _vsEscape(c.id) + '\',\'' + _vsEscape(slot.id) + '\',true,true)">' + _vsEscape(approveLabel) + '</button>' +
        '<button type="button" class="vs-reject-mini" onclick="event.stopPropagation();vaultSlotsReviewClaim(\'' + _vsEscape(c.id) + '\',\'' + _vsEscape(slot.id) + '\',false,true)">' + _vsEscape(t('reject') || 'Reject') + '</button></div>'
      : '<span class="mc-slot-status-inline">' + _vsEscape(t('pendingApproval') || 'Pending approval') + '</span>';
    return '<div class="mc-slot-player-row mc-slot-player-row-two-line mc-slot-player-row-pending-review is-pending">' +
      '<div class="mc-slot-player-icons"><span class="mc-slot-avatar mc-slot-gender-avatar">' + _mcsGenderIcon(c) + '</span></div>' +
      '<div class="mc-slot-player-content"><div class="mc-slot-player-name">' + _vsEscape(_mcsClaimPlayerName(c)) + '</div></div>' +
      actions + '</div>';
  };

  return '<div class="mc-slot-details">' +
    costSummary +
    '<div class="mc-slot-list-section">' +
      '<div class="mc-slot-list-title">👥 ' + (t('players') || 'Players') + ' (' + playerList.length + '/' + (slot.max_players || '—') + ')</div>' +
      (playerList.length ? playerList.map(function(c, i) { return renderQueueRow(c, i, 'confirmed'); }).join('') : '<div class="mc-slot-list-empty">' + (t('noBookingsYet') || 'No bookings yet') + '</div>') +
    '</div>' +
    '<div class="mc-slot-list-section">' +
      '<div class="mc-slot-list-title">⏳ ' + (t('waiting') || 'Waiting') + ' (' + waiting.length + ')</div>' +
      (waiting.length ? waiting.map(function(c,i){ return renderQueueRow(c, i, 'waitlist'); }).join('') : '<div class="mc-slot-list-empty">' + (t('noWaitingPlayers') || 'No waiting players') + '</div>') +
    '</div>' +
    (lateCancelled.length ? '<div class="mc-slot-list-section">' +
      '<div class="mc-slot-list-title">⚠ ' + (t('lateCancelled') || 'Late cancelled') + ' (' + lateCancelled.length + ')</div>' +
      lateCancelled.map(function(c,i){ return _mcsRenderClaimRow(c, i, 'late_cancelled'); }).join('') +
    '</div>' : '') +
  '</div>';
}

function _mcsRenderProbabilityDistribution(slot) {
  var counts = { 100: 0, 75: 0, 50: 0, 25: 0 };
  (slot && slot.claims || []).forEach(function(claim) {
    if (!claim || claim.status !== 'confirmed') return;
    _mcsApplyPendingProbability(claim);
    var probability = Number(claim.join_probability);
    if (Object.prototype.hasOwnProperty.call(counts, probability)) counts[probability] += 1;
  });

  var total = counts[100] + counts[75] + counts[50] + counts[25];
  var maxPlayers = Math.max(0, Number(slot && slot.max_players || 0));
  var capacity = Math.max(maxPlayers, total);
  if (!capacity) return '';

  var segments = [100, 75, 50, 25].map(function(probability) {
    var count = counts[probability];
    if (!count) return '';
    var playerLabel = count === 1 ? _vsT('playerSingular', 'player') : _vsT('playersPlural', 'players');
    return '<span class="mc-slot-probability-segment probability-' + probability + '" ' +
      'style="--probability-count:' + count + '" ' +
      'title="' + probability + '%: ' + count + ' ' + playerLabel + '" ' +
      'aria-label="' + probability + '%: ' + count + ' ' + playerLabel + '">' + count + '</span>';
  }).join('');
  var emptyCount = Math.max(0, capacity - total);
  if (emptyCount) {
    segments += '<span class="mc-slot-probability-empty" style="--probability-empty:' + emptyCount + '" ' +
      'aria-label="' + _vsEscape(_vsT('unfilledPlaces', '{count} unfilled or not answered', { count: emptyCount })) + '"></span>';
  }

  return '<div class="mc-slot-probability-distribution" role="img" aria-label="' + _vsEscape(_vsT('goingDistributionLabel', 'Going? player distribution based on {count} available places', { count: capacity })) + '">' + segments + '</div>';
}

function _mcsRenderSlotCard(slot, opts) {
  opts = opts || {};
  var confirmed = Number(slot.confirmedCount || 0);
  var max = Number(slot.max_players || 0);
  var full = max && confirmed >= max;
  var countText = confirmed + '/' + (max || '—');
  var isOpen = String(_mcsExpandedSlotId || '') === String(slot.id || '');
  var sid = _vsEscape(slot.id);
  var club = _mcsClubForSlot(slot);
  var clubColor = club.color || '#4a9eff';
  var viewerClaim = _mcsViewerClaim(slot);
  var joinedClass = viewerClaim && viewerClaim.status === 'confirmed'
    ? ' is-player-joined'
    : (viewerClaim && viewerClaim.status === 'waitlist' ? ' is-player-waitlist' : '');
  var compactClass = opts.compact ? ' is-next30-card' : '';
  var genderClass = _vsDateGenderClass([slot]);
  var fillPct = _vsSlotFillPercent(slot);
  var fillColor = _vsSlotFillColor(slot);
  var costLabel = _vsSlotCostLabel(slot);
  var playedClass = _mcsIsPlayedSlot(slot) ? ' is-played-slot' : '';
  var unpaidClass = _mcsIsPlayedUnpaidForViewer(slot) ? ' is-unpaid-slot' : '';
  var paymentMeta = costLabel
    ? '<div class="mc-slot-payment-meta"><span>' + _vsEscape(t('cost') || 'Cost') + ': ' + _vsEscape(costLabel) + '</span>' +
      (_mcsIsPlayedSlot(slot) ? '<strong>' + _vsEscape(_mcsIsPlayedUnpaidForViewer(slot) ? (t('unpaid') || 'Unpaid') : (t('paid') || 'Paid')) + '</strong>' : '') +
      '</div>'
    : '';

  return '<div class="mc-slot-card' + (isOpen ? ' is-expanded' : '') + joinedClass + compactClass + playedClass + unpaidClass + (genderClass ? ' ' + genderClass : '') + '" data-slot-id="' + sid + '" style="--mc-club-color:' + _vsEscape(clubColor) + ';--slot-fill:' + fillPct + '%;--slot-status-color:' + _vsEscape(fillColor) + '">' +
    '<div class="mc-slot-titlebar"><span>' + _vsEscape(club.name || 'Club') + '</span><strong>' + _vsEscape(_vsSlotGenderLabel(slot)) + '</strong></div>' +
    _mcsRenderProbabilityDistribution(slot) +
    _mcsRenderJoinProbability(slot, viewerClaim) +
    '<div class="mc-slot-card-head" onclick="myCardSlotsToggleDetails(\'' + sid + '\')">' +
      '<div class="mc-slot-time-row">' +
        '<div class="mc-slot-title">' + _vsEscape(_mcsSlotTitle(slot)) + '</div>' +
        '<div class="mc-slot-chevron">' + (isOpen ? '▲' : '▼') + '</div>' +
      '</div>' +
      '<div class="mc-slot-main">' +
        '<div>' +
          '<div class="mc-slot-time">' + _vsEscape(_mcsFormatDateTitle(slot.slot_date)) + ' · ' + _vsFormatTime(slot.start_time) + ' – ' + _vsFormatTime(slot.end_time) + '</div>' +
          _vsSlotVenueHtml(slot) +
          '<div class="mc-slot-info-row">' +
            _vsSessionMetaHtml(slot, true) +
            '<div class="mc-slot-count-row"><div class="mc-slot-count-pill' + (full ? ' is-full' : '') + '">' + countText + (slot.waitlistCount ? ' · ' + slot.waitlistCount + 'W' : '') + '</div></div>' +
          '</div>' +
          paymentMeta +
        '</div>' +
      '</div>' +
      '<div class="mc-slot-footer mc-slot-footer-actions-only"><span onclick="event.stopPropagation()">' + _mcsRenderActionButton(slot) + '</span></div>' +
    '</div>' +
    (isOpen ? _mcsRenderClaimList(slot, false) : '') +
  '</div>';
}

function _mcsNormalizeSlotActionLabels(root) {
  root = root || document;
  root.querySelectorAll('.mc-slot-action-btn').forEach(function(btn) {
    var txt = String(btn.textContent || '').trim().toLowerCase();
    if (txt === 'joined' || txt.indexOf('joined') === 0 || txt === '参加済み') {
      btn.textContent = t('leaveSlotBtn') || 'Leave Slot';
    }
    if (txt === 'join') {
      btn.textContent = t('joinSlotBtn') || 'Join Slot';
    }
  });
  root.querySelectorAll('.mc-slot-status-inline').forEach(function(el) {
    var txt = String(el.textContent || '').trim().toLowerCase();
    if (txt === 'joined' || txt.indexOf('joined') === 0) el.remove();
  });
}

function _mcsDateStatusClass(daySlots) {
  if (!daySlots || !daySlots.length) return '';

  var hasJoined = daySlots.some(function(slot) {
    var player = _mcsPlayerForSlot(slot);
    var claim = _mcsPlayerClaim(slot, player && player.playerId);
    return claim && (claim.status === 'pending' || claim.status === 'confirmed' || claim.status === 'waitlist');
  });
  if (hasJoined) return 'vs-cal-joined';

  return _vsDateGenderClass(daySlots);
}

function _mcsIsRecentlyPostedSlot(slot) {
  if (!slot || String(slot.status || '').toLowerCase() !== 'posted') return false;
  var raw = slot.posted_at || slot.scheduled_post_at || slot.created_at;
  var postedMs = Date.parse(raw || '');
  if (!Number.isFinite(postedMs)) return false;
  var ageMs = Date.now() - postedMs;
  return ageMs >= -5 * 60 * 1000 && ageMs < 4 * 60 * 60 * 1000;
}

function _mcsRenderCalendarDay(dateStr, dayNumber, extraClass) {
  var daySlots = _mcsSlotsByDate[dateStr] || [];
  var todayStr = _vsTodayStr();
  var isToday = dateStr === todayStr;
  var isPast = dateStr < todayStr;
  var isSelected = dateStr === _mcsSelectedDateStr;
  var statusClass = _mcsDateStatusClass(daySlots);
  var hasNewPost = daySlots.some(function(slot) {
    if (!_mcsIsRecentlyPostedSlot(slot)) return false;
    var player = _mcsPlayerForSlot(slot);
    var claim = _mcsPlayerClaim(slot, player && player.playerId);
    return !claim || (claim.status !== 'pending' && claim.status !== 'confirmed' && claim.status !== 'waitlist');
  });

  return '<div class="vs-cal-day mc-slots-day' +
    (extraClass ? ' ' + extraClass : '') +
    (statusClass ? ' ' + statusClass : '') +
    (isToday ? ' vs-cal-today' : '') +
    (isPast ? ' vs-cal-past' : '') +
    (hasNewPost ? ' mc-slots-new-post' : '') +
    (isSelected ? ' mc-slots-selected' : '') + '" ' +
    'onclick="myCardSlotsSelectDate(\'' + dateStr + '\')"><span class="vs-cal-num">' + dayNumber + '</span></div>';
}

function _mcsRenderCalendarGrid() {
  var gridEl = document.getElementById('mcSlotsCalGrid');
  if (!gridEl) return;

  var firstOfMonth = new Date(_mcsCalYear, _mcsCalMonth, 1);
  var lastOfMonth = new Date(_mcsCalYear, _mcsCalMonth + 1, 0);
  var startWeekday = firstOfMonth.getDay();
  var daysInMonth = lastOfMonth.getDate();
  var html = '';

  // No previous-month dates. Keep leading blanks before day 1.
  for (var i = 0; i < startWeekday; i++) html += '<div class="vs-cal-day vs-cal-empty"></div>';

  for (var d = 1; d <= daysInMonth; d++) {
    html += _mcsRenderCalendarDay(_vsDateStr(_mcsCalYear, _mcsCalMonth, d), d, '');
  }

  // Fill only the remaining cells of the last visible row with next-month dates.
  // Do not add a new row just to show next month.
  var usedCells = startWeekday + daysInMonth;
  var remainder = usedCells % 7;
  if (remainder) {
    var nextDays = 7 - remainder;
    for (var nd = 1; nd <= nextDays; nd++) {
      html += _mcsRenderCalendarDay(_vsDateStr(_mcsCalYear, _mcsCalMonth + 1, nd), nd, 'mc-slots-next-month');
    }
  }

  gridEl.innerHTML = html;
}

function _mcsFormatDateTitle(dateStr) {
  var d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(_vsAppLocale(), { weekday: 'short', month: 'short', day: 'numeric' });
}

function _mcsRenderNext30SlotsSection(selectedDateStr) {
  if (!selectedDateStr) return '';
  var endDateStr = _mcsAddDaysStr(selectedDateStr, 30);
  var dates = Object.keys(_mcsSlotsByDate || {}).sort().filter(function(dateStr) {
    return dateStr > selectedDateStr && dateStr <= endDateStr && (_mcsSlotsByDate[dateStr] || []).length;
  });
  if (!dates.length) return '';

  var html = '<div class="mc-next30-section">' +
    '<div class="mc-next30-header">' +
      '<span class="mc-next30-arrow">↓</span>' +
      '<span>' + _vsEscape(t('next30Slots') || 'Next 30 days') + '</span>' +
    '</div>';

  dates.forEach(function(dateStr) {
    html += '<div class="mc-next30-date-group">' +
      '<div class="mc-next30-date-title">' + _vsEscape(_mcsFormatDateTitle(dateStr)) + '</div>' +
      (_mcsSlotsByDate[dateStr] || []).map(function(slot) {
        return _mcsRenderSlotCard(slot, { compact: true });
      }).join('') +
    '</div>';
  });

  return html + '</div>';
}


var _mcsCarouselIndex = 0;
var _vhsCarouselIndex = 0;

function _vsRenderSlotCarousel(slots, renderCard, carouselId) {
  if (!slots || !slots.length) return '';
  var total = slots.length;
  var slides = slots.map(function(slot, index) {
    var dateLabel = slot && slot.__carouselDate
      ? '<div class="scs-slot-slide-date">' + _vsEscape(_mcsFormatDateTitle(slot.__carouselDate)) + '</div>'
      : '';
    return '<div class="scs-slot-slide" data-slide-index="' + index + '" data-slot-date="' + _vsEscape(slot && slot.__carouselDate || '') + '">' + dateLabel + renderCard(slot) + '</div>';
  }).join('');
  var dots = total > 1
    ? '<div class="scs-slot-carousel-dots">' + slots.map(function(_, index) {
        return '<button type="button" class="scs-slot-carousel-dot' + (index === 0 ? ' active' : '') + '" aria-label="Go to slot ' + (index + 1) + '" onclick="_vsGoToSlotSlide(\'' + carouselId + '\',' + index + ')"></button>';
      }).join('') + '</div>'
    : '';
  return '<div class="scs-slot-carousel" id="' + carouselId + '" data-total="' + total + '">' +
    '<div class="scs-slot-carousel-track">' + slides + '</div>' +
    (total > 1 ? '<div class="scs-slot-carousel-nav">' + dots + '<span class="scs-slot-carousel-count"><strong>1</strong> / ' + total + '</span></div>' : '') +
  '</div>';
}

function _vsGoToSlotSlide(carouselId, index) {
  var root = document.getElementById(carouselId);
  if (!root) return;
  var track = root.querySelector('.scs-slot-carousel-track');
  var slides = root.querySelectorAll('.scs-slot-slide');
  var slide = slides[index];
  if (!track || !slide) return;
  track.scrollTo({ left: slide.offsetLeft - track.offsetLeft, behavior: 'smooth' });
}

function _vsFlattenSlotsByDate(slotsByDate) {
  var flat = [];
  Object.keys(slotsByDate || {}).sort().forEach(function(dateStr) {
    (slotsByDate[dateStr] || []).forEach(function(slot) {
      flat.push(Object.assign({}, slot, { __carouselDate: dateStr }));
    });
  });
  return flat;
}

function _vsFindFirstSlideForDate(slots, dateStr) {
  if (!slots || !slots.length || !dateStr) return 0;
  var exact = slots.findIndex(function(slot) { return slot.__carouselDate === dateStr; });
  if (exact >= 0) return exact;
  var next = slots.findIndex(function(slot) { return slot.__carouselDate > dateStr; });
  return next >= 0 ? next : Math.max(0, slots.length - 1);
}

function _vsInitSlotCarousel(carouselId, initialIndex, onIndexChange, suppressInitialCallback) {
  var root = document.getElementById(carouselId);
  if (!root) return;
  var track = root.querySelector('.scs-slot-carousel-track');
  var slides = Array.from(root.querySelectorAll('.scs-slot-slide'));
  if (!track || !slides.length) return;
  var safeIndex = Math.max(0, Math.min(Number(initialIndex) || 0, slides.length - 1));

  function update(index) {
    index = Math.max(0, Math.min(index, slides.length - 1));
    root.querySelectorAll('.scs-slot-carousel-dot').forEach(function(dot, i) {
      dot.classList.toggle('active', i === index);
    });
    var current = root.querySelector('.scs-slot-carousel-count strong');
    if (current) current.textContent = String(index + 1);
    if (typeof onIndexChange === 'function' && !suppressInitialCallback) onIndexChange(index);
  }

  var scrollTimer = null;
  track.addEventListener('scroll', function() {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function() {
      var nearest = 0;
      var best = Infinity;
      slides.forEach(function(slide, i) {
        var distance = Math.abs((slide.offsetLeft - track.offsetLeft) - track.scrollLeft);
        if (distance < best) { best = distance; nearest = i; }
      });
      update(nearest);
    }, 70);
  }, { passive: true });

  requestAnimationFrame(function() {
    // Initial/date-selected positioning must be an instant jump. The track's
    // CSS uses smooth scrolling for user navigation, which otherwise animates
    // through every earlier slot before reaching the selected date.
    var previousScrollBehavior = track.style.scrollBehavior;
    track.style.scrollBehavior = 'auto';
    if (safeIndex) track.scrollLeft = slides[safeIndex].offsetLeft - track.offsetLeft;
    update(safeIndex);
    suppressInitialCallback = false;
    requestAnimationFrame(function() {
      track.style.scrollBehavior = previousScrollBehavior;
    });
  });
}

async function renderMyCardSlotsUI(loadFresh) {
  var section = document.getElementById('mcUpcomingSlots');
  var labelEl = document.getElementById('mcSlotsMonthLabel');
  var listEl = document.getElementById('mcSlotsList');
  var titleEl = document.getElementById('mcSlotsSelectedTitle');
  var summaryEl = document.getElementById('mcSlotsSummary');
  var countEl = document.getElementById('mcSlotsCount');
  if (!section || !listEl) return;
  _mcsUpdateViewControls();
  _mcsUpdateLayoutControls();
  _vsRenderWeekdayLabels(section);

  var today = new Date();
  if (_mcsCalYear === null || _mcsCalMonth === null) {
    _mcsCalYear = today.getFullYear();
    _mcsCalMonth = today.getMonth();
  }

  section.style.display = '';
  myCardSlotsStartAutoSync();
  if (labelEl) labelEl.textContent = _vsMonthLabel(_mcsCalYear, _mcsCalMonth);

  if (loadFresh !== false) {
    var quietRefresh = loadFresh === 'quiet';
    var beforeSignature = _mcsDataSignature;
    if (!quietRefresh && !listEl.children.length) {
      if (summaryEl) summaryEl.textContent = t('loadingSlots') || 'Loading slots...';
      if (countEl) countEl.textContent = '—';
      listEl.innerHTML = '<div class="mc-slots-empty">' + (t('loadingSlots') || 'Loading slots...') + '</div>';
    }
    await _mcsLoadMonthSlots();
    if (quietRefresh && beforeSignature && beforeSignature === _mcsDataSignature) return;
  }

  var dates = Object.keys(_mcsSlotsByDate).sort();
  // Build 589: My Hub -> Slots defaults to today when the current month opens.
  // Keep a manually selected empty date instead of jumping to the first slot date.
  if (!_mcsSelectedDateStr) {
    var todayStr = _vsTodayStr();
    var todayDate = new Date(todayStr + 'T00:00:00');
    var showingCurrentMonth = !isNaN(todayDate.getTime()) &&
      todayDate.getFullYear() === _mcsCalYear && todayDate.getMonth() === _mcsCalMonth;
    _mcsSelectedDateStr = showingCurrentMonth
      ? todayStr
      : (dates[0] || _vsDateStr(_mcsCalYear, _mcsCalMonth, 1));
  }

  var visibleDates = dates.filter(function(d) { return (_mcsSlotsByDate[d] || []).length; });
  var dateCount = visibleDates.length;
  if (summaryEl) summaryEl.textContent = _mcsSlotView === 'all'
    ? (dateCount ? dateCount + ' ' + (t('slotDates') || 'slot date(s)') : (t('noSlots') || 'No slots'))
    : _vsUpcomingDateText(dateCount);
  if (countEl) countEl.textContent = dateCount;


  if (_mcsSlotLayout === 'calendar') _mcsRenderCalendarGrid();

  var slots = _vsFlattenSlotsByDate(_mcsSlotsByDate);
  if (!slots.length) {
    if (titleEl) titleEl.textContent = _mcsFormatDateTitle(_mcsSelectedDateStr);
    listEl.innerHTML = '<div class="mc-slots-empty">' + (_mcsSlotView === 'all' ? (t('noSlots') || 'No slots') : (t('noUpcomingSlots') || 'No upcoming slots')) + '</div>';
    _mcsNormalizeSlotActionLabels(listEl);
    if (typeof myHubRenderQuickSlots === 'function') myHubRenderQuickSlots();
    return;
  }
  var focusedIndex = _mcsCarouselSlotId
    ? slots.findIndex(function(slot) { return String(slot && slot.id) === String(_mcsCarouselSlotId); })
    : -1;
  var startIndex = focusedIndex >= 0 ? focusedIndex : _vsFindFirstSlideForDate(slots, _mcsSelectedDateStr);
  _mcsCarouselIndex = startIndex;
  if (_mcsSlotLayout === 'compact') {
    if (titleEl) titleEl.textContent = '';
    listEl.innerHTML = slots.map(function(slot) { return _mcsRenderSlotCard(slot); }).join('');
    _mcsNormalizeSlotActionLabels(listEl);
    if (typeof myHubRenderQuickSlots === 'function') myHubRenderQuickSlots();
    return;
  }

  if (titleEl) titleEl.textContent = _mcsFormatDateTitle(slots[startIndex].__carouselDate);
  listEl.innerHTML = _vsRenderSlotCarousel(slots, function(slot) { return _mcsRenderSlotCard(slot); }, 'mcSlotsCarousel');
  _mcsNormalizeSlotActionLabels(listEl);
  if (typeof myHubRenderQuickSlots === 'function') myHubRenderQuickSlots();
  _vsInitSlotCarousel('mcSlotsCarousel', startIndex, function(index) {
    _mcsCarouselIndex = index;
    if (slots[index] && slots[index].__carouselDate) {
      _mcsCarouselSlotId = String(slots[index].id || '');
      _mcsSelectedDateStr = slots[index].__carouselDate;
      if (titleEl) titleEl.textContent = _mcsFormatDateTitle(_mcsSelectedDateStr);
      _mcsRenderCalendarGrid();
    }
  });
}

async function myCardSlotsMarkPaid(slotId) {
  if (!slotId || _mcsBusySlotId) return;
  if (typeof sbGet !== 'function' || typeof sbPatch !== 'function') return;

  _mcsBusySlotId = slotId;
  renderMyCardSlotsUI(false);

  try {
    var slot = await vaultSlotsLoadOne(slotId);
    if (!slot) throw new Error('Slot not found');

    var player = await _mcsResolvePlayerForSlot(slot, false);
    if (!player || !player.playerId) throw new Error('Player profile not found');

    var claim = _mcsPlayerClaim(slot, player.playerId);
    if (!claim || claim.status !== 'confirmed') throw new Error('Payment claim not found');
    if (_vsClaimPaid(claim)) return;

    await sbPatch('slot_claims', 'id=eq.' + claim.id, { paid_at: new Date().toISOString() });
    if (typeof showToast === 'function') showToast(t('paymentMarkedPaid') || 'Payment marked paid');
  } catch (e) {
    if (typeof showToast === 'function') showToast(e.message || 'Unable to mark paid');
    else alert(e.message || 'Unable to mark paid');
  } finally {
    _mcsBusySlotId = null;
    await myCardSlotsRefreshAll(true);
    if (typeof vaultSlotsRefresh === 'function') vaultSlotsRefresh().catch(function(){});
  }
}

async function myCardSlotsJoin(slotId) {
  if (!slotId || _mcsBusySlotId) return;
  if (typeof sbGet !== 'function') return;

  _mcsBusySlotId = slotId;
  renderMyCardSlotsUI(false);

  try {
    var slot = await vaultSlotsLoadOne(slotId);
    if (!slot) throw new Error('Slot not found');

    var isPublicSlot = String(slot.visibility || 'private').toLowerCase() === 'public';
    var player = await _mcsResolvePlayerForSlot(slot, true);
    if (!player || !player.playerId) throw new Error(isPublicSlot ? 'Player profile not found' : 'Player profile not found for this club');

    if (!_mcsIsPostedFutureSlot(slot)) {
      throw new Error('This slot is not open for joining');
    }
    if (!_mcsIsEligibleSlot(slot, player)) {
      throw new Error('This slot is not available for your profile');
    }

    var existing = _mcsPlayerClaim(slot, player.playerId);
    if (existing) return;

    if (!player.guest && isPublicSlot) {
      var publicPlayer = await _mcsGetPublicPlayer(false);
      var guestClaim = publicPlayer && publicPlayer.playerId ? _mcsPlayerClaim(slot, publicPlayer.playerId) : null;
      if (guestClaim) {
        var memberClaimRows = await sbGet('slot_claims', 'slot_id=eq.' + slotId + '&player_id=eq.' + player.playerId + '&status=in.(pending,confirmed,waitlist)&select=id').catch(function(){ return []; });
        if (!memberClaimRows || !memberClaimRows.length) {
          await sbPatch('slot_claims', 'id=eq.' + guestClaim.id, { player_id: player.playerId, claimed_at: new Date().toISOString() });
          await vaultSlotsRebalanceClaims(slotId);
          return;
        }
      }
    }

    // Public guests require Slot Manager approval. Club members keep the
    // existing immediate confirmed/waitlist flow.
    var status = isPublicSlot && player.guest
      ? 'pending'
      : (slot.confirmedCount >= Number(slot.max_players || 0) ? 'waitlist' : 'confirmed');
    var oldClaims = await sbGet('slot_claims', 'slot_id=eq.' + slotId + '&player_id=eq.' + player.playerId + '&status=in.(cancelled,late_cancelled)&select=id,status').catch(function(){ return []; });
    if (oldClaims && oldClaims.length) {
      await sbPatch('slot_claims', 'id=eq.' + oldClaims[0].id, { status: status, claimed_at: new Date().toISOString() });
    } else {
      await sbPost('slot_claims', { slot_id: slotId, player_id: player.playerId, status: status, claimed_at: new Date().toISOString() });
    }
    await vaultSlotsRebalanceClaims(slotId);
  } catch (e) {
    if (typeof showToast === 'function') showToast(e.message || 'Unable to join slot');
    else alert(e.message || 'Unable to join slot');
  } finally {
    _mcsBusySlotId = null;
    await myCardSlotsRefreshAll(true);
  }
}

async function myCardSlotsJoinClubAndSlot(slotId) {
  if (!slotId || _mcsBusySlotId) return;
  if (typeof clubInviteJoinOpen !== 'function') {
    if (typeof showToast === 'function') showToast('Club joining is not available');
    return;
  }

  _mcsBusySlotId = slotId;
  renderMyCardSlotsUI(false);
  try {
    var slot = await vaultSlotsLoadOne(slotId);
    if (!slot) throw new Error('Slot not found');
    if (String(slot.visibility || 'private').toLowerCase() !== 'public') throw new Error('This is not a public slot');

    var clubId = String(slot.club_id || slot._viewerClubId || '');
    if (!clubId) throw new Error('Club not found');
    var clubName = String(slot._viewerClubName || 'Club');
    _mcsBusySlotId = null;
    if (typeof homeGo === 'function') homeGo('clubInviteJoinPage', null);
    await clubInviteJoinOpen(clubId, clubName, slot);
  } catch (e) {
    _mcsBusySlotId = null;
    if (typeof showToast === 'function') showToast(e.message || 'Unable to join club and slot');
    else alert(e.message || 'Unable to join club and slot');
    await myCardSlotsRefreshAll(true);
  }
}

async function myCardSlotsCancel(slotId) {
  if (!slotId || _mcsBusySlotId) return;
  if (typeof sbGet !== 'function') return;

  _mcsBusySlotId = slotId;
  renderMyCardSlotsUI(false);

  try {
    var slot = await vaultSlotsLoadOne(slotId);
    if (!slot) throw new Error('Slot not found');

    var isPublicSlot = String(slot.visibility || 'private').toLowerCase() === 'public';
    var player = await _mcsResolvePlayerForSlot(slot, true);
    if (!player || !player.playerId) throw new Error(isPublicSlot ? 'Player profile not found' : 'Player profile not found for this club');

    var claims = await sbGet('slot_claims', 'slot_id=eq.' + slotId + '&player_id=eq.' + player.playerId + '&status=in.(pending,confirmed,waitlist)&select=id,status').catch(function(){ return []; });
    if ((!claims || !claims.length) && !player.guest && isPublicSlot) {
      var publicPlayer = await _mcsGetPublicPlayer(false);
      if (publicPlayer && publicPlayer.playerId) {
        claims = await sbGet('slot_claims', 'slot_id=eq.' + slotId + '&player_id=eq.' + publicPlayer.playerId + '&status=in.(pending,confirmed,waitlist)&select=id,status').catch(function(){ return []; });
      }
    }
    if (claims && claims.length) {
      var nextStatus = String(claims[0].status || '').toLowerCase() === 'pending' || _vsCanFreeCancelSlot(slot, claims[0]) ? 'cancelled' : 'late_cancelled';
      var isPendingRequest = String(claims[0].status || '').toLowerCase() === 'pending';
      var ok = confirm(nextStatus === 'late_cancelled'
        ? (t('confirmLateCancelSlot') || 'No waitlist replacement is available now. If no one joins, you will be charged. Continue?')
        : (isPendingRequest
          ? (t('removePendingRequestConfirm') || 'Remove your pending slot request? You will not be penalised.')
          : (t('confirmLeaveSlot') || 'Cancel your slot booking?')));
      if (!ok) return;
      await sbPatch('slot_claims', 'id=eq.' + claims[0].id, { status: nextStatus });
      await vaultSlotsRebalanceClaims(slotId);
    }
  } catch (e) {
    if (typeof showToast === 'function') showToast(e.message || 'Unable to cancel slot');
    else alert(e.message || 'Unable to cancel slot');
  } finally {
    _mcsBusySlotId = null;
    await myCardSlotsRefreshAll(true);
  }
}


// Profile/MyCard slots must not wait for Vault.  Start a quiet sync loop after
// login/app load; it retries until auth/profile/memberships are ready and also
// reflects joins/cancellations by other players.
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(function() {
    if (typeof renderMyCardSlotsUI === 'function') {
      myCardSlotsStartAutoSync();
      myCardSlotsAutoSyncNow(false);
    }
  }, 800);
});

/* ══════════════════════════════════════════════
   VAULT HOME UPCOMING SLOTS — same visual component as Viewer
   Calendar + slot cards + More button above management tiles.
══════════════════════════════════════════════ */
var _vhsCalYear = null;
var _vhsCalMonth = null;
var _vhsSelectedDateStr = null;
var _vhsSlotsByDate = {};
var _vhsExpandedSlotId = null;
var _vhsCarouselSlotId = null;
var _vhsLoadGeneration = 0;
var _vhsSlotView = 'upcoming';
var _vhsExpandedOverview = null;
var _vhsCompletedShowAll = false;
var _vhsCompletedInitialLimit = 10;
var _vhsCompletedPaymentFilter = 'all';
// Build 1099: Club Manager slots are local-first. Supabase is the sync source,
// IndexedDB is the render source, so expanding Completed / changing payment
// filters never waits on the network.
var _vhsLocalCache = null;
var _vhsLocalCacheClubId = '';
var _vhsSyncPromise = null;
var _vhsCacheMaxAgeMs = 60 * 1000;
window._scsVaultAddSlotMode = false;

function _vhsUpdateViewControls() {
  var upcomingBtn = document.getElementById('vaultSlotsFilterUpcoming');
  var completedBtn = document.getElementById('vaultSlotsFilterCompleted');
  var title = document.querySelector('#vaultUpcomingSlots .mc-slots-title');
  var isCompleted = _vhsSlotView === 'completed';
  if (upcomingBtn) {
    upcomingBtn.classList.toggle('is-active', !isCompleted);
    upcomingBtn.setAttribute('aria-selected', isCompleted ? 'false' : 'true');
  }
  if (completedBtn) {
    completedBtn.classList.toggle('is-active', isCompleted);
    completedBtn.setAttribute('aria-selected', isCompleted ? 'true' : 'false');
  }
  if (title) title.textContent = isCompleted
    ? (t('completedSlotsTitle') || '📅 Completed Slots')
    : (t('upcomingSlotsTitle') || '📅 Upcoming Slots');
}

function vaultHomeSlotsSetView(view) {
  var next = view === 'completed' ? 'completed' : 'upcoming';
  if (_vhsSlotView === next) return;
  _vhsSlotView = next;
  _vhsSelectedDateStr = null;
  _vhsCarouselSlotId = null;
  _vhsExpandedSlotId = null;
  var today = new Date();
  _vhsCalYear = today.getFullYear();
  _vhsCalMonth = today.getMonth();
  _vhsUpdateViewControls();
  renderVaultHomeSlotsUI(true);
}

async function vaultHomeSlotsToggleSection(view) {
  var next = view === 'completed' ? 'completed' : 'upcoming';
  var same = _vhsExpandedOverview === next;
  _vhsExpandedOverview = same ? null : next;
  var panel = document.getElementById('vaultSlotExpandedPanel');
  var up = document.getElementById('vaultUpcomingCollapse');
  var done = document.getElementById('vaultCompletedCollapse');
  if (up) up.setAttribute('aria-expanded', _vhsExpandedOverview === 'upcoming' ? 'true' : 'false');
  if (done) done.setAttribute('aria-expanded', _vhsExpandedOverview === 'completed' ? 'true' : 'false');
  if (panel) panel.hidden = !_vhsExpandedOverview;
  if (!_vhsExpandedOverview) return;
  if (next === 'completed') { _vhsCompletedShowAll = false; _vhsCompletedPaymentFilter = 'all'; }
  _vhsSlotView = next;
  _vhsSelectedDateStr = null;
  _vhsCarouselSlotId = null;
  _vhsExpandedSlotId = null;
  await renderVaultHomeSlotsUI(true);
}

function vaultHomeSlotsToggleCompletedHistory() {
  _vhsCompletedShowAll = !_vhsCompletedShowAll;
  _vhsExpandedSlotId = null;
  renderVaultHomeSlotsUI(false);
}

function vaultHomeSlotsSetCompletedPaymentFilter(filter) {
  _vhsCompletedPaymentFilter = filter === 'unpaid' ? 'unpaid' : 'all';
  _vhsCompletedShowAll = false;
  _vhsExpandedSlotId = null;
  renderVaultHomeSlotsUI(false);
}

function _vhsCompletedSlotHasUnpaid(slot) {
  if (!slot || !_mcsIsPlayedSlot(slot)) return false;
  var claims = Array.isArray(slot.claims) ? slot.claims : [];
  return claims.some(function(claim) {
    return claim && String(claim.status || '').toLowerCase() === 'confirmed' && !_vsClaimPaid(claim);
  });
}

function _vhsMergeSlotCollections(a, b) {
  var map = new Map();
  ;(a || []).concat(b || []).forEach(function(slot) {
    if (!slot) return;
    var key = String(slot.id || '') || [slot.club_id, slot.slot_date, slot.start_time].join('|');
    map.set(key, slot);
  });
  return Array.from(map.values());
}

async function _vhsReadLocalSlotsCache(clubId) {
  clubId = String(clubId || '');
  if (!clubId) return null;
  if (_vhsLocalCache && _vhsLocalCacheClubId === clubId) return _vhsLocalCache;
  if (!(window.SCSOfflineDB && typeof SCSOfflineDB.getVaultSlotsCache === 'function')) return null;
  var row = await SCSOfflineDB.getVaultSlotsCache(clubId).catch(function(){ return null; });
  if (row) {
    _vhsLocalCache = row;
    _vhsLocalCacheClubId = clubId;
  }
  return row;
}

async function _vhsSyncSlotsToLocal(force) {
  var club = (typeof getMyClub === 'function') ? getMyClub() : null;
  if (!club || !club.id) return null;
  var clubId = String(club.id);
  var cached = await _vhsReadLocalSlotsCache(clubId);
  if (!force && cached && cached.syncedAt && (Date.now() - Number(cached.syncedAt) < _vhsCacheMaxAgeMs)) return cached;
  if (_vhsSyncPromise) return _vhsSyncPromise;

  _vhsSyncPromise = (async function() {
    var now = new Date();
    var first = new Date(now.getFullYear(), now.getMonth(), 1);
    var last = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    var startStr = _vsDateStr(first.getFullYear(), first.getMonth(), first.getDate());
    var endStr = _vsDateStr(last.getFullYear(), last.getMonth(), last.getDate());
    var todayStr = _vsTodayStr();

    // History and upcoming are fetched once per sync, in parallel. The UI never
    // blocks on these calls when a local snapshot already exists.
    var results = await Promise.all([
      dbGetSlotsForRange(clubId, '2000-01-01', todayStr).catch(function(){ return []; }),
      dbGetSlotsForRange(clubId, startStr, endStr).catch(function(){ return []; })
    ]);
    var slots = _vhsMergeSlotCollections(results[0], results[1]);
    var row = { clubId:clubId, syncedAt:Date.now(), slots:slots };
    _vhsLocalCache = row;
    _vhsLocalCacheClubId = clubId;
    if (window.SCSOfflineDB && typeof SCSOfflineDB.saveVaultSlotsCache === 'function') {
      await SCSOfflineDB.saveVaultSlotsCache(clubId, slots).catch(function(){});
    }
    return row;
  })().finally(function(){ _vhsSyncPromise = null; });

  return _vhsSyncPromise;
}

function _vhsOverviewFromLocalSlots(allSlots, view) {
  var slotsByDate = {};
  var todayStr = _vsTodayStr();
  ;(allSlots || []).forEach(function(slot) {
    if (!slot || !slot.slot_date) return;
    var status = String(slot.status || '').toLowerCase();
    var isCompleted = status === 'played' || status === 'completed' || status === 'cancelled' || !!slot.played_session_id;
    if (view === 'completed') {
      if (!isCompleted) return;
    } else {
      if (isCompleted) return;
      if (!(status === 'draft' || status === 'scheduled' || status === 'posted')) return;
      if (String(slot.slot_date || '') < todayStr) return;
    }
    (slotsByDate[slot.slot_date] = slotsByDate[slot.slot_date] || []).push(slot);
  });
  return { dates:Object.keys(slotsByDate).sort(), slotsByDate:slotsByDate };
}

function homeToggleMoreTilesVault() {
  var sec = document.getElementById('homeMoreSectionVault');
  var label = document.getElementById('homeShowMoreLabelVault');
  if (!sec) return;
  var open = sec.classList.contains('home-more-expanded');
  sec.classList.toggle('home-more-expanded', !open);
  sec.classList.toggle('home-more-collapsed', open);
  if (label) label.textContent = open ? 'More ›' : 'Less ˄';
}

function vaultHomeSlotsChangeMonth(delta) {
  var today = new Date();
  if (_vhsCalYear === null || _vhsCalMonth === null) {
    _vhsCalYear = today.getFullYear();
    _vhsCalMonth = today.getMonth();
  }
  _vhsCalMonth += delta;
  if (_vhsCalMonth < 0) { _vhsCalMonth = 11; _vhsCalYear--; }
  if (_vhsCalMonth > 11) { _vhsCalMonth = 0; _vhsCalYear++; }
  _vhsSelectedDateStr = null;
  _vhsCarouselSlotId = null;
  renderVaultHomeSlotsUI(true);
}

function vaultHomeSlotsSelectDate(dateStr) {
  _vhsSelectedDateStr = dateStr;
  _vhsCarouselSlotId = null;

  var d = new Date(String(dateStr || '') + 'T00:00:00');
  var monthChanged = false;
  if (!isNaN(d.getTime()) &&
      (d.getFullYear() !== _vhsCalYear || d.getMonth() !== _vhsCalMonth)) {
    _vhsCalYear = d.getFullYear();
    _vhsCalMonth = d.getMonth();
    monthChanged = true;
  }

  // Vault home is now the single source of truth: tapping a day only changes
  // the selected date and refreshes the inline slot list below the calendar.
  // The old date-list popup is intentionally not opened here anymore.
  renderVaultHomeSlotsUI(monthChanged);
}

function vaultHomeSlotsAddSlot(dateStr) {
  dateStr = dateStr || _vhsSelectedDateStr || _vsTodayStr();
  _vhsSelectedDateStr = dateStr;
  _vsSelectedDateStr = dateStr;
  _vsCalYear = _vhsCalYear;
  _vsCalMonth = _vhsCalMonth;
  _vsSlotsByDate = _vhsSlotsByDate || {};

  var overlay = document.getElementById('vsDateSheetOverlay');
  var titleEl = document.getElementById('vsDateSheetTitle');
  var contentEl = document.getElementById('vsDateSheetContent');
  if (!overlay || !contentEl) return;

  if (overlay.parentElement && overlay.parentElement.id === 'vaultSlotsPage') {
    document.body.appendChild(overlay);
  }

  var d = new Date(dateStr + 'T00:00:00');
  var dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (titleEl && !isNaN(d.getTime())) {
    titleEl.textContent = dayNames[d.getDay()] + ', ' + monthNames[d.getMonth()] + ' ' + d.getDate();
  }
  contentEl.innerHTML = _vsPostFormHtml();
  overlay.style.display = 'flex';
}

function vaultHomeSlotsToggleDetails(slotId) {
  slotId = String(slotId || '');
  _vhsCarouselSlotId = slotId;
  _vhsExpandedSlotId = (_vhsExpandedSlotId === slotId) ? null : slotId;
  renderVaultHomeSlotsUI(false);
}

function _vhsIsVisibleVaultSlot(slot) {
  var status = String((slot && slot.status) || 'draft').toLowerCase();
  var isCompleted = status === 'played' || status === 'completed' || status === 'cancelled' || !!(slot && slot.played_session_id);
  if (_vhsSlotView === 'completed') return isCompleted;
  if (isCompleted) return false;
  return (status === 'draft' || status === 'scheduled' || status === 'posted') && String(slot.slot_date || '') >= _vsTodayStr();
}

async function _vhsLoadMonthSlots() {
  var generation = ++_vhsLoadGeneration;
  // Startup calls this loader directly before the Vault page renderer. Ensure
  // it prefetches the real current month instead of Date(null, null, ...).
  if (_vhsCalYear === null || _vhsCalMonth === null) {
    var startupToday = new Date();
    _vhsCalYear = startupToday.getFullYear();
    _vhsCalMonth = startupToday.getMonth();
  }
  var club = (typeof getMyClub === 'function') ? getMyClub() : null;
  if (!club || !club.id) {
    if (generation === _vhsLoadGeneration) _vhsSlotsByDate = {};
    return;
  }

  var first = new Date(_vhsCalYear, _vhsCalMonth, 1);
  var last = new Date(_vhsCalYear, _vhsCalMonth + 2, 0);
  var startStr = _vsDateStr(first.getFullYear(), first.getMonth(), first.getDate());
  var endStr = _vsDateStr(last.getFullYear(), last.getMonth(), last.getDate());
  var slots = await dbGetSlotsForRange(club.id, startStr, endStr).catch(function(){ return []; });
  if (generation !== _vhsLoadGeneration) return;
  var nextSlotsByDate = {};
  var seenSlotIds = new Set();
  (slots || []).forEach(function(s) {
    if (!_vhsIsVisibleVaultSlot(s)) return;
    var slotKey = String(s && s.id || '');
    if (slotKey && seenSlotIds.has(slotKey)) return;
    if (slotKey) seenSlotIds.add(slotKey);
    s._viewerClubId = String(club.id || '');
    s._viewerClubName = club.name || 'Club';
    s._viewerClubColor = '#8b5cf6';
    s._clubFilterMatched = true;
    (nextSlotsByDate[s.slot_date] = nextSlotsByDate[s.slot_date] || []).push(s);
  });
  _vhsSlotsByDate = nextSlotsByDate;

  // Keep the original Vault slot sheet data synchronized, because Vault home now
  // reuses the Viewer-style calendar instead of the old separate slot page.
  _vsCalYear = _vhsCalYear;
  _vsCalMonth = _vhsCalMonth;
  _vsSlotsByDate = _vhsSlotsByDate;
}

/* Build 431: expose the exact prefetched Club Manager collection to the welcome hub. */
window.scsGetPrefetchedVaultSlots = function scsGetPrefetchedVaultSlots(clubId) {
  var expected = String(clubId || '');
  var out = [];
  Object.keys(_vhsSlotsByDate || {}).forEach(function(dateStr) {
    (_vhsSlotsByDate[dateStr] || []).forEach(function(slot) {
      if (!slot) return;
      var slotClubId = String(slot._viewerClubId || slot.club_id || '');
      if (!expected || !slotClubId || slotClubId === expected) out.push(slot);
    });
  });
  return out;
};

function _vhsDateStatusClass(daySlots) {
  return _vsDateGenderClass(daySlots);
}

function _vhsRenderCalendarDay(dateStr, dayNumber, extraClass) {
  var daySlots = _vhsSlotsByDate[dateStr] || [];
  var todayStr = _vsTodayStr();
  var isToday = dateStr === todayStr;
  var isPast = dateStr < todayStr;
  var isSelected = dateStr === _vhsSelectedDateStr;
  var statusClass = _vhsDateStatusClass(daySlots);
  return '<div class="vs-cal-day mc-slots-day' +
    (extraClass ? ' ' + extraClass : '') +
    (statusClass ? ' ' + statusClass : '') +
    (isToday ? ' vs-cal-today' : '') +
    (isPast ? ' vs-cal-past' : '') +
    (isSelected ? ' mc-slots-selected' : '') + '" ' +
    'onclick="vaultHomeSlotsSelectDate(\'' + dateStr + '\')"><span class="vs-cal-num">' + dayNumber + '</span></div>';
}

function _vhsRenderCalendarGrid(targetId) {
  var gridEl = document.getElementById(targetId || 'vaultSlotsCalGrid');
  if (!gridEl) return;
  var firstOfMonth = new Date(_vhsCalYear, _vhsCalMonth, 1);
  var lastOfMonth = new Date(_vhsCalYear, _vhsCalMonth + 1, 0);
  var startWeekday = firstOfMonth.getDay();
  var daysInMonth = lastOfMonth.getDate();
  var html = '';
  for (var i = 0; i < startWeekday; i++) html += '<div class="vs-cal-day vs-cal-empty"></div>';
  for (var d = 1; d <= daysInMonth; d++) {
    html += _vhsRenderCalendarDay(_vsDateStr(_vhsCalYear, _vhsCalMonth, d), d, '');
  }
  var usedCells = startWeekday + daysInMonth;
  var remainder = usedCells % 7;
  if (remainder) {
    var nextDays = 7 - remainder;
    for (var nd = 1; nd <= nextDays; nd++) {
      html += _vhsRenderCalendarDay(_vsDateStr(_vhsCalYear, _vhsCalMonth + 1, nd), nd, 'mc-slots-next-month');
    }
  }
  gridEl.innerHTML = html;
}

function _vhsSlotStatusBadge(slot) {
  var st = String(slot.status || 'posted').toLowerCase();
  if (st === 'draft') return t('draft') || 'Draft';
  if (st === 'played' || slot.played_session_id) return t('slotPlayed') || 'Played';
  if (st === 'posted') return t('posted') || 'Posted';
  if (st === 'scheduled') return t('scheduled') || 'Scheduled';
  if (st === 'cancelled') return t('cancelled') || 'Cancelled';
  return '';
}

async function vaultSlotsJoinProbabilityPreview(slotId, waitlistCount) {
  var waiting = Number(waitlistCount || 0);
  if (waiting < 1) {
    alert(t('joinProbabilityNeedsWaitlist') || 'Join Probability is available only when the slot has waiting players.');
    return;
  }
  var ok = confirm(t('confirmJoinProbabilityRequest') || 'Send a Join Probability request to all confirmed players?');
  if (!ok) return;
  try {
    var requestedAt = new Date().toISOString();
    await sbPatch('slots', 'id=eq.' + encodeURIComponent(slotId), {
      join_probability_requested_at: requestedAt,
      join_probability_reminder_at: null
    });
    await sbPatch('slot_claims', 'slot_id=eq.' + encodeURIComponent(slotId) + '&status=eq.confirmed', {
      join_probability: null,
      join_probability_updated_at: null
    }).catch(function(){});
    alert(t('joinProbabilitySent') || 'Join Probability request sent to all confirmed players.');
    if (typeof vaultHomeSlotsRefresh === 'function') vaultHomeSlotsRefresh();
    if (typeof vaultSlotsRefresh === 'function') vaultSlotsRefresh();
    if (typeof scsJoinProbabilityCheckNow === 'function') scsJoinProbabilityCheckNow();
  } catch (e) {
    console.error('Join Probability request failed', e);
    alert((t('joinProbabilitySendFailed') || 'Could not send Join Probability request.') + '\n' + (e.message || e));
  }
}

function _vhsRenderSlotCard(slot) {
  var confirmed = Number(slot.confirmedCount || 0);
  var max = Number(slot.max_players || 0);
  var full = max && confirmed >= max;
  var countText = confirmed + '/' + (max || '—');
  var isOpen = String(_vhsExpandedSlotId || '') === String(slot.id || '');
  var sid = _vsEscape(slot.id);
  var status = _vhsSlotStatusBadge(slot);
  var club = _mcsClubForSlot ? _mcsClubForSlot(slot) : { name: 'Club', color: '#8b5cf6' };
  var compactClass = slot && slot._vhsCompact ? ' is-next30-card' : '';
  var slotStatus = String(slot.status || 'posted').toLowerCase();
  var isDraftSlot = slotStatus === 'draft';
  var isScheduledSlot = slotStatus === 'scheduled';
  var isCancelledSlot = slotStatus === 'cancelled';
  var isPlayedSlot = _mcsIsPlayedSlot(slot);
  var statusClass = isCancelledSlot ? ' is-vault-cancelled' : (isPlayedSlot ? ' is-vault-played' : (isScheduledSlot ? ' is-vault-scheduled' : (isDraftSlot ? ' is-vault-draft' : ' is-vault-posted')));
  var statusColor = isCancelledSlot ? '#ef4444' : (isPlayedSlot ? '#38bdf8' : (isScheduledSlot ? '#a78bfa' : (isDraftSlot ? '#f5a623' : '#2dce89')));
  var costLabel = _vsSlotCostLabel(slot);
  var paymentMeta = costLabel
    ? '<div class="mc-slot-payment-meta"><span>' + _vsEscape(t('cost') || 'Cost') + ': ' + _vsEscape(costLabel) + '</span></div>'
    : '';
  var genderClass = _vsDateGenderClass([slot]);
  var fillPct = _vsSlotFillPercent(slot);
  var fillColor = _vsSlotFillColor(slot);

  return '<div class="mc-slot-card' + (isOpen ? ' is-expanded' : '') + compactClass + statusClass + (genderClass ? ' ' + genderClass : '') + '" data-slot-id="' + sid + '" style="--mc-club-color:' + _vsEscape(statusColor) + ';--slot-fill:' + fillPct + '%;--slot-status-color:' + _vsEscape(fillColor) + '">' +
    '<div class="mc-slot-titlebar"><span>' + _vsEscape(club.name || 'Club') + '</span><strong>' + _vsEscape(_vsSlotGenderLabel(slot)) + '</strong></div>' +
    '<div class="mc-slot-card-head" onclick="vaultHomeSlotsToggleDetails(\'' + sid + '\')">' +
      '<div class="mc-slot-time-row">' +
        '<div class="mc-slot-title">' + _vsEscape(_mcsSlotTitle ? _mcsSlotTitle(slot) : _vsSlotVisibilityLabel(slot)) + (status ? ' <span class="mc-slot-status-inline">' + status + '</span>' : '') + '</div>' +
        '<div class="mc-slot-chevron">' + (isOpen ? '▲' : '▼') + '</div>' +
      '</div>' +
      '<div class="mc-slot-main">' +
        '<div>' +
          '<div class="mc-slot-time">' + _vsEscape(_mcsFormatDateTitle(slot.slot_date)) + ' · ' + _vsFormatTime(slot.start_time) + ' – ' + _vsFormatTime(slot.end_time) + '</div>' +
          _vsSlotVenueHtml(slot) +
          '<div class="mc-slot-info-row">' +
            _vsSessionMetaHtml(slot) +
            '<div class="mc-slot-count-row"><div class="mc-slot-count-pill' + (full ? ' is-full' : '') + '">' + countText + (slot.waitlistCount ? ' · ' + slot.waitlistCount + 'W' : '') + '</div></div>' +
          '</div>' +
          '<div class="mc-slot-club-pill">' + _vsEscape(club.name || 'Club') + ' · ' + _vsEscape(t('vault') || 'Vault') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="mc-slot-footer"><span>' + _vsEscape(_mcsSlotLevelText ? _mcsSlotLevelText(slot) : (t('allLevel') || 'All levels')) + '</span><span class="mc-slot-footer-actions" onclick="event.stopPropagation()">' +
        '<button class="mc-slot-action-btn" onclick="vaultSlotsViewSlot(\'' + sid + '\')">' + _vsEscape(t('manage') || 'Manage') + '</button></span></div>' +
    '</div>' +
    (isOpen ? _mcsRenderClaimList(slot, true) : '') +
  '</div>';
}

function _vhsRenderNext30SlotsSection(selectedDateStr) {
  if (!selectedDateStr) return '';
  var endDateStr = _mcsAddDaysStr(selectedDateStr, 30);
  var dates = Object.keys(_vhsSlotsByDate || {}).sort().filter(function(dateStr) {
    return dateStr > selectedDateStr && dateStr <= endDateStr && (_vhsSlotsByDate[dateStr] || []).length;
  });
  if (!dates.length) return '';

  var html = '<div class="mc-next30-section">' +
    '<div class="mc-next30-header">' +
      '<span class="mc-next30-arrow">↓</span>' +
      '<span>' + _vsEscape(t('next30Slots') || 'Next 30 days') + '</span>' +
    '</div>';

  dates.forEach(function(dateStr) {
    html += '<div class="mc-next30-date-group">' +
      '<div class="mc-next30-date-title">' + _vsEscape(_mcsFormatDateTitle(dateStr)) + '</div>' +
      (_vhsSlotsByDate[dateStr] || []).map(function(slot) {
        return _vhsRenderSlotCard({ ...slot, _vhsCompact: true });
      }).join('') +
    '</div>';
  });

  return html + '</div>';
}

async function renderVaultHomeSlotsUI(loadFresh) {
  var section = document.getElementById('vaultUpcomingSlots');
  var listEl = document.getElementById('vaultSlotsList');
  if (!section || !listEl) return;

  var addMode = !!window._scsVaultAddSlotMode;
  section.classList.toggle('is-add-slot-mode', addMode);
  var addCalendar = document.getElementById('vaultAddSlotCalendar');
  if (addCalendar) addCalendar.hidden = !addMode;

  var today = new Date();
  if (_vhsCalYear === null || _vhsCalMonth === null) {
    _vhsCalYear = today.getFullYear(); _vhsCalMonth = today.getMonth();
  }

  if (addMode) {
    _vhsSlotView = 'upcoming';
    if (!_vhsSelectedDateStr || _vhsSelectedDateStr < _vsTodayStr()) _vhsSelectedDateStr = _vsTodayStr();
    var labelEl = document.getElementById('vaultSlotsMonthLabel');
    if (labelEl) labelEl.textContent = _vsMonthLabel(_vhsCalYear, _vhsCalMonth);
    if (loadFresh !== false) await _vhsLoadMonthSlots();
    _vhsRenderCalendarGrid();
    return;
  }

  // Local-first overview: read IndexedDB immediately, then sync Supabase in the
  // background. Expanding cards and switching All / Not Paid use only this cache.
  var club = (typeof getMyClub === 'function') ? getMyClub() : null;
  var cacheRow = club && club.id ? await _vhsReadLocalSlotsCache(club.id) : null;
  if (!cacheRow) cacheRow = await _vhsSyncSlotsToLocal(true).catch(function(){ return null; });
  var localSlots = cacheRow && Array.isArray(cacheRow.slots) ? cacheRow.slots : [];
  var upcoming = _vhsOverviewFromLocalSlots(localSlots, 'upcoming');
  var completed = _vhsOverviewFromLocalSlots(localSlots, 'completed');
  var wanted = _vhsExpandedOverview || 'upcoming';
  var upCount = _vsFlattenSlotsByDate(upcoming.slotsByDate).length;
  var doneCount = _vsFlattenSlotsByDate(completed.slotsByDate).length;
  var upCountEl = document.getElementById('vaultSlotsCount');
  var doneCountEl = document.getElementById('vaultCompletedSlotsCount');
  var upSummary = document.getElementById('vaultSlotsSummary');
  var doneSummary = document.getElementById('vaultCompletedSlotsSummary');
  if (upCountEl) upCountEl.textContent = upCount;
  if (doneCountEl) doneCountEl.textContent = doneCount;
  if (upSummary) upSummary.textContent = upCount ? upCount + ' upcoming session' + (upCount === 1 ? '' : 's') : 'No upcoming sessions';
  if (doneSummary) doneSummary.textContent = doneCount ? doneCount + ' completed session' + (doneCount === 1 ? '' : 's') : 'No completed sessions';

  // Refresh stale data after paint. Do not make the user wait for Supabase.
  var cacheAge = cacheRow && cacheRow.syncedAt ? Date.now() - Number(cacheRow.syncedAt) : Infinity;
  if ((loadFresh !== false || cacheAge > _vhsCacheMaxAgeMs) && !_vhsSyncPromise) {
    _vhsSyncSlotsToLocal(true).then(function(row) {
      if (!row) return;
      var page = document.getElementById('vaultSlotsPage');
      if (page && page.style.display !== 'none') renderVaultHomeSlotsUI(false);
    }).catch(function(){});
  }
  var panel = document.getElementById('vaultSlotExpandedPanel');
  var completedCalendar = document.getElementById('vaultCompletedCalendar');
  var upBtn = document.getElementById('vaultUpcomingCollapse');
  var doneBtn = document.getElementById('vaultCompletedCollapse');
  if (upBtn) upBtn.setAttribute('aria-expanded', wanted === 'upcoming' && !!_vhsExpandedOverview ? 'true' : 'false');
  if (doneBtn) doneBtn.setAttribute('aria-expanded', wanted === 'completed' && !!_vhsExpandedOverview ? 'true' : 'false');
  if (panel) panel.hidden = !_vhsExpandedOverview;
  if (completedCalendar) completedCalendar.hidden = true;
  if (!_vhsExpandedOverview) { listEl.innerHTML = ''; _vhsSlotView = 'upcoming'; _vhsSlotsByDate = upcoming.slotsByDate; return; }

  var data = wanted === 'completed' ? completed : upcoming;
  _vhsSlotView = wanted;
  _vhsSlotsByDate = data.slotsByDate;

  var slots = wanted === 'completed'
    ? _vsFlattenSlotsByDate(_vhsSlotsByDate).sort(function(a, b) {
        var dateCompare = String(b.slot_date || '').localeCompare(String(a.slot_date || ''));
        return dateCompare || String(b.start_time || '').localeCompare(String(a.start_time || ''));
      })
    : _vsFlattenSlotsByDate(_vhsSlotsByDate);
  if (!slots.length) {
    listEl.innerHTML = '<div class="mc-slots-empty">' + (wanted === 'completed' ? 'No completed sessions' : 'No upcoming sessions') + '</div>';
    return;
  }
  if (wanted === 'completed') {
    var paymentFilter = '<div class="vault-completed-payment-filter" role="tablist" aria-label="Completed session payment filter">' +
      '<button type="button" class="' + (_vhsCompletedPaymentFilter === 'all' ? 'is-active' : '') + '" onclick="vaultHomeSlotsSetCompletedPaymentFilter(\'all\')" aria-selected="' + (_vhsCompletedPaymentFilter === 'all' ? 'true' : 'false') + '">All</button>' +
      '<button type="button" class="' + (_vhsCompletedPaymentFilter === 'unpaid' ? 'is-active' : '') + '" onclick="vaultHomeSlotsSetCompletedPaymentFilter(\'unpaid\')" aria-selected="' + (_vhsCompletedPaymentFilter === 'unpaid' ? 'true' : 'false') + '">Not Paid</button>' +
    '</div>';
    if (_vhsCompletedPaymentFilter === 'unpaid') slots = slots.filter(_vhsCompletedSlotHasUnpaid);
    if (!slots.length) {
      listEl.innerHTML = paymentFilter + '<div class="mc-slots-empty">' + (_vhsCompletedPaymentFilter === 'unpaid' ? 'No not paid sessions' : 'No completed sessions') + '</div>';
      return;
    }
    var visibleSlots = _vhsCompletedShowAll ? slots : slots.slice(0, _vhsCompletedInitialLimit);
    var historyControl = slots.length > _vhsCompletedInitialLimit
      ? '<button type="button" class="vault-completed-history-toggle" onclick="vaultHomeSlotsToggleCompletedHistory()" aria-expanded="' + (_vhsCompletedShowAll ? 'true' : 'false') + '">' +
          (_vhsCompletedShowAll ? 'Show recent 10' : 'Show all ' + slots.length + ' sessions') +
        '<span aria-hidden="true">' + (_vhsCompletedShowAll ? '⌃' : '⌄') + '</span></button>'
      : '';
    listEl.innerHTML = paymentFilter + visibleSlots.map(_vhsRenderSlotCard).join('') + historyControl;
    return;
  }
  listEl.innerHTML = slots.map(_vhsRenderSlotCard).join('');
}

// Refresh the Viewer-style Vault calendar after creating/updating/deleting from
// the bottom sheet, so the new slot appears immediately on the same Vault page.
(function() {
  if (window.__vaultHomeSheetRefreshHook) return;
  window.__vaultHomeSheetRefreshHook = true;

  var oldClose = window.vaultSlotsCloseDateSheet;
  if (typeof oldClose === 'function') {
    window.vaultSlotsCloseDateSheet = function(evt) {
      var result = oldClose.apply(this, arguments);
      setTimeout(function() {
        if (document.getElementById('vaultUpcomingSlots')) renderVaultHomeSlotsUI(true);
      }, 80);
      return result;
    };
  }
})();

// Backward-compatible name used by HomeScreen.js when Vault home refreshes.
async function vaultSlotsRenderMiniTile(clubId) {
  return renderVaultHomeSlotsUI(true);
}

/* Show a due, unstarted slot on the post-login hub launcher. */
var _launcherDueSlot = null;
var _launcherStartCardTimer = null;
async function renderLauncherStartSessionCard() {
  await vaultSlotsCleanupExpired(false).catch(function(){});
  var organiserCard = document.getElementById('organiserNextSlotCard');
  var launcherCard = document.getElementById('launcherStartSessionCard');
  if (!organiserCard && !launcherCard) return;

  var clubId = localStorage.getItem('kbrr_org_club_id') || '';
  var clubName = localStorage.getItem('kbrr_org_club_name') || 'Club';
  if (!clubId || typeof dbGetSlotsForRange !== 'function') return;

  var authUser = (typeof authGetUser === 'function') ? authGetUser() : null;
  var organiserPlayerIds = new Set();
  if (authUser && authUser.id && typeof sbGet === 'function') {
    var memberships = await sbGet('memberships',
      'club_id=eq.' + clubId + '&user_account_id=eq.' + authUser.id + '&select=player_id')
      .catch(function() { return null; });
    if (memberships !== null) {
      organiserPlayerIds = new Set((memberships || []).map(function(membership) {
        return membership && membership.player_id ? String(membership.player_id) : '';
      }).filter(Boolean));
    }
  }

  var now = new Date();
  var today = typeof localDateStr === 'function' ? localDateStr(now) : now.toISOString().slice(0, 10);
  var minutesNow = now.getHours() * 60 + now.getMinutes();
  var rangeEndDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 90);
  var rangeEnd = typeof localDateStr === 'function' ? localDateStr(rangeEndDate) : rangeEndDate.toISOString().slice(0, 10);
  var slotsLoadSucceeded = true;
  var slots = await dbGetSlotsForRange(clubId, today, rangeEnd).catch(function(error) {
    slotsLoadSucceeded = false;
    console.warn('Upcoming organiser slot refresh failed:', error);
    return null;
  });

  // Preserve the last successfully rendered card during a temporary DB/network failure.
  if (!slotsLoadSucceeded || !Array.isArray(slots)) {
    if (_launcherStartCardTimer) clearTimeout(_launcherStartCardTimer);
    _launcherStartCardTimer = setTimeout(renderLauncherStartSessionCard, 15000);
    return;
  }

  var upcomingSlots = slots.filter(function(slot) {
    if (!slot || slot.played_session_id) return false;
    if (String(slot.status || '').toLowerCase() !== 'posted') return false;
    var slotDate = String(slot.slot_date || '');
    if (!slotDate || slotDate < today) return false;
    if (slotDate === today) {
      var endParts = String(slot.end_time || '').split(':');
      if (endParts.length >= 2) {
        var endMinutes = (parseInt(endParts[0], 10) || 0) * 60 + (parseInt(endParts[1], 10) || 0);
        if (minutesNow >= endMinutes) return false;
      }
    }
    return true;
  }).sort(function(a, b) {
    return String(a.slot_date || '').localeCompare(String(b.slot_date || '')) ||
      String(a.start_time || '').localeCompare(String(b.start_time || ''));
  });

  if (!upcomingSlots.length) {
    [organiserCard, launcherCard].forEach(function(host) {
      if (!host) return;
      host.style.display = 'none';
      host.innerHTML = '';
      delete host.dataset.slotId;
    });
    _launcherDueSlot = null;
    if (_launcherStartCardTimer) clearTimeout(_launcherStartCardTimer);
    _launcherStartCardTimer = setTimeout(renderLauncherStartSessionCard, 15000);
    return;
  }

  var slot = upcomingSlots[0];
  slot._viewerClubName = clubName;
  var confirmedClaims = (slot.claims || []).filter(function(claim) {
    return claim && claim.status === 'confirmed';
  });
  var organiserJoined = confirmedClaims.some(function(claim) {
    return organiserPlayerIds.has(String(claim.player_id || ''));
  });
  var slotDateText = String(slot.slot_date || '');
  var isTodaySlot = slotDateText === today;
  var startParts = String(slot.start_time || '').split(':');
  var slotStartMinutes = (parseInt(startParts[0], 10) || 0) * 60 + (parseInt(startParts[1], 10) || 0);
  var isWithinStartWindow = isTodaySlot && minutesNow >= slotStartMinutes - 15;
  var canStart = isTodaySlot && isWithinStartWindow && confirmedClaims.length >= 4 && organiserJoined;

  function buildFreshDashboardCard() {
    if (typeof _buildDashboardSlotCard !== 'function') return null;
    var dashboardCard = _buildDashboardSlotCard(slot);
    dashboardCard.classList.add('organiser-dashboard-slot-card');
    dashboardCard.classList.toggle('is-today-organiser-slot', isTodaySlot);
    var startBtn = dashboardCard.querySelector('.mc-slot-action-btn');
    if (startBtn) {
      var reason = '';
      if (!organiserJoined) reason = t('joinSlotToStart') || 'Join this slot to start';
      else if (!isTodaySlot) reason = slotDateText;
      else if (!isWithinStartWindow) {
        var unlock = (slotStartMinutes - 15 + 1440) % 1440;
        reason = 'Enabled at ' + String(Math.floor(unlock / 60)).padStart(2, '0') + ':' + String(unlock % 60).padStart(2, '0');
      } else if (confirmedClaims.length < 4) reason = t('need4Players') || 'Need 4 players';
      startBtn.disabled = !canStart;
      startBtn.textContent = canStart ? (t('startSession') || 'Start Session') : reason;
      startBtn.onclick = async function(event) {
        event.stopPropagation();
        if (!canStart || startBtn.disabled || typeof vaultSlotsStartRoundsFromSlot !== 'function') return;
        startBtn.disabled = true;
        startBtn.textContent = t('starting') || 'Starting...';
        try {
          await vaultSlotsStartRoundsFromSlot(slot.id);
        } finally {
          if (typeof renderLauncherStartSessionCard === 'function') renderLauncherStartSessionCard();
        }
      };
    }
    return dashboardCard;
  }

  [organiserCard, launcherCard].forEach(function(host) {
    if (!host) return;
    var fresh = buildFreshDashboardCard();
    if (!fresh) return;
    host.innerHTML = '';
    host.appendChild(fresh);
    host.dataset.slotId = String(slot.id || '');
    host.style.display = 'flex';
  });

  _launcherDueSlot = { slotId: String(slot.id || ''), clubId: String(clubId), clubName: clubName, canStart: canStart };
  if (_launcherStartCardTimer) clearTimeout(_launcherStartCardTimer);
  _launcherStartCardTimer = setTimeout(renderLauncherStartSessionCard, 15000);
}

function closeLauncherStartSessionCard() {
  var slotId = _launcherDueSlot && _launcherDueSlot.slotId;
  if (slotId) sessionStorage.setItem('scs_start_popup_closed_' + String(slotId), '1');
  var card = document.getElementById('launcherStartSessionCard');
  if (card) {
    card.style.display = 'none';
    card.innerHTML = '';
  }
  _launcherDueSlot = null;
  if (_launcherStartCardTimer) clearTimeout(_launcherStartCardTimer);
  _launcherStartCardTimer = null;
}

async function launcherStartSlotSession() {
  if (!_launcherDueSlot || !_launcherDueSlot.canStart) return;
  var slotId = _launcherDueSlot && _launcherDueSlot.slotId;
  var clubId = _launcherDueSlot && _launcherDueSlot.clubId;
  var clubName = _launcherDueSlot && _launcherDueSlot.clubName;
  if (!slotId || !clubId) return;
  var card = document.getElementById('launcherStartSessionCard');
  if (card) card.style.display = 'none';
  if (_launcherStartCardTimer) clearTimeout(_launcherStartCardTimer);
  if (typeof setMyClub === 'function') setMyClub(clubId, clubName || '');
  appMode = 'organiser';
  sessionStorage.setItem('appMode', 'organiser');
  localStorage.setItem('kbrr_app_mode', 'organiser');
  if (typeof applyMode === 'function') applyMode('organiser');
  var overlay = document.getElementById('modeSelectOverlay');
  if (overlay) overlay.style.display = 'none';
  await vaultSlotsStartRoundsFromSlot(slotId);
}

var _vaultHomeManualRefreshBusy = false;
async function vaultHomeSlotsManualRefresh() {
  if (_vaultHomeManualRefreshBusy) return;
  _vaultHomeManualRefreshBusy = true;
  var btn = document.getElementById('vaultSlotsRefreshBtn');
  if (btn) { btn.disabled = true; btn.classList.add('is-refreshing'); }
  try {
    await renderVaultHomeSlotsUI(true);
  } finally {
    _vaultHomeManualRefreshBusy = false;
    if (btn) { btn.disabled = false; btn.classList.remove('is-refreshing'); }
  }
}


/* ══════════════════════════════════════════════
   VAULT VENUES — master venue list + club favorites
   DB design:
   - venues = common physical locations
   - clubs.favorite_venues = uuid[] of preferred venues for the active club
══════════════════════════════════════════════ */
var _vaultVenuesCache = [];
var _vaultVenueFavorites = [];
var _vaultVenuesEditingId = null;
var _vaultVenuesDbAvailable = true;

function _venueClubId() {
  var mode = sessionStorage.getItem('appMode') || localStorage.getItem('kbrr_app_mode') || '';
  if (mode === 'vault') {
    var vaultClubId = localStorage.getItem('kbrr_vault_club_id') || '';
    if (vaultClubId) return String(vaultClubId);
    return 'none';
  }
  if (mode === 'organiser') {
    var orgClubId = localStorage.getItem('kbrr_org_club_id') || '';
    if (orgClubId) return String(orgClubId);
    return 'none';
  }
  var club = (typeof getMyClub === 'function') ? getMyClub() : null;
  return club && club.id ? String(club.id) : 'none';
}
async function _venueRepairVaultClubIdFromName(badClubId) {
  var mode = sessionStorage.getItem('appMode') || localStorage.getItem('kbrr_app_mode') || '';
  if (mode !== 'vault' || typeof sbGet !== 'function') return '';
  var name = localStorage.getItem('kbrr_vault_club_name') ||
    localStorage.getItem('kbrr_my_club_name') ||
    '';
  name = String(name || '').trim();
  if (!name) return '';
  var rows = await sbGet('clubs', 'name=eq.' + encodeURIComponent(name) + '&select=id,name&limit=2').catch(function(){ return []; });
  if (!rows || rows.length !== 1 || !rows[0].id) return '';
  var fixedId = String(rows[0].id);
  if (badClubId && fixedId === String(badClubId)) return '';
  localStorage.setItem('kbrr_vault_club_id', fixedId);
  localStorage.setItem('kbrr_vault_club_name', rows[0].name || name);
  if (typeof setMyClub === 'function') setMyClub(fixedId, rows[0].name || name);
  return fixedId;
}
function _venueLocalKey() { return 'scs_master_venues_cache'; }
function _venueFavLocalKey() { return 'scs_club_fav_venues_' + _venueClubId(); }
function _venueLocalLoad() {
  try { return JSON.parse(localStorage.getItem(_venueLocalKey()) || '[]') || []; }
  catch(e) { return []; }
}
function _venueLocalSave(list) { localStorage.setItem(_venueLocalKey(), JSON.stringify(list || [])); }
function _venueFavLocalLoad() {
  try { return JSON.parse(localStorage.getItem(_venueFavLocalKey()) || '[]') || []; }
  catch(e) { return []; }
}
function _venueFavLocalSave(list) { localStorage.setItem(_venueFavLocalKey(), JSON.stringify(list || [])); }

function _venueNormalize(v) {
  v = v || {};
  var lat = (v.latitude !== undefined) ? v.latitude : v.lat;
  var lng = (v.longitude !== undefined) ? v.longitude : v.lng;
  return {
    id: String(v.id || ('local_' + Date.now() + '_' + Math.random().toString(36).slice(2,7))),
    name: String(v.english_name || v.name || v.venue_name || '').trim(),
    english_name: String(v.english_name || v.name || v.venue_name || '').trim(),
    japanese_name: String(v.japanese_name || '').trim(),
    address: String(v.address || '').trim(),
    address_ja: String(v.address_ja || '').trim(),
    maps_url: String(v.maps_url || v.map_url || v.google_map_url || '').trim(),
    latitude: (lat !== undefined && lat !== null && lat !== '') ? Number(lat) : null,
    longitude: (lng !== undefined && lng !== null && lng !== '') ? Number(lng) : null,
    court_count: (v.court_count !== undefined && v.court_count !== null && v.court_count !== '') ? Number(v.court_count) : 0,
    indoor: v.indoor === undefined ? true : !!v.indoor,
    parking: !!v.parking,
    notes: String(v.notes || '').trim(),
    active: v.active === undefined ? true : !!v.active,
    created_at: v.created_at || new Date().toISOString()
  };
}
function _venueGetField(id) { return (document.getElementById(id)?.value || '').trim(); }
function _venueSetField(id, val) { var el = document.getElementById(id); if (el) el.value = (val == null ? '' : val); }
function _venueSetFeedback(msg, ok) {
  var fb = document.getElementById('venueFormFeedback');
  if (fb) { fb.textContent = msg || ''; fb.style.color = ok ? 'var(--green)' : 'var(--red)'; }
}
function _venueFavoriteSet() { return new Set((_vaultVenueFavorites || []).map(String)); }
function _venueSortForClub(list) {
  var fav = _venueFavoriteSet();
  return (list || []).slice().sort(function(a,b){
    var af = fav.has(String(a.id)) ? 0 : 1;
    var bf = fav.has(String(b.id)) ? 0 : 1;
    if (af !== bf) return af - bf;
    return _venueDisplayName(a).localeCompare(_venueDisplayName(b));
  });
}
function _venueDistanceMeters(aLat, aLng, bLat, bLng) {
  if (![aLat,aLng,bLat,bLng].every(function(n){ return Number.isFinite(Number(n)); })) return Infinity;
  var R = 6371000;
  var toRad = function(d){ return Number(d) * Math.PI / 180; };
  var dLat = toRad(bLat - aLat);
  var dLng = toRad(bLng - aLng);
  var lat1 = toRad(aLat);
  var lat2 = toRad(bLat);
  var h = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng/2) * Math.sin(dLng/2);
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
}

function _venueSameName(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}
function _venueDisplayName(v) { return _venueDisplayNameForLang(v); }
function _venueSearchText(v) { return [v?.name, v?.english_name, v?.japanese_name, v?.address, v?.address_ja, v?.notes].filter(Boolean).join(' '); }
function _venueMatchesQuery(v, rawQuery) {
  var q = String(rawQuery || '').trim().toLowerCase();
  if (!q || q === '*') return true;
  var text = _venueSearchText(v).toLowerCase();
  var words = q.split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  // Match ANY typed word, not only the full phrase.
  return words.some(function(w){ return text.indexOf(w) !== -1; });
}

async function vaultVenuesFindDuplicate(data) {
  if (typeof sbGet !== 'function') return null;
  var rows = await sbGet('venues', 'active=eq.true&select=id,name,english_name,japanese_name,address,address_ja,latitude,longitude,maps_url,court_count,indoor,parking,notes,active,created_at').catch(function(e){ console.warn('Venue duplicate check skipped:', e.message || e); return []; });
  var list = (rows || []).map(_venueNormalize).filter(function(v){ return v.name && v.active; });
  var byName = list.find(function(v){ return _venueSameName(v.name, data.name) || _venueSameName(v.english_name, data.english_name || data.name) || (data.japanese_name && _venueSameName(v.japanese_name, data.japanese_name)); });
  if (byName) return { venue: byName, reason: 'same name' };
  if (Number.isFinite(Number(data.latitude)) && Number.isFinite(Number(data.longitude))) {
    var near = list.map(function(v){
      return { venue: v, distance: _venueDistanceMeters(data.latitude, data.longitude, v.latitude, v.longitude) };
    }).filter(function(x){ return x.distance <= 30; }).sort(function(a,b){ return a.distance - b.distance; })[0];
    if (near) return { venue: near.venue, reason: Math.round(near.distance) + 'm away' };
  }
  return null;
}

async function vaultVenuesAddFavorite(id) {
  id = String(id || '');
  if (!id) return;
  var fav = _venueFavoriteSet();
  fav.add(id);
  await vaultVenuesSaveFavorites(Array.from(fav));
}

async function vaultVenuesLoadFavorites(forceFresh) {
  var clubId = _venueClubId();
  if (!clubId || clubId === 'none') { _vaultVenueFavorites = []; return []; }
  if (!forceFresh && _vaultVenueFavorites && _vaultVenueFavorites.length) return _vaultVenueFavorites;
  if (typeof sbGet === 'function') {
    try {
      var rows = await sbGet('clubs', 'id=eq.' + encodeURIComponent(clubId) + '&select=id,favorite_venues');
      var fav = rows && rows[0] && Array.isArray(rows[0].favorite_venues) ? rows[0].favorite_venues : [];
      _vaultVenueFavorites = fav.map(String);
      return _vaultVenueFavorites;
    } catch(e) {
      console.warn('Club favorite venues unavailable:', e.message || e);
      if (_vaultVenueFavorites && _vaultVenueFavorites.length) return _vaultVenueFavorites;
    }
  }
  _vaultVenueFavorites = [];
  return _vaultVenueFavorites;
}

async function vaultVenuesSaveFavorites(ids) {
  var clubId = _venueClubId();
  ids = (ids || []).map(String).filter(Boolean);
  if (!clubId || clubId === 'none') throw new Error('No active club selected.');
  if (typeof sbPatch !== 'function') throw new Error('Database is not available.');
  var saveToClub = async function(targetClubId) {
    return await sbPatch(
      'clubs',
      'id=eq.' + encodeURIComponent(targetClubId) + '&select=id,favorite_venues',
      { favorite_venues: ids },
      'return=representation'
    );
  };
  var rows = await saveToClub(clubId);
  if (!Array.isArray(rows)) {
    throw new Error('Worker did not return the updated club row. Deploy worker.updated.js.');
  }
  if (!rows.length) {
    var repairedClubId = await _venueRepairVaultClubIdFromName(clubId);
    if (repairedClubId) {
      clubId = repairedClubId;
      rows = await saveToClub(clubId);
    }
  }
  if (!rows.length) {
    var clubName = localStorage.getItem('kbrr_vault_club_name') || localStorage.getItem('kbrr_my_club_name') || '';
    throw new Error('Database updated zero club rows. Club id used: ' + clubId + '. Club name: ' + clubName + '. Venue ids: ' + ids.join(','));
  }
  var saved = Array.isArray(rows[0].favorite_venues) ? rows[0].favorite_venues.map(String) : [];
  var missing = ids.filter(function(id){ return saved.indexOf(String(id)) < 0; });
  if (missing.length) {
    throw new Error('Favorite save was not confirmed by database.');
  }
  _vaultVenueFavorites = saved;
  return saved;
}

async function vaultVenuesLoad(forceFresh) {
  if (!forceFresh && _vaultVenuesCache && _vaultVenuesCache.length) return _venueSortForClub(_vaultVenuesCache);
  await vaultVenuesLoadFavorites(forceFresh);

  if (typeof sbGet !== 'function') {
    _vaultVenuesCache = [];
    return [];
  }

  try {
    var rows = await sbGet('venues', 'active=eq.true&select=id,name,english_name,japanese_name,address,address_ja,latitude,longitude,maps_url,court_count,indoor,parking,notes,active,created_at&order=name.asc');
    _vaultVenuesDbAvailable = true;
    _vaultVenuesCache = (rows || []).map(_venueNormalize).filter(function(v){ return v.name && v.active; });
    return _venueSortForClub(_vaultVenuesCache);
  } catch(e) {
    console.warn('Venues table unavailable:', e.message || e);
    _vaultVenuesDbAvailable = false;
    _vaultVenuesCache = [];
    return [];
  }
}

async function vaultVenuesOpenPage() {
  await vaultVenuesRenderList(true);
  vaultVenuesSetFormVisible(false);
}

function vaultVenuesSetFormVisible(show) {
  var form = document.getElementById('vaultVenueFormCard');
  if (form) form.classList.toggle('venue-form-hidden', !show);
}

function vaultVenuesShowNewForm() {
  vaultVenuesClearForm(true);
  vaultVenuesSetFormVisible(true);
  var first = document.getElementById('venueNameInput');
  if (first) first.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function vaultVenuesOpenNew() {
  if (typeof homeGo === 'function') homeGo('vaultVenuesPage', null);
  setTimeout(function() {
    if (typeof vaultVenuesShowNewForm === 'function') vaultVenuesShowNewForm();
  }, 120);
}

function vaultVenuesClearForm(keepOpen) {
  _vaultVenuesEditingId = null;
  ['venueNameInput','venueJapaneseNameInput','venueMapInput','venueAddressInput','venueAddressJaInput','venueLatInput','venueLngInput','venueCourtsInput','venueNotesInput'].forEach(function(id){ _venueSetField(id, ''); });
  var indoor = document.getElementById('venueIndoorInput'); if (indoor) indoor.checked = true;
  var parking = document.getElementById('venueParkingInput'); if (parking) parking.checked = false;
  _venueSetFeedback('', true);
  if (!keepOpen) vaultVenuesSetFormVisible(false);
}

function _venueParseMapsUrl(raw) {
  raw = String(raw || '').trim();
  if (!raw) return null;
  var text = decodeURIComponent(raw);
  var m = text.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (!m) m = text.match(/[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (!m) m = text.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (!m) m = text.match(/ll=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  var lat = Number(m[1]);
  var lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { latitude: lat, longitude: lng };
}

function vaultVenuesImportFromMaps() {
  var url = _venueGetField('venueMapInput');
  if (!url) { _venueSetFeedback('Paste a Google Maps link first.', false); return; }
  var parsed = _venueParseMapsUrl(url);
  if (!parsed) {
    _venueSetFeedback('Could not read GPS from this link. If it is a short maps.app.goo.gl link, open it once and paste the expanded Google Maps URL.', false);
    return;
  }
  _venueSetField('venueLatInput', parsed.latitude);
  _venueSetField('venueLngInput', parsed.longitude);
  _venueSetFeedback('✓ Location imported. Check name/address and save.', true);
}

function vaultVenuesEdit(id) {
  var v = (_vaultVenuesCache || []).find(function(x){ return String(x.id) === String(id); });
  if (!v) return;
  vaultVenuesSetFormVisible(true);
  _vaultVenuesEditingId = String(v.id);
  _venueSetField('venueNameInput', v.english_name || v.name);
  _venueSetField('venueJapaneseNameInput', v.japanese_name || '');
  _venueSetField('venueMapInput', v.maps_url);
  _venueSetField('venueAddressInput', v.address);
  _venueSetField('venueAddressJaInput', v.address_ja || '');
  _venueSetField('venueLatInput', v.latitude == null ? '' : v.latitude);
  _venueSetField('venueLngInput', v.longitude == null ? '' : v.longitude);
  _venueSetField('venueCourtsInput', v.court_count || '');
  _venueSetField('venueNotesInput', v.notes || '');
  var indoor = document.getElementById('venueIndoorInput'); if (indoor) indoor.checked = !!v.indoor;
  var parking = document.getElementById('venueParkingInput'); if (parking) parking.checked = !!v.parking;
  _venueSetFeedback('Editing master venue', true);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function vaultVenuesSave() {
  var name = _venueGetField('venueNameInput');
  var japaneseName = _venueGetField('venueJapaneseNameInput');
  var mapsUrl = _venueGetField('venueMapInput');
  var address = _venueGetField('venueAddressInput');
  var addressJa = _venueGetField('venueAddressJaInput');
  var latRaw = _venueGetField('venueLatInput');
  var lngRaw = _venueGetField('venueLngInput');
  var courtsRaw = _venueGetField('venueCourtsInput');
  var notes = _venueGetField('venueNotesInput');

  if (!name) { _venueSetFeedback('Enter venue name.', false); return; }
  if (typeof sbPost !== 'function' || typeof sbPatch !== 'function') {
    _venueSetFeedback('Database is not available. Venue was not saved.', false);
    return;
  }

  var data = {
    name: name,
    english_name: name,
    japanese_name: japaneseName,
    address: address,
    address_ja: addressJa,
    maps_url: mapsUrl,
    latitude: latRaw ? Number(latRaw) : null,
    longitude: lngRaw ? Number(lngRaw) : null,
    court_count: courtsRaw ? Number(courtsRaw) : 0,
    indoor: !!document.getElementById('venueIndoorInput')?.checked,
    parking: !!document.getElementById('venueParkingInput')?.checked,
    notes: notes,
    active: true
  };

  if ((latRaw && !Number.isFinite(data.latitude)) || (lngRaw && !Number.isFinite(data.longitude))) { _venueSetFeedback('Latitude / longitude is invalid.', false); return; }
  if (courtsRaw && (!Number.isFinite(data.court_count) || data.court_count < 0)) { _venueSetFeedback('Court count is invalid.', false); return; }

  var user = (typeof authGetUser === 'function') ? authGetUser() : null;
  if (user && user.id && !_vaultVenuesEditingId) data.created_by = user.id;

  _venueSetFeedback('Checking venue...', true);

  try {
    var saved = null;

    if (_vaultVenuesEditingId && !_vaultVenuesEditingId.startsWith('local_')) {
      _venueSetFeedback('Saving venue...', true);
      var r1 = await sbPatch('venues', 'id=eq.' + encodeURIComponent(_vaultVenuesEditingId), data);
      saved = Object.assign({ id: _vaultVenuesEditingId }, data);
      await vaultVenuesAddFavorite(_vaultVenuesEditingId);
    } else {
      var dup = await vaultVenuesFindDuplicate(data);
      if (dup && dup.venue && dup.venue.id) {
        var msg = 'Similar venue found: ' + _venueDisplayName(dup.venue) + ' (' + dup.reason + ').\n\nOK = Use Existing / Cancel = Create New Anyway';
        if (confirm(msg)) {
          await vaultVenuesAddFavorite(dup.venue.id);
          _vaultVenuesCache = [];
          vaultVenuesClearForm();
          await vaultVenuesRenderList(true);
          if (typeof vaultSlotsPopulateVenueSelect === 'function') vaultSlotsPopulateVenueSelect();
          _venueSetFeedback('✅ Existing venue added to this club favorites', true);
          return;
        }
      }

      _venueSetFeedback('Saving venue...', true);
      var r2 = null;
      try {
        // Same normal path as slots: insert and receive the created row.
        r2 = await sbPost('venues', data);
        saved = Array.isArray(r2) ? r2[0] : r2;
      } catch(postErr) {
        // If Supabase allows INSERT but blocks return=representation/SELECT,
        // insert with a client-generated UUID and return=minimal.
        // This keeps the venue saved and lets us add it to club favorites.
        var clientId = (crypto && crypto.randomUUID) ? crypto.randomUUID() : ('v_' + Date.now() + '_' + Math.random().toString(36).slice(2));
        var minimalData = Object.assign({ id: clientId }, data);
        await sbPost('venues', minimalData, 'return=minimal');
        saved = Object.assign({}, minimalData);
      }
      if (saved && saved.id) {
        await vaultVenuesAddFavorite(saved.id);
      }
    }

    _vaultVenuesDbAvailable = true;
    _vaultVenuesCache = [];
    vaultVenuesClearForm();
    await vaultVenuesRenderList(true);
    if (typeof vaultSlotsPopulateVenueSelect === 'function') vaultSlotsPopulateVenueSelect();
    _venueSetFeedback('✅ Venue saved to database', true);
  } catch(e) {
    console.error('Venue save failed:', e);
    _venueSetFeedback('Server save failed: ' + (e.message || e), false);
  }
}

async function vaultVenuesDelete(id) {
  if (!confirm('Remove this venue from the master list?')) return;
  if (typeof sbPatch !== 'function') {
    _venueSetFeedback('Database is not available. Venue was not removed.', false);
    return;
  }
  try {
    await sbPatch('venues', 'id=eq.' + encodeURIComponent(id), { active: false });
    var fav = (_vaultVenueFavorites || []).filter(function(x){ return String(x) !== String(id); });
    await vaultVenuesSaveFavorites(fav);
    _vaultVenuesCache = [];
    await vaultVenuesRenderList(true);
    _venueSetFeedback('Venue removed', true);
  } catch(e) {
    console.error('Venue remove failed:', e);
    _venueSetFeedback('Remove failed: ' + (e.message || e), false);
  }
}

async function vaultVenuesToggleFavorite(id) {
  id = String(id || '');
  if (!id) return;
  var previous = (_vaultVenueFavorites || []).map(String);
  var fav = _venueFavoriteSet();
  if (fav.has(id)) fav.delete(id); else fav.add(id);
  var next = Array.from(fav);
  _vaultVenueFavorites = next;
  await vaultVenuesRenderList(false);
  try {
    await vaultVenuesSaveFavorites(next);
    _vaultVenueFavorites = next;
    await vaultVenuesRenderList(false);
    _venueSetFeedback('Favorite venues saved.', true);
    if (typeof vaultSlotsPopulateVenueSelect === 'function') vaultSlotsPopulateVenueSelect();
    var picker = document.getElementById('venuePickerOverlay');
    if (picker && picker.style.display !== 'none' && typeof vaultSlotsRenderVenuePicker === 'function') {
      vaultSlotsRenderVenuePicker(false);
    }
  } catch(e) {
    console.error('Saving favorite venues failed:', e);
    _vaultVenueFavorites = previous;
    await vaultVenuesRenderList(false);
    _venueSetFeedback('Favorite was not saved: ' + (e.message || e), false);
  }
}

async function vaultVenuesRenderList(forceFresh) {
  var box = document.getElementById('vaultVenuesList');
  if (!box) return;
  box.innerHTML = '<div class="venue-empty">Loading venues...</div>';
  var venues = await vaultVenuesLoad(forceFresh);
  var q = String(document.getElementById('venueSearchInput')?.value || '').trim().toLowerCase();
  if (q && q !== '*') venues = venues.filter(function(v){ return _venueMatchesQuery(v, q); });
  if (!venues.length) {
    box.innerHTML = '<div class="venue-empty">No venues found. Add a master venue above.</div>';
    return;
  }
  var fav = _venueFavoriteSet();
  box.innerHTML = venues.map(function(v){
    var isFav = fav.has(String(v.id));
    var mapBtn = v.maps_url ? '<button class="venue-mini-btn" onclick="window.open(\'' + _vsEscape(v.maps_url) + '\',\'_blank\')">' + _vsEscape(t('openMap') || 'Map') + '</button>' : '';
    var displayName = _venueDisplayName(v);
    var jpName = v.japanese_name && v.japanese_name !== displayName ? v.japanese_name : '';
    var sub1 = _venueAddressForLang(v) || ((v.latitude != null && v.longitude != null) ? (v.latitude + ', ' + v.longitude) : (t('savedLocation') || 'Saved location'));
    var meta = [];
    if (v.court_count) meta.push(v.court_count + ' ' + (t('courtPlural') || 'courts'));
    meta.push(v.indoor ? (t('indoor') || 'Indoor') : (t('outdoor') || 'Outdoor'));
    if (v.parking) meta.push(t('parking') || 'Parking');
    return '<div class="venue-row ' + (isFav ? 'venue-row-fav' : '') + '">' +
      '<button class="venue-fav-btn ' + (isFav ? 'active' : '') + '" onclick="vaultVenuesToggleFavorite(\'' + _vsEscape(v.id) + '\')">' + (isFav ? '★' : '☆') + '</button>' +
      '<div class="venue-pin">📍</div>' +
      '<div class="venue-info"><div class="venue-name">' + _vsEscape(displayName) + '</div>' +
      (jpName ? '<div class="venue-sub venue-jp">' + _vsEscape(jpName) + '</div>' : '') +
      '<div class="venue-sub">' + _vsEscape(sub1) + '</div><div class="venue-sub venue-meta">' + _vsEscape(meta.join(' • ')) + '</div></div>' +
      '<div class="venue-row-actions">' + mapBtn + '<button class="venue-mini-btn" onclick="vaultVenuesEdit(\'' + _vsEscape(v.id) + '\')">Edit</button><button class="venue-mini-btn venue-delete" onclick="vaultVenuesDelete(\'' + _vsEscape(v.id) + '\')">Remove</button></div>' +
      '</div>';
  }).join('');
}

async function vaultSlotsPopulateVenueSelect() {
  var sel = document.getElementById('vsFormVenue');
  if (!sel || sel.tagName !== 'SELECT') return;
  var previous = sel.value;
  var venues = await vaultVenuesLoad(false);
  var fav = _venueFavoriteSet();
  var favVenues = venues.filter(function(v){ return fav.has(String(v.id)); });
  var otherVenues = venues.filter(function(v){ return !fav.has(String(v.id)); });
  var html = '<option value="">Select saved venue</option>';
  if (favVenues.length) html += '<optgroup label="Favorite venues">' + favVenues.map(function(v){ var n = _venueDisplayName(v); return '<option value="' + _vsEscape(n) + '" data-venue-id="' + _vsEscape(v.id) + '">★ ' + _vsEscape(n) + '</option>'; }).join('') + '</optgroup>';
  if (otherVenues.length) html += '<optgroup label="All venues">' + otherVenues.map(function(v){ var n = _venueDisplayName(v); return '<option value="' + _vsEscape(n) + '" data-venue-id="' + _vsEscape(v.id) + '">' + _vsEscape(n) + '</option>'; }).join('') + '</optgroup>';
  sel.innerHTML = html;
  if (previous) sel.value = previous;
  vaultSlotsVenueChanged();
}

function _vaultSlotsSelectedVenue() {
  var sel = document.getElementById('vsFormVenue');
  if (!sel) return null;
  var opt = sel.options[sel.selectedIndex];
  var id = opt ? opt.getAttribute('data-venue-id') : '';
  if (id) return (_vaultVenuesCache || []).find(function(v){ return String(v.id) === String(id); }) || null;
  var name = sel.value;
  return (_vaultVenuesCache || []).find(function(v){ return _venueDisplayName(v) === name || v.name === name || v.english_name === name; }) || null;
}
function vaultSlotsVenueChanged() {
  var v = _vaultSlotsSelectedVenue();
  var info = document.getElementById('vsFormVenueInfo');
  var addr = document.getElementById('vsFormVenueAddress');
  var btn = document.getElementById('vsFormVenueMapBtn');
  if (!info) return;
  if (!v) { info.style.display = 'none'; return; }
  var text = _venueAddressForLang(v) || ((v.latitude != null && v.longitude != null) ? (v.latitude + ', ' + v.longitude) : (t('savedVenue') || 'Saved venue'));
  if (addr) addr.textContent = text;
  if (btn) btn.style.display = v.maps_url ? '' : 'none';
  info.style.display = 'flex';
}
function vaultSlotsOpenSelectedVenueMap() {
  var v = _vaultSlotsSelectedVenue();
  if (v && v.maps_url) window.open(v.maps_url, '_blank');
}


/* ═══════════════════════════════════════════════
   v1.6.3 — Searchable slot venue picker
   Uses common venues + club favorite_venues.
══════════════════════════════════════════════ */

var _vsVenuePickerMode = 'create';
var _vsVenuePickerExpanded = { favorites: false, others: false };
var _vsVenuePickerShortLimit = 2;

function _vsVenuePickerIds(mode) {
  mode = mode === 'manage' ? 'manage' : 'create';
  return mode === 'manage'
    ? { name: 'vsMgVenue', id: 'vsMgVenueId', info: 'vsMgVenueInfo', address: 'vsMgVenueAddress', map: 'vsMgVenueMapBtn', label: 'vsMgVenuePickerLabel' }
    : { name: 'vsFormVenue', id: 'vsFormVenueId', info: 'vsFormVenueInfo', address: 'vsFormVenueAddress', map: 'vsFormVenueMapBtn', label: 'vsVenuePickerLabel' };
}

async function vaultSlotsPopulateVenueSelect() {
  // Kept name for existing callers. Now it initializes the searchable button.
  await vaultVenuesLoad(false);
  vaultSlotsVenueChanged();
}

function _vaultSlotsSelectedVenue(mode) {
  var ids = _vsVenuePickerIds(mode);
  var idEl = document.getElementById(ids.id);
  var nameEl = document.getElementById(ids.name);
  var id = idEl ? String(idEl.value || '') : '';
  if (id) {
    return (_vaultVenuesCache || []).find(function(v){ return String(v.id) === id; }) || null;
  }
  var name = nameEl ? String(nameEl.value || '') : '';
  if (!name) return null;
  return (_vaultVenuesCache || []).find(function(v){
    var dn = _venueDisplayName(v);
    return dn === name || v.name === name || v.english_name === name || v.japanese_name === name;
  }) || null;
}

function vaultSlotsVenueChanged(mode) {
  var ids = _vsVenuePickerIds(mode);
  var v = _vaultSlotsSelectedVenue(mode);
  var info = document.getElementById(ids.info);
  var addr = document.getElementById(ids.address);
  var btn = document.getElementById(ids.map);
  var label = document.getElementById(ids.label);
  if (label) {
    label.textContent = v ? ((t('venue') || 'Venue') + ': ' + _venueDisplayName(v)) : (t('tapToSelectVenue') || 'Tap to select venue');
  }
  if (!info) return;
  if (!v) { info.style.display = 'none'; return; }
  var text = _venueAddressForLang(v) || ((v.latitude != null && v.longitude != null) ? (v.latitude + ', ' + v.longitude) : (t('savedVenue') || 'Saved venue'));
  if (addr) addr.textContent = text;
  if (btn) btn.style.display = v.maps_url ? '' : 'none';
  info.style.display = 'flex';
}

function vaultSlotsOpenSelectedVenueMap(mode) {
  var v = _vaultSlotsSelectedVenue(mode);
  if (v && v.maps_url) window.open(v.maps_url, '_blank');
}

async function vaultSlotsOpenVenuePicker(mode) {
  _vsVenuePickerMode = mode === 'manage' ? 'manage' : 'create';
  var overlay = document.getElementById('venuePickerOverlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  var search = document.getElementById('venuePickerSearch');
  if (search) search.value = '';
  _vsVenuePickerExpanded = { favorites: false, others: false };
  await vaultSlotsRenderVenuePicker(true);
  setTimeout(function(){ if (search) search.focus(); }, 60);
}

function vaultSlotsCloseVenuePicker(e) {
  var overlay = document.getElementById('venuePickerOverlay');
  if (overlay) overlay.style.display = 'none';
}

async function vaultSlotsRenderVenuePicker(forceFresh) {
  var box = document.getElementById('venuePickerList');
  if (!box) return;
  box.innerHTML = '<div class="venue-empty">Loading venues...</div>';

  var venues = await vaultVenuesLoad(!!forceFresh);
  var q = String(document.getElementById('venuePickerSearch')?.value || '').trim().toLowerCase();
  if (q && q !== '*') venues = venues.filter(function(v){ return _venueMatchesQuery(v, q); });

  var fav = _venueFavoriteSet();
  var favs = venues.filter(function(v){ return fav.has(String(v.id)); })
    .sort(function(a,b){ return _venueDisplayName(a).localeCompare(_venueDisplayName(b)); });
  var allVenues = venues.slice()
    .sort(function(a,b){ return _venueDisplayName(a).localeCompare(_venueDisplayName(b)); });

  if (!venues.length) {
    var emptyMsg = q && q !== '*'
      ? (t('noVenueMatched') || 'No venue matched your search.') + '<br><span style="font-size:0.78rem;color:var(--text-dim);">' + (t('tryAnotherVenueSearch') || 'Try another word, or type * to show all venues.') + '</span>'
      : (t('noVenuesAvailable') || 'No venues available yet.');
    box.innerHTML = '<div class="venue-empty">' + emptyMsg + '</div>';
    return;
  }

  function row(v, isFav) {
    var displayName = _venueDisplayName(v);
    var jpName = v.japanese_name && v.japanese_name !== displayName ? v.japanese_name : '';
    var addr = _venueAddressForLang(v) || ((v.latitude != null && v.longitude != null) ? (v.latitude + ', ' + v.longitude) : (t('savedLocation') || 'Saved location'));
    var meta = [];
    if (v.court_count) meta.push(v.court_count + ' ' + (t('courtPlural') || 'courts'));
    meta.push(v.indoor ? (t('indoor') || 'Indoor') : (t('outdoor') || 'Outdoor'));
    if (v.parking) meta.push(t('parking') || 'Parking');
    return '<button type="button" class="venue-picker-row ' + (isFav ? 'is-fav' : '') + '" onclick="vaultSlotsSelectVenue(\'' + _vsEscape(v.id) + '\')">' +
      '<span class="venue-picker-star">' + (isFav ? '★' : '☆') + '</span>' +
      '<span class="venue-picker-main"><span class="venue-picker-name">' + _vsEscape(displayName) + '</span>' +
      (jpName ? '<span class="venue-picker-jp">' + _vsEscape(jpName) + '</span>' : '') +
      '<span class="venue-picker-sub">' + _vsEscape(addr) + '</span>' +
      '<span class="venue-picker-meta">' + _vsEscape(meta.join(' • ')) + '</span></span>' +
      '</button>';
  }

  function section(key, title, list) {
    if (!list.length) return '';
    var expanded = !!_vsVenuePickerExpanded[key];
    var limit = _vsVenuePickerShortLimit;
    var shown = expanded ? list : list.slice(0, limit);
    var canToggle = list.length > limit;
    var toggle = canToggle
      ? '<button type="button" class="venue-picker-section-toggle" onclick="vaultSlotsToggleVenueSection(\'' + key + '\')">' +
          (expanded ? (t('showLess') || 'Show less') + ' ▴' : (t('showAll') || 'Show all') + ' (' + list.length + ') ▾') +
        '</button>'
      : '';
    return '<div class="venue-picker-section-head"><div class="venue-picker-section">' + title +
      ' <span class="venue-picker-count">(' + list.length + ')</span></div>' + toggle + '</div>' +
      shown.map(function(v){ return row(v, fav.has(String(v.id))); }).join('');
  }

  var html = '';
  html += section('favorites', '⭐ ' + (t('favoriteVenues') || 'Favorite Venues'), favs, true);
  html += section('others', q && q !== '*' ? (t('searchResults') || 'Search Results') : (t('allVenues') || 'All Venues'), allVenues);
  box.innerHTML = html;
}

function vaultSlotsToggleVenueSection(key) {
  if (key !== 'favorites' && key !== 'others') return;
  _vsVenuePickerExpanded[key] = !_vsVenuePickerExpanded[key];
  vaultSlotsRenderVenuePicker(false);
}

function vaultSlotsSelectVenue(id) {
  var v = (_vaultVenuesCache || []).find(function(x){ return String(x.id) === String(id); });
  if (!v) return;
  var ids = _vsVenuePickerIds(_vsVenuePickerMode);
  var name = _venueDisplayName(v);
  var nameEl = document.getElementById(ids.name);
  var idEl = document.getElementById(ids.id);
  if (nameEl) nameEl.value = name;
  if (idEl) idEl.value = String(v.id);
  vaultSlotsVenueChanged(_vsVenuePickerMode);
  if (_vsVenuePickerMode === 'create') vaultSlotsRefreshCreateTabs();
  if (_vsVenuePickerMode === 'manage') vaultSlotsDraftFieldChanged();
  vaultSlotsCloseVenuePicker();
}

function vaultSlotsVenuePickerGoManage() {
  vaultSlotsCloseVenuePicker();
  if (typeof homeGo === 'function') homeGo('vaultVenuesPage', null);
  setTimeout(function(){ if (typeof vaultVenuesOpenPage === 'function') vaultVenuesOpenPage(); }, 80);
}



/* ══════════════════════════════════════════════════════════════
   JOIN PROBABILITY — complete request/response/live display flow
   Data is stored in Supabase and polled while the PWA is open.
══════════════════════════════════════════════════════════════ */
var _jpChecking = false;
var _jpPopupOpen = false;
var _jpPollTimer = null;
var _jpLastCheckAt = 0;
var _jpPlayerIdsCache = { userId: '', ids: [], at: 0 };
var _JP_AUTO_REFRESH_MIN_MS = 30000;
var _JP_PLAYER_CACHE_MS = 5 * 60 * 1000;

function _jpEscape(value) {
  return String(value == null ? '' : value).replace(/[&<>\"]/g, function(ch) {
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'})[ch];
  });
}

function _jpSlotLabel(slot) {
  var date = String(slot.slot_date || '');
  var time = typeof _vsFormatTime === 'function' ? _vsFormatTime(slot.start_time) : String(slot.start_time || '').slice(0,5);
  var venue = typeof _vsSlotVenueName === 'function' ? _vsSlotVenueName(slot) : String(slot.venue || '');
  return [date, time, venue].filter(Boolean).join(' · ');
}

function _jpSeenKey(claimId, requestAt) {
  return 'scs_jp_seen_' + String(claimId) + '_' + String(requestAt || '');
}

async function _jpCurrentPlayerIds() {
  var user = (typeof authGetUser === 'function') ? authGetUser() : null;
  if (!user || !user.id || typeof sbGet !== 'function') return [];
  var userId = String(user.id);
  if (_jpPlayerIdsCache.userId === userId && Date.now() - _jpPlayerIdsCache.at < _JP_PLAYER_CACHE_MS) {
    return _jpPlayerIdsCache.ids.slice();
  }
  var rows = await sbGet('players', 'user_account_id=eq.' + encodeURIComponent(user.id) + '&select=id').catch(function(){ return []; });
  var ids = (rows || []).map(function(row){ return row && row.id; }).filter(Boolean).map(String);
  _jpPlayerIdsCache = { userId: userId, ids: ids, at: Date.now() };
  return ids.slice();
}

async function _jpMaybeCreateOneHourReminders(slots) {
  var now = Date.now();
  for (var i = 0; i < (slots || []).length; i++) {
    var slot = slots[i];
    if (!slot.join_probability_requested_at || slot.join_probability_reminder_at) continue;
    var start = typeof _vsSlotStartMs === 'function' ? _vsSlotStartMs(slot) : NaN;
    if (!Number.isFinite(start)) continue;
    var delta = start - now;
    if (delta <= 60 * 60 * 1000 && delta > 0) {
      await sbPatch('slots', 'id=eq.' + encodeURIComponent(slot.id) + '&join_probability_reminder_at=is.null', {
        join_probability_reminder_at: new Date().toISOString()
      }).catch(function(){});
      slot.join_probability_reminder_at = new Date().toISOString();
    }
  }
}

function _jpShowPopup(item) {
  if (_jpPopupOpen || !item || !item.claim || !item.slot) return;
  _jpPopupOpen = true;
  var old = document.getElementById('scsJoinProbabilityOverlay');
  if (old) old.remove();
  var overlay = document.createElement('div');
  overlay.id = 'scsJoinProbabilityOverlay';
  overlay.className = 'jp-overlay';
  var isReminder = !!item.isReminder;
  overlay.innerHTML =
    '<div class="jp-card" role="dialog" aria-modal="true">' +
      '<div class="jp-icon">📊</div>' +
      '<div class="jp-title">' + _jpEscape(t('joinProbability') || 'Join Probability') + '</div>' +
      '<div class="jp-subtitle">' + _jpEscape(isReminder ? (t('joinProbabilityReminderText') || 'Your session starts in about one hour. Please update your Join Probability.') : (t('joinProbabilityQuestion') || 'What is your Join Probability for this session?')) + '</div>' +
      '<div class="jp-slot-label">' + _jpEscape(_jpSlotLabel(item.slot)) + '</div>' +
      '<div class="jp-options">' + [100,75,50,25].map(function(value) {
        return '<button type="button" class="jp-option probability-' + value + '" data-value="' + value + '">' + value + '%</button>';
      }).join('') + '</div>' +
      '<button type="button" class="jp-later">' + _jpEscape(t('later') || 'Later') + '</button>' +
    '</div>';
  document.body.appendChild(overlay);

  overlay.querySelectorAll('.jp-option').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var value = Number(btn.getAttribute('data-value'));
      overlay.querySelectorAll('button').forEach(function(b){ b.disabled = true; });
      try {
        await sbPatch('slot_claims', 'id=eq.' + encodeURIComponent(item.claim.id), {
          join_probability: value,
          join_probability_updated_at: new Date().toISOString()
        });
        localStorage.setItem(_jpSeenKey(item.claim.id, item.eventAt), String(value));
        overlay.remove();
        _jpPopupOpen = false;
        if (typeof myCardSlotsRefresh === 'function') myCardSlotsRefresh();
        if (typeof vaultHomeSlotsRefresh === 'function') vaultHomeSlotsRefresh();
        if (typeof vaultSlotsRefresh === 'function') vaultSlotsRefresh();
        setTimeout(function(){ scsJoinProbabilityCheckNow(); }, 250);
      } catch (e) {
        overlay.querySelectorAll('button').forEach(function(b){ b.disabled = false; });
        alert((t('joinProbabilitySaveFailed') || 'Could not save Join Probability.') + '\n' + (e.message || e));
      }
    });
  });
  var later = overlay.querySelector('.jp-later');
  if (later) later.addEventListener('click', function() {
    overlay.remove();
    _jpPopupOpen = false;
    localStorage.setItem(_jpSeenKey(item.claim.id, item.eventAt), 'later');
  });
}

async function scsJoinProbabilityCheckNow(force) {
  if (typeof window.scsIsRoundManagerVisible === 'function' && window.scsIsRoundManagerVisible()) return;
  if (_jpChecking || _jpPopupOpen || document.hidden || typeof sbGet !== 'function') return;
  var now = Date.now();
  if (!force && _jpLastCheckAt && now - _jpLastCheckAt < _JP_AUTO_REFRESH_MIN_MS) return;
  _jpLastCheckAt = now;
  _jpChecking = true;
  try {
    var playerIds = await _jpCurrentPlayerIds();
    if (!playerIds.length) return;
    var today = typeof _vsTodayStr === 'function' ? _vsTodayStr() : localDateStr();
    var slots = await sbGet('slots',
      'slot_date=gte.' + today + '&status=eq.posted&join_probability_requested_at=not.is.null&select=id,slot_date,start_time,end_time,venue,join_probability_requested_at,join_probability_reminder_at&order=slot_date.asc,start_time.asc'
    ).catch(function(){ return []; });
    if (!slots.length) return;
    await _jpMaybeCreateOneHourReminders(slots);
    var slotMap = {};
    slots.forEach(function(slot){ slotMap[String(slot.id)] = slot; });
    var slotIds = slots.map(function(slot){ return slot.id; }).filter(Boolean).map(String);
    var claims = await sbGet('slot_claims',
      'slot_id=in.(' + slotIds.join(',') + ')&player_id=in.(' + playerIds.join(',') + ')&status=eq.confirmed&select=id,slot_id,player_id,status,join_probability,join_probability_updated_at'
    ).catch(function(){ return []; });
    var pending = [];
    (claims || []).forEach(function(claim) {
      var slot = slotMap[String(claim.slot_id)];
      if (!slot) return;
      var requestAt = slot.join_probability_requested_at;
      var reminderAt = slot.join_probability_reminder_at;
      var updatedAt = claim.join_probability_updated_at;
      var probability = Number(claim.join_probability);
      var needsInitial = !updatedAt || new Date(updatedAt).getTime() < new Date(requestAt).getTime();
      var needsReminder = !!reminderAt && probability !== 100 && (!updatedAt || new Date(updatedAt).getTime() < new Date(reminderAt).getTime());
      var eventAt = needsReminder ? reminderAt : requestAt;
      if (!(needsInitial || needsReminder)) return;
      if (localStorage.getItem(_jpSeenKey(claim.id, eventAt))) return;
      pending.push({ claim: claim, slot: slot, isReminder: needsReminder, eventAt: eventAt });
    });
    if (pending.length) _jpShowPopup(pending[0]);
  } catch (e) {
    console.log('[Join Probability] check failed', e);
  } finally {
    _jpChecking = false;
  }
}

(function _jpInstall() {
  function start() {
    setTimeout(function(){ scsJoinProbabilityCheckNow(false); }, 1400);
    if (_jpPollTimer) clearInterval(_jpPollTimer);
    // Notifications owns the shared 60-second background cycle. Keep a slow
    // fallback for pages/builds where that module is unavailable.
    _jpPollTimer = setInterval(function(){
      if (typeof window.scsNotificationsCheckNow !== 'function') scsJoinProbabilityCheckNow(false);
    }, 60000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
  document.addEventListener('visibilitychange', function(){ if (!document.hidden) setTimeout(function(){ scsJoinProbabilityCheckNow(false); }, 350); });
  window.scsJoinProbabilityCheckNow = scsJoinProbabilityCheckNow;
})();

// Keep expiry rules active while the installed PWA remains open. The cleanup
// itself is throttled and performs writes only when a status genuinely changes.
(function _vsInstallExpiryCleanupTimer() {
  function run() {
    if (typeof window.scsIsRoundManagerVisible === 'function' && window.scsIsRoundManagerVisible()) return;
    vaultSlotsCleanupExpired(false).catch(function(){});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else setTimeout(run, 0);
  setInterval(run, 60000);
})();

// Build 1050: keep the Add Slot / Slots header aligned with the selected
// Slot Manager club and provide the same one-tap club-change entry used by
// Round Manager. Existing slot functions remain unchanged.
function vaultSlotsUpdateClubPill() {
  var pill = document.getElementById('vaultSlotsClubPill');
  if (!pill) return;
  var name = localStorage.getItem('kbrr_vault_club_name') || localStorage.getItem('kbrr_my_club_name') || 'Club';
  var nameEl = pill.querySelector('.welcome-club-pill-name');
  if (nameEl) nameEl.textContent = name;
  pill.title = 'Change club: ' + name;
}

(function() {
  var originalOpen = window.vaultSlotsOpenPage;
  if (typeof originalOpen !== 'function') return;
  window.vaultSlotsOpenPage = async function() {
    vaultSlotsUpdateClubPill();
    return await originalOpen.apply(this, arguments);
  };
})();

/* Build 51: render actionable slot summaries inside My Hub Home without navigating to Slots. */
function myHubRenderQuickSlots() {
  var newList=document.getElementById('myHubNewSlotsList'), todayList=document.getElementById('myHubTodaySlotsList');
  var newCount=document.getElementById('myHubNewSlotsCount'), todayCount=document.getElementById('myHubTodaySlotsCount');
  if (!newList || !todayList || !newCount || !todayCount) return;
  var today=_vsTodayStr();
  var all=_vsFlattenSlotsByDate(_mcsSlotsByDate || {});
  var newSlots=all.filter(function(slot){
    var d=String(slot.slot_date || slot.__carouselDate || '');
    if (d < today || _mcsIsPlayedSlot(slot)) return false;
    return !_mcsViewerClaim(slot);
  });
  var todaySlots=all.filter(function(slot){
    var d=String(slot.slot_date || slot.__carouselDate || '');
    var claim=_mcsViewerClaim(slot);
    return d===today && !!claim;
  });
  newCount.textContent=newSlots.length;
  todayCount.textContent=todaySlots.length;
  newList.innerHTML=newSlots.length ? newSlots.map(function(s){return _mcsRenderSlotCard(s,{compact:true});}).join('') : '<div class="myhub-home-empty">No new slots to join</div>';
  todayList.innerHTML=todaySlots.length ? todaySlots.map(function(s){return _mcsRenderSlotCard(s,{compact:true});}).join('') : '<div class="myhub-home-empty">No joined slots today</div>';
  _mcsNormalizeSlotActionLabels(newList); _mcsNormalizeSlotActionLabels(todayList);
}

/* Build 1099: warm the Club Manager local slot cache shortly after app load.
   This runs quietly so the first Manage-page open can render from IndexedDB. */
document.addEventListener('DOMContentLoaded', function() {
  function warmVaultSlotCache() {
    try {
      var club = (typeof getMyClub === 'function') ? getMyClub() : null;
      if (club && club.id && typeof _vhsSyncSlotsToLocal === 'function') {
        _vhsSyncSlotsToLocal(false).catch(function(){});
      }
    } catch (e) {}
  }
  setTimeout(warmVaultSlotCache, 1200);
  setTimeout(warmVaultSlotCache, 5000);
});
