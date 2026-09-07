/* ============================================================
   SUBSCRIPTION MODULE v4 — Proxied via Cloudflare Worker
   No Supabase URL or keys in this file.
   All license/purchase calls go to WORKER_URL/sub/*
============================================================ */

// WORKER_URL is defined in supabase.js — loaded before this file

/* ── Storage keys ── */
const SK_TRIAL  = 'sub_first_install';
const SK_PLAN   = 'scs_license_plan';
const SK_EXPIRY = 'scs_license_expiry';
const SK_EMAIL  = 'scs_sub_email';
const SK_ACCOUNT = 'scs_sub_account_id';
const SK_KEY    = 'scs_license_key';
const SK_SID    = 'scs_session_id';
const SK_DENY_REASON = 'scs_access_deny_reason';
const SK_DENY_UNTIL  = 'scs_access_deny_until';
const TRIAL_DAYS = 60;

function _subT(key, fallback, values) {
  var value = (typeof t === 'function') ? t(key) : key;
  if (!value || value === key) value = fallback || key;
  return String(value).replace(/\{(\w+)\}/g, function(_, name) {
    return values && values[name] != null ? String(values[name]) : '';
  });
}

/* ── Worker helpers (subscription routes) ── */
async function _wPost(path, body) {
  try {
    const res = await fetch(WORKER_URL + path, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
    });
    if (!res.ok) return null;
    return await res.json();
  } catch(e) { return null; }
}

/* ── Clear all subscription data ── */
function clearSubscription() {
  localStorage.removeItem('scs_sub_email');
  localStorage.removeItem('scs_sub_account_id');
  localStorage.removeItem('scs_license_plan');
  localStorage.removeItem('scs_license_expiry');
  localStorage.removeItem('scs_license_key');
  localStorage.removeItem('scs_session_id');
  localStorage.removeItem('scs_access_deny_reason');
  localStorage.removeItem('scs_access_deny_until');
  localStorage.removeItem('sub_first_install');
}

/* ── Single license check ── */
function _subscriptionIdentity(userOrEmail) {
  var current = (typeof authGetUser === 'function') ? authGetUser() : null;
  var user = (userOrEmail && typeof userOrEmail === 'object') ? userOrEmail : current;
  var legacyEmail = typeof userOrEmail === 'string' ? userOrEmail : '';
  var accountId = user && user.id != null ? String(user.id) : (localStorage.getItem(SK_ACCOUNT) || '');
  var email = (user && user.email) || legacyEmail || localStorage.getItem(SK_EMAIL) || '';
  email = String(email || '').trim().toLowerCase();
  var displayName = String((user && (user.nickname || user.displayName)) || '').trim();
  var authProvider = String((user && user.authProvider) || (email ? 'email' : 'line')).trim();
  var sessionToken = (typeof _getLocalToken === 'function') ? (_getLocalToken() || '') : '';

  if (accountId) localStorage.setItem(SK_ACCOUNT, accountId);
  if (email) localStorage.setItem(SK_EMAIL, email);
  return { accountId: accountId, userAccountId: accountId, email: email || null,
    displayName: displayName, authProvider: authProvider, sessionToken: sessionToken };
}

function _hasSubscriptionIdentity(identity) {
  return !!(identity && (identity.accountId || identity.email));
}

async function checkLicense(userOrEmail) {
  var identity = _subscriptionIdentity(userOrEmail);
  if (!_hasSubscriptionIdentity(identity)) return;
  _initTrial();
  await restorePlanByIdentity(identity);
  subShowTrialBanner();
}

/* ── Trial ── */
function _initTrial() {
  if (!localStorage.getItem(SK_TRIAL)) {
    localStorage.setItem(SK_TRIAL, Date.now().toString());
  }
}

function isTrialActive() {
  const ts = parseInt(localStorage.getItem(SK_TRIAL) || '0');
  if (!ts) return false;
  return (Date.now() - ts) / 86400000 < TRIAL_DAYS;
}

