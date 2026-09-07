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
  if (!res.ok) throw new Error('GET ' + table + ' failed: ' + res.status);
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

async function sbPatch(env, table, query, body) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/' + table + '?' + query, {
    method:  'PATCH',
    headers: { ...sbHeaders(env), 'Prefer': 'return=minimal' },
    body:    JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'PATCH ' + table + ' failed: ' + res.status);
  }
  return true;
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

async function handleSubVerify(request, env) {
  const { email, deviceId } = await request.json();
  if (!email || !deviceId) return json({ allowed: false, reason: 'missing_params' });

  const secret = env.TOKEN_SECRET || 'fallback-secret-change-me';

  const rows = await sbGet(
    env, 'user_plans',
    'email=eq.' + encodeURIComponent(email.toLowerCase().trim()) +
    '&select=plan,expires_at,device_id'
  ).catch(() => []);

  if (!rows || !rows.length) {
    const token = await signToken({
      email: email.toLowerCase().trim(), deviceId, plan: 'trial', allowed: true,
      exp:   Date.now() + 2 * 60 * 60 * 1000
    }, secret);
    return json({ allowed: true, plan: 'trial', token });
  }

  const rec = rows[0];
  if (rec.expires_at && new Date(rec.expires_at) < new Date()) return json({ allowed: false, reason: 'expired', plan: rec.plan });
  if (!rec.plan)                                                return json({ allowed: false, reason: 'no_plan' });
  if (rec.device_id && rec.device_id !== deviceId)             return json({ allowed: false, reason: 'wrong_device' });
  if (!rec.device_id) {
    await sbPatch(env, 'user_plans',
      'email=eq.' + encodeURIComponent(email.toLowerCase().trim()),
      { device_id: deviceId }
    ).catch(() => {});
  }

  const token = await signToken({
    email: email.toLowerCase().trim(), deviceId, plan: rec.plan, allowed: true,
    exp:   Date.now() + 2 * 60 * 60 * 1000
  }, secret);

  return json({ allowed: true, plan: rec.plan, expires_at: rec.expires_at, token });
}

// ─────────────────────────────────────────────────────────────
//  SUPABASE PROXY
// ─────────────────────────────────────────────────────────────

