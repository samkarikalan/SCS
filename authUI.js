/* ============================================================
   authUI.js
   UI functions for auth screens
   ============================================================ */

/* ── Show auth overlay and a specific screen ── */
function authShowScreen(screen) {
  var overlay = document.getElementById('authOverlay');
  if (!overlay) return;
  overlay.style.display = 'flex';

  // Hide all screens
  ['authWelcome','authLogin','authSignup','authForgot','authJoinClub'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // Hide home + mode select
  var homeEl = document.getElementById('homePageOverlay');
  if (homeEl) homeEl.style.display = 'none';
  var modeEl = document.getElementById('modeSelectOverlay');
  if (modeEl) modeEl.style.display = 'none';

  // Show requested screen
  var screenMap = {
    'welcome':  'authWelcome',
    'login':    'authLogin',
    'signup':   'authSignup',
    'forgot':   'authForgot',
    'claim':    'authClaim',
    'joinClub': 'authJoinClub'
  };
  var el = document.getElementById(screenMap[screen]);
  if (el) el.style.display = 'flex';

  // Load clubs for claim dropdown
  if (screen === 'claim') authLoadClaimClubs();

  // Clear errors
  ['loginError','signupError','forgotError','forgotError2','claimError','joinClubError'].forEach(function(id) {
    var err = document.getElementById(id);
    if (err) { err.style.display = 'none'; err.textContent = ''; }
  });
}

function authToggleOtherMethods() {
  var button = document.getElementById('authOtherMethodBtn');
  var panel = document.getElementById('authOtherMethods');
  var chevron = document.getElementById('authOtherMethodChevron');
  if (!button || !panel) return;
  var willOpen = button.getAttribute('aria-expanded') !== 'true';
  button.setAttribute('aria-expanded', String(willOpen));
  panel.hidden = !willOpen;
  panel.classList.toggle('is-open', willOpen);
  if (chevron) chevron.textContent = willOpen ? '⌃' : '⌄';
}

/* ── Hide auth overlay ── */
function authHideOverlay() {
  var overlay = document.getElementById('authOverlay');
  if (overlay) overlay.style.display = 'none';
}

function authSyncHeaderTheme() {
  var button = document.getElementById('authHeaderThemeToggle');
  if (button) button.textContent = document.documentElement.classList.contains('app-light') || document.body.classList.contains('app-light') ? '☀️' : '🌙';
}

function authHeaderToggleLanguage(event) {
  if (event) event.stopPropagation();
  var picker = document.getElementById('authHeaderLanguagePicker');
  if (!picker) return;
  picker.hidden = !picker.hidden;
}

function authHeaderSelectLanguage(code, flag, label) {
  if (typeof mlSelectLang === 'function') mlSelectLang(code, flag, label);
  else if (typeof setLanguage === 'function') setLanguage(code);
  var picker = document.getElementById('authHeaderLanguagePicker');
  if (picker) picker.hidden = true;
}

function authOpenSettingsFromHeader() {
  var visible = ['welcome','login','signup','forgot','claim','joinClub'].find(function(name) {
    var ids = {welcome:'authWelcome',login:'authLogin',signup:'authSignup',forgot:'authForgot',claim:'authClaim',joinClub:'authJoinClub'};
    var node = document.getElementById(ids[name]);
    return node && getComputedStyle(node).display !== 'none';
  }) || 'welcome';
  window.__scsAuthSettingsReturnScreen = visible;
  authHideOverlay();
  if (typeof showPage === 'function') showPage('settingsPage', document.getElementById('tabBtnSettings'));
  var settings = document.getElementById('settingsPage');
  var close = settings && settings.querySelector('.sheet-close-btn');
  if (close && !close.hasAttribute('data-auth-original-onclick')) {
    close.setAttribute('data-auth-original-onclick', close.getAttribute('onclick') || '');
  }
  if (close) {
    close.removeAttribute('onclick');
    close.onclick = function() {
      if (settings) settings.style.display = 'none';
      close.onclick = null;
      var original = close.getAttribute('data-auth-original-onclick');
      if (original) close.setAttribute('onclick', original);
      close.removeAttribute('data-auth-original-onclick');
      authShowScreen(window.__scsAuthSettingsReturnScreen || 'welcome');
    };
  }
}


function authCloseSocialDeviceScreen() {
  var googleDevice = document.getElementById('scs-google-device-screen');
  if (googleDevice) googleDevice.remove();
  var lineDevice = document.getElementById('scs-line-device-screen');
  if (lineDevice) lineDevice.remove();
  sessionStorage.removeItem('scs_google_login_started');
  sessionStorage.removeItem('scs_line_login_started');
  authSetGoogleButtonsLoading(false);
  authSetLineButtonsLoading(false);
  var overlay = document.getElementById('authOverlay');
  if (overlay) overlay.style.display = 'flex';
  authShowScreen('welcome');
}

/* Close a cancelled Google/LINE/email login and return to the mode selector. */
function authCloseToModeSelection() {
  // A cancelled social login must never leave the user trapped on auth.
  sessionStorage.removeItem('scs_google_login_started');
  sessionStorage.removeItem('scs_line_login_started');
  sessionStorage.removeItem('scs_pending_workspace');

  var googleDevice = document.getElementById('scs-google-device-screen');
  if (googleDevice) googleDevice.remove();
  var lineDevice = document.getElementById('scs-line-device-screen');
  if (lineDevice) lineDevice.remove();

  authHideOverlay();
  var home = document.getElementById('homePageOverlay');
  if (home) home.style.display = 'none';
  document.querySelectorAll('.page').forEach(function(page) { page.style.display = 'none'; });
  var modeOverlay = document.getElementById('modeSelectOverlay');
  if (modeOverlay) { modeOverlay.classList.remove('scs-launch-first-paint'); modeOverlay.style.display = 'none'; }
  authShowScreen('welcome');
}

/* ── Show error ── */
function authShowError(id, msg) {
  var el = document.getElementById(id);
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

/* ── Show loading state on button ── */
function authSetLoading(btnSelector, loading) {
  var btn = document.querySelector(btnSelector);
  if (!btn) return;
  btn.disabled = loading;
  if (loading) {
    btn._origText = btn.textContent;
    btn.textContent = t('pleaseWait');
  } else {
    btn.textContent = btn._origText || btn.textContent;
  }
}

/* Google provider button is visual-only until OAuth credentials are connected. */
/* ── Do Login ── */
async function authDoLogin() {
  var email    = (document.getElementById('loginEmail')?.value || '').trim();
  var password = (document.getElementById('loginPassword')?.value || '');

  authSetLoading('#authLogin .auth-btn-primary', true);
  var result = await authLogin(email, password);
  authSetLoading('#authLogin .auth-btn-primary', false);

  if (result.error) {
    authShowError('loginError', result.error);
    return;
  }

  // Another device is logged in -- show conflict modal
  if (result.conflict) {
    authShowConflictModal(result.user, result.deviceInfo);
    return;
  }

  // Login success -- proceed (authAfterLogin starts session watch)
  if (typeof updateProfileBtn === 'function') updateProfileBtn();
  await authAfterLogin(result.user);
}

/* â”€â”€ LINE Login â”€â”€ */
var _lineHandoffTimer = null;
var _lineHandoffPolling = false;

function authIsIOSStandalone() {
  return navigator.standalone === true ||
    (window.matchMedia && (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches
    ));
}

function authLineRandomHex(bytes) {
  var data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data).map(function(value) {
    return value.toString(16).padStart(2, '0');
  }).join('');
}

function authLineDeviceCode() {
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var random = new Uint8Array(8);
  crypto.getRandomValues(random);
  return Array.from(random).map(function(value) { return alphabet[value % alphabet.length]; }).join('');
}

function authCreateLineHandoff() {
  var id = crypto.randomUUID ? crypto.randomUUID() :
    authLineRandomHex(16).replace(/^(........)(....)(....)(....)(............)$/, '$1-$2-$3-$4-$5');
  return {
    id: id,
    verifier: authLineRandomHex(32),
    deviceCode: authLineDeviceCode(),
    expiresAt: Date.now() + 10 * 60 * 1000
  };
}

function authSetLineButtonsLoading(loading) {
  document.querySelectorAll('.auth-btn-line').forEach(function(button) {
    button.disabled = !!loading;
    button.classList.toggle('is-loading', !!loading);
  });
}

async function authStartLineLogin(button) {
  if (button) {
    button.disabled = true;
    button.classList.add('is-loading');
  }
  sessionStorage.setItem('scs_line_login_started', '1');
  if (authIsIOSStandalone()) {
    // Open the browser directly from the user's tap. Do not show an extra in-app handoff page.
    var loginWindow = window.open('about:blank', 'scs-line-login');
    var handoff = authCreateLineHandoff();
    localStorage.setItem('scs_line_handoff', JSON.stringify(handoff));
    try {
      var createResponse = await fetch(WORKER_URL + '/auth/line/handoff/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: handoff.id, verifier: handoff.verifier, deviceCode: handoff.deviceCode })
      }, 12000);
      if (!createResponse.ok) throw new Error('handoff_not_ready');
      var deviceUrl = WORKER_URL + '/auth/line/device?code=' + encodeURIComponent(handoff.deviceCode);
      authSetLineButtonsLoading(false);
      if (loginWindow && !loginWindow.closed) loginWindow.location.replace(deviceUrl);
      else window.location.assign(deviceUrl);
      authResumeLineHandoff(true);
    } catch (error) {
      if (loginWindow && !loginWindow.closed) loginWindow.close();
      localStorage.removeItem('scs_line_handoff');
      authSetLineButtonsLoading(false);
      authShowScreen('login');
      authShowError('loginError', authLineErrorMessage('handoff_not_ready'));
    }
    return;
  }
  window.location.assign(WORKER_URL + '/auth/line/start');
}

function authShowLineDeviceScreen(handoff) {
  var existing = document.getElementById('scs-line-device-screen');
  if (existing) existing.remove();
  var deviceUrl = WORKER_URL + '/auth/line/device?code=' + encodeURIComponent(handoff.deviceCode);
  var screen = document.createElement('div');
  screen.id = 'scs-line-device-screen';
  screen.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:var(--bg,#0f0f13);display:flex;align-items:center;justify-content:center;padding:calc(env(safe-area-inset-top) + 24px) 24px calc(env(safe-area-inset-bottom) + 24px);box-sizing:border-box;';
  screen.innerHTML = '<button class="auth-social-close-btn" type="button" aria-label="Close LINE login" onclick="authCloseSocialDeviceScreen()">✕</button><div style="max-width:360px;width:100%;text-align:center;">'
    + '<div aria-label="LINE" style="width:76px;height:76px;border-radius:22px;background:#06c755;display:flex;align-items:center;justify-content:center;margin:0 auto 28px;box-shadow:0 12px 28px rgba(6,199,85,.3);">'
    + '<div style="width:54px;height:40px;border-radius:50%;background:#fff;color:#06c755;display:flex;align-items:center;justify-content:center;position:relative;font-size:.87rem;font-weight:950;letter-spacing:-.04em;">LINE<span style="position:absolute;left:9px;bottom:-7px;width:0;height:0;border-top:11px solid #fff;border-right:11px solid transparent;transform:rotate(8deg);"></span></div>'
    + '</div>'
    + '<a id="scsLineDeviceOpen" href="' + deviceUrl + '" target="scs-line-login" rel="opener" style="display:block;text-decoration:none;text-align:center;padding:15px 18px;border-radius:14px;background:#06c755;color:#fff;font-size:1rem;font-weight:850;box-shadow:0 10px 28px rgba(6,199,85,.22);">' + (t('continueWithLine') || 'Continue with LINE') + '</a>'
    + '</div>';
  document.body.appendChild(screen);

  document.getElementById('scsLineDeviceOpen').onclick = function() {
    authResumeLineHandoff(true);
  };
}

function authLineErrorMessage(code) {
  var messages = {
    cancelled:          t('lineLoginCancelled') || 'LINE login was cancelled.',
    not_configured:     t('lineLoginNotConfigured') || 'LINE Login is not configured yet.',
    invalid_state:      t('lineLoginExpired') || 'LINE login expired. Please try again.',
    token_exchange_failed: t('lineLoginFailed') || 'LINE login failed. Please try again.',
    id_token_invalid:   t('lineLoginFailed') || 'LINE login failed. Please try again.',
    database_not_ready: t('lineLoginDatabaseNotReady') || 'LINE registration is not ready yet.',
    invalid_handoff:    t('lineLoginExpired') || 'LINE login expired. Please try again.',
    handoff_not_ready:  t('lineHandoffNotReady') || 'iPhone app login is not ready yet.',
    login_failed:       t('lineLoginFailed') || 'LINE login failed. Please try again.'
  };
  return messages[code] || messages.login_failed;
}

async function authCompleteLineLogin(ticket) {
  _setLocalToken(null);
  try {
    var response = await fetch(WORKER_URL + '/auth/line/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: ticket })
    });
    var data = await response.json().catch(function() { return {}; });
    if (!response.ok || !data.user) {
      return { error: data.error || authLineErrorMessage('login_failed') };
    }

    if (data.needsProfile || data.needsNickname) {
      sessionStorage.setItem('scs_line_nickname_ticket', ticket);
      if (data.user.nickname && data.user.nickname !== 'LINE Player') {
        sessionStorage.setItem('scs_line_suggested_name', data.user.nickname);
      }
      return { needsNickname: true, user: data.user, ticket: ticket };
    }

    return await authFinalizeLineUser(data.user);
  } catch (error) {
    return { error: authLineErrorMessage('login_failed') };
  }
}

