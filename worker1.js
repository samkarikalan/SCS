/* ============================================================
KariBRRApp — Cloudflare Worker
Handles ALL backend logic:
1. Supabase proxy  (keys never reach browser)
2. Auth proxy      (OTP send/verify)
3. Subscription    (license, purchase requests)
4. Token auth      (verify + deviceId binding)
5. Pairing algorithm (hidden from DevTools)
6. Club management (create, my-clubs, organizer access)

Environment secrets (set in Cloudflare dashboard):
SUPABASE_URL  = https://hplkoxdorbfjhwbvqatn.supabase.co
SUPABASE_KEY  = eyJ…  (your anon key)
EDGE_BASE     = https://hplkoxdorbfjhwbvqatn.supabase.co/functions/v1
TOKEN_SECRET  = any long random string you set once
============================================================ */

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }

    const url  = new URL(request.url);
    const path = url.pathname;

    try {
      if (path.startsWith('/db/'))               return cors(await handleDb(request, env, path));
      if (path === '/auth/send-otp')             return cors(await handleSendOtp(request, env));
      if (path === '/auth/verify-otp')           return cors(await handleVerifyOtp(request, env));
      if (path === '/auth/supabase-otp')         return cors(await handleSupabaseOtp(request, env));
      if (path === '/auth/supabase-verify')      return cors(await handleSupabaseVerify(request, env));
      if (path === '/auth/line/start')            return cors(await handleLineStart(request, env));
      if (path === '/auth/line/callback')         return cors(await handleLineCallback(request, env));
      if (path === '/auth/line/complete')         return cors(await handleLineComplete(request, env));
      if (path === '/auth/line/nickname')         return cors(await handleLineNickname(request, env));
      if (path === '/auth/nickname')              return cors(await handleNicknameUpdate(request, env));
      if (path === '/auth/line/handoff/create')  return cors(await handleLineHandoffCreate(request, env));
      if (path === '/auth/line/handoff/status')  return cors(await handleLineHandoffStatus(request, env));
      if (path === '/auth/line/device')           return cors(await handleLineDevice(request, env));
      if (path === '/auth/google/start')          return cors(await handleGoogleStart(request, env));
      if (path === '/auth/google/callback')       return cors(await handleGoogleCallback(request, env));
      if (path === '/auth/google/complete')       return cors(await handleGoogleComplete(request, env));
      if (path === '/auth/google/nickname')       return cors(await handleGoogleNickname(request, env));
      if (path === '/auth/google/handoff/create') return cors(await handleLineHandoffCreate(request, env));
      if (path === '/auth/google/handoff/status') return cors(await handleLineHandoffStatus(request, env));
      if (path === '/auth/google/device')         return cors(await handleGoogleDevice(request, env));
      if (path === '/sub/verify')                return cors(await handleSubVerify(request, env));
      if (path === '/sub/check')                 return cors(await handleSubCheck(request, env));
      if (path === '/sub/activate')              return cors(await handleSubActivate(request, env));
      if (path === '/sub/restore')               return cors(await handleSubRestore(request, env));
      if (path === '/sub/register-session')      return cors(await handleSubRegisterSession(request, env));
      if (path === '/sub/validate-session')      return cors(await handleSubValidateSession(request, env));
      if (path === '/sub/purchase-request')      return cors(await handlePurchaseRequest(request, env));
      if (path === '/sub/purchase-status')       return cors(await handlePurchaseStatus(request, env));
      if (path === '/sub/purchase-cancel')       return cors(await handlePurchaseCancel(request, env));
      if (path === '/sub/app-config')            return cors(await handleAppConfig(request, env));
      if (path === '/sub/admin-requests')        return cors(await handleAdminRequests(request, env));
      if (path === '/sub/admin-activate')        return cors(await handleAdminActivate(request, env));
      if (path === '/sub/purchase-cancel-by-id') return cors(await handlePurchaseCancelById(request, env));
      if (path === '/sub/register-trial')        return cors(await handleRegisterTrial(request, env));
      if (path === '/sub/admin-clubs')           return cors(await handleAdminClubs(request, env));
      if (path === '/sub/admin-subscribers')     return cors(await handleAdminSubscribers(request, env));
      if (path === '/generate-round')            return cors(await handleGenerateRound(request, env));

      // ── Club management ──────────────────────────────────────
      if (path === '/club/create')               return cors(await handleClubCreate(request, env));
      if (path === '/club/my-clubs')             return cors(await handleClubMyClubs(request, env));
      if (path === '/club/organizers')           return cors(await handleClubOrganizers(request, env));
      if (path === '/club/grant-organizer')      return cors(await handleClubGrantOrganizer(request, env));
      if (path === '/club/revoke-organizer')     return cors(await handleClubRevokeOrganizer(request, env));
      if (path === '/club/search-members')       return cors(await handleClubSearchMembers(request, env));

      if (path === '/health')                    return cors(json({ status: 'ok' }));

      return cors(json({ error: 'Not found' }, 404));
    } catch (e) {
      console.error('Worker error:', e);
      return cors(json({ error: e.message }, 500));
    }
  }
};

// ─────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function cors(response) {
  const r = new Response(response.body, response);
  r.headers.set('Access-Control-Allow-Origin', '*');
  r.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return r;
}

function sbHeaders(env) {
  return {
    'apikey':        env.SUPABASE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_KEY,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation'
  };
}

async function sbGet(env, table, query = '') {
  const url = env.SUPABASE_URL + '/rest/v1/' + table + (query ? '?' + query : '');
  const res = await fetch(url, { headers: sbHeaders(env) });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error('GET ' + table + ' failed: ' + res.status + (errText ? ' ' + errText : ''));
  }
  return res.json();
}

async function sbPost(env, table, body, prefer = 'return=representation') {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/' + table, {
    method:  'POST',
    headers: { ...sbHeaders(env), 'Prefer': prefer },
    body:    JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'POST ' + table + ' failed: ' + res.status);
  }
  return prefer.includes('return=representation') ? res.json() : res.text();
}

async function sbPatch(env, table, query, body, prefer = 'return=minimal') {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/' + table + '?' + query, {
    method:  'PATCH',
    headers: { ...sbHeaders(env), 'Prefer': prefer },
    body:    JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'PATCH ' + table + ' failed: ' + res.status);
  }
  return prefer.includes('return=representation') ? res.json() : true;
}

async function sbDelete(env, table, query) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/' + table + '?' + query, {
    method:  'DELETE',
    headers: { ...sbHeaders(env), 'Prefer': 'return=minimal' }
  });
  if (!res.ok) throw new Error('DELETE ' + table + ' failed: ' + res.status);
  return true;
}

async function sbUpsert(env, table, body, onConflict) {
  const url = env.SUPABASE_URL + '/rest/v1/' + table + '?on_conflict=' + encodeURIComponent(onConflict);
  const res = await fetch(url, {
    method:  'POST',
    headers: { ...sbHeaders(env), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body:    JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'UPSERT ' + table + ' failed: ' + res.status);
  }
  return true;
}

// ─────────────────────────────────────────────────────────────
//  TOKEN HELPERS
// ─────────────────────────────────────────────────────────────

async function signToken(payload, secret) {
  const data   = JSON.stringify(payload);
  const key    = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig    = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('');
  return btoa(data) + '.' + sigHex;
}

async function verifyToken(token, secret) {
  try {
    const [dataB64, sigHex] = token.split('.');
    if (!dataB64 || !sigHex) return null;
    const data     = atob(dataB64);
    const key      = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = new Uint8Array(sigHex.match(/.{2}/g).map(h => parseInt(h, 16)));
    const valid    = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data));
    if (!valid) return null;
    const payload  = JSON.parse(data);
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
//  SUB/VERIFY
// ─────────────────────────────────────────────────────────────

const TRIAL_DAYS = 60;

function addTrialDays(date = new Date()) {
  const d = new Date(date);
  d.setDate(d.getDate() + TRIAL_DAYS);
  return d.toISOString();
}

function cleanSubEmail(email) {
  return email ? String(email).trim().toLowerCase() : null;
}

async function resolveSubIdentity(body, env, requireSession = true) {
  const accountId = String(body.accountId || body.userAccountId || '').trim();
  let email = cleanSubEmail(body.email);
  let displayName = String(body.displayName || '').trim();
  let authProvider = String(body.authProvider || (email ? 'email' : 'line')).trim();

  if (accountId) {
    if (requireSession) {
      const sessionToken = String(body.sessionToken || '').trim();
      if (!sessionToken) return { error: 'session_required' };
      const sessions = await sbGet(env, 'active_sessions',
        'user_account_id=eq.' + encodeURIComponent(accountId) +
        '&token=eq.' + encodeURIComponent(sessionToken) + '&select=user_account_id&limit=1'
      ).catch(() => []);
      if (!sessions.length) return { error: 'invalid_session' };
    }

    const accounts = await sbGet(env, 'user_accounts',
      'id=eq.' + encodeURIComponent(accountId) + '&select=id,email,nickname,auth_provider&limit=1'
    ).catch(() => []);
    if (!accounts.length) return { error: 'account_not_found' };
    email = cleanSubEmail(accounts[0].email);
    displayName = String(accounts[0].nickname || displayName || '').trim();
    authProvider = String(accounts[0].auth_provider || authProvider || 'email').trim();
  }

  if (!accountId && !email) return { error: 'identity_required' };
  return { accountId, email, displayName, authProvider };
}

function subIdentityFilter(identity) {
  return identity.accountId
    ? 'account_id=eq.' + encodeURIComponent(identity.accountId)
    : 'email=eq.' + encodeURIComponent(identity.email);
}

async function findSubPlan(env, identity, select = 'account_id,email,display_name,auth_provider,plan,expires_at,device_id,activated_at') {
  let rows = [];
  if (identity.accountId) {
    rows = await sbGet(env, 'user_plans',
      'account_id=eq.' + encodeURIComponent(identity.accountId) + '&select=' + select + '&limit=1'
    ).catch(() => []);
    if (rows.length) {
      const metadata = {
        email: identity.email || null,
        display_name: identity.displayName || rows[0].display_name || null,
        auth_provider: identity.authProvider || rows[0].auth_provider || (identity.email ? 'email' : 'line')
      };
      await sbPatch(env, 'user_plans',
        'account_id=eq.' + encodeURIComponent(identity.accountId), metadata
      ).catch(() => {});
      Object.assign(rows[0], metadata);
    }
  }
  if (!rows.length && identity.email) {
    rows = await sbGet(env, 'user_plans',
      'email=eq.' + encodeURIComponent(identity.email) + '&select=' + select + '&limit=1'
    ).catch(() => []);
    if (rows.length && identity.accountId) {
      await sbPatch(env, 'user_plans',
        'email=eq.' + encodeURIComponent(identity.email), {
          account_id: identity.accountId,
          display_name: identity.displayName || rows[0].display_name || null,
          auth_provider: identity.authProvider || rows[0].auth_provider || 'email'
        }).catch(() => {});
      rows[0].account_id = identity.accountId;
    }
  }
  return rows;
}

async function saveSubPlan(env, identity, values) {
  const rows = await findSubPlan(env, identity);
  const identityValues = {
    account_id: identity.accountId || null,
    email: identity.email || null,
    display_name: identity.displayName || null,
    auth_provider: identity.authProvider || (identity.email ? 'email' : 'line')
  };
  if (rows.length) {
    await sbPatch(env, 'user_plans', subIdentityFilter(identity), Object.assign(identityValues, values));
  } else {
    await sbPost(env, 'user_plans', Object.assign(identityValues, values), 'return=minimal');
  }
}

async function handleSubVerify(request, env) {
  const body = await request.json();
  const deviceId = body.deviceId;
  const identity = await resolveSubIdentity(body, env);
  if (identity.error || !deviceId) return json({ allowed: false, reason: identity.error || 'missing_params' });

  const secret = env.TOKEN_SECRET || 'fallback-secret-change-me';

  const rows = await findSubPlan(env, identity);

  if (!rows || !rows.length) {
    const now = new Date().toISOString();
    const trialExpiresAt = addTrialDays(now);
    await saveSubPlan(env, identity, {
      plan:         'trial',
      activated_at: now,
      expires_at:   trialExpiresAt,
      device_id:    deviceId
    }).catch(() => {});
    const token = await signToken({
      accountId: identity.accountId || null, email: identity.email, deviceId, plan: 'trial', allowed: true,
      exp:   Date.now() + 2 * 60 * 60 * 1000
    }, secret);
    return json({ allowed: true, plan: 'trial', expires_at: trialExpiresAt, token });
  }

  const rec = rows[0];
  if (rec.plan === 'trial' && !rec.expires_at) {
    rec.expires_at = addTrialDays(rec.activated_at || new Date());
    await sbPatch(env, 'user_plans',
      subIdentityFilter(identity),
      { expires_at: rec.expires_at }
    ).catch(() => {});
  }
  if (rec.expires_at && new Date(rec.expires_at) < new Date()) return json({ allowed: false, reason: 'expired', plan: rec.plan });
  if (!rec.plan)                                                return json({ allowed: false, reason: 'no_plan' });
  if (rec.device_id && rec.device_id !== deviceId)             return json({ allowed: false, reason: 'wrong_device' });
  if (!rec.device_id) {
    await sbPatch(env, 'user_plans',
      subIdentityFilter(identity),
      { device_id: deviceId }
    ).catch(() => {});
  }

  const token = await signToken({
    accountId: identity.accountId || null, email: identity.email, deviceId, plan: rec.plan, allowed: true,
    exp:   Date.now() + 2 * 60 * 60 * 1000
  }, secret);

  return json({ allowed: true, plan: rec.plan, expires_at: rec.expires_at, token });
}

// ─────────────────────────────────────────────────────────────
//  SUPABASE PROXY
// ─────────────────────────────────────────────────────────────

const DB_ACTIONS = ['get', 'post', 'patch', 'delete', 'upsert'];
const DB_TABLE_RULES = {
  active_sessions:    ['get', 'post', 'delete', 'upsert'],
  club_join_requests: ['get', 'post', 'patch', 'delete'],
  club_organizers:    ['get', 'delete', 'upsert'],
  clubs:              ['get', 'post', 'patch', 'delete'],
  live_sessions:      ['get'],
  matches:            ['get', 'post'],
  memberships:        ['get', 'post', 'patch', 'delete'],
  player_sessions:    ['get', 'post', 'patch'],
  players:            ['get', 'post', 'patch'],
  sessions:           ['get', 'post', 'patch'],
  slot_claims:        ['get', 'post', 'patch', 'delete'],
  slots:              ['get', 'post', 'patch', 'delete'],
  venues:             ['get', 'post', 'patch', 'delete'],
  user_accounts:      ['get', 'post', 'patch'],
  user_club_roles:    ['get', 'upsert']
};
const DB_BLOCKED_TABLES = [
  'app_config',
  'line_login_handoffs',
  'licenses',
  'purchase_requests',
  'user_plans'
];

function isDbRequestAllowed(action, table) {
  if (!DB_ACTIONS.includes(action)) return false;
  if (!/^[a-z_][a-z0-9_]*$/i.test(table || '')) return false;
  if (DB_BLOCKED_TABLES.includes(table)) return false;
  const allowedActions = DB_TABLE_RULES[table];
  return Array.isArray(allowedActions) && allowedActions.includes(action);
}

async function handleDb(request, env, path) {
  const body = await request.json().catch(() => ({}));
  const { table, query = '', data, onConflict, prefer } = body;
  if (!table) return json({ error: 'table required' }, 400);
  const action = path.split('/db/')[1];
  if (!isDbRequestAllowed(action, table)) {
    return json({ error: 'DB route not allowed for this table/action' }, 403);
  }
  switch (action) {
    case 'get':    return json(await sbGet(env, table, query));
    case 'post': { const result = await sbPost(env, table, data, prefer || 'return=representation'); return json(result); }
    case 'patch': {
      const result = await sbPatch(env, table, query, data, prefer || 'return=minimal');
      return prefer && prefer.includes('return=representation') ? json(result) : json({ ok: true });
    }
    case 'delete': await sbDelete(env, table, query); return json({ ok: true });
    case 'upsert': await sbUpsert(env, table, data, onConflict); return json({ ok: true });
    default:       return json({ error: 'Unknown db action: ' + action }, 400);
  }
}

// ─────────────────────────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────────────────────────

async function handleSendOtp(request, env) {
  const { email } = await request.json();
  if (!email) return json({ error: 'email required' }, 400);
  const res = await fetch(env.EDGE_BASE + '/send-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.SUPABASE_KEY, 'apikey': env.SUPABASE_KEY },
    body: JSON.stringify({ email: email.toLowerCase().trim() })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return json({ error: data.error || 'Failed to send OTP' }, res.status);
  return json({ success: true });
}

async function handleVerifyOtp(request, env) {
  const { email, otp } = await request.json();
  if (!email || !otp) return json({ error: 'email and otp required' }, 400);
  const res = await fetch(env.EDGE_BASE + '/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.SUPABASE_KEY, 'apikey': env.SUPABASE_KEY },
    body: JSON.stringify({ email: email.toLowerCase().trim(), otp: otp.trim() })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return json({ error: data.error || 'Invalid OTP' }, res.status);
  return json({ success: true });
}

async function handleSupabaseOtp(request, env) {
  const { email } = await request.json();
  const res = await fetch(env.SUPABASE_URL + '/auth/v1/otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': env.SUPABASE_KEY },
    body: JSON.stringify({ email: email.trim().toLowerCase(), create_user: true, options: { shouldCreateUser: true } })
  });
  if (!res.ok) { const err = await res.json().catch(() => ({})); return json({ error: err.msg || err.message || 'Failed to send OTP' }, res.status); }
  return json({ success: true });
}

async function handleSupabaseVerify(request, env) {
  const { email, token } = await request.json();
  const res = await fetch(env.SUPABASE_URL + '/auth/v1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': env.SUPABASE_KEY },
    body: JSON.stringify({ email: email.trim().toLowerCase(), token: token.trim(), type: 'email' })
  });
  if (!res.ok) { const err = await res.json().catch(() => ({})); return json({ error: err.msg || err.message || 'Invalid OTP' }, res.status); }
  return json({ success: true });
}

// ─────────────────────────────────────────────────────────────
//  SUBSCRIPTION
// ─────────────────────────────────────────────────────────────

async function handleSubCheck(request, env) {
  const identity = await resolveSubIdentity(await request.json(), env);
  if (identity.error) return json({ valid: false, reason: identity.error });
  const rows = await findSubPlan(env, identity);
  if (!rows || !rows.length) return json({ valid: false });
  const rec = rows[0];
  if (!rec.plan) return json({ valid: false });
  if (rec.expires_at && new Date(rec.expires_at) < new Date()) return json({ valid: false, expired: true });
  return json({ valid: true, plan: rec.plan, expires_at: rec.expires_at });
}

async function handleSubActivate(request, env) {
  const body = await request.json();
  const { key } = body;
  if (!key) return json({ valid: false, error: 'Key required' });
  const k = key.trim().toUpperCase();
  const rows = await sbGet(env, 'licenses', 'key=eq.' + encodeURIComponent(k) + '&select=key,plan,expires_at').catch(() => []);
  if (!rows || !rows.length) return json({ valid: false, error: 'Invalid key — already used or does not exist' });
  const lic = rows[0];
  if (lic.expires_at && new Date(lic.expires_at) < new Date()) return json({ valid: false, error: 'This license key has expired' });
  const hasIdentity = !!(body.accountId || body.userAccountId || body.email);
  if (!hasIdentity) return json({ valid: true, plan: lic.plan, expiry: lic.expires_at, preview: true });
  const identity = await resolveSubIdentity(body, env);
  if (identity.error) return json({ valid: false, error: identity.error });
  await saveSubPlan(env, identity, {
    plan: lic.plan, expires_at: lic.expires_at || null, activated_at: new Date().toISOString()
  });
  await sbDelete(env, 'licenses', 'key=eq.' + encodeURIComponent(k)).catch(() => {});
  return json({ valid: true, plan: lic.plan, expiry: lic.expires_at });
}

async function handleSubRestore(request, env) {
  const identity = await resolveSubIdentity(await request.json(), env);
  if (identity.error) return json({ restored: false, reason: identity.error });
  const rows = await findSubPlan(env, identity);
  if (!rows || !rows.length) return json({ restored: false });
  const rec = rows[0];
  if (!rec.plan) return json({ restored: false });
  if (rec.expires_at && new Date(rec.expires_at) < new Date()) return json({ restored: false, expired: true });
  return json({ restored: true, plan: rec.plan, expires_at: rec.expires_at });
}