async function handleDb(request, env, path) {
  const body = await request.json().catch(() => ({}));
  const { table, query = '', data, onConflict, prefer } = body;
  if (!table) return json({ error: 'table required' }, 400);
  const action = path.split('/db/')[1];
  switch (action) {
    case 'get':    return json(await sbGet(env, table, query));
    case 'post': { const result = await sbPost(env, table, data, prefer || 'return=representation'); return json(result); }
    case 'patch':  await sbPatch(env, table, query, data); return json({ ok: true });
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
  const { email } = await request.json();
  if (!email) return json({ valid: false });
  const rows = await sbGet(env, 'user_plans', 'email=eq.' + encodeURIComponent(email) + '&select=plan,expires_at').catch(() => []);
  if (!rows || !rows.length) return json({ valid: false });
  const rec = rows[0];
  if (!rec.plan) return json({ valid: false });
  if (rec.expires_at && new Date(rec.expires_at) < new Date()) return json({ valid: false, expired: true });
  return json({ valid: true, plan: rec.plan, expires_at: rec.expires_at });
}

async function handleSubActivate(request, env) {
  const { key, email } = await request.json();
  if (!key) return json({ valid: false, error: 'Key required' });
  const k = key.trim().toUpperCase();
  const rows = await sbGet(env, 'licenses', 'key=eq.' + encodeURIComponent(k) + '&select=key,plan,expires_at').catch(() => []);
  if (!rows || !rows.length) return json({ valid: false, error: 'Invalid key — already used or does not exist' });
  const lic = rows[0];
  if (lic.expires_at && new Date(lic.expires_at) < new Date()) return json({ valid: false, error: 'This license key has expired' });
  if (email) {
    await sbPost(env, 'user_plans', {
      email: email.toLowerCase(), plan: lic.plan, expires_at: lic.expires_at || null, activated_at: new Date().toISOString()
    }, 'return=minimal').catch(() => {});
  }
  await sbDelete(env, 'licenses', 'key=eq.' + encodeURIComponent(k)).catch(() => {});
  return json({ valid: true, plan: lic.plan, expiry: lic.expires_at });
}

async function handleSubRestore(request, env) {
  const { email } = await request.json();
  if (!email) return json({ restored: false });
  const rows = await sbGet(env, 'user_plans', 'email=eq.' + encodeURIComponent(email) + '&select=plan,expires_at').catch(() => []);
  if (!rows || !rows.length) return json({ restored: false });
  const rec = rows[0];
  if (!rec.plan) return json({ restored: false });
  if (rec.expires_at && new Date(rec.expires_at) < new Date()) return json({ restored: false, expired: true });
  return json({ restored: true, plan: rec.plan, expires_at: rec.expires_at });
}

async function handleSubRegisterSession(request, env) {
  const { email, deviceId } = await request.json();
  if (!email || !deviceId) return json({ ok: false });
  await sbPatch(env, 'user_plans', 'email=eq.' + encodeURIComponent(email), { device_id: deviceId }).catch(() => {});
  return json({ ok: true });
}

async function handleSubValidateSession(request, env) {
  const { email, deviceId } = await request.json();
  if (!email || !deviceId) return json({ valid: true });
  const rows = await sbGet(env, 'user_plans', 'email=eq.' + encodeURIComponent(email) + '&select=device_id').catch(() => []);
  if (!rows || !rows.length) return json({ valid: true });
  const remote = rows[0].device_id;
  if (!remote) return json({ valid: true });
  return json({ valid: remote === deviceId });
}

async function handlePurchaseRequest(request, env) {
  const { email, plan } = await request.json();
  if (!email || !plan) return json({ success: false, error: 'email and plan required' });
  await sbDelete(env, 'purchase_requests', 'email=eq.' + encodeURIComponent(email) + '&status=eq.pending').catch(() => {});
  try {
    await sbPost(env, 'purchase_requests', {
      email, plan, status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, 'return=minimal');
  } catch(e) {
    return json({ success: false, error: e.message });
  }
  return json({ success: true });
}

async function handlePurchaseStatus(request, env) {
  const { email } = await request.json();
  if (!email) return json({ found: false });
  const rows = await sbGet(env, 'purchase_requests',
    'email=eq.' + encodeURIComponent(email) + '&status=eq.pending&order=created_at.desc&limit=1&select=plan,status,created_at'
  ).catch(() => []);
  if (!rows || !rows.length) return json({ found: false });
  const req       = rows[0];
  const expiresAt = new Date(new Date(req.created_at).getTime() + 48 * 60 * 60 * 1000);
  const hrsLeft   = Math.max(0, Math.ceil((expiresAt - Date.now()) / 3600000));
  if (hrsLeft <= 0) return json({ found: false });
  return json({ found: true, plan: req.plan, hrsLeft, status: req.status });
}

async function handlePurchaseCancel(request, env) {
  const { email } = await request.json();
  if (!email) return json({ ok: false });
  await sbDelete(env, 'purchase_requests', 'email=eq.' + encodeURIComponent(email) + '&status=eq.pending').catch(() => {});
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
    'status=eq.pending&order=created_at.asc&select=id,email,plan,created_at'
  ).catch(() => []);
  return json({ requests: rows || [] });
}

async function handleAdminActivate(request, env) {
  const { email, plan, expiresAt, requestId } = await request.json();
  if (!email || !plan) return json({ success: false, error: 'email and plan required' });
  function genKey() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const seg   = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return [seg(), seg(), seg(), seg()].join('-');
  }
  const key = genKey();
  try {
    await sbUpsert(env, 'user_plans', {
      email: email.toLowerCase(), plan,
      expires_at: expiresAt || null, activated_at: new Date().toISOString()
    }, 'email');
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

// ─────────────────────────────────────────────────────────────
//  CLUB MANAGEMENT
// ─────────────────────────────────────────────────────────────

const MAX_CLUBS_PER_OWNER = 5;

async function handleClubCreate(request, env) {
  const { userAccountId, name, select_password, admin_password } = await request.json();
  if (!userAccountId)   return json({ error: 'userAccountId required' }, 400);
  if (!name?.trim())    return json({ error: 'Club name required' }, 400);
  if (!select_password) return json({ error: 'Member password required' }, 400);
  if (!admin_password)  return json({ error: 'Admin password required' }, 400);
  if (select_password === admin_password) return json({ error: 'Member and admin passwords must differ' }, 400);

  const existing = await sbGet(env, 'clubs', 'created_by=eq.' + userAccountId + '&select=id').catch(() => []);
  if (existing.length >= MAX_CLUBS_PER_OWNER) {
    return json({ error: 'You can only create up to ' + MAX_CLUBS_PER_OWNER + ' clubs.', limitReached: true }, 400);
  }

  const res = await fetch(env.SUPABASE_URL + '/rest/v1/clubs', {
    method:  'POST',
    headers: { ...sbHeaders(env), 'Prefer': 'return=representation' },
    body:    JSON.stringify({ name: name.trim(), select_password, admin_password, created_by: userAccountId })
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
  const { activeplayers, numCourts, fixedPairs, restQueue, courtFormats = [], courtTypes = [], allPlayers = [] } = state;
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

  // ── Unique Games Mode: override rest queue to maximise fresh games ─────────
  // If uniqueGamesMode is on and a unique game exists using full active pool,
  // swap in players needed for that fresh game regardless of rest queue.
  if (state.uniqueGamesMode && numResting > 0) {
    const fullPool = activeplayers;
    // Check if a unique game (fresh pair) exists outside current playing pool
    const playingSet = new Set(playing);
    let foundFreshInFull = false;

    outer:
    for (let i = 0; i < fullPool.length; i++) {
      for (let j = i + 1; j < fullPool.length; j++) {
        const a = fullPool[i], b = fullPool[j];
        if (!pairPlayedSet.has(pairKey(a, b))) {
          // Found a fresh pair — check if both are already playing
          if (!playingSet.has(a) || !playingSet.has(b)) {
            foundFreshInFull = true;
            break outer;
          }
        }
      }
    }

    if (foundFreshInFull) {
      // Find the freshest game possible from entire pool
      let bestGame = null, bestScore = -Infinity;
      for (let i = 0; i < fullPool.length - 3; i++) {
        for (let j = i + 1; j < fullPool.length - 2; j++) {
          for (let k = j + 1; k < fullPool.length - 1; k++) {
            for (let l = k + 1; l < fullPool.length; l++) {
              const four = [fullPool[i], fullPool[j], fullPool[k], fullPool[l]];
              // Try all 3 pairings
              const pairings = [
                [[four[0],four[1]],[four[2],four[3]]],
                [[four[0],four[2]],[four[1],four[3]]],
                [[four[0],four[3]],[four[1],four[2]]],
              ];
              for (const [p1, p2] of pairings) {
                const p1New = !pairPlayedSet.has(pairKey(p1[0], p1[1]));
                const p2New = !pairPlayedSet.has(pairKey(p2[0], p2[1]));
                const oppFresh = [p1[0],p1[1]].reduce((s,a) =>
                  s + [p2[0],p2[1]].filter(b => !((opponentMap[a]||{})[b])).length, 0);
                // Only consider if better than current playing pool can offer
                const allPlaying = four.every(p => playingSet.has(p));
                if (allPlaying) continue; // no point — same as current
                const score = (p1New ? 10000 : 0) + (p2New ? 10000 : 0) + oppFresh * 100;
                if (score > bestScore) { bestScore = score; bestGame = { p1, p2, four }; }
              }
            }
          }
        }
      }

      if (bestGame && bestScore > 0) {
        // Swap in the needed players from resting
        const neededFromRest = bestGame.four.filter(p => !playingSet.has(p));
        const toSwapOut = [...playing]
          .filter(p => !bestGame.four.includes(p))
          .slice(0, neededFromRest.length);

        for (let i = 0; i < neededFromRest.length; i++) {
          const pullIn  = neededFromRest[i];
          const pushOut = toSwapOut[i];
          if (!pullIn || !pushOut) continue;
          resting = resting.filter(p => p !== pullIn);
          resting.push(pushOut);
          playing = playing.filter(p => p !== pushOut);
          playing.push(pullIn);
        }
      }
    }
  }

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
  const { numCourts, fixedPairs = [], gamesMap } = state;
  if (games.length !== numCourts) fails.push(`Court count: got ${games.length}, expected ${numCourts}`);
  const seen = new Set();
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    if (!g.pair1 || g.pair1.length !== 2) fails.push(`Court ${i+1}: pair1 invalid`);
    if (!g.pair2 || g.pair2.length !== 2) fails.push(`Court ${i+1}: pair2 invalid`);
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
function bestSinglesMatch(pool, opponentMap, allRounds) {
  // Build singles play count from allRounds (how many singles games each player played)
  const singlesCount = {};
  for (const rnd of (allRounds || [])) {
    if (!rnd?.games) continue;
    for (const g of rnd.games) {
      if (g.pair1?.length === 1 && g.pair2?.length === 1) {
        singlesCount[g.pair1[0]] = (singlesCount[g.pair1[0]] || 0) + 1;
        singlesCount[g.pair2[0]] = (singlesCount[g.pair2[0]] || 0) + 1;
      }
    }
  }

  let best = null;
  for (let i = 0; i < pool.length - 1; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i], b = pool[j];
      const oppCount  = ((opponentMap[a] || {})[b] || 0) + ((opponentMap[b] || {})[a] || 0);
      const aCount    = singlesCount[a] || 0;
      const bCount    = singlesCount[b] || 0;
      const fresh     = (aCount === 0 ? 1 : 0) + (bCount === 0 ? 1 : 0);
      // Both new = top tier only. One new does NOT beat two lightly-played players.
      const score = (fresh === 2 ? 200000 : 0)
                  - (aCount + bCount) * 1000
                  - oppCount * 100
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
    const pairs = findDisjointPairs(pool, pairPlayedSet, needed, opponentMap) || [];
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
    const scores = getMatchupScores([p1, p2], opponentMap);
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
        const sm = bestSinglesMatch(pool, opponentMap, allRounds);
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
      const xdPairs   = buildXDPairs(menPool, womenPool, pairPlayedSet, 2, opponentMap);
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
          const sm = bestSinglesMatch(pool, opponentMap, allRounds);
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
          const sm = bestSinglesMatch(pool, opponentMap, allRounds);
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
    return games.reduce((s, g) => s + gameScore(g.pair1, g.pair2), 0);
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


async function handleGenerateRound(request, env) {
  const req           = await request.json();
  const restCount     = Object.fromEntries(req.restCount || []);
  const opponentMap   = Object.fromEntries((req.opponentMap || []).map(([p, inner]) => [p, Object.fromEntries(inner)]));
  const pairPlayedSet = new Set(req.pairPlayedSet || []);
  const gamesMap      = new Set(req.gamesMap || []);
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
    restQueue:              req.restQueue || [],
    restCount,
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
  const hasDoubleTypedCourts = (state.courtTypes || []).some(t => t && t !== 'free');
  const hasSinglesCourts     = (state.courtFormats || []).some(f => f === 'singles');
  const hasTypedCourts       = hasDoubleTypedCourts || hasSinglesCourts;

  const useComp = state.playMode === 'competitive';
  if (useComp && state.lastMode !== 'competitive') resetForCompetitive(state);
  let result = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let roundFn;
    if (hasDoubleTypedCourts) roundFn = typedBestRound;      // MD/LD/XD → new typed best round
    else if (hasSinglesCourts) roundFn = typedRound;          // singles only → existing typedRound
    else if (useComp) roundFn = competitiveRound;             // competitive → existing
    else roundFn = randomRound;                               // free doubles → existing
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
  });
}