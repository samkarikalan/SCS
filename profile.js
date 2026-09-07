/* ============================================================
PROFILE DRAWER -- Player identity, stats, recent sessions
File: profile.js
============================================================ */

const PROFILE_KEY = 'kbrr_my_player';
let _profileSwitching = false; // true while user is mid-switch
let _previousPlayer   = null;  // saved before switch so cancel can restore

function getMyPlayer() {
try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || null; }
catch { return null; }
}

function setMyPlayer(playerObj) {
localStorage.setItem(PROFILE_KEY, JSON.stringify(playerObj));
}

function clearMyPlayer() {
localStorage.removeItem(PROFILE_KEY);
}

/* ── Tier label from rating ── */
function ratingTierLabel(r) {
if (r < 2.0) return { label: t('rookie'),           color: '#9e9e9e' };
if (r < 3.0) return { label: t('clubLevel'),         color: '#4a9eff' };
if (r < 4.0) return { label: t('competitiveLevel'),  color: '#2dce89' };
if (r < 4.5) return { label: t('advancedLevel'),     color: '#f5a623' };
return             { label: t('eliteLevel'),          color: '#e63757' };
}

/* ── Update header profile button appearance ── */
async function updateProfileBtn() {
const player = getMyPlayer();
// Refresh topbar subtitle with current player name (viewer mode)
if (typeof updateModePill === 'function') {
  var mode = localStorage.getItem('kbrr_app_mode') || 'organiser';
  updateModePill(mode);
}
const src = player ? (player.gender === 'Female' ? 'female.png' : 'male.png') : null;

// Update profile buttons (main top bar + home overlay)
[
{ avatar: 'profileBtnAvatar',  icon: 'profileBtnIcon'  },
{ avatar: 'homeProfileAvatar', icon: 'homeProfileIcon' },
].forEach(function(ids) {
const avatarEl = document.getElementById(ids.avatar);
const iconEl   = document.getElementById(ids.icon);
if (!avatarEl || !iconEl) return;
if (player) {
avatarEl.src           = src;
avatarEl.style.display = 'block';
iconEl.style.display   = 'none';
} else {
avatarEl.style.display = 'none';
iconEl.style.display   = 'block';
}
});

// Update home profile tile (organiser grid -- non-V)
const tileAvatar = document.getElementById('homeTileAvatar');
const tileIcon   = document.getElementById('homeTileIcon');
const tileName   = document.getElementById('homeTileName');
const tileRating = document.getElementById('homeTileRating');
// Update viewer home profile tile (viewer grid -- V suffix)
const tileAvatarV = document.getElementById('homeTileAvatarV');
const tileIconV   = document.getElementById('homeTileIconV');
const tileNameV   = document.getElementById('homeTileNameV');
const tileRatingV = document.getElementById('homeTileRatingV');

if (!player) {
if (tileAvatar)  tileAvatar.style.display  = 'none';
if (tileIcon)    { tileIcon.style.display = ''; tileIcon.textContent = '👤'; }
if (tileName)    tileName.textContent  = t('myProfile');
if (tileRating)  tileRating.textContent = t('notSelectedProfile');
if (tileAvatarV) tileAvatarV.style.display  = 'none';
if (tileIconV)   { tileIconV.style.display = ''; tileIconV.textContent = '👤'; }
if (tileNameV)   tileNameV.textContent  = t('myProfile');
if (tileRatingV) tileRatingV.textContent = t('notSelectedProfile');
return;
}

if (tileAvatar)  { tileAvatar.src  = src; tileAvatar.style.display  = 'block'; }
if (tileIcon)    tileIcon.style.display  = 'none';
const displayAccount = (typeof authGetUser === 'function') ? authGetUser() : null;
const displayNickname = (displayAccount && (displayAccount.nickname || displayAccount.displayName)) || player.name;
if (tileName)    tileName.textContent  = displayNickname;
if (tileRating)  tileRating.textContent  = t('loading');
if (tileAvatarV) { tileAvatarV.src = src; tileAvatarV.style.display = 'block'; }
if (tileIconV)   tileIconV.style.display = 'none';
if (tileNameV)   tileNameV.textContent = displayNickname;
if (tileRatingV) tileRatingV.textContent = t('loading');

try {
let bestRating = null;
let wins = 0, losses = 0;

// Auto-fetch from all memberships (works across multiple clubs, no live session needed)
const user = (typeof authGetUser === 'function') ? authGetUser() : null;
let bestClubName = null;
if (user) {
  const mems = await sbGet('memberships',
    'user_account_id=eq.' + user.id + '&select=club_id,club_rating,player_id,clubs(name)').catch(function(){ return []; });
  if (mems && mems.length) {
    // Use the ACTIVE club specifically
    const activeClub = (typeof getMyClub === 'function') ? getMyClub() : null;
    const activeMem = activeClub && activeClub.id
      ? mems.find(function(m){ return m.club_id === activeClub.id; })
      : null;
    const bestMem = activeMem || mems.reduce(function(best, m) {
      return (!best || parseFloat(m.club_rating) > parseFloat(best.club_rating)) ? m : best;
    }, null);
    bestRating = parseFloat(bestMem.club_rating) || 1.0;
    if (bestMem.clubs && bestMem.clubs.name) bestClubName = bestMem.clubs.name;
    const pid = bestMem.player_id;
    if (pid) {
      const prows = await sbGet('players', 'id=eq.' + pid + '&select=wins,losses').catch(function(){ return []; });
      if (prows && prows[0]) {
        wins   = prows[0].wins   || 0;
        losses = prows[0].losses || 0;
      }
    }
  }
}

// Fallback to local cache
if (bestRating === null) {
  const master = JSON.parse(localStorage.getItem('newImportHistory') || '[]');
  const hp = master.find(function(h) {
    return h.displayName && h.displayName.trim().toLowerCase() === player.name.trim().toLowerCase();
  });
  bestRating = parseFloat(hp && hp.clubRating) || 1.0;
}

const baseLabel = bestClubName ? bestClubName + '  ·  ' + bestRating.toFixed(1) : 'Club ' + bestRating.toFixed(1);
const label = wins || losses ? baseLabel + '  ·  W:' + wins + ' L:' + losses : baseLabel;
if (tileRating)  tileRating.textContent  = label;
if (tileRatingV) tileRatingV.textContent = label;

} catch(e) {
const master = JSON.parse(localStorage.getItem('newImportHistory') || '[]');
const hp = master.find(function(h) {
return h.displayName && h.displayName.trim().toLowerCase() === player.name.trim().toLowerCase();
});
const clubRating = parseFloat(hp && hp.clubRating) || 1.0;
if (tileRating)  tileRating.textContent  = 'Club ' + clubRating.toFixed(1);
if (tileRatingV) tileRatingV.textContent = 'Club ' + clubRating.toFixed(1);
}
}