async function handleSubRegisterSession(request, env) {
  const body = await request.json();
  const identity = await resolveSubIdentity(body, env);
  if (identity.error || !body.deviceId) return json({ ok: false, reason: identity.error || 'device_required' });
  const rows = await findSubPlan(env, identity);
  if (rows.length) await sbPatch(env, 'user_plans', subIdentityFilter(identity), { device_id: body.deviceId }).catch(() => {});
  return json({ ok: true });
}

async function handleSubValidateSession(request, env) {
  const body = await request.json();
  const identity = await resolveSubIdentity(body, env);
  if (identity.error || !body.deviceId) return json({ valid: false, reason: identity.error || 'device_required' });
  const rows = await findSubPlan(env, identity);
  if (!rows || !rows.length) return json({ valid: true });
  const remote = rows[0].device_id;
  if (!remote) return json({ valid: true });
  return json({ valid: remote === body.deviceId });
}

async function handlePurchaseRequest(request, env) {
  const body = await request.json();
  const identity = await resolveSubIdentity(body, env);
  const plan = body.plan;
  if (identity.error || !plan) return json({ success: false, error: identity.error || 'plan required' });
  await sbDelete(env, 'purchase_requests', subIdentityFilter(identity) + '&status=eq.pending').catch(() => {});
  try {
    await sbPost(env, 'purchase_requests', {
      account_id: identity.accountId || null,
      email: identity.email || null,
      display_name: identity.displayName || null,
      auth_provider: identity.authProvider || (identity.email ? 'email' : 'line'),
      plan, status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, 'return=minimal');
  } catch(e) {
    return json({ success: false, error: e.message });
  }
  return json({ success: true });
}

async function handlePurchaseStatus(request, env) {
  const identity = await resolveSubIdentity(await request.json(), env);
  if (identity.error) return json({ found: false, reason: identity.error });
  const rows = await sbGet(env, 'purchase_requests',
    subIdentityFilter(identity) + '&status=eq.pending&order=created_at.desc&limit=1&select=plan,status,created_at'
  ).catch(() => []);
  if (!rows || !rows.length) return json({ found: false });
  const req       = rows[0];
  const expiresAt = new Date(new Date(req.created_at).getTime() + 48 * 60 * 60 * 1000);
  const hrsLeft   = Math.max(0, Math.ceil((expiresAt - Date.now()) / 3600000));
  if (hrsLeft <= 0) return json({ found: false });
  return json({ found: true, plan: req.plan, hrsLeft, status: req.status });
}

async function handlePurchaseCancel(request, env) {
  const identity = await resolveSubIdentity(await request.json(), env);
  if (identity.error) return json({ ok: false, reason: identity.error });
  await sbDelete(env, 'purchase_requests', subIdentityFilter(identity) + '&status=eq.pending').catch(() => {});
  return json({ ok: true });
}

async function handleAppConfig(request, env) {
  const rows = await sbGet(env, 'app_config', 'select=key,value').catch(() => []);
  const cfg  = {};
  (rows || []).forEach(r => { cfg[r.key] = r.value; });
  return json(cfg);
}

async function handleAdminRequests(request, env) {
  const rows = await sbGet(env, 'purchase_requests',
    'status=eq.pending&order=created_at.asc&select=id,account_id,email,display_name,auth_provider,plan,created_at'
  ).catch(() => []);
  const requests = (rows || []).map(row => ({
    ...row,
    real_email: row.email || null,
    subscriber_name: row.display_name || row.email || 'LINE player',
    display_identity: row.email || ((row.display_name || 'LINE player') + ' (LINE)'),
    // Backward compatibility for the existing email-only License Manager UI.
    email: row.email || ((row.display_name || 'LINE player') + ' (LINE)')
  }));
  return json({ requests });
}

async function handleAdminActivate(request, env) {
  const body = await request.json();
  let { email, plan, expiresAt, requestId } = body;
  let identity = {
    accountId: String(body.accountId || body.userAccountId || '').trim(),
    email: cleanSubEmail(email),
    displayName: String(body.displayName || '').trim(),
    authProvider: String(body.authProvider || (email ? 'email' : 'line')).trim()
  };
  if (requestId && (!identity.accountId || !identity.displayName)) {
    const requests = await sbGet(env, 'purchase_requests',
      'id=eq.' + encodeURIComponent(requestId) + '&select=account_id,email,display_name,auth_provider,plan&limit=1'
    ).catch(() => []);
    if (requests.length) {
      identity.accountId = String(requests[0].account_id || identity.accountId || '').trim();
      // The License Manager may send the display fallback in its legacy email
      // field. Always trust the stored request's real email instead.
      identity.email = cleanSubEmail(requests[0].email);
      identity.displayName = String(requests[0].display_name || identity.displayName || '').trim();
      identity.authProvider = String(requests[0].auth_provider || identity.authProvider || 'email').trim();
      plan = plan || requests[0].plan;
    }
  }
  if ((!identity.accountId && !identity.email) || !plan) return json({ success: false, error: 'account and plan required' });
  function genKey() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const seg   = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return [seg(), seg(), seg(), seg()].join('-');
  }
  const key = genKey();
  try {
    await saveSubPlan(env, identity, {
      plan,
      expires_at: expiresAt || null, activated_at: new Date().toISOString()
    });
    await sbPost(env, 'licenses', { key, plan, expires_at: expiresAt || null }, 'return=minimal').catch(() => {});
    if (requestId) {
      await sbPatch(env, 'purchase_requests', 'id=eq.' + requestId, {
        status: 'accepted', updated_at: new Date().toISOString()
      }).catch(() => {});
    }
    return json({ success: true, key, expiresAt: expiresAt || null });
  } catch(e) {
    return json({ success: false, error: e.message });
  }
}

async function handlePurchaseCancelById(request, env) {
  const { requestId } = await request.json();
  if (!requestId) return json({ ok: false });
  await sbPatch(env, 'purchase_requests', 'id=eq.' + requestId, { status: 'dismissed' }).catch(() => {});
  return json({ ok: true });
}

async function handleRegisterTrial(request, env) {
  const identity = await resolveSubIdentity(await request.json(), env);
  if (identity.error) return json({ ok: false, reason: identity.error });
  const existing = await findSubPlan(env, identity);

  if (existing.length) {
    const rec = existing[0];
    if (rec.plan === 'trial' && !rec.expires_at) {
      const expiresAt = addTrialDays(rec.activated_at || new Date());
      await sbPatch(env, 'user_plans',
        subIdentityFilter(identity),
        { expires_at: expiresAt }
      ).catch(() => {});
      return json({ ok: true, backfilled: true, expires_at: expiresAt });
    }
    return json({ ok: true, skipped: true });
  }

  const now = new Date().toISOString();

  await saveSubPlan(env, identity, {
    plan:         'trial',
    activated_at: now,
    expires_at:   addTrialDays(now)
  }).catch(() => {});

  return json({ ok: true });
}

async function handleAdminClubs(request, env) {
  // Fetch all clubs, then join with user_accounts to get owner email/nickname
  const clubs = await sbGet(env, 'clubs', 'select=id,name,created_at,created_by&order=created_at.asc').catch(() => []);
  if (!clubs.length) return json({ clubs: [] });

  // Get unique owner IDs
  const ownerIds = [...new Set(clubs.map(c => c.created_by).filter(Boolean))];
  let accountMap = {};
  if (ownerIds.length) {
    const accounts = await sbGet(env, 'user_accounts',
      'id=in.(' + ownerIds.join(',') + ')&select=id,email,nickname'
    ).catch(() => []);
    for (const a of accounts) accountMap[a.id] = a;
  }

  const result = clubs.map(c => ({
    id:         c.id,
    name:       c.name,
    created_at: c.created_at,
    owner_email:    accountMap[c.created_by]?.email    || '—',
    owner_nickname: accountMap[c.created_by]?.nickname || '—',
  }));

  return json({ clubs: result });
}

async function handleAdminSubscribers(request, env) {
  const rows = await sbGet(env, 'user_plans',
    'select=account_id,email,display_name,auth_provider,plan,expires_at,activated_at&order=activated_at.desc'
  ).catch(() => []);
  const subscribers = (rows || []).map(row => ({
    ...row,
    real_email: row.email || null,
    subscriber_name: row.display_name || row.email || 'LINE player',
    display_identity: row.email || ((row.display_name || 'LINE player') + ' (LINE)'),
    // Backward compatibility for the existing email-only License Manager UI.
    email: row.email || ((row.display_name || 'LINE player') + ' (LINE)')
  }));
  return json({ subscribers });
}

// ─────────────────────────────────────────────────────────────
//  CLUB MANAGEMENT
// ─────────────────────────────────────────────────────────────

const MAX_CLUBS_PER_OWNER = 5;

