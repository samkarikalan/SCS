/* ============================================================
   SUPABASE SERVICE LAYER — Proxied via Cloudflare Worker
   All DB calls go to YOUR_WORKER_DOMAIN/db/*
   No Supabase URL or keys in this file.
   ============================================================ */

const WORKER_URL = 'https://scs-app.karikalan-indo.workers.dev'; // ← replace with your Cloudflare Worker domain

// ─────────────────────────────────────────────────────────────
//  DATE HELPERS — always use local time (not UTC)
// ─────────────────────────────────────────────────────────────
/** Returns today's date as "YYYY-MM-DD" in the device's local timezone */
function localDateStr(date = new Date()) {
  const y  = date.getFullYear();
  const m  = String(date.getMonth() + 1).padStart(2, '0');
  const d  = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
/** Returns an ISO-like timestamp "YYYY-MM-DDTHH:mm:ss" in local time */
function localISOString(date = new Date()) {
  const y   = date.getFullYear();
  const mo  = String(date.getMonth() + 1).padStart(2, '0');
  const d   = String(date.getDate()).padStart(2, '0');
  const h   = String(date.getHours()).padStart(2, '0');
  const mi  = String(date.getMinutes()).padStart(2, '0');
  const s   = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

// Cache keys
const CACHE_PLAYERS   = 'kbrr_cache_players';
const CACHE_TIMESTAMP = 'kbrr_cache_ts';
const CACHE_TTL_MS    = 5 * 60 * 1000; // 5 minutes

// ─────────────────────────────────────────────────────────────
//  WORKER HELPERS — these replace all direct Supabase calls
// ─────────────────────────────────────────────────────────────

/* ── Global DB loading spinner ── */
var _dbBusyCount = 0;

function _dbBusyShow() {
  _dbBusyCount++;
  var el = document.getElementById('scs-db-spinner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'scs-db-spinner';
    el.style.cssText = [
      'position:fixed',
      'top:0','left:0','right:0',
      'height:3px',
      'background:linear-gradient(90deg,#6c63ff,#2dce89,#6c63ff)',
      'background-size:200% 100%',
      'animation:scs-db-bar 1.2s linear infinite',
      'z-index:999999',
      'border-radius:0 0 2px 2px',
      'transition:opacity 0.2s'
    ].join(';');
    // Inject keyframes once
    if (!document.getElementById('scs-db-spinner-style')) {
      var style = document.createElement('style');
      style.id = 'scs-db-spinner-style';
      style.textContent = '@keyframes scs-db-bar{0%{background-position:200% 0}100%{background-position:-200% 0}}';
      document.head.appendChild(style);
    }
    document.body.appendChild(el);
  }
  el.style.opacity = '1';
  el.style.display = 'block';
}

function _dbBusyHide() {
  _dbBusyCount = Math.max(0, _dbBusyCount - 1);
  if (_dbBusyCount === 0) {
    var el = document.getElementById('scs-db-spinner');
    if (el) {
      el.style.opacity = '0';
      setTimeout(function() { if (_dbBusyCount === 0 && el.parentNode) el.style.display = 'none'; }, 200);
    }
  }
}

async function _sbFetch(url, body) {
  _dbBusyShow();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return res;
  } finally {
    _dbBusyHide();
  }
}

// Share identical reads that are requested at the same time. Several screens use
// the same account, membership and slot data; without this guard one UI event can
// fan out into many identical Worker/Supabase reads.
async function sbGet(table, query = '') {
  const res = await _sbFetch(WORKER_URL + '/db/get', { table, query });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `GET ${table} failed: ${res.status}`);
  }
  return res.json();
}

async function sbPost(table, data, prefer = 'return=representation') {
  const res = await _sbFetch(WORKER_URL + '/db/post', { table, data, prefer });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `POST ${table} failed`);
  }
  return res.json();
}

async function sbPatch(table, query, data, prefer) {
  const res = await _sbFetch(WORKER_URL + '/db/patch', { table, query, data, prefer });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `PATCH ${table} failed`);
  }
  return res.json();
}

async function sbDelete(table, query) {
  const res = await _sbFetch(WORKER_URL + '/db/delete', { table, query });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `DELETE ${table} failed: ${res.status}`);
  }
  return res.json();
}

async function sbUpsert(table, data, onConflict) {
  const res = await _sbFetch(WORKER_URL + '/db/upsert', { table, data, onConflict });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `UPSERT ${table} failed`);
  }
  return res.json();
}

// ─────────────────────────────────────────────────────────────
//  CLUB SESSION — which club is active
// ─────────────────────────────────────────────────────────────

function getMyClub() {
  const id   = localStorage.getItem('kbrr_my_club_id')   || null;
  const name = localStorage.getItem('kbrr_my_club_name') || null;
  return { id, name };
}

function setMyClub(id, name) {
  localStorage.setItem('kbrr_my_club_id',   id);
  localStorage.setItem('kbrr_my_club_name', name);
  if (typeof updateWelcomeWorkspaceClubNames === 'function') updateWelcomeWorkspaceClubNames();
  if (typeof homeRefreshTiles        === 'function') homeRefreshTiles();
  if (typeof homeRefreshJoinClubTile === 'function') homeRefreshJoinClubTile();
  if (typeof vaultSyncStatus         === 'function') vaultSyncStatus();
  // Refresh topbar subtitle with new club name
  if (typeof updateModePill === 'function') {
    var mode = localStorage.getItem('kbrr_app_mode') || 'organiser';
    updateModePill(mode);
  }
}

function clearMyClub() {
  localStorage.removeItem('kbrr_my_club_id');
  localStorage.removeItem('kbrr_my_club_name');
}

// ─────────────────────────────────────────────────────────────
//  PLAYERS API
// ─────────────────────────────────────────────────────────────

async function dbGetPlayers(forceFresh = false) {
  const now       = Date.now();
  const lastFetch = parseInt(localStorage.getItem(CACHE_TIMESTAMP) || '0');
  const cached    = localStorage.getItem(CACHE_PLAYERS);
  const club      = getMyClub();

  const cachedClubId  = localStorage.getItem('kbrr_cache_club_id');
  const currentClubId = club.id ? String(club.id) : 'none';
  if (cachedClubId !== currentClubId) {
    localStorage.removeItem(CACHE_PLAYERS);
    localStorage.removeItem(CACHE_TIMESTAMP);
    localStorage.setItem('kbrr_cache_club_id', currentClubId);
  }

  if (!forceFresh && cached && cachedClubId === currentClubId && (now - lastFetch) < CACHE_TTL_MS) {
    return JSON.parse(cached);
  }

  try {
    let normalized;
    if (club.id) {
      const memberships = await sbGet('memberships',
        `club_id=eq.${club.id}&order=nickname.asc&select=id,nickname,club_rating,club_points,is_playing,player_id,players(id,gender,global_rating,global_points,wins,losses,sessions)`
      );
      normalized = memberships.map(m => ({
        id:           m.player_id,
        membershipId: m.id,
        name:         m.nickname,
        gender:       m.players?.gender            || 'Male',
        rating:       parseFloat(m.players?.global_rating) || 1.0,
        clubRating:   parseFloat(m.club_rating)            || 1.0,
        activeRating: parseFloat(m.club_rating)            || 1.0,
        wins:         m.players?.wins    || 0,
        losses:       m.players?.losses  || 0,
        sessions:     m.players?.sessions || []
      }));
    } else {
      normalized = [];
    }

    localStorage.setItem(CACHE_PLAYERS,   JSON.stringify(normalized));
    localStorage.setItem(CACHE_TIMESTAMP, String(Date.now()));
    return normalized;

  } catch (e) {
    console.warn('Worker offline — using cached players:', e.message);
    return cached ? JSON.parse(cached) : [];
  }
}

function scsNormalizePlayerName(value) {
  var name = String(value == null ? '' : value).normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  var hasVisibleName = /[\p{L}\p{N}]/u.test(name);
  var allowed = /^[\p{L}\p{M}\p{N} .'’_-]+$/u.test(name);
  return { name:name, valid:!!name && name.length <= 60 && hasVisibleName && allowed };
}

function scsRequireValidPlayerName(value) {
  var result = scsNormalizePlayerName(value);
  if (!result.valid) throw new Error((typeof t === 'function' && t('invalidPlayerName')) || 'Use only letters, numbers, spaces, apostrophes, periods, hyphens or underscores.');
  return result.name;
}

async function dbAddPlayer(name, gender, _unused) {
  const club = getMyClub();
  if (!club.id) throw new Error(t('noClubSelectedJoin'));
  const cleanName = scsRequireValidPlayerName(name);

  const existing = await sbGet('memberships',
    `club_id=eq.${club.id}&nickname=ilike.${encodeURIComponent(cleanName)}&select=id`);
  if (existing.length) throw new Error(t('nicknameExists'));

  const created = await sbPost('players', {
    name:          cleanName,
    gender:        gender,
    global_rating: 1.0,
    global_points: 0
  });
  const player = created[0];

  await sbPost('memberships', {
    player_id:   player.id,
    club_id:     club.id,
    nickname:    cleanName,
    club_rating: 1.0,
    club_points: 0
  });

  localStorage.removeItem(CACHE_PLAYERS);
  localStorage.removeItem(CACHE_TIMESTAMP);
  if (typeof syncToLocal === 'function') await syncToLocal();

  return player;
}

// ─────────────────────────────────────────────────────────────
//  OFFLINE SYNC QUEUE
// ─────────────────────────────────────────────────────────────

const SYNC_QUEUE_KEY = 'kbrr_sync_queue';

function queuePush(updates) {
  try {
    const q = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || '[]');
    updates.forEach(u => q.push({ ...u, timestamp: Date.now() }));
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(q));
  } catch(e) { console.error('queuePush error', e); }
}

function queueClear() { localStorage.removeItem(SYNC_QUEUE_KEY); }

function queueGet() {
  try { return JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || '[]'); }
  catch(e) { return []; }
}

async function flushSyncQueue() {
  const pending = queueGet();
  if (!pending.length) return;
  const club = getMyClub();
  if (!club.id) return;
  const failed = [];
  for (const update of pending) {
    try {
      const rounded = Math.round(update.activeRating * 10) / 10;
      const mrows   = await sbGet('memberships',
        `club_id=eq.${club.id}&nickname=ilike.${encodeURIComponent(update.name)}&select=id,player_id,club_rating,club_points`
      );
      if (!mrows || !mrows.length) continue;
      const m = mrows[0];
      await sbPatch('memberships', `id=eq.${m.id}`, { club_rating: rounded });
      if (update.wins > 0 || update.losses > 0) {
        const prows = await sbGet('players', `id=eq.${m.player_id}&select=wins,losses`);
        if (prows && prows.length) {
          await sbPatch('players', `id=eq.${m.player_id}`, {
            wins:   (prows[0].wins   || 0) + (update.wins   || 0),
            losses: (prows[0].losses || 0) + (update.losses || 0)
          });
        }
      }
    } catch(e) { failed.push(update); }
  }
  if (failed.length) localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(failed));
  else queueClear();
}

// ─────────────────────────────────────────────────────────────
//  SYNC RATINGS
// ─────────────────────────────────────────────────────────────