function getTrialDaysLeft() {
  const ts = parseInt(localStorage.getItem(SK_TRIAL) || '0');
  if (!ts) return 0;
  return Math.max(0, Math.ceil(TRIAL_DAYS - (Date.now() - ts) / 86400000));
}

/* ── Plan ── */
function getLicensePlan()   { return localStorage.getItem(SK_PLAN)   || null; }
function getLicenseExpiry() { return localStorage.getItem(SK_EXPIRY) || null; }

function isLicenseValid() {
  const plan   = getLicensePlan();
  const expiry = getLicenseExpiry();
  if (!plan || plan === 'trial') return false;
  if (expiry && new Date(expiry) < new Date()) return false;
  return true;
}

function isPro()   { return isLicenseValid() && getLicensePlan() === 'pro'; }
function isBasic() { return isLicenseValid() && getLicensePlan() === 'basic'; }
function hasLocalFullAccess() { return isTrialActive() || isPro(); }
function hasLocalAnyAccess()  { return isTrialActive() || isLicenseValid(); }
function hasFullAccess() {
  if (isServerAccessDenied()) return false;
  if (_accessToken && Date.now() < _accessExpiry) {
    return _accessAllowed && (_accessPlan === 'pro' || _accessPlan === 'trial');
  }
  return hasLocalFullAccess();
}
function hasAnyAccess()  {
  if (isServerAccessDenied()) return false;
  if (_accessToken && Date.now() < _accessExpiry) return _accessAllowed;
  return hasLocalAnyAccess();
}

/* ── Server-issued access token (in-memory only — cannot be faked) ── */
var _accessToken     = null;   // token string from server
var _accessPlan      = null;   // 'pro' | 'basic' | 'trial'
var _accessExpiry    = 0;      // token expiry timestamp (ms)
var _accessAllowed   = false;  // server said allowed
var _accessDenyReason = localStorage.getItem(SK_DENY_REASON) || null;
var _accessDenyUntil  = parseInt(localStorage.getItem(SK_DENY_UNTIL) || '0', 10) || 0;

function isServerAccessDenied() {
  if (!_accessDenyUntil || Date.now() >= _accessDenyUntil) {
    _accessDenyReason = null;
    _accessDenyUntil = 0;
    localStorage.removeItem(SK_DENY_REASON);
    localStorage.removeItem(SK_DENY_UNTIL);
    return false;
  }
  return true;
}

function rememberServerDeny(reason) {
  _accessDenyReason = reason || 'denied';
  _accessDenyUntil = Date.now() + 2 * 60 * 60 * 1000;
  localStorage.setItem(SK_DENY_REASON, _accessDenyReason);
  localStorage.setItem(SK_DENY_UNTIL, String(_accessDenyUntil));
}

function clearServerDeny() {
  _accessDenyReason = null;
  _accessDenyUntil = 0;
  localStorage.removeItem(SK_DENY_REASON);
  localStorage.removeItem(SK_DENY_UNTIL);
}

function getDeviceId() {
  let id = localStorage.getItem('scs_device_id');
  if (!id) {
    id = 'dev_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('scs_device_id', id);
  }
  return id;
}

/* Call once on login and once on every session start */
async function verifyAccessWithServer(userOrIdentity) {
  try {
    const identity = (userOrIdentity && userOrIdentity.accountId !== undefined)
      ? userOrIdentity : _subscriptionIdentity(userOrIdentity);
    if (!_hasSubscriptionIdentity(identity)) return false;
    const deviceId = getDeviceId();
    const data = await _wPost('/sub/verify', Object.assign({}, identity, { deviceId: deviceId }));
    if (!data) return false;

    if (data.allowed) {
      clearServerDeny();
      _accessAllowed = true;
      _accessPlan    = data.plan || 'trial';
      _accessToken   = data.token || null;
      _accessExpiry  = Date.now() + 2 * 60 * 60 * 1000; // 2 hours

      // Mirror to localStorage for UI display only (not used for gating)
      if (data.plan && data.plan !== 'trial') {
        localStorage.setItem(SK_PLAN,   data.plan);
        localStorage.setItem(SK_EXPIRY, data.expires_at || '');
      }
    } else {
      _accessAllowed = false;
      _accessPlan    = null;
      _accessToken   = null;
      _accessExpiry  = 0;
      rememberServerDeny(data.reason);
      if (data.reason === 'expired') {
        _subToast('⚠️ Your subscription has expired');
      } else if (data.reason === 'wrong_device') {
        _subToast('⚠️ This account is active on another device');
      }
    }
    return _accessAllowed;
  } catch (e) {
    // Network error — fall back to local check so offline still works
    console.warn('verifyAccessWithServer failed, falling back to local:', e);
    if (isServerAccessDenied()) {
      _accessAllowed = false;
      _accessPlan    = null;
      return false;
    }
    _accessAllowed = hasLocalAnyAccess();
    _accessPlan    = getLicensePlan() || (isTrialActive() ? 'trial' : null);
    return _accessAllowed;
  }
}