async function handleClubCreate(request, env) {
  const { userAccountId, name, select_password, admin_password } = await request.json();
  if (!userAccountId)   return json({ error: 'userAccountId required' }, 400);
  if (!name?.trim())    return json({ error: 'Club name required' }, 400);
  if (!admin_password)  return json({ error: 'Admin password required' }, 400);
  const internalMemberKey = select_password || ('membership-only-' + crypto.randomUUID());
  if (internalMemberKey === admin_password) return json({ error: 'Admin password is invalid' }, 400);

  const existing = await sbGet(env, 'clubs', 'created_by=eq.' + userAccountId + '&select=id').catch(() => []);
  if (existing.length >= MAX_CLUBS_PER_OWNER) {
    return json({ error: 'You can only create up to ' + MAX_CLUBS_PER_OWNER + ' clubs.', limitReached: true }, 400);
  }

  const res = await fetch(env.SUPABASE_URL + '/rest/v1/clubs', {
    method:  'POST',
    headers: { ...sbHeaders(env), 'Prefer': 'return=representation' },
    body:    JSON.stringify({ name: name.trim(), select_password: internalMemberKey, admin_password, created_by: userAccountId })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return json({ error: err.message || 'Failed to create club' }, 500);
  }
  const created = await res.json();
  return json({ club: created[0] });
}

async function handleClubMyClubs(request, env) {
  const { userAccountId } = await request.json();
  if (!userAccountId) return json({ error: 'userAccountId required' }, 400);

  const owned = await sbGet(env, 'clubs',
    'created_by=eq.' + userAccountId + '&select=id,name,created_at&order=created_at.asc'
  ).catch(() => []);

  const permissions = await sbGet(env, 'club_organizers',
    'user_account_id=eq.' + userAccountId + '&select=club_id'
  ).catch(() => []);

  let permitted = [];
  if (permissions.length) {
    const ownedIds = new Set(owned.map(c => c.id));
    const toFetch  = permissions.map(p => p.club_id).filter(id => !ownedIds.has(id));
    if (toFetch.length) {
      permitted = await sbGet(env, 'clubs',
        'id=in.(' + toFetch.join(',') + ')&select=id,name,created_at&order=name.asc'
      ).catch(() => []);
    }
  }

  return json({
    owned:     owned.map(c => ({ ...c, role: 'owner' })),
    permitted: permitted.map(c => ({ ...c, role: 'organizer' })),
    total:     owned.length + permitted.length
  });
}

async function handleClubOrganizers(request, env) {
  const { clubId, userAccountId, adminPassword } = await request.json();
  if (!clubId) return json({ error: 'clubId required' }, 400);

  const club = await sbGet(env, 'clubs', 'id=eq.' + clubId + '&select=created_by,admin_password').catch(() => []);
  if (!club.length) return json({ error: 'Club not found' }, 404);
  const isOwnerById = club[0].created_by && club[0].created_by === userAccountId;
  const isOwnerByPw = adminPassword && club[0].admin_password === adminPassword;
  if (!isOwnerById && !isOwnerByPw) {
    return json({ error: 'Only the club owner can view organizers' }, 403);
  }

  const rows = await sbGet(env, 'club_organizers', 'club_id=eq.' + clubId + '&select=user_account_id').catch(() => []);
  if (!rows.length) return json({ organizers: [] });

  const ids      = rows.map(r => r.user_account_id);
  const accounts = await sbGet(env, 'user_accounts',
    'id=in.(' + ids.join(',') + ')&select=id,nickname,email'
  ).catch(() => []);

  return json({ organizers: accounts });
}

async function handleClubGrantOrganizer(request, env) {
  const { clubId, userAccountId, targetUserAccountId, adminPassword } = await request.json();
  if (!clubId || !targetUserAccountId) return json({ error: 'clubId and targetUserAccountId required' }, 400);

  const club = await sbGet(env, 'clubs', 'id=eq.' + clubId + '&select=created_by,admin_password').catch(() => []);
  if (!club.length) return json({ error: 'Club not found' }, 404);
  const isOwnerById = club[0].created_by && club[0].created_by === userAccountId;
  const isOwnerByPw = adminPassword && club[0].admin_password === adminPassword;
  if (!isOwnerById && !isOwnerByPw) {
    return json({ error: 'Only the club owner can grant organizer access' }, 403);
  }

  const membership = await sbGet(env, 'memberships',
    'club_id=eq.' + clubId + '&user_account_id=eq.' + targetUserAccountId + '&select=id'
  ).catch(() => []);
  if (!membership.length) return json({ error: 'This person is not a member of your club' }, 400);

  await sbUpsert(env, 'club_organizers',
    { club_id: clubId, user_account_id: targetUserAccountId },
    'club_id,user_account_id'
  ).catch(() => {});

  return json({ success: true });
}

async function handleClubRevokeOrganizer(request, env) {
  const { clubId, userAccountId, targetUserAccountId, adminPassword } = await request.json();
  if (!clubId || !targetUserAccountId) return json({ error: 'clubId and targetUserAccountId required' }, 400);

  const club = await sbGet(env, 'clubs', 'id=eq.' + clubId + '&select=created_by,admin_password').catch(() => []);
  if (!club.length) return json({ error: 'Club not found' }, 404);
  const isOwnerById = club[0].created_by && club[0].created_by === userAccountId;
  const isOwnerByPw = adminPassword && club[0].admin_password === adminPassword;
  if (!isOwnerById && !isOwnerByPw) {
    return json({ error: 'Only the club owner can revoke organizer access' }, 403);
  }

  await sbDelete(env, 'club_organizers',
    'club_id=eq.' + clubId + '&user_account_id=eq.' + targetUserAccountId
  ).catch(() => {});

  return json({ success: true });
}

async function handleClubSearchMembers(request, env) {
  const { clubId, userAccountId, query = '', adminPassword } = await request.json();
  if (!clubId) return json({ error: 'clubId required' }, 400);

  const club = await sbGet(env, 'clubs', 'id=eq.' + clubId + '&select=created_by,admin_password').catch(() => []);
  if (!club.length) return json({ error: 'Club not found' }, 404);
  const isOwnerById = club[0].created_by && club[0].created_by === userAccountId;
  const isOwnerByPw = adminPassword && club[0].admin_password === adminPassword;
  if (!isOwnerById && !isOwnerByPw) {
    return json({ error: 'Only the club owner can search members' }, 403);
  }

  const memberships = await sbGet(env, 'memberships',
    'club_id=eq.' + clubId + '&select=user_account_id,nickname'
  ).catch(() => []);

  const granted    = await sbGet(env, 'club_organizers', 'club_id=eq.' + clubId + '&select=user_account_id').catch(() => []);
  const grantedSet = new Set(granted.map(g => g.user_account_id));

  // FIX: use club[0].created_by as the owner reference (works even when
  // userAccountId is null, i.e. password-only vault auth)
  const ownerId  = club[0].created_by || null;
  const eligible = memberships.filter(m =>
    m.user_account_id &&
    m.user_account_id !== ownerId &&
    m.user_account_id !== userAccountId &&
    !grantedSet.has(m.user_account_id)
  );
  if (!eligible.length) return json({ members: [] });

  const ids      = eligible.map(m => m.user_account_id);
  const accounts = await sbGet(env, 'user_accounts',
    'id=in.(' + ids.join(',') + ')&select=id,nickname,email'
  ).catch(() => []);

  const q        = query.trim().toLowerCase();
  const filtered = q
    ? accounts.filter(a => a.nickname?.toLowerCase().includes(q) || a.email?.toLowerCase().includes(q))
    : accounts;

  return json({ members: filtered });
}

// ─────────────────────────────────────────────────────────────
//  PAIRING ALGORITHM
// ─────────────────────────────────────────────────────────────

function pairKey(a, b) { return [a, b].sort().join('&'); }
function gameKey(p1, p2) { return [[p1[0],p1[1]].sort().join('&'), [p2[0],p2[1]].sort().join('&')].sort().join(':'); }

function shuffle(arr) {
  arr = [...arr];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getRating(name, allPlayers) {
  const p = allPlayers.find(p => p.name === name);
  if (!p) return 1.0;
  return parseFloat(p.clubRating || p.rating || 1.0);
}

function getGender(name, allPlayers) {
  const p = allPlayers.find(p => p.name === name);
  return p ? p.gender : null;
}

function selectRestingAndPlaying(state) {
  // In Standard mode every format uses the same participation-first DFS.
  // Typed-game and freshness logic may arrange only this fixed playing group.
  if (state.topDownStandardMode) return selectStandardParticipantsDFS(state);
  const { activeplayers, numCourts, fixedPairs, restQueue, courtFormats = [], courtTypes = [], allPlayers = [], pairPlayedSet, opponentMap = {} } = state;
  const total           = activeplayers.length;
  const playersPerRound = courtFormats.length
    ? courtFormats.reduce((sum, fmt) => sum + (fmt === 'singles' ? 2 : 4), 0)
    : numCourts * 4;
  const numResting      = Math.max(total - playersPerRound, 0);
  let resting = [], playing = [];
  if (fixedPairs.length && numResting >= 2) {
    let needed = numResting;
    const fmap = new Map();
    for (const [a, b] of fixedPairs) { fmap.set(a, b); fmap.set(b, a); }
    for (const p of restQueue) {
      if (resting.includes(p)) continue;
      const partner = fmap.get(p);
      if (partner) {
        if (needed >= 2) { resting.push(p, partner); needed -= 2; }
      } else if (needed > 0) { resting.push(p); needed -= 1; }
      if (needed <= 0) break;
    }
    playing = activeplayers.filter(p => !resting.includes(p));
  } else {
    resting = [...restQueue].slice(0, numResting);
    playing = activeplayers.filter(p => !resting.includes(p)).slice(0, playersPerRound);
  }

  // ── Gender balancing for typed courts (MD/LD/XD) ──────────────────────────
  // If typed courts need more men or women than currently playing,
  // pull least-recently-rested players of needed gender from resting,
  // push most-recently-played surplus gender to resting.
  // This ensures typed courts get enough players while keeping rest fair.
  const hasTypedDoubles = courtTypes.some(t => t === 'MD' || t === 'LD' || t === 'XD');
  if (hasTypedDoubles && numResting > 0) {
    const genderOf = p => {
      const pl = allPlayers.find(x => x.name === p);
      return pl ? pl.gender : 'Male';
    };

    // Count what typed courts need
    let menNeeded = 0, womenNeeded = 0;
    for (let c = 0; c < numCourts; c++) {
      const fmt  = courtFormats[c] || 'doubles';
      const type = courtTypes[c]   || 'free';
      if (fmt === 'singles') continue;
      if (type === 'MD') menNeeded   += 4;
      if (type === 'LD') womenNeeded += 4;
      if (type === 'XD') { menNeeded += 2; womenNeeded += 2; }
    }

    const playingMen   = playing.filter(p => genderOf(p) === 'Male');
    const playingWomen = playing.filter(p => genderOf(p) === 'Female');

    // Sort resting by restQueue position — front = rested longest = pull in first
    const restingMen   = restQueue.filter(p => resting.includes(p) && genderOf(p) === 'Male');
    const restingWomen = restQueue.filter(p => resting.includes(p) && genderOf(p) === 'Female');

    function swapIn(needed, currentPlaying, restPool, surplusPlaying) {
      const shortfall = needed - currentPlaying.length;
      if (shortfall <= 0) return;
      const canSwap = Math.min(shortfall, restPool.length, surplusPlaying.length);
      for (let i = 0; i < canSwap; i++) {
        const pullIn  = restPool[i];
        const pushOut = surplusPlaying[surplusPlaying.length - 1 - i];
        resting = resting.filter(p => p !== pullIn);
        resting.push(pushOut);
        playing = playing.filter(p => p !== pushOut);
        playing.push(pullIn);
      }
    }

    // Fix men shortfall — swap in resting men, push out surplus women
    if (menNeeded > playingMen.length) {
      swapIn(menNeeded, playingMen, restingMen, [...playingWomen]);
    }
    // Fix women shortfall — swap in resting women, push out surplus men
    const updatedMen   = playing.filter(p => genderOf(p) === 'Male');
    const updatedWomen = playing.filter(p => genderOf(p) === 'Female');
    if (womenNeeded > updatedWomen.length) {
      swapIn(womenNeeded, updatedWomen, restingWomen, [...updatedMen]);
    }
  }

  // Unique Games must never change the players selected by the existing
  // play/rest algorithm. Court grouping and pair selection happen later in
  // randomRound(), using only this fixed `playing` list.

  return { resting, playing };
}

function reorderFreePlayersByLastRound(freePlayers, lastRound, numCourts) {
  if (!numCourts || !freePlayers.length) return [...freePlayers];
  const total     = freePlayers.length;
  const base      = Math.floor(total / numCourts);
  const rem       = total % numCourts;
  const caps      = Array.from({ length: numCourts }, (_, i) => base + (i < rem ? 1 : 0));
  const lrSet     = new Set(lastRound);
  const nonPlayed = freePlayers.filter(p => !lrSet.has(p));
  const played    = freePlayers.filter(p =>  lrSet.has(p));
  const courts    = Array.from({ length: numCourts }, () => []);
  let c = 0;
  const distribute = list => {
    for (const p of list) {
      while (courts[c].length >= caps[c]) c = (c + 1) % numCourts;
      courts[c].push(p);
      c = (c + 1) % numCourts;
    }
  };
  distribute(nonPlayed);
  distribute(played);
  return courts.flat();
}

function getNextFixedPairGames(state, fixedPairs, numCourts) {
  const hash = JSON.stringify(fixedPairs);
  if (!state.fixedPairGameQueue || !state.fixedPairGameQueue.length || state.fixedPairGameQueueHash !== hash) {
    state.fixedPairGameQueueHash = hash;
    state.fixedPairGameQueue =
      fixedPairs.flatMap((p1, i) => fixedPairs.slice(i + 1).map(p2 => ({ pair1: p1, pair2: p2 })));
  }
  const games = [], used = new Set(), remaining = [];
  for (const g of state.fixedPairGameQueue) {
    const k1 = g.pair1.join('&'), k2 = g.pair2.join('&');
    if (games.length >= numCourts || used.has(k1) || used.has(k2)) { remaining.push(g); continue; }
    games.push({ court: games.length + 1, pair1: [...g.pair1], pair2: [...g.pair2] });
    used.add(k1); used.add(k2);
  }
  state.fixedPairGameQueue = remaining;
  return games;
}

function findDisjointPairs(playing, pairPlayedSet, required, opponentMap) {
  const allPairs = [], unused = [], used = [];
  for (let i = 0; i < playing.length; i++) {
    for (let j = i + 1; j < playing.length; j++) {
      const a = playing[i], b = playing[j];
      const key   = pairKey(a, b);
      const isNew = !pairPlayedSet.has(key);
      const obj   = { a, b, key, isNew };
      allPairs.push(obj);
      if (isNew) unused.push(obj); else used.push(obj);
    }
  }
  function oppScore(pair, selected) {
    let score = 0;
    const [a, b] = pair;
    for (const [x, y] of selected) {
      for (const bp of [a, b]) {
        let n = 0;
        for (const ap of [x, y]) if ((opponentMap[bp] || {})[ap] === 1) n++;
        score += n === 2 ? 2 : n === 1 ? 1 : 0;
      }
    }
    return score;
  }
  function pickBest(candidates) {
    const usedP = new Set(), sel = [];
    let best = null, branches = 0;
    const MAX = 15000;
    function dfs(start, score) {
      if (branches++ > MAX) return;
      if (sel.length === required) {
        if (!best || score > best.score) best = { score, pairs: sel.map(p => [...p]) };
        return;
      }
      if (candidates.length - start < required - sel.length) return;
      for (let i = start; i < candidates.length; i++) {
        const { a, b, isNew } = candidates[i];
        if (usedP.has(a) || usedP.has(b)) continue;
        usedP.add(a); usedP.add(b); sel.push([a, b]);
        dfs(i + 1, score + (isNew ? 100 : 0) + oppScore([a, b], sel.slice(0, -1)));
        sel.pop(); usedP.delete(a); usedP.delete(b);
      }
    }
    dfs(0, 0);
    return best ? best.pairs : null;
  }
  if (unused.length >= required)   { const r = pickBest(unused);   if (r) return r; }
  const combined = [...unused, ...used];
  if (combined.length >= required) { const r = pickBest(combined); if (r) return r; }
  if (allPairs.length >= required) { const r = pickBest(allPairs); if (r) return r; }
  return [];
}

function buildXDPairs(men, women, pairPlayedSet, required, opponentMap) {
  // Generate only cross-gender pairs (man + woman)
  const allPairs = [], unused = [], used = [];
  for (const m of men) {
    for (const w of women) {
      const key   = pairKey(m, w);
      const isNew = !pairPlayedSet.has(key);
      const obj   = { a: m, b: w, key, isNew };
      allPairs.push(obj);
      if (isNew) unused.push(obj); else used.push(obj);
    }
  }

  // Same opponent score helper as findDisjointPairs
  function oppScore(pair, selected) {
    let score = 0;
    const [a, b] = pair;
    for (const [x, y] of selected) {
      for (const bp of [a, b]) {
        let n = 0;
        for (const ap of [x, y]) if ((opponentMap[bp] || {})[ap] === 1) n++;
        score += n === 2 ? 2 : n === 1 ? 1 : 0;
      }
    }
    return score;
  }

  // Same DFS pickBest as findDisjointPairs
  function pickBest(candidates) {
    const usedP = new Set(), sel = [];
    let best = null, branches = 0;
    const MAX = 15000;
    function dfs(start, score) {
      if (branches++ > MAX) return;
      if (sel.length === required) {
        if (!best || score > best.score) best = { score, pairs: sel.map(p => [...p]) };
        return;
      }
      if (candidates.length - start < required - sel.length) return;
      for (let i = start; i < candidates.length; i++) {
        const { a, b, isNew } = candidates[i];
        if (usedP.has(a) || usedP.has(b)) continue;
        usedP.add(a); usedP.add(b); sel.push([a, b]);
        dfs(i + 1, score + (isNew ? 100 : 0) + oppScore([a, b], sel.slice(0, -1)));
        sel.pop(); usedP.delete(a); usedP.delete(b);
      }
    }
    dfs(0, 0);
    return best ? best.pairs : null;
  }

  // Try unused first, then combined, then all
  if (unused.length >= required)   { const r = pickBest(unused);              if (r) return r; }
  const combined = [...unused, ...used];
  if (combined.length >= required) { const r = pickBest(combined);            if (r) return r; }
  if (allPairs.length >= required) { const r = pickBest(allPairs);            if (r) return r; }
  return [];
}

function getMatchupScores(allPairs, opponentMap) {
  const scores = [];
  for (let i = 0; i < allPairs.length; i++) {
    for (let j = i + 1; j < allPairs.length; j++) {
      const [a1, a2] = allPairs[i], [b1, b2] = allPairs[j];
      const ab11 = (opponentMap[a1] || {})[b1] || 0;
      const ab12 = (opponentMap[a1] || {})[b2] || 0;
      const ab21 = (opponentMap[a2] || {})[b1] || 0;
      const ab22 = (opponentMap[a2] || {})[b2] || 0;
      const total = ab11 + ab12 + ab21 + ab22;
      const fresh = [ab11, ab12, ab21, ab22].filter(v => v === 0).length;
      const of_   = {
        a1: (ab11===0?1:0)+(ab12===0?1:0), a2: (ab21===0?1:0)+(ab22===0?1:0),
        b1: (ab11===0?1:0)+(ab21===0?1:0), b2: (ab12===0?1:0)+(ab22===0?1:0)
      };
      scores.push({ pair1: allPairs[i], pair2: allPairs[j], freshness: fresh, totalScore: total, of: of_ });
    }
  }
  scores.sort((a, b) => {
    if (b.freshness !== a.freshness) return b.freshness - a.freshness;
    if (a.totalScore !== b.totalScore) return a.totalScore - b.totalScore;
    const sa = a.of.a1+a.of.a2+a.of.b1+a.of.b2, sb = b.of.a1+b.of.a2+b.of.b1+b.of.b2;
    return sb - sa;
  });
  return scores;
}


// Build free-doubles games from the already-selected playing list.
// Previous-round rested players are distributed across courts first, then
// remaining players are shuffled/swapped between groups to maximise unique
// partnerships. The play/rest decision itself is never changed here.
function buildGroupedUniqueGames(state, playing) {
  const { numCourts, pairPlayedSet, opponentMap = {}, allRounds = [] } = state;
  if (!numCourts || playing.length !== numCourts * 4) return null;

  const last = allRounds.length ? allRounds[allRounds.length - 1] : null;
  const lastPlaying = new Set(
    last?.games ? last.games.flatMap(g => [...(g.pair1 || []), ...(g.pair2 || [])]) : []
  );
  const returningRested = playing.filter(p => last && !lastPlaying.has(p));
  const continuing = playing.filter(p => !returningRested.includes(p));

  function arrangements(group) {
    const [a,b,c,d] = group;
    return [
      [[a,b],[c,d]],
      [[a,c],[b,d]],
      [[a,d],[b,c]],
    ];
  }

  function scoreGame(pair1, pair2) {
    const partnerRepeats =
      (pairPlayedSet.has(pairKey(pair1[0], pair1[1])) ? 1 : 0) +
      (pairPlayedSet.has(pairKey(pair2[0], pair2[1])) ? 1 : 0);
    let opponentRepeats = 0;
    for (const a of pair1) for (const b of pair2) {
      opponentRepeats += Number((opponentMap[a] || {})[b] || 0);
    }
    return { partnerRepeats, opponentRepeats };
  }

  let best = null;
  const attempts = Math.max(300, numCourts * 250);

  for (let attempt = 0; attempt < attempts; attempt++) {
    const groups = Array.from({ length: numCourts }, () => []);
    const rr = shuffle(returningRested);
    const cc = shuffle(continuing);
    const courtOffset = attempt % numCourts;

    // Spread last-round rested players as evenly as possible. Rotate the court
    // receiving any extra player so the same court is not favoured repeatedly.
    rr.forEach((p, i) => groups[(courtOffset + i) % numCourts].push(p));

    // Fill all remaining court positions from the unchanged playing list.
    for (let c = 0; c < numCourts; c++) {
      while (groups[c].length < 4 && cc.length) groups[c].push(cc.pop());
    }
    if (groups.some(g => g.length !== 4)) continue;

    const games = [];
    let partnerRepeats = 0;
    let opponentRepeats = 0;

    for (let c = 0; c < numCourts; c++) {
      let courtBest = null;
      for (const [pair1, pair2] of arrangements(groups[c])) {
        const sc = scoreGame(pair1, pair2);
        const key = [sc.partnerRepeats, sc.opponentRepeats, Math.random()];
        if (!courtBest || key[0] < courtBest.key[0] ||
            (key[0] === courtBest.key[0] && key[1] < courtBest.key[1]) ||
            (key[0] === courtBest.key[0] && key[1] === courtBest.key[1] && key[2] < courtBest.key[2])) {
          courtBest = { key, pair1, pair2, sc };
        }
      }
      partnerRepeats += courtBest.sc.partnerRepeats;
      opponentRepeats += courtBest.sc.opponentRepeats;
      games.push({ court: c + 1, pair1: [...courtBest.pair1], pair2: [...courtBest.pair2] });
    }

    const key = [partnerRepeats, opponentRepeats];
    if (!best || key[0] < best.key[0] || (key[0] === best.key[0] && key[1] < best.key[1])) {
      best = { key, games };
      if (partnerRepeats === 0 && opponentRepeats === 0) break;
    }
  }

  return best?.games || null;
}


// Standard V2: participation-first DFS.
// Stage 1 chooses the playing/resting group using only participation fairness.
// Stage 2 reuses the proven pair/opponent search inside that fixed group.
function selectStandardParticipantsDFS(state) {
  const active = [...(state.activeplayers || [])];
  const requestedSlots = (state.courtFormats || []).length
    ? state.courtFormats.reduce((sum, fmt) => sum + (fmt === 'singles' ? 2 : 4), 0)
    : (state.numCourts || 0) * 4;
  const slots = Math.min(active.length, Math.max(0, requestedSlots));
  const restNeeded = active.length - slots;
  const playedCount = state.playedCount || {};
  const restCount = state.restCount || {};
  const previousRest = new Set();
  const rounds = state.allRounds || [];
  if (rounds.length) {
    for (const raw of rounds[rounds.length - 1]?.resting || []) {
      previousRest.add(String(raw).split('#')[0]);
    }
  }
  if (restNeeded <= 0) return { playing: active, resting: [] };

  const fixedMap = new Map();
  for (const [a,b] of state.fixedPairs || []) {
    if (active.includes(a) && active.includes(b)) {
      fixedMap.set(a,b); fixedMap.set(b,a);
    }
  }
  const units = [];
  const seen = new Set();
  for (const p of active) {
    if (seen.has(p)) continue;
    const mate = fixedMap.get(p);
    if (mate && !seen.has(mate)) {
      units.push([p,mate]); seen.add(p); seen.add(mate);
    } else {
      units.push([p]); seen.add(p);
    }
  }

  const qpos = new Map((state.restQueue || []).map((p,i)=>[p,i]));
  let best = null;
  const chosen = [];

  function score(resting) {
    const restSet = new Set(resting);
    const afterPlayed = active.map(p => (playedCount[p] || 0) + (restSet.has(p) ? 0 : 1));
    const afterRest = active.map(p => (restCount[p] || 0) + (restSet.has(p) ? 1 : 0));
    const playedSpread = Math.max(...afterPlayed) - Math.min(...afterPlayed);
    const restSpread = Math.max(...afterRest) - Math.min(...afterRest);
    const playedSquares = afterPlayed.reduce((a,v)=>a+v*v,0);
    const restSquares = afterRest.reduce((a,v)=>a+v*v,0);
    const consecutiveRest = resting.reduce((a,p)=>a+(previousRest.has(p)?1:0),0);
    const queuePenalty = resting.reduce((a,p)=>a+(qpos.has(p)?qpos.get(p):active.length),0);
    // Lexicographic priority encoded as a tuple.
    return [playedSpread, playedSquares, restSpread, restSquares, consecutiveRest, queuePenalty];
  }
  function better(a,b) {
    if (!b) return true;
    for (let i=0;i<a.length;i++) {
      if (a[i] !== b[i]) return a[i] < b[i];
    }
    return false;
  }
  function dfs(i,count) {
    if (count > restNeeded) return;
    if (i === units.length) {
      if (count !== restNeeded) return;
      const resting = chosen.flat();
      const sc = score(resting);
      if (better(sc,best?.score)) best = { score: sc, resting: [...resting] };
      return;
    }
    // Rest this complete unit.
    chosen.push(units[i]);
    dfs(i+1, count + units[i].length);
    chosen.pop();
    // Play this unit.
    dfs(i+1, count);
  }
  dfs(0,0);

  // A fixed-pair unit can make the exact rest count impossible (for example,
  // one rest required but every player belongs to a fixed pair). Fall back to
  // the fairest individual selection rather than returning an invalid round.
  if (!best) {
    const ordered = [...active].sort((a,b) => {
      const pa = playedCount[a] || 0, pb = playedCount[b] || 0;
      if (pa !== pb) return pb - pa; // higher played rests first
      const ra = restCount[a] || 0, rb = restCount[b] || 0;
      if (ra !== rb) return ra - rb; // fewer rests rests first
      return (qpos.get(a) ?? active.length) - (qpos.get(b) ?? active.length);
    });
    best = { resting: ordered.slice(0,restNeeded) };
  }
  const restSet = new Set(best.resting);
  return { resting: best.resting, playing: active.filter(p=>!restSet.has(p)) };
}

function buildStandardFreshGamesDFS(state, playing) {
  const numCourts = state.numCourts || 0;
  if (!numCourts || playing.length !== numCourts * 4) return null;

  const pairCounts = new Map();
  const opponentCounts = new Map();
  const gameCounts = new Map();
  const rounds = state.allRounds || [];
  const previous = rounds.length ? rounds[rounds.length - 1] : null;
  const previousGameKeys = new Set();
  const previousPartnerKeys = new Set();
  const previousOpponentKeys = new Set();
  const previousPlaying = new Set();

  const pkey = (a,b) => [a,b].sort().join('|');
  const gkey = players => [...players].sort().join('|');
  const inc = (map,key,n=1) => map.set(key,(map.get(key)||0)+n);

  for (const round of rounds) {
    for (const g of round.games || []) {
      const p1 = g.pair1 || [], p2 = g.pair2 || [];
      if (p1.length !== 2 || p2.length !== 2) continue;
      inc(pairCounts,pkey(p1[0],p1[1]));
      inc(pairCounts,pkey(p2[0],p2[1]));
      for (const a of p1) for (const b of p2) inc(opponentCounts,pkey(a,b));
      inc(gameCounts,gkey([...p1,...p2]));
    }
  }
  for (const g of previous?.games || []) {
    const p1 = g.pair1 || [], p2 = g.pair2 || [];
    if (p1.length !== 2 || p2.length !== 2) continue;
    previousGameKeys.add(gkey([...p1,...p2]));
    previousPartnerKeys.add(pkey(p1[0],p1[1]));
    previousPartnerKeys.add(pkey(p2[0],p2[1]));
    for (const a of p1) for (const b of p2) previousOpponentKeys.add(pkey(a,b));
    [...p1,...p2].forEach(p=>previousPlaying.add(p));
  }

  const returning = new Set(playing.filter(p => previous && !previousPlaying.has(p)));
  const fixedMate = new Map();
  for (const [a,b] of state.fixedPairs || []) {
    if (playing.includes(a) && playing.includes(b)) {
      fixedMate.set(a,b); fixedMate.set(b,a);
    }
  }

  function arrangements(group) {
    const [a,b,c,d] = group;
    return [
      [[a,b],[c,d]], [[a,c],[b,d]], [[a,d],[b,c]]
    ];
  }
  function validFixed(group,pair1,pair2) {
    const groupSet = new Set(group);
    for (const p of group) {
      const mate = fixedMate.get(p);
      if (!mate) continue;
      if (!groupSet.has(mate)) return false;
      const together = (pair1.includes(p) && pair1.includes(mate)) ||
                       (pair2.includes(p) && pair2.includes(mate));
      if (!together) return false;
    }
    return true;
  }
  function scoreGame(pair1,pair2) {
    const players = [...pair1,...pair2];
    const exactKey = gkey(players);
    const pairKeys = [pkey(pair1[0],pair1[1]),pkey(pair2[0],pair2[1])];
    const oppKeys = [];
    for (const a of pair1) for (const b of pair2) oppKeys.push(pkey(a,b));
    const historicalPairRepeats = pairKeys.reduce((n,k)=>n+(pairCounts.get(k)||0),0);
    const historicalOpponentRepeats = oppKeys.reduce((n,k)=>n+(opponentCounts.get(k)||0),0);
    return {
      pair1:[...pair1], pair2:[...pair2], players,
      returningCount: players.reduce((n,p)=>n+(returning.has(p)?1:0),0),
      vector: [
        gameCounts.get(exactKey)||0,
        historicalPairRepeats,
        historicalOpponentRepeats,
        previousGameKeys.has(exactKey)?1:0,
        pairKeys.reduce((n,k)=>n+(previousPartnerKeys.has(k)?1:0),0),
        oppKeys.reduce((n,k)=>n+(previousOpponentKeys.has(k)?1:0),0)
      ]
    };
  }
  function addVec(a,b) { return a.map((v,i)=>v+b[i]); }
  function better(a,b) {
    if (!b) return true;
    for (let i=0;i<a.length;i++) if (a[i]!==b[i]) return a[i]<b[i];
    return false;
  }

  let best = null;
  let nodes = 0;
  const MAX_NODES = 180000;
  const maxReturningPerCourt = returning.size <= numCourts ? 1 : Math.ceil(returning.size/numCourts);

  function dfs(remaining,games,vector,returningDistributionPenalty) {
    if (++nodes > MAX_NODES) return;
    if (!remaining.length) {
      const full = [returningDistributionPenalty,...vector];
      if (better(full,best?.score)) best={score:full,games:games.map((g,i)=>({court:i+1,pair1:g.pair1,pair2:g.pair2}))};
      return;
    }
    if (games.length >= numCourts) return;
    const first=remaining[0], rest=remaining.slice(1);
    const candidates=[];
    for (let i=0;i<rest.length-2;i++) for (let j=i+1;j<rest.length-1;j++) for (let k=j+1;k<rest.length;k++) {
      const group=[first,rest[i],rest[j],rest[k]];
      for (const [pair1,pair2] of arrangements(group)) {
        if (!validFixed(group,pair1,pair2)) continue;
        const c=scoreGame(pair1,pair2);
        if (c.returningCount>maxReturningPerCourt) continue;
        candidates.push(c);
      }
    }
    candidates.sort((a,b)=>{
      for (let i=0;i<a.vector.length;i++) if (a.vector[i]!==b.vector[i]) return a.vector[i]-b.vector[i];
      return a.returningCount-b.returningCount;
    });
    for (const c of candidates.slice(0,80)) {
      const used=new Set(c.players);
      const next=remaining.filter(p=>!used.has(p));
      const target = returning.size ? returning.size/numCourts : 0;
      const penalty = returningDistributionPenalty + Math.abs(c.returningCount-target);
      dfs(next,[...games,c],addVec(vector,c.vector),penalty);
    }
  }

  dfs([...playing],[],[0,0,0,0,0,0],0);
  return best?.games || null;
}


// Balanced mode = Standard participation + a frozen rating split for this round.
// Balance is a hard constraint. Standard uniqueness/freshness scoring is then
// applied only among structurally balanced candidates.
function balancedRoundV1(state) {
  const { resting, playing } = selectStandardParticipantsDFS(state);
  const allPlayers = state.allPlayers || [];
  const rating = name => getRating(name, allPlayers);
  const gender = name => getGender(name, allPlayers);
  const sorted = [...playing].sort((a,b) => rating(b) - rating(a) || String(a).localeCompare(String(b)));
  const half = Math.ceil(sorted.length / 2);
  const top = new Set(sorted.slice(0, half));
  const bottom = new Set(sorted.slice(half));
  const group = p => top.has(p) ? 'T' : 'B';

  const formats = (state.courtFormats || []).length ? state.courtFormats : Array(state.numCourts).fill('doubles');
  const types = state.courtTypes || [];
  const rounds = state.allRounds || [];
  const previous = rounds.length ? rounds[rounds.length - 1] : null;
  const previousGameKeys = new Set((previous?.games || []).map(g => gameKey(g.pair1 || [], g.pair2 || [])));
  const pairCounts = new Map();
  const oppCounts = new Map();
  const gameCounts = new Map();
  for (const r of rounds) for (const g of (r.games || [])) {
    const ps=[...(g.pair1||[]),...(g.pair2||[])];
    gameCounts.set(gameKey(g.pair1||[],g.pair2||[]),(gameCounts.get(gameKey(g.pair1||[],g.pair2||[]))||0)+1);
    if ((g.pair1||[]).length===2) {
      for (const pair of [g.pair1,g.pair2]) { const k=pairKey(pair[0],pair[1]); pairCounts.set(k,(pairCounts.get(k)||0)+1); }
      for (const a of g.pair1) for (const b of g.pair2) { const k=pairKey(a,b); oppCounts.set(k,(oppCounts.get(k)||0)+1); }
    } else if (ps.length===2) { const k=pairKey(ps[0],ps[1]); oppCounts.set(k,(oppCounts.get(k)||0)+1); }
  }
  const previousRest = new Set((previous?.resting || []).map(x=>String(x).split('#')[0]));
  const fixedMate = new Map();
  for (const [a,b] of state.fixedPairs || []) if (playing.includes(a)&&playing.includes(b)) { fixedMate.set(a,b); fixedMate.set(b,a); }

  function typeOK(players, fmt, type) {
    const gs=players.map(group);
    if (fmt==='singles') {
      if (gs[0]!==gs[1]) return false;
      if (type==='singles-men' || type==='MD' || type==='men') return players.every(p=>gender(p)==='Male');
      if (type==='singles-women' || type==='LD' || type==='women') return players.every(p=>gender(p)==='Female');
      return true;
    }
    const topCount=gs.filter(x=>x==='T').length;
    // Valid balanced doubles patterns: two Top + two Bottom, or all four
    // from the same half (same-level court).
    if (!(topCount===2 || topCount===0 || topCount===4)) return false;
    if (type==='MD' && !players.every(p=>gender(p)==='Male')) return false;
    if (type==='LD' && !players.every(p=>gender(p)==='Female')) return false;
    if (type==='XD') {
      if (players.filter(p=>gender(p)==='Male').length!==2) return false;
      if (players.filter(p=>gender(p)==='Female').length!==2) return false;
    }
    return true;
  }
  function fixedOK(pair1,pair2) {
    const all=[...pair1,...pair2], set=new Set(all);
    for (const p of all) { const m=fixedMate.get(p); if (!m) continue; if (!set.has(m)) return false; if (!((pair1.includes(p)&&pair1.includes(m))||(pair2.includes(p)&&pair2.includes(m)))) return false; }
    return true;
  }
  function teamBalanceOK(pair1,pair2,fmt,type) {
    if (fmt==='singles') return true;
    const all=[...pair1,...pair2];
    const topCount=all.filter(p=>group(p)==='T').length;
    if (topCount===2) {
      if (!(group(pair1[0])!==group(pair1[1]) && group(pair2[0])!==group(pair2[1]))) return false;
    } else {
      // Same-level court: both teams automatically have the same group structure.
      if (!(topCount===0 || topCount===4)) return false;
    }
    if (type==='XD') return pair1.filter(p=>gender(p)==='Male').length===1 && pair2.filter(p=>gender(p)==='Male').length===1;
    return true;
  }
  function candidateScore(pair1,pair2) {
    const exact=gameKey(pair1,pair2);
    const pairs=pair1.length===2?[pairKey(pair1[0],pair1[1]),pairKey(pair2[0],pair2[1])]:[];
    const opp=[]; for (const a of pair1) for (const b of pair2) opp.push(pairKey(a,b));
    return [
      previousGameKeys.has(exact)?1:0,
      gameCounts.get(exact)||0,
      pairs.reduce((n,k)=>n+(pairCounts.get(k)||0),0),
      opp.reduce((n,k)=>n+(oppCounts.get(k)||0),0)
    ];
  }
  function add(a,b){return a.map((v,i)=>v+b[i]);}
  function better(a,b){if(!b)return true; for(let i=0;i<a.length;i++){if(a[i]!==b[i])return a[i]<b[i];} return false;}
  function candidatesFor(court, available) {
    const fmt=formats[court]||'doubles', type=types[court]||(fmt==='singles'?'singles-free':'free');
    const out=[];
    if (fmt==='singles') {
      for(let i=0;i<available.length-1;i++) for(let j=i+1;j<available.length;j++) {
        const ps=[available[i],available[j]]; if(!typeOK(ps,fmt,type))continue;
        out.push({pair1:[ps[0]],pair2:[ps[1]],players:ps,score:candidateScore([ps[0]],[ps[1]])});
      }
    } else {
      for(let a=0;a<available.length-3;a++) for(let b=a+1;b<available.length-2;b++) for(let c=b+1;c<available.length-1;c++) for(let d=c+1;d<available.length;d++) {
        const ps=[available[a],available[b],available[c],available[d]]; if(!typeOK(ps,fmt,type))continue;
        const arr=[[[ps[0],ps[1]],[ps[2],ps[3]]],[[ps[0],ps[2]],[ps[1],ps[3]]],[[ps[0],ps[3]],[ps[1],ps[2]]]];
        for(const [p1,p2] of arr) if(teamBalanceOK(p1,p2,fmt,type)&&fixedOK(p1,p2)) out.push({pair1:p1,pair2:p2,players:ps,score:candidateScore(p1,p2)});
      }
    }
    out.sort((x,y)=>{for(let i=0;i<x.score.length;i++)if(x.score[i]!==y.score[i])return x.score[i]-y.score[i];return 0;});
    return out.slice(0,600);
  }

  let best=null,nodes=0; const MAX=350000;
  function dfs(remainingCourts,available,games,score,returningCounts){
    if(++nodes>MAX)return;
    if(!remainingCourts.length){
      const target=previousRest.size?previousRest.size/formats.length:0;
      const spreadPenalty=returningCounts.reduce((n,x)=>n+Math.abs(x-target),0);
      const full=[spreadPenalty,...score];
      if(better(full,best?.score))best={score:full,games:[...games].sort((a,b)=>a.court-b.court)};
      return;
    }
    // Most-constrained court first avoids consuming players needed by XD/typed courts.
    let chosenCourt=remainingCourts[0], chosenCandidates=candidatesFor(chosenCourt,available);
    for(const c of remainingCourts.slice(1)){
      const cc=candidatesFor(c,available);
      if(cc.length<chosenCandidates.length){chosenCourt=c;chosenCandidates=cc;}
    }
    if(!chosenCandidates.length)return;
    const nextCourts=remainingCourts.filter(c=>c!==chosenCourt);
    for(const cand of chosenCandidates){
      const used=new Set(cand.players);
      dfs(nextCourts,available.filter(p=>!used.has(p)),[...games,{court:chosenCourt+1,pair1:cand.pair1,pair2:cand.pair2,isSingles:cand.pair1.length===1}],add(score,cand.score),[...returningCounts,cand.players.filter(p=>previousRest.has(p)).length]);
    }
  }
  dfs(formats.map((_,i)=>i),[...playing],[],[0,0,0,0],[]);
  if (!best) {
    // Preserve validity if a strict balanced arrangement is mathematically impossible.
    return typedRound(state);
  }
  state.roundIndex=(state.roundIndex||0)+1;
  return {round:state.roundIndex,resting:resting.map(p=>`${p}#${(state.restCount[p]||0)+1}`),playing,games:best.games,balanceGroups:{top:[...top],bottom:[...bottom]}};
}

function standardRoundV2(state) {
  const { restCount } = state;
  const { resting, playing } = selectStandardParticipantsDFS(state);
  let games = buildStandardFreshGamesDFS(state, playing);

  // Safety fallback: retain the previous proven Standard game builder if DFS
  // cannot complete within its bounded search.
  if (!games || games.length !== state.numCourts) {
    const fallback = randomRound({ ...state, activeplayers: playing, numCourts: state.numCourts });
    games = fallback.games || [];
  }

  state.roundIndex = (state.roundIndex || 0) + 1;
  return {
    round: state.roundIndex,
    resting: resting.map(p => `${p}#${(restCount[p] || 0) + 1}`),
    playing,
    games
  };
}

function randomRound(state) {
  const { numCourts, fixedPairs, restCount, opponentMap, pairPlayedSet, lastRound = [] } = state;
  const { resting, playing } = selectRestingAndPlaying(state);
  const playingSet     = new Set(playing);
  const fixedThisRound = fixedPairs.filter(([a, b]) => playingSet.has(a) && playingSet.has(b));
  const fixedPlayers   = new Set(fixedThisRound.flat());
  let freePlayers      = reorderFreePlayersByLastRound(
    playing.filter(p => !fixedPlayers.has(p)), lastRound, numCourts
  );
  if (freePlayers.length <= 2 && fixedPairs.length >= numCourts * 2) {
    const games = getNextFixedPairGames(state, fixedPairs, numCourts);
    const pp    = new Set(games.flatMap(g => [...g.pair1, ...g.pair2]));
    state.roundIndex = (state.roundIndex || 0) + 1;
    return {
      round:   state.roundIndex,
      resting: state.activeplayers.filter(p => !pp.has(p)).map(p => `${p}#${(restCount[p] || 0) + 1}`),
      playing: [...pp],
      games
    };
  }
  // Version 1 grouped Unique Games algorithm. Fixed-pair rounds retain the
  // established fixed-pair path so their existing behaviour is untouched.
  if (state.uniqueGamesMode && fixedThisRound.length === 0) {
    const groupedGames = buildGroupedUniqueGames(state, playing);
    if (groupedGames && groupedGames.length === numCourts) {
      state.roundIndex = (state.roundIndex || 0) + 1;
      return {
        round: state.roundIndex,
        resting: resting.map(p => `${p}#${(restCount[p] || 0) + 1}`),
        playing,
        games: groupedGames
      };
    }
  }

  const required = Math.floor(numCourts * 4 / 2) - fixedThisRound.length;
  let freePairs  = findDisjointPairs(freePlayers, pairPlayedSet, required, opponentMap) || [];
  if (freePairs.length < required) {
    const used = new Set(freePairs.flat());
    for (let i = 0; i < freePlayers.length && freePairs.length < required; i++) {
      if (used.has(freePlayers[i])) continue;
      for (let j = i + 1; j < freePlayers.length; j++) {
        if (!used.has(freePlayers[j])) {
          freePairs.push([freePlayers[i], freePlayers[j]]);
          used.add(freePlayers[i]); used.add(freePlayers[j]); break;
        }
      }
    }
  }
  let allPairs = shuffle([...fixedThisRound, ...freePairs]);
  const scores = getMatchupScores(allPairs, opponentMap);
  const games  = [], usedPairs = new Set();
  for (const m of scores) {
    const k1 = m.pair1.join('&'), k2 = m.pair2.join('&');
    if (usedPairs.has(k1) || usedPairs.has(k2)) continue;
    games.push({ court: games.length + 1, pair1: [...m.pair1], pair2: [...m.pair2] });
    usedPairs.add(k1); usedPairs.add(k2);
    if (games.length >= numCourts) break;
  }
  state.roundIndex = (state.roundIndex || 0) + 1;
  return {
    round:   state.roundIndex,
    resting: resting.map(p => `${p}#${(restCount[p] || 0) + 1}`),
    playing,
    games
  };
}

function buildPointsAndStreaks(allRounds, activeplayers) {
  const rp = {}, sm = {};
  for (const p of activeplayers) { rp[p] = 100; sm[p] = 0; }
  for (const rnd of allRounds) {
    if (!rnd?.games) continue;
    for (const g of rnd.games) {
      if (!g.winner || !g.pair1 || !g.pair2) continue;
      const winners = g.winner === 'L' ? g.pair1 : g.pair2;
      const losers  = g.winner === 'L' ? g.pair2 : g.pair1;
      for (const p of winners) {
        const s = sm[p] || 0;
        rp[p] = (rp[p] || 100) + 2 + (s > 0 ? 1 : 0);
        sm[p] = Math.max(s, 0) + 1;
      }
      for (const p of losers) {
        const s = sm[p] || 0;
        rp[p] = (rp[p] || 100) - 2 + (s < 0 ? -1 : 0);
        sm[p] = Math.min(s, 0) - 1;
      }
    }
  }
  return { rankPoints: rp, streakMap: sm };
}

function calculateTiers(activeplayers, allPlayers) {
  const ratingMap = {};
  for (const p of (allPlayers || [])) {
    ratingMap[p.name] = parseFloat(p.clubRating || p.rating || 3.0);
  }
  const sorted = [...activeplayers].sort((a, b) => (ratingMap[b] || 3.0) - (ratingMap[a] || 3.0));
  const topCut = Math.ceil(sorted.length / 3);
  const botCut = Math.floor(sorted.length * 2 / 3);
  const tierMap = {};
  sorted.forEach((p, i) => { tierMap[p] = i < topCut ? 'strong' : i < botCut ? 'inter' : 'weak'; });
  return tierMap;
}

function getGameTierRule(pair1, pair2, tierMap) {
  const sig = pair => [...pair].map(p => tierMap[p] || 'inter').sort().join('+');
  const s1 = sig(pair1), s2 = sig(pair2);
  if (['strong+strong','inter+inter','weak+weak'].includes(s1) && s1 === s2) return 1;
  if (['inter+strong','strong+weak','inter+weak'].includes(s1) && s1 === s2) return 2;
  const sw = new Set(['strong+weak','weak+strong']);
  if ((sw.has(s1) && s2 === 'inter+inter') || (s1 === 'inter+inter' && sw.has(s2))) return 3;
  return 0;
}

function buildRepetitionHistory(allRounds) {
  const pairSet = new Set(), gameSet = new Set();
  for (const rnd of allRounds) {
    if (!rnd?.games) continue;
    for (const g of rnd.games) {
      if (!g.pair1 || !g.pair2) continue;
      const k1 = pairKey(g.pair1[0], g.pair1[1]);
      const k2 = pairKey(g.pair2[0], g.pair2[1]);
      pairSet.add(k1); pairSet.add(k2);
      gameSet.add([k1, k2].sort().join(':'));
    }
  }
  return { pairSet, gameSet };
}

function isGameRepeated(game, gameSet) {
  if (!game?.pair1 || !game?.pair2) return false;
  const k1 = pairKey(game.pair1[0], game.pair1[1]);
  const k2 = pairKey(game.pair2[0], game.pair2[1]);
  return gameSet.has([k1, k2].sort().join(':'));
}

function getOppFreshness(t1, t2, opponentMap) {
  let f = 0;
  for (const a of t1) for (const b of t2) if (!(opponentMap[a] || {})[b]) f++;
  return f;
}

function findBestCourtCombination(playing, numCourts, tierMap, state, gameSet) {
  const { opponentMap, allRounds = [], allPlayers = [] } = state;
  const ratingMap = {};
  for (const p of allPlayers) ratingMap[p.name] = parseFloat(p.clubRating || p.rating || 3.0);
  function getRating(name) { return ratingMap[name] || 3.0; }
  function pk(a, b) { return [a, b].sort().join('&'); }
  function isPairRepeated(a, b) {
    const key = pk(a, b);
    for (const rnd of allRounds) {
      if (!rnd || !rnd.games) continue;
      for (const g of rnd.games) {
        if (!g.pair1 || !g.pair2) continue;
        if (pk(g.pair1[0], g.pair1[1]) === key) return true;
        if (pk(g.pair2[0], g.pair2[1]) === key) return true;
      }
    }
    return false;
  }
  function isFullGameRepeated(p1, p2) { return isGameRepeated({ pair1: p1, pair2: p2 }, gameSet); }
  function pairAge(a, b) {
    const key = pk(a, b);
    let lastRound = -1;
    for (let r = 0; r < allRounds.length; r++) {
      const rnd = allRounds[r];
      if (!rnd || !rnd.games) continue;
      for (const g of rnd.games) {
        if (!g.pair1 || !g.pair2) continue;
        if (pk(g.pair1[0], g.pair1[1]) === key || pk(g.pair2[0], g.pair2[1]) === key) lastRound = r;
      }
    }
    if (lastRound === -1) return allRounds.length + 1;
    return allRounds.length - lastRound;
  }
  const gameScores = [];
  const n = playing.length;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const t1 = [playing[i], playing[j]];
      for (let k = i + 1; k < n; k++) {
        if (k === j) continue;
        for (let l = k + 1; l < n; l++) {
          if (l === j) continue;
          const t2 = [playing[k], playing[l]];
          if (new Set([...t1, ...t2]).size !== 4) continue;
          const rule  = getGameTierRule(t1, t2, tierMap);
          const score = (rule === 1 ? 30 : rule === 2 ? 20 : rule === 3 ? 10 : 5) +
            pairAge(t1[0], t1[1]) + pairAge(t2[0], t2[1]) + getOppFreshness(t1, t2, opponentMap) * 2;
          gameScores.push({ pair1: [...t1], pair2: [...t2], courtRule: rule, score, players: new Set([...t1, ...t2]) });
        }
      }
    }
  }
  gameScores.sort((a, b) => b.score - a.score);
  function greedyFrom(startGame) {
    const picked = [{ pair1: [...startGame.pair1], pair2: [...startGame.pair2], courtRule: startGame.courtRule, repeated: false }];
    const used   = new Set([...startGame.players]);
    for (const g of gameScores) {
      if (picked.length >= numCourts) break;
      if (g === startGame) continue;
      let overlap = false;
      for (const p of g.players) if (used.has(p)) { overlap = true; break; }
      if (overlap) continue;
      picked.push({ pair1: [...g.pair1], pair2: [...g.pair2], courtRule: g.courtRule, repeated: false });
      for (const p of g.players) used.add(p);
    }
    return picked.length === numCourts ? picked : null;
  }
  function countRepeats(games) {
    let count = 0;
    for (const g of games) {
      if (isPairRepeated(g.pair1[0], g.pair1[1])) count++;
      if (isPairRepeated(g.pair2[0], g.pair2[1])) count++;
    }
    return count;
  }
  function applySwapFix(games) {
    const tolerances = [0.5, 1.0, 1.5, Infinity];
    for (const tolerance of tolerances) {
      const anyRepeated = games.some(g =>
        isPairRepeated(g.pair1[0], g.pair1[1]) || isPairRepeated(g.pair2[0], g.pair2[1]));
      if (!anyRepeated) break;
      for (let ci = 0; ci < games.length; ci++) {
        const game = games[ci];
        for (const badPairKey of ['pair1', 'pair2']) {
          if (!isPairRepeated(game[badPairKey][0], game[badPairKey][1])) continue;
          const badPair  = game[badPairKey];
          const goodPair = game[badPairKey === 'pair1' ? 'pair2' : 'pair1'];
          for (let pi = 0; pi < badPair.length; pi++) {
            const swapOut = badPair[pi];
            const keepIn  = badPair[1 - pi];
            for (let cj = 0; cj < games.length; cj++) {
              if (cj === ci) continue;
              const otherGame = games[cj];
              for (const otherPairKey of ['pair1', 'pair2']) {
                const candidatePair = otherGame[otherPairKey];
                for (let qi = 0; qi < candidatePair.length; qi++) {
                  const swapIn        = candidatePair[qi];
                  const swapInPartner = candidatePair[1 - qi];
                  if (Math.abs(getRating(swapOut) - getRating(swapIn)) > tolerance) continue;
                  const newBadPair   = [keepIn, swapIn];
                  const newOtherPair = [swapOut, swapInPartner];
                  if (isPairRepeated(newBadPair[0], newBadPair[1]))     continue;
                  if (isPairRepeated(newOtherPair[0], newOtherPair[1])) continue;
                  const newGame1p1 = badPairKey === 'pair1' ? newBadPair : goodPair;
                  const newGame1p2 = badPairKey === 'pair1' ? goodPair   : newBadPair;
                  const otherGoodPair = otherGame[otherPairKey === 'pair1' ? 'pair2' : 'pair1'];
                  const newGame2p1 = otherPairKey === 'pair1' ? newOtherPair : otherGoodPair;
                  const newGame2p2 = otherPairKey === 'pair1' ? otherGoodPair : newOtherPair;
                  if (isFullGameRepeated(newGame1p1, newGame1p2)) continue;
                  if (isFullGameRepeated(newGame2p1, newGame2p2)) continue;
                  game[badPairKey]  = [...newBadPair];
                  candidatePair[qi] = swapOut;
                  break;
                }
                if (!isPairRepeated(game[badPairKey][0], game[badPairKey][1])) break;
              }
              if (!isPairRepeated(game[badPairKey][0], game[badPairKey][1])) break;
            }
          }
        }
      }
    }
    return games;
  }
  const BEAM_SIZE = Math.min(12, gameScores.length);
  let bestResult = null, bestRepeats = Infinity;
  for (let b = 0; b < BEAM_SIZE; b++) {
    const attempt = greedyFrom(gameScores[b]);
    if (!attempt) continue;
    const fixed   = applySwapFix(attempt.map(g => ({ pair1: [...g.pair1], pair2: [...g.pair2], courtRule: g.courtRule, repeated: false })));
    const repeats = countRepeats(fixed);
    if (repeats < bestRepeats) {
      bestRepeats = repeats;
      bestResult  = fixed;
      if (repeats === 0) break;
    }
  }
  if (!bestResult) return null;
  for (const g of bestResult) {
    g.repeated      = isFullGameRepeated(g.pair1, g.pair2);
    g.pair1Repeated = isPairRepeated(g.pair1[0], g.pair1[1]);
    g.pair2Repeated = isPairRepeated(g.pair2[0], g.pair2[1]);
  }
  return bestResult;
}