async function authFinalizeLineUser(authUser) {
  try {
    var sessionCheck = await authCheckExistingSession(authUser.id);
    if (sessionCheck.networkError) {
      return { error: 'Unable to verify session. Please check your connection and try again.' };
    }
    if (sessionCheck.hasSession) {
      return { conflict: true, user: authUser, deviceInfo: sessionCheck.deviceInfo };
    }

    var token = _generateSessionToken();
    await _writeServerSession(authUser.id, token);
    _setLocalToken(token);
    _authUser = authUser;
    localStorage.setItem('auth_user', JSON.stringify(authUser));
    if (typeof restoreUserClubRoles === 'function') await restoreUserClubRoles(authUser);
    return { user: authUser };
  } catch (error) {
    return { error: authLineErrorMessage('login_failed') };
  }
}

function authShowLineNicknameScreen(ticket) {
  var deviceScreen = document.getElementById('scs-line-device-screen');
  if (deviceScreen) deviceScreen.remove();
  var existing = document.getElementById('scs-line-nickname-screen');
  if (existing) existing.remove();

  var screen = document.createElement('div');
  screen.id = 'scs-line-nickname-screen';
  screen.style.cssText = 'position:fixed;inset:0;z-index:2147483647;overflow-y:auto;background:radial-gradient(circle at 50% 8%,rgba(98,78,255,.12),transparent 30%),var(--bg,#0f0f13);padding:24px 22px;box-sizing:border-box;';
  screen.innerHTML = '<div style="width:min(100%,430px);min-height:calc(100dvh - 48px);margin:0 auto;display:flex;flex-direction:column;justify-content:center;">'
    + '<div class="auth-welcome-brand" style="margin:0 0 30px;"><h1>' + (t('welcomeTitle') || 'Welcome to SCS') + '</h1><p>' + (t('welcomeSubtitle') || 'Your all-in-one platform for players, organisers and club managers.') + '</p></div>'
    + '<div style="width:100%;box-sizing:border-box;padding:28px 22px;border-radius:22px;background:var(--surface,#1b1c25);border:1px solid var(--border,#343645);box-shadow:0 18px 50px rgba(0,0,0,.28);">'
    + '<div style="width:54px;height:54px;border-radius:16px;background:#06c755;color:#fff;display:flex;align-items:center;justify-content:center;margin:0 auto 15px;font-size:1.55rem;font-weight:900;">L</div>'
    + '<div style="font-size:1.18rem;font-weight:850;color:var(--text,#fff);text-align:center;margin-bottom:7px;">' + (t('completePlayerProfile') || 'Complete your player profile') + '</div>'
    + '<div style="font-size:.84rem;color:var(--muted,#aaa);text-align:center;line-height:1.5;margin-bottom:20px;">' + (t('socialProfileHint') || 'Choose the name and gender shown in SCS.') + '</div>'
    + '<label for="scsLineNicknameInput" style="display:block;margin:0 2px 7px;color:var(--muted,#aaa);font-size:.75rem;font-weight:800;text-transform:uppercase;">' + (t('displayName') || 'Display Name') + '</label>'
    + '<input id="scsLineNicknameInput" type="text" maxlength="40" autocomplete="nickname" placeholder="' + (t('playerNickname') || 'Player nickname') + '" style="width:100%;box-sizing:border-box;padding:13px 14px;border-radius:12px;border:1px solid var(--border,#343645);background:var(--surface2,#242631);color:var(--text,#fff);font:inherit;font-size:1rem;outline:none;">'
    + '<label for="scsLineGenderInput" style="display:block;margin:14px 2px 7px;color:var(--muted,#aaa);font-size:.75rem;font-weight:800;text-transform:uppercase;">' + (t('gender') || 'Gender') + '</label>'
    + '<select id="scsLineGenderInput" style="width:100%;box-sizing:border-box;padding:13px 14px;border-radius:12px;border:1px solid var(--border,#343645);background:var(--surface2,#242631);color:var(--text,#fff);font:inherit;font-size:1rem;outline:none;"><option value="">' + (t('selectGender') || 'Select gender') + '</option><option value="Male">' + (t('genderMale') || 'Men') + '</option><option value="Female">' + (t('genderFemale') || 'Ladies') + '</option></select>'
    + '<div id="scsLineNicknameError" style="display:none;color:#ef476f;font-size:.8rem;margin:8px 2px 0;"></div>'
    + '<button id="scsLineNicknameSave" type="button" style="width:100%;margin-top:16px;padding:14px;border:0;border-radius:13px;background:#06c755;color:#fff;font:inherit;font-weight:850;font-size:.96rem;">' + (t('continueBtn') || 'Continue') + '</button>'
    + '<button id="scsLineNicknameCancel" type="button" style="width:100%;margin-top:9px;padding:11px;border:0;background:transparent;color:var(--muted,#aaa);font:inherit;font-size:.86rem;">' + (t('cancel') || 'Cancel') + '</button>'
    + '</div></div>';
  document.body.appendChild(screen);

  var input = document.getElementById('scsLineNicknameInput');
  var genderInput = document.getElementById('scsLineGenderInput');
  var save = document.getElementById('scsLineNicknameSave');
  var errorEl = document.getElementById('scsLineNicknameError');
  input.value = sessionStorage.getItem('scs_line_suggested_name') || '';
  setTimeout(function() { input.focus(); }, 100);

  async function submitNickname() {
    var nickname = input.value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
    if (!nickname) {
      errorEl.textContent = t('playerNicknameRequired') || 'Please enter your player nickname.';
      errorEl.style.display = 'block';
      return;
    }
    var gender = genderInput.value;
    if (!gender) {
      errorEl.textContent = t('genderRequired') || 'Please select your gender.';
      errorEl.style.display = 'block';
      return;
    }
    save.disabled = true;
    save.textContent = t('saving') || 'Saving…';
    errorEl.style.display = 'none';
    try {
      var response = await fetch(WORKER_URL + '/auth/line/nickname', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket: ticket, nickname: nickname, gender: gender })
      });
      var data = await response.json().catch(function() { return {}; });
      if (!response.ok || !data.user) throw new Error(data.error || authLineErrorMessage('login_failed'));
      var result = await authFinalizeLineUser(data.user);
      sessionStorage.removeItem('scs_line_nickname_ticket');
      sessionStorage.removeItem('scs_line_suggested_name');
      screen.remove();
      authFinishLineHandoff(result);
    } catch (error) {
      save.disabled = false;
      save.textContent = t('continueBtn') || 'Continue';
      errorEl.textContent = error.message || authLineErrorMessage('login_failed');
      errorEl.style.display = 'block';
    }
  }

  save.onclick = submitNickname;
  document.getElementById('scsLineNicknameCancel').onclick = function() {
    sessionStorage.removeItem('scs_line_nickname_ticket');
    sessionStorage.removeItem('scs_line_suggested_name');
    screen.remove();
    authShowScreen('login');
  };
  input.addEventListener('keydown', function(event) {
    if (event.key === 'Enter') submitNickname();
  });
}

function authOpenNicknameEditor() {
  var user = (typeof authGetUser === 'function') ? authGetUser() : null;
  if (!user) {
    authShowScreen('login');
    return;
  }
  var existing = document.getElementById('scs-nickname-editor');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'scs-nickname-editor';
  modal.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center;padding:22px;box-sizing:border-box;backdrop-filter:blur(5px);';
  modal.innerHTML = '<div class="scs-nickname-editor-card" style="position:relative;max-width:350px;width:100%;padding:25px 22px;border-radius:20px;background:var(--surface,#1b1c25);border:1px solid var(--border,#343645);box-shadow:0 18px 50px rgba(0,0,0,.32);">'
    + '<button id="scsNicknameEditorClose" class="scs-popup-close-btn scs-nickname-editor-close" type="button" aria-label="Close">✕</button>'
    + '<div style="font-size:1.12rem;font-weight:850;color:var(--text,#fff);margin:0 48px 7px 0;">' + (t('changeNickname') || 'Change nickname') + '</div>'
    + '<div style="font-size:.82rem;color:var(--muted,#aaa);line-height:1.45;margin-bottom:17px;">' + (t('nicknameChangeHint') || 'This changes your display name only. Club memberships and match history are not affected.') + '</div>'
    + '<input id="scsNicknameEditInput" type="text" maxlength="40" autocomplete="nickname" style="width:100%;box-sizing:border-box;padding:13px 14px;border-radius:12px;border:1px solid var(--border,#343645);background:var(--surface2,#242631);color:var(--text,#fff);font:inherit;font-size:1rem;outline:none;">'
    + '<div id="scsNicknameEditError" style="display:none;color:#ef476f;font-size:.8rem;margin:8px 2px 0;"></div>'
    + '<div style="display:flex;gap:10px;margin-top:17px;">'
    + '<button id="scsNicknameEditCancel" type="button" style="flex:1;padding:12px;border-radius:12px;border:1px solid var(--border,#343645);background:transparent;color:var(--text,#fff);font:inherit;font-weight:700;">' + (t('cancel') || 'Cancel') + '</button>'
    + '<button id="scsNicknameEditSave" type="button" style="flex:1;padding:12px;border:0;border-radius:12px;background:var(--accent,#7766ff);color:#fff;font:inherit;font-weight:800;">' + (t('save') || 'Save') + '</button>'
    + '</div></div>';
  document.body.appendChild(modal);

  var input = document.getElementById('scsNicknameEditInput');
  var save = document.getElementById('scsNicknameEditSave');
  var errorEl = document.getElementById('scsNicknameEditError');
  input.value = user.nickname || '';
  setTimeout(function() { input.focus(); input.select(); }, 80);

  function closeEditor() { modal.remove(); }
  document.getElementById('scsNicknameEditCancel').onclick = closeEditor;
  document.getElementById('scsNicknameEditorClose').onclick = closeEditor;
  modal.addEventListener('click', function(event) { if (event.target === modal) closeEditor(); });

  async function saveNickname() {
    var nickname = input.value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
    if (!nickname) {
      errorEl.textContent = t('playerNicknameRequired') || 'Please enter your player nickname.';
      errorEl.style.display = 'block';
      return;
    }
    save.disabled = true;
    save.textContent = t('saving') || 'Saving…';
    errorEl.style.display = 'none';
    try {
      var response = await fetch(WORKER_URL + '/auth/nickname', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          sessionToken: (typeof _getLocalToken === 'function') ? _getLocalToken() : '',
          nickname: nickname
        })
      });
      var data = await response.json().catch(function() { return {}; });
      if (!response.ok || !data.user) throw new Error(data.error || authLineErrorMessage('login_failed'));

      _authUser = Object.assign({}, user, data.user);
      localStorage.setItem('auth_user', JSON.stringify(_authUser));
      closeEditor();
      if (typeof renderMyCard === 'function') await renderMyCard();
      if (typeof updateProfileBtn === 'function') await updateProfileBtn();
      if (typeof updateModePill === 'function') updateModePill(localStorage.getItem('kbrr_app_mode') || 'viewer');
      if (typeof updateWelcomeWorkspaceClubNames === 'function') updateWelcomeWorkspaceClubNames();
      if (typeof showToast === 'function') showToast(t('nicknameUpdated') || 'Nickname updated.');
      if (typeof scsOpenGuidedFunctions === 'function' && document.getElementById('scsGuidedFunctions') && !document.getElementById('scsGuidedFunctions').hidden) scsOpenGuidedFunctions('viewer');
    } catch (error) {
      save.disabled = false;
      save.textContent = t('save') || 'Save';
      errorEl.textContent = error.message || authLineErrorMessage('login_failed');
      errorEl.style.display = 'block';
    }
  }

  save.onclick = saveNickname;
  input.addEventListener('keydown', function(event) { if (event.key === 'Enter') saveNickname(); });
}