async function dbSyncRatings(updatedRatings) {
  const club = getMyClub();
  if (!club.id) return;
  const ratingField = localStorage.getItem('kbrr_rating_field') || 'club_rating';
  const failed = [];

  for (const update of updatedRatings) {
    try {
      if (update.guest || update.unrated || /\(guest(?:\s+[a-z0-9]+)?\)$/i.test(String(update.name || ''))) continue;
      const rounded = Math.round(update.activeRating * 10) / 10;
      const mrows   = await sbGet('memberships',
        `club_id=eq.${club.id}&nickname=ilike.${encodeURIComponent(update.name)}&select=id,player_id,club_rating,club_points`
      );
      if (!mrows || !mrows.length) continue;
      const m = mrows[0];
      const prevRating  = parseFloat(m.club_rating) || 1.0;
      const rawDelta    = (update.uncappedDelta !== undefined) ? update.uncappedDelta : (rounded - prevRating);
      const newPoints   = Math.max(0, Math.round(((parseFloat(m.club_points) || 0) + rawDelta) * 10) / 10);
      await sbPatch('memberships', `id=eq.${m.id}`, { club_rating: rounded, club_points: newPoints });

      if (update.wins > 0 || update.losses > 0) {
        const prows = await sbGet('players', `id=eq.${m.player_id}&select=wins,losses,global_points,sessions`);
        if (prows && prows.length) {
          const newGlobalPoints = Math.max(0, Math.round(((parseFloat(prows[0].global_points) || 0) + rawDelta) * 10) / 10);
          const today = localDateStr();
          const existing    = prows[0].sessions || [];
          const otherDays   = existing.filter(s => s.date !== today);
          const todayEntry  = existing.find(s => s.date === today) || {};
          const updatedSession = {
            date:            today,
            wins:            (todayEntry.wins   || 0) + (update.wins   || 0),
            losses:          (todayEntry.losses || 0) + (update.losses || 0),
            points_earned:   Math.max(0, Math.round(((parseFloat(todayEntry.points_earned) || 0) + rawDelta) * 10) / 10),
            club_rating:     rounded,
            cost_per_player: (parseFloat(todayEntry.cost_per_player) || 0) +
              (typeof shuttleData !== 'undefined' && shuttleData ? (parseFloat(shuttleData.cost_per_player) || 0) : 0) || null
          };
          await sbPatch('players', `id=eq.${m.player_id}`, {
            wins:          (prows[0].wins   || 0) + (update.wins   || 0),
            losses:        (prows[0].losses || 0) + (update.losses || 0),
            global_points: newGlobalPoints,
            sessions:      [updatedSession, ...otherDays].slice(0, 30)
          });
        }
      }
    } catch(e) {
      console.warn('dbSyncRatings offline for', update.name, '— queued');
      failed.push(update);
    }
  }
  if (failed.length) queuePush(failed);
  localStorage.removeItem(CACHE_PLAYERS);
  localStorage.removeItem(CACHE_TIMESTAMP);
}

async function dbOverrideRating(playerId, newRating) {
  const club    = getMyClub();
  const rounded = Math.round(newRating * 10) / 10;
  if (club.id) {
    await sbPatch('memberships', `player_id=eq.${playerId}&club_id=eq.${club.id}`, { club_rating: rounded });
  }
  localStorage.removeItem(CACHE_PLAYERS);
  localStorage.removeItem(CACHE_TIMESTAMP);
  if (typeof syncToLocal === 'function') await syncToLocal();
}

async function dbEditPlayer(playerId, updates, clubAdminPassword) {
  const club = getMyClub();
  if (!club.id) throw new Error(t('noClubSelectedJoin'));
  const clubs = await sbGet('clubs', `id=eq.${club.id}&select=admin_password`);
  if (!clubs.length || clubs[0].admin_password !== clubAdminPassword)
    throw new Error(t('wrongAdminPassword'));
  const { nickname, club_rating, ...playerUpdates } = updates;
  if (nickname || club_rating) {
    const mPatch = {};
    if (nickname)              mPatch.nickname    = nickname;
    if (club_rating !== undefined) mPatch.club_rating = club_rating;
    await sbPatch('memberships', `player_id=eq.${playerId}&club_id=eq.${club.id}`, mPatch);
  }
  if (Object.keys(playerUpdates).length) {
    await sbPatch('players', `id=eq.${playerId}`, playerUpdates);
  }
  localStorage.removeItem(CACHE_PLAYERS);
  localStorage.removeItem(CACHE_TIMESTAMP);
}

async function dbDeletePlayer(playerId, clubAdminPassword) {
  const club = getMyClub();
  if (!club.id) throw new Error(t('noClubSelectedJoin'));
  const clubs = await sbGet('clubs', `id=eq.${club.id}&select=admin_password`);
  if (!clubs.length || clubs[0].admin_password !== clubAdminPassword)
    throw new Error(t('wrongAdminPassword'));
  const memberships = await sbGet('memberships',
    `player_id=eq.${playerId}&club_id=eq.${club.id}&select=user_account_id`);
  const accountIds = Array.from(new Set((memberships || []).map(function(row) {
    return String(row.user_account_id || '');
  }).filter(Boolean)));
  await sbDelete('memberships', `player_id=eq.${playerId}&club_id=eq.${club.id}`);
  for (const accountId of accountIds) {
    await sbDelete('user_club_roles',
      `club_id=eq.${club.id}&user_account_id=eq.${encodeURIComponent(accountId)}`).catch(function() {});
    await sbDelete('club_join_requests',
      `club_id=eq.${club.id}&user_account_id=eq.${encodeURIComponent(accountId)}`).catch(function() {});
  }
  localStorage.removeItem(CACHE_PLAYERS);
  localStorage.removeItem(CACHE_TIMESTAMP);
  if (typeof syncToLocal === 'function') await syncToLocal();
}

// ─────────────────────────────────────────────────────────────
//  CLUBS API
// ─────────────────────────────────────────────────────────────

async function dbGetClubs() {
  try { return await sbGet('clubs', 'select=id,name&order=name.asc'); }
  catch(e) { return []; }
}