/* Token refresh — called if token is older than 1.5 hours */
async function _refreshTokenIfNeeded(userOrIdentity) {
  const identity = _subscriptionIdentity(userOrIdentity);
  if (!_hasSubscriptionIdentity(identity)) return;
  const remainingMs = _accessExpiry - Date.now();
  if (remainingMs > 30 * 60 * 1000) return; // still > 30 min, no need
  await verifyAccessWithServer(identity);
}

function canAccessMode(mode) {
  if (isServerAccessDenied()) return false;
  // Server token overrides everything if present and valid
  if (_accessToken && Date.now() < _accessExpiry) {
    if (!_accessAllowed) return false;
    if (mode === 'viewer') return true;   // viewer is always free
    return _accessPlan === 'pro' || _accessPlan === 'trial';
  }
  // Fallback to local (offline or before first verify)
  if (isPro()) return true;
  if (isTrialActive() && !isBasic()) return true;
  if (mode === 'viewer') return hasAnyAccess();
  return false;
}

function showModeUpgradePrompt(mode) {
  showUpgradeScreen(_subT('proRequiredForMode', 'Pro required for {mode} mode', { mode: mode }));
}

/* ── Restore plan by email from Worker ── */
async function restorePlanByIdentity(userOrIdentity) {
  const identity = (userOrIdentity && userOrIdentity.accountId !== undefined)
    ? userOrIdentity : _subscriptionIdentity(userOrIdentity);
  if (!_hasSubscriptionIdentity(identity)) return false;
  const data = await _wPost('/sub/restore', identity);
  if (!data || !data.restored) return false;
  localStorage.setItem(SK_PLAN, data.plan);
  if (data.expires_at) localStorage.setItem(SK_EXPIRY, data.expires_at);
  else localStorage.removeItem(SK_EXPIRY);
  return true;
}

async function restorePlanByEmail(email) {
  return restorePlanByIdentity(_subscriptionIdentity(email));
}

/* ── On login ── */
async function onUserLogin(userOrEmail) {
  const identity = _subscriptionIdentity(userOrEmail);
  if (!_hasSubscriptionIdentity(identity)) return;
  _initTrial();
  await _wPost('/sub/register-trial', identity);
  const restored = await restorePlanByIdentity(identity);
  if (restored) _subToast('✅ ' + _subT('planRestoredNamed', '{plan} plan restored', { plan: getLicensePlan().toUpperCase() }));
  await registerSession(identity);
  await verifyAccessWithServer(identity);
  startSessionWatch(identity);
  startPlanWatch();
  subShowTrialBanner();
}

/* ── Validate key ── */
async function validateLicenseKey(key) {
  key = key.trim().toUpperCase();
  const data = await _wPost('/sub/activate', { key });
  if (!data) return { valid: false, error: _subT('networkTryAgain', 'Network error — please try again') };
  if (!data.valid) return { valid: false, error: data.error || _subT('invalidLicenseKey', 'Invalid key') };
  return { valid: true, plan: data.plan, expiry: data.expiry };
}