function updateAfterRound(state, games) {
  for (const [t1, t2] of games) {
    if (!t1 || !t2) continue;
    state.pairPlayedSet.add(pairKey(t1[0], t1[1]));
    state.pairPlayedSet.add(pairKey(t2[0], t2[1]));
    for (const a of t1) for (const b of t2) {
      if (!state.opponentMap[a]) state.opponentMap[a] = {};
      if (!state.opponentMap[b]) state.opponentMap[b] = {};
      state.opponentMap[a][b] = (state.opponentMap[a][b] || 0) + 1;
      state.opponentMap[b][a] = (state.opponentMap[b][a] || 0) + 1;
    }
  }
}

function resetForCompetitive(state) {
  // Do NOT wipe pairPlayedSet/gamesMap/opponentMap — they contain valid history
  // from rounds played in random mode. Competitive mode should respect that.
  // Only ensure opponentMap has entries for all active players.
  if (!state.opponentMap || typeof state.opponentMap !== 'object') {
    state.opponentMap = {};
  }
  for (const p of state.activeplayers) {
    if (!state.opponentMap[p]) state.opponentMap[p] = {};
    for (const p2 of state.activeplayers) {
      if (p !== p2 && state.opponentMap[p][p2] === undefined) {
        state.opponentMap[p][p2] = 0;
      }
    }
  }
}