/* ── Open drawer ── */
async function openProfileDrawer() {
const overlay = document.getElementById('profileOverlay');
const drawer  = document.getElementById('profileDrawer');
overlay.classList.remove('hidden');
drawer.classList.add('open');

const player = getMyPlayer();
if (player) {
showProfileCard(player);
} else {
showProfilePicker();
}
}

/* ── Close drawer ── */
function closeProfileDrawer() {
const player = getMyPlayer();
if (!player) {
if (_profileSwitching && _previousPlayer) {
// Cancel switch -- restore previous player and close
_profileSwitching = false;
setMyPlayer(_previousPlayer);
updateProfileBtn();
_previousPlayer = null;
} else {
// No profile at all -- block closing
return;
}
}
document.getElementById('profileOverlay').classList.add('hidden');
document.getElementById('profileDrawer').classList.remove('open');
}

/* ── Show player picker -- loads from Supabase ── */
let _pickerAllPlayers = []; // cache for search filtering

function showProfilePicker() {
document.getElementById('profilePicker').style.display    = 'block';
document.getElementById('profileCard').style.display      = 'none';
document.getElementById('pickerListView').style.display   = 'block';
document.getElementById('pinScreenView').style.display    = 'none';

const list = document.getElementById('profilePickerList');
list.innerHTML = '<div class="profile-sessions-loading">' + t('loadingPlayers') + '</div>';

// Clear search box
const searchEl = document.getElementById('profileSearch');
if (searchEl) searchEl.value = '';

// Load ALL players from server (no club filter)
const _club = (getMyClub && getMyClub()) || {};
sbGet('memberships', `club_id=eq.${_club.id||''}&order=nickname.asc&select=nickname,club_rating,is_playing,player_id,players(id,gender,global_rating)`).then(members => {
_pickerAllPlayers = (members || []).map(m => ({
name:          m.nickname,
gender:        m.players?.gender || 'Male',
rating:        parseFloat(m.players?.global_rating) || 1.0,
club_rating:   parseFloat(m.club_rating) || 1.0,
pin:           null,
recovery_word: null
}));
renderPickerList(_pickerAllPlayers);
}).catch(() => {
// Fallback to session players if offline
_pickerAllPlayers = (typeof schedulerState !== 'undefined' && schedulerState.allPlayers.length)
? schedulerState.allPlayers
: [];
renderPickerList(_pickerAllPlayers);
});
}

function renderPickerList(players) {
const list = document.getElementById('profilePickerList');
list.innerHTML = '';

if (!players.length) {
list.innerHTML = '<div class="profile-picker-empty">' + t('noPlayersInClub') + '</div>';
return;
}

players.forEach(p => {
const btn = document.createElement('button');
btn.className = 'profile-picker-item';
btn.innerHTML = `<img src="${p.gender === 'Female' ? 'female.png' : 'male.png'}" class="profile-picker-avatar"> <span>${p.name}</span>`;
btn.onclick = () => profileSelectPlayer(p);
list.appendChild(btn);
});
}

function filterPickerList(query) {
const q = query.trim().toLowerCase();
const filtered = q
? _pickerAllPlayers.filter(p => p.name.toLowerCase().includes(q))
: _pickerAllPlayers;
renderPickerList(filtered);
}

/* ── PIN FLOW ── */

// Entry point when player name tapped
function profileSelectPlayer(p) {
if (!p.pin) {
// No PIN yet -- show setup screen
showPinSetup(p);
} else {
// PIN exists -- show login screen
showPinLogin(p);
}
}

// Render a PIN screen inside the picker area
function _showPinScreen(html) {
document.getElementById('pickerListView').style.display  = 'none';
const pinView = document.getElementById('pinScreenView');
pinView.style.display = 'block';
pinView.innerHTML = ` <div class="profile-drawer-header"> <span class="profile-drawer-title">Who are you?</span> <button class="profile-drawer-close" onclick="showProfilePicker()">✕</button> </div> <div class="pin-screen">${html}</div>`;
}