async function dbAddClub(clubName, selectPassword, adminPassword, registrationEmail) {
  if (!clubName.trim())  throw new Error(t('enterClubName'));
  if (!adminPassword)    throw new Error(t('enterAdminPw'));
  // The legacy member-password column remains populated for schema
  // compatibility, but Organiser access is granted by club membership.
  if (!selectPassword) {
    selectPassword = 'membership-only-' + (globalThis.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : (Date.now().toString(36) + Math.random().toString(36).slice(2)));
  }

  // Limit: one club per account — uses created_by (uuid) which already exists in schema
  const SUPER_ADMIN_EMAIL = 'karikalan.iphone@gmail.com';
  var user = (typeof authGetUser === 'function') ? authGetUser() : null;
  if (user && user.id && user.email && user.email.trim().toLowerCase() !== SUPER_ADMIN_EMAIL) {
    var existing = await sbGet('clubs', 'created_by=eq.' + user.id + '&select=id');
    if (existing && existing.length >= 1) {
      throw new Error('You have already created a club. Only one club is allowed per account.');
    }
  }

  const payload = { name: clubName.trim(), select_password: selectPassword, admin_password: adminPassword };
  // Always store creator's user id in created_by
  if (user && user.id) payload.created_by = user.id;
  const created = await sbPost('clubs', payload);
  const club = created[0];

  // The creator must immediately be a member of the club they created.
  // Club selectors and the Slot Manager are membership-driven, so creating
  // only the clubs row leaves the new club invisible to its owner.
  if (club && club.id && user && user.id) {
    var creatorPlayerId = null;
    try {
      var accountRows = await sbGet('user_accounts',
        'id=eq.' + encodeURIComponent(user.id) + '&select=nickname,email,gender');
      var account = accountRows && accountRows[0] ? accountRows[0] : {};
      var creatorNickname = String(
        account.nickname || user.nickname || user.display_name ||
        account.email || user.email || 'Club Owner'
      ).trim();
      if (creatorNickname.indexOf('@') > 0) creatorNickname = creatorNickname.split('@')[0];
      var creatorGender = (account.gender === 'Female' || user.gender === 'Female') ? 'Female' : 'Male';

      // Idempotent guard in case a retry happens after a slow network response.
      var existingMembership = await sbGet('memberships',
        'club_id=eq.' + encodeURIComponent(club.id) +
        '&user_account_id=eq.' + encodeURIComponent(user.id) + '&select=id');

      if (!existingMembership || !existingMembership.length) {
        var playerRows = await sbPost('players', {
          name: creatorNickname,
          gender: creatorGender,
          global_rating: 1.0,
          global_points: 0,
          user_account_id: user.id
        });
        creatorPlayerId = playerRows && playerRows[0] ? playerRows[0].id : null;
        if (!creatorPlayerId) throw new Error('Could not create the owner player record.');

        await sbPost('memberships', {
          player_id: creatorPlayerId,
          club_id: club.id,
          nickname: creatorNickname,
          club_rating: 1.0,
          club_points: 0,
          user_account_id: user.id
        });
      }
    } catch (membershipError) {
      // Do not leave a half-created club that the owner cannot access.
      if (creatorPlayerId) await sbDelete('players', 'id=eq.' + encodeURIComponent(creatorPlayerId)).catch(function(){});
      await sbDelete('clubs', 'id=eq.' + encodeURIComponent(club.id)).catch(function(){});
      throw new Error('Club could not be linked to your player account: ' + (membershipError.message || membershipError));
    }
  }

  localStorage.removeItem(CACHE_PLAYERS);
  localStorage.removeItem(CACHE_TIMESTAMP);
  return club;
}

// ─────────────────────────────────────────────────────────────
//  AUTH — OTP via Worker (keys never leave server)
// ─────────────────────────────────────────────────────────────

async function dbSendOtp(email) {
  const res = await fetch(WORKER_URL + '/auth/supabase-otp', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email: email.trim().toLowerCase() })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to send OTP');
  }
  return true;
}

async function dbVerifyOtp(email, token) {
  const res = await fetch(WORKER_URL + '/auth/supabase-verify', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email: email.trim().toLowerCase(), token: token.trim() })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Invalid or expired OTP');
  }
  if (typeof onUserLogin === 'function') await onUserLogin(email.trim().toLowerCase());
  return true;
}

async function dbGetClubRegEmail(clubId) {
  const rows = await sbGet('clubs', `id=eq.${clubId}&select=registration_email`);
  if (!rows || !rows.length) throw new Error(t('clubNotFound'));
  return rows[0].registration_email || null;
}

function maskEmail(email) {
  if (!email) return '';
  const [user, domain] = email.split('@');
  const masked = user[0] + '***' + (user.length > 1 ? user.slice(-1) : '');
  return masked + '@' + domain;
}

async function dbVerifyClubAccess(clubId, selectPassword) {
  const clubs = await sbGet('clubs', `id=eq.${clubId}&select=id,name,select_password`);
  if (!clubs.length) throw new Error('Club not found.');
  if (clubs[0].select_password !== selectPassword) throw new Error(t('wrongPasswordHint'));
  return clubs[0];
}

// ─────────────────────────────────────────────────────────────
//  SYNC AFTER ROUND
// ─────────────────────────────────────────────────────────────

async function syncAfterRound(roundWins, roundLosses, roundRatingDeltas) {
  try {
    const playedNames    = new Set([...roundWins.keys(), ...roundLosses.keys()]);
    const updatedRatings = schedulerState.allPlayers
      .filter(p => playedNames.has(p.name))
      .filter(p => !(p.guest || p.unrated || /\(guest(?:\s+[a-z0-9]+)?\)$/i.test(String(p.name || ''))))
      .map(p => ({
        name:          p.name,
        activeRating:  getActiveRating(p.name),
        uncappedDelta: (roundRatingDeltas && roundRatingDeltas.get(p.name)) || 0,
        wins:          (roundWins   && roundWins.get(p.name))   || 0,
        losses:        (roundLosses && roundLosses.get(p.name)) || 0
      }));
    await dbSyncRatings(updatedRatings);
    await dbRecordRoundMatches(updatedRatings);
    await syncLiveSession(playedNames);
    await syncToLocal();
  } catch(e) { console.error('syncAfterRound error:', e.message); }
}

async function syncSessionAfterRound(playedNames) {}