/* ── Activate key ── */
async function activateLicenseKey(key) {
  key = key.trim().toUpperCase();
  const identity = _subscriptionIdentity();
  if (!_hasSubscriptionIdentity(identity)) return { valid: false, error: _subT('pleaseLoginFirst', 'Please log in first') };
  const data = await _wPost('/sub/activate', Object.assign({ key: key }, identity));
  if (!data || !data.valid) return { valid: false, error: (data && data.error) || _subT('invalidLicenseKey', 'Invalid key') };

  localStorage.setItem(SK_PLAN, data.plan);
  localStorage.setItem(SK_KEY,  key);
  if (data.expiry) localStorage.setItem(SK_EXPIRY, data.expiry);
  else localStorage.removeItem(SK_EXPIRY);

  return { valid: true, plan: data.plan, expiry: data.expiry };
}

/* ── QC: re-validate plan every 5 mins ── */
var _planTimer = null;
function startPlanWatch() {
  if (_planTimer) clearInterval(_planTimer);
  _planTimer = setInterval(async function() {
    const identity = _subscriptionIdentity();
    if (!_hasSubscriptionIdentity(identity)) return;
    const plan = getLicensePlan();
    if (!plan || plan === 'trial') return;
    const data = await _wPost('/sub/check', identity);
    if (!data) return;
    if (!data.valid || data.expired) {
      localStorage.removeItem(SK_PLAN);
      localStorage.removeItem(SK_EXPIRY);
      subShowTrialBanner();
      _subToast('⚠️ ' + _subT('licenseExpired', 'Your license has expired'));
    }
  }, 5 * 60 * 1000);
}

/* ── Session management ── */
async function registerSession(userOrIdentity) {
  const identity = (userOrIdentity && userOrIdentity.accountId !== undefined)
    ? userOrIdentity : _subscriptionIdentity(userOrIdentity);
  if (!_hasSubscriptionIdentity(identity)) return;
  const deviceId = getDeviceId();
  localStorage.setItem(SK_SID, deviceId);
  await _wPost('/sub/register-session', Object.assign({}, identity, { deviceId: deviceId }));
}

async function validateSession(userOrIdentity) {
  const identity = (userOrIdentity && userOrIdentity.accountId !== undefined)
    ? userOrIdentity : _subscriptionIdentity(userOrIdentity);
  if (!_hasSubscriptionIdentity(identity)) return true;
  const deviceId = localStorage.getItem(SK_SID) || getDeviceId();
  localStorage.setItem(SK_SID, deviceId);
  const data = await _wPost('/sub/validate-session', Object.assign({}, identity, { deviceId: deviceId }));
  if (!data) return true;
  return data.valid;
}

var _sessionTimer = null;
function startSessionWatch(userOrIdentity) {
  const identity = (userOrIdentity && userOrIdentity.accountId !== undefined)
    ? userOrIdentity : _subscriptionIdentity(userOrIdentity);
  if (_sessionTimer) clearInterval(_sessionTimer);
  _sessionTimer = setInterval(async function() {
    const valid = await validateSession(identity);
    if (!valid) {
      clearInterval(_sessionTimer);
      localStorage.removeItem(SK_SID);
      alert(_subT('loggedInAnotherDevice', 'You have been logged in on another device. Please login again.'));
      location.reload();
    }
  }, 60000);
}

/* ── Purchase requests ── */
async function createPurchaseRequest(plan) {
  const identity = _subscriptionIdentity();
  if (!_hasSubscriptionIdentity(identity)) return { success: false, error: _subT('pleaseLoginFirst', 'Please log in first') };
  return await _wPost('/sub/purchase-request', Object.assign({ plan: plan }, identity)) || { success: false, error: _subT('networkError', 'Network error') };
}

async function getPurchaseRequestStatus() {
  const identity = _subscriptionIdentity();
  if (!_hasSubscriptionIdentity(identity)) return null;
  const data = await _wPost('/sub/purchase-status', identity);
  if (!data || !data.found) return null;
  return data;
}

async function cancelPurchaseRequest() {
  const identity = _subscriptionIdentity();
  if (!_hasSubscriptionIdentity(identity)) return;
  await _wPost('/sub/purchase-cancel', identity);
}