function authShowLineReturnScreen(status) {
  var existing = document.getElementById('scs-line-return-screen');
  if (existing) existing.remove();
  var cancelled = status === 'cancelled';
  var screen = document.createElement('div');
  screen.id = 'scs-line-return-screen';
  screen.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:var(--bg,#0f0f13);display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;text-align:center;';
  screen.innerHTML = '<div style="max-width:360px;width:100%;padding:30px 24px;border-radius:22px;background:var(--surface,#1b1c25);border:1px solid var(--border,#343645);box-shadow:0 18px 50px rgba(0,0,0,.28);">'
    + '<div style="font-size:2.6rem;margin-bottom:14px;">' + (cancelled ? '↩️' : '✅') + '</div>'
    + '<div style="font-size:1.12rem;font-weight:800;color:var(--text,#fff);margin-bottom:10px;">'
    + (cancelled ? (t('lineLoginCancelled') || 'LINE login was cancelled.') : (t('lineHandoffComplete') || 'LINE login complete')) + '</div>'
    + '<div style="font-size:.9rem;line-height:1.55;color:var(--muted,#aaa);">'
    + (cancelled ? (t('lineHandoffReturnRetry') || 'Close this browser and return to SCS to try again.') : (t('lineHandoffReturn') || 'Your login is ready.')) + '</div>'
    + '<div style="margin-top:22px;text-align:left;display:grid;gap:11px;">'
    + '<div style="display:flex;align-items:center;gap:14px;padding:13px 14px;border-radius:14px;background:var(--bg,#0f0f13);color:var(--text,#fff);font-size:.88rem;font-weight:700;">'
    + '<span aria-hidden="true" style="width:48px;height:40px;border:2px solid var(--muted,#aaa);border-radius:8px;display:inline-flex;align-items:center;justify-content:center;position:relative;flex:0 0 auto;color:var(--muted,#aaa);font-size:1.35rem;line-height:1;">×<i style="position:absolute;left:-2px;right:-2px;top:7px;border-top:2px solid var(--muted,#aaa);"></i></span>'
    + '<span>' + (t('lineCloseBrowserStep') || 'Close this browser') + '</span></div>'
    + '<div style="display:flex;align-items:center;gap:14px;padding:13px 14px;border-radius:14px;background:var(--bg,#0f0f13);color:var(--text,#fff);font-size:.88rem;font-weight:700;">'
    + '<img src="icon-512.png?v=312" alt="SCS" width="52" height="52" style="width:52px;height:52px;border-radius:13px;display:block;object-fit:cover;flex:0 0 auto;box-shadow:0 5px 14px rgba(0,0,0,.28);">'
    + '<span>' + (t('lineOpenPwaStep') || 'Open SCS from your Home Screen') + '</span></div>'
    + '</div>'
    + '<div style="font-size:.78rem;line-height:1.45;color:var(--muted,#aaa);margin-top:15px;">' + (t('linePwaCompletesAutomatically') || 'SCS will complete login automatically when you return.') + '</div>'
    + '</div>';
  document.body.appendChild(screen);
}

function authFinishLineHandoff(result) {
  var deviceScreen = document.getElementById('scs-line-device-screen');
  if (deviceScreen) deviceScreen.remove();
  authSetLineButtonsLoading(false);
  if (result.needsNickname) {
    authShowLineNicknameScreen(result.ticket);
    return;
  }
  if (result.error) {
    authShowScreen('login');
    authShowError('loginError', result.error);
    return;
  }
  if (result.conflict) {
    authShowConflictModal(result.user, result.deviceInfo);
    return;
  }
  if (typeof updateProfileBtn === 'function') updateProfileBtn();
  authAfterLogin(result.user);
}

async function authPollLineHandoff() {
  if (_lineHandoffPolling || document.visibilityState === 'hidden') return;
  var raw = localStorage.getItem('scs_line_handoff');
  if (!raw) return;
  var handoff;
  try { handoff = JSON.parse(raw); } catch (error) { handoff = null; }
  if (!handoff || !handoff.id || !handoff.verifier || Date.now() >= Number(handoff.expiresAt || 0)) {
    localStorage.removeItem('scs_line_handoff');
    authSetLineButtonsLoading(false);
    return;
  }

  _lineHandoffPolling = true;
  try {
    var response = await fetch(WORKER_URL + '/auth/line/handoff/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: handoff.id, verifier: handoff.verifier })
    }, 10000);
    var data = await response.json().catch(function() { return {}; });
    if (data.status === 'complete' && data.ticket) {
      localStorage.removeItem('scs_line_handoff');
      sessionStorage.removeItem('scs_line_login_started');
      var result = await authCompleteLineLogin(data.ticket);
      authFinishLineHandoff(result);
      return;
    }
    if (data.status === 'cancelled' || data.status === 'expired') {
      localStorage.removeItem('scs_line_handoff');
      authSetLineButtonsLoading(false);
      var deviceScreen = document.getElementById('scs-line-device-screen');
      if (deviceScreen) deviceScreen.remove();
      authShowScreen('login');
      authShowError('loginError', authLineErrorMessage(data.status === 'cancelled' ? 'cancelled' : 'invalid_state'));
      return;
    }
  } catch (error) {
    // iOS may briefly suspend the PWA while LINE or Safari is in front.
  } finally {
    _lineHandoffPolling = false;
  }
  clearTimeout(_lineHandoffTimer);
  _lineHandoffTimer = setTimeout(authPollLineHandoff, 2000);
}

function authResumeLineHandoff(immediate) {
  var raw = localStorage.getItem('scs_line_handoff');
  if (!raw) return;
  if (authIsIOSStandalone() && !document.getElementById('scs-line-device-screen')) {
    try {
      var handoff = JSON.parse(raw);
      if (handoff && handoff.deviceCode) authShowLineDeviceScreen(handoff);
    } catch (error) {}
  }
  authSetLineButtonsLoading(true);
  clearTimeout(_lineHandoffTimer);
  _lineHandoffTimer = setTimeout(authPollLineHandoff, immediate ? 100 : 500);
}

document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') authResumeLineHandoff(true);
});

async function authHandleLineCallback() {
  var hash = window.location.hash ? window.location.hash.slice(1) : '';
  if (!hash) {
    var nicknameTicket = sessionStorage.getItem('scs_line_nickname_ticket');
    if (nicknameTicket) {
      authShowLineNicknameScreen(nicknameTicket);
      return true;
    }
    authResumeLineHandoff(false);
    return false;
  }
  var params = new URLSearchParams(hash);
  var ticket = params.get('line_auth');
  var errorCode = params.get('line_error');
  var handoffStatus = params.get('line_handoff');
  if (!ticket && !errorCode && !handoffStatus) {
    authResumeLineHandoff(false);
    return false;
  }

  history.replaceState(null, document.title, window.location.pathname + window.location.search);
  if (handoffStatus) {
    if (authIsIOSStandalone() && localStorage.getItem('scs_line_handoff')) {
      authResumeLineHandoff(true);
      return false;
    }
    authShowLineReturnScreen(handoffStatus);
    return true;
  }
  sessionStorage.removeItem('scs_line_login_started');
  authShowScreen('login');

  if (errorCode) {
    authShowError('loginError', authLineErrorMessage(errorCode));
    return true;
  }

  document.querySelectorAll('.auth-btn-line').forEach(function(button) {
    button.disabled = true;
    button.classList.add('is-loading');
  });

  var result = await authCompleteLineLogin(ticket);
  document.querySelectorAll('.auth-btn-line').forEach(function(button) {
    button.disabled = false;
    button.classList.remove('is-loading');
  });

  if (result.error) {
    authShowError('loginError', result.error);
    return true;
  }
  if (result.needsNickname) {
    authShowLineNicknameScreen(result.ticket);
    return true;
  }
  if (result.conflict) {
    authShowConflictModal(result.user, result.deviceInfo);
    return true;
  }

  if (typeof updateProfileBtn === 'function') updateProfileBtn();
  await authAfterLogin(result.user);
  return true;
}

/* -- Google Login: browser and iOS installed-PWA handoff -- */
var _googleHandoffTimer = null;
var _googleHandoffPolling = false;
var _googleLoadingRecoveryTimer = null;

function authGoogleFetch(url, options, timeoutMs) {
  var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = controller ? setTimeout(function() { controller.abort(); }, timeoutMs || 12000) : null;
  var requestOptions = Object.assign({}, options || {});
  if (controller) requestOptions.signal = controller.signal;
  return fetch(url, requestOptions).finally(function() { if (timer) clearTimeout(timer); });
}

function authHasActiveUser() {
  try {
    return typeof authIsLoggedIn === 'function' && authIsLoggedIn();
  } catch (error) {
    return false;
  }
}

function authRecoverGoogleButtonsIfLoggedOut() {
  // The Google button may be enabled again only when SCS still has no
  // authenticated user. This prevents a completed login from presenting a
  // second Google-login prompt when the app resumes.
  if (authHasActiveUser()) return false;
  document.querySelectorAll('.auth-btn-google').forEach(function(button) {
    button.disabled = false;
    button.classList.remove('is-loading');
  });
  return true;
}

function authSetGoogleButtonsLoading(loading) {
  clearTimeout(_googleLoadingRecoveryTimer);
  document.querySelectorAll('.auth-btn-google').forEach(function(button) {
    // Keep Google login retryable at all times. The visual loading state may be
    // shown, but the control itself must remain enabled so a cancelled Safari/
    // Chrome handoff can immediately start a fresh OAuth attempt.
    button.disabled = false;
    button.classList.toggle('is-loading', !!loading);
  });
}

function authGoogleErrorMessage(code) {
  var messages = {
    cancelled: t('googleLoginCancelled') || 'Google login was cancelled.',
    not_configured: t('googleLoginNotConfigured') || 'Google Login is not configured yet.',
    invalid_state: t('googleLoginExpired') || 'Google login expired. Please try again.',
    token_exchange_failed: t('googleLoginFailed') || 'Google login failed. Please try again.',
    id_token_invalid: t('googleLoginFailed') || 'Google login failed. Please try again.',
    database_not_ready: t('googleLoginDatabaseNotReady') || 'Google registration is not ready yet.',
    invalid_handoff: t('googleLoginExpired') || 'Google login expired. Please try again.',
    handoff_not_ready: t('googleHandoffNotReady') || 'iPhone app login is not ready yet.',
    login_failed: t('googleLoginFailed') || 'Google login failed. Please try again.'
  };
  return messages[code] || messages.login_failed;
}