// Round iMode keeps play local and performs one server sync when End is used.
// At End, create the same linked Slot used by normal Round Mode so the
// completed iMode session appears in the existing player-payment flow.
// The persisted iModeSyncTotals object survives app closure through snapshot.js.
async function syncRoundIModeSession(shuttleData = null) {
  try {
    if (!navigator.onLine || !(await dbIsOnline())) return false;
    let sessionId = getMySessionId();
    if (!sessionId) {
      let paymentSlot = null;
      if (typeof vaultSlotsCreatePostedFromRoundManager === 'function') {
        try {
          paymentSlot = await vaultSlotsCreatePostedFromRoundManager();
        } catch (slotError) {
          console.warn('Round iMode payment slot post failed:', slotError && slotError.message ? slotError.message : slotError);
        }
      }
      sessionId = await dbStartSession(paymentSlot && paymentSlot.id ? paymentSlot.id : null);
    }
    if (!sessionId) return false;

    const totals = (typeof schedulerState !== 'undefined' && schedulerState.iModeSyncTotals) || {};
    const players = (typeof schedulerState !== 'undefined' && schedulerState.allPlayers) || [];
    const updates = players
      .filter(player => player && !player.guest && !player.unrated)
      .map(player => {
        const total = totals[player.name] || { wins:0, losses:0, delta:0 };
        return {
          name: player.name,
          activeRating: typeof getActiveRating === 'function' ? getActiveRating(player.name) : (Number(player.rating) || 1),
          uncappedDelta: Number(total.delta) || 0,
          wins: Number(total.wins) || 0,
          losses: Number(total.losses) || 0
        };
      });

    await dbSyncRatings(updates);
    await dbSyncRoundsData();
    await dbCompleteSession(shuttleData);

    // iMode creates its payment Slot only at End, unlike normal Round Mode
    // which creates the Slot when play starts. Any My Hub / Slot Manager slot
    // cache opened before End therefore does not yet contain this new played
    // Slot. Force both existing slot views to reload immediately after the
    // completed session is linked so the payment appears without an app reload.
    if (typeof myCardSlotsScheduleRefresh === 'function') {
      myCardSlotsScheduleRefresh(true);
    } else if (typeof myCardSlotsRefreshAll === 'function') {
      setTimeout(function(){ myCardSlotsRefreshAll(true); }, 0);
    }
    if (typeof renderVaultHomeSlotsUI === 'function') {
      setTimeout(function(){ renderVaultHomeSlotsUI(true); }, 0);
    }

    if (typeof syncToLocal === 'function') await syncToLocal();
    return !getMySessionId();
  } catch (error) {
    console.warn('Round iMode final sync failed:', error && error.message ? error.message : error);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
//  LIVE SESSIONS
// ─────────────────────────────────────────────────────────────

async function syncLiveSession(playedNames) {
  try {
    const club = getMyClub();
    if (!club.id) return;
    const today     = localDateStr();
    const players   = schedulerState.allPlayers || [];
    const genderMap = new Map();
    players.forEach(p => genderMap.set(p.name, p.gender || 'Male'));
    const playerMatches = new Map();
    for (const round of (allRounds || [])) {
      const games = round.games || round;
      for (const game of (games || [])) {
        if (!game.winner) continue;
        const leftWon = game.winner === 'L';
        const pair1   = game.pair1 || [], pair2 = game.pair2 || [];
        for (const p of pair1) {
          if (!playerMatches.has(p)) playerMatches.set(p, []);
          playerMatches.get(p).push({
            partner:         pair1.filter(x => x !== p),
            partnerGenders:  pair1.filter(x => x !== p).map(n => genderMap.get(n) || 'Male'),
            opponents:       pair2,
            opponentGenders: pair2.map(n => genderMap.get(n) || 'Male'),
            result:          leftWon ? 'W' : 'L'
          });
        }
        for (const p of pair2) {
          if (!playerMatches.has(p)) playerMatches.set(p, []);
          playerMatches.get(p).push({
            partner:         pair2.filter(x => x !== p),
            partnerGenders:  pair2.filter(x => x !== p).map(n => genderMap.get(n) || 'Male'),
            opponents:       pair1,
            opponentGenders: pair1.map(n => genderMap.get(n) || 'Male'),
            result:          leftWon ? 'L' : 'W'
          });
        }
      }
    }
    const myPlayer  = (typeof getMyPlayer === 'function') ? getMyPlayer() : null;
    const startedBy = myPlayer ? myPlayer.name : null;
    const upserts   = players
      .filter(p => playedNames.has(p.name) && (playerMatches.get(p.name) || []).length)
      .map(() => Promise.resolve());
    await Promise.all(upserts);
  } catch(e) { console.warn('syncLiveSession error:', e.message); }
}

// ─────────────────────────────────────────────────────────────
//  SESSIONS TABLE
// ─────────────────────────────────────────────────────────────

function getMySessionId() { return sessionStorage.getItem('kbrr_session_db_id') || null; }
function setMySessionId(id) {
  if (id) sessionStorage.setItem('kbrr_session_db_id', id);
  else    sessionStorage.removeItem('kbrr_session_db_id');
  if (typeof persistSessionId === 'function') persistSessionId(id);
}

async function dbStartSession(sourceSlotId = null) {
  try {
    const club      = getMyClub();
    if (!club.id) return;
    const myPlayer  = (typeof getMyPlayer === 'function') ? getMyPlayer() : null;
    const startedBy = myPlayer ? myPlayer.name : null;
    const today     = localDateStr();
    const payload = {
      club_id:     club.id, date: today, started_by: startedBy,
      status:      'live',  rounds_data: [], players: [],
      updated_at:  new Date().toISOString()
    };
    if (sourceSlotId) payload.source_slot_id = sourceSlotId;

    let created = null;
    try {
      created = await sbPost('sessions', payload);
    } catch (e) {
      if (!sourceSlotId) throw e;
      delete payload.source_slot_id;
      created = await sbPost('sessions', payload);
    }

    const sessionId = created && created[0] ? created[0].id : null;
    setMySessionId(sessionId);
    if (sourceSlotId && sessionId && typeof dbMarkSlotSession === 'function') {
      await dbMarkSlotSession(sourceSlotId, sessionId);
    }
    return sessionId;
  } catch(e) { console.warn('dbStartSession error:', e.message); }
}

async function dbMarkSlotSession(slotId, sessionId) {
  if (!slotId || !sessionId) return false;
  try {
    await sbPatch('slots', `id=eq.${slotId}`, {
      status: 'played',
      played_session_id: sessionId
    });
    return true;
  } catch (e) {
    try {
      await sbPatch('slots', `id=eq.${slotId}`, { status: 'played' });
      return true;
    } catch (e2) {
      console.warn('dbMarkSlotSession error:', e2.message);
      return false;
    }
  }
}

async function dbSyncRoundsData() {
  try {
    const sessionDbId = getMySessionId();
    if (!sessionDbId) return;
    const roundsData = (allRounds || []).map(r => ({
      round: r.round, resting: r.resting || [],
      games: (r.games || []).map(g => ({
        pair1: g.pair1, pair2: g.pair2, winner: g.winner || null, court: g.court || null
      }))
    }));
    // Also persist full scheduler state so any organiser can resume
    const schedulerBlob = (typeof buildSchedulerBlob === 'function') ? buildSchedulerBlob() : null;
    const patch = { rounds_data: roundsData, updated_at: new Date().toISOString() };
    if (schedulerBlob) patch.scheduler_state = schedulerBlob;

    // Keep players list current so report works on live and completed sessions
    if (typeof schedulerState !== 'undefined' && schedulerState.allPlayers && schedulerState.allPlayers.length) {
      const _baseName = n => (n || '').replace(/#\d+$/, '').trim();
      patch.players = schedulerState.allPlayers.map(p => ({
        name:   _baseName(p.name),  // strip #1/#2 suffix to match membership nickname
        wins:   schedulerState.winCount ? (schedulerState.winCount.get(p.name) || 0) : 0,
        losses: schedulerState.PlayedCount
          ? Math.max(0, (schedulerState.PlayedCount.get(p.name) || 0) - (schedulerState.winCount ? (schedulerState.winCount.get(p.name) || 0) : 0))
          : 0
      }));
    }

    await sbPatch('sessions', `id=eq.${sessionDbId}`, patch);
  } catch(e) { console.warn('dbSyncRoundsData error:', e.message); }
}

async function dbCompleteSession(shuttleData = null) {
  try {
    const sessionDbId = getMySessionId();
    const club        = getMyClub();
    if (!sessionDbId || !club.id) return;
    const _base = n => (n||'').replace(/#\d+$/, '').trim();
    const players = (schedulerState.allPlayers || []).map(p => ({
      name:   _base(p.name),
      wins:   schedulerState.winCount ? (schedulerState.winCount.get(p.name) || 0) : 0,
      losses: schedulerState.PlayedCount
        ? Math.max(0, (schedulerState.PlayedCount.get(p.name) || 0) - (schedulerState.winCount ? (schedulerState.winCount.get(p.name) || 0) : 0))
        : 0
    }));
    // Keep session forever for monthly/yearly reporting.
    // Purge scheduler_state (large resume blob) immediately — no longer needed.
    // rounds_data kept for win/loss reporting.
    const patch = { status: 'completed', players, updated_at: new Date().toISOString() };
    if (shuttleData) patch.shuttle_data = shuttleData;
    await sbPatch('sessions', `id=eq.${sessionDbId}`, patch);
    const today = localDateStr();
    for (const p of players) {
      if (!p.name) continue;
      try {
        const mrows = await sbGet('memberships',
          `club_id=eq.${club.id}&nickname=ilike.${encodeURIComponent(p.name)}&select=player_id,club_rating,club_points`
        ).catch(() => []);
        if (!mrows.length) continue;
        const playerId = mrows[0].player_id;
        const prows    = await sbGet('players', `id=eq.${playerId}&select=sessions`).catch(() => []);
        const existing = (prows.length ? prows[0].sessions : null) || [];
        const entry = {
          date:            today, session_id: sessionDbId,
          wins:            p.wins || 0, losses: p.losses || 0,
          points_earned:   parseFloat(mrows[0].club_points) || 0,
          club_rating:     parseFloat(mrows[0].club_rating) || 1.0,
          cost_per_player: shuttleData ? (parseFloat(shuttleData.cost_per_player) || 0) : null
        };
        await sbPatch('players', `id=eq.${playerId}`, { sessions: [entry, ...existing].slice(0, 60) }).catch(() => {});
      } catch(e) {}
    }
    setMySessionId(null);
  } catch(e) { console.warn('dbCompleteSession error:', e.message); }
}

async function dbCleanupStaleSessions() {
  try {
    const club = getMyClub();
    if (!club.id) return;
    const rows = await sbGet('sessions', `club_id=eq.${club.id}&status=eq.live&select=id,created_at,updated_at`);
    if (!rows || !rows.length) return;
    const threeHoursAgo = Date.now() - (3 * 60 * 60 * 1000); // 3 hours — genuinely abandoned
    for (const sess of rows) {
      const age = new Date(sess.updated_at || sess.created_at).getTime();
      if (age < threeHoursAgo) {
        await sbPatch('sessions', `id=eq.${sess.id}`, { status: 'completed', updated_at: new Date().toISOString() }).catch(() => {});
        await sbPatch('memberships', `club_id=eq.${club.id}&is_playing=eq.true`, { is_playing: false }).catch(() => {});
      }
    }
  } catch(e) {}
}

async function dbForceCompleteSession(sessionId) {
  try {
    // Purge scheduler_state on completion — keep rounds_data for reporting
    await sbPatch('sessions', `id=eq.${sessionId}`, { status: 'completed', updated_at: new Date().toISOString() });
    const club = getMyClub();
    if (club.id) {
      await sbPatch('memberships', `club_id=eq.${club.id}&is_playing=eq.true`, { is_playing: false }).catch(() => {});
      // sessions kept for monthly reporting — no auto-deletion
    }
  } catch(e) { console.warn('dbForceCompleteSession error:', e.message); }
}

async function dbGetMyJoinedClubIds() {
  try {
    const user = (typeof authGetUser === 'function') ? authGetUser() : null;
    if (user && user.id) {
      const rows = await sbGet('memberships', `user_account_id=eq.${user.id}&select=club_id`);
      return [...new Set((rows || []).map(r => r.club_id).filter(Boolean))];
    }
    return [];
  } catch(e) { return []; }
}

async function dbGetPlayerClubs(playerNameOrId) {
  try {
    const accountClubIds = await dbGetMyJoinedClubIds();
    if (accountClubIds.length) return accountClubIds;

    if (!playerNameOrId) return [];
    const myPlayer = (typeof getMyPlayer === 'function') ? getMyPlayer() : null;
    if (myPlayer && myPlayer.id) {
      const rows = await sbGet('memberships', `player_id=eq.${myPlayer.id}&select=club_id`);
      if (rows && rows.length) return [...new Set(rows.map(r => r.club_id).filter(Boolean))];
    }
    const rows = await sbGet('memberships', `nickname=ilike.${encodeURIComponent(playerNameOrId)}&select=club_id`);
    return [...new Set((rows || []).map(r => r.club_id).filter(Boolean))];
  } catch(e) { return []; }
}

async function dbGetLiveSessions() {
  try {
    const isViewer = (typeof appMode !== 'undefined') && appMode === 'viewer';
    if (isViewer) {
      const myPlayer = (typeof getMyPlayer === 'function') ? getMyPlayer() : null;
      if (!myPlayer) return [];
      const clubIds = await dbGetPlayerClubs(myPlayer.name);
      if (!clubIds.length) return [];
      return await sbGet('sessions', `club_id=in.(${clubIds.join(',')})&status=eq.live&order=created_at.asc&select=id,rounds_data,started_by,updated_at,club_id,handover_pin`) || [];
    } else {
      const club = getMyClub();
      if (!club.id) return [];
      return await sbGet('sessions', `club_id=eq.${club.id}&status=eq.live&order=created_at.asc&select=id,rounds_data,started_by,updated_at,handover_pin`) || [];
    }
  } catch(e) { console.warn('dbGetLiveSessions error:', e.message); return []; }
}

async function dbGetPastSessions() {
  try {
    const isViewer = (typeof appMode !== 'undefined') && appMode === 'viewer';
    if (isViewer) {
      const myPlayer = (typeof getMyPlayer === 'function') ? getMyPlayer() : null;
      if (!myPlayer) return [];
      const clubIds = await dbGetPlayerClubs(myPlayer.name);
      if (!clubIds.length) return [];
      return await sbGet('sessions', `club_id=in.(${clubIds.join(',')})&status=eq.completed&order=updated_at.desc&limit=5&select=id,date,started_by,players,rounds_data,updated_at,club_id,shuttle_data`) || [];
    } else {
      const club = getMyClub();
      if (!club.id) return [];
      return await sbGet('sessions', `club_id=eq.${club.id}&status=eq.completed&order=updated_at.desc&limit=10&select=id,date,started_by,players,rounds_data,updated_at,shuttle_data`) || [];
    }
  } catch(e) { return []; }
}

// ── Date-range query for calendar coverage — NOT capped by row count ──
// year: 4-digit year, month: 0-indexed (matches JS Date.getMonth())
// Returns every completed session whose date falls within the given month,
// so the dashboard calendar can mark a dot on EVERY day that has a session,
// not just the most recent N.
async function dbGetSessionsForMonth(year, month) {
  try {
    const isViewer = (typeof appMode !== 'undefined') && appMode === 'viewer';
    const pad = n => String(n).padStart(2, '0');
    const startDate = `${year}-${pad(month + 1)}-01`;
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear  = month === 11 ? year + 1 : year;
    const endDate   = `${nextYear}-${pad(nextMonth + 1)}-01`; // exclusive upper bound

    if (isViewer) {
      const myPlayer = (typeof getMyPlayer === 'function') ? getMyPlayer() : null;
      if (!myPlayer) return [];
      const clubIds = await dbGetPlayerClubs(myPlayer.name);
      if (!clubIds.length) return [];
      const q = `club_id=in.(${clubIds.join(',')})&status=eq.completed&date=gte.${startDate}&date=lt.${endDate}` +
        `&order=date.asc&select=id,date,started_by,players,rounds_data,updated_at,club_id,shuttle_data,source_slot_id`;
      return await sbGet('sessions', q).catch(() => sbGet('sessions',
        `club_id=in.(${clubIds.join(',')})&status=eq.completed&date=gte.${startDate}&date=lt.${endDate}` +
        `&order=date.asc&select=id,date,started_by,players,rounds_data,updated_at,club_id,shuttle_data`)) || [];
    } else {
      const club = getMyClub();
      if (!club.id) return [];
      const q = `club_id=eq.${club.id}&status=eq.completed&date=gte.${startDate}&date=lt.${endDate}` +
        `&order=date.asc&select=id,date,started_by,players,rounds_data,updated_at,shuttle_data,source_slot_id`;
      return await sbGet('sessions', q).catch(() => sbGet('sessions',
        `club_id=eq.${club.id}&status=eq.completed&date=gte.${startDate}&date=lt.${endDate}` +
        `&order=date.asc&select=id,date,started_by,players,rounds_data,updated_at,shuttle_data`)) || [];
    }
  } catch(e) { console.warn('dbGetSessionsForMonth error:', e.message); return []; }
}

async function saveRoundsToDb() { await dbSyncRoundsData(); }

async function flushLiveSession() {
  try {
    const club = getMyClub();
    if (!club.id) return;
  } catch(e) { console.warn('flushLiveSession error:', e.message); }
}

async function cleanupLiveSessions() {
  try {
    // Build 603: automatically finish abandoned LIVE sessions after 3 hours
    // without activity. updated_at is refreshed whenever round/session data is
    // synced, so an actively used long session is not closed.
    let clubIds = [];
    if (typeof dbGetMyJoinedClubIds === 'function') {
      clubIds = await dbGetMyJoinedClubIds().catch(() => []);
    }
    const club = (typeof getMyClub === 'function') ? getMyClub() : { id: null };
    if (club && club.id && !clubIds.includes(club.id)) clubIds.push(club.id);
    clubIds = [...new Set(clubIds.filter(Boolean))];
    if (!clubIds.length) return;

    const filter = clubIds.length === 1
      ? `club_id=eq.${clubIds[0]}&status=eq.live&select=id,club_id,created_at,updated_at`
      : `club_id=in.(${clubIds.join(',')})&status=eq.live&select=id,club_id,created_at,updated_at`;
    const rows = await sbGet('sessions', filter).catch(() => []);
    if (!rows || !rows.length) return;

    const staleBefore = Date.now() - (3 * 60 * 60 * 1000);
    const stale = rows.filter(sess => {
      const lastActivity = Date.parse(sess.updated_at || sess.created_at || '');
      return Number.isFinite(lastActivity) && lastActivity < staleBefore;
    });
    if (!stale.length) return;

    const now = new Date().toISOString();
    for (const sess of stale) {
      await sbPatch('sessions', `id=eq.${sess.id}&status=eq.live`, {
        status: 'completed',
        updated_at: now
      }).catch(() => {});
      if (sess.club_id) {
        await sbPatch('memberships', `club_id=eq.${sess.club_id}&is_playing=eq.true`, { is_playing: false }).catch(() => {});
      }
    }
  } catch(e) { console.warn('cleanupLiveSessions error:', e.message); }
}

// ─────────────────────────────────────────────────────────────
//  GLOBAL PLAYERS CACHE
// ─────────────────────────────────────────────────────────────

const CACHE_GLOBAL_PLAYERS = 'kbrr_cache_global_players';

async function syncGlobalPlayersCache() {
  try {
    const club = getMyClub();
    if (!club.id) return;
    const raw = await sbGet('memberships',
      `club_id=eq.${club.id}&order=nickname.asc&select=nickname,club_rating,players(gender,global_rating)`);
    const players = raw.map(m => ({
      displayName: m.nickname,
      gender:      m.players?.gender            || 'Male',
      rating:      parseFloat(m.players?.global_rating) || 1.0,
      clubRating:  parseFloat(m.club_rating)            || 1.0
    }));
    localStorage.setItem(CACHE_GLOBAL_PLAYERS, JSON.stringify(players));
  } catch(e) {}
}

function getGlobalPlayersCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_GLOBAL_PLAYERS) || '[]'); }
  catch(e) { return []; }
}