/* ── App config (payment details) ── */
async function _getAppConfig() {
  try {
    const data = await _wPost('/sub/app-config', {});
    return data || {};
  } catch(e) { return {}; }
}

/* ── Activate from settings ── */
async function settingsActivateKey() {
  const input = document.getElementById('settingsKeyInput');
  const errEl = document.getElementById('settingsKeyError');
  const key   = input ? input.value.trim() : '';
  if (!key) { if (errEl) errEl.textContent = _subT('enterLicenseKey', 'Please enter a license key'); return; }
  if (errEl) errEl.textContent = '⏳ ' + _subT('validating', 'Validating...');
  const result = await activateLicenseKey(key);
  if (!result.valid) { if (errEl) errEl.textContent = '❌ ' + result.error; return; }
  if (errEl) errEl.textContent = '';
  if (input) input.value = '';
  subShowTrialBanner();
  _subToast('✅ ' + _subT('planActivated', '{plan} plan activated!', { plan: result.plan.toUpperCase() }));
  setTimeout(function() { location.reload(); }, 1500);
}

/* ── Activate from upgrade screen ── */
async function upgradeActivateKey() {
  const input = document.getElementById('upgradeKeyInput');
  const errEl = document.getElementById('upgradeKeyError');
  const key   = input ? input.value.trim() : '';
  if (!key) { if (errEl) errEl.textContent = _subT('enterLicenseKey', 'Please enter a license key'); return; }
  if (errEl) errEl.textContent = '⏳ ' + _subT('validating', 'Validating...');
  const result = await activateLicenseKey(key);
  if (!result.valid) { if (errEl) errEl.textContent = '❌ ' + result.error; return; }
  hideUpgradeScreen();
  subShowTrialBanner();
  _subToast('✅ ' + _subT('planActivated', '{plan} plan activated!', { plan: result.plan.toUpperCase() }));
  setTimeout(function() { location.reload(); }, 1500);
}

/* ── Settings banner ── */
function subShowTrialBanner() {
  _initTrial();
  const labelEl   = document.getElementById('settingsTrialLabel');
  const valueEl   = document.getElementById('settingsTrialValue');
  const actionsEl = document.getElementById('settingsSubActions');
  if (isServerAccessDenied()) {
    if (actionsEl) actionsEl.style.display = 'block';
    if (labelEl) labelEl.textContent = _accessDenyReason === 'wrong_device' ? _subT('deviceLocked', 'Device Locked') : _subT('trialExpired', 'Trial Expired');
    if (valueEl) { valueEl.textContent = _accessDenyReason === 'wrong_device' ? _subT('activeAnotherDevice', 'Active on another device') : _subT('subscribeToContinue', 'Subscribe to continue'); valueEl.style.color = '#e63757'; }
  } else if (isPro()) {
    const expiry = getLicenseExpiry();
    if (labelEl) labelEl.textContent = '⭐ ' + _subT('proPlan', 'Pro Plan');
    if (valueEl) { valueEl.textContent = expiry ? _subT('activeExpires', 'Active · expires {date}', { date: new Date(expiry).toLocaleDateString() }) : _subT('active', 'Active'); valueEl.style.color = '#2dce89'; }
    if (actionsEl) actionsEl.style.display = 'none';
  } else if (isBasic()) {
    if (actionsEl) actionsEl.style.display = 'block';
    const expiry = getLicenseExpiry();
    if (labelEl) labelEl.textContent = '📱 ' + _subT('basicPlan', 'Basic Plan');
    if (valueEl) { valueEl.textContent = _subT('playerOnly', 'Player only') + (expiry ? ' · ' + _subT('expiresDate', 'expires {date}', { date: new Date(expiry).toLocaleDateString() }) : ''); valueEl.style.color = '#6c63ff'; }
  } else if (isTrialActive()) {
    if (actionsEl) actionsEl.style.display = 'block';
    const days = getTrialDaysLeft();
    if (labelEl) labelEl.textContent = '🎉 ' + _subT('freeTrial', 'Free Trial');
    if (valueEl) { valueEl.textContent = _subT('daysRemainingCount', '{days} days remaining', { days: days }); valueEl.style.color = days < 10 ? '#e63757' : '#2dce89'; }
  } else {
    if (actionsEl) actionsEl.style.display = 'block';
    if (labelEl) labelEl.textContent = '⏰ ' + _subT('trialExpired', 'Trial Expired');
    if (valueEl) { valueEl.textContent = _subT('subscribeToContinue', 'Subscribe to continue'); valueEl.style.color = '#e63757'; }
  }
}