async function authStartGoogleLogin(button) {
  // A fresh tap always replaces any abandoned or stale Google handoff.
  clearTimeout(_googleHandoffTimer);
  _googleHandoffPolling = false;
  localStorage.removeItem('scs_google_handoff');
  if (button) {
    button.disabled = false;
    button.classList.add('is-loading');
  }
  sessionStorage.removeItem('scs_google_login_started');
  sessionStorage.setItem('scs_google_login_started', '1');

  if (authIsIOSStandalone()) {
    // Keep the installed PWA's storage isolated and complete Google externally.
    // The one-time handoff ticket is then consumed inside the PWA and stored here.
    var loginWindow = window.open('about:blank', 'scs-google-login-' + Date.now());
    var handoff = authCreateLineHandoff();
    localStorage.setItem('scs_google_handoff', JSON.stringify(handoff));
    try {
      var createResponse = await authGoogleFetch(WORKER_URL + '/auth/google/handoff/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: handoff.id, verifier: handoff.verifier, deviceCode: handoff.deviceCode })
      }, 12000);
      if (!createResponse.ok) throw new Error('handoff_not_ready');
      var deviceUrl = WORKER_URL + '/auth/google/device?code=' + encodeURIComponent(handoff.deviceCode);
      if (loginWindow && !loginWindow.closed) loginWindow.location.replace(deviceUrl);
      else window.location.assign(deviceUrl);
      authResumeGoogleHandoff(true);
    } catch (error) {
      if (loginWindow && !loginWindow.closed) loginWindow.close();
      localStorage.removeItem('scs_google_handoff');
      authSetGoogleButtonsLoading(false);
      authShowScreen('login');
      authShowError('loginError', authGoogleErrorMessage('handoff_not_ready'));
    }
    return;
  }

  window.location.assign(WORKER_URL + '/auth/google/start');
}

function authShowGoogleDeviceScreen(handoff) {
  var existing = document.getElementById('scs-google-device-screen');
  if (existing) existing.remove();
  var deviceUrl = WORKER_URL + '/auth/google/device?code=' + encodeURIComponent(handoff.deviceCode);
  var screen = document.createElement('div');
  screen.id = 'scs-google-device-screen';
  screen.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:var(--bg,#0f0f13);display:flex;align-items:center;justify-content:center;padding:calc(env(safe-area-inset-top) + 24px) 24px calc(env(safe-area-inset-bottom) + 24px);box-sizing:border-box;';
  screen.innerHTML = '<button class="auth-social-close-btn" type="button" aria-label="Close Google login" onclick="authCloseSocialDeviceScreen()">✕</button><div style="max-width:360px;width:100%;text-align:center;">'
    + '<div style="width:76px;height:76px;border-radius:22px;background:#fff;display:flex;align-items:center;justify-content:center;margin:0 auto 28px;box-shadow:0 12px 28px rgba(20,30,55,.24);"><img src="google-g.svg?v=354" alt="Google" width="46" height="46"></div>'
    + '<a id="scsGoogleDeviceOpen" href="' + deviceUrl + '" target="scs-google-login" rel="opener" style="display:flex;align-items:center;justify-content:center;gap:10px;text-decoration:none;padding:15px 18px;border-radius:14px;background:#fff;border:1px solid #d4d7df;color:#202124;font-size:1rem;font-weight:850;box-shadow:0 10px 28px rgba(20,30,55,.18);"><img src="google-g.svg?v=354" alt="" width="22" height="22">' + (t('continueWithGoogle') || 'Continue with Google') + '</a>'
    + '</div>';
  document.body.appendChild(screen);
  document.getElementById('scsGoogleDeviceOpen').onclick = function() { authResumeGoogleHandoff(true); };
}

async function authCompleteGoogleLogin(ticket) {
  _setLocalToken(null);
  try {
    var response = await fetch(WORKER_URL + '/auth/google/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: ticket })
    });
    var data = await response.json().catch(function() { return {}; });
    if (!response.ok || !data.user) return { error: data.error || authGoogleErrorMessage('login_failed') };
    if (data.needsProfile || data.needsNickname) {
      sessionStorage.setItem('scs_google_nickname_ticket', ticket);
      if (data.user.nickname && data.user.nickname !== 'Google Player') {
        sessionStorage.setItem('scs_google_suggested_name', data.user.nickname);
      }
      return { needsNickname: true, user: data.user, ticket: ticket };
    }
    return await authFinalizeLineUser(data.user);
  } catch (error) {
    return { error: authGoogleErrorMessage('login_failed') };
  }
}

function authShowGoogleNicknameScreen(ticket) {
  var deviceScreen = document.getElementById('scs-google-device-screen');
  if (deviceScreen) deviceScreen.remove();
  var existing = document.getElementById('scs-google-nickname-screen');
  if (existing) existing.remove();
  var screen = document.createElement('div');
  screen.id = 'scs-google-nickname-screen';
  screen.style.cssText = 'position:fixed;inset:0;z-index:2147483647;overflow-y:auto;background:radial-gradient(circle at 50% 8%,rgba(98,78,255,.12),transparent 30%),var(--bg,#0f0f13);padding:24px 22px;box-sizing:border-box;';
  screen.innerHTML = '<div style="width:min(100%,430px);min-height:calc(100dvh - 48px);margin:0 auto;display:flex;flex-direction:column;justify-content:center;">'
    + '<div class="auth-welcome-brand" style="margin:0 0 30px;"><h1>' + (t('welcomeTitle') || 'Welcome to SCS') + '</h1><p>' + (t('welcomeSubtitle') || 'Your all-in-one platform for players, organisers and club managers.') + '</p></div>'
    + '<div style="width:100%;box-sizing:border-box;padding:28px 22px;border-radius:22px;background:var(--surface,#1b1c25);border:1px solid var(--border,#343645);box-shadow:0 18px 50px rgba(0,0,0,.28);">'
    + '<div style="width:56px;height:56px;border-radius:16px;background:#fff;display:flex;align-items:center;justify-content:center;margin:0 auto 15px;"><img src="google-g.svg?v=354" alt="Google" width="36" height="36"></div>'
    + '<div style="font-size:1.18rem;font-weight:850;color:var(--text,#fff);text-align:center;margin-bottom:7px;">' + (t('completePlayerProfile') || 'Complete your player profile') + '</div>'
    + '<div style="font-size:.84rem;color:var(--muted,#aaa);text-align:center;line-height:1.5;margin-bottom:20px;">' + (t('socialProfileHint') || 'Choose the name and gender shown in SCS.') + '</div>'
    + '<label for="scsGoogleNicknameInput" style="display:block;margin:0 2px 7px;color:var(--muted,#aaa);font-size:.75rem;font-weight:800;text-transform:uppercase;">' + (t('displayName') || 'Display Name') + '</label>'
    + '<input id="scsGoogleNicknameInput" type="text" maxlength="40" autocomplete="nickname" placeholder="' + (t('playerNickname') || 'Player nickname') + '" style="width:100%;box-sizing:border-box;padding:13px 14px;border-radius:12px;border:1px solid var(--border,#343645);background:var(--surface2,#242631);color:var(--text,#fff);font:inherit;font-size:1rem;outline:none;">'
    + '<label for="scsGoogleGenderInput" style="display:block;margin:14px 2px 7px;color:var(--muted,#aaa);font-size:.75rem;font-weight:800;text-transform:uppercase;">' + (t('gender') || 'Gender') + '</label>'
    + '<select id="scsGoogleGenderInput" style="width:100%;box-sizing:border-box;padding:13px 14px;border-radius:12px;border:1px solid var(--border,#343645);background:var(--surface2,#242631);color:var(--text,#fff);font:inherit;font-size:1rem;outline:none;"><option value="">' + (t('selectGender') || 'Select gender') + '</option><option value="Male">' + (t('genderMale') || 'Men') + '</option><option value="Female">' + (t('genderFemale') || 'Ladies') + '</option></select>'
    + '<div id="scsGoogleNicknameError" style="display:none;color:#ef476f;font-size:.8rem;margin:8px 2px 0;"></div>'
    + '<button id="scsGoogleNicknameSave" type="button" style="width:100%;margin-top:16px;padding:14px;border:0;border-radius:13px;background:#4285f4;color:#fff;font:inherit;font-weight:850;font-size:.96rem;">' + (t('continueBtn') || 'Continue') + '</button>'
    + '<button id="scsGoogleNicknameCancel" type="button" style="width:100%;margin-top:9px;padding:11px;border:0;background:transparent;color:var(--muted,#aaa);font:inherit;font-size:.86rem;">' + (t('cancel') || 'Cancel') + '</button>'
    + '</div></div>';
  document.body.appendChild(screen);
  var input = document.getElementById('scsGoogleNicknameInput');
  var genderInput = document.getElementById('scsGoogleGenderInput');
  var save = document.getElementById('scsGoogleNicknameSave');
  var errorEl = document.getElementById('scsGoogleNicknameError');
  input.value = sessionStorage.getItem('scs_google_suggested_name') || '';
  setTimeout(function() { input.focus(); }, 100);

  async function submitNickname() {
    var nickname = input.value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
    if (!nickname) {
      errorEl.textContent = t('playerNicknameRequired') || 'Please enter your player nickname.';
      errorEl.style.display = 'block';
      return;
    }
    var gender = genderInput.value;
    if (!gender) {
      errorEl.textContent = t('genderRequired') || 'Please select your gender.';
      errorEl.style.display = 'block';
      return;
    }
    save.disabled = true;
    save.textContent = t('saving') || 'Saving...';
    errorEl.style.display = 'none';
    try {
      var response = await fetch(WORKER_URL + '/auth/google/nickname', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket: ticket, nickname: nickname, gender: gender })
      });
      var data = await response.json().catch(function() { return {}; });
      if (!response.ok || !data.user) throw new Error(data.error || authGoogleErrorMessage('login_failed'));
      var result = await authFinalizeLineUser(data.user);
      sessionStorage.removeItem('scs_google_nickname_ticket');
      sessionStorage.removeItem('scs_google_suggested_name');
      screen.remove();
      authFinishGoogleHandoff(result);
    } catch (error) {
      save.disabled = false;
      save.textContent = t('continueBtn') || 'Continue';
      errorEl.textContent = error.message || authGoogleErrorMessage('login_failed');
      errorEl.style.display = 'block';
    }
  }
  save.onclick = submitNickname;
  document.getElementById('scsGoogleNicknameCancel').onclick = function() {
    sessionStorage.removeItem('scs_google_nickname_ticket');
    sessionStorage.removeItem('scs_google_suggested_name');
    screen.remove();
    authShowScreen('login');
  };
  input.addEventListener('keydown', function(event) { if (event.key === 'Enter') submitNickname(); });
}