// ── Setup: first time -- set PIN + recovery word ──
function showPinSetup(p) {
_showPinScreen(`<div class="pin-name">${p.name}</div> <p class="pin-hint">First time? Set a 4-digit PIN and a recovery word.</p> <input id="pinSetupPin" type="password" inputmode="numeric" maxlength="4" class="pin-input" placeholder=t("setPinTitle")> <input id="pinSetupConfirm" type="password" inputmode="numeric" maxlength="4" class="pin-input" placeholder=t("confirmPin")> <input id="pinSetupRecovery" type="text" class="pin-input" placeholder="${t('recoveryWordSecret')}"> <div id="pinSetupError" class="pin-error"></div> <button class="pin-btn" onclick="confirmPinSetup('${p.name.replace(/'/g,"\\'")}')">Save & Continue</button>`);
}

async function confirmPinSetup(name) {
const pin     = document.getElementById('pinSetupPin').value.trim();
const confirm = document.getElementById('pinSetupConfirm').value.trim();
const recovery = document.getElementById('pinSetupRecovery').value.trim().toLowerCase();
const err     = document.getElementById('pinSetupError');

if (!/^\d{4}$/.test(pin))       { err.textContent = t('pinMustBe4'); return; }
if (pin !== confirm)             { err.textContent = t('pinsNotMatch'); return; }
if (recovery.length < 3)        { err.textContent = t('recoveryTooShort'); return; }

err.textContent = t('savingPin');
try {
// PIN/recovery stored in user_accounts via auth system -- no DB patch needed here
// Just update local cache

const p = _pickerAllPlayers.find(x => x.name === name);
if (p) { p.pin = pin; p.recovery_word = recovery; }
err.textContent = '';
_completeProfileSelection(name);

} catch(e) {
err.textContent = t('failedSave');
}
}

// ── Login: enter PIN ──
function showPinLogin(p) {
_showPinScreen(`<div class="pin-name">${p.name}</div> <p class="pin-hint">Enter your PIN to continue.</p> <input id="pinLoginPin" type="password" inputmode="numeric" maxlength="4" class="pin-input" placeholder=t("enterPin")> <div id="pinLoginError" class="pin-error"></div> <button class="pin-btn" onclick="confirmPinLogin('${p.name.replace(/'/g,"\\'")}')">Continue</button> <button class="pin-btn-secondary" onclick="showPinRecovery('${p.name.replace(/'/g,"\\'")}')">Forgot PIN?</button>`);
// Allow Enter key
setTimeout(() => {
const el = document.getElementById('pinLoginPin');
if (el) el.addEventListener('keydown', e => {
if (e.key === 'Enter') confirmPinLogin(p.name);
});
}, 50);
}

function confirmPinLogin(name) {
const entered = document.getElementById('pinLoginPin').value.trim();
const err     = document.getElementById('pinLoginError');
const p       = _pickerAllPlayers.find(x => x.name === name);
if (!p) { err.textContent = t('playerNotFoundPin'); return; }
if (entered !== p.pin) { err.textContent = t('wrongPin'); return; }
_completeProfileSelection(name);
}

// ── Recovery: enter recovery word → reset PIN ──
function showPinRecovery(name) {
_showPinScreen(`<div class="pin-name">${name}</div> <p class="pin-hint">Enter your recovery word to reset your PIN.</p> <input id="pinRecoveryWord" type="text" class="pin-input" placeholder=t("recoveryWord")> <input id="pinRecoveryNew" type="password" inputmode="numeric" maxlength="4" class="pin-input" placeholder=t("newPin")> <input id="pinRecoveryConfirm" type="password" inputmode="numeric" maxlength="4" class="pin-input" placeholder=t("confirmNewPin")> <div id="pinRecoveryError" class="pin-error"></div> <button class="pin-btn" onclick="confirmPinRecovery('${name.replace(/'/g,"\\'")}')">Reset PIN</button> <button class="pin-btn-secondary" onclick="showProfilePicker()">Back</button>`);
}

async function confirmPinRecovery(name) {
const word    = document.getElementById('pinRecoveryWord').value.trim().toLowerCase();
const newPin  = document.getElementById('pinRecoveryNew').value.trim();
const confirm = document.getElementById('pinRecoveryConfirm').value.trim();
const err     = document.getElementById('pinRecoveryError');
const p       = _pickerAllPlayers.find(x => x.name === name);

if (!p) { err.textContent = t('playerNotFoundPin'); return; }
if (word !== (p.recovery_word || '').toLowerCase()) {
err.textContent = t('wrongRecovery'); return;
}
if (!/^\d{4}$/.test(newPin))    { err.textContent = t('pinMust4'); return; }
if (newPin !== confirm)          { err.textContent = t('pinsNotMatch'); return; }

err.textContent = t('savingPin');
try {
// PIN stored in user_accounts -- no direct players patch needed
p.pin = newPin;
err.textContent = '';
_completeProfileSelection(name);
} catch(e) {
err.textContent = t('failedSave');
}
}

// ── Final step: set profile and open card ──
function _completeProfileSelection(name) {
_profileSwitching = false;
_previousPlayer   = null;
const p = _pickerAllPlayers.find(x => x.name === name);
const player = { name, gender: (p && p.gender) || 'Male' };
setMyPlayer(player);
updateProfileBtn();
showProfileCard(player);
}

/* ── Switch player ── */
function switchProfilePlayer() {
_previousPlayer   = getMyPlayer(); // save so cancel can restore
_profileSwitching = true;
clearMyPlayer();
updateProfileBtn();
showProfilePicker();
}