// ─────────────────────────────────────────────────────────────
//  CONNECTIVITY CHECK
// ─────────────────────────────────────────────────────────────

async function dbIsOnline() {
  try {
    const res = await fetch(WORKER_URL + '/health');
    return res.ok;
  } catch { return false; }
}

async function dbDeleteClub(clubId) {
  await sbDelete('clubs', `id=eq.${clubId}`);
}

// ─────────────────────────────────────────────────────────────
//  SESSION SLOT TRACKING
// ─────────────────────────────────────────────────────────────

const SESSION_ID         = `session_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
const SESSION_TIMEOUT_MS = 6 * 60 * 60 * 1000;

async function dbClaimSessionSlots(playerNames) {
  const club = getMyClub();
  if (!club.id) return;
  for (const name of playerNames) {
    try {
      await sbPatch('memberships', `club_id=eq.${club.id}&nickname=ilike.${encodeURIComponent(name)}`, { is_playing: true });
    } catch(e) {}
  }
  localStorage.removeItem(CACHE_PLAYERS);
  localStorage.removeItem(CACHE_TIMESTAMP);
}

async function dbReleaseSessionSlots(playerNames) {
  for (const name of playerNames) {
    try {
      const club = getMyClub();
      await sbPatch('memberships', `club_id=eq.${club.id}&nickname=ilike.${encodeURIComponent(name)}`, { is_playing: false });
    } catch(e) {}
  }
  localStorage.removeItem(CACHE_PLAYERS);
  localStorage.removeItem(CACHE_TIMESTAMP);
}

async function dbReleaseMySession() {
  try {
    const club = getMyClub();
    if (club.id) await sbPatch('memberships', `club_id=eq.${club.id}&is_playing=eq.true`, { is_playing: false });
  } catch(e) {}
}

async function dbGetUnavailablePlayers() {
  try {
    const club = getMyClub();
    if (!club.id) return new Set();
    const rows = await sbGet('memberships', `club_id=eq.${club.id}&is_playing=eq.true&select=nickname`);
    return new Set((rows || []).map(r => r.nickname.trim().toLowerCase()));
  } catch(e) { return new Set(); }
}

// ─────────────────────────────────────────────────────────────
//  PLAYER SESSIONS
// ─────────────────────────────────────────────────────────────

async function savePlayerSession(playerName, entry) {
  const existing = await sbGet('player_sessions',
    `player_name=ilike.${encodeURIComponent(playerName)}&date=eq.${entry.date}&select=id`);
  if (existing && existing.length) {
    await sbPatch('player_sessions',
      `player_name=ilike.${encodeURIComponent(playerName)}&date=eq.${entry.date}`,
      { wins: entry.wins, losses: entry.losses, rating: entry.rating });
  } else {
    await sbPost('player_sessions', {
      player_name: playerName, date: entry.date,
      wins: entry.wins, losses: entry.losses, rating: entry.rating
    });
  }
}

async function getPlayerSessions(playerName) {
  try {
    return await sbGet('player_sessions',
      `player_name=ilike.${encodeURIComponent(playerName)}&order=date.desc&limit=10`) || [];
  } catch(e) { return []; }
}

// ─────────────────────────────────────────────────────────────
//  SESSION HEARTBEAT
// ─────────────────────────────────────────────────────────────

var _heartbeatTimer = null;

function startSessionHeartbeat() {
  stopSessionHeartbeat();
  _heartbeatTimer = setInterval(async () => {
    const sessionId = (typeof getMySessionId === 'function') ? getMySessionId() : null;
    if (!sessionId) { stopSessionHeartbeat(); return; }
    try { await sbPatch('sessions', `id=eq.${sessionId}`, { updated_at: new Date().toISOString() }); }
    catch(e) {}
  }, 60 * 1000); // 60s heartbeat
}

function stopSessionHeartbeat() {
  if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
}

// ─────────────────────────────────────────────────────────────
//  ROUND MATCH RECORDING
// ─────────────────────────────────────────────────────────────

async function dbRecordRoundMatches(updatedRatings) {
  try {
    const club = getMyClub();
    if (!club.id) return;
    const sessionId = (typeof getMySessionId === 'function') ? getMySessionId() : null;
    const rounds    = (typeof allRounds !== 'undefined') ? allRounds : [];
    if (!rounds.length) return;
    let completedRound = null;
    for (let i = rounds.length - 1; i >= 0; i--) {
      const games = rounds[i].games || [];
      if (games.some(g => g.winner)) { completedRound = rounds[i]; break; }
    }
    if (!completedRound) return;
    const games       = completedRound.games || [];
    const roundNumber = completedRound.round || 0;
    const allNicknames = [...new Set(games.flatMap(g => [...(g.pair1||[]), ...(g.pair2||[])]).filter(Boolean))];
    if (!allNicknames.length) return;
    const members = await sbGet('memberships', `club_id=eq.${club.id}&select=player_id,nickname,club_rating,club_points`).catch(() => []);
    const mMap = {};
    (members || []).forEach(m => { mMap[m.nickname.trim().toLowerCase()] = m; });
    const pid = n => mMap[(n||'').trim().toLowerCase()]?.player_id || null;
    for (const game of games) {
      if (!game.winner) continue;
      const p1 = game.pair1 || [], p2 = game.pair2 || [];
      const newR  = updatedRatings.filter(u => [...p1,...p2].includes(u.name));
      const delta = newR.length ? Math.abs(Math.round(newR[0].activeRating * 10) / 10 - (parseFloat(mMap[(newR[0].name||'').trim().toLowerCase()]?.club_rating) || 1.0)) : 0;
      await sbPost('matches', {
        session_id: sessionId, club_id: club.id, round_number: roundNumber,
        pair1_player1: pid(p1[0]), pair1_player2: pid(p1[1]),
        pair2_player1: pid(p2[0]), pair2_player2: pid(p2[1]),
        winner_pair:   game.winner === 'L' ? 'pair1' : 'pair2',
        rating_delta:  delta, points_delta: delta
      }).catch(() => {});
    }
    const pids = [...new Set(Object.values(mMap).map(m => m.player_id).filter(Boolean))];
    for (const p of pids) {
      const allM = await sbGet('memberships', `player_id=eq.${p}&select=club_rating`).catch(() => []);
      if (allM.length) {
        const avg = allM.reduce((s, m) => s + (parseFloat(m.club_rating) || 1.0), 0) / allM.length;
        await sbPatch('players', `id=eq.${p}`, { global_rating: Math.round(avg * 10) / 10 }).catch(() => {});
      }
    }
  } catch(e) { console.warn('dbRecordRoundMatches error:', e.message); }
}
