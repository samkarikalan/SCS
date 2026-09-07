/* ============================================================
   auth.js
   Player authentication system
   - Sign up / Login / Forgot password
   - Mock mode for local testing (no Supabase needed)
   - Switch MOCK_MODE = false when Supabase tables are ready
   ============================================================ */

var AUTH_MOCK_MODE = false; // ← set false when Supabase tables ready

/* ── Demo Mode Constants ── */
/* !! Fill these in after creating demo account in Supabase !! */
var DEMO_EMAIL     = 'demo@scs-app.com';
var DEMO_PASSWORD  = 'demo1234';
var DEMO_CLUB_ID   = 'ea992e2b-8cb6-4215-ae4b-849f63f3b703';
var DEMO_CLUB_NAME = 'Demo';
var DEMO_DURATION  = 10 * 60 * 1000; // 10 minutes (kept for future use)
var DEMO_TIME_LIMIT_ENABLED = false; // Demo can currently run without a time limit
var DEMO_BANNER_ENABLED     = false; // Keep demo banner code, but do not show it

var _demoTimer    = null;
var _demoEndTime  = null;
var _demoTick     = null;

function isDemoMode() {
  return localStorage.getItem('scs_demo_mode') === '1';
}

async function authStartDemo() {
  var btn = document.getElementById('demoBtnWelcome');
  if (btn) { btn.textContent = '⏳ Loading demo...'; btn.disabled = true; }

  try {
    // Log in silently with demo credentials
    var result = await authLogin(DEMO_EMAIL, DEMO_PASSWORD);
    if (result.error) {
      if (btn) { btn.textContent = '🎮 Try Demo'; btn.disabled = false; }
      alert('Demo unavailable right now. Please try again later.');
      return;
    }

    // Demo is a shared account — session conflicts are expected and should always
    // be overridden automatically (no prompt needed).
    if (result.conflict) {
      var forceResult = await authForceLogin(result.user);
      if (forceResult.error) {
        if (btn) { btn.textContent = '🎮 Try Demo'; btn.disabled = false; }
        alert('Demo unavailable right now. Please try again later.');
        return;
      }
      result = forceResult;
    }

    // Set demo club
    if (typeof setMyClub === 'function') setMyClub(DEMO_CLUB_ID, DEMO_CLUB_NAME);
    localStorage.setItem('scs_demo_mode', '1');
    localStorage.setItem('scs_organiser_verified', '1');
    sessionStorage.setItem('scs_organiser_verified', '1');

    // Release any players left locked from a previous demo session
    sbPatch('memberships', 'club_id=eq.' + DEMO_CLUB_ID + '&is_playing=eq.true', { is_playing: false }).catch(function() {});

    // Hide auth overlay
    var overlay = document.getElementById('authOverlay');
    if (overlay) overlay.style.display = 'none';

    // Show demo banner and start timer
    _demoStartTimer();

    // Go to mode select
    var modeOverlay = document.getElementById('modeSelectOverlay');
    if (modeOverlay) modeOverlay.style.display = 'flex';
    if (typeof mlSyncLangDisplay === 'function') mlSyncLangDisplay();

  } catch(e) {
    if (btn) { btn.textContent = '🎮 Try Demo'; btn.disabled = false; }
    alert('Demo unavailable. Please try again later.');
  }
}

function _demoStartTimer() {
  var banner = document.getElementById('demoBanner');
  if (banner) banner.style.display = DEMO_BANNER_ENABLED ? 'block' : 'none';

  // Demo timer/expiry code is intentionally retained, but disabled for now.
  if (!DEMO_TIME_LIMIT_ENABLED) {
    _demoEndTime = null;
    if (_demoTick) { clearInterval(_demoTick); _demoTick = null; }
    return;
  }

  _demoEndTime = Date.now() + DEMO_DURATION;

  _demoTick = setInterval(function() {
    var remaining = _demoEndTime - Date.now();
    if (remaining <= 0) {
      _demoClear();
      authExitDemo();
      return;
    }
    var m = Math.floor(remaining / 60000);
    var s = Math.floor((remaining % 60000) / 1000);
    var el = document.getElementById('demoTimerDisplay');
    if (el) el.textContent = m + ':' + (s < 10 ? '0' : '') + s;
  }, 1000);
}

function _demoClear() {
  if (_demoTick) { clearInterval(_demoTick); _demoTick = null; }
  localStorage.removeItem('scs_demo_mode');
  localStorage.removeItem('scs_organiser_verified');
  sessionStorage.removeItem('scs_organiser_verified');
  var banner = document.getElementById('demoBanner');
  if (banner) banner.style.display = 'none';
}

function authExitDemo() {
  _demoClear();
  if (typeof authLogout === 'function') authLogout();
  if (typeof ResetAll  === 'function') ResetAll();
  var authOverlay = document.getElementById('authOverlay');
  if (authOverlay) authOverlay.style.display = 'flex';
  if (typeof authShowScreen === 'function') authShowScreen('welcome');
  var btn = document.getElementById('demoBtnWelcome');
  if (btn) { btn.textContent = '🎮 Try Demo'; btn.disabled = false; }
}

function authDemoSignupPrompt() {
  _demoClear();
  if (typeof authLogout === 'function') authLogout();
  if (typeof ResetAll  === 'function') ResetAll();
  var authOverlay = document.getElementById('authOverlay');
  if (authOverlay) authOverlay.style.display = 'flex';
  if (typeof authShowScreen === 'function') authShowScreen('signup');
}

function showDemoVaultBlock() {
  var existing = document.getElementById('scs-demo-vault-modal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'scs-demo-vault-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px;box-sizing:border-box;';

  modal.innerHTML = '<div style="background:var(--card-bg,#1e1e2e);border-radius:18px;padding:28px 24px;max-width:320px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.5);text-align:center;">'
    + '<div style="font-size:2.2rem;margin-bottom:12px;">🔒</div>'
    + '<div style="font-size:1rem;font-weight:700;color:var(--text,#fff);margin-bottom:8px;">Vault Not Available</div>'
    + '<div style="font-size:0.82rem;color:var(--muted,#aaa);line-height:1.6;margin-bottom:22px;">'
    + 'Vault Manager is disabled in demo mode.<br>'
    + 'Sign up free to get <strong style="color:var(--text,#fff);">60 days full access</strong> including club management.'
    + '</div>'
    + '<button id="demVaultSignup" style="width:100%;padding:13px;background:linear-gradient(135deg,#6c63ff,#574fd6);color:#fff;border:none;border-radius:12px;font-size:0.9rem;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:10px;">Sign Up Free →</button>'
    + '<button id="demVaultClose" style="width:100%;padding:11px;background:none;border:1px solid var(--border,#333);color:var(--muted,#aaa);border-radius:12px;font-size:0.88rem;cursor:pointer;font-family:inherit;">Continue Demo</button>'
    + '</div>';

  document.body.appendChild(modal);

  document.getElementById('demVaultSignup').onclick = function() {
    modal.remove();
    if (typeof authDemoSignupPrompt === 'function') authDemoSignupPrompt();
  };
  document.getElementById('demVaultClose').onclick = function() {
    modal.remove();
  };
}

/* ── Current session ── */
var _authUser = null; // { id, userId, nickname, email }

/* ============================================================
   SINGLE-DEVICE SESSION ENFORCEMENT
   Uses active_sessions table: { user_account_id, token, device_info, updated_at }
   ============================================================ */

var SESSION_CHECK_INTERVAL = null;
var SESSION_CHECK_MS = 2 * 60 * 1000; // check every 2 minutes

/* Generate a random session token */
function _generateSessionToken() {
  var arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

/* Get/set local session token */
function _getLocalToken() {
  return localStorage.getItem('scs_session_token') || null;
}
function _setLocalToken(token) {
  if (token) localStorage.setItem('scs_session_token', token);
  else localStorage.removeItem('scs_session_token');
}

/* Device info string */
function _getDeviceInfo() {
  var ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  return 'Browser';
}

/* Write a session row to server — upsert on user_account_id (atomic, no race condition) */
async function _writeServerSession(userId, token) {
  var now  = new Date().toISOString();
  var data = {
    user_account_id: userId,
    token:           token,
    device_info:     _getDeviceInfo(),
    updated_at:      now
  };

  // Try upsert first
  try {
    await sbUpsert('active_sessions', data, 'user_account_id');
    return;
  } catch(e) {}

  // Fallback: delete then insert
  try {
    await sbDelete('active_sessions', 'user_account_id=eq.' + userId);
  } catch(ed) {}
  try {
    await sbPost('active_sessions', data, 'return=representation');
  } catch(e2) {}
}

/* Read server token for this user.
   Returns: { token: string } if row found,
            { noRow: true }  if no session on server,
            { networkError: true } if fetch failed — be lenient, don't kick user out */
async function _readServerToken(userId) {
  try {
    var rows = await sbGet('active_sessions', 'user_account_id=eq.' + userId + '&select=token');
    if (rows && rows.length) return { token: rows[0].token };
    return { noRow: true };
  } catch(e) {
    return { networkError: true };
  }
}

/* Delete server session row — called on logout */
async function _deleteServerSession(userId) {
  try {
    await sbDelete('active_sessions', 'user_account_id=eq.' + userId);
  } catch(e) {}
}

/* Verify current session against server — called on startup and periodically.
   Returns true if valid, false if session was displaced by another device. */
async function authVerifySession() {
  var user = authGetUser();
  if (!user) return false;

  var localToken = _getLocalToken();
  if (!localToken) return false;

  var serverResult = await _readServerToken(user.id);

  // Network error — be lenient, don't kick user out
  if (serverResult.networkError) return true;

  // No row on server — session was deleted (logout from another tab, admin clear, etc.)
  // Treat as session expired → force logout so user must re-authenticate.
  if (serverResult.noRow) {
    _authUser = null;
    _setLocalToken(null);
    localStorage.removeItem('auth_user');
    localStorage.removeItem('kbrr_my_club_id');
    localStorage.removeItem('kbrr_my_club_name');
    localStorage.removeItem('kbrr_my_player');
    localStorage.removeItem('kbrr_app_mode');
  localStorage.removeItem('scs_organiser_verified');
  localStorage.removeItem('scs_vault_verified');
  sessionStorage.removeItem('scs_organiser_verified');
  sessionStorage.removeItem('scs_vault_verified');
    _stopSessionWatch();
    if (typeof authShowScreen === 'function') authShowScreen('welcome');
    _showDisplacedNotice();
    return false;
  }

  var serverToken = serverResult.token;
  if (serverToken !== localToken) {
    // Another device has taken over — force logout
    _authUser = null;
    _setLocalToken(null);
    localStorage.removeItem('auth_user');
    localStorage.removeItem('kbrr_my_club_id');
    localStorage.removeItem('kbrr_my_club_name');
    localStorage.removeItem('kbrr_my_player');
    localStorage.removeItem('kbrr_app_mode');
  localStorage.removeItem('scs_organiser_verified');
  localStorage.removeItem('scs_vault_verified');
  sessionStorage.removeItem('scs_organiser_verified');
  sessionStorage.removeItem('scs_vault_verified');
    _stopSessionWatch();
    if (typeof authShowScreen === 'function') authShowScreen('welcome');
    _showDisplacedNotice();
    return false;
  }

  return true;
}

function _showDisplacedNotice() {
  // Small toast informing user they were logged out
  var existing = document.getElementById('scs-displaced-toast');
  if (existing) existing.remove();
  var toast = document.createElement('div');
  toast.id = 'scs-displaced-toast';
  toast.style.cssText = [
    'position:fixed', 'top:20px', 'left:50%', 'transform:translateX(-50%)',
    'background:#e63757', 'color:#fff', 'padding:12px 20px', 'border-radius:12px',
    'font-size:0.85rem', 'font-weight:600', 'z-index:99999',
    'box-shadow:0 .25rem 1.25rem rgba(0,0,0,0.3)', 'text-align:center',
    'max-width:17.5rem', 'line-height:1.4'
  ].join(';');
  toast.textContent = '⚠️ You were signed out because another device signed in.';
  document.body.appendChild(toast);
  setTimeout(function() { if (toast.parentNode) toast.remove(); }, 5000);
}

/* Start background polling to detect remote logout */
function _startSessionWatch() {
  _stopSessionWatch();
  SESSION_CHECK_INTERVAL = setInterval(async function() {
    await authVerifySession();
  }, SESSION_CHECK_MS);
}

function _stopSessionWatch() {
  if (SESSION_CHECK_INTERVAL) {
    clearInterval(SESSION_CHECK_INTERVAL);
    SESSION_CHECK_INTERVAL = null;
  }
}

/* Check if user is already logged in on ANOTHER device.
   Returns:
     { hasSession: false }                         — no other session, safe to log in
     { hasSession: true, deviceInfo, serverToken } — another device is active → show prompt
     { networkError: true }                        — cannot reach server → block login (fail-closed)
*/
async function authCheckExistingSession(userId) {
  var localToken = _getLocalToken(); // token already stored on THIS device (null = fresh login)
  try {
    var rows = await sbGet('active_sessions',
      'user_account_id=eq.' + userId + '&select=token,device_info,updated_at');

    if (!rows || !rows.length) {
      return { hasSession: false }; // no session row — safe to proceed
    }

    var serverToken = rows[0].token;
    var deviceInfo  = rows[0].device_info || 'another device';

    // If server token matches THIS device's local token → it's our own session, no conflict
    if (localToken && serverToken === localToken) {
      return { hasSession: false };
    }

    // A different token exists on the server → another device is logged in
    return { hasSession: true, deviceInfo: deviceInfo, serverToken: serverToken };

  } catch(e) {
    // Cannot verify — fail-closed: do NOT silently allow login
    return { networkError: true };
  }
}

/* ── Mock DB for testing ── */
var _mockUsers = JSON.parse(localStorage.getItem('mock_users') || '[]');
var _mockClubMembers = JSON.parse(localStorage.getItem('mock_club_members') || '[]');

function _saveMockUsers() {
  localStorage.setItem('mock_users', JSON.stringify(_mockUsers));
}
function _saveMockMembers() {
  localStorage.setItem('mock_club_members', JSON.stringify(_mockClubMembers));
}

/* ============================================================
   PUBLIC API
   ============================================================ */

/* ── Get current logged-in user ── */
function authGetUser() {
  if (_authUser) return _authUser;
  var saved = localStorage.getItem('auth_user');
  if (saved) {
    try { _authUser = JSON.parse(saved); } catch(e) {}
  }
  return _authUser;
}

/* ── Is logged in? ── */
function authIsLoggedIn() {
  return !!authGetUser();
}

/* ── Sign up ── */
async function authSignUp(email, password, displayName, gender, recoveryWord) {
  email       = email.trim().toLowerCase();
  displayName = (displayName || '').trim();
  gender      = gender || 'Male';

  if (!email || !email.includes('@'))
    return { error: t('emailInvalid') };
  if (!displayName || displayName.length < 2)
    return { error: t('displayNameMin2') };
  try { displayName = scsRequireValidPlayerName(displayName); }
  catch (e) { return { error: e.message || t('invalidPlayerName') }; }
  if (!password || password.length < 6)
    return { error: t('passwordMin6') };
  if (!recoveryWord || recoveryWord.trim().length < 3)
    return { error: t('recoveryMin3') };

  // ── Real Supabase ──
  try {
    // Check email exists
    var existing = await sbGet('user_accounts', 'email=eq.' + encodeURIComponent(email) + '&select=id');
    if (existing && existing.length) return { error: t('emailAlreadyReg') };

    var result = await sbPost('user_accounts', {
      user_id:       email,
      nickname:      displayName,
      email:         email,
      gender:        gender,
      password_hash: password,
      recovery_word: (recoveryWord || '').trim().toLowerCase()
    });
    var u = result[0];

    // Also create player row
    await sbPost('players', {
      name:          displayName,
      gender:        gender,
      global_rating: 1.0,
      global_points: 0
    }).catch(() => {});

    var authUser = { id: u.id, email: u.email, nickname: u.nickname, displayName: u.nickname, gender: u.gender || gender };
    return { user: authUser };
  } catch(e) {
    var msg = e.message || '';
    if (msg.includes('duplicate') || msg.includes('already'))
      return { error: t('emailAlreadyReg') };
    return { error: t('signupFailed') };
  }
}

/* ── Login ── */
async function authLogin(email, password) {
  email = email.trim().toLowerCase();

  if (!email) return { error: t('enterEmail') };
  if (!password) return { error: t('enterPassword') };

  // Clear any stale local token before checking — ensures this device
  // is never mistaken for its own previous session during conflict check.
  _setLocalToken(null);

  // ── Real Supabase -- filter by email + password server-side ──
  try {
    var rows = await sbGet('user_accounts',
      'email=eq.' + encodeURIComponent(email) +
      '&password_hash=eq.' + encodeURIComponent(password) +
      '&select=id,nickname,email,gender');
    if (!rows || !rows.length) {
      // Check if email exists at all for better error message
      var exists = await sbGet('user_accounts', 'email=eq.' + encodeURIComponent(email) + '&select=id').catch(() => []);
      if (!exists || !exists.length) return { error: t('noAccountEmail') };
      return { error: t('wrongPasswordLogin') };
    }
    var u = rows[0];
    var authUser = { id: u.id, email: u.email, nickname: u.nickname, displayName: u.nickname, gender: u.gender || null };

    // ── Single-session check (fail-closed) ──
    var sessionCheck = await authCheckExistingSession(u.id);

    if (sessionCheck.networkError) {
      // Cannot reach server to verify — block login rather than allow silently
      return { error: 'Unable to verify session. Please check your connection and try again.' };
    }

    if (sessionCheck.hasSession) {
      // Another device is logged in — return conflict info for UI to show prompt
      return { conflict: true, user: authUser, deviceInfo: sessionCheck.deviceInfo };
    }

    // No conflict — create session
    var token = _generateSessionToken();
    await _writeServerSession(u.id, token);
    _setLocalToken(token);

    _authUser = authUser;
    localStorage.setItem('auth_user', JSON.stringify(authUser));
    if (typeof restoreUserClubRoles === 'function') await restoreUserClubRoles(authUser);
    return { user: authUser };
  } catch(e) {
    return { error: e.message || t('loginFailed') };
  }
}

/* ── Force login — displaces existing session on other device ── */
async function authForceLogin(authUser) {
  try {
    var token = _generateSessionToken();
    await _writeServerSession(authUser.id, token);
    _setLocalToken(token);
    _authUser = authUser;
    localStorage.setItem('auth_user', JSON.stringify(authUser));
    if (typeof restoreUserClubRoles === 'function') await restoreUserClubRoles(authUser);
    return { user: authUser };
  } catch(e) {
    return { error: e.message || 'Failed to establish session' };
  }
}

/* ── Reset Password via recovery word ── */
async function authResetPassword(email, recoveryWord, newPassword) {
  email        = email.trim().toLowerCase();
  recoveryWord = recoveryWord.trim().toLowerCase();

  if (!email || !email.includes('@')) return { error: t('enterEmail') };
  if (!recoveryWord) return { error: t('enterRecovery') };
  if (!newPassword || newPassword.length < 6) return { error: t('passwordMin6') };

  try {
    var rows = await sbGet('user_accounts',
      'email=eq.' + encodeURIComponent(email) +
      '&recovery_word=eq.' + encodeURIComponent(recoveryWord) +
      '&select=id');
    if (!rows || !rows.length) return { error: t('emailRecoveryWrong') };

    var targetId = rows[0].id;
    await sbPatch('user_accounts', 'id=eq.' + targetId, { password_hash: newPassword });
    // Invalidate any active session for this user — forces re-login on all devices
    await _deleteServerSession(targetId).catch(function(){});
    return { success: true };
  } catch(e) {
    return { error: e.message || t('resetFailed') };
  }
}

/* ── Claim Account -- player already registered by admin ── */
async function authClaimAccount(clubId, nickname, defaultPassword, email, newPassword, recoveryWord) {
  try {
    // 1. Find membership by club + nickname
    var memberships = await sbGet('memberships',
      'club_id=eq.' + clubId + '&nickname=ilike.' + nickname + '&select=id,player_id,user_account_id'
    );
    if (!memberships || !memberships.length)
      return { error: t('nicknameNotFound') };

    var membership = memberships[0];

    // 2. Already claimed?
    if (membership.user_account_id)
      return { error: t('alreadyClaimed') };

    // 3. Verify default password on player row
    var players = await sbGet('players',
      'id=eq.' + membership.player_id + '&default_password=eq.' + encodeURIComponent(defaultPassword) + '&select=id'
    );
    if (!players || !players.length)
      return { error: t('defaultPwWrong') };

    // 4. Check email not already used
    var existing = await sbGet('user_accounts', 'email=eq.' + encodeURIComponent(email) + '&select=id');
    if (existing && existing.length)
      return { error: t('emailAlreadyUsed') };

    // 5. Create user_account
    var result = await sbPost('user_accounts', {
      user_id:       email,
      nickname:      nickname,
      email:         email,
      password_hash: newPassword,
      recovery_word: recoveryWord
    });
    var u = result[0];

    // 6. Link THIS membership to user_account
    await sbPatch('memberships', 'id=eq.' + membership.id, { user_account_id: u.id });

    // 7. Also link any other clubs where same nickname is unlinked
    try {
      var otherMemberships = await sbGet('memberships',
        'nickname=ilike.' + encodeURIComponent(nickname) + '&user_account_id=is.null&select=id');
      for (var i = 0; i < (otherMemberships || []).length; i++) {
        await sbPatch('memberships', 'id=eq.' + otherMemberships[i].id, { user_account_id: u.id }).catch(function(){});
      }
    } catch(e) { /* silent */ }

    var authUser = { id: u.id, email: u.email, nickname: u.nickname, displayName: u.nickname };
    var token = _generateSessionToken();
    await _writeServerSession(u.id, token);
    _setLocalToken(token);
    _authUser = authUser;
    localStorage.setItem('auth_user', JSON.stringify(authUser));
    return { user: authUser };

  } catch(e) {
    return { error: e.message || t('claimFailed') };
  }
}

/* ── Logout ── */
function authLogout() {
  var user = _authUser || authGetUser();
  _stopSessionWatch();
  if (user && user.id) {
    _deleteServerSession(user.id).catch(function(){});
  }
  _authUser = null;
  _setLocalToken(null);
  localStorage.removeItem('auth_user');
  localStorage.removeItem('kbrr_my_club_id');
  localStorage.removeItem('kbrr_my_club_name');
  localStorage.removeItem('kbrr_my_player');
  localStorage.removeItem('kbrr_app_mode');
  localStorage.removeItem('scs_demo_mode');
  if (typeof _demoClear === 'function') _demoClear();
  localStorage.removeItem('scs_organiser_verified');
  localStorage.removeItem('scs_vault_verified');
  sessionStorage.removeItem('scs_organiser_verified');
  sessionStorage.removeItem('scs_vault_verified');
  if (typeof clearSubscription === 'function') clearSubscription();
}

/* ── Forgot password -- send OTP ── */
async function authForgotSendOtp(email) {
  email = email.trim().toLowerCase();
  if (!email || !email.includes('@')) return { error: t('emailInvalid') };

  if (AUTH_MOCK_MODE) {
    var user = _mockUsers.find(function(u) { return u.email === email; });
    if (!user) return { error: t('noAccountEmail') };
    var otp = Math.floor(100000 + Math.random() * 900000).toString();
    localStorage.setItem('mock_forgot_otp', JSON.stringify({ email: email, otp: otp, ts: Date.now() }));
    console.log('MOCK OTP for ' + email + ': ' + otp); // shown in console for testing
    return { success: true, message: 'OTP sent (check console for mock OTP)' };
  }

  // Real: call edge function or email service
  return { error: 'Email service not configured yet' };
}

/* ── Forgot password -- verify OTP and reset ── */
async function authForgotVerify(email, otp, newPassword) {
  email = email.trim().toLowerCase();
  if (!newPassword || newPassword.length < 6)
    return { error: t('passwordMin6') };

  if (AUTH_MOCK_MODE) {
    var saved = JSON.parse(localStorage.getItem('mock_forgot_otp') || 'null');
    if (!saved || saved.email !== email || saved.otp !== otp)
      return { error: t('invalidOTP') };
    if (Date.now() - saved.ts > 10 * 60 * 1000)
      return { error: t('otpExpired') };

    var user = _mockUsers.find(function(u) { return u.email === email; });
    if (!user) return { error: t('accountNotFound') };
    user.password = newPassword;
    _saveMockUsers();
    localStorage.removeItem('mock_forgot_otp');
    return { success: true };
  }

  return { error: 'Not implemented yet' };
}

/* ── Join club by invite code ── */
async function authJoinClub(inviteCode) {
  var user = authGetUser();
  if (!user) return { error: t('pleaseLoginFirst') };

  inviteCode = inviteCode.trim().toUpperCase();
  if (!inviteCode) return { error: 'Please enter an invite code' };

  if (AUTH_MOCK_MODE) {
    // Find club with this invite code from existing clubs
    var clubs = JSON.parse(localStorage.getItem('mock_clubs') || '[]');
    var club = clubs.find(function(c) { return c.inviteCode === inviteCode; });
    if (!club) return { error: t('invalidInviteCode') };

    // Check already member
    var already = _mockClubMembers.find(function(m) {
      return m.clubId === club.id && m.userId === user.id;
    });
    if (already) {
      // Already member -- just set as active club
      setMyClub(club.id, club.name);
      return { success: true, club: club };
    }

    _mockClubMembers.push({ clubId: club.id, userId: user.id, joinedAt: new Date().toISOString() });
    _saveMockMembers();
    setMyClub(club.id, club.name);
    return { success: true, club: club };
  }

  // ── Real Supabase ──
  try {
    var clubRows = await sbGet('clubs', 'invite_code=eq.' + encodeURIComponent(inviteCode) + '&select=id,name');
    if (!clubRows || !clubRows.length) return { error: 'Invalid invite code.' };
    var club = clubRows[0];

    // Club membership is tracked via players.club_id -- no separate club_members insert needed
    setMyClub(club.id, club.name);
    return { success: true, club: { id: club.id, name: club.name } };
  } catch(e) {
    return { error: e.message || t('failedToJoinClub') };
  }
}

/* ── Auto-join from deep link invite code ── */
function authHandleInviteLink() {
  // Check URL for invite code: ?invite=XXXXX or #invite=XXXXX
  var params = new URLSearchParams(window.location.search);
  var code = params.get('invite') || params.get('code');
  var joinClubId = params.get('join');
  if (joinClubId) {
    joinClubId = joinClubId.trim();
    sessionStorage.setItem('pending_join_club_id', joinClubId);
    // Social sign-in can leave this tab before returning. Keep the invite
    // across that round trip, then remove it when the join page is opened.
    localStorage.setItem('scs_pending_join_club_id', joinClubId);
  } else if (!sessionStorage.getItem('pending_join_club_id')) {
    var savedJoinClubId = localStorage.getItem('scs_pending_join_club_id');
    if (savedJoinClubId) sessionStorage.setItem('pending_join_club_id', savedJoinClubId);
  }
  if (code) {
    sessionStorage.setItem('pending_invite_code', code.trim().toUpperCase());
    localStorage.removeItem('pending_invite_code');
  } else {
    // Remove the old persistent flag that caused Find Club to reopen forever.
    sessionStorage.removeItem('pending_invite_code');
    localStorage.removeItem('pending_invite_code');
  }
}

function authGetPendingJoinClubId() {
  return sessionStorage.getItem('pending_join_club_id') ||
    localStorage.getItem('scs_pending_join_club_id') || null;
}

function authClearPendingJoinClub() {
  sessionStorage.removeItem('pending_join_club_id');
  localStorage.removeItem('scs_pending_join_club_id');
}

/* ── Get pending invite code ── */
function authGetPendingInvite() {
  return sessionStorage.getItem('pending_invite_code') || null;
}

/* ── Clear pending invite ── */
function authClearPendingInvite() {
  sessionStorage.removeItem('pending_invite_code');
  localStorage.removeItem('pending_invite_code');
}

/* ── Search clubs by name ── */
async function authSearchClubs(query) {
  query = query.trim();
  if (!query || (query.length < 2 && query !== '*')) return { clubs: [] };

  try {
    // '*' means show all clubs
    var pattern = query === '*' ? '%' : '%' + query + '%';
    var rows = await sbGet('clubs',
      'name=ilike.' + encodeURIComponent(pattern) + '&select=id,name&order=name.asc&limit=50');
    return { clubs: rows || [] };
  } catch(e) {
    return { error: e.message || t('searchFailed2') };
  }
}

/* ── Request to join a club ── */
async function authRequestJoin(clubId, chosenNickname, requestedRating) {
  var user = authGetUser();
  if (!user) return { error: t('pleaseLoginFirst') };

  // Use chosen nickname or fall back to account nickname
  var nickname = (chosenNickname || user.nickname || '').trim();
  if (!nickname) return { error: t('provideNickname') };

  try {
    // Check if already a member (by user_account_id)
    var members = await sbGet('memberships',
      'club_id=eq.' + clubId + '&user_account_id=eq.' + user.id + '&select=player_id');
    if (members && members.length) {
      var club = await sbGet('clubs', 'id=eq.' + clubId + '&select=id,name');
      if (club && club.length) setMyClub(club[0].id, club[0].name);
      return { alreadyMember: true };
    }

    // Check if already requested
    var existing = await sbGet('club_join_requests',
      'club_id=eq.' + clubId + '&user_account_id=eq.' + user.id);
    if (existing && existing.length) {
      var req = existing[0];
      if (req.status === 'pending') return { pending: true, nickname: req.nickname };
      if (req.status === 'rejected') return { error: 'Your request was rejected by the admin.' };
      // Previously rejected -- allow re-request with new nickname, delete old row
      await sbDelete('club_join_requests', 'club_id=eq.' + clubId + '&user_account_id=eq.' + user.id);
    }

    // Check nickname conflict in this club
    var conflict = await sbGet('memberships',
      'club_id=eq.' + clubId + '&nickname=ilike.' + nickname + '&select=id,player_id,user_account_id');
    if (conflict && conflict.length) {
      var cm = conflict[0];
      // If unclaimed -- ask for default password to verify identity
      if (!cm.user_account_id) {
        return { needsPassword: true, conflictNickname: nickname, membershipId: cm.id, playerId: cm.player_id };
      }
      // Claimed by THIS user -- auto-join
      if (String(cm.user_account_id) === String(user.id)) {
        var clubInfo2 = await sbGet('clubs', 'id=eq.' + clubId + '&select=id,name').catch(function(){ return []; });
        var cname2 = (clubInfo2 && clubInfo2.length) ? clubInfo2[0].name : '';
        if (typeof setMyClub === 'function') setMyClub(clubId, cname2);
        return { alreadyMember: true };
      }
      // Claimed by someone else -- truly taken
      return { nicknameConflict: true, conflictNickname: nickname };
    }

    // Create request with chosen nickname
    var requestPayload = {
      club_id:         clubId,
      user_account_id: user.id,
      nickname:        nickname,
      status:          'pending',
      requested_rating: (Number(requestedRating) >= 1 && Number(requestedRating) <= 5) ? Math.round(Number(requestedRating) * 10) / 10 : 1.0
    };
    await sbPost('club_join_requests', requestPayload);
    return { success: true, nickname: nickname };
  } catch(e) {
    return { error: e.message || t('failedSendRequest') };
  }
}

/* ── Claim existing player record by verifying default password ── */
async function authClaimAndJoin(clubId, nickname, defaultPassword) {
  var user = authGetUser();
  if (!user) return { error: t('pleaseLoginFirst') };

  try {
    // Find membership
    var memberships = await sbGet('memberships',
      'club_id=eq.' + clubId + '&nickname=ilike.' + nickname + '&select=id,player_id,user_account_id'
    );
    if (!memberships || !memberships.length)
      return { error: t('nicknameNotFound') };

    var membership = memberships[0];

    // Already claimed by someone else?
    if (membership.user_account_id && membership.user_account_id !== user.id)
      return { error: t('alreadyClaimed') };

    // Verify default password on player row
    var players = await sbGet('players',
      'id=eq.' + membership.player_id + '&default_password=eq.' + encodeURIComponent(defaultPassword) + '&select=id'
    );
    if (!players || !players.length)
      return { error: t('defaultPwWrong') };

    // Link membership to logged-in user
    await sbPatch('memberships', 'id=eq.' + membership.id, { user_account_id: user.id });

    // Also link any other clubs with same unclaimed nickname
    var others = await sbGet('memberships',
      'nickname=ilike.' + encodeURIComponent(nickname) + '&user_account_id=is.null&select=id'
    ).catch(function(){ return []; });
    for (var i = 0; i < others.length; i++) {
      await sbPatch('memberships', 'id=eq.' + others[i].id, { user_account_id: user.id }).catch(function(){});
    }

    // Update players table
    await sbPatch('players',
      'club_id=eq.' + clubId + '&name=ilike.' + encodeURIComponent(nickname),
      { user_account_id: user.id }
    ).catch(function(){});

    // Get club name
    var clubInfo = await sbGet('clubs', 'id=eq.' + clubId + '&select=id,name').catch(function(){ return []; });
    var cname = (clubInfo && clubInfo.length) ? clubInfo[0].name : '';
    return { success: true, clubId: clubId, clubName: cname, nickname: nickname };

  } catch(e) {
    return { error: e.message || t('claimFailed') };
  }
}

/* ── Get pending join requests for a club (admin) ── */
async function authGetJoinRequests(clubId) {
  try {
    // Fetch nickname from club_join_requests (the name they chose when requesting to join)
    var requests = await sbGet('club_join_requests',
      'club_id=eq.' + clubId + '&status=eq.pending&select=id,user_account_id,nickname,requested_rating,requested_at');

    var result = [];
    for (var i = 0; i < requests.length; i++) {
      var req = requests[i];
      try {
        var users = await sbGet('user_accounts',
          'id=eq.' + req.user_account_id + '&select=id,email');
        if (users && users.length) {
          result.push({
            requestId:     req.id,
            requestedAt:   req.requested_at,
            userAccountId: req.user_account_id,
            nickname:      req.nickname,
            requestedRating:req.requested_rating,
            email:         users[0].email
          });
        }
      } catch(e) {}
    }
    return { requests: result };
  } catch(e) {
    return { error: e.message || t('failedLoadRequests2') };
  }
}

/* ── Accept join request (admin) ── */
async function authAcceptRequest(requestId, clubId, userAccountId, nickname, gender, requestedRating) {
  try {
    nickname = scsRequireValidPlayerName(nickname);
    var resolvedGender = ['Male', 'Female'].includes(gender) ? gender : null;
    var resolvedRating = Number(requestedRating);
    if (!(resolvedRating >= 1 && resolvedRating <= 5)) {
      var requestRows = await sbGet('club_join_requests',
        'id=eq.' + requestId + '&select=requested_rating').catch(function(){ return []; });
      resolvedRating = Number(requestRows && requestRows[0] && requestRows[0].requested_rating);
    }
    if (!(resolvedRating >= 1 && resolvedRating <= 5)) resolvedRating = 1.0;
    resolvedRating = Math.round(resolvedRating * 10) / 10;
    if (!resolvedGender) {
      var accountRows = await sbGet('user_accounts',
        'id=eq.' + userAccountId + '&select=gender').catch(function(){ return []; });
      resolvedGender = accountRows && accountRows[0] && ['Male', 'Female'].includes(accountRows[0].gender)
        ? accountRows[0].gender : 'Male';
    }

    // Update request status
    await sbPatch('club_join_requests', 'id=eq.' + requestId, {
      status:      'accepted',
      reviewed_at: new Date().toISOString()
    });

    // Find existing membership by club + nickname and link user_account
    var memberships = await sbGet('memberships',
      'club_id=eq.' + clubId + '&nickname=ilike.' + encodeURIComponent(nickname) + '&select=id,player_id'
    );

    if (memberships && memberships.length) {
      // Link existing membership to user account
      await sbPatch('memberships', 'id=eq.' + memberships[0].id, { user_account_id: userAccountId, club_rating: resolvedRating });
      if (memberships[0].player_id) {
        await sbPatch('players', 'id=eq.' + memberships[0].player_id, { user_account_id: userAccountId }).catch(function(){});
      }
    } else {
      // Create player + membership (player not pre-registered)
      // Match dbAddPlayer pattern -- players table has no club_id or user_account_id
      var created = await sbPost('players', {
        name:          nickname,
        gender:        resolvedGender,
        global_rating: resolvedRating,
        global_points: 0
      });
      await sbPost('memberships', {
        player_id:       created[0].id,
        club_id:         clubId,
        nickname:        nickname,
        club_rating:     resolvedRating,
        club_points:     0,
        user_account_id: userAccountId
      });
      await sbPatch('players', 'id=eq.' + created[0].id, { user_account_id: userAccountId }).catch(function(){});
    }

    return { success: true };
  } catch(e) {
    return { error: e.message || t('failedAcceptRequest') };
  }
}

/* ── Reject join request (admin) ── */
async function authRejectRequest(requestId) {
  try {
    await sbPatch('club_join_requests', 'id=eq.' + requestId, {
      status:      'rejected',
      reviewed_at: new Date().toISOString()
    });
    return { success: true };
  } catch(e) {
    return { error: e.message || t('failedRejectRequest') };
  }
}

/* ── Check my request status ── */
async function authCheckRequestStatus(clubId) {
  var user = authGetUser();
  if (!user) return { status: 'none' };

  try {
    var rows = await sbGet('club_join_requests',
      'club_id=eq.' + clubId + '&user_account_id=eq.' + user.id + '&select=status');
    if (!rows || !rows.length) return { status: 'none' };
    return { status: rows[0].status };
  } catch(e) {
    return { status: 'none' };
  }
}

// Check for invite link on load
authHandleInviteLink();

/* ============================================================
   OTP VERIFICATION -- via Supabase Edge Functions + Resend
   ============================================================ */

/* Send OTP to email — via Cloudflare Worker (keys hidden server-side) */
async function authSendOtp(email) {
  try {
    const res = await fetch(WORKER_URL + '/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.toLowerCase().trim() })
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to send OTP' };
    return { success: true };
  } catch(e) {
    return { error: 'Network error: ' + e.message };
  }
}

/* Verify OTP entered by user — via Cloudflare Worker */
async function authVerifyOtp(email, otp) {
  try {
    const res = await fetch(WORKER_URL + '/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.toLowerCase().trim(), otp: otp.trim() })
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || t('invalidOTP') };
    return { success: true };
  } catch(e) {
    return { error: 'Network error: ' + e.message };
  }
}

/* ── Silent background sync -- link players rows on every login ──
   Finds all memberships for this user → finds matching players rows
   where user_account_id is null → patches them
   Runs silently on every login so existing members get linked too */
async function authSyncPlayerLinks(user) {
  try {
    if (!user || !user.id) return;

    // Step 1: Find unlinked memberships matching this user's nickname
    var unlinked = await sbGet('memberships',
      'user_account_id=is.null&select=id,player_id,nickname'
    ).catch(function(){ return []; });

    if (!unlinked || !unlinked.length) return;

    // Step 2: Get this user's nicknames from their linked memberships
    var myMemberships = await sbGet('memberships',
      'user_account_id=eq.' + user.id + '&select=nickname'
    ).catch(function(){ return []; });

    if (!myMemberships || !myMemberships.length) return;

    var myNicknames = myMemberships.map(function(m){ return (m.nickname || '').toLowerCase(); });

    // Step 3: Link matching unlinked memberships and their players
    for (var i = 0; i < unlinked.length; i++) {
      var m = unlinked[i];
      if (!m.nickname || !myNicknames.includes(m.nickname.toLowerCase())) continue;

      // Link membership
      await sbPatch('memberships', 'id=eq.' + m.id,
        { user_account_id: user.id }
      ).catch(function(){});

      // Link player row if exists
      if (m.player_id) {
        await sbPatch('players', 'id=eq.' + m.player_id + '&user_account_id=is.null',
          { user_account_id: user.id }
        ).catch(function(){});
      }
    }
  } catch(e) {
    // Silent -- never block login
  }
}