/* ── Upgrade screen ── */
async function showUpgradeScreen(reason) {
  const existing = document.getElementById('upgradeScreen');
  if (existing) { existing.style.display = 'flex'; return; }

  const daysLeft  = getTrialDaysLeft();
  const isExpired = isServerAccessDenied() || (!isTrialActive() && !isLicenseValid());
  const isBasic_  = isBasic();

  var paypal = '', paypay = '', priceBasic = '200', pricePro = '1000';
  try {
    const cfg = await _getAppConfig();
    if (cfg.paypal)      paypal     = cfg.paypal;
    if (cfg.paypay)      paypay     = cfg.paypay;
    if (cfg.price_basic) priceBasic = cfg.price_basic;
    if (cfg.price_pro)   pricePro   = cfg.price_pro;
  } catch(e) {}

  var existingReq = null, hasActivePending = false;
  try {
    existingReq      = await getPurchaseRequestStatus();
    hasActivePending = existingReq && existingReq.status === 'pending' && existingReq.hrsLeft > 0;
  } catch(e) {}

  const screen = document.createElement('div');
  screen.id = 'upgradeScreen';
  screen.style.cssText = 'position:fixed;inset:0;background:var(--bg,#0f0f1a);z-index:99998;display:flex;flex-direction:column;align-items:center;overflow-y:auto;padding:32px 20px;';

  screen.innerHTML =
    '<div style="width:100%;max-width:400px;">' +
    (!isExpired ? '<div style="text-align:right;margin-bottom:8px;">' +
      '<button class="subscription-close-x" type="button" aria-label="Close" onclick="hideUpgradeScreen()">✕</button>' +
    '</div>' : '') +
    '<div style="text-align:center;margin-bottom:28px;">' +
      '<div style="font-size:2.5rem;margin-bottom:10px;">' + (isExpired ? '⏰' : isBasic_ ? '⬆️' : '🏸') + '</div>' +
      '<div style="font-size:1.3rem;font-weight:800;color:var(--text,#fff);margin-bottom:6px;">' +
        (isExpired ? _subT('trialExpired', 'Trial Expired') : isBasic_ ? _subT('upgradeToPro', 'Upgrade to Pro') : reason || _subT('subscribe', 'Subscribe')) +
      '</div>' +
      '<div style="font-size:0.82rem;color:var(--muted,#888);">' +
        (isExpired ? _subT('trialEndedDays', 'Your 60-day trial has ended') : isBasic_ ? _subT('unlockAllFeatures', 'Unlock all features') : _subT('daysLeftTrial', '{days} days left in trial', { days: daysLeft })) +
      '</div>' +
    '</div>' +
    '<div style="background:var(--surface,#1e1e2e);border:1px solid var(--border,#2a2a4a);border-radius:16px;padding:18px;margin-bottom:12px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
        '<div style="font-weight:700;color:var(--text,#fff);">' + _subT('basic', 'Basic') + '</div>' +
        '<div style="font-size:1.1rem;font-weight:800;color:#6c63ff;">¥' + priceBasic + '<span style="font-size:0.72rem;font-weight:400;color:var(--muted,#888)">/' + _subT('year', 'year') + '</span></div>' +
      '</div>' +
      '<div style="font-size:0.75rem;color:var(--muted,#888);margin-bottom:12px;">🏸 ' + _subT('playerModeOnly', 'Player mode only') + '</div>' +
      '<button id="reqBasicBtn" data-plan="basic" style="width:100%;padding:10px;border-radius:10px;border:none;background:#6c63ff;color:#fff;font-size:0.82rem;font-weight:700;cursor:pointer;font-family:inherit;">' + _subT('requestBasicPlan', 'Request Basic Plan') + '</button>' +
    '</div>' +
    '<div style="background:linear-gradient(135deg,rgba(108,99,255,0.15),rgba(0,212,255,0.08));border:1.5px solid rgba(108,99,255,0.4);border-radius:16px;padding:18px;margin-bottom:20px;position:relative;">' +
      '<div style="position:absolute;top:-10px;right:16px;background:#6c63ff;color:#fff;font-size:0.65rem;font-weight:700;padding:3px 10px;border-radius:20px;">' + _subT('recommended', 'RECOMMENDED') + '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
        '<div style="font-weight:700;color:var(--text,#fff);">Pro</div>' +
        '<div style="font-size:1.1rem;font-weight:800;color:#6c63ff;">¥' + pricePro + '<span style="font-size:0.72rem;font-weight:400;color:var(--muted,#888)">/' + _subT('year', 'year') + '</span></div>' +
      '</div>' +
      '<div style="font-size:0.75rem;color:var(--muted,#888);margin-bottom:12px;">🏆 ' + _subT('allModesPlan', 'All modes · Organiser · Vault · Reports') + '</div>' +
      '<button id="reqProBtn" data-plan="pro" style="width:100%;padding:10px;border-radius:10px;border:none;background:linear-gradient(135deg,#7c3aed,#6c63ff);color:#fff;font-size:0.82rem;font-weight:700;cursor:pointer;font-family:inherit;">' + _subT('requestProPlan', 'Request Pro Plan') + '</button>' +
    '</div>' +
    '<div id="upgradeRequestStatus" style="margin-bottom:12px;"></div>' +
    '<div id="upgradeRequestMsg" style="color:#e63757;font-size:0.78rem;text-align:center;min-height:16px;margin-bottom:12px;"></div>' +
    '<div style="background:var(--surface,#1e1e2e);border:1px solid var(--border,#2a2a4a);border-radius:14px;padding:16px;margin-bottom:16px;">' +
      '<div style="font-size:0.78rem;color:var(--muted,#888);margin-bottom:10px;">' + _subT('alreadyHaveKey', 'Already have a key? Enter it here:') + '</div>' +
      '<input id="upgradeKeyInput" type="text" placeholder="SCS-XXXX-XXXX-XXXX"' +
        ' style="width:100%;padding:12px;border-radius:10px;border:1px solid var(--border,#2a2a4a);background:var(--bg,#0f0f1a);color:var(--text,#fff);font-size:0.9rem;text-align:center;letter-spacing:2px;margin-bottom:8px;font-family:inherit;box-sizing:border-box;"' +
        ' oninput="this.value=this.value.toUpperCase()">' +
      '<div id="upgradeKeyError" style="color:#e63757;font-size:0.75rem;min-height:16px;text-align:center;margin-bottom:8px;"></div>' +
      '<button onclick="upgradeActivateKey()" style="width:100%;padding:12px;border-radius:10px;border:none;background:linear-gradient(135deg,#7c3aed,#6c63ff);color:#fff;font-size:0.85rem;font-weight:700;cursor:pointer;font-family:inherit;">🔑 ' + _subT('activateKey', 'Activate Key') + '</button>' +
    '</div>' +
    (!isExpired ? '<button onclick="hideUpgradeScreen()" style="width:100%;padding:12px;border-radius:10px;border:1px solid var(--border,#2a2a4a);background:transparent;color:var(--muted,#888);font-size:0.82rem;cursor:pointer;font-family:inherit;">' + _subT('continueTrialDays', 'Continue with Trial ({days} days left)', { days: daysLeft }) + '</button>' : '') +
    '</div>';

  document.body.appendChild(screen);

  var basicBtn = document.getElementById('reqBasicBtn');
  var proBtn   = document.getElementById('reqProBtn');
  if (basicBtn) basicBtn.addEventListener('click', function() { submitRequest('basic'); });
  if (proBtn)   proBtn.addEventListener('click',   function() { submitRequest('pro'); });

  if (hasActivePending) _showUpgradeRequestStatus(existingReq);
}