function competitiveRound(state) {
  const { activeplayers, numCourts, restCount, allRounds, allPlayers } = state;
  const tierMap = calculateTiers(activeplayers, allPlayers);
  const { resting, playing } = selectRestingAndPlaying({ ...state, numCourts });
  const { gameSet }          = buildRepetitionHistory(allRounds);
  let proposed = findBestCourtCombination(playing, numCourts, tierMap, state, gameSet);
  if (!proposed) {
    const fb = randomRound({ ...state });
    proposed = fb.games.map(g => ({ pair1: g.pair1, pair2: g.pair2, courtRule: 0, repeated: false }));
  }
  const finalGames = [];
  for (let c = 0; c < proposed.length; c++) {
    const p = proposed[c];
    if (p.repeated || p.courtRule === -1) {
      const tmp = { ...state, activeplayers: [...p.pair1, ...p.pair2], numCourts: 1, fixedPairs: [], restQueue: [...p.pair1, ...p.pair2] };
      const rr  = randomRound(tmp);
      const g   = rr.games[0] || { pair1: p.pair1, pair2: p.pair2 };
      finalGames.push({ court: c + 1, pair1: [...g.pair1], pair2: [...g.pair2], courtRule: 0, isRandom: true });
    } else {
      finalGames.push({ court: c + 1, pair1: [...p.pair1], pair2: [...p.pair2], courtRule: p.courtRule, isRandom: false });
    }
  }
  updateAfterRound(state, finalGames.map(g => [g.pair1, g.pair2]));
  state.roundIndex = (state.roundIndex || 0) + 1;
  return {
    round:   state.roundIndex,
    resting: resting.map(p => `${p}#${(restCount[p] || 0) + 1}`),
    playing,
    games:   finalGames
  };
}

function validateRound(rnd, state) {
  const fails = [];
  if (!rnd?.games) return { valid: false, hardFails: ['No games'] };
  const { games, playing } = rnd;
  const { numCourts, fixedPairs = [], gamesMap, courtFormats = [] } = state;
  if (games.length !== numCourts) fails.push(`Court count: got ${games.length}, expected ${numCourts}`);
  const seen = new Set();
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    const expectedSize = (courtFormats[i] === 'singles') ? 1 : 2;
    if (!g.pair1 || g.pair1.length !== expectedSize) fails.push(`Court ${i+1}: pair1 invalid`);
    if (!g.pair2 || g.pair2.length !== expectedSize) fails.push(`Court ${i+1}: pair2 invalid`);
    for (const p of [...(g.pair1||[]), ...(g.pair2||[])]) {
      if (seen.has(p)) fails.push(`Duplicate player: ${p}`); seen.add(p);
    }
  }
  for (const p of (playing || [])) if (!seen.has(p)) fails.push(`Missing from courts: ${p}`);
  if (fixedPairs.length) {
    const restSet = new Set((rnd.resting || []).map(r => r.split('#')[0]));
    for (const [a, b] of fixedPairs) {
      if (restSet.has(a) && restSet.has(b)) continue;
      if (!restSet.has(a) && !restSet.has(b)) {
        const together = games.some(g =>
          (g.pair1?.includes(a) && g.pair1?.includes(b)) ||
          (g.pair2?.includes(a) && g.pair2?.includes(b))
        );
        if (!together) fails.push(`Fixed pair split: ${a} & ${b}`);
      }
    }
  }
  if (gamesMap) {
    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      if (!g.pair1 || !g.pair2) continue;
      const mk = gameKey(g.pair1, g.pair2);
      if (gamesMap.has(mk)) fails.push(`Court ${i+1} repeated match`);
    }
  }
  return { valid: fails.length === 0, hardFails: fails };
}

// ── Helper: best pair from pool using existing scoring ──
function pickBestPairsFromPool(pool, pairPlayedSet, required, opponentMap) {
  const pairs = findDisjointPairs(pool, pairPlayedSet, required, opponentMap) || [];
  // Fallback: greedily pair remaining
  if (pairs.length < required) {
    const used = new Set(pairs.flat());
    for (let i = 0; i < pool.length && pairs.length < required; i++) {
      if (used.has(pool[i])) continue;
      for (let j = i + 1; j < pool.length; j++) {
        if (!used.has(pool[j])) {
          pairs.push([pool[i], pool[j]]);
          used.add(pool[i]); used.add(pool[j]); break;
        }
      }
    }
  }
  return pairs;
}

// ── Helper: best matchup from 2 pairs using opponentMap ──
function bestMatchup(pairA, pairB, opponentMap) {
  const scores = getMatchupScores([pairA, pairB], opponentMap);
  return scores[0] || { pair1: pairA, pair2: pairB };
}

// ─────────────────────────────────────────────────────────────
//  TYPED ROUND  (MD / LD / XD / Singles / Free)
//  Completely self-contained — does NOT share state with
//  randomRound or competitiveRound.
// ─────────────────────────────────────────────────────────────

// ── Singles matchup scorer ───────────────────────────────────────────────────
// Picks the best 1v1 from a pool using:
//   1. Opponent freshness — have A and B never faced each other? (primary)
//   2. Least total opponent count — minimise repeat matchups (secondary)
//   3. Pool order (rest queue position) — tiebreaker
function bestSinglesMatch(
  pool,
  opponentMap,
  allRounds,
  pairPlayedSet = new Set(),
  doublesSeatsAfter = 0,
  gamesMap = new Set()
) {
  // Build Singles-only history. Doubles opponents must not make a first-time
  // Singles matchup look like a repeat.
  const singlesCount = {};
  const singlesOpponentMap = {};
  for (const rnd of (allRounds || [])) {
    if (!rnd?.games) continue;
    for (const g of rnd.games) {
      if (g.pair1?.length === 1 && g.pair2?.length === 1) {
        const a = g.pair1[0], b = g.pair2[0];
        singlesCount[a] = (singlesCount[a] || 0) + 1;
        singlesCount[b] = (singlesCount[b] || 0) + 1;
        if (!singlesOpponentMap[a]) singlesOpponentMap[a] = {};
        if (!singlesOpponentMap[b]) singlesOpponentMap[b] = {};
        singlesOpponentMap[a][b] = (singlesOpponentMap[a][b] || 0) + 1;
        singlesOpponentMap[b][a] = (singlesOpponentMap[b][a] || 0) + 1;
      }
    }
  }

  // Count the best number of fresh Doubles partnerships that can still be
  // formed after a candidate Singles pair is removed. This prevents a locally
  // good Singles choice from forcing avoidable repeated Doubles partners.
  function freshDoublesCapacity(remaining) {
    const requiredPairs = Math.min(Math.floor(doublesSeatsAfter / 2), Math.floor(remaining.length / 2));
    if (requiredPairs <= 0) return 0;
    let best = 0;
    const used = new Set();
    let branches = 0;
    const MAX_BRANCHES = 30000;

    function dfs(start, selected, fresh) {
      if (branches++ > MAX_BRANCHES) return;
      if (selected === requiredPairs) {
        if (fresh > best) best = fresh;
        return;
      }
      if (remaining.length - used.size < (requiredPairs - selected) * 2) return;

      let first = -1;
      for (let i = start; i < remaining.length; i++) {
        if (!used.has(i)) { first = i; break; }
      }
      if (first < 0) return;

      used.add(first);
      for (let j = first + 1; j < remaining.length; j++) {
        if (used.has(j)) continue;
        used.add(j);
        const isFresh = !pairPlayedSet.has(pairKey(remaining[first], remaining[j]));
        dfs(first + 1, selected + 1, fresh + (isFresh ? 1 : 0));
        used.delete(j);
      }
      used.delete(first);
    }

    dfs(0, 0, 0);
    return best;
  }

  const singlesGameKey = (a, b) => [String(a), String(b)].sort().join(':');
  const usedInCurrentCycle = (a, b) => gamesMap.has(singlesGameKey(a, b));

  function freshSinglesCycleCapacity(remaining) {
    let best = 0;
    const used = new Set();
    let branches = 0;
    const MAX_BRANCHES = 30000;

    function dfs(selected) {
      if (branches++ > MAX_BRANCHES) return;
      if (selected > best) best = selected;
      let first = -1;
      for (let i = 0; i < remaining.length; i++) {
        if (!used.has(i)) { first = i; break; }
      }
      if (first < 0) return;

      used.add(first);
      for (let j = first + 1; j < remaining.length; j++) {
        if (used.has(j)) continue;
        const a = remaining[first], b = remaining[j];
        if (usedInCurrentCycle(a, b)) continue;
        used.add(j);
        dfs(selected + 1);
        used.delete(j);
      }
      used.delete(first);
    }

    dfs(0);
    return best;
  }

  const currentCounts = pool.map(player => singlesCount[player] || 0);
  const currentMin = currentCounts.length ? Math.min(...currentCounts) : 0;
  let best = null;
  for (let i = 0; i < pool.length - 1; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i], b = pool[j];
      const aCount    = singlesCount[a] || 0;
      const bCount    = singlesCount[b] || 0;
      const singlesOppCount = (singlesOpponentMap[a] || {})[b] || 0;
      const repeatedInCycle = usedInCurrentCycle(a, b) ? 1 : 0;
      const remaining = pool.filter((_, index) => index !== i && index !== j);
      const freshPartners = freshDoublesCapacity(remaining);
      const remainingAtCycleMinimum = remaining.filter(
        player => (singlesCount[player] || 0) === currentMin
      );
      const freshSinglesAhead = freshSinglesCycleCapacity(remainingAtCycleMinimum);

      const nextCounts = currentCounts.map((count, index) =>
        index === i || index === j ? count + 1 : count
      );
      const nextSpread = Math.max(...nextCounts) - Math.min(...nextCounts);
      const aboveMinimum = (aCount - currentMin) + (bCount - currentMin);

      // Priority: format balance, then leave the strongest fresh Doubles pool,
      // then avoid repeated Singles opponents.
      const score = -repeatedInCycle * 1000000000000
                  - nextSpread * 1000000000
                  - aboveMinimum * 100000000
                  - singlesOppCount * 50000000
                  + freshSinglesAhead * 5000000
                  + freshPartners * 1000000
                  - (aCount + bCount) * 100
                  - i - j;
      if (!best || score > best.score) {
        best = { score, a, b };
      }
    }
  }
  return best ? [best.a, best.b] : pool.length >= 2 ? [pool[0], pool[1]] : null;
}