function authShowGoogleReturnScreen(status) {
  var existing = document.getElementById('scs-google-return-screen');
  if (existing) existing.remove();
  var cancelled = status === 'cancelled';
  var screen = document.createElement('div');
  screen.id = 'scs-google-return-screen';
  screen.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:var(--bg,#0f0f13);display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;text-align:center;';
  screen.innerHTML = '<div style="max-width:360px;width:100%;padding:30px 24px;border-radius:22px;background:var(--surface,#1b1c25);border:1px solid var(--border,#343645);box-shadow:0 18px 50px rgba(0,0,0,.28);">'
    + '<div style="width:58px;height:58px;border-radius:16px;background:#fff;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;"><img src="google-g.svg?v=354" alt="Google" width="38" height="38"></div>'
    + '<div style="font-size:1.12rem;font-weight:800;color:var(--text,#fff);margin-bottom:10px;">' + (cancelled ? (t('googleLoginCancelled') || 'Google login was cancelled.') : (t('googleHandoffComplete') || 'Google login complete')) + '</div>'
    + '<div style="font-size:.9rem;line-height:1.55;color:var(--muted,#aaa);">' + (t('googleReturnToApp') || 'Tap ✕ to return to SCS.') + '</div>'
    + '<div style="display:flex;align-items:center;justify-content:center;gap:13px;margin-top:22px;padding:14px;border-radius:14px;background:var(--bg,#0f0f13);color:var(--text,#fff);font-size:.88rem;font-weight:700;"><img src="icon-512.png?v=312" alt="SCS" width="48" height="48" style="border-radius:12px;">' + (t('lineOpenPwaStep') || 'Open SCS from your Home Screen') + '</div>'
    + '</div>';
  document.body.appendChild(screen);
}

function authFinishGoogleHandoff(result) {
  var deviceScreen = document.getElementById('scs-google-device-screen');
  if (deviceScreen) deviceScreen.remove();
  authSetGoogleButtonsLoading(false);
  if (result.needsNickname) { authShowGoogleNicknameScreen(result.ticket); return; }
  if (result.error) { authShowScreen('login'); authShowError('loginError', result.error); return; }
  if (result.conflict) { authShowConflictModal(result.user, result.deviceInfo); return; }
  if (typeof updateProfileBtn === 'function') updateProfileBtn();
  authAfterLogin(result.user);
}

async function authPollGoogleHandoff() {
  if (_googleHandoffPolling || document.visibilityState === 'hidden') return;
  var raw = localStorage.getItem('scs_google_handoff');
  if (!raw) return;
  var handoff;
  try { handoff = JSON.parse(raw); } catch (error) { handoff = null; }
  if (!handoff || !handoff.id || !handoff.verifier || Date.now() >= Number(handoff.expiresAt || 0)) {
    localStorage.removeItem('scs_google_handoff');
    authSetGoogleButtonsLoading(false);
    return;
  }
  _googleHandoffPolling = true;
  try {
    var response = await authGoogleFetch(WORKER_URL + '/auth/google/handoff/status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: handoff.id, verifier: handoff.verifier })
    }, 10000);
    var data = await response.json().catch(function() { return {}; });
    if (data.status === 'complete' && data.ticket) {
      localStorage.removeItem('scs_google_handoff');
      sessionStorage.removeItem('scs_google_login_started');
      authFinishGoogleHandoff(await authCompleteGoogleLogin(data.ticket));
      return;
    }
    if (data.status === 'cancelled' || data.status === 'expired') {
      localStorage.removeItem('scs_google_handoff');
      authSetGoogleButtonsLoading(false);
      var deviceScreen = document.getElementById('scs-google-device-screen');
      if (deviceScreen) deviceScreen.remove();
      authShowScreen('login');
      authShowError('loginError', authGoogleErrorMessage(data.status === 'cancelled' ? 'cancelled' : 'invalid_state'));
      return;
    }
  } catch (error) {
    // The installed PWA may be briefly suspended while the browser is in front.
    // Recover only if the user is still logged out.
    authRecoverGoogleButtonsIfLoggedOut();
  } finally {
    _googleHandoffPolling = false;
  }
  clearTimeout(_googleHandoffTimer);
  _googleHandoffTimer = setTimeout(authPollGoogleHandoff, 2000);
}

function authResumeGoogleHandoff(immediate) {
  var raw = localStorage.getItem('scs_google_handoff');
  if (!raw) return;
  // Continue checking the previous handoff without locking the Google control.
  // A retry tap will clear this stale handoff and create a completely new one.
  authSetGoogleButtonsLoading(false);
  clearTimeout(_googleHandoffTimer);
  _googleHandoffTimer = setTimeout(authPollGoogleHandoff, immediate ? 100 : 500);
}

document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') authResumeGoogleHandoff(true);
});

async function authHandleGoogleCallback() {
  var hash = window.location.hash ? window.location.hash.slice(1) : '';
  if (!hash) {
    var nicknameTicket = sessionStorage.getItem('scs_google_nickname_ticket');
    if (nicknameTicket) { authShowGoogleNicknameScreen(nicknameTicket); return true; }
    authResumeGoogleHandoff(false);
    return false;
  }
  var params = new URLSearchParams(hash);
  var ticket = params.get('google_auth');
  var errorCode = params.get('google_error');
  var handoffStatus = params.get('google_handoff');
  if (!ticket && !errorCode && !handoffStatus) { authResumeGoogleHandoff(false); return false; }

  history.replaceState(null, document.title, window.location.pathname + window.location.search);
  if (handoffStatus) {
    if (authIsIOSStandalone() && localStorage.getItem('scs_google_handoff')) {
      authResumeGoogleHandoff(true);
      return false;
    }
    authShowGoogleReturnScreen(handoffStatus);
    return true;
  }
  sessionStorage.removeItem('scs_google_login_started');
  authShowScreen('login');
  if (errorCode) { authShowError('loginError', authGoogleErrorMessage(errorCode)); return true; }

  authSetGoogleButtonsLoading(true);
  var result = await authCompleteGoogleLogin(ticket);
  authSetGoogleButtonsLoading(false);
  if (result.error) { authShowError('loginError', result.error); return true; }
  if (result.needsNickname) { authShowGoogleNicknameScreen(result.ticket); return true; }
  if (result.conflict) { authShowConflictModal(result.user, result.deviceInfo); return true; }
  if (typeof updateProfileBtn === 'function') updateProfileBtn();
  await authAfterLogin(result.user);
  return true;
}

/* -- Session conflict modal -- another device is logged in -- */
var _conflictPendingUser = null;