async function _showUpgradeRequestStatus(req) {
  var el = document.getElementById('upgradeRequestStatus');
  if (!el) return;
  const cfg    = await _getAppConfig();
  var paypal = cfg.paypal || '', paypay = cfg.paypay || '';
  var contact = '';
  if (paypal) contact += 'PayPal: ' + paypal + '\n';
  if (paypay) contact += 'PayPay: ' + paypay;
  el.innerHTML =
    '<div style="background:rgba(0,230,118,0.08);border:1px solid rgba(0,230,118,0.2);border-radius:12px;padding:14px;">' +
      '<div style="color:#2dce89;font-weight:700;margin-bottom:6px;">⏳ ' + _subT('requestPendingHours', 'Request Pending — {hours}hrs left', { hours: req.hrsLeft }) + '</div>' +
      '<div style="font-size:0.78rem;color:var(--muted,#888);margin-bottom:8px;">' + _subT('planRequested', '{plan} plan requested', { plan: req.plan.toUpperCase() }) + '</div>' +
      (contact ? '<div style="font-size:0.78rem;color:var(--text,#fff);background:var(--surface,#1e1e2e);border-radius:8px;padding:10px;margin-bottom:8px;">💳 ' + _subT('paymentDetails', 'Payment details') + ': ' + contact + '</div>' : '<div style="font-size:0.78rem;color:var(--muted,#888);margin-bottom:8px;">' + _subT('paymentDetailsAfterAdmin', 'Payment details will appear after admin activates your request.') + '</div>') +
      '<button onclick="cancelAndRequest()" style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--border,#2a2a4a);background:transparent;color:var(--muted,#888);font-size:0.75rem;cursor:pointer;font-family:inherit;">' + _subT('cancelRequestAgain', 'Cancel & Request Again') + '</button>' +
    '</div>';
}