function typedRound(state) {
  const {
    numCourts, pairPlayedSet, opponentMap, restCount,
    allPlayers = [], allRounds = [],
  } = state;
  const courtTypes   = state.courtTypes   || [];
  const courtFormats = state.courtFormats || [];
  const doublesOpponentMap = {};
  for (const round of allRounds) {
    for (const game of (round?.games || [])) {
      if (game.pair1?.length !== 2 || game.pair2?.length !== 2) continue;
      for (const a of game.pair1) {
        for (const b of game.pair2) {
          if (!doublesOpponentMap[a]) doublesOpponentMap[a] = {};
          if (!doublesOpponentMap[b]) doublesOpponentMap[b] = {};
          doublesOpponentMap[a][b] = (doublesOpponentMap[a][b] || 0) + 1;
          doublesOpponentMap[b][a] = (doublesOpponentMap[b][a] || 0) + 1;
        }
      }
    }
  }

  // ── 1. Select who rests and who plays ──
  let { resting, playing } = selectRestingAndPlaying(state);

  // ── 2. Same-gender fallback — only if NO singles courts defined ──
  const hasSinglesCourts = courtFormats.some(f => f === 'singles');
  const allMen   = playing.every(p => getGender(p, allPlayers) === 'Male');
  const allWomen = playing.every(p => getGender(p, allPlayers) === 'Female');
  if ((allMen || allWomen) && !hasSinglesCourts) {
    return randomRound(state);
  }

  // ── 3. Gender pools sorted by most-rested first ──
  const sortRested = pool =>
    [...pool].sort((a, b) => (restCount[b] || 0) - (restCount[a] || 0));

  let allMenPlaying   = sortRested(playing.filter(p => getGender(p, allPlayers) === 'Male'));
  let allWomenPlaying = sortRested(playing.filter(p => getGender(p, allPlayers) === 'Female'));

  // ── 4. Resolve effective court type ──
  //       Note: called AFTER potential swaps, so pool sizes are up to date
  function effectiveType(type, fmt) {
    if (fmt === 'singles') {
      if (type === 'MD' || type === 'singles-men'   || type === 'men')   return 'singles-men';
      if (type === 'LD' || type === 'singles-women' || type === 'women') return 'singles-women';
      return 'singles-free';
    }
    if (type === 'MD' && allMenPlaying.length   < 4) return 'free';
    if (type === 'LD' && allWomenPlaying.length < 4) return 'free';
    if (type === 'XD' && (allMenPlaying.length  < 2 || allWomenPlaying.length < 2)) return 'free';
    return type;
  }

  // Helper to rebuild gender pools after a swap
  function rebuildPools() {
    allMenPlaying   = sortRested(playing.filter(p => getGender(p, allPlayers) === 'Male'));
    allWomenPlaying = sortRested(playing.filter(p => getGender(p, allPlayers) === 'Female'));
  }

  // ── 5. Gender swap: pull resting players to satisfy typed courts ──
  //       Only when both genders are present in the session.
  const hasBothGenders = allMenPlaying.length > 0 && allWomenPlaying.length > 0;

  if (hasBothGenders) {
    // Count how many of each gender typed courts strictly need
    let menNeeded = 0, womenNeeded = 0;
    for (let c = 0; c < numCourts; c++) {
      const fmt  = courtFormats[c] || 'doubles';
      const type = courtTypes[c]   || 'free';
      if (fmt === 'singles') {
        if (type === 'MD' || type === 'singles-men')   menNeeded   += 1;
        if (type === 'LD' || type === 'singles-women') womenNeeded += 1;
      } else {
        if (type === 'MD') menNeeded   += 4;
        if (type === 'LD') womenNeeded += 4;
        if (type === 'XD') { menNeeded += 2; womenNeeded += 2; }
      }
    }

    // Sort resting by most-rested first (best candidates to pull in)
    const restingMen   = sortRested(resting.filter(p => getGender(p, allPlayers) === 'Male'));
    const restingWomen = sortRested(resting.filter(p => getGender(p, allPlayers) === 'Female'));

    // Swap: pull `needed` gender players from resting, push surplus from playing to resting
    function swapIn(needed, currentPool, restPool, surplusPool) {
      const shortfall = needed - currentPool.length;
      if (shortfall <= 0) return;
      // Can only swap as many as we have in resting AND surplus to push out
      const canSwap = Math.min(shortfall, restPool.length, surplusPool.length);
      for (let i = 0; i < canSwap; i++) {
        const pullIn  = restPool[i];                            // most-rested of needed gender
        const pushOut = surplusPool[surplusPool.length - 1 - i]; // least-rested surplus
        resting = resting.filter(p => p !== pullIn);
        resting.push(pushOut);
        playing = playing.filter(p => p !== pushOut);
        playing.push(pullIn);
      }
      rebuildPools();
    }

    // Fix men shortfall first (use surplus women as pushout)
    if (menNeeded > allMenPlaying.length) {
      swapIn(menNeeded, allMenPlaying, restingMen, [...allWomenPlaying]);
    }
    // Fix women shortfall (use surplus men as pushout)
    if (womenNeeded > allWomenPlaying.length) {
      swapIn(womenNeeded, allWomenPlaying, restingWomen, [...allMenPlaying]);
    }
  }

  // ── 5. Best pair picker (fully self-contained) ──
  //       Picks disjoint pairs from pool, preferring unplayed combinations.
  //       Falls back greedily if DFS doesn't find enough pairs.
  function pickPairs(pool, needed) {
    if (pool.length < needed * 2) return [];
    // Try DFS-based disjoint pair selection
    const pairs = findDisjointPairs(pool, pairPlayedSet, needed, doublesOpponentMap) || [];
    // Greedy fallback for any missing pairs
    if (pairs.length < needed) {
      const used = new Set(pairs.flat());
      for (let i = 0; i < pool.length && pairs.length < needed; i++) {
        if (used.has(pool[i])) continue;
        for (let j = i + 1; j < pool.length; j++) {
          if (!used.has(pool[j])) {
            pairs.push([pool[i], pool[j]]);
            used.add(pool[i]); used.add(pool[j]);
            break;
          }
        }
      }
    }
    return pairs;
  }

  // ── 6. Best matchup between two pairs ──
  function bestGame(p1, p2) {
    const scores = getMatchupScores([p1, p2], doublesOpponentMap);
    return scores[0] || { pair1: p1, pair2: p2 };
  }

  // ── 7. Sequential per-court assignment ──
  //       Process typed courts FIRST to reserve correct gender players,
  //       then fill free courts with remaining players.
  const usedPlayers = new Set();
  const availMen    = () => allMenPlaying.filter(p => !usedPlayers.has(p));
  const availWomen  = () => allWomenPlaying.filter(p => !usedPlayers.has(p));
  const availAll    = () => sortRested(playing.filter(p => !usedPlayers.has(p)));
  const consume     = players => players.forEach(p => usedPlayers.add(p));

  // Build court order: singles first (pick freshest 1v1 from full pool),
  // then typed doubles, then free courts
  const courtOrder = [];
  // Pass 1: singles courts
  for (let c = 0; c < numCourts; c++) {
    const fmt  = courtFormats[c] || 'doubles';
    if (fmt === 'singles') courtOrder.push(c);
  }
  // Pass 2: typed doubles courts (MD/LD/XD)
  for (let c = 0; c < numCourts; c++) {
    const fmt  = courtFormats[c] || 'doubles';
    const type = effectiveType(courtTypes[c] || 'free', fmt);
    if (fmt !== 'singles' && type !== 'free') courtOrder.push(c);
  }
  // Pass 3: free doubles courts
  for (let c = 0; c < numCourts; c++) {
    const fmt  = courtFormats[c] || 'doubles';
    const type = effectiveType(courtTypes[c] || 'free', fmt);
    if (fmt !== 'singles' && type === 'free') courtOrder.push(c);
  }

  const games = new Array(numCourts).fill(null);

  for (const c of courtOrder) {
    const fmt  = courtFormats[c] || 'doubles';
    const type = effectiveType(courtTypes[c] || 'free', fmt);
    let game   = null;

    if (fmt === 'singles') {
      // ── Singles: 1 player per side ──
      const pool = type === 'singles-men'   ? availMen()   :
                   type === 'singles-women' ? availWomen() :
                   availAll(); // singles-free
      if (pool.length >= 2) {
        const doublesSeatsAfter = courtOrder
          .filter(index => index !== c && (courtFormats[index] || 'doubles') !== 'singles')
          .reduce(total => total + 4, 0);
        const sm = bestSinglesMatch(
          pool,
          opponentMap,
          allRounds,
          pairPlayedSet,
          doublesSeatsAfter,
          state.gamesMap || new Set()
        );
        if (sm) {
          game = { court: c + 1, pair1: [sm[0]], pair2: [sm[1]], isSingles: true };
          consume([sm[0], sm[1]]);
        }
      }

    } else if (type === 'MD') {
      // ── Men's Doubles: best 4 men from remaining ──
      const pool  = availMen();
      const pairs = pickPairs(pool, 2);
      if (pairs.length >= 2) {
        const m = bestGame(pairs[0], pairs[1]);
        game = { court: c + 1, pair1: [...m.pair1], pair2: [...m.pair2] };
        consume([...m.pair1, ...m.pair2]);
      }

    } else if (type === 'LD') {
      // ── Ladies' Doubles: best 4 women from remaining ──
      const pool  = availWomen();
      const pairs = pickPairs(pool, 2);
      if (pairs.length >= 2) {
        const m = bestGame(pairs[0], pairs[1]);
        game = { court: c + 1, pair1: [...m.pair1], pair2: [...m.pair2] };
        consume([...m.pair1, ...m.pair2]);
      }

    } else if (type === 'XD') {
      // ── Mixed Doubles: 1 man + 1 woman per pair ──
      const menPool   = availMen();
      const womenPool = availWomen();
      const xdPairs   = buildXDPairs(menPool, womenPool, pairPlayedSet, 2, doublesOpponentMap);
      if (xdPairs.length >= 2) {
        const m = bestGame(xdPairs[0], xdPairs[1]);
        game = { court: c + 1, pair1: [...m.pair1], pair2: [...m.pair2] };
        consume([...m.pair1, ...m.pair2]);
      }

    } else {
      // ── Free / singles-free: best from all remaining players ──
      const pool  = availAll();
      if (fmt === 'singles') {
        if (pool.length >= 2) {
          const doublesSeatsAfter = courtOrder
            .filter(index => index !== c && (courtFormats[index] || 'doubles') !== 'singles')
            .reduce(total => total + 4, 0);
          const sm = bestSinglesMatch(
            pool,
            opponentMap,
            allRounds,
            pairPlayedSet,
            doublesSeatsAfter,
            state.gamesMap || new Set()
          );
          if (sm) {
            game = { court: c + 1, pair1: [sm[0]], pair2: [sm[1]], isSingles: true };
            consume([sm[0], sm[1]]);
          }
        }
      } else {
        const pairs = pickPairs(pool, 2);
        if (pairs.length >= 2) {
          const m = bestGame(pairs[0], pairs[1]);
          game = { court: c + 1, pair1: [...m.pair1], pair2: [...m.pair2] };
          consume([...m.pair1, ...m.pair2]);
        }
      }
    }

    // ── Fallback: typed court failed → use remaining players ──
    if (!game) {
      const pool = availAll();
      if (fmt === 'singles') {
        if (pool.length >= 2) {
          const doublesSeatsAfter = courtOrder
            .filter(index => index !== c && (courtFormats[index] || 'doubles') !== 'singles')
            .reduce(total => total + 4, 0);
          const sm = bestSinglesMatch(
            pool,
            opponentMap,
            allRounds,
            pairPlayedSet,
            doublesSeatsAfter,
            state.gamesMap || new Set()
          );
          if (sm) {
            game = { court: c + 1, pair1: [sm[0]], pair2: [sm[1]], isSingles: true, isFallback: true };
            consume([sm[0], sm[1]]);
          }
        }
      } else {
        const pairs = pickPairs(pool, 2);
        if (pairs.length >= 2) {
          const m = bestGame(pairs[0], pairs[1]);
          game = { court: c + 1, pair1: [...m.pair1], pair2: [...m.pair2], isFallback: true };
          consume([...m.pair1, ...m.pair2]);
        }
      }
    }

    if (game) games[c] = game;
  }

  // Filter out nulls maintaining court order
  const finalGames = games.filter(g => g !== null);

  // ── 8. Any playing player not assigned → extra resting ──
  const assignedPlayers = new Set(finalGames.flatMap(g => [...(g.pair1||[]), ...(g.pair2||[])]));
  const extraResting    = playing.filter(p => !assignedPlayers.has(p));

  state.roundIndex = (state.roundIndex || 0) + 1;
  return {
    round:   state.roundIndex,
    resting: [...resting, ...extraResting].map(p => `${p}#${(restCount[p] || 0) + 1}`),
    playing: [...assignedPlayers],
    games:   finalGames,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
//  MBM BEST GAME
//  Finds the single best doubles game from a waiting pool.
//
//  Priority (in order):
//    1. Opponent freshness  — how many of the 4 cross-matchups are brand new
//    2. Partner freshness   — how long since each pair played together (pairAge)
//    3. Wait fairness       — sum of queue positions of the 4 chosen players
//       (front of waitQueue = waited longest = lower index = higher weight)
//
//  Pool is pre-filtered by mbmDice (locked courts excluded, gender-typed).
//  This function only decides WHICH 4 play and HOW they pair.
// ─────────────────────────────────────────────────────────────────────────────
function mbmBestGame(pool, waitQueue, state) {
  const { opponentMap = {}, allRounds = [], allPlayers = [] } = state;

  // ── Pair age: rounds since a & b last played together (higher = fresher) ──
  function pairAge(a, b) {
    const key = pairKey(a, b);
    let lastRound = -1;
    for (let r = 0; r < allRounds.length; r++) {
      const rnd = allRounds[r];
      if (!rnd?.games) continue;
      for (const g of rnd.games) {
        if (!g.pair1 || !g.pair2) continue;
        if (pairKey(g.pair1[0], g.pair1[1]) === key ||
            pairKey(g.pair2[0], g.pair2[1]) === key) lastRound = r;
      }
    }
    return lastRound === -1 ? allRounds.length + 1 : allRounds.length - lastRound;
  }

  // ── Opponent freshness: count cross-matchup pairs never faced ──
  function oppFreshness(t1, t2) {
    let fresh = 0;
    for (const a of t1) for (const b of t2)
      if (!((opponentMap[a] || {})[b])) fresh++;
    return fresh; // max 4
  }

  // ── Wait weight: lower queue index = waited longer = higher weight ──
  // Weight = (pool.length - queueIndex) so front-of-queue players score highest
  function waitWeight(players) {
    let w = 0;
    for (const p of players) {
      const idx = waitQueue.indexOf(p);
      w += idx === -1 ? 0 : (waitQueue.length - idx);
    }
    return w;
  }

  // ── Score a specific game (4 players, 2 pairs already decided) ──
  function scoreGame(pair1, pair2) {
    const opp  = oppFreshness(pair1, pair2);        // 0–4, higher = better
    const age  = pairAge(pair1[0], pair1[1])
               + pairAge(pair2[0], pair2[1]);       // higher = fresher partners
    const wait = waitWeight([...pair1, ...pair2]);  // tiebreaker
    return { opp, age, wait, total: opp * 1000 + age * 10 + wait };
  }

  // ── Try all C(pool,4) combinations, all 3 pairings each ──
  // For pool size ≤ 12 this is at most C(12,4)=495 combos × 3 pairings = 1485 evals — fast.
  let best = null;

  const n = pool.length;
  for (let i = 0; i < n - 3; i++) {
    for (let j = i + 1; j < n - 2; j++) {
      for (let k = j + 1; k < n - 1; k++) {
        for (let l = k + 1; l < n; l++) {
          const four = [pool[i], pool[j], pool[k], pool[l]];

          // 3 ways to split 4 players into 2 pairs:
          // (0,1)v(2,3)  (0,2)v(1,3)  (0,3)v(1,2)
          const pairings = [
            { p1: [four[0], four[1]], p2: [four[2], four[3]] },
            { p1: [four[0], four[2]], p2: [four[1], four[3]] },
            { p1: [four[0], four[3]], p2: [four[1], four[2]] },
          ];

          for (const { p1, p2 } of pairings) {
            const s = scoreGame(p1, p2);
            if (!best || s.total > best.score.total) {
              best = { pair1: p1, pair2: p2, score: s };
            }
          }
        }
      }
    }
  }

  return best ? { pair1: best.pair1, pair2: best.pair2 } : null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  TYPED BEST ROUND
//  Generates 30 candidate full rounds respecting MD/LD/XD/free court types,
//  scores each entire round, returns the best one.
//
//  Key ideas:
//  1. Free courts adapt to remaining players (all men → MD, all women → LD)
//  2. Candidates vary by which players fill which typed courts
//  3. Score = opponent freshness + partner freshness across ALL courts
// ─────────────────────────────────────────────────────────────────────────────
function typedBestRound(state) {
  const {
    numCourts, pairPlayedSet, opponentMap, restCount,
    allPlayers = [], allRounds = [], fixedPairs = [],
    courtTypes = [], courtFormats = [],
  } = state;

  const { resting, playing } = selectRestingAndPlaying(state);
  const playingSet = new Set(playing);

  // Gender helpers
  const gender = p => {
    const pl = allPlayers.find(x => x.name === p);
    return pl ? pl.gender : 'Male';
  };
  const isMale   = p => gender(p) === 'Male';
  const isFemale = p => gender(p) === 'Female';

  // Fixed pairs already playing
  const fixedThisRound = fixedPairs.filter(([a, b]) => playingSet.has(a) && playingSet.has(b));
  const fixedPlayerSet = new Set(fixedThisRound.flat());

  // Free players (not in fixed pairs)
  const freePlaying = playing.filter(p => !fixedPlayerSet.has(p));
  const men   = freePlaying.filter(isMale);
  const women = freePlaying.filter(isFemale);

  // Pair scoring helpers
  function pairScore(a, b) {
    const oppCount = ((opponentMap[a] || {})[b] || 0) + ((opponentMap[b] || {})[a] || 0);
    const isNew    = !pairPlayedSet.has(pairKey(a, b));
    return (isNew ? 10000 : 0) - oppCount;
  }

  function gameScore(p1, p2) {
    let opp = 0;
    for (const a of p1) for (const b of p2) {
      if (!((opponentMap[a] || {})[b])) opp++;
    }
    const partnerNew =
      (!pairPlayedSet.has(pairKey(p1[0], p1[1])) ? 1 : 0) +
      (!pairPlayedSet.has(pairKey(p2[0], p2[1])) ? 1 : 0);
    return opp * 100 + partnerNew * 10;
  }

  function roundScore(games) {
    const counts = state.gameTypeCounts || { MD:{}, LD:{}, XD:{}, singles:{} };
    let freshness = 0;
    let typePenalty = 0;
    for (const g of games) {
      freshness += gameScore(g.pair1, g.pair2);
      const idx = Math.max(0, (g.court || 1) - 1);
      const type = courtTypes[idx] || 'free';
      const bucket = type === 'MD' ? counts.MD : type === 'LD' ? counts.LD : type === 'XD' ? counts.XD : null;
      if (bucket) for (const p of [...g.pair1, ...g.pair2]) typePenalty += bucket[p] || 0;
    }
    // Type balance is above freshness, but participation has already been fixed.
    return freshness - typePenalty * 100000;
  }

  // All permutations of picking k items from arr (returns arrays)
  function combos(arr, k) {
    const result = [];
    function pick(start, current) {
      if (current.length === k) { result.push([...current]); return; }
      for (let i = start; i < arr.length; i++) {
        current.push(arr[i]);
        pick(i + 1, current);
        current.pop();
      }
    }
    pick(0, []);
    return result;
  }

  // All 3 ways to split 4 players into 2 pairs
  function allPairings(four) {
    return [
      { p1: [four[0], four[1]], p2: [four[2], four[3]] },
      { p1: [four[0], four[2]], p2: [four[1], four[3]] },
      { p1: [four[0], four[3]], p2: [four[1], four[2]] },
    ];
  }

  // Best pairing of 4 players
  function bestPairing(four) {
    let best = null, bestS = -Infinity;
    for (const { p1, p2 } of allPairings(four)) {
      const s = gameScore(p1, p2);
      if (s > bestS) { bestS = s; best = { pair1: p1, pair2: p2 }; }
    }
    return best || { pair1: [four[0], four[1]], pair2: [four[2], four[3]] };
  }

  // Best XD pairing: 2 men + 2 women, 1 man+1 woman per pair
  function bestXDPairing(fourMen, fourWomen) {
    // fourMen = [m1,m2], fourWomen = [w1,w2]
    // Option A: (m1+w1) vs (m2+w2)
    // Option B: (m1+w2) vs (m2+w1)
    const [m1, m2] = fourMen, [w1, w2] = fourWomen;
    const a = { pair1: [m1, w1], pair2: [m2, w2] };
    const b = { pair1: [m1, w2], pair2: [m2, w1] };
    return gameScore(a.pair1, a.pair2) >= gameScore(b.pair1, b.pair2) ? a : b;
  }

  // Determine effective court type considering available players
  function effectiveCourtType(type, fmt, availMen, availWomen) {
    if (fmt === 'singles') return 'singles'; // handled separately
    if (type === 'MD' && availMen.length   < 4) return 'free';
    if (type === 'LD' && availWomen.length < 4) return 'free';
    if (type === 'XD' && (availMen.length  < 2 || availWomen.length < 2)) return 'free';
    if (type === 'free') {
      // Adapt free court to remaining pool
      if (availMen.length >= 4 && availWomen.length === 0) return 'MD';
      if (availWomen.length >= 4 && availMen.length === 0) return 'LD';
    }
    return type || 'free';
  }

  // Generate ONE candidate round given a specific player ordering
  function generateCandidate(menOrder, womenOrder) {
    const usedM = new Set(), usedW = new Set(), usedAll = new Set();
    const games = [];

    // Fixed pairs go first
    for (const fp of fixedThisRound) {
      games.push({ pair1: [fp[0]], pair2: [fp[1]], isFixed: true });
      fp.forEach(p => usedAll.add(p));
    }

    // Process courts in order: typed first, free last
    const courtOrder = [];
    for (let c = 0; c < numCourts; c++) {
      const t = courtTypes[c] || 'free';
      if (t !== 'free') courtOrder.push(c);
    }
    for (let c = 0; c < numCourts; c++) {
      const t = courtTypes[c] || 'free';
      if (t === 'free') courtOrder.push(c);
    }

    for (const c of courtOrder) {
      const fmt  = courtFormats[c] || 'doubles';
      if (fmt === 'singles') continue; // handled by bestSinglesMatch separately

      const availM = menOrder.filter(p => !usedM.has(p) && !usedAll.has(p));
      const availW = womenOrder.filter(p => !usedW.has(p) && !usedAll.has(p));
      const availA = [...availM, ...availW];

      const eff = effectiveCourtType(courtTypes[c] || 'free', fmt, availM, availW);

      let game = null;

      if (eff === 'MD' && availM.length >= 4) {
        const four = availM.slice(0, 4);
        game = { court: c + 1, ...bestPairing(four) };
        four.forEach(p => { usedM.add(p); usedAll.add(p); });

      } else if (eff === 'LD' && availW.length >= 4) {
        const four = availW.slice(0, 4);
        game = { court: c + 1, ...bestPairing(four) };
        four.forEach(p => { usedW.add(p); usedAll.add(p); });

      } else if (eff === 'XD' && availM.length >= 2 && availW.length >= 2) {
        const twoM = availM.slice(0, 2), twoW = availW.slice(0, 2);
        game = { court: c + 1, ...bestXDPairing(twoM, twoW) };
        twoM.forEach(p => { usedM.add(p); usedAll.add(p); });
        twoW.forEach(p => { usedW.add(p); usedAll.add(p); });

      } else if (availA.length >= 4) {
        // Free court or fallback
        const four = availA.slice(0, 4);
        game = { court: c + 1, ...bestPairing(four) };
        four.forEach(p => {
          if (isMale(p)) usedM.add(p); else usedW.add(p);
          usedAll.add(p);
        });
      }

      if (game) games.push(game);
    }

    return games;
  }

  // Generate candidates by shuffling the player order
  // Use scored ordering as base — sort men and women by pair freshness
  function scoredOrder(pool) {
    return pool.slice().sort((a, b) => {
      const aScore = pool.reduce((s, x) => s + pairScore(a, x), 0);
      const bScore = pool.reduce((s, x) => s + pairScore(b, x), 0);
      return bScore - aScore;
    });
  }

  const baseMen   = scoredOrder(men);
  const baseWomen = scoredOrder(women);

  // Generate up to 30 candidates by rotating player order
  const candidates = [];
  const seen = new Set();

  function tryCandidate(mOrder, wOrder) {
    const key = [...mOrder, '|', ...wOrder].join(',');
    if (seen.has(key)) return;
    seen.add(key);
    const games = generateCandidate(mOrder, wOrder);
    if (games.length > 0) candidates.push({ games, score: roundScore(games) });
  }

  // Base order
  tryCandidate(baseMen, baseWomen);

  // Rotations of men
  for (let i = 0; i < baseMen.length; i++) {
    const rotated = [...baseMen.slice(i), ...baseMen.slice(0, i)];
    tryCandidate(rotated, baseWomen);
    tryCandidate(rotated, [...baseWomen].reverse());
  }

  // Rotations of women
  for (let i = 0; i < baseWomen.length; i++) {
    const rotated = [...baseWomen.slice(i), ...baseWomen.slice(0, i)];
    tryCandidate(baseMen, rotated);
    tryCandidate([...baseMen].reverse(), rotated);
  }

  // Pair combos of men (try different 4-man groups for MD courts)
  const menCombos = combos(baseMen, Math.min(4, baseMen.length));
  for (const mc of menCombos.slice(0, 15)) {
    const rest = baseMen.filter(p => !mc.includes(p));
    tryCandidate([...mc, ...rest], baseWomen);
    if (candidates.length >= 30) break;
  }

  // Pair combos of women
  const womenCombos = combos(baseWomen, Math.min(4, baseWomen.length));
  for (const wc of womenCombos.slice(0, 15)) {
    const rest = baseWomen.filter(p => !wc.includes(p));
    tryCandidate(baseMen, [...wc, ...rest]);
    if (candidates.length >= 30) break;
  }

  // Pick best scoring candidate
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  if (!best) {
    // Fallback to randomRound if no candidates generated
    return randomRound(state);
  }

  // Assign court numbers correctly
  const finalGames = best.games
    .filter(g => g.pair1 && g.pair2)
    .map((g, i) => ({ court: g.court || (i + 1), pair1: [...g.pair1], pair2: [...g.pair2] }));

  // Players not assigned → extra resting
  const assigned = new Set(finalGames.flatMap(g => [...g.pair1, ...g.pair2]));
  const extraResting = playing.filter(p => !assigned.has(p));

  state.roundIndex = (state.roundIndex || 0) + 1;
  return {
    round:   state.roundIndex,
    resting: [...resting, ...extraResting].map(p => `${p}#${(restCount[p] || 0) + 1}`),
    playing: [...assigned],
    games:   finalGames,
  };
}



function buildNextHistory(state, result) {
  const played = { ...(state.playedCount || {}) };
  const rested = { ...(state.restCount || {}) };
  const types = {
    MD: { ...(state.gameTypeCounts?.MD || {}) },
    LD: { ...(state.gameTypeCounts?.LD || {}) },
    XD: { ...(state.gameTypeCounts?.XD || {}) },
    singles: { ...(state.gameTypeCounts?.singles || {}) },
  };
  const pairSet = new Set(state.pairPlayedSet || []);
  const gameSet = new Set(state.gamesMap || []);
  const opponents = {};
  for (const [p, inner] of Object.entries(state.opponentMap || {})) opponents[p] = { ...(inner || {}) };

  const restingNames = (result.resting || []).map(p => String(p).split('#')[0]);
  for (const p of restingNames) rested[p] = (rested[p] || 0) + 1;

  const playedThisRound = [];
  (result.games || []).forEach((game, index) => {
    const names = [...(game.pair1 || []), ...(game.pair2 || [])];
    playedThisRound.push(...names);
    const isSingles = (game.pair1 || []).length === 1 && (game.pair2 || []).length === 1;
    const type = game.type || game.courtType || (state.courtTypes || [])[index] || 'free';
    for (const p of names) {
      played[p] = (played[p] || 0) + 1;
      if (isSingles) types.singles[p] = (types.singles[p] || 0) + 1;
      else if (type === 'MD' || type === 'LD' || type === 'XD') types[type][p] = (types[type][p] || 0) + 1;
    }
    if (!isSingles) {
      pairSet.add(pairKey(game.pair1[0], game.pair1[1]));
      pairSet.add(pairKey(game.pair2[0], game.pair2[1]));
    }
    gameSet.add(gameKey(game.pair1 || [], game.pair2 || []));
    for (const a of (game.pair1 || [])) {
      if (!opponents[a]) opponents[a] = {};
      for (const b of (game.pair2 || [])) {
        if (!opponents[b]) opponents[b] = {};
        opponents[a][b] = (opponents[a][b] || 0) + 1;
        opponents[b][a] = (opponents[b][a] || 0) + 1;
      }
    }
  });

  let queue = Array.isArray(state.restQueue) ? [...state.restQueue] : [];
  const restingSet = new Set(restingNames);
  queue = queue.filter(p => !restingSet.has(String(p).split('#')[0]));
  queue.push(...restingNames);

  return {
    playedCount: Object.entries(played),
    restCount: Object.entries(rested),
    restQueue: queue,
    gameTypeCounts: {
      MD: Object.entries(types.MD),
      LD: Object.entries(types.LD),
      XD: Object.entries(types.XD),
      singles: Object.entries(types.singles),
    },
    pairPlayedSet: [...pairSet],
    gamesMap: [...gameSet],
    opponentMap: Object.entries(opponents).map(([p, inner]) => [p, Object.entries(inner)]),
    previousRound: { games: result.games || [], resting: result.resting || [], playing: [...new Set(playedThisRound)] },
  };
}

function buildRoundValidation(state, result) {
  const players = (result.games || []).flatMap(g => [...(g.pair1 || []), ...(g.pair2 || [])]);
  const resting = (result.resting || []).map(p => String(p).split('#')[0]);
  const duplicatePlayers = new Set(players).size !== players.length;
  const overlap = resting.some(p => players.includes(p));
  const incompleteGames = (result.games || []).some(g => {
    const singles = (g.pair1 || []).length === 1 && (g.pair2 || []).length === 1;
    return singles ? false : (g.pair1 || []).length !== 2 || (g.pair2 || []).length !== 2;
  });
  const next = buildNextHistory(state, result);
  const pc = Object.fromEntries(next.playedCount);
  const rc = Object.fromEntries(next.restCount);
  const active = state.activeplayers || [];
  const playedVals = active.map(p => pc[p] || 0);
  const restVals = active.map(p => rc[p] || 0);
  return {
    valid: !duplicatePlayers && !overlap && !incompleteGames,
    duplicatePlayers,
    restingPlayingOverlap: overlap,
    incompleteGames,
    playedSpread: playedVals.length ? Math.max(...playedVals) - Math.min(...playedVals) : 0,
    restSpread: restVals.length ? Math.max(...restVals) - Math.min(...restVals) : 0,
  };
}

async function handleGenerateRound(request, env) {
  const req           = await request.json();
  const history       = req.history || {};
  const restCount     = Object.fromEntries(history.restCount || req.restCount || []);
  const playedCount   = Object.fromEntries(history.playedCount || req.playedCount || []);
  const opponentSerial = history.opponentMap || req.opponentMap || [];
  const opponentMap   = Object.fromEntries(opponentSerial.map(([p, inner]) => [p, Object.fromEntries(inner || [])]));
  const pairPlayedSet = new Set(history.pairPlayedSet || req.pairPlayedSet || []);
  const gamesMap      = new Set(history.gamesMap || req.gamesMap || []);
  const allRounds     = req.allRounds || [];
  let lastRound = [];
  if (allRounds.length) {
    const last = allRounds[allRounds.length - 1];
    if (last?.games) lastRound = last.games.flatMap(g => [...(g.pair1||[]), ...(g.pair2||[])]);
  }
  const state = {
    activeplayers:          req.activeplayers || [],
    numCourts:              req.numCourts,
    courts:                 req.courts || req.numCourts,
    fixedPairs:             req.fixedPairs || [],
    restQueue:              history.restQueue || req.restQueue || [],
    restCount,
    playedCount,
    opponentMap,
    pairPlayedSet,
    gamesMap,
    allRounds,
    playMode:               req.playMode || 'random',
    minRounds:              req.minRounds || 6,
    lastMode:               req.lastMode || null,
    allPlayers:             req.allPlayers || [],
    roundIndex:             req.roundIndex || 0,
    lastRound,
    fixedPairGameQueue:     req.fixedPairGameQueue || null,
    fixedPairGameQueueHash: req.fixedPairGameQueueHash || null,
    courtTypes:             req.courtTypes   || [],
    courtFormats:           req.courtFormats || [],
    uniqueGamesMode:        req.uniqueGamesMode || false,
    balancedMode:           !!req.balancedMode,
    topDownStandardMode:    !!req.topDownStandardMode,
    requiredGames:          req.requiredGames || {},
    gameTypeCounts: {
      MD: Object.fromEntries(history.gameTypeCounts?.MD || req.gameTypeCounts?.MD || []),
      LD: Object.fromEntries(history.gameTypeCounts?.LD || req.gameTypeCounts?.LD || []),
      XD: Object.fromEntries(history.gameTypeCounts?.XD || req.gameTypeCounts?.XD || []),
      singles: Object.fromEntries(history.gameTypeCounts?.singles || req.gameTypeCounts?.singles || []),
    },
    allRounds:              allRounds,
    opponentMap:            opponentMap,
  };

  // ── MBM fast path: find best game from pre-filtered pool ──
  // Pool is already locked-court-excluded and gender-filtered by mbmDice.
  // We just find the best 4 players + pairing using full history.
  if (req._mbmCall) {
    const waitQueue = req._mbmWaitQueue || [];
    const game = mbmBestGame(state.activeplayers, waitQueue, state);
    if (!game) return json({ error: 'Not enough players' }, 400);
    return json({ games: [{ court: 1, pair1: game.pair1, pair2: game.pair2 }] });
  }

  // Route to correct round generator
  const hasDoubleTypedCourts = (state.courtTypes || []).some(
    type => type === 'MD' || type === 'LD' || type === 'XD'
  );
  const hasSinglesCourts     = (state.courtFormats || []).some(f => f === 'singles');

  const useComp = state.playMode === 'competitive';
  if (useComp && state.lastMode !== 'competitive') resetForCompetitive(state);
  let result = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let roundFn;
    if (state.balancedMode) roundFn = balancedRoundV1;         // Balanced → Standard + frozen Top/Bottom hard filter
    else if (hasSinglesCourts) roundFn = typedRound;           // mixed Singles/Doubles → format-aware generator
    else if (hasDoubleTypedCourts) roundFn = typedBestRound;   // MD/LD/XD Doubles → typed best round
    else if (useComp) roundFn = competitiveRound;              // competitive → existing
    else if (!state.uniqueGamesMode) roundFn = standardRoundV2; // Standard → participation-first DFS
    else roundFn = randomRound;                                // Unique → existing grouped algorithm
    result = roundFn(state);
    const qc = validateRound(result, state);
    if (qc.valid) break;
    if (result?.games) {
      for (const g of result.games) {
        if (g.pair1 && g.pair2) {
          const mk = gameKey(g.pair1, g.pair2);
          state.gamesMap.add(mk);
          state.pairPlayedSet.add(pairKey(g.pair1[0], g.pair1[1]));
          state.pairPlayedSet.add(pairKey(g.pair2[0], g.pair2[1]));
        }
      }
    }
  }
  if (!result) return json({ error: 'Failed to generate round' }, 500);
  const nextHistory = buildNextHistory(state, result);
  const validation = buildRoundValidation(state, result);
  return json({
    games:                         result.games,
    resting:                       result.resting,
    playing:                       result.playing,
    roundIndex:                    state.roundIndex,
    lastMode:                      useComp ? 'competitive' : 'random',
    updatedPairPlayedSet:          [...state.pairPlayedSet],
    updatedGamesMap:               [...state.gamesMap],
    updatedOpponentMap:            Object.entries(state.opponentMap).map(([p, inner]) => [p, Object.entries(inner)]),
    updatedFixedPairGameQueue:     state.fixedPairGameQueue,
    updatedFixedPairGameQueueHash: state.fixedPairGameQueueHash,
    nextHistory,
    validation,
  });
}

/* ============================================================
   LINE LOGIN
   OAuth 2.0 authorization code flow + OpenID Connect.
   Required Worker secrets/variables:
   LINE_CHANNEL_ID, LINE_CHANNEL_SECRET, LINE_APP_URL,
   LINE_CALLBACK_URL, TOKEN_SECRET, optional LINE_STATE_SECRET.
   ============================================================ */

function lineAppUrl(env) {
  try {
    const url = new URL(env.LINE_APP_URL || 'https://scs-app.com/');
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      throw new Error('LINE_APP_URL must use HTTPS');
    }
    return url;
  } catch {
    return new URL('https://scs-app.com/');
  }
}

function lineCallbackUrl(request, env) {
  if (env.LINE_CALLBACK_URL) return env.LINE_CALLBACK_URL;
  return new URL('/auth/line/callback', request.url).toString();
}

function lineRedirect(env, key, value) {
  const target = lineAppUrl(env);
  target.hash = key + '=' + encodeURIComponent(String(value || 'unknown'));
  return new Response(null, {
    status: 302,
    headers: {
      'Location': target.toString(),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

function lineRandom(bytes = 24) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  let binary = '';
  for (const value of data) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function readCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  for (const part of cookie.split(';')) {
    const index = part.indexOf('=');
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); }
    catch { return part.slice(index + 1).trim(); }
  }
  return null;
}

function lineStateCookie(value, maxAge) {
  return 'scs_line_state=' + encodeURIComponent(value || '') +
    '; Path=/auth/line; HttpOnly; Secure; SameSite=Lax; Max-Age=' + String(maxAge);
}

function lineSafeNickname(value) {
  const nickname = String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60);
  return nickname || 'LINE Player';
}

async function lineVerifierHash(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function lineValidHandoff(id, verifier) {
  return /^[a-f0-9-]{36}$/i.test(String(id || '')) &&
    /^[A-Za-z0-9_-]{40,128}$/.test(String(verifier || ''));
}

async function handleLineStart(request, env) {
  if (!env.LINE_CHANNEL_ID || !env.LINE_CHANNEL_SECRET || !env.TOKEN_SECRET) {
    return lineRedirect(env, 'line_error', 'not_configured');
  }

  const url = new URL(request.url);
  const handoffId = url.searchParams.get('handoff_id') || '';
  if (handoffId && !/^[a-f0-9-]{36}$/i.test(handoffId)) {
    return lineRedirect(env, 'line_error', 'invalid_handoff');
  }

  let verifierHash = '';
  if (handoffId) {
    try {
      const rows = await sbGet(env, 'line_login_handoffs',
        'id=eq.' + encodeURIComponent(handoffId) +
        '&status=eq.pending&select=id,verifier_hash,expires_at');
      const handoff = rows && rows[0];
      if (!handoff || new Date(handoff.expires_at).getTime() <= Date.now()) {
        return lineRedirect(env, 'line_error', 'invalid_handoff');
      }
      verifierHash = handoff.verifier_hash;
    } catch {
      return lineRedirect(env, 'line_error', 'handoff_not_ready');
    }
  }

  const nonce = lineRandom(24);
  const stateSecret = env.LINE_STATE_SECRET || env.TOKEN_SECRET;
  const state = await signToken({
    purpose: 'line_oauth_state',
    nonce,
    handoffId: handoffId || null,
    verifierHash: verifierHash || null,
    exp: Date.now() + 10 * 60 * 1000
  }, stateSecret);

  const authorize = new URL('https://access.line.me/oauth2/v2.1/authorize');
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', env.LINE_CHANNEL_ID);
  authorize.searchParams.set('redirect_uri', lineCallbackUrl(request, env));
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('scope', 'openid profile');
  authorize.searchParams.set('nonce', nonce);

  return new Response(null, {
    status: 302,
    headers: {
      'Location': authorize.toString(),
      'Set-Cookie': lineStateCookie(state, 600),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

async function handleLineHandoffCreate(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!env.TOKEN_SECRET) return json({ error: 'Social login is not configured' }, 503);
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '');
  const verifier = String(body.verifier || '');
  const deviceCode = String(body.deviceCode || '').toUpperCase();
  if (!lineValidHandoff(id, verifier) || !/^[A-HJ-NP-Z2-9]{8}$/.test(deviceCode)) {
    return json({ error: 'Invalid handoff' }, 400);
  }

  try {
    await sbUpsert(env, 'line_login_handoffs', {
      id,
      device_code: deviceCode,
      verifier_hash: await lineVerifierHash(verifier),
      status: 'pending',
      account_id: null,
      completion_proof: null,
      created_at: new Date().toISOString(),
      completed_at: null,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    }, 'id');
    return json({ ok: true });
  } catch {
    return json({ error: 'iPhone app login is not ready yet.' }, 503);
  }
}

async function handleLineDevice(request, env) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const url = new URL(request.url);
  const code = String(url.searchParams.get('code') || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) return lineRedirect(env, 'line_error', 'invalid_handoff');

  try {
    const rows = await sbGet(env, 'line_login_handoffs',
      'device_code=eq.' + encodeURIComponent(code) +
      '&status=eq.pending&select=id,expires_at');
    const handoff = rows && rows[0];
    if (!handoff || new Date(handoff.expires_at).getTime() <= Date.now()) {
      return lineRedirect(env, 'line_error', 'invalid_handoff');
    }
    const startUrl = new URL('/auth/line/start', request.url);
    startUrl.searchParams.set('handoff_id', handoff.id);
    return new Response(null, {
      status: 302,
      headers: { 'Location': startUrl.toString(), 'Cache-Control': 'no-store' }
    });
  } catch {
    return lineRedirect(env, 'line_error', 'handoff_not_ready');
  }
}

async function handleLineCallback(request, env) {
  const url = new URL(request.url);
  const clearCookie = lineStateCookie('', 0);

  if (url.searchParams.get('error')) {
    const returnedState = url.searchParams.get('state') || '';
    const state = await verifyToken(returnedState, env.LINE_STATE_SECRET || env.TOKEN_SECRET || '');
    if (state && state.handoffId) {
      await sbPatch(env, 'line_login_handoffs',
        'id=eq.' + encodeURIComponent(state.handoffId),
        { status: 'cancelled' }).catch(() => {});
    }
    const response = state && state.handoffId
      ? lineRedirect(env, 'line_handoff', 'cancelled')
      : lineRedirect(env, 'line_error', 'cancelled');
    response.headers.set('Set-Cookie', clearCookie);
    return response;
  }

  try {
    if (!env.LINE_CHANNEL_ID || !env.LINE_CHANNEL_SECRET || !env.TOKEN_SECRET) {
      throw new Error('not_configured');
    }

    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    const cookieState = readCookie(request, 'scs_line_state');
    if (!code || !returnedState) {
      throw new Error('invalid_state');
    }

    const stateSecret = env.LINE_STATE_SECRET || env.TOKEN_SECRET;
    const state = await verifyToken(returnedState, stateSecret);
    if (!state || state.purpose !== 'line_oauth_state' || !state.nonce) {
      throw new Error('invalid_state');
    }
    // iOS may return device-activation OAuth in a different browser context,
    // where the HttpOnly state cookie is unavailable. Device handoffs remain
    // bound to a signed state, a short-lived database row and a verifier hash.
    // Ordinary browser login still requires the matching state cookie.
    if (!state.handoffId && (!cookieState || returnedState !== cookieState)) {
      throw new Error('invalid_state');
    }

    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: lineCallbackUrl(request, env),
      client_id: env.LINE_CHANNEL_ID,
      client_secret: env.LINE_CHANNEL_SECRET
    });
    const tokenResponse = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString()
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData.id_token) throw new Error('token_exchange_failed');

    const verifyBody = new URLSearchParams({
      id_token: tokenData.id_token,
      client_id: env.LINE_CHANNEL_ID,
      nonce: state.nonce
    });
    const verifyResponse = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: verifyBody.toString()
    });
    const profile = await verifyResponse.json().catch(() => ({}));
    if (!verifyResponse.ok || !profile.sub) throw new Error('id_token_invalid');

    const lineUserId = String(profile.sub);
    const nickname = lineSafeNickname(profile.name);
    let accounts;
    try {
      accounts = await sbGet(env, 'user_accounts',
        'line_user_id=eq.' + encodeURIComponent(lineUserId) +
        '&select=id,nickname,email,gender,auth_provider,line_picture_url,line_nickname_confirmed');
    } catch (error) {
      if (String(error.message || '').includes('line_user_id')) throw new Error('database_not_ready');
      throw error;
    }

    let account;
    if (accounts && accounts.length) {
      account = accounts[0];
      const updates = {
        line_display_name: nickname,
        line_picture_url: profile.picture || null,
        auth_provider: mergeAuthProvider(account.auth_provider, 'line')
      };
      if (!account.email && profile.email) updates.email = String(profile.email).toLowerCase();
      await sbPatch(env, 'user_accounts', 'id=eq.' + encodeURIComponent(account.id), updates);
      account = { ...account, ...updates };
    } else {
      const lineEmail = profile.email ? String(profile.email).trim().toLowerCase() : null;
      let emailAccounts = [];
      if (lineEmail) {
        emailAccounts = await sbGet(env, 'user_accounts',
          'email=ilike.' + encodeURIComponent(lineEmail) +
          '&select=id,nickname,email,gender,auth_provider,line_picture_url,line_nickname_confirmed&limit=1');
      }
      if (emailAccounts && emailAccounts.length) {
        account = emailAccounts[0];
        const updates = {
          line_user_id: lineUserId,
          line_display_name: nickname,
          line_picture_url: profile.picture || null,
          line_nickname_confirmed: true,
          auth_provider: mergeAuthProvider(account.auth_provider, 'line')
        };
        await sbPatch(env, 'user_accounts', 'id=eq.' + encodeURIComponent(account.id), updates);
        account = { ...account, ...updates };
      } else {
        const created = await sbPost(env, 'user_accounts', {
          user_id: 'line:' + lineUserId,
          nickname,
          email: lineEmail,
          gender: null,
          password_hash: null,
          recovery_word: null,
          auth_provider: 'line',
          line_user_id: lineUserId,
          line_display_name: nickname,
          line_picture_url: profile.picture || null,
          line_nickname_confirmed: false
        });
        account = created[0];
      }
    }

    const ticket = await signToken({
      purpose: 'line_login_ticket',
      accountId: account.id,
      exp: Date.now() + 2 * 60 * 1000
    }, env.TOKEN_SECRET);

    if (state.handoffId) {
      const rows = await sbGet(env, 'line_login_handoffs',
        'id=eq.' + encodeURIComponent(state.handoffId) +
        '&select=id,verifier_hash,status,expires_at');
      const handoff = rows && rows[0];
      if (!handoff || handoff.status !== 'pending' ||
          new Date(handoff.expires_at).getTime() <= Date.now() ||
          handoff.verifier_hash !== state.verifierHash) {
        throw new Error('invalid_handoff');
      }
      const completionProof = await signToken({
        purpose: 'line_handoff_completion',
        handoffId: handoff.id,
        verifierHash: handoff.verifier_hash,
        accountId: account.id,
        exp: Date.now() + 10 * 60 * 1000
      }, env.TOKEN_SECRET);
      await sbPatch(env, 'line_login_handoffs',
        'id=eq.' + encodeURIComponent(handoff.id), {
          status: 'complete',
          account_id: String(account.id),
          completion_proof: completionProof,
          completed_at: new Date().toISOString()
        });
      const response = lineRedirect(env, 'line_handoff', 'complete');
      response.headers.set('Set-Cookie', clearCookie);
      return response;
    }

    const response = lineRedirect(env, 'line_auth', ticket);
    response.headers.set('Set-Cookie', clearCookie);
    return response;
  } catch (error) {
    const known = new Set([
      'not_configured', 'invalid_state', 'token_exchange_failed',
      'id_token_invalid', 'database_not_ready', 'invalid_handoff', 'handoff_not_ready'
    ]);
    const code = known.has(error.message) ? error.message : 'login_failed';
    const response = lineRedirect(env, 'line_error', code);
    response.headers.set('Set-Cookie', clearCookie);
    return response;
  }
}