/* ── Get sessions for a player -- localStorage first, then Supabase ── */
function getLocalSessions(playerName) {
try {
const lsKey = `kbrr_sessions_${playerName.toLowerCase().replace(/\s+/g, '_')}`;
return JSON.parse(localStorage.getItem(lsKey) || '[]');
} catch { return []; }
}

function mergeSessions(local, remote) {
// Merge by date, prefer local (more up to date), deduplicate
const map = new Map();
[...remote, ...local].forEach(s => map.set(s.date, s)); // local overwrites remote
return Array.from(map.values())
.sort((a, b) => b.date.localeCompare(a.date))
.slice(0, 10);
}

/* ── Show profile card ── */
async function showProfileCard(player) {
document.getElementById('profilePicker').style.display = 'none';
document.getElementById('profileCard').style.display   = 'block';

// Avatar
document.getElementById('pcAvatar').src =
player.gender === 'Female' ? 'female.png' : 'male.png';

// Name
document.getElementById('pcName').textContent = player.name;

// Single gate -- sync first, then read both raw values from cache
await syncToLocal();
const master       = JSON.parse(localStorage.getItem('newImportHistory') || '[]');
const hp           = master.find(h => h.displayName.trim().toLowerCase() === player.name.trim().toLowerCase());
const globalRating = parseFloat(hp && hp.rating)      || 1.0;  // players.rating -- only updated in global mode
const clubRating   = parseFloat(hp && hp.clubRating)  || 1.0;  // club_ratings[clubId] -- only updated in local mode
const activeRating = parseFloat(hp && hp.activeRating)|| 1.0;  // what session uses
const tier         = ratingTierLabel(activeRating);

document.getElementById('pcRating').textContent     = globalRating.toFixed(1);
document.getElementById('pcClubRating').textContent = clubRating.toFixed(1);
document.getElementById('pcTier').textContent       = tier.label;
document.getElementById('pcTier').style.background  = tier.color + '22';
document.getElementById('pcTier').style.color       = tier.color;

// Fetch wins/losses only
document.getElementById('pcWins').textContent   = '...';
document.getElementById('pcLosses').textContent = '...';
try {
// Look up via memberships → player_id → players
const _club = (getMyClub && getMyClub()) || {};
const _mrows = await sbGet('memberships',
`club_id=eq.${_club.id||''}&nickname=ilike.${encodeURIComponent(player.name)}&select=player_id`);
if (_mrows && _mrows.length) {
const _prows = await sbGet('players', `id=eq.${_mrows[0].player_id}&select=wins,losses`);
if (_prows && _prows.length) {
document.getElementById('pcWins').textContent   = (_prows[0].wins   || 0);
document.getElementById('pcLosses').textContent = (_prows[0].losses || 0);
} else {
document.getElementById('pcWins').textContent   = '--';
document.getElementById('pcLosses').textContent = '--';
}
} else {
document.getElementById('pcWins').textContent   = '--';
document.getElementById('pcLosses').textContent = '--';
}
} catch(e) {
document.getElementById('pcWins').textContent   = '--';
document.getElementById('pcLosses').textContent = '--';
}
}

/* ── Helper: get gender of a player ── */
function getPlayerGender(name) {
if (typeof schedulerState !== 'undefined' && schedulerState.allPlayers) {
const p = schedulerState.allPlayers.find(
p => p.name.toLowerCase() === name.toLowerCase()
);
if (p) return p.gender || 'Male';
}
return 'Male';
}

/* ── Render PDF-style match rows ── */
function renderMatchRow(m, playerName) {
const isWin          = m.result === 'W';
const partner        = m.partner        || [];
const partnerGenders = m.partnerGenders || partner.map(() => 'Male');
const opponents      = m.opponents      || [];
const oppGenders     = m.opponentGenders || opponents.map(() => 'Male');
const myGender       = m.myGender || 'Male';
const date           = m.date || '';

const makePlayer = (name, gender) =>
`<div class="mc-match-player"> <img src="${gender === 'Female' ? 'female.png' : 'male.png'}" class="mc-match-avatar"> <span class="mc-match-name">${name}</span> </div>`;

const myTeam  = [makePlayer(playerName, myGender), ...partner.map((n, i) => makePlayer(n, partnerGenders[i]))].join('');
const oppTeam = opponents.map((n, i) => makePlayer(n, oppGenders[i])).join('');

return `<div class="mc-match-card ${isWin ? 'mc-win' : 'mc-loss'}"> <div class="mc-match-team mc-match-top"> <div class="mc-match-players">${myTeam}</div> ${isWin ? '<div class="mc-match-cup">🏆</div>' : ''} </div> <div class="mc-match-divider"> <div class="mc-match-divider-line"></div> <span class="mc-match-result-badge ${isWin ? 'mc-badge-win' : 'mc-badge-loss'}">${isWin ? 'WIN' : 'LOSS'}</span> <div class="mc-match-divider-line"></div> </div> <div class="mc-match-team mc-match-bottom"> <div class="mc-match-players">${oppTeam}</div> ${!isWin ? '<div class="mc-match-cup">🏆</div>' : ''} </div> ${date ?`<div class="mc-match-date">${date}</div>` : ''} </div>`;
}