async function submitRequest(plan) {
  var msgEl = document.getElementById('upgradeRequestMsg');
  if (msgEl) msgEl.textContent = '⏳ ' + _subT('submitting', 'Submitting...');
  var result = await createPurchaseRequest(plan);
  if (!result || !result.success) { if (msgEl) msgEl.textContent = '❌ ' + (result?.error || _subT('failed', 'Failed')); return; }
  if (msgEl) msgEl.textContent = '';
  var req = await getPurchaseRequestStatus();
  if (req) await _showUpgradeRequestStatus(req);
  _subToast('✅ ' + _subT('requestSubmittedReview', 'Request submitted! Admin will review within 24 hours.'));
}

async function cancelAndRequest() {
  await cancelPurchaseRequest();
  var el = document.getElementById('upgradeRequestStatus');
  if (el) el.innerHTML = '';
  _subToast('✅ ' + _subT('requestCancelledNew', 'Cancelled. You can now submit a new request.'));
}

function hideUpgradeScreen() {
  var s = document.getElementById('upgradeScreen');
  if (s) s.remove();
}

function subPayWith(method, id, price, plan) {
  var url  = '';
  var note = encodeURIComponent('SCS ' + plan.toUpperCase() + ' plan - ¥' + price + '/year');
  if (method === 'paypal') url = 'https://' + id + '/' + price + 'JPY?note=' + note;
  if (method === 'paypay') url = 'https://qr.paypay.ne.jp/' + id;
  if (url) window.open(url, '_blank');
  setTimeout(function() { alert(_subT('afterPaymentLicenseKey', 'After payment, you will receive a license key. Enter it in the Activate box to unlock your plan.')); }, 1000);
}

function _subToast(msg) {
  if (typeof _qcToast === 'function') { _qcToast(msg); return; }
  var el = document.getElementById('subToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'subToast';
    el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--surface,#1e1e2e);color:var(--text,#fff);padding:10px 18px;border-radius:20px;font-size:0.78rem;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.4);max-width:90vw;text-align:center;border:1px solid var(--border,#2a2a4a);display:none;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(function() { el.style.display = 'none'; }, 4000);
}

function licenseCheck()      { return true; }
function showLicenseScreen() { return; }