async function handleLineHandoffStatus(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!env.TOKEN_SECRET) return json({ error: 'Social login is not configured' }, 503);

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '');
  const verifier = String(body.verifier || '');
  if (!lineValidHandoff(id, verifier)) return json({ error: 'Invalid handoff' }, 400);

  const rows = await sbGet(env, 'line_login_handoffs',
    'id=eq.' + encodeURIComponent(id) +
    '&select=id,verifier_hash,status,account_id,completion_proof,expires_at');
  const handoff = rows && rows[0];
  if (!handoff) return json({ status: 'pending' });

  const verifierHash = await lineVerifierHash(verifier);
  if (handoff.verifier_hash !== verifierHash) return json({ error: 'Invalid handoff' }, 403);
  if (new Date(handoff.expires_at).getTime() <= Date.now()) {
    await sbDelete(env, 'line_login_handoffs', 'id=eq.' + encodeURIComponent(id)).catch(() => {});
    return json({ status: 'expired' }, 410);
  }
  if (handoff.status === 'cancelled') {
    await sbDelete(env, 'line_login_handoffs', 'id=eq.' + encodeURIComponent(id)).catch(() => {});
    return json({ status: 'cancelled' });
  }
  if (handoff.status !== 'complete') return json({ status: 'pending' });

  const proof = await verifyToken(handoff.completion_proof || '', env.TOKEN_SECRET);
  if (!proof || !['line_handoff_completion', 'google_handoff_completion'].includes(proof.purpose) ||
      proof.handoffId !== id || proof.verifierHash !== verifierHash ||
      String(proof.accountId) !== String(handoff.account_id)) {
    return json({ error: 'Invalid handoff proof' }, 403);
  }

  const provider = proof.provider === 'google' || proof.purpose === 'google_handoff_completion'
    ? 'google' : 'line';
  const ticket = await signToken({
    purpose: provider + '_login_ticket',
    accountId: proof.accountId,
    exp: Date.now() + 2 * 60 * 1000
  }, env.TOKEN_SECRET);
  await sbDelete(env, 'line_login_handoffs', 'id=eq.' + encodeURIComponent(id)).catch(() => {});
  return json({ status: 'complete', ticket, provider });
}