/* ── My Card Page ── */
async function renderMyCard() {
const player = (typeof getMyPlayer === 'function') ? getMyPlayer() : null;

const emptyEl   = document.getElementById('myCardEmpty');
const contentEl = document.getElementById('myCardContent');

// Show empty/login state if not logged in via auth
const authUser = (typeof authGetUser === 'function') ? authGetUser() : null;
if (!authUser) {
if (emptyEl)   emptyEl.style.display   = '';
if (contentEl) contentEl.style.display = 'none';
return;
}

// Demo mode — no personal player profile exists for the shared demo account
if (typeof isDemoMode === 'function' && isDemoMode()) {
  if (emptyEl) {
    emptyEl.style.display = '';
    emptyEl.innerHTML = '<div class="dash-empty">'
      + '<div class="dash-empty-icon">🎮</div>'
      + '<p style="font-weight:700;margin-bottom:6px">My Card — Demo Mode</p>'
      + '<p style="font-size:0.78rem;color:var(--text-dim);margin-top:4px;line-height:1.5">'
      + 'Personal stats and ratings are not available in demo mode.<br>'
      + 'Sign up for free to track your own profile!'
      + '</p>'
      + '<button class="btn-save" style="margin-top:16px" onclick="authDemoSignupPrompt()">Sign Up Free →</button>'
      + '</div>';
  }
  if (contentEl) contentEl.style.display = 'none';
  return;
}

if (!player) {
if (emptyEl)   emptyEl.style.display   = '';
if (contentEl) contentEl.style.display = 'none';
return;
}

if (emptyEl)   emptyEl.style.display   = 'none';
if (contentEl) contentEl.style.display = '';

// Avatar + Name
const avatar = document.getElementById('mcAvatar');
if (avatar) avatar.src = player.gender === 'Female' ? 'female.png' : 'male.png';
const nameEl = document.getElementById('mcName');
const accountUser = (typeof authGetUser === 'function') ? authGetUser() : null;
if (nameEl) nameEl.textContent = (accountUser && accountUser.nickname) || player.displayName || player.name || '';
const editNicknameBtn = document.getElementById('mcEditNicknameBtn');
if (editNicknameBtn) editNicknameBtn.style.display = accountUser ? '' : 'none';

// Logout button -- only show if logged in via auth
const logoutBtn = document.getElementById('mcLogoutBtn');
if (logoutBtn) {
  logoutBtn.style.display = 'none';
}

const sessEl = document.getElementById('mcSessions');
if (sessEl) sessEl.innerHTML = '<div class="profile-sessions-loading">Loading...</div>';

try {
// Find player via membership -- nickname lookup using logged-in user's account
const myNickname = player.displayName || player.name || player.nickname || '';
let globalRating = 0, globalPoints = 0, totalWins = 0, totalLosses = 0;
let sessions = [];
let playerDbId = null;
let clubBreakdowns = []; // { name, rating, points }

// Fetch ALL memberships by user_account_id (UUID) — reliable, no nickname collision risk
const allMems = await sbGet('memberships',
  `user_account_id=eq.${authUser.id}&select=player_id,club_id,club_rating,club_points,clubs(name)`
).catch(() => []);

// Match history belongs to the account, not to the active/current clubs.
// Account-linked player rows preserve history after a membership is removed;
// current memberships remain a compatibility fallback for older data.
const accountPlayers = await sbGet('players',
  `user_account_id=eq.${authUser.id}&select=id`
).catch(() => []);
const allPlayerIds = [...new Set([
  ...accountPlayers.map(p => p.id),
  ...allMems.map(m => m.player_id)
].filter(Boolean))];
playerDbId = allPlayerIds[0] || null;

// Best-effort repair for older player rows linked only through memberships.
allMems.forEach(m => {
  if (!m.player_id) return;
  sbPatch('players', `id=eq.${m.player_id}&user_account_id=is.null`, {
    user_account_id: authUser.id
  }).catch(() => {});
});

if (allMems.length) {
  // Aggregate points; average rating across all clubs
  let totalRating = 0;
  for (const m of allMems) {
    const r = parseFloat(m.club_rating) || 0;
    const p = parseFloat(m.club_points) || 0;
    const clubName = m.clubs?.name || 'Club';
    totalRating += r;
    globalPoints += p;
    clubBreakdowns.push({ name: clubName, rating: r, points: p });
  }
  globalRating = totalRating / allMems.length;

  // Fetch players rows for ALL player_ids — aggregate wins/losses/sessions across all clubs
  if (allPlayerIds.length) {
    const prows = await sbGet('players',
      `id=in.(${allPlayerIds.join(',')})&select=id,wins,losses,sessions`
    ).catch(() => []);

    for (const pr of prows) {
      totalWins   += pr.wins   || 0;
      totalLosses += pr.losses || 0;
      // Merge sessions, tagging each with its player_id for match lookups
      (pr.sessions || []).forEach(s => sessions.push({ ...s, _playerId: pr.id }));
    }
  }
}

// 3. Tier — based on aggregated global rating
// A player who has left every club still keeps account-owned history.
if (!allMems.length && allPlayerIds.length) {
  const prows = await sbGet('players',
    `id=in.(${allPlayerIds.join(',')})&select=id,wins,losses,sessions`
  ).catch(() => []);
  for (const pr of prows) {
    totalWins   += pr.wins   || 0;
    totalLosses += pr.losses || 0;
    (pr.sessions || []).forEach(s => sessions.push({ ...s, _playerId: pr.id }));
  }
}

const tier = ratingTierLabel(globalRating || 1.0);

// 4. Update ratings + points
const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
setEl('mcGlobalRating', globalRating.toFixed(1));
setEl('mcGlobalPoints', globalPoints.toFixed(1));

// Render per-club breakdowns
const ratingBD = document.getElementById('mcRatingBreakdown');
const pointsBD = document.getElementById('mcPointsBreakdown');
if (ratingBD) {
  ratingBD.innerHTML = clubBreakdowns.map(c =>
    `<div class="mycard-club-breakdown-row"><span class="cb-name">${c.name}</span><span class="cb-val">${c.rating.toFixed(1)}</span></div>`
  ).join('');
}
if (pointsBD) {
  pointsBD.innerHTML = clubBreakdowns.map(c =>
    `<div class="mycard-club-breakdown-row"><span class="cb-name">${c.name}</span><span class="cb-val">${c.points.toFixed(1)}pts</span></div>`
  ).join('');
}
setEl('mcWins',         totalWins);
setEl('mcLosses',       totalLosses);

const tierEl = document.getElementById('mcTier');
if (tierEl) { tierEl.textContent = tier.label; tierEl.style.background = tier.color + '22'; tierEl.style.color = tier.color; }

// 5. Period stats from sessions jsonb
const now       = new Date();
// Use LOCAL date strings for comparison (avoids UTC-vs-local timezone issues)
const _pad      = n => String(n).padStart(2, '0');
const todayStr  = `${now.getFullYear()}-${_pad(now.getMonth()+1)}-${_pad(now.getDate())}`;
const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay());
const weekStr   = `${weekStart.getFullYear()}-${_pad(weekStart.getMonth()+1)}-${_pad(weekStart.getDate())}`;
const monthStr  = `${now.getFullYear()}-${_pad(now.getMonth()+1)}-01`;
const yearStr   = `${now.getFullYear()}-01-01`;

let wW=0,lW=0,pW=0,cW=0, wM=0,lM=0,pM=0,cM=0, wY=0,lY=0,pY=0,cY=0;
(sessions || []).forEach(s => {
  const d = s.date;
  if (!d) return;
  const w = s.wins || 0, l = s.losses || 0;
  const p = parseFloat(s.points_earned) || 0;
  const c = parseFloat(s.cost_per_player) || 0;
  if (d >= yearStr)  { wY += w; lY += l; pY += p; cY += c; }
  if (d >= monthStr) { wM += w; lM += l; pM += p; cM += c; }
  if (d >= weekStr)  { wW += w; lW += l; pW += p; cW += c; }
});

setEl('mcWeekWins',    wW); setEl('mcWeekLosses',    lW); setEl('mcWeekPoints',    pW.toFixed(1)); setEl('mcWeekCost',  cW > 0 ? '¥'+Math.round(cW).toLocaleString() : '--');
setEl('mcMonthWins',   wM); setEl('mcMonthLosses',   lM); setEl('mcMonthPoints',   pM.toFixed(1)); setEl('mcMonthCost', cM > 0 ? '¥'+Math.round(cM).toLocaleString() : '--');
setEl('mcYearWins',    wY); setEl('mcYearLosses',    lY); setEl('mcYearPoints',    pY.toFixed(1)); setEl('mcYearCost',  cY > 0 ? '¥'+Math.round(cY).toLocaleString() : '--');

// 6. Render sessions list — last 3 visible, rest hidden
if (sessEl) {
  if (sessions.length) {
    const sorted = [...sessions].sort((a,b) => (b.date||'').localeCompare(a.date||''));
    const renderSessRow = (s, hidden) => {
      const d    = new Date(s.date).toLocaleDateString(undefined, { month:'short', day:'numeric' });
      const w    = s.wins   || 0;
      const l    = s.losses || 0;
      const pts  = parseFloat(s.points_earned || 0).toFixed(1);
      const cost = s.cost_per_player ? `<span class="mc-session-stat cost">¥${Math.round(s.cost_per_player).toLocaleString()}</span>` : '';
      const groupId = 'mcmg_' + (s.date||'').replace(/-/g,'');
      return `<div class="mc-session-row${hidden ? ' mc-sess-hidden' : ''}" style="${hidden ? 'display:none' : ''};cursor:pointer" onclick="
        var g=document.getElementById('${groupId}');
        if(!g) return;
        g.style.display='block';
        g.previousElementSibling.querySelector('.mc-mgh-arrow').textContent='▴';
        g.scrollIntoView({behavior:'smooth',block:'start'});
      ">
        <span class="mc-session-date">${d}</span>
        <span class="mc-session-stat wins">${w}W</span>
        <span class="mc-session-stat losses">${l}L</span>
        <span class="mc-session-stat points">${pts}pts</span>
        ${cost}
        <span style="font-size:0.7rem;color:var(--accent,#6c63ff);margin-left:auto;">▾ matches</span>
      </div>`;
    };
    const rows = sorted.map((s, i) => renderSessRow(s, i >= 3)).join('');
    const more = sorted.length > 3
      ? `<div class="mc-sess-toggle" onclick="
          var hs=this.parentNode.querySelectorAll('.mc-sess-hidden');
          var shown=hs[0]&&hs[0].style.display!=='none';
          hs.forEach(function(el){el.style.display=shown?'none':'flex'});
          this.textContent=shown?'Show all ${sorted.length} sessions ▾':'Show less ▴';
        ">Show all ${sorted.length} sessions ▾</div>`
      : '';
    sessEl.innerHTML = rows + more;
  } else {
    sessEl.innerHTML = '<div class="profile-sessions-empty">No sessions yet.</div>';
  }
}

// 7. Render recent matches grouped by session date — across ALL clubs
const matchEl = document.getElementById('mcMatches');
if (matchEl && allPlayerIds.length) {
  matchEl.innerHTML = '<div class="profile-sessions-loading">Loading matches...</div>';
  try {
    // Build nickname lookup from all memberships already fetched
    const uuidToNick = {};
    allMems.forEach(m => { if (m.player_id) uuidToNick[m.player_id] = myNickname; });
    // Also fetch all co-members across all clubs for opponent name lookup
    const clubIds = [...new Set(allMems.map(m => m._clubId).filter(Boolean))];

    // Fetch matches for all player_ids across all clubs
    const orClauses = allPlayerIds.map(pid =>
      `pair1_player1.eq.${pid},pair1_player2.eq.${pid},pair2_player1.eq.${pid},pair2_player2.eq.${pid}`
    ).join(',');
    const matches = await sbGet('matches',
      `or=(${orClauses})&order=played_at.desc&limit=100`
    ).catch(() => []);
    
    // Fetch nicknames for all players appearing in matches for name display
    const matchPlayerIds = new Set();
    (matches || []).forEach(m => {
      [m.pair1_player1, m.pair1_player2, m.pair2_player1, m.pair2_player2].forEach(id => { if (id) matchPlayerIds.add(id); });
    });
    const unknownIds = [...matchPlayerIds].filter(id => !uuidToNick[id]);
    if (unknownIds.length) {
      const nickRows = await sbGet('memberships',
        `player_id=in.(${unknownIds.join(',')})&select=player_id,nickname`
      ).catch(() => []);
      nickRows.forEach(m => { uuidToNick[m.player_id] = m.nickname; });
    }

    if (!matches || !matches.length) {
      matchEl.innerHTML = '<div class="profile-sessions-empty">No matches yet.</div>';
    } else {
      // Group by date (YYYY-MM-DD)
      const groups = {};
      const groupOrder = [];
      matches.forEach(m => {
        const dt  = m.played_at ? m.played_at.slice(0,10) : 'unknown';
        if (!groups[dt]) { groups[dt] = []; groupOrder.push(dt); }
        groups[dt].push(m);
      });

      const renderMatch = (m) => {
        const myIds    = new Set(allPlayerIds);
        const inPair1  = myIds.has(m.pair1_player1) || myIds.has(m.pair1_player2);
        const myPair   = inPair1 ? [m.pair1_player1, m.pair1_player2] : [m.pair2_player1, m.pair2_player2];
        const oppPair  = inPair1 ? [m.pair2_player1, m.pair2_player2] : [m.pair1_player1, m.pair1_player2];
        const won      = (inPair1 && m.winner_pair === 'pair1') || (!inPair1 && m.winner_pair === 'pair2');
        const partner  = myPair.filter(id => id && !myIds.has(id)).map(id => uuidToNick[id] || '?');
        const opps     = oppPair.filter(id => id).map(id => uuidToNick[id] || '?');
        const delta    = m.rating_delta ? (won ? '+' : '') + parseFloat(m.rating_delta).toFixed(2) : '';
        const myNames  = [myNickname, ...partner].filter(Boolean).join(' & ');
        const oppNames = opps.join(' & ');
        return `<div class="mc-match-row ${won ? 'mc-match-win' : 'mc-match-loss'}">
          <div class="mc-match-left-bar"></div>
          <div class="mc-match-content">
            <div class="mc-match-teams">
              <div class="mc-match-pair">${myNames}</div>
              <div class="mc-match-vs">vs</div>
              <div class="mc-match-pair opp">${oppNames}</div>
            </div>
            <div class="mc-match-result">
              <span class="mc-match-badge ${won ? 'win' : 'loss'}">${won ? 'WIN' : 'LOSS'}</span>
              ${delta ? `<span class="mc-match-delta ${won ? 'win' : 'loss'}">${delta}</span>` : ''}
            </div>
          </div>
        </div>`;
      };

      matchEl.innerHTML = groupOrder.map((dt, gi) => {
        const dayMatches = groups[dt];
        const label = new Date(dt).toLocaleDateString(undefined, { month:'short', day:'numeric' });
        const myIdSet = new Set(allPlayerIds);
        const w   = dayMatches.filter(m => { const ip=(myIdSet.has(m.pair1_player1)||myIdSet.has(m.pair1_player2)); return (ip&&m.winner_pair==='pair1')||(!ip&&m.winner_pair==='pair2'); }).length;
        const l   = dayMatches.length - w;
        // Find session stats for this date
        const sess = (sessions||[]).find(s => s.date === dt);
        const pts  = sess ? parseFloat(sess.points_earned||0).toFixed(1) : null;
        const cost = sess && sess.cost_per_player ? `<span class="mc-session-stat cost" style="font-size:0.72rem">¥${Math.round(sess.cost_per_player).toLocaleString()}</span>` : '';
        const isFirst = gi === 0;
        const groupId = 'mcmg_' + dt.replace(/-/g,'');

        return `<div class="mc-match-group">
          <div class="mc-match-group-header" onclick="
            var b=document.getElementById('${groupId}');
            var open=b.style.display!=='none';
            b.style.display=open?'none':'block';
            this.querySelector('.mc-mgh-arrow').textContent=open?'▾':'▴';
          ">
            <div class="mc-mgh-left">
              <span class="mc-mgh-date">${label}</span>
              <span class="mc-session-stat wins" style="font-size:0.72rem">${w}W</span>
              <span class="mc-session-stat losses" style="font-size:0.72rem">${l}L</span>
              ${pts ? `<span class="mc-session-stat points" style="font-size:0.72rem">${pts}pts</span>` : ''}
              ${cost}
            </div>
            <span class="mc-mgh-arrow">${isFirst ? '▴' : '▾'}</span>
          </div>
          <div id="${groupId}" style="display:${isFirst ? 'block' : 'none'}">
            ${dayMatches.map(renderMatch).join('')}
          </div>
        </div>`;
      }).join('');
    }
  } catch(e) {
    matchEl.innerHTML = '<div class="profile-sessions-empty">Could not load matches.</div>';
  }
}

} catch(e) {
console.error('renderMyCard error:', e);
['mcWins','mcLosses','mcGlobalRating','mcGlobalPoints'].forEach(id => {
const el = document.getElementById(id); if (el) el.textContent = '--';
});
if (sessEl) sessEl.innerHTML = '<div class="profile-sessions-empty">Could not load data.</div>';
}
}