function authShowConflictModal(user, deviceInfo) {
  _conflictPendingUser = user;
  var existing = document.getElementById('scs-conflict-modal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'scs-conflict-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:99998;padding:20px;box-sizing:border-box;';

  modal.innerHTML = '<div style="background:var(--card-bg,#1e1e2e);border-radius:18px;padding:28px 24px;max-width:320px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.5);text-align:center;">'
    + '<div style="font-size:2rem;margin-bottom:12px;">📱</div>'
    + '<div style="font-size:1rem;font-weight:700;color:var(--text,#fff);margin-bottom:8px;">Already Signed In</div>'
    + '<div style="font-size:0.82rem;color:var(--muted,#aaa);line-height:1.5;margin-bottom:22px;">Your account is active on <strong style="color:var(--text,#fff);">' + (deviceInfo || 'another device') + '</strong>. Only one device can be signed in at a time.</div>'
    + '<button id="scsConflictForce" style="width:100%;padding:13px;background:linear-gradient(135deg,#e63757,#c0392b);color:#fff;border:none;border-radius:12px;font-size:0.9rem;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:10px;">🔐 Log out other device &amp; sign in</button>'
    + '<button id="scsConflictCancel" style="width:100%;padding:11px;background:none;border:1px solid var(--border,#333);color:var(--muted,#aaa);border-radius:12px;font-size:0.88rem;cursor:pointer;font-family:inherit;">Cancel</button>'
    + '</div>';

  document.body.appendChild(modal);

  document.getElementById('scsConflictForce').onclick = async function() {
    this.disabled = true;
    this.textContent = 'Signing in...';
    try {
      var r = await authForceLogin(_conflictPendingUser);
      if (r && r.user) {
        modal.remove();
        _conflictPendingUser = null;
        if (typeof updateProfileBtn === 'function') updateProfileBtn();
        await authAfterLogin(r.user);
      } else {
        // Force login failed — show error in modal
        this.disabled = false;
        this.textContent = '🔐 Log out other device & sign in';
        var errEl = modal.querySelector('.scs-conflict-err');
        if (!errEl) {
          errEl = document.createElement('div');
          errEl.className = 'scs-conflict-err';
          errEl.style.cssText = 'font-size:0.78rem;color:#e63757;margin-top:8px;';
          modal.querySelector('div').appendChild(errEl);
        }
        errEl.textContent = 'Network error. Please try again.';
      }
    } catch(e) {
      this.disabled = false;
      this.textContent = '🔐 Log out other device & sign in';
    }
  };

  document.getElementById('scsConflictCancel').onclick = function() {
    modal.remove();
    _conflictPendingUser = null;
    // Return user to login screen cleanly
    if (typeof authShowScreen === 'function') authShowScreen('login');
  };
}

/* ── Do Sign Up ── */
var _pendingSignup = null;

async function authDoSignup() {
  var email        = (document.getElementById('signupEmail')?.value || '').trim();
  var displayName  = (document.getElementById('signupDisplayName')?.value || '').trim();
  var gender       = (document.getElementById('signupGender')?.value || 'Male');
  var password     = (document.getElementById('signupPassword')?.value || '');
  var confirm      = (document.getElementById('signupConfirm')?.value || '');
  var recoveryWord = (document.getElementById('signupRecoveryWord')?.value || '').trim();

  if (!email)                       { authShowError('signupError', t('emailRequired')); return; }
  if (!displayName)                 { authShowError('signupError', t('displayNameRequired') || 'Please enter a display name.'); return; }
  if (!password)                    { authShowError('signupError', t('passwordRequired') || 'Please enter a password.'); return; }
  if (password.length < 6)          { authShowError('signupError', t('passwordTooShort') || 'Password must be at least 6 characters.'); return; }
  if (!confirm)                     { authShowError('signupError', t('confirmPasswordRequired') || 'Please confirm your password.'); return; }
  if (password !== confirm)         { authShowError('signupError', t('passwordsNotMatch')); return; }
  if (!recoveryWord)                { authShowError('signupError', t('recoveryWordRequired') || 'Please enter a recovery keyword.'); return; }

  // Send OTP first
  authSetLoading('#authSignup .auth-btn-primary', true);
  var otpResult = await authSendOtp(email);
  authSetLoading('#authSignup .auth-btn-primary', false);

  if (otpResult.error) { authShowError('signupError', '❌ ' + otpResult.error); return; }

  _pendingSignup = { email, displayName, gender, password, recoveryWord };
  authShowOtpScreen(email, 'signup');
}

async function authCompleteSignup(otp) {
  if (!_pendingSignup) return;
  var { email, displayName, gender, password, recoveryWord } = _pendingSignup;

  var btn = document.getElementById('authOtpSubmitBtn');
  if (btn) btn.disabled = true;
  var verifyResult = await authVerifyOtp(email, otp);
  if (btn) btn.disabled = false;

  if (verifyResult.error) { authShowError('authOtpError', '❌ ' + verifyResult.error); return; }

  var result = await authSignUp(email, password, displayName, gender, recoveryWord);
  if (result.error) { authShowError('authOtpError', result.error); return; }

  var loginResult = await authLogin(email, password);
  if (loginResult.error) { authShowScreen('login'); return; }

  // Signup is fresh account — no conflict expected, but handle defensively
  if (loginResult.conflict) {
    // Force session since this is their own new account
    var forced = await authForceLogin(loginResult.user);
    _pendingSignup = null;
    authHideOtpScreen();
    if (forced && forced.user) authAfterLogin(forced.user);
    return;
  }

  _pendingSignup = null;
  authHideOtpScreen();
  authAfterLogin(loginResult.user);
}

/* ── After successful login -- single entry point for all post-login setup ── */
async function authAfterLogin(user) {
  // ── 1. Start the single session heartbeat (auth.js) ──────
  // This polls active_sessions every 2 mins and kicks out this device
  // if another device has taken over the session token.
  if (typeof _startSessionWatch === 'function') _startSessionWatch();

  // ── 2. Subscription: store email + restore plan + start plan watch ──
  // Does NOT do session check (that is auth.js's job above).
  if (user && user.id) {
    if (typeof onUserLogin === 'function') {
      await onUserLogin(user);
    } else if (user.email) {
      var _email = user.email.trim().toLowerCase();
      localStorage.setItem('scs_sub_email', _email);
      if (typeof _initTrial === 'function') _initTrial();
      if (typeof restorePlanByEmail === 'function') {
        restorePlanByEmail(_email).then(function(restored) {
          if (restored && typeof _subToast === 'function')
            _subToast('✅ Plan restored — ' + (typeof getLicensePlan === 'function' ? getLicensePlan().toUpperCase() : ''));
        }).catch(function(){});
      }
      if (typeof startPlanWatch === 'function') startPlanWatch();
      if (typeof subShowTrialBanner === 'function') subShowTrialBanner();
    }
  }

  // ── 3. Player / UI setup ─────────────────────────────────
  if (typeof setMyPlayer === 'function' && user.nickname) {
    setMyPlayer({ name: user.nickname, gender: user.gender || 'Male' });
  }
  if (typeof updateProfileBtn === 'function') updateProfileBtn();

  // ── 4. Silent background sync ────────────────────────────
  authSyncPlayerLinks(user).catch(function(){});

  // A shared club link is the user's explicit destination. Resume it before
  // existing memberships or cached workspace state can return through the
  // normal Welcome/launcher flow (including after a forced device login).
  var pendingJoinClubId = typeof authGetPendingJoinClubId === 'function'
    ? authGetPendingJoinClubId()
    : sessionStorage.getItem('pending_join_club_id');
  if (pendingJoinClubId) {
    authShowModeLauncher();
    return;
  }

  // Club membership is optional. Legacy invite state must never force the
  // full-screen Find Club flow after login; joining stays inside Clubs.
  var pending = (typeof authGetPendingInvite === 'function') ? authGetPendingInvite() : null;
  if (pending) {
    if (typeof authClearPendingInvite === 'function') authClearPendingInvite();
  }

  // Auto-find all clubs via memberships linked to this user_account
  try {
    var linkedMemberships = await sbGet('memberships',
      'user_account_id=eq.' + user.id + '&select=club_id,nickname');

    if (linkedMemberships && linkedMemberships.length) {
      // Fetch club names separately
      var clubIds = linkedMemberships.map(function(m) { return m.club_id; });
      var clubs = [];
      try {
        clubs = await sbGet('clubs', 'id=in.(' + clubIds.join(',') + ')&select=id,name');
      } catch(e) {}
      var clubMap = {};
      clubs.forEach(function(c) { clubMap[c.id] = c.name; });

      // Enrich memberships with club names
      linkedMemberships = linkedMemberships.map(function(m) {
        return { club_id: m.club_id, nickname: m.nickname, club_name: clubMap[m.club_id] || '' };
      });

      // Set nickname from first membership (all should share same nickname)
      var firstMem = linkedMemberships[0];
      if (typeof setMyPlayer === 'function') setMyPlayer({ name: firstMem.nickname, gender: user.gender || 'Male' });
      // Set active club to first membership as default (used by organiser/vault modes)
      if (typeof setMyClub === 'function') setMyClub(firstMem.club_id, firstMem.club_name);
      authHideOverlay();
      if (typeof authShowModeLauncher === 'function') authShowModeLauncher();
      return;
    }
  } catch(e) { /* offline -- fall through to cached club */ }

  // Check cached club
  var club = (typeof getMyClub === 'function') ? getMyClub() : { id: null };
  if (club && club.id) {
    authHideOverlay();
    if (typeof authShowModeLauncher === 'function') authShowModeLauncher();
    return;
  }

  // No club found -- return through the common launcher flow. If login was
  // requested by Organiser/Club Manager, that protected workspace will now
  // open its own club login/setup page.
  authShowModeLauncher();
}

async function authShowModeLauncher() {
  authHideOverlay();
  var home = document.getElementById('homePageOverlay');
  if (home) home.style.display = 'none';
  document.querySelectorAll('.page').forEach(function(page) { page.style.display = 'none'; });
  if (typeof syncExperienceModeUI === 'function') syncExperienceModeUI();
  if (typeof _refreshWelcomeSubtitle === 'function') _refreshWelcomeSubtitle();

  // When login was opened from Organiser or Club Manager on Welcome, continue
  // to that same protected workspace after successful account login. Its own
  // club/password verification still runs inside switchMode().
  var pendingMode = sessionStorage.getItem('scs_pending_workspace');
  if ((typeof authGetPendingJoinClubId === 'function' && authGetPendingJoinClubId()) ||
      sessionStorage.getItem('pending_join_club_id')) {
    sessionStorage.removeItem('scs_pending_workspace');
    if (typeof welcomeSelectWorkspace === 'function') welcomeSelectWorkspace('viewer');
    setTimeout(function() {
      if (typeof switchMode === 'function') switchMode('viewer');
    }, 0);
    return;
  }
  if (pendingMode === 'organiser' || pendingMode === 'vault') {
    sessionStorage.removeItem('scs_pending_workspace');
    if (typeof welcomeSelectWorkspace === 'function') welcomeSelectWorkspace(pendingMode);
    setTimeout(function() {
      if (typeof switchMode === 'function') switchMode(pendingMode);
    }, 0);
    return;
  }

  // My Hub is now the application Home. Keep the former mode launcher only
  // as dormant compatibility markup and open My Hub directly after login.
  if (typeof window.scsPrefetchWelcomeHubData === 'function') {
    try {
      await window.scsPrefetchWelcomeHubData(true);
    } catch (error) {
      console.warn('Home hub refresh skipped:', error);
    }
  }
  var overlay = document.getElementById('modeSelectOverlay');
  if (overlay) {
    overlay.classList.remove('scs-launch-first-paint');
    overlay.style.display = 'none';
  }
  if (typeof switchMode === 'function') switchMode('viewer');
}

function authShowClubPicker(memberships, user) {
  // Show a simple sheet to pick which club to enter
  var overlay = document.getElementById('authOverlay');
  if (!overlay) return;
  overlay.style.display = 'flex';

  // Hide all screens
  ['authWelcome','authLogin','authSignup','authForgot','authJoinClub','authClaim'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // Build club picker screen
  var picker = document.getElementById('authClubPicker');
  if (!picker) {
    picker = document.createElement('div');
    picker.id = 'authClubPicker';
    picker.className = 'auth-screen';
    overlay.appendChild(picker);
  }
  picker.style.display = '';
  picker.innerHTML = '<div class="auth-title">' + t('selectClubTitle') + '</div>' +
    '<div class="auth-sub">' + t('youMemberMultipleClubs') + '</div>' +
    memberships.map(function(m) {
      var cid   = m.club_id;
      var cname = m.club_name || cid;
      var nick  = m.nickname;
      return '<button class="auth-club-pick-btn" onclick="authPickClub(\''+cid+'\',\''+cname+'\',\''+nick+'\')">'+
        '<strong>'+cname+'</strong><span>'+nick+'</span></button>';
    }).join('');
  // Apply current language to dynamically built screen
  if (typeof setLanguage === 'function' && typeof currentLang !== 'undefined') setLanguage(currentLang);
}

async function authPickClub(clubId, clubName, nickname) {
  if (typeof setMyClub   === 'function') setMyClub(clubId, clubName);
  if (typeof setMyPlayer === 'function') setMyPlayer({ name: nickname, gender: 'Male' });
  authHideOverlay();
  if (typeof selectMode === 'function') selectMode('viewer');
}

/* ── Do Forgot Password -- recovery keyword ── */
async function authDoForgotReset() {
  var email        = (document.getElementById('forgotEmail')?.value || '').trim();
  var recoveryWord = (document.getElementById('forgotRecoveryWord')?.value || '').trim();
  var newPw        = (document.getElementById('forgotNewPw')?.value || '');
  var confirmPw    = (document.getElementById('forgotConfirmPw')?.value || '');

  if (newPw !== confirmPw) {
    authShowError('forgotError', t('passwordsNotMatch'));
    return;
  }

  authSetLoading('#authForgot .auth-btn-primary', true);
  var result = await authResetPassword(email, recoveryWord, newPw);
  authSetLoading('#authForgot .auth-btn-primary', false);

  if (result.error) {
    authShowError('forgotError', result.error);
    return;
  }

  authShowError('forgotError', t('passwordReset'));
  document.getElementById('forgotError').style.color = 'var(--green, #2dce89)';
  setTimeout(function() { authShowScreen('login'); }, 1500);
}

/* ── Do Join Club ── */
async function authDoJoinClub() {
  var code = (document.getElementById('joinClubCode')?.value || '').trim().toUpperCase();

  authSetLoading('#authJoinClub .auth-btn-primary', true);
  var result = await authJoinClub(code);
  authSetLoading('#authJoinClub .auth-btn-primary', false);

  if (result.error) {
    authShowError('joinClubError', result.error);
    return;
  }

  // Clear pending invite
  if (typeof authClearPendingInvite === 'function') authClearPendingInvite();

  // Success -- go to app
  authHideOverlay();
  if (typeof updateProfileBtn === 'function') updateProfileBtn();
  selectMode('viewer');
}

/* ── Skip join club ── */
function authSkipJoin() {
  if (typeof authClearPendingInvite === 'function') authClearPendingInvite();
  authHideOverlay();
  selectMode('viewer');
}

/* ── Logout ── */
function authDoLogout() {
  if (!confirm('Log out of this app? You will need to log in again to access your account.')) return;
  // Immediately hide all overlays to prevent content flash
  var modeOverlay = document.getElementById('modeSelectOverlay');
  if (modeOverlay) modeOverlay.style.display = 'none';
  var homeOverlay = document.getElementById('homePageOverlay');
  if (homeOverlay) homeOverlay.style.display = 'none';
  document.querySelectorAll('.page').forEach(function(p) { p.style.display = 'none'; });

  if (typeof authLogout === 'function') authLogout();
  // Reset app state
  if (typeof ResetAll === 'function') ResetAll();
  authShowScreen('login');
}

/* ── Club search UI ── */
var _searchTimeout = null;
function authSearchClubsUI(query) {
  clearTimeout(_searchTimeout);
  var resultsEl = document.getElementById('joinClubResults');
  var errorEl   = document.getElementById('joinClubError');
  var pendingEl = document.getElementById('joinClubPending');
  if (errorEl)   { errorEl.style.display = 'none'; }
  if (pendingEl) { pendingEl.style.display = 'none'; }

  if (!query || query.trim().length < 2) {
    if (resultsEl) resultsEl.style.display = 'none';
    return;
  }

  if (resultsEl) {
    resultsEl.style.display = 'block';
    resultsEl.innerHTML = '<div class="auth-club-loading">' + t('searching') + '</div>';
  }

  _searchTimeout = setTimeout(async function() {
    var result = await authSearchClubs(query);
    if (result.error) {
      if (resultsEl) resultsEl.innerHTML = '<div class="auth-club-empty">' + t('searchFailed') + '</div>';
      return;
    }
    if (!result.clubs || !result.clubs.length) {
      if (resultsEl) resultsEl.innerHTML = '<div class="auth-club-empty">' + t('noClubsFound') + '</div>';
      return;
    }
    if (resultsEl) {
      resultsEl.innerHTML = result.clubs.map(function(club) {
        return '<div class="auth-club-item" onclick="authDoRequestJoin(\'' + club.id + '\',\'' + club.name.replace(/'/g, "\\'") + '\')">' +
          '<div class="auth-club-item-name">🏢 ' + club.name + '</div>' +
          '<div class="auth-club-item-btn">' + t('requestToJoin') + '</div>' +
          '</div>';
      }).join('');
    }
  }, 400);
}

/* ── Request to join a club ── */
async function authDoRequestJoin(clubId, clubName) {
  var resultsEl = document.getElementById('joinClubResults');
  var errorEl   = document.getElementById('joinClubError');
  var pendingEl = document.getElementById('joinClubPending');

  if (errorEl) { errorEl.style.display = 'none'; }
  if (resultsEl) resultsEl.innerHTML = '<div class="auth-club-loading">' + t('sendingRequest') + '</div>';

  var result = await authRequestJoin(clubId);

  if (result.error) {
    if (resultsEl) resultsEl.style.display = 'none';
    if (errorEl) { errorEl.textContent = result.error; errorEl.style.display = 'block'; }
    return;
  }

  if (result.alreadyMember) {
    // Already member -- go straight to app
    authHideOverlay();
    selectMode('viewer');
    return;
  }

  // Show pending state
  if (resultsEl) resultsEl.style.display = 'none';
  if (pendingEl) pendingEl.style.display = 'flex';

  // Store pending club info
  localStorage.setItem('pending_club_id', clubId);
  localStorage.setItem('pending_club_name', clubName);
}

/* ── Load join requests for admin (Vault Requests tab) ── */

function authToggleLang() {
  var p = document.getElementById('authLangPicker');
  if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none';
}
function authSelectLang(code, flag, label) {
  var cur = document.getElementById('authLangCurrent');
  if (cur) cur.textContent = flag + ' ' + label + ' ▾';
  var p = document.getElementById('authLangPicker');
  if (p) p.style.display = 'none';
  if (typeof setLanguage === 'function') setLanguage(code);
}


/* ── Report page ── */
function r2Init() {
  const now  = new Date();
  const yearEl = document.getElementById('r2Year');
  if (yearEl) yearEl.textContent = now.getFullYear();
  r2BuildClubPicker();
  r2BuildMonths(now.getFullYear(), now.getMonth() + 1);
  r2SelectMonth(now.getMonth() + 1);
}

// Build the club filter pill row (All | Club A | Club B ...)
async function r2BuildClubPicker() {
  var container = document.getElementById('r2ClubPicker');
  if (!container) return;
  var authUser = (typeof authGetUser === 'function') ? authGetUser() : null;
  if (!authUser) { container.style.display = 'none'; return; }

  var clubs = [];
  try {
    var mems = await sbGet('memberships',
      'user_account_id=eq.' + authUser.id + '&select=club_id,clubs(name)').catch(function(){ return []; });
    clubs = mems.map(function(m){ return { id: m.club_id, name: m.clubs && m.clubs.name ? m.clubs.name : m.club_id }; });
  } catch(e) {}

  if (clubs.length <= 1) { container.style.display = 'none'; return; }

  container.style.display = 'flex';
  var pills = [{ id: null, name: (typeof t === 'function' ? t('reportAll') : 'All') }].concat(clubs);
  container.innerHTML = pills.map(function(c, i) {
    var active = i === 0;
    return '<button onclick="r2SelectClub(' + (c.id ? '\'' + c.id + '\'' : 'null') + ',this)" ' +
      'class="r2-pill' + (active ? ' active-club' : '') + '">' +
      c.name + '</button>';
  }).join('');
}

var _r2SelectedClub = null;
function r2SelectClub(clubId, btn) {
  _r2SelectedClub = clubId || null;
  var container = document.getElementById('r2ClubPicker');
  if (container) {
    container.querySelectorAll('button').forEach(function(b) {
      b.classList.toggle('active-club', b === btn);
    });
  }
  vaultLoadReport();
}

function r2BuildMonths(year, activeMonth) {
  const locale = ({ en:'en-US', jp:'ja-JP', kr:'ko-KR', vi:'vi-VN', zh:'zh-CN' })[(typeof currentLang !== 'undefined' ? currentLang : 'en')] || 'en-US';
  const months = Array.from({length:12}, function(_, i) {
    return new Date(year, i, 1).toLocaleString(locale, { month:'short' });
  });
  const container = document.getElementById('r2Months');
  if (!container) return;
  container.innerHTML = months.map(function(m, i) {
    var isActive = (i + 1) === activeMonth;
    return '<button onclick="r2SelectMonth(' + (i+1) + ')" data-month="' + (i+1) + '" ' +
      'class="r2-pill' + (isActive ? ' active-month' : '') + '"' +
      (isActive ? ' id="r2ActiveMonth"' : '') + '>' + m + '</button>';
  }).join('');
}

function r2SelectMonth(month) {
  document.querySelectorAll('#r2Months button').forEach(function(btn) {
    var isActive = parseInt(btn.dataset.month) === month;
    btn.classList.toggle('active-month', isActive);
    btn.id = isActive ? 'r2ActiveMonth' : (btn.id === 'r2ActiveMonth' ? '' : btn.id);
  });
  vaultLoadReport();
}

function r2ChangeYear(dir) {
  var yearEl = document.getElementById('r2Year');
  if (!yearEl) return;
  yearEl.textContent = parseInt(yearEl.textContent) + dir;
  vaultLoadReport();
}

function vaultLoadReport() {
  const yearEl  = document.getElementById('r2Year');
  const monthEl = document.getElementById('r2ActiveMonth');
  const ct      = document.getElementById('r2Content');
  const year    = yearEl  ? parseInt(yearEl.textContent)    : new Date().getFullYear();
  const month   = monthEl ? parseInt(monthEl.dataset.month) : new Date().getMonth() + 1;
  if (ct) ct.innerHTML = '<div style="padding:32px;text-align:center;color:var(--muted);">⏳ ' + ((typeof t === 'function' && t('loadingReport')) || 'Loading report…') + '</div>';
  if (typeof reportFetchMonthData !== 'function') {
    if (ct) ct.innerHTML = '<div style="padding:24px;text-align:center;color:#e63757;">❌ ' + ((typeof t === 'function' && t('reportModuleNotLoaded')) || 'Report module not loaded') + '</div>';
    return;
  }
  var selectedClub = (typeof _r2SelectedClub !== 'undefined') ? _r2SelectedClub : null;
  reportFetchMonthData(year, month, selectedClub).then(function(data) {
    reportRenderViewerPage(data);
  }).catch(function(e) {
    if (ct) ct.innerHTML = '<div style="padding:24px;text-align:center;color:#e63757;">❌ ' + (e.message || ((typeof t === 'function' && t('reportFailedToLoad')) || 'Failed to load report')) + '</div>';
  });
}


/* ============================================================
   VIEWER QC MODULE
   Checks each home tile and auto-fixes silently.
   Shows message only if cannot fix.
============================================================ */
async function viewerQCCheck() {
  const fixes = [];
  const msgs  = [];

  // ── QC 1: My Card ──
  const ratingEl = document.getElementById('homeTileRatingV');
  const nameEl   = document.getElementById('homeTileNameV');
  const ratingTxt = ratingEl ? ratingEl.textContent : '';
  if (!ratingTxt || ratingTxt === 'Not selected' || ratingTxt === 'Loading...') {
    // Try fix: refresh screen
    try {
      if (typeof homeRefreshScreen === 'function') await homeRefreshScreen();
      fixes.push('My Card refreshed');
    } catch(e) {
      msgs.push('My Card: Please select your player profile');
    }
  }
  viewerQCDot('myCardQC', ratingTxt && ratingTxt !== 'Not selected' && ratingTxt !== 'Loading...' ? 'green' : 'yellow');

  // ── QC 2: Dashboard ──
  const dashEl  = document.getElementById('tileSubDashboardV');
  const dashTxt = dashEl ? dashEl.textContent : '';
  if (!dashTxt || dashTxt === 'Loading...') {
    try {
      if (typeof dbGetLiveSessions === 'function') {
        const sessions = await dbGetLiveSessions();
        const count = (sessions || []).length;
        if (dashEl) dashEl.textContent = count > 0 ? count + ' live session' + (count !== 1 ? 's' : '') : 'No live sessions';
        fixes.push('Dashboard refreshed');
      }
    } catch(e) {
      msgs.push('Dashboard: Connection issue');
    }
  }
  viewerQCDot('dashQC', dashTxt && dashTxt !== 'Loading...' ? 'green' : 'yellow');

  // ── QC 3: My Clubs ──
  const club = (typeof getMyClub === 'function') ? getMyClub() : null;
  if (!club || !club.id) {
    try {
      if (typeof homeRefreshJoinClubTile === 'function') await homeRefreshJoinClubTile();
      fixes.push('My Clubs refreshed');
    } catch(e) {}
    const clubOk = club && club.id;
    if (!clubOk) msgs.push('My Clubs: Please join or select a club');
    viewerQCDot('clubsQC', clubOk ? 'green' : 'red');
  } else {
    viewerQCDot('clubsQC', 'green');
  }

  // ── QC 4: Report ──
  // Report just checks if club is set
  viewerQCDot('reportQC', club && club.id ? 'green' : 'yellow');

  // Show message if needed
  if (msgs.length > 0) {
    viewerQCShowMsg(msgs.join(' · '));
  }
}

function viewerQCDot(id, color) {
  var el = document.getElementById(id);
  if (!el) return;
  var colors = { green: '#1db954', yellow: '#f59e0b', red: '#e63757' };
  el.style.background = colors[color] || colors.yellow;
  el.style.display = 'block';
}

function viewerQCShowMsg(msg) {
  var existing = document.getElementById('viewerQCMsg');
  if (existing) existing.remove();
  var div = document.createElement('div');
  div.id = 'viewerQCMsg';
  div.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--surface,#1e1e2e);color:var(--text,#fff);padding:10px 18px;border-radius:20px;font-size:0.78rem;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.4);max-width:90vw;text-align:center;border:1px solid var(--border,#2a2a4a);';
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(function() { div.remove(); }, 4000);
}

async function vaultLoadRequests() {
  var club = (typeof getMyClub === 'function') ? getMyClub() : { id: null };
  var listEl = document.getElementById('vaultRequestsList');
  if (!listEl) return;

  if (!club || !club.id) {
    listEl.innerHTML = '<div class="profile-sessions-empty">' + t('connectClubFirst') + '</div>';
    return;
  }

  listEl.innerHTML = '<div class="profile-sessions-loading">Loading...</div>';
  var result = await authGetJoinRequests(club.id);

  if (result.error) {
    listEl.innerHTML = '<div class="profile-sessions-empty">' + t('failedLoadRequests') + '</div>';
    return;
  }

  if (!result.requests || !result.requests.length) {
    listEl.innerHTML = '<div class="profile-sessions-empty">' + t('noPendingRequests') + '</div>';
    return;
  }

  listEl.innerHTML = result.requests.map(function(req) {
    var gender = req.gender || '—';
    var rating = Number(req.requestedRating || 1);
    return '<div class="vault-request-card">' +
      '<div class="vault-request-info">' +
        '<div class="vault-request-name">' + req.nickname + '</div>' +
        '<div class="vault-request-meta">' +
          '<span><b>Gender</b> ' + gender + '</span>' +
          '<span><b>Rating</b> ' + rating + '</span>' +
        '</div>' +
        '<div class="vault-request-id">' + req.email + '</div>' +
      '</div>' +
      '<div class="vault-request-actions">' +
        '<button class="vault-request-accept" onclick="vaultAcceptRequest(\'' + req.requestId + '\',\'' + req.userAccountId + '\',\'' + req.nickname.replace(/'/g, "\\'") + '\',' + rating + ',this,\'' + gender + '\')">✓ Accept</button>' +
        '<button class="vault-request-reject" onclick="vaultRejectRequest(\'' + req.requestId + '\',this)">✗ Reject</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

/* ── Accept request ── */
async function vaultAcceptRequest(requestId, userAccountId, nickname, requestedRating, btn, gender) {
  var club = (typeof getMyClub === 'function') ? getMyClub() : { id: null };
  if (!club || !club.id) return;

  // Show loading state on button
  var acceptBtn = btn || event.target;
  var originalText = acceptBtn ? acceptBtn.textContent : '';
  if (acceptBtn) { acceptBtn.disabled = true; acceptBtn.textContent = '⏳ Accepting...'; }

  var result = await authAcceptRequest(requestId, club.id, userAccountId, nickname, gender || null, requestedRating);

  if (result.error) {
    if (acceptBtn) { acceptBtn.disabled = false; acceptBtn.textContent = originalText; }
    if (typeof showToast === 'function') showToast('❌ Failed: ' + result.error);
    else alert('Failed: ' + result.error);
    return;
  }

  // Success feedback
  if (typeof showToast === 'function') showToast('✅ ' + nickname + ' accepted and added to club!');

  // Invalidate player cache and resync so organiser sees the new player immediately
  localStorage.removeItem('kbrr_cache_players');
  localStorage.removeItem('kbrr_cache_ts');
  if (typeof syncToLocal === 'function') await syncToLocal();

  // Refresh the requests list and home tiles
  vaultLoadRequests();
  if (typeof homeRefreshTiles === 'function') homeRefreshTiles();
}

/* ── Reject request ── */
async function vaultRejectRequest(requestId, btn) {
  var rejectBtn = btn || event.target;
  var originalText = rejectBtn ? rejectBtn.textContent : '';
  if (rejectBtn) { rejectBtn.disabled = true; rejectBtn.textContent = '⏳...'; }

  var result = await authRejectRequest(requestId);

  if (result.error) {
    if (rejectBtn) { rejectBtn.disabled = false; rejectBtn.textContent = originalText; }
    if (typeof showToast === 'function') showToast('❌ Failed: ' + result.error);
    else alert('Failed: ' + result.error);
    return;
  }

  if (typeof showToast === 'function') showToast('🚫 Request rejected.');
  vaultLoadRequests();
}

/* ── OTP Screen ── */
var _otpContext = null; // 'signup' | 'claim'

function authShowOtpScreen(email, context) {
  _otpContext = context;
  var overlay = document.getElementById('authOverlay');
  if (overlay) overlay.style.display = 'flex';

  // Hide all screens
  ['authWelcome','authLogin','authSignup','authForgot','authJoinClub','authClaim','authClubPicker'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // Build or show OTP screen
  var otpScreen = document.getElementById('authOtpScreen');
  if (!otpScreen) {
    otpScreen = document.createElement('div');
    otpScreen.id = 'authOtpScreen';
    otpScreen.className = 'auth-screen';
    document.getElementById('authOverlay').appendChild(otpScreen);
  }
  otpScreen.style.display = '';
  otpScreen.innerHTML =
    '<div class="auth-title">' + t('verifyEmailTitle') + '</div>' +
    '<div class="auth-sub" style="margin-bottom:16px">Enter the 6-digit code sent to<br><strong>' + email + '</strong></div>' +
    '<input id="authOtpInput" class="auth-input" type="text" inputmode="numeric" maxlength="6" placeholder="000000" style="letter-spacing:8px;font-size:1.2rem;text-align:center;">' +
    '<div id="authOtpError" class="auth-error" style="display:none"></div>' +
    '<button id="authOtpSubmitBtn" class="auth-btn auth-btn-primary" onclick="authSubmitOtp()" style="margin-top:12px;">' + t('verifyBtn') + '</button>' +
    '<button class="auth-btn auth-btn-secondary" onclick="authResendOtp(\'' + email + '\')" style="margin-top:8px;">' + t('resendCode') + '</button>';

  setTimeout(function() {
    var inp = document.getElementById('authOtpInput');
    if (inp) inp.focus();
  }, 100);
}

function authHideOtpScreen() {
  var otpScreen = document.getElementById('authOtpScreen');
  if (otpScreen) otpScreen.style.display = 'none';
}

async function authSubmitOtp() {
  var otp = (document.getElementById('authOtpInput')?.value || '').trim();
  if (otp.length !== 6) { authShowError('authOtpError', t('enterSixDigitHint')); return; }
  if (_otpContext === 'signup') await authCompleteSignup(otp);
  if (_otpContext === 'claim')  await authCompleteClaim(otp);
}

async function authResendOtp(email) {
  var result = await authSendOtp(email);
  if (result.error) {
    authShowError('authOtpError', result.error);
  } else {
    authShowError('authOtpError', t('codeResent'));
    document.getElementById('authOtpError').style.color = 'var(--green,#2dce89)';
    document.getElementById('authOtpError').style.display = '';
  }
}

function authShowError(id, msg) {
  var el = document.getElementById(id);
  if (el) { el.textContent = msg; el.style.display = ''; }
}

/* ── Claim Account with OTP verification ── */
var _pendingClaim = null;

async function authDoClaimAccount() {
  var clubId       = (document.getElementById('claimClubSelect')?.value || '').trim();
  var nickname     = (document.getElementById('claimNickname')?.value || '').trim();
  var defaultPw    = (document.getElementById('claimDefaultPassword')?.value || '').trim();
  var email        = (document.getElementById('claimEmail')?.value || '').trim();
  var newPassword  = (document.getElementById('claimPassword')?.value || '');
  var confirmPw    = (document.getElementById('claimConfirm')?.value || '');
  var recoveryWord = (document.getElementById('claimRecoveryWord')?.value || '').trim();
  var errEl        = document.getElementById('claimError');

  var setErr = function(msg) { if (errEl) { errEl.textContent = msg; errEl.style.display = ''; } };

  if (!clubId)      { setErr(t('selectYourClub')); return; }
  if (!nickname)    { setErr(t('enterYourNickname')); return; }
  if (!defaultPw)   { setErr(t('enterDefaultPassword')); return; }
  if (!email)       { setErr('Enter your email'); return; }
  if (newPassword.length < 6) { setErr('Password must be at least 6 characters'); return; }
  if (newPassword !== confirmPw) { setErr(t('passwordsNotMatch')); return; }

  // Send OTP to verify email
  setErr(t('sendingVerification'));
  errEl.style.color = 'var(--accent,#6c63ff)';
  var otpResult = await authSendOtp(email);
  if (otpResult.error) { errEl.style.color = ''; setErr(otpResult.error); return; }

  // Store claim data and show OTP screen
  _pendingClaim = { clubId, nickname, defaultPw, email, newPassword, recoveryWord };
  authShowOtpScreen(email, 'claim');
}

async function authCompleteClaim(otp) {
  if (!_pendingClaim) return;
  var { clubId, nickname, defaultPw, email, newPassword, recoveryWord } = _pendingClaim;

  var verifyResult = await authVerifyOtp(email, otp);
  if (verifyResult.error) { authShowError('authOtpError', verifyResult.error); return; }

  // OTP verified -- complete claim
  var result = await authClaimAccount(clubId, nickname, defaultPw, email, newPassword, recoveryWord);
  if (result.error) { authShowError('authOtpError', result.error); return; }

  _pendingClaim = null;
  authHideOtpScreen();
  authAfterLogin(result.user);
}

/* ============================================================
   QC MODULE v1.0
   Watches viewer / organiser / vault modes
   Auto-fixes silently. Toast only if can't fix.
   Update this module as app grows.
============================================================ */

var _qcTimer      = null;
var _qcMode       = null;
var _qcInterval   = 60000; // check every 60s

function qcStart(mode) {
  qcStop(); // clear any existing
  _qcMode = mode;
  _qcRun();
  _qcTimer = setInterval(_qcRun, _qcInterval);
}

function qcStop() {
  if (_qcTimer) { clearInterval(_qcTimer); _qcTimer = null; }
  _qcMode = null;
}

async function _qcRun() {
  if (typeof window.scsIsRoundManagerVisible === 'function' && window.scsIsRoundManagerVisible()) return;
  // ── Settings (all modes) ──────────────────────────────────
  _qcApplySettings();

  if (_qcMode === 'viewer')     await _qcViewer();
  if (_qcMode === 'organiser')  await _qcOrganiser();
  if (_qcMode === 'vault')      await _qcVault();
}

// ── Settings fix ─────────────────────────────────────────────
function _qcApplySettings() {
  try {
    const theme = localStorage.getItem('app-theme');
    const font  = localStorage.getItem('appFontSize');
    const tile  = localStorage.getItem('kbrr_tile_style');
    const lang  = localStorage.getItem('kbrr_lang');
    if (theme && typeof applyTheme    === 'function') applyTheme(theme);
    if (font  && typeof setFontSize   === 'function') setFontSize(font);
    if (tile  && typeof setTileStyle  === 'function') setTileStyle(tile);
    if (lang  && typeof setLanguage   === 'function') setLanguage(lang);
  } catch(e) {}
}

// ── Viewer QC ─────────────────────────────────────────────────
async function _qcViewer() {
  // License integrity check
  try {
    if (typeof qcCheckLicense === 'function') await qcCheckLicense();
  } catch(e) {}

  // My Card
  try {
    const ratingEl = document.getElementById('homeTileRatingV');
    const txt = ratingEl ? ratingEl.textContent : '';
    if (!txt || txt === 'Loading...' || txt === 'Not selected') {
      if (typeof homeRefreshTiles === 'function') await homeRefreshTiles();
    }
  } catch(e) {}

  // Dashboard
  try {
    const dashEl = document.getElementById('tileSubDashboardV');
    if (dashEl && dashEl.textContent === 'Loading...') {
      const sessions = typeof dbGetLiveSessions === 'function' ? await dbGetLiveSessions() : [];
      const count = (sessions||[]).length;
      dashEl.textContent = count > 0 ? count + ' live session' + (count!==1?'s':'') : 'No live sessions';
    }
  } catch(e) {}

  // Active club
  try {
    const club = typeof getMyClub === 'function' ? getMyClub() : null;
    if (!club || !club.id) {
      if (typeof homeRefreshJoinClubTile === 'function') await homeRefreshJoinClubTile();
    }
  } catch(e) {}
}

// ── Organiser QC ──────────────────────────────────────────────
async function _qcOrganiser() {
  // License integrity check
  try {
    if (typeof qcCheckLicense === 'function') await qcCheckLicense();
  } catch(e) {}

  // Players loaded
  try {
    const players = typeof getActivePlayers === 'function' ? getActivePlayers() : [];
    if (!players || players.length === 0) {
      if (typeof syncToLocal === 'function') syncToLocal();
    }
  } catch(e) {}

  // Courts set - read from DOM element like the app does
  try {
    const courtsEl = document.getElementById('num-courts');
    const courts = courtsEl ? parseInt(courtsEl.textContent || '0') : 1;
    if (courtsEl && courts === 0) {
      _qcToast('⚠️ No courts set — please configure in Settings');
    }
  } catch(e) {}

  // Cost edit: verify session entries have session_id for reliable cost editing
  // (new sessions will have it, old ones won't — no action needed, just informational)
}

// ── Vault QC ──────────────────────────────────────────────────
async function _qcVault() {
  // Logged in
  try {
    const user = typeof authGetUser === 'function' ? authGetUser() : null;
    if (!user) {
      _qcToast('⚠️ Not logged in — please sign in to Vault');
      return;
    }
  } catch(e) {}

  // Club selected
  try {
    const club = typeof getMyClub === 'function' ? getMyClub() : null;
    if (!club || !club.id) {
      if (typeof homeRefreshJoinClubTile === 'function') await homeRefreshJoinClubTile();
    }
  } catch(e) {}

  // Sync status
  try {
    if (typeof vaultSyncStatus === 'function') vaultSyncStatus();
  } catch(e) {}
}

// ── Toast ─────────────────────────────────────────────────────
function _qcToast(msg) {
  var existing = document.getElementById('qcToast');
  if (existing && existing.textContent === msg) return; // don't repeat same msg
  if (existing) existing.remove();
  var div = document.createElement('div');
  div.id = 'qcToast';
  div.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
    'background:var(--surface,#1e1e2e);color:var(--text,#fff);padding:10px 18px;border-radius:20px;' +
    'font-size:0.78rem;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.4);' +
    'max-width:90vw;text-align:center;pointer-events:none;border:1px solid var(--border,#2a2a4a);';
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(function() { div.remove(); }, 4000);
}