async function handleLineComplete(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!env.TOKEN_SECRET) return json({ error: 'LINE Login is not configured' }, 503);

  const body = await request.json().catch(() => ({}));
  const payload = await verifyToken(body.ticket || '', env.TOKEN_SECRET);
  if (!payload || payload.purpose !== 'line_login_ticket' || !payload.accountId) {
    return json({ error: 'LINE login expired. Please try again.' }, 401);
  }

  const rows = await sbGet(env, 'user_accounts',
    'id=eq.' + encodeURIComponent(payload.accountId) +
    '&select=id,nickname,email,gender,auth_provider,line_picture_url,line_nickname_confirmed');
  if (!rows || !rows.length) return json({ error: 'LINE account was not found.' }, 404);

  const account = rows[0];
  return json({
    needsProfile: account.line_nickname_confirmed === false,
    needsNickname: account.line_nickname_confirmed === false,
    user: {
      id: account.id,
      nickname: account.nickname,
      displayName: account.nickname,
      email: account.email || null,
      gender: account.gender || null,
      authProvider: account.auth_provider || 'line',
      picture: account.line_picture_url || null
    }
  });
}

async function handleLineNickname(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!env.TOKEN_SECRET) return json({ error: 'LINE Login is not configured' }, 503);

  const body = await request.json().catch(() => ({}));
  const payload = await verifyToken(body.ticket || '', env.TOKEN_SECRET);
  if (!payload || payload.purpose !== 'line_login_ticket' || !payload.accountId) {
    return json({ error: 'LINE login expired. Please try again.' }, 401);
  }

  const nickname = String(body.nickname || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 40);
  if (!nickname) return json({ error: 'Please enter your player nickname.' }, 400);
  const gender = String(body.gender || '');
  if (!['Male', 'Female'].includes(gender)) {
    return json({ error: 'Please select your gender.' }, 400);
  }

  const rows = await sbPatch(env, 'user_accounts',
    'id=eq.' + encodeURIComponent(payload.accountId),
    { nickname, gender, line_nickname_confirmed: true },
    'return=representation');
  const account = rows && rows[0];
  if (!account) return json({ error: 'LINE account was not found.' }, 404);

  return json({
    user: {
      id: account.id,
      nickname: account.nickname,
      displayName: account.nickname,
      email: account.email || null,
      gender: account.gender || gender,
      authProvider: account.auth_provider || 'line',
      picture: account.line_picture_url || null
    }
  });
}

/* ============================================================
   GOOGLE LOGIN
   OAuth 2.0 authorization code flow + OpenID Connect.
   Required Worker secrets/variables:
   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TOKEN_SECRET.
   Optional: GOOGLE_APP_URL, GOOGLE_CALLBACK_URL, GOOGLE_STATE_SECRET.
   ============================================================ */

function googleAppUrl(env) {
  try {
    const url = new URL(env.GOOGLE_APP_URL || env.LINE_APP_URL || 'https://scs-app.com/');
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      throw new Error('GOOGLE_APP_URL must use HTTPS');
    }
    return url;
  } catch {
    return new URL('https://scs-app.com/');
  }
}

function googleCallbackUrl(request, env) {
  if (env.GOOGLE_CALLBACK_URL) return env.GOOGLE_CALLBACK_URL;
  return new URL('/auth/google/callback', request.url).toString();
}

function googleRedirect(env, key, value) {
  const target = googleAppUrl(env);
  target.hash = key + '=' + encodeURIComponent(String(value || 'unknown'));
  return new Response(null, {
    status: 302,
    headers: {
      'Location': target.toString(),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

function googleStateCookie(value, maxAge) {
  return 'scs_google_state=' + encodeURIComponent(value || '') +
    '; Path=/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=' + String(maxAge);
}

function googleSafeDisplayName(value) {
  const name = String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60);
  return name || 'Google Player';
}

function mergeAuthProvider(existing, provider) {
  const providers = String(existing || '').split('_').map(value => value.trim()).filter(Boolean);
  if (!providers.includes(provider)) providers.push(provider);
  return providers.length ? providers.join('_') : provider;
}

async function handleGoogleStart(request, env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.TOKEN_SECRET) {
    return googleRedirect(env, 'google_error', 'not_configured');
  }

  const url = new URL(request.url);
  const handoffId = url.searchParams.get('handoff_id') || '';
  if (handoffId && !/^[a-f0-9-]{36}$/i.test(handoffId)) {
    return googleRedirect(env, 'google_error', 'invalid_handoff');
  }

  let verifierHash = '';
  if (handoffId) {
    try {
      const rows = await sbGet(env, 'line_login_handoffs',
        'id=eq.' + encodeURIComponent(handoffId) +
        '&status=eq.pending&select=id,verifier_hash,expires_at');
      const handoff = rows && rows[0];
      if (!handoff || new Date(handoff.expires_at).getTime() <= Date.now()) {
        return googleRedirect(env, 'google_error', 'invalid_handoff');
      }
      verifierHash = handoff.verifier_hash;
    } catch {
      return googleRedirect(env, 'google_error', 'handoff_not_ready');
    }
  }

  const nonce = lineRandom(24);
  const state = await signToken({
    purpose: 'google_oauth_state',
    nonce,
    handoffId: handoffId || null,
    verifierHash: verifierHash || null,
    exp: Date.now() + 10 * 60 * 1000
  }, env.GOOGLE_STATE_SECRET || env.TOKEN_SECRET);

  const authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', googleCallbackUrl(request, env));
  authorize.searchParams.set('scope', 'openid profile email');
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('nonce', nonce);
  // Do not force account selection on every login; Google reuses the known account when possible.

  return new Response(null, {
    status: 302,
    headers: {
      'Location': authorize.toString(),
      'Set-Cookie': googleStateCookie(state, 600),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

async function handleGoogleDevice(request, env) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const url = new URL(request.url);
  const code = String(url.searchParams.get('code') || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) return googleRedirect(env, 'google_error', 'invalid_handoff');

  try {
    const rows = await sbGet(env, 'line_login_handoffs',
      'device_code=eq.' + encodeURIComponent(code) +
      '&status=eq.pending&select=id,expires_at');
    const handoff = rows && rows[0];
    if (!handoff || new Date(handoff.expires_at).getTime() <= Date.now()) {
      return googleRedirect(env, 'google_error', 'invalid_handoff');
    }
    const startUrl = new URL('/auth/google/start', request.url);
    startUrl.searchParams.set('handoff_id', handoff.id);
    return new Response(null, {
      status: 302,
      headers: { 'Location': startUrl.toString(), 'Cache-Control': 'no-store' }
    });
  } catch {
    return googleRedirect(env, 'google_error', 'handoff_not_ready');
  }
}

async function handleGoogleCallback(request, env) {
  const url = new URL(request.url);
  const clearCookie = googleStateCookie('', 0);

  if (url.searchParams.get('error')) {
    const returnedState = url.searchParams.get('state') || '';
    const state = await verifyToken(returnedState, env.GOOGLE_STATE_SECRET || env.TOKEN_SECRET || '');
    if (state && state.handoffId) {
      await sbPatch(env, 'line_login_handoffs',
        'id=eq.' + encodeURIComponent(state.handoffId), { status: 'cancelled' }).catch(() => {});
    }
    const response = state && state.handoffId
      ? googleRedirect(env, 'google_handoff', 'cancelled')
      : googleRedirect(env, 'google_error', 'cancelled');
    response.headers.set('Set-Cookie', clearCookie);
    return response;
  }

  try {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.TOKEN_SECRET) {
      throw new Error('not_configured');
    }

    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    const cookieState = readCookie(request, 'scs_google_state');
    if (!code || !returnedState) throw new Error('invalid_state');

    const state = await verifyToken(returnedState, env.GOOGLE_STATE_SECRET || env.TOKEN_SECRET);
    if (!state || state.purpose !== 'google_oauth_state' || !state.nonce) throw new Error('invalid_state');
    if (!state.handoffId && (!cookieState || returnedState !== cookieState)) throw new Error('invalid_state');

    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: googleCallbackUrl(request, env),
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET
    });
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString()
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData.id_token) throw new Error('token_exchange_failed');

    const verifyUrl = new URL('https://oauth2.googleapis.com/tokeninfo');
    verifyUrl.searchParams.set('id_token', tokenData.id_token);
    const verifyResponse = await fetch(verifyUrl.toString(), { headers: { 'Accept': 'application/json' } });
    const profile = await verifyResponse.json().catch(() => ({}));
    const validIssuer = profile.iss === 'https://accounts.google.com' || profile.iss === 'accounts.google.com';
    if (!verifyResponse.ok || !profile.sub || profile.aud !== env.GOOGLE_CLIENT_ID ||
        !validIssuer || profile.nonce !== state.nonce || Number(profile.exp || 0) * 1000 <= Date.now()) {
      throw new Error('id_token_invalid');
    }

    const googleUserId = String(profile.sub);
    const email = profile.email && (profile.email_verified === true || profile.email_verified === 'true')
      ? String(profile.email).trim().toLowerCase() : null;
    const displayName = googleSafeDisplayName(profile.name);
    let accounts;
    try {
      accounts = await sbGet(env, 'user_accounts',
        'google_user_id=eq.' + encodeURIComponent(googleUserId) +
        '&select=id,nickname,email,gender,auth_provider,google_picture_url,google_nickname_confirmed');
    } catch (error) {
      if (String(error.message || '').includes('google_user_id')) throw new Error('database_not_ready');
      throw error;
    }

    let account;
    if (accounts && accounts.length) {
      account = accounts[0];
      const updates = {
        google_display_name: displayName,
        google_picture_url: profile.picture || null,
        auth_provider: mergeAuthProvider(account.auth_provider, 'google')
      };
      if (!account.email && email) updates.email = email;
      await sbPatch(env, 'user_accounts', 'id=eq.' + encodeURIComponent(account.id), updates);
      account = { ...account, ...updates };
    } else {
      let emailAccounts = [];
      if (email) {
        emailAccounts = await sbGet(env, 'user_accounts',
          'email=ilike.' + encodeURIComponent(email) +
          '&select=id,nickname,email,gender,auth_provider,google_picture_url,google_nickname_confirmed&limit=1');
      }
      if (emailAccounts && emailAccounts.length) {
        account = emailAccounts[0];
        const updates = {
          google_user_id: googleUserId,
          google_display_name: displayName,
          google_picture_url: profile.picture || null,
          google_nickname_confirmed: true,
          auth_provider: mergeAuthProvider(account.auth_provider, 'google')
        };
        await sbPatch(env, 'user_accounts', 'id=eq.' + encodeURIComponent(account.id), updates);
        account = { ...account, ...updates };
      } else {
        const created = await sbPost(env, 'user_accounts', {
          user_id: 'google:' + googleUserId,
          nickname: displayName,
          email,
          gender: null,
          password_hash: null,
          recovery_word: null,
          auth_provider: 'google',
          google_user_id: googleUserId,
          google_display_name: displayName,
          google_picture_url: profile.picture || null,
          google_nickname_confirmed: false
        });
        account = created[0];
      }
    }

    const ticket = await signToken({
      purpose: 'google_login_ticket',
      accountId: account.id,
      exp: Date.now() + 2 * 60 * 1000
    }, env.TOKEN_SECRET);

    if (state.handoffId) {
      const rows = await sbGet(env, 'line_login_handoffs',
        'id=eq.' + encodeURIComponent(state.handoffId) +
        '&select=id,verifier_hash,status,expires_at');
      const handoff = rows && rows[0];
      if (!handoff || handoff.status !== 'pending' ||
          new Date(handoff.expires_at).getTime() <= Date.now() ||
          handoff.verifier_hash !== state.verifierHash) {
        throw new Error('invalid_handoff');
      }
      const completionProof = await signToken({
        purpose: 'google_handoff_completion',
        provider: 'google',
        handoffId: handoff.id,
        verifierHash: handoff.verifier_hash,
        accountId: account.id,
        exp: Date.now() + 10 * 60 * 1000
      }, env.TOKEN_SECRET);
      await sbPatch(env, 'line_login_handoffs',
        'id=eq.' + encodeURIComponent(handoff.id), {
          status: 'complete',
          account_id: String(account.id),
          completion_proof: completionProof,
          completed_at: new Date().toISOString()
        });
      const response = googleRedirect(env, 'google_handoff', 'complete');
      response.headers.set('Set-Cookie', clearCookie);
      return response;
    }

    const response = googleRedirect(env, 'google_auth', ticket);
    response.headers.set('Set-Cookie', clearCookie);
    return response;
  } catch (error) {
    const known = new Set([
      'not_configured', 'invalid_state', 'token_exchange_failed',
      'id_token_invalid', 'database_not_ready', 'invalid_handoff', 'handoff_not_ready'
    ]);
    const code = known.has(error.message) ? error.message : 'login_failed';
    const response = googleRedirect(env, 'google_error', code);
    response.headers.set('Set-Cookie', clearCookie);
    return response;
  }
}

async function handleGoogleComplete(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!env.TOKEN_SECRET) return json({ error: 'Google Login is not configured' }, 503);
  const body = await request.json().catch(() => ({}));
  const payload = await verifyToken(body.ticket || '', env.TOKEN_SECRET);
  if (!payload || payload.purpose !== 'google_login_ticket' || !payload.accountId) {
    return json({ error: 'Google login expired. Please try again.' }, 401);
  }
  const rows = await sbGet(env, 'user_accounts',
    'id=eq.' + encodeURIComponent(payload.accountId) +
    '&select=id,nickname,email,gender,auth_provider,google_picture_url,google_nickname_confirmed');
  if (!rows || !rows.length) return json({ error: 'Google account was not found.' }, 404);
  const account = rows[0];
  return json({
    needsProfile: account.google_nickname_confirmed === false,
    needsNickname: account.google_nickname_confirmed === false,
    user: {
      id: account.id,
      nickname: account.nickname,
      displayName: account.nickname,
      email: account.email || null,
      gender: account.gender || null,
      authProvider: account.auth_provider || 'google',
      picture: account.google_picture_url || null
    }
  });
}

async function handleGoogleNickname(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!env.TOKEN_SECRET) return json({ error: 'Google Login is not configured' }, 503);
  const body = await request.json().catch(() => ({}));
  const payload = await verifyToken(body.ticket || '', env.TOKEN_SECRET);
  if (!payload || payload.purpose !== 'google_login_ticket' || !payload.accountId) {
    return json({ error: 'Google login expired. Please try again.' }, 401);
  }
  const nickname = String(body.nickname || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
  if (!nickname) return json({ error: 'Please enter your player nickname.' }, 400);
  const gender = String(body.gender || '');
  if (!['Male', 'Female'].includes(gender)) {
    return json({ error: 'Please select your gender.' }, 400);
  }
  const rows = await sbPatch(env, 'user_accounts',
    'id=eq.' + encodeURIComponent(payload.accountId),
    { nickname, gender, google_nickname_confirmed: true }, 'return=representation');
  const account = rows && rows[0];
  if (!account) return json({ error: 'Google account was not found.' }, 404);
  return json({
    user: {
      id: account.id,
      nickname: account.nickname,
      displayName: account.nickname,
      email: account.email || null,
      gender: account.gender || gender,
      authProvider: account.auth_provider || 'google',
      picture: account.google_picture_url || null
    }
  });
}

async function handleNicknameUpdate(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || '');
  const sessionToken = String(body.sessionToken || '');
  const nickname = String(body.nickname || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 40);
  if (!userId || !sessionToken) return json({ error: 'Please sign in again.' }, 401);
  if (!nickname) return json({ error: 'Please enter your player nickname.' }, 400);

  const sessions = await sbGet(env, 'active_sessions',
    'user_account_id=eq.' + encodeURIComponent(userId) +
    '&token=eq.' + encodeURIComponent(sessionToken) +
    '&select=user_account_id');
  if (!sessions || !sessions.length) return json({ error: 'Your session has expired. Please sign in again.' }, 401);

  const rows = await sbPatch(env, 'user_accounts',
    'id=eq.' + encodeURIComponent(userId),
    { nickname, line_nickname_confirmed: true },
    'return=representation');
  const account = rows && rows[0];
  if (!account) return json({ error: 'Account was not found.' }, 404);

  return json({
    user: {
      id: account.id,
      nickname: account.nickname,
      displayName: account.nickname,
      email: account.email || null,
      authProvider: account.auth_provider || 'email',
      picture: account.line_picture_url || null
    }
  });
}