/* ── Render sessions with PDF-style match history ── */
function renderSessions(sessions, playerName, liveMatches) {
const container = document.getElementById('mcSessions') || document.getElementById('pcSessions');
if (!container) return;
container.innerHTML = '';

// liveMatches comes from live_sessions DB (any device) or allRounds (local fallback)
if (!liveMatches && typeof allRounds !== 'undefined' && allRounds.length) {
liveMatches = [];
for (const round of allRounds) {
const games = round.games || round;
for (const game of games) {
if (!game.winner) continue;
const pair1   = game.pair1 || [];
const pair2   = game.pair2 || [];
const leftWon = game.winner === 'L';
const inPair1 = pair1.some(p => p.toLowerCase() === playerName.toLowerCase());
const inPair2 = pair2.some(p => p.toLowerCase() === playerName.toLowerCase());
if (!inPair1 && !inPair2) continue;
const opponents = inPair1 ? pair2 : pair1;
const partner   = inPair1 ? pair1.filter(p => p.toLowerCase() !== playerName.toLowerCase())
: pair2.filter(p => p.toLowerCase() !== playerName.toLowerCase());
liveMatches.push({
partner,
partnerGenders:  partner.map(n => getPlayerGender(n)),
opponents,
opponentGenders: opponents.map(n => getPlayerGender(n)),
result: (inPair1 && leftWon) || (inPair2 && !leftWon) ? 'W' : 'L'
});
}
}
}

const hasLive = Array.isArray(liveMatches) && liveMatches.length > 0;
const hasPast = sessions.length > 0;

if (!hasLive && !hasPast) {
container.innerHTML = '<div class="profile-sessions-empty">No sessions recorded yet.</div>';
return;
}

// ── Current session ──
if (hasLive) {
const liveWins   = liveMatches.filter(m => m.result === 'W').length;
const liveLosses = liveMatches.filter(m => m.result === 'L').length;
const rating     = (typeof getActiveRating === 'function') ? getActiveRating(playerName) : getRating(playerName);
const tier       = ratingTierLabel(rating);

const block = document.createElement('div');
block.className = 'session-block';
block.innerHTML = `
  <div class="session-block-header">
    <div class="session-header-left">
      <span class="session-block-date">Today</span>
      <span class="session-block-rating" style="color:${tier.color}">${rating.toFixed(1)}</span>
    </div>
    <div class="session-header-badges">
      ${liveWins   > 0 ? `<span class="session-badge win">${liveWins}W</span>`   : ''}
      ${liveLosses > 0 ? `<span class="session-badge loss">${liveLosses}L</span>` : ''}
      <span class="session-live-dot">LIVE</span>
    </div>
  </div>
  <div class="session-matches">
    ${liveMatches.map(m => renderMatchRow(m, playerName)).join('<div class="match-divider"></div>')}
  </div>`;
container.appendChild(block);

}

// ── Past sessions ──
sessions.slice(0, 3).forEach((s, idx) => {
const tier    = ratingTierLabel(s.rating || 1.0);
const matches = s.matches || [];

const block = document.createElement('div');
block.className = 'session-block past';
block.innerHTML = `
  <div class="session-block-header" onclick="toggleSessionMatches(this)">
    <div class="session-header-left">
      <span class="session-block-date">${s.date || '--'}</span>
      <span class="session-block-rating" style="color:${tier.color}">${(s.rating || 1.0).toFixed(1)}</span>
    </div>
    <div class="session-header-badges">
      ${s.wins   > 0 ? `<span class="session-badge win">${s.wins}W</span>`   : ''}
      ${s.losses > 0 ? `<span class="session-badge loss">${s.losses}L</span>` : ''}
      ${matches.length ? `<span class="session-chevron">›</span>` : `<span class="session-chevron">›</span>`}
    </div>
  </div>
  ${matches.length ? `
  <div class="session-matches collapsed">
    ${matches.map(m => renderMatchRow(m, playerName)).join('<div class="match-divider"></div>')}
  </div>` : `
  <div class="session-matches collapsed">
    <div class="session-no-matches">Match details available from next session onwards</div>
  </div>`}`;
container.appendChild(block);

});
}

function toggleSessionMatches(header) {
const matchList = header.nextElementSibling;
if (!matchList) return;
const isOpen = matchList.classList.toggle('collapsed');
const chevron = header.querySelector('.session-chevron');
if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(90deg)';
}

/* ── Init on load ── */
document.addEventListener('DOMContentLoaded', () => {
updateProfileBtn();
});
