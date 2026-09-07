var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
var worker_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }));
    }
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path.startsWith("/db/")) return cors(await handleDb(request, env, path));
      if (path === "/auth/send-otp") return cors(await handleSendOtp(request, env));
      if (path === "/auth/verify-otp") return cors(await handleVerifyOtp(request, env));
      if (path === "/auth/supabase-otp") return cors(await handleSupabaseOtp(request, env));
      if (path === "/auth/supabase-verify") return cors(await handleSupabaseVerify(request, env));
      if (path === "/auth/line/start") return cors(await handleLineStart(request, env));
      if (path === "/auth/line/callback") return cors(await handleLineCallback(request, env));
      if (path === "/auth/line/complete") return cors(await handleLineComplete(request, env));
      if (path === "/auth/line/nickname") return cors(await handleLineNickname(request, env));
      if (path === "/auth/nickname") return cors(await handleNicknameUpdate(request, env));
      if (path === "/auth/line/handoff/create") return cors(await handleLineHandoffCreate(request, env));
      if (path === "/auth/line/handoff/status") return cors(await handleLineHandoffStatus(request, env));
      if (path === "/auth/line/device") return cors(await handleLineDevice(request, env));
      if (path === "/auth/google/start") return cors(await handleGoogleStart(request, env));
      if (path === "/auth/google/callback") return cors(await handleGoogleCallback(request, env));
      if (path === "/auth/google/complete") return cors(await handleGoogleComplete(request, env));
      if (path === "/auth/google/nickname") return cors(await handleGoogleNickname(request, env));
      if (path === "/auth/google/handoff/create") return cors(await handleLineHandoffCreate(request, env));
      if (path === "/auth/google/handoff/status") return cors(await handleLineHandoffStatus(request, env));
      if (path === "/auth/google/device") return cors(await handleGoogleDevice(request, env));
      if (path === "/sub/verify") return cors(await handleSubVerify(request, env));
      if (path === "/sub/check") return cors(await handleSubCheck(request, env));
      if (path === "/sub/activate") return cors(await handleSubActivate(request, env));
      if (path === "/sub/restore") return cors(await handleSubRestore(request, env));
      if (path === "/sub/register-session") return cors(await handleSubRegisterSession(request, env));
      if (path === "/sub/validate-session") return cors(await handleSubValidateSession(request, env));
      if (path === "/sub/purchase-request") return cors(await handlePurchaseRequest(request, env));
      if (path === "/sub/purchase-status") return cors(await handlePurchaseStatus(request, env));
      if (path === "/sub/purchase-cancel") return cors(await handlePurchaseCancel(request, env));
      if (path === "/sub/app-config") return cors(await handleAppConfig(request, env));
      if (path === "/sub/admin-requests") return cors(await handleAdminRequests(request, env));
      if (path === "/sub/admin-activate") return cors(await handleAdminActivate(request, env));
      if (path === "/sub/purchase-cancel-by-id") return cors(await handlePurchaseCancelById(request, env));
      if (path === "/sub/register-trial") return cors(await handleRegisterTrial(request, env));
      if (path === "/sub/admin-clubs") return cors(await handleAdminClubs(request, env));
      if (path === "/sub/admin-subscribers") return cors(await handleAdminSubscribers(request, env));
      if (path === "/generate-round") return cors(await handleGenerateRound(request, env));
      if (path === "/offline-library/manifest") return cors(await handleOfflineLibraryManifest(request, env));
      if (path === "/offline-library/all") return cors(await handleOfflineLibraryAll(request, env));
      if (path === "/offline-library/get") return cors(await handleOfflineLibraryGet(request, env));
      if (path === "/offline-library/put") return cors(await handleOfflineLibraryPut(request, env));
      if (path === "/offline-library/delete") return cors(await handleOfflineLibraryDelete(request, env));
      if (path === "/club/create") return cors(await handleClubCreate(request, env));
      if (path === "/club/my-clubs") return cors(await handleClubMyClubs(request, env));
      if (path === "/club/organizers") return cors(await handleClubOrganizers(request, env));
      if (path === "/club/grant-organizer") return cors(await handleClubGrantOrganizer(request, env));
      if (path === "/club/revoke-organizer") return cors(await handleClubRevokeOrganizer(request, env));
      if (path === "/club/search-members") return cors(await handleClubSearchMembers(request, env));
      if (path === "/health") return cors(json({ status: "ok" }));
      return cors(json({ error: "Not found" }, 404));
    } catch (e) {
      console.error("Worker error:", e);
      return cors(json({ error: e.message }, 500));
    }
  }
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
__name(json, "json");
__name2(json, "json");
function cors(response) {
  const r = new Response(response.body, response);
  r.headers.set("Access-Control-Allow-Origin", "*");
  r.headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  r.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return r;
}
__name(cors, "cors");
__name2(cors, "cors");
function sbHeaders(env) {
  return {
    "apikey": env.SUPABASE_KEY,
    "Authorization": "Bearer " + env.SUPABASE_KEY,
    "Content-Type": "application/json",
    "Prefer": "return=representation"
  };
}
__name(sbHeaders, "sbHeaders");
__name2(sbHeaders, "sbHeaders");
async function sbGet(env, table, query = "") {
  const url = env.SUPABASE_URL + "/rest/v1/" + table + (query ? "?" + query : "");
  const res = await fetch(url, { headers: sbHeaders(env) });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error("GET " + table + " failed: " + res.status + (errText ? " " + errText : ""));
  }
  return res.json();
}
__name(sbGet, "sbGet");
__name2(sbGet, "sbGet");
async function sbPost(env, table, body, prefer = "return=representation") {
  const res = await fetch(env.SUPABASE_URL + "/rest/v1/" + table, {
    method: "POST",
    headers: { ...sbHeaders(env), "Prefer": prefer },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "POST " + table + " failed: " + res.status);
  }
  return prefer.includes("return=representation") ? res.json() : res.text();
}
__name(sbPost, "sbPost");
__name2(sbPost, "sbPost");
async function sbPatch(env, table, query, body, prefer = "return=minimal") {
  const res = await fetch(env.SUPABASE_URL + "/rest/v1/" + table + "?" + query, {
    method: "PATCH",
    headers: { ...sbHeaders(env), "Prefer": prefer },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "PATCH " + table + " failed: " + res.status);
  }
  return prefer.includes("return=representation") ? res.json() : true;
}
__name(sbPatch, "sbPatch");
__name2(sbPatch, "sbPatch");
async function sbDelete(env, table, query) {
  const res = await fetch(env.SUPABASE_URL + "/rest/v1/" + table + "?" + query, {
    method: "DELETE",
    headers: { ...sbHeaders(env), "Prefer": "return=minimal" }
  });
  if (!res.ok) throw new Error("DELETE " + table + " failed: " + res.status);
  return true;
}
__name(sbDelete, "sbDelete");
__name2(sbDelete, "sbDelete");
async function sbUpsert(env, table, body, onConflict) {
  const url = env.SUPABASE_URL + "/rest/v1/" + table + "?on_conflict=" + encodeURIComponent(onConflict);
  const res = await fetch(url, {
    method: "POST",
    headers: { ...sbHeaders(env), "Prefer": "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "UPSERT " + table + " failed: " + res.status);
  }
  return true;
}
__name(sbUpsert, "sbUpsert");
__name2(sbUpsert, "sbUpsert");
var OFFLINE_LIBRARY_ENGINE = "round-engine-2026-08-28-v2";
function normalizeOfflineLibrarySpec(raw) {
  const spec = raw && typeof raw === "object" ? raw : {};
  const playerCount = Number(spec.playerCount);
  const courtCount = Number(spec.courtCount);
  const roundCount = Number(spec.roundCount);
  const gameType = String(spec.gameType || "").toLowerCase();
  const algorithm = String(spec.algorithm || "").toLowerCase();
  const fixedPairCount = Number(spec.fixedPairCount || 0);
  const menCount = Number(spec.menCount || 0);
  const womenCount = Number(spec.womenCount || 0);
  const topRatedCount = Number(spec.topRatedCount || 0);
  const bottomRatedCount = Number(spec.bottomRatedCount || 0);
  if (!Number.isInteger(playerCount) || playerCount < 4 || playerCount > 100) {
    throw new Error("Offline library playerCount must be between 4 and 100.");
  }
  if (!Number.isInteger(courtCount) || courtCount < 1 || courtCount > 20 || playerCount < courtCount * 4) {
    throw new Error("Offline library courtCount must be between 1 and 20 and have four players per court.");
  }
  if (gameType !== "doubles" && gameType !== "mixed") throw new Error("Offline library supports Doubles or Mixed Doubles only.");
  if (algorithm !== "standard" && algorithm !== "balanced") {
    throw new Error("Offline library algorithm must be standard or balanced.");
  }
  if (!Number.isInteger(roundCount) || roundCount < 1 || roundCount > 100) {
    throw new Error("Offline library roundCount must be between 1 and 100.");
  }
  if (!Number.isInteger(fixedPairCount) || fixedPairCount < 0 || fixedPairCount > 5 || fixedPairCount * 2 > playerCount) {
    throw new Error("Offline library fixedPairCount must be between 0 and 5 and fit within the player count.");
  }
  if (gameType === "mixed" && (!Number.isInteger(menCount) || !Number.isInteger(womenCount) || menCount + womenCount !== playerCount || menCount < courtCount * 2 || womenCount < courtCount * 2)) {
    throw new Error("Mixed library gender counts must equal the player count and supply two men and two women per court.");
  }
  if (gameType === "mixed" && fixedPairCount > Math.min(menCount, womenCount)) {
    throw new Error("Mixed fixed pairs cannot exceed the smaller gender group.");
  }
  if (algorithm === "balanced" && (!Number.isInteger(topRatedCount) || !Number.isInteger(bottomRatedCount) || topRatedCount < 0 || bottomRatedCount < 0 || topRatedCount + bottomRatedCount !== playerCount)) {
    throw new Error("Balanced library topRatedCount + bottomRatedCount must equal playerCount.");
  }
  return {
    engineVersion: OFFLINE_LIBRARY_ENGINE,
    playerCount,
    courtCount,
    roundCount,
    gameType,
    algorithm,
    randomOrder: spec.randomOrder !== false,
    uniquePairMode: spec.uniquePairMode !== false,
    fixedPairCount,
    menCount: gameType === "mixed" ? menCount : 0,
    womenCount: gameType === "mixed" ? womenCount : 0,
    topRatedCount: algorithm === "balanced" ? topRatedCount : 0,
    bottomRatedCount: algorithm === "balanced" ? bottomRatedCount : 0
  };
}
__name(normalizeOfflineLibrarySpec, "normalizeOfflineLibrarySpec");
__name2(normalizeOfflineLibrarySpec, "normalizeOfflineLibrarySpec");
function offlineLibrarySignature(spec) {
  const parts = [
    spec.engineVersion,
    spec.gameType,
    "c" + spec.courtCount,
    "p" + spec.playerCount
  ];
  if (spec.gameType === "mixed") parts.push("m" + spec.menCount + "f" + spec.womenCount);
  if (spec.algorithm === "balanced") parts.push("top" + spec.topRatedCount + "bottom" + spec.bottomRatedCount);
  parts.push(
    spec.algorithm,
    "random" + (spec.randomOrder ? "1" : "0"),
    "unique" + (spec.uniquePairMode ? "1" : "0")
  );
  if (spec.fixedPairCount > 0) parts.push("fixed" + spec.fixedPairCount);
  parts.push("r" + spec.roundCount);
  return parts.join("|");
}
__name(offlineLibrarySignature, "offlineLibrarySignature");
__name2(offlineLibrarySignature, "offlineLibrarySignature");
function parseOfflineLibrarySignature(signature) {
  const parts = String(signature || "").split("|");
  if (parts.length < 6 || parts[0] !== OFFLINE_LIBRARY_ENGINE) throw new Error("Unsupported offline library signature.");
  const spec = {
    engineVersion: parts[0],
    gameType: parts[1],
    courtCount: 0,
    playerCount: 0,
    roundCount: 0,
    algorithm: "standard",
    randomOrder: true,
    uniquePairMode: true,
    fixedPairCount: 0,
    menCount: 0,
    womenCount: 0,
    topRatedCount: 0,
    bottomRatedCount: 0
  };
  for (const part of parts.slice(2)) {
    let m;
    if (m = /^c(\d+)$/.exec(part)) spec.courtCount = Number(m[1]);
    else if (m = /^p(\d+)$/.exec(part)) spec.playerCount = Number(m[1]);
    else if (m = /^m(\d+)f(\d+)$/.exec(part)) {
      spec.menCount = Number(m[1]);
      spec.womenCount = Number(m[2]);
    } else if (m = /^top(\d+)bottom(\d+)$/.exec(part)) {
      spec.topRatedCount = Number(m[1]);
      spec.bottomRatedCount = Number(m[2]);
    } else if (part === "standard" || part === "balanced") spec.algorithm = part;
    else if (m = /^random([01])$/.exec(part)) spec.randomOrder = m[1] === "1";
    else if (m = /^unique([01])$/.exec(part)) spec.uniquePairMode = m[1] === "1";
    else if (m = /^fixed(\d+)$/.exec(part)) spec.fixedPairCount = Number(m[1]);
    else if (m = /^r(\d+)$/.exec(part)) spec.roundCount = Number(m[1]);
  }
  return normalizeOfflineLibrarySpec(spec);
}
__name(parseOfflineLibrarySignature, "parseOfflineLibrarySignature");
__name2(parseOfflineLibrarySignature, "parseOfflineLibrarySignature");
async function requireOfflineLibrarySession(body, env) {
  const accountId = String(body && (body.accountId || body.userAccountId) || "").trim();
  const sessionToken = String(body && body.sessionToken || "").trim();
  if (!accountId || !sessionToken) throw new Error("Offline library session is required.");
  const rows = await sbGet(env, "active_sessions", "user_account_id=eq." + encodeURIComponent(accountId) + "&token=eq." + encodeURIComponent(sessionToken) + "&select=user_account_id&limit=1").catch(() => []);
  if (!rows.length) throw new Error("Offline library session is invalid.");
  return accountId;
}
__name(requireOfflineLibrarySession, "requireOfflineLibrarySession");
__name2(requireOfflineLibrarySession, "requireOfflineLibrarySession");
async function offlineLibraryVersionToken(env) {
  const rows = await sbGet(env, "offline_round_libraries", "engine_version=eq." + encodeURIComponent(OFFLINE_LIBRARY_ENGINE) + "&select=signature,updated_at&order=signature.asc");
  const material = (rows || []).map((row) => String(row.signature || "") + "@" + String(row.updated_at || "")).join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  const hash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return { token: OFFLINE_LIBRARY_ENGINE + ":" + (rows || []).length + ":" + hash, count: (rows || []).length };
}
__name(offlineLibraryVersionToken, "offlineLibraryVersionToken");
__name2(offlineLibraryVersionToken, "offlineLibraryVersionToken");
async function handleOfflineLibraryManifest(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await request.json().catch(() => ({}));
  try {
    await requireOfflineLibrarySession(body, env);
  } catch (error) {
    return json({ error: error.message }, 401);
  }
  const version = await offlineLibraryVersionToken(env);
  return json({ engineVersion: OFFLINE_LIBRARY_ENGINE, versionToken: version.token, count: version.count });
}
__name(handleOfflineLibraryManifest, "handleOfflineLibraryManifest");
__name2(handleOfflineLibraryManifest, "handleOfflineLibraryManifest");
async function handleOfflineLibraryAll(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await request.json().catch(() => ({}));
  try {
    await requireOfflineLibrarySession(body, env);
  } catch (error) {
    return json({ error: error.message }, 401);
  }
  const version = await offlineLibraryVersionToken(env);
  if (String(body.versionToken || "") === version.token) {
    return json({ unchanged: true, engineVersion: OFFLINE_LIBRARY_ENGINE, versionToken: version.token, count: version.count, libraries: [] });
  }
  const rows = await sbGet(env, "offline_round_libraries", "engine_version=eq." + encodeURIComponent(OFFLINE_LIBRARY_ENGINE) + "&select=signature,payload,updated_at&order=signature.asc");
  const libraries = [];
  for (const row of rows || []) {
    const spec = parseOfflineLibrarySignature(row.signature);
    validateOfflineLibraryPayload(row.payload, spec);
    libraries.push({ signature: row.signature, spec, payload: row.payload, updatedAt: row.updated_at || null });
  }
  return json({ unchanged: false, engineVersion: OFFLINE_LIBRARY_ENGINE, versionToken: version.token, count: libraries.length, libraries });
}
__name(handleOfflineLibraryAll, "handleOfflineLibraryAll");
__name2(handleOfflineLibraryAll, "handleOfflineLibraryAll");
function validateOfflineLibraryPayload(payload, spec) {
  if (!payload || typeof payload !== "object") throw new Error("Offline library payload is required.");
  const records = Array.isArray(payload.records) ? payload.records : [];
  if (records.length !== spec.roundCount) throw new Error("Offline library record count does not match the signature.");
  const validName = /* @__PURE__ */ __name2((name) => {
    const match = /^Offline Player (\d{1,3})$/.exec(String(name || "").split("#")[0]);
    return !!match && Number(match[1]) <= spec.playerCount;
  }, "validName");
  const expectedFixedPairs = Array.from({ length: spec.fixedPairCount }, (_, index) => spec.gameType === "mixed" ? ["Offline Player " + (index + 1), "Offline Player " + (spec.menCount + index + 1)] : ["Offline Player " + (index * 2 + 1), "Offline Player " + (index * 2 + 2)]);
  if (spec.gameType === "mixed") {
    const catalog = Array.isArray(payload.dataset && payload.dataset.allPlayers) ? payload.dataset.allPlayers : [];
    const genders = new Map(catalog.map((player) => [String(player && player.name || "").split("#")[0], String(player && player.gender || "").toLowerCase()]));
    for (let index = 1; index <= spec.playerCount; index++) {
      const expected = index <= spec.menCount ? "male" : "female";
      if (genders.get("Offline Player " + index) !== expected) throw new Error("Mixed library gender template does not match its signature.");
    }
  }
  const storedFixedPairs = Array.isArray(payload.dataset && payload.dataset.fixedPairs) ? payload.dataset.fixedPairs.map((pair) => Array.isArray(pair) ? pair.map((name) => String(name || "").split("#")[0]) : []) : [];
  if (storedFixedPairs.length !== expectedFixedPairs.length || expectedFixedPairs.some((pair, index) => storedFixedPairs[index].length !== 2 || storedFixedPairs[index][0] !== pair[0] || storedFixedPairs[index][1] !== pair[1])) {
    throw new Error("Offline library fixed-pair template does not match its signature.");
  }
  records.forEach((record, index) => {
    if (Number(record.sequence) !== index + 1) throw new Error("Offline library sequence is invalid.");
    const round = record && record.round;
    if (!round || !Array.isArray(round.games) || round.games.length !== spec.courtCount) {
      throw new Error("Every offline library round must contain exactly " + spec.courtCount + " games.");
    }
    const names = [];
    round.games.forEach((game) => {
      if (!Array.isArray(game.pair1) || game.pair1.length !== 2 || !Array.isArray(game.pair2) || game.pair2.length !== 2) {
        throw new Error("Offline library games must be Doubles.");
      }
      names.push(...game.pair1, ...game.pair2);
    });
    (round.resting || []).forEach((name) => names.push(name));
    if (names.some((name) => !validName(name))) throw new Error("Offline library contains a non-template player name.");
    const baseNames = names.map((name) => String(name).split("#")[0]);
    if (baseNames.length !== spec.playerCount || new Set(baseNames).size !== spec.playerCount) {
      throw new Error("Offline library round does not contain the exact template player pool.");
    }
    expectedFixedPairs.forEach((pair) => {
      const together = round.games.some((game) => [game.pair1, game.pair2].some((team) => team.map((name) => String(name).split("#")[0]).includes(pair[0]) && team.map((name) => String(name).split("#")[0]).includes(pair[1])));
      const resting = pair.every((name) => (round.resting || []).map((value) => String(value).split("#")[0]).includes(name));
      if (!together && !resting) throw new Error("Offline library round separates a fixed pair.");
    });
  });
  return { records };
}
__name(validateOfflineLibraryPayload, "validateOfflineLibraryPayload");
__name2(validateOfflineLibraryPayload, "validateOfflineLibraryPayload");
async function handleOfflineLibraryGet(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await request.json();
  try {
    await requireOfflineLibrarySession(body, env);
  } catch (error) {
    return json({ error: error.message }, 401);
  }
  const spec = normalizeOfflineLibrarySpec(body && body.spec);
  const signature = offlineLibrarySignature(spec);
  const rows = await sbGet(
    env,
    "offline_round_libraries",
    "signature=eq." + encodeURIComponent(signature) + "&select=signature,payload&limit=1"
  );
  if (!Array.isArray(rows) || !rows.length) return json({ found: false, signature, spec });
  validateOfflineLibraryPayload(rows[0].payload, spec);
  return json({ found: true, signature, spec, payload: rows[0].payload });
}
__name(handleOfflineLibraryGet, "handleOfflineLibraryGet");
__name2(handleOfflineLibraryGet, "handleOfflineLibraryGet");
async function handleOfflineLibraryPut(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await request.json();
  try {
    await requireOfflineLibrarySession(body, env);
  } catch (error) {
    return json({ error: error.message }, 401);
  }
  const spec = normalizeOfflineLibrarySpec(body && body.spec);
  const signature = offlineLibrarySignature(spec);
  const payload = body && body.payload;
  validateOfflineLibraryPayload(payload, spec);
  await sbUpsert(env, "offline_round_libraries", {
    signature,
    engine_version: spec.engineVersion,
    player_count: spec.playerCount,
    court_count: spec.courtCount,
    round_count: spec.roundCount,
    game_type: spec.gameType,
    algorithm: spec.algorithm,
    random_order: spec.randomOrder,
    unique_pair_mode: spec.uniquePairMode,
    top_rated_count: spec.topRatedCount,
    bottom_rated_count: spec.bottomRatedCount,
    payload,
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  }, "signature");
  return json({ stored: true, signature, spec });
}
__name(handleOfflineLibraryPut, "handleOfflineLibraryPut");
__name2(handleOfflineLibraryPut, "handleOfflineLibraryPut");
async function handleOfflineLibraryDelete(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await request.json();
  try {
    await requireOfflineLibrarySession(body, env);
  } catch (error) {
    return json({ error: error.message }, 401);
  }
  const spec = normalizeOfflineLibrarySpec(body && body.spec);
  const signature = offlineLibrarySignature(spec);
  await sbDelete(env, "offline_round_libraries", "signature=eq." + encodeURIComponent(signature));
  return json({ deleted: true, signature, spec });
}
__name(handleOfflineLibraryDelete, "handleOfflineLibraryDelete");
__name2(handleOfflineLibraryDelete, "handleOfflineLibraryDelete");
async function signToken(payload, secret) {
  const data = JSON.stringify(payload);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const sigHex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return btoa(data) + "." + sigHex;
}
__name(signToken, "signToken");
__name2(signToken, "signToken");
async function verifyToken(token, secret) {
  try {
    const [dataB64, sigHex] = token.split(".");
    if (!dataB64 || !sigHex) return null;
    const data = atob(dataB64);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const sigBytes = new Uint8Array(sigHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(data));
    if (!valid) return null;
    const payload = JSON.parse(data);
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
__name(verifyToken, "verifyToken");
__name2(verifyToken, "verifyToken");
var TRIAL_DAYS = 60;
function addTrialDays(date = /* @__PURE__ */ new Date()) {
  const d = new Date(date);
  d.setDate(d.getDate() + TRIAL_DAYS);
  return d.toISOString();
}
__name(addTrialDays, "addTrialDays");
__name2(addTrialDays, "addTrialDays");
function cleanSubEmail(email) {
  return email ? String(email).trim().toLowerCase() : null;
}
__name(cleanSubEmail, "cleanSubEmail");
__name2(cleanSubEmail, "cleanSubEmail");
async function resolveSubIdentity(body, env, requireSession = true) {
  const accountId = String(body.accountId || body.userAccountId || "").trim();
  let email = cleanSubEmail(body.email);
  let displayName = String(body.displayName || "").trim();
  let authProvider = String(body.authProvider || (email ? "email" : "line")).trim();
  if (accountId) {
    if (requireSession) {
      const sessionToken = String(body.sessionToken || "").trim();
      if (!sessionToken) return { error: "session_required" };
      const sessions = await sbGet(
        env,
        "active_sessions",
        "user_account_id=eq." + encodeURIComponent(accountId) + "&token=eq." + encodeURIComponent(sessionToken) + "&select=user_account_id&limit=1"
      ).catch(() => []);
      if (!sessions.length) return { error: "invalid_session" };
    }
    const accounts = await sbGet(
      env,
      "user_accounts",
      "id=eq." + encodeURIComponent(accountId) + "&select=id,email,nickname,auth_provider&limit=1"
    ).catch(() => []);
    if (!accounts.length) return { error: "account_not_found" };
    email = cleanSubEmail(accounts[0].email);
    displayName = String(accounts[0].nickname || displayName || "").trim();
    authProvider = String(accounts[0].auth_provider || authProvider || "email").trim();
  }
  if (!accountId && !email) return { error: "identity_required" };
  return { accountId, email, displayName, authProvider };
}
__name(resolveSubIdentity, "resolveSubIdentity");
__name2(resolveSubIdentity, "resolveSubIdentity");
function subIdentityFilter(identity) {
  return identity.accountId ? "account_id=eq." + encodeURIComponent(identity.accountId) : "email=eq." + encodeURIComponent(identity.email);
}
__name(subIdentityFilter, "subIdentityFilter");
__name2(subIdentityFilter, "subIdentityFilter");
async function findSubPlan(env, identity, select = "account_id,email,display_name,auth_provider,plan,expires_at,device_id,activated_at") {
  let rows = [];
  if (identity.accountId) {
    rows = await sbGet(
      env,
      "user_plans",
      "account_id=eq." + encodeURIComponent(identity.accountId) + "&select=" + select + "&limit=1"
    ).catch(() => []);
    if (rows.length) {
      const metadata = {
        email: identity.email || null,
        display_name: identity.displayName || rows[0].display_name || null,
        auth_provider: identity.authProvider || rows[0].auth_provider || (identity.email ? "email" : "line")
      };
      await sbPatch(
        env,
        "user_plans",
        "account_id=eq." + encodeURIComponent(identity.accountId),
        metadata
      ).catch(() => {
      });
      Object.assign(rows[0], metadata);
    }
  }
  if (!rows.length && identity.email) {
    rows = await sbGet(
      env,
      "user_plans",
      "email=eq." + encodeURIComponent(identity.email) + "&select=" + select + "&limit=1"
    ).catch(() => []);
    if (rows.length && identity.accountId) {
      await sbPatch(
        env,
        "user_plans",
        "email=eq." + encodeURIComponent(identity.email),
        {
          account_id: identity.accountId,
          display_name: identity.displayName || rows[0].display_name || null,
          auth_provider: identity.authProvider || rows[0].auth_provider || "email"
        }
      ).catch(() => {
      });
      rows[0].account_id = identity.accountId;
    }
  }
  return rows;
}
__name(findSubPlan, "findSubPlan");
__name2(findSubPlan, "findSubPlan");
async function saveSubPlan(env, identity, values) {
  const rows = await findSubPlan(env, identity);
  const identityValues = {
    account_id: identity.accountId || null,
    email: identity.email || null,
    display_name: identity.displayName || null,
    auth_provider: identity.authProvider || (identity.email ? "email" : "line")
  };
  if (rows.length) {
    await sbPatch(env, "user_plans", subIdentityFilter(identity), Object.assign(identityValues, values));
  } else {
    await sbPost(env, "user_plans", Object.assign(identityValues, values), "return=minimal");
  }
}
__name(saveSubPlan, "saveSubPlan");
__name2(saveSubPlan, "saveSubPlan");
async function handleSubVerify(request, env) {
  const body = await request.json();
  const deviceId = body.deviceId;
  const identity = await resolveSubIdentity(body, env);
  if (identity.error || !deviceId) return json({ allowed: false, reason: identity.error || "missing_params" });
  const secret = env.TOKEN_SECRET || "fallback-secret-change-me";
  const rows = await findSubPlan(env, identity);
  if (!rows || !rows.length) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const trialExpiresAt = addTrialDays(now);
    await saveSubPlan(env, identity, {
      plan: "trial",
      activated_at: now,
      expires_at: trialExpiresAt,
      device_id: deviceId
    }).catch(() => {
    });
    const token2 = await signToken({
      accountId: identity.accountId || null,
      email: identity.email,
      deviceId,
      plan: "trial",
      allowed: true,
      exp: Date.now() + 2 * 60 * 60 * 1e3
    }, secret);
    return json({ allowed: true, plan: "trial", expires_at: trialExpiresAt, token: token2 });
  }
  const rec = rows[0];
  if (rec.plan === "trial" && !rec.expires_at) {
    rec.expires_at = addTrialDays(rec.activated_at || /* @__PURE__ */ new Date());
    await sbPatch(
      env,
      "user_plans",
      subIdentityFilter(identity),
      { expires_at: rec.expires_at }
    ).catch(() => {
    });
  }
  if (rec.expires_at && new Date(rec.expires_at) < /* @__PURE__ */ new Date()) return json({ allowed: false, reason: "expired", plan: rec.plan });
  if (!rec.plan) return json({ allowed: false, reason: "no_plan" });
  if (rec.device_id && rec.device_id !== deviceId) return json({ allowed: false, reason: "wrong_device" });
  if (!rec.device_id) {
    await sbPatch(
      env,
      "user_plans",
      subIdentityFilter(identity),
      { device_id: deviceId }
    ).catch(() => {
    });
  }
  const token = await signToken({
    accountId: identity.accountId || null,
    email: identity.email,
    deviceId,
    plan: rec.plan,
    allowed: true,
    exp: Date.now() + 2 * 60 * 60 * 1e3
  }, secret);
  return json({ allowed: true, plan: rec.plan, expires_at: rec.expires_at, token });
}
__name(handleSubVerify, "handleSubVerify");
__name2(handleSubVerify, "handleSubVerify");
var DB_ACTIONS = ["get", "post", "patch", "delete", "upsert"];
var DB_TABLE_RULES = {
  active_sessions: ["get", "post", "delete", "upsert"],
  club_join_requests: ["get", "post", "patch", "delete"],
  club_invite_broadcasts: ["get", "post", "patch"],
  club_organizers: ["get", "delete", "upsert"],
  clubs: ["get", "post", "patch", "delete"],
  live_sessions: ["get"],
  matches: ["get", "post"],
  memberships: ["get", "post", "patch", "delete"],
  player_sessions: ["get", "post", "patch"],
  players: ["get", "post", "patch"],
  sessions: ["get", "post", "patch"],
  slot_claims: ["get", "post", "patch", "delete"],
  slots: ["get", "post", "patch", "delete"],
  venues: ["get", "post", "patch", "delete"],
  user_accounts: ["get", "post", "patch"],
  user_club_roles: ["get", "upsert"]
};
var DB_BLOCKED_TABLES = [
  "app_config",
  "line_login_handoffs",
  "licenses",
  "purchase_requests",
  "user_plans"
];
function isDbRequestAllowed(action, table) {
  if (!DB_ACTIONS.includes(action)) return false;
  if (!/^[a-z_][a-z0-9_]*$/i.test(table || "")) return false;
  if (DB_BLOCKED_TABLES.includes(table)) return false;
  const allowedActions = DB_TABLE_RULES[table];
  return Array.isArray(allowedActions) && allowedActions.includes(action);
}
__name(isDbRequestAllowed, "isDbRequestAllowed");
__name2(isDbRequestAllowed, "isDbRequestAllowed");
async function handleDb(request, env, path) {
  const body = await request.json().catch(() => ({}));
  const { table, query = "", data, onConflict, prefer } = body;
  if (!table) return json({ error: "table required" }, 400);
  const action = path.split("/db/")[1];
  if (!isDbRequestAllowed(action, table)) {
    return json({ error: "DB route not allowed for this table/action" }, 403);
  }
  switch (action) {
    case "get":
      return json(await sbGet(env, table, query));
    case "post": {
      const result = await sbPost(env, table, data, prefer || "return=representation");
      return json(result);
    }
    case "patch": {
      const result = await sbPatch(env, table, query, data, prefer || "return=minimal");
      return prefer && prefer.includes("return=representation") ? json(result) : json({ ok: true });
    }
    case "delete":
      await sbDelete(env, table, query);
      return json({ ok: true });
    case "upsert":
      await sbUpsert(env, table, data, onConflict);
      return json({ ok: true });
    default:
      return json({ error: "Unknown db action: " + action }, 400);
  }
}
__name(handleDb, "handleDb");
__name2(handleDb, "handleDb");
async function handleSendOtp(request, env) {
  const { email } = await request.json();
  if (!email) return json({ error: "email required" }, 400);
  const res = await fetch(env.EDGE_BASE + "/send-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + env.SUPABASE_KEY, "apikey": env.SUPABASE_KEY },
    body: JSON.stringify({ email: email.toLowerCase().trim() })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return json({ error: data.error || "Failed to send OTP" }, res.status);
  return json({ success: true });
}
__name(handleSendOtp, "handleSendOtp");
__name2(handleSendOtp, "handleSendOtp");
async function handleVerifyOtp(request, env) {
  const { email, otp } = await request.json();
  if (!email || !otp) return json({ error: "email and otp required" }, 400);
  const res = await fetch(env.EDGE_BASE + "/verify-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + env.SUPABASE_KEY, "apikey": env.SUPABASE_KEY },
    body: JSON.stringify({ email: email.toLowerCase().trim(), otp: otp.trim() })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return json({ error: data.error || "Invalid OTP" }, res.status);
  return json({ success: true });
}
__name(handleVerifyOtp, "handleVerifyOtp");
__name2(handleVerifyOtp, "handleVerifyOtp");
async function handleSupabaseOtp(request, env) {
  const { email } = await request.json();
  const res = await fetch(env.SUPABASE_URL + "/auth/v1/otp", {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": env.SUPABASE_KEY },
    body: JSON.stringify({ email: email.trim().toLowerCase(), create_user: true, options: { shouldCreateUser: true } })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return json({ error: err.msg || err.message || "Failed to send OTP" }, res.status);
  }
  return json({ success: true });
}
__name(handleSupabaseOtp, "handleSupabaseOtp");
__name2(handleSupabaseOtp, "handleSupabaseOtp");
async function handleSupabaseVerify(request, env) {
  const { email, token } = await request.json();
  const res = await fetch(env.SUPABASE_URL + "/auth/v1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": env.SUPABASE_KEY },
    body: JSON.stringify({ email: email.trim().toLowerCase(), token: token.trim(), type: "email" })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return json({ error: err.msg || err.message || "Invalid OTP" }, res.status);
  }
  return json({ success: true });
}
__name(handleSupabaseVerify, "handleSupabaseVerify");
__name2(handleSupabaseVerify, "handleSupabaseVerify");
async function handleSubCheck(request, env) {
  const identity = await resolveSubIdentity(await request.json(), env);
  if (identity.error) return json({ valid: false, reason: identity.error });
  const rows = await findSubPlan(env, identity);
  if (!rows || !rows.length) return json({ valid: false });
  const rec = rows[0];
  if (!rec.plan) return json({ valid: false });
  if (rec.expires_at && new Date(rec.expires_at) < /* @__PURE__ */ new Date()) return json({ valid: false, expired: true });
  return json({ valid: true, plan: rec.plan, expires_at: rec.expires_at });
}
__name(handleSubCheck, "handleSubCheck");
__name2(handleSubCheck, "handleSubCheck");
async function handleSubActivate(request, env) {
  const body = await request.json();
  const { key } = body;
  if (!key) return json({ valid: false, error: "Key required" });
  const k = key.trim().toUpperCase();
  const rows = await sbGet(env, "licenses", "key=eq." + encodeURIComponent(k) + "&select=key,plan,expires_at").catch(() => []);
  if (!rows || !rows.length) return json({ valid: false, error: "Invalid key \u2014 already used or does not exist" });
  const lic = rows[0];
  if (lic.expires_at && new Date(lic.expires_at) < /* @__PURE__ */ new Date()) return json({ valid: false, error: "This license key has expired" });
  const hasIdentity = !!(body.accountId || body.userAccountId || body.email);
  if (!hasIdentity) return json({ valid: true, plan: lic.plan, expiry: lic.expires_at, preview: true });
  const identity = await resolveSubIdentity(body, env);
  if (identity.error) return json({ valid: false, error: identity.error });
  await saveSubPlan(env, identity, {
    plan: lic.plan,
    expires_at: lic.expires_at || null,
    activated_at: (/* @__PURE__ */ new Date()).toISOString()
  });
  await sbDelete(env, "licenses", "key=eq." + encodeURIComponent(k)).catch(() => {
  });
  return json({ valid: true, plan: lic.plan, expiry: lic.expires_at });
}
__name(handleSubActivate, "handleSubActivate");
__name2(handleSubActivate, "handleSubActivate");
async function handleSubRestore(request, env) {
  const identity = await resolveSubIdentity(await request.json(), env);
  if (identity.error) return json({ restored: false, reason: identity.error });
  const rows = await findSubPlan(env, identity);
  if (!rows || !rows.length) return json({ restored: false });
  const rec = rows[0];
  if (!rec.plan) return json({ restored: false });
  if (rec.expires_at && new Date(rec.expires_at) < /* @__PURE__ */ new Date()) return json({ restored: false, expired: true });
  return json({ restored: true, plan: rec.plan, expires_at: rec.expires_at });
}
__name(handleSubRestore, "handleSubRestore");
__name2(handleSubRestore, "handleSubRestore");
async function handleSubRegisterSession(request, env) {
  const body = await request.json();
  const identity = await resolveSubIdentity(body, env);
  if (identity.error || !body.deviceId) return json({ ok: false, reason: identity.error || "device_required" });
  const rows = await findSubPlan(env, identity);
  if (rows.length) await sbPatch(env, "user_plans", subIdentityFilter(identity), { device_id: body.deviceId }).catch(() => {
  });
  return json({ ok: true });
}
__name(handleSubRegisterSession, "handleSubRegisterSession");
__name2(handleSubRegisterSession, "handleSubRegisterSession");
async function handleSubValidateSession(request, env) {
  const body = await request.json();
  const identity = await resolveSubIdentity(body, env);
  if (identity.error || !body.deviceId) return json({ valid: false, reason: identity.error || "device_required" });
  const rows = await findSubPlan(env, identity);
  if (!rows || !rows.length) return json({ valid: true });
  const remote = rows[0].device_id;
  if (!remote) return json({ valid: true });
  return json({ valid: remote === body.deviceId });
}
__name(handleSubValidateSession, "handleSubValidateSession");
__name2(handleSubValidateSession, "handleSubValidateSession");
async function handlePurchaseRequest(request, env) {
  const body = await request.json();
  const identity = await resolveSubIdentity(body, env);
  const plan = body.plan;
  if (identity.error || !plan) return json({ success: false, error: identity.error || "plan required" });
  await sbDelete(env, "purchase_requests", subIdentityFilter(identity) + "&status=eq.pending").catch(() => {
  });
  try {
    await sbPost(env, "purchase_requests", {
      account_id: identity.accountId || null,
      email: identity.email || null,
      display_name: identity.displayName || null,
      auth_provider: identity.authProvider || (identity.email ? "email" : "line"),
      plan,
      status: "pending",
      created_at: (/* @__PURE__ */ new Date()).toISOString(),
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }, "return=minimal");
  } catch (e) {
    return json({ success: false, error: e.message });
  }
  return json({ success: true });
}
__name(handlePurchaseRequest, "handlePurchaseRequest");
__name2(handlePurchaseRequest, "handlePurchaseRequest");
async function handlePurchaseStatus(request, env) {
  const identity = await resolveSubIdentity(await request.json(), env);
  if (identity.error) return json({ found: false, reason: identity.error });
  const rows = await sbGet(
    env,
    "purchase_requests",
    subIdentityFilter(identity) + "&status=eq.pending&order=created_at.desc&limit=1&select=plan,status,created_at"
  ).catch(() => []);
  if (!rows || !rows.length) return json({ found: false });
  const req = rows[0];
  const expiresAt = new Date(new Date(req.created_at).getTime() + 48 * 60 * 60 * 1e3);
  const hrsLeft = Math.max(0, Math.ceil((expiresAt - Date.now()) / 36e5));
  if (hrsLeft <= 0) return json({ found: false });
  return json({ found: true, plan: req.plan, hrsLeft, status: req.status });
}
__name(handlePurchaseStatus, "handlePurchaseStatus");
__name2(handlePurchaseStatus, "handlePurchaseStatus");
async function handlePurchaseCancel(request, env) {
  const identity = await resolveSubIdentity(await request.json(), env);
  if (identity.error) return json({ ok: false, reason: identity.error });
  await sbDelete(env, "purchase_requests", subIdentityFilter(identity) + "&status=eq.pending").catch(() => {
  });
  return json({ ok: true });
}
__name(handlePurchaseCancel, "handlePurchaseCancel");
__name2(handlePurchaseCancel, "handlePurchaseCancel");
async function handleAppConfig(request, env) {
  const rows = await sbGet(env, "app_config", "select=key,value").catch(() => []);
  const cfg = {};
  (rows || []).forEach((r) => {
    cfg[r.key] = r.value;
  });
  return json(cfg);
}
__name(handleAppConfig, "handleAppConfig");
__name2(handleAppConfig, "handleAppConfig");
async function handleAdminRequests(request, env) {
  const rows = await sbGet(
    env,
    "purchase_requests",
    "status=eq.pending&order=created_at.asc&select=id,account_id,email,display_name,auth_provider,plan,created_at"
  ).catch(() => []);
  const requests = (rows || []).map((row) => ({
    ...row,
    real_email: row.email || null,
    subscriber_name: row.display_name || row.email || "LINE player",
    display_identity: row.email || (row.display_name || "LINE player") + " (LINE)",
    // Backward compatibility for the existing email-only License Manager UI.
    email: row.email || (row.display_name || "LINE player") + " (LINE)"
  }));
  return json({ requests });
}
__name(handleAdminRequests, "handleAdminRequests");
__name2(handleAdminRequests, "handleAdminRequests");
async function handleAdminActivate(request, env) {
  const body = await request.json();
  let { email, plan, expiresAt, requestId } = body;
  let identity = {
    accountId: String(body.accountId || body.userAccountId || "").trim(),
    email: cleanSubEmail(email),
    displayName: String(body.displayName || "").trim(),
    authProvider: String(body.authProvider || (email ? "email" : "line")).trim()
  };
  if (requestId && (!identity.accountId || !identity.displayName)) {
    const requests = await sbGet(
      env,
      "purchase_requests",
      "id=eq." + encodeURIComponent(requestId) + "&select=account_id,email,display_name,auth_provider,plan&limit=1"
    ).catch(() => []);
    if (requests.length) {
      identity.accountId = String(requests[0].account_id || identity.accountId || "").trim();
      identity.email = cleanSubEmail(requests[0].email);
      identity.displayName = String(requests[0].display_name || identity.displayName || "").trim();
      identity.authProvider = String(requests[0].auth_provider || identity.authProvider || "email").trim();
      plan = plan || requests[0].plan;
    }
  }
  if (!identity.accountId && !identity.email || !plan) return json({ success: false, error: "account and plan required" });
  function genKey() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const seg = /* @__PURE__ */ __name2(() => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join(""), "seg");
    return [seg(), seg(), seg(), seg()].join("-");
  }
  __name(genKey, "genKey");
  __name2(genKey, "genKey");
  const key = genKey();
  try {
    await saveSubPlan(env, identity, {
      plan,
      expires_at: expiresAt || null,
      activated_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    await sbPost(env, "licenses", { key, plan, expires_at: expiresAt || null }, "return=minimal").catch(() => {
    });
    if (requestId) {
      await sbPatch(env, "purchase_requests", "id=eq." + requestId, {
        status: "accepted",
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }).catch(() => {
      });
    }
    return json({ success: true, key, expiresAt: expiresAt || null });
  } catch (e) {
    return json({ success: false, error: e.message });
  }
}
__name(handleAdminActivate, "handleAdminActivate");
__name2(handleAdminActivate, "handleAdminActivate");
async function handlePurchaseCancelById(request, env) {
  const { requestId } = await request.json();
  if (!requestId) return json({ ok: false });
  await sbPatch(env, "purchase_requests", "id=eq." + requestId, { status: "dismissed" }).catch(() => {
  });
  return json({ ok: true });
}
__name(handlePurchaseCancelById, "handlePurchaseCancelById");
__name2(handlePurchaseCancelById, "handlePurchaseCancelById");
async function handleRegisterTrial(request, env) {
  const identity = await resolveSubIdentity(await request.json(), env);
  if (identity.error) return json({ ok: false, reason: identity.error });
  const existing = await findSubPlan(env, identity);
  if (existing.length) {
    const rec = existing[0];
    if (rec.plan === "trial" && !rec.expires_at) {
      const expiresAt = addTrialDays(rec.activated_at || /* @__PURE__ */ new Date());
      await sbPatch(
        env,
        "user_plans",
        subIdentityFilter(identity),
        { expires_at: expiresAt }
      ).catch(() => {
      });
      return json({ ok: true, backfilled: true, expires_at: expiresAt });
    }
    return json({ ok: true, skipped: true });
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await saveSubPlan(env, identity, {
    plan: "trial",
    activated_at: now,
    expires_at: addTrialDays(now)
  }).catch(() => {
  });
  return json({ ok: true });
}
__name(handleRegisterTrial, "handleRegisterTrial");
__name2(handleRegisterTrial, "handleRegisterTrial");
async function handleAdminClubs(request, env) {
  const clubs = await sbGet(env, "clubs", "select=id,name,created_at,created_by&order=created_at.asc").catch(() => []);
  if (!clubs.length) return json({ clubs: [] });
  const ownerIds = [...new Set(clubs.map((c) => c.created_by).filter(Boolean))];
  let accountMap = {};
  if (ownerIds.length) {
    const accounts = await sbGet(
      env,
      "user_accounts",
      "id=in.(" + ownerIds.join(",") + ")&select=id,email,nickname"
    ).catch(() => []);
    for (const a of accounts) accountMap[a.id] = a;
  }
  const result = clubs.map((c) => ({
    id: c.id,
    name: c.name,
    created_at: c.created_at,
    owner_email: accountMap[c.created_by]?.email || "\u2014",
    owner_nickname: accountMap[c.created_by]?.nickname || "\u2014"
  }));
  return json({ clubs: result });
}
__name(handleAdminClubs, "handleAdminClubs");
__name2(handleAdminClubs, "handleAdminClubs");
async function handleAdminSubscribers(request, env) {
  const rows = await sbGet(
    env,
    "user_plans",
    "select=account_id,email,display_name,auth_provider,plan,expires_at,activated_at&order=activated_at.desc"
  ).catch(() => []);
  const subscribers = (rows || []).map((row) => ({
    ...row,
    real_email: row.email || null,
    subscriber_name: row.display_name || row.email || "LINE player",
    display_identity: row.email || (row.display_name || "LINE player") + " (LINE)",
    // Backward compatibility for the existing email-only License Manager UI.
    email: row.email || (row.display_name || "LINE player") + " (LINE)"
  }));
  return json({ subscribers });
}
__name(handleAdminSubscribers, "handleAdminSubscribers");
__name2(handleAdminSubscribers, "handleAdminSubscribers");
var MAX_CLUBS_PER_OWNER = 5;
async function handleClubCreate(request, env) {
  const { userAccountId, name, select_password, admin_password } = await request.json();
  if (!userAccountId) return json({ error: "userAccountId required" }, 400);
  if (!name?.trim()) return json({ error: "Club name required" }, 400);
  if (!admin_password) return json({ error: "Admin password required" }, 400);
  const internalMemberKey = select_password || "membership-only-" + crypto.randomUUID();
  if (internalMemberKey === admin_password) return json({ error: "Admin password is invalid" }, 400);
  const existing = await sbGet(env, "clubs", "created_by=eq." + userAccountId + "&select=id").catch(() => []);
  if (existing.length >= MAX_CLUBS_PER_OWNER) {
    return json({ error: "You can only create up to " + MAX_CLUBS_PER_OWNER + " clubs.", limitReached: true }, 400);
  }
  const res = await fetch(env.SUPABASE_URL + "/rest/v1/clubs", {
    method: "POST",
    headers: { ...sbHeaders(env), "Prefer": "return=representation" },
    body: JSON.stringify({ name: name.trim(), select_password: internalMemberKey, admin_password, created_by: userAccountId })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return json({ error: err.message || "Failed to create club" }, 500);
  }
  const created = await res.json();
  return json({ club: created[0] });
}
__name(handleClubCreate, "handleClubCreate");
__name2(handleClubCreate, "handleClubCreate");
async function handleClubMyClubs(request, env) {
  const { userAccountId } = await request.json();
  if (!userAccountId) return json({ error: "userAccountId required" }, 400);
  const owned = await sbGet(
    env,
    "clubs",
    "created_by=eq." + userAccountId + "&select=id,name,created_at&order=created_at.asc"
  ).catch(() => []);
  const permissions = await sbGet(
    env,
    "club_organizers",
    "user_account_id=eq." + userAccountId + "&select=club_id"
  ).catch(() => []);
  let permitted = [];
  if (permissions.length) {
    const ownedIds = new Set(owned.map((c) => c.id));
    const toFetch = permissions.map((p) => p.club_id).filter((id) => !ownedIds.has(id));
    if (toFetch.length) {
      permitted = await sbGet(
        env,
        "clubs",
        "id=in.(" + toFetch.join(",") + ")&select=id,name,created_at&order=name.asc"
      ).catch(() => []);
    }
  }
  return json({
    owned: owned.map((c) => ({ ...c, role: "owner" })),
    permitted: permitted.map((c) => ({ ...c, role: "organizer" })),
    total: owned.length + permitted.length
  });
}
__name(handleClubMyClubs, "handleClubMyClubs");
__name2(handleClubMyClubs, "handleClubMyClubs");
async function handleClubOrganizers(request, env) {
  const { clubId, userAccountId, adminPassword } = await request.json();
  if (!clubId) return json({ error: "clubId required" }, 400);
  const club = await sbGet(env, "clubs", "id=eq." + clubId + "&select=created_by,admin_password").catch(() => []);
  if (!club.length) return json({ error: "Club not found" }, 404);
  const isOwnerById = club[0].created_by && club[0].created_by === userAccountId;
  const isOwnerByPw = adminPassword && club[0].admin_password === adminPassword;
  if (!isOwnerById && !isOwnerByPw) {
    return json({ error: "Only the club owner can view organizers" }, 403);
  }
  const rows = await sbGet(env, "club_organizers", "club_id=eq." + clubId + "&select=user_account_id").catch(() => []);
  if (!rows.length) return json({ organizers: [] });
  const ids = rows.map((r) => r.user_account_id);
  const accounts = await sbGet(
    env,
    "user_accounts",
    "id=in.(" + ids.join(",") + ")&select=id,nickname,email"
  ).catch(() => []);
  return json({ organizers: accounts });
}
__name(handleClubOrganizers, "handleClubOrganizers");
__name2(handleClubOrganizers, "handleClubOrganizers");
async function handleClubGrantOrganizer(request, env) {
  const { clubId, userAccountId, targetUserAccountId, adminPassword } = await request.json();
  if (!clubId || !targetUserAccountId) return json({ error: "clubId and targetUserAccountId required" }, 400);
  const club = await sbGet(env, "clubs", "id=eq." + clubId + "&select=created_by,admin_password").catch(() => []);
  if (!club.length) return json({ error: "Club not found" }, 404);
  const isOwnerById = club[0].created_by && club[0].created_by === userAccountId;
  const isOwnerByPw = adminPassword && club[0].admin_password === adminPassword;
  if (!isOwnerById && !isOwnerByPw) {
    return json({ error: "Only the club owner can grant organizer access" }, 403);
  }
  const membership = await sbGet(
    env,
    "memberships",
    "club_id=eq." + clubId + "&user_account_id=eq." + targetUserAccountId + "&select=id"
  ).catch(() => []);
  if (!membership.length) return json({ error: "This person is not a member of your club" }, 400);
  await sbUpsert(
    env,
    "club_organizers",
    { club_id: clubId, user_account_id: targetUserAccountId },
    "club_id,user_account_id"
  ).catch(() => {
  });
  return json({ success: true });
}
__name(handleClubGrantOrganizer, "handleClubGrantOrganizer");
__name2(handleClubGrantOrganizer, "handleClubGrantOrganizer");
async function handleClubRevokeOrganizer(request, env) {
  const { clubId, userAccountId, targetUserAccountId, adminPassword } = await request.json();
  if (!clubId || !targetUserAccountId) return json({ error: "clubId and targetUserAccountId required" }, 400);
  const club = await sbGet(env, "clubs", "id=eq." + clubId + "&select=created_by,admin_password").catch(() => []);
  if (!club.length) return json({ error: "Club not found" }, 404);
  const isOwnerById = club[0].created_by && club[0].created_by === userAccountId;
  const isOwnerByPw = adminPassword && club[0].admin_password === adminPassword;
  if (!isOwnerById && !isOwnerByPw) {
    return json({ error: "Only the club owner can revoke organizer access" }, 403);
  }
  await sbDelete(
    env,
    "club_organizers",
    "club_id=eq." + clubId + "&user_account_id=eq." + targetUserAccountId
  ).catch(() => {
  });
  return json({ success: true });
}
__name(handleClubRevokeOrganizer, "handleClubRevokeOrganizer");
__name2(handleClubRevokeOrganizer, "handleClubRevokeOrganizer");
async function handleClubSearchMembers(request, env) {
  const { clubId, userAccountId, query = "", adminPassword } = await request.json();
  if (!clubId) return json({ error: "clubId required" }, 400);
  const club = await sbGet(env, "clubs", "id=eq." + clubId + "&select=created_by,admin_password").catch(() => []);
  if (!club.length) return json({ error: "Club not found" }, 404);
  const isOwnerById = club[0].created_by && club[0].created_by === userAccountId;
  const isOwnerByPw = adminPassword && club[0].admin_password === adminPassword;
  if (!isOwnerById && !isOwnerByPw) {
    return json({ error: "Only the club owner can search members" }, 403);
  }
  const memberships = await sbGet(
    env,
    "memberships",
    "club_id=eq." + clubId + "&select=user_account_id,nickname"
  ).catch(() => []);
  const granted = await sbGet(env, "club_organizers", "club_id=eq." + clubId + "&select=user_account_id").catch(() => []);
  const grantedSet = new Set(granted.map((g) => g.user_account_id));
  const ownerId = club[0].created_by || null;
  const eligible = memberships.filter(
    (m) => m.user_account_id && m.user_account_id !== ownerId && m.user_account_id !== userAccountId && !grantedSet.has(m.user_account_id)
  );
  if (!eligible.length) return json({ members: [] });
  const ids = eligible.map((m) => m.user_account_id);
  const accounts = await sbGet(
    env,
    "user_accounts",
    "id=in.(" + ids.join(",") + ")&select=id,nickname,email"
  ).catch(() => []);
  const q = query.trim().toLowerCase();
  const filtered = q ? accounts.filter((a) => a.nickname?.toLowerCase().includes(q) || a.email?.toLowerCase().includes(q)) : accounts;
  return json({ members: filtered });
}
__name(handleClubSearchMembers, "handleClubSearchMembers");
__name2(handleClubSearchMembers, "handleClubSearchMembers");
function pairKey(a, b) {
  return [a, b].sort().join("&");
}
__name(pairKey, "pairKey");
__name2(pairKey, "pairKey");
function gameKey(p1, p2) {
  return [[p1[0], p1[1]].sort().join("&"), [p2[0], p2[1]].sort().join("&")].sort().join(":");
}
__name(gameKey, "gameKey");
__name2(gameKey, "gameKey");
function shuffle(arr) {
  arr = [...arr];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
__name(shuffle, "shuffle");
__name2(shuffle, "shuffle");
function getRating(name, allPlayers) {
  const p = allPlayers.find((p2) => p2.name === name);
  if (!p) return 1;
  return parseFloat(p.clubRating || p.rating || 1);
}
__name(getRating, "getRating");
__name2(getRating, "getRating");
function getGender(name, allPlayers) {
  const p = allPlayers.find((p2) => p2.name === name);
  return p ? p.gender : null;
}
__name(getGender, "getGender");
__name2(getGender, "getGender");
function selectRestingAndPlaying(state) {
  const { activeplayers, numCourts, fixedPairs, restQueue, courtFormats = [], courtTypes = [], allPlayers = [], pairPlayedSet, opponentMap = {} } = state;
  const total = activeplayers.length;
  const playersPerRound = courtFormats.length ? courtFormats.reduce((sum, fmt) => sum + (fmt === "singles" ? 2 : 4), 0) : numCourts * 4;
  const numResting = Math.max(total - playersPerRound, 0);
  let resting = [], playing = [];
  let strictMenSeats = 0;
  let strictWomenSeats = 0;
  let fullyGenderConstrained = numCourts > 0;
  for (let c = 0; c < numCourts; c++) {
    const fmt = courtFormats[c] || "doubles";
    const type = String(courtTypes[c] || "free").toLowerCase();
    if (fmt === "singles") {
      if (type === "md" || type === "men" || type === "singles-men") strictMenSeats += 2;
      else if (type === "ld" || type === "wd" || type === "women" || type === "ladies" || type === "singles-women") strictWomenSeats += 2;
      else fullyGenderConstrained = false;
    } else {
      if (type === "md") strictMenSeats += 4;
      else if (type === "ld" || type === "wd") strictWomenSeats += 4;
      else if (type === "xd") {
        strictMenSeats += 2;
        strictWomenSeats += 2;
      } else fullyGenderConstrained = false;
    }
  }
  if (fullyGenderConstrained && !fixedPairs.length) {
    const genderOf = /* @__PURE__ */ __name2((player) => String(getGender(player, allPlayers) || "").toLowerCase(), "genderOf");
    const activeMen = activeplayers.filter((player) => genderOf(player) === "male");
    const activeWomen = activeplayers.filter((player) => genderOf(player) === "female");
    const ordered = [
      ...restQueue.filter((player) => activeplayers.includes(player)),
      ...activeplayers.filter((player) => !restQueue.includes(player))
    ];
    const menToRest = Math.max(0, activeMen.length - strictMenSeats);
    const womenToRest = Math.max(0, activeWomen.length - strictWomenSeats);
    resting = [
      ...ordered.filter((player) => genderOf(player) === "male").slice(0, menToRest),
      ...ordered.filter((player) => genderOf(player) === "female").slice(0, womenToRest)
    ];
    playing = activeplayers.filter((player) => !resting.includes(player));
    return { resting, playing };
  }
  if (fixedPairs.length && numResting >= 2) {
    let needed = numResting;
    const fmap = /* @__PURE__ */ new Map();
    for (const [a, b] of fixedPairs) {
      fmap.set(a, b);
      fmap.set(b, a);
    }
    for (const p of restQueue) {
      if (resting.includes(p)) continue;
      const partner = fmap.get(p);
      if (partner) {
        if (needed >= 2) {
          resting.push(p, partner);
          needed -= 2;
        }
      } else if (needed > 0) {
        resting.push(p);
        needed -= 1;
      }
      if (needed <= 0) break;
    }
    playing = activeplayers.filter((p) => !resting.includes(p));
  } else {
    resting = [...restQueue].slice(0, numResting);
    playing = activeplayers.filter((p) => !resting.includes(p)).slice(0, playersPerRound);
  }
  const hasTypedCourts = courtTypes.some(
    (t) => t === "MD" || t === "LD" || t === "WD" || t === "XD" || t === "men" || t === "ladies" || t === "singles-men" || t === "singles-women"
  );
  if (hasTypedCourts && numResting > 0) {
    let swapIn = /* @__PURE__ */ __name(function(needed, currentPlaying, restPool, surplusPlaying) {
      const shortfall = needed - currentPlaying.length;
      if (shortfall <= 0) return;
      const canSwap = Math.min(shortfall, restPool.length, surplusPlaying.length);
      for (let i = 0; i < canSwap; i++) {
        const pullIn = restPool[i];
        const pushOut = surplusPlaying[surplusPlaying.length - 1 - i];
        resting = resting.filter((p) => p !== pullIn);
        resting.push(pushOut);
        playing = playing.filter((p) => p !== pushOut);
        playing.push(pullIn);
      }
    }, "swapIn");
    __name2(swapIn, "swapIn");
    const genderOf = /* @__PURE__ */ __name2((p) => {
      const pl = allPlayers.find((x) => x.name === p);
      return pl ? pl.gender : "Male";
    }, "genderOf");
    let menNeeded = 0, womenNeeded = 0;
    for (let c = 0; c < numCourts; c++) {
      const fmt = courtFormats[c] || "doubles";
      const type = courtTypes[c] || "free";
      if (fmt === "singles") {
        if (type === "MD" || type === "men" || type === "singles-men") menNeeded += 2;
        if (type === "LD" || type === "WD" || type === "women" || type === "ladies" || type === "singles-women") womenNeeded += 2;
      } else {
        if (type === "MD") menNeeded += 4;
        if (type === "LD" || type === "WD") womenNeeded += 4;
        if (type === "XD") {
          menNeeded += 2;
          womenNeeded += 2;
        }
      }
    }
    const playingMen = playing.filter((p) => genderOf(p) === "Male");
    const playingWomen = playing.filter((p) => genderOf(p) === "Female");
    const restingMen = restQueue.filter((p) => resting.includes(p) && genderOf(p) === "Male");
    const restingWomen = restQueue.filter((p) => resting.includes(p) && genderOf(p) === "Female");
    if (menNeeded > playingMen.length) {
      swapIn(menNeeded, playingMen, restingMen, [...playingWomen]);
    }
    const updatedMen = playing.filter((p) => genderOf(p) === "Male");
    const updatedWomen = playing.filter((p) => genderOf(p) === "Female");
    if (womenNeeded > updatedWomen.length) {
      swapIn(womenNeeded, updatedWomen, restingWomen, [...updatedMen]);
    }
  }
  return { resting, playing };
}
__name(selectRestingAndPlaying, "selectRestingAndPlaying");
__name2(selectRestingAndPlaying, "selectRestingAndPlaying");
function reorderFreePlayersByLastRound(freePlayers, lastRound, numCourts) {
  if (!numCourts || !freePlayers.length) return [...freePlayers];
  const total = freePlayers.length;
  const base = Math.floor(total / numCourts);
  const rem = total % numCourts;
  const caps = Array.from({ length: numCourts }, (_, i) => base + (i < rem ? 1 : 0));
  const lrSet = new Set(lastRound);
  const nonPlayed = freePlayers.filter((p) => !lrSet.has(p));
  const played = freePlayers.filter((p) => lrSet.has(p));
  const courts = Array.from({ length: numCourts }, () => []);
  let c = 0;
  const distribute = /* @__PURE__ */ __name2((list) => {
    for (const p of list) {
      while (courts[c].length >= caps[c]) c = (c + 1) % numCourts;
      courts[c].push(p);
      c = (c + 1) % numCourts;
    }
  }, "distribute");
  distribute(nonPlayed);
  distribute(played);
  return courts.flat();
}
__name(reorderFreePlayersByLastRound, "reorderFreePlayersByLastRound");
__name2(reorderFreePlayersByLastRound, "reorderFreePlayersByLastRound");
function getNextFixedPairGames(state, fixedPairs, numCourts) {
  const hash = JSON.stringify(fixedPairs);
  if (!state.fixedPairGameQueue || !state.fixedPairGameQueue.length || state.fixedPairGameQueueHash !== hash) {
    state.fixedPairGameQueueHash = hash;
    state.fixedPairGameQueue = fixedPairs.flatMap((p1, i) => fixedPairs.slice(i + 1).map((p2) => ({ pair1: p1, pair2: p2 })));
  }
  const games = [], used = /* @__PURE__ */ new Set(), remaining = [];
  for (const g of state.fixedPairGameQueue) {
    const k1 = g.pair1.join("&"), k2 = g.pair2.join("&");
    if (games.length >= numCourts || used.has(k1) || used.has(k2)) {
      remaining.push(g);
      continue;
    }
    games.push({ court: games.length + 1, pair1: [...g.pair1], pair2: [...g.pair2] });
    used.add(k1);
    used.add(k2);
  }
  state.fixedPairGameQueue = remaining;
  return games;
}
__name(getNextFixedPairGames, "getNextFixedPairGames");
__name2(getNextFixedPairGames, "getNextFixedPairGames");
function findDisjointPairs(playing, pairPlayedSet, required, opponentMap) {
  const allPairs = [], unused = [], used = [];
  for (let i = 0; i < playing.length; i++) {
    for (let j = i + 1; j < playing.length; j++) {
      const a = playing[i], b = playing[j];
      const key = pairKey(a, b);
      const isNew = !pairPlayedSet.has(key);
      const obj = { a, b, key, isNew };
      allPairs.push(obj);
      if (isNew) unused.push(obj);
      else used.push(obj);
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
  __name(oppScore, "oppScore");
  __name2(oppScore, "oppScore");
  function pickBest(candidates) {
    const usedP = /* @__PURE__ */ new Set(), sel = [];
    let best = null, branches = 0;
    const MAX = 15e3;
    function dfs(start, score) {
      if (branches++ > MAX) return;
      if (sel.length === required) {
        if (!best || score > best.score) best = { score, pairs: sel.map((p) => [...p]) };
        return;
      }
      if (candidates.length - start < required - sel.length) return;
      for (let i = start; i < candidates.length; i++) {
        const { a, b, isNew } = candidates[i];
        if (usedP.has(a) || usedP.has(b)) continue;
        usedP.add(a);
        usedP.add(b);
        sel.push([a, b]);
        dfs(i + 1, score + (isNew ? 100 : 0) + oppScore([a, b], sel.slice(0, -1)));
        sel.pop();
        usedP.delete(a);
        usedP.delete(b);
      }
    }
    __name(dfs, "dfs");
    __name2(dfs, "dfs");
    dfs(0, 0);
    return best ? best.pairs : null;
  }
  __name(pickBest, "pickBest");
  __name2(pickBest, "pickBest");
  if (unused.length >= required) {
    const r = pickBest(unused);
    if (r) return r;
  }
  const combined = [...unused, ...used];
  if (combined.length >= required) {
    const r = pickBest(combined);
    if (r) return r;
  }
  if (allPairs.length >= required) {
    const r = pickBest(allPairs);
    if (r) return r;
  }
  return [];
}
__name(findDisjointPairs, "findDisjointPairs");
__name2(findDisjointPairs, "findDisjointPairs");
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
      const fresh = [ab11, ab12, ab21, ab22].filter((v) => v === 0).length;
      const of_ = {
        a1: (ab11 === 0 ? 1 : 0) + (ab12 === 0 ? 1 : 0),
        a2: (ab21 === 0 ? 1 : 0) + (ab22 === 0 ? 1 : 0),
        b1: (ab11 === 0 ? 1 : 0) + (ab21 === 0 ? 1 : 0),
        b2: (ab12 === 0 ? 1 : 0) + (ab22 === 0 ? 1 : 0)
      };
      scores.push({ pair1: allPairs[i], pair2: allPairs[j], freshness: fresh, totalScore: total, of: of_ });
    }
  }
  scores.sort((a, b) => {
    if (b.freshness !== a.freshness) return b.freshness - a.freshness;
    if (a.totalScore !== b.totalScore) return a.totalScore - b.totalScore;
    const sa = a.of.a1 + a.of.a2 + a.of.b1 + a.of.b2, sb = b.of.a1 + b.of.a2 + b.of.b1 + b.of.b2;
    return sb - sa;
  });
  return scores;
}
__name(getMatchupScores, "getMatchupScores");
__name2(getMatchupScores, "getMatchupScores");
function buildGroupedUniqueGames(state, playing) {
  const { numCourts, pairPlayedSet, opponentMap = {}, allRounds = [] } = state;
  if (!numCourts || playing.length !== numCourts * 4) return null;
  const last = allRounds.length ? allRounds[allRounds.length - 1] : null;
  const lastPlaying = new Set(
    last?.games ? last.games.flatMap((g) => [...g.pair1 || [], ...g.pair2 || []]) : []
  );
  const returningRested = playing.filter((p) => last && !lastPlaying.has(p));
  const continuing = playing.filter((p) => !returningRested.includes(p));
  function arrangements(group) {
    const [a, b, c, d] = group;
    return [
      [[a, b], [c, d]],
      [[a, c], [b, d]],
      [[a, d], [b, c]]
    ];
  }
  __name(arrangements, "arrangements");
  __name2(arrangements, "arrangements");
  function scoreGame(pair1, pair2) {
    const partnerRepeats = (pairPlayedSet.has(pairKey(pair1[0], pair1[1])) ? 1 : 0) + (pairPlayedSet.has(pairKey(pair2[0], pair2[1])) ? 1 : 0);
    let opponentRepeats = 0;
    for (const a of pair1) for (const b of pair2) {
      opponentRepeats += Number((opponentMap[a] || {})[b] || 0);
    }
    return { partnerRepeats, opponentRepeats };
  }
  __name(scoreGame, "scoreGame");
  __name2(scoreGame, "scoreGame");
  let best = null;
  const attempts = Math.max(300, numCourts * 250);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const groups = Array.from({ length: numCourts }, () => []);
    const rr = shuffle(returningRested);
    const cc = shuffle(continuing);
    const courtOffset = attempt % numCourts;
    rr.forEach((p, i) => groups[(courtOffset + i) % numCourts].push(p));
    for (let c = 0; c < numCourts; c++) {
      while (groups[c].length < 4 && cc.length) groups[c].push(cc.pop());
    }
    if (groups.some((g) => g.length !== 4)) continue;
    const games = [];
    let partnerRepeats = 0;
    let opponentRepeats = 0;
    for (let c = 0; c < numCourts; c++) {
      let courtBest = null;
      for (const [pair1, pair2] of arrangements(groups[c])) {
        const sc = scoreGame(pair1, pair2);
        const key2 = [sc.partnerRepeats, sc.opponentRepeats, Math.random()];
        if (!courtBest || key2[0] < courtBest.key[0] || key2[0] === courtBest.key[0] && key2[1] < courtBest.key[1] || key2[0] === courtBest.key[0] && key2[1] === courtBest.key[1] && key2[2] < courtBest.key[2]) {
          courtBest = { key: key2, pair1, pair2, sc };
        }
      }
      partnerRepeats += courtBest.sc.partnerRepeats;
      opponentRepeats += courtBest.sc.opponentRepeats;
      games.push({ court: c + 1, pair1: [...courtBest.pair1], pair2: [...courtBest.pair2] });
    }
    const key = [partnerRepeats, opponentRepeats];
    if (!best || key[0] < best.key[0] || key[0] === best.key[0] && key[1] < best.key[1]) {
      best = { key, games };
      if (partnerRepeats === 0 && opponentRepeats === 0) break;
    }
  }
  return best?.games || null;
}
__name(buildGroupedUniqueGames, "buildGroupedUniqueGames");
__name2(buildGroupedUniqueGames, "buildGroupedUniqueGames");
function randomRound(state) {
  const { numCourts, fixedPairs, restCount, opponentMap, pairPlayedSet, lastRound = [] } = state;
  const { resting, playing } = selectRestingAndPlaying(state);
  const playingSet = new Set(playing);
  const fixedThisRound = fixedPairs.filter(([a, b]) => playingSet.has(a) && playingSet.has(b));
  const fixedPlayers = new Set(fixedThisRound.flat());
  let freePlayers = reorderFreePlayersByLastRound(
    playing.filter((p) => !fixedPlayers.has(p)),
    lastRound,
    numCourts
  );
  if (freePlayers.length <= 2 && fixedPairs.length >= numCourts * 2) {
    const games2 = getNextFixedPairGames(state, fixedPairs, numCourts);
    const pp = new Set(games2.flatMap((g) => [...g.pair1, ...g.pair2]));
    state.roundIndex = (state.roundIndex || 0) + 1;
    return {
      round: state.roundIndex,
      resting: state.activeplayers.filter((p) => !pp.has(p)).map((p) => `${p}#${(restCount[p] || 0) + 1}`),
      playing: [...pp],
      games: games2
    };
  }
  if (state.standardGamesMode && fixedThisRound.length === 0) {
    const groupedGames = buildGroupedUniqueGames(state, playing);
    if (groupedGames && groupedGames.length === numCourts) {
      state.roundIndex = (state.roundIndex || 0) + 1;
      return {
        round: state.roundIndex,
        resting: resting.map((p) => `${p}#${(restCount[p] || 0) + 1}`),
        playing,
        games: groupedGames
      };
    }
  }
  const required = Math.floor(numCourts * 4 / 2) - fixedThisRound.length;
  let freePairs = findDisjointPairs(freePlayers, pairPlayedSet, required, opponentMap) || [];
  if (freePairs.length < required) {
    const used = new Set(freePairs.flat());
    for (let i = 0; i < freePlayers.length && freePairs.length < required; i++) {
      if (used.has(freePlayers[i])) continue;
      for (let j = i + 1; j < freePlayers.length; j++) {
        if (!used.has(freePlayers[j])) {
          freePairs.push([freePlayers[i], freePlayers[j]]);
          used.add(freePlayers[i]);
          used.add(freePlayers[j]);
          break;
        }
      }
    }
  }
  let allPairs = shuffle([...fixedThisRound, ...freePairs]);
  const scores = getMatchupScores(allPairs, opponentMap);
  const games = [], usedPairs = /* @__PURE__ */ new Set();
  for (const m of scores) {
    const k1 = m.pair1.join("&"), k2 = m.pair2.join("&");
    if (usedPairs.has(k1) || usedPairs.has(k2)) continue;
    games.push({ court: games.length + 1, pair1: [...m.pair1], pair2: [...m.pair2] });
    usedPairs.add(k1);
    usedPairs.add(k2);
    if (games.length >= numCourts) break;
  }
  state.roundIndex = (state.roundIndex || 0) + 1;
  return {
    round: state.roundIndex,
    resting: resting.map((p) => `${p}#${(restCount[p] || 0) + 1}`),
    playing,
    games
  };
}
__name(randomRound, "randomRound");
__name2(randomRound, "randomRound");
function calculateTiers(activeplayers, allPlayers) {
  const ratingMap = {};
  for (const p of allPlayers || []) {
    ratingMap[p.name] = parseFloat(p.clubRating || p.rating || 3);
  }
  const sorted = [...activeplayers].sort((a, b) => (ratingMap[b] || 3) - (ratingMap[a] || 3));
  const topCut = Math.ceil(sorted.length / 3);
  const botCut = Math.floor(sorted.length * 2 / 3);
  const tierMap = {};
  sorted.forEach((p, i) => {
    tierMap[p] = i < topCut ? "strong" : i < botCut ? "inter" : "weak";
  });
  return tierMap;
}
__name(calculateTiers, "calculateTiers");
__name2(calculateTiers, "calculateTiers");
function getGameTierRule(pair1, pair2, tierMap) {
  const sig = /* @__PURE__ */ __name2((pair) => [...pair].map((p) => tierMap[p] || "inter").sort().join("+"), "sig");
  const s1 = sig(pair1), s2 = sig(pair2);
  if (["strong+strong", "inter+inter", "weak+weak"].includes(s1) && s1 === s2) return 1;
  if (["inter+strong", "strong+weak", "inter+weak"].includes(s1) && s1 === s2) return 2;
  const sw = /* @__PURE__ */ new Set(["strong+weak", "weak+strong"]);
  if (sw.has(s1) && s2 === "inter+inter" || s1 === "inter+inter" && sw.has(s2)) return 3;
  return 0;
}
__name(getGameTierRule, "getGameTierRule");
__name2(getGameTierRule, "getGameTierRule");
function buildRepetitionHistory(allRounds) {
  const pairSet = /* @__PURE__ */ new Set(), gameSet = /* @__PURE__ */ new Set();
  for (const rnd of allRounds) {
    if (!rnd?.games) continue;
    for (const g of rnd.games) {
      if (!g.pair1 || !g.pair2) continue;
      const k1 = pairKey(g.pair1[0], g.pair1[1]);
      const k2 = pairKey(g.pair2[0], g.pair2[1]);
      pairSet.add(k1);
      pairSet.add(k2);
      gameSet.add([k1, k2].sort().join(":"));
    }
  }
  return { pairSet, gameSet };
}
__name(buildRepetitionHistory, "buildRepetitionHistory");
__name2(buildRepetitionHistory, "buildRepetitionHistory");
function isGameRepeated(game, gameSet) {
  if (!game?.pair1 || !game?.pair2) return false;
  const k1 = pairKey(game.pair1[0], game.pair1[1]);
  const k2 = pairKey(game.pair2[0], game.pair2[1]);
  return gameSet.has([k1, k2].sort().join(":"));
}
__name(isGameRepeated, "isGameRepeated");
__name2(isGameRepeated, "isGameRepeated");
function getOppFreshness(t1, t2, opponentMap) {
  let f = 0;
  for (const a of t1) for (const b of t2) if (!(opponentMap[a] || {})[b]) f++;
  return f;
}
__name(getOppFreshness, "getOppFreshness");
__name2(getOppFreshness, "getOppFreshness");
function findBestCourtCombination(playing, numCourts, tierMap, state, gameSet) {
  const { opponentMap, allRounds = [], allPlayers = [] } = state;
  const ratingMap = {};
  for (const p of allPlayers) ratingMap[p.name] = parseFloat(p.clubRating || p.rating || 3);
  function getRating2(name) {
    return ratingMap[name] || 3;
  }
  __name(getRating2, "getRating2");
  __name2(getRating2, "getRating");
  function pk(a, b) {
    return [a, b].sort().join("&");
  }
  __name(pk, "pk");
  __name2(pk, "pk");
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
  __name(isPairRepeated, "isPairRepeated");
  __name2(isPairRepeated, "isPairRepeated");
  function isFullGameRepeated(p1, p2) {
    return isGameRepeated({ pair1: p1, pair2: p2 }, gameSet);
  }
  __name(isFullGameRepeated, "isFullGameRepeated");
  __name2(isFullGameRepeated, "isFullGameRepeated");
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
  __name(pairAge, "pairAge");
  __name2(pairAge, "pairAge");
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
          if ((/* @__PURE__ */ new Set([...t1, ...t2])).size !== 4) continue;
          const rule = getGameTierRule(t1, t2, tierMap);
          const score = (rule === 1 ? 30 : rule === 2 ? 20 : rule === 3 ? 10 : 5) + pairAge(t1[0], t1[1]) + pairAge(t2[0], t2[1]) + getOppFreshness(t1, t2, opponentMap) * 2;
          gameScores.push({ pair1: [...t1], pair2: [...t2], courtRule: rule, score, players: /* @__PURE__ */ new Set([...t1, ...t2]) });
        }
      }
    }
  }
  gameScores.sort((a, b) => b.score - a.score);
  function greedyFrom(startGame) {
    const picked = [{ pair1: [...startGame.pair1], pair2: [...startGame.pair2], courtRule: startGame.courtRule, repeated: false }];
    const used = /* @__PURE__ */ new Set([...startGame.players]);
    for (const g of gameScores) {
      if (picked.length >= numCourts) break;
      if (g === startGame) continue;
      let overlap = false;
      for (const p of g.players) if (used.has(p)) {
        overlap = true;
        break;
      }
      if (overlap) continue;
      picked.push({ pair1: [...g.pair1], pair2: [...g.pair2], courtRule: g.courtRule, repeated: false });
      for (const p of g.players) used.add(p);
    }
    return picked.length === numCourts ? picked : null;
  }
  __name(greedyFrom, "greedyFrom");
  __name2(greedyFrom, "greedyFrom");
  function countRepeats(games) {
    let count = 0;
    for (const g of games) {
      if (isPairRepeated(g.pair1[0], g.pair1[1])) count++;
      if (isPairRepeated(g.pair2[0], g.pair2[1])) count++;
    }
    return count;
  }
  __name(countRepeats, "countRepeats");
  __name2(countRepeats, "countRepeats");
  function applySwapFix(games) {
    const tolerances = [0.5, 1, 1.5, Infinity];
    for (const tolerance of tolerances) {
      const anyRepeated = games.some((g) => isPairRepeated(g.pair1[0], g.pair1[1]) || isPairRepeated(g.pair2[0], g.pair2[1]));
      if (!anyRepeated) break;
      for (let ci = 0; ci < games.length; ci++) {
        const game = games[ci];
        for (const badPairKey of ["pair1", "pair2"]) {
          if (!isPairRepeated(game[badPairKey][0], game[badPairKey][1])) continue;
          const badPair = game[badPairKey];
          const goodPair = game[badPairKey === "pair1" ? "pair2" : "pair1"];
          for (let pi = 0; pi < badPair.length; pi++) {
            const swapOut = badPair[pi];
            const keepIn = badPair[1 - pi];
            for (let cj = 0; cj < games.length; cj++) {
              if (cj === ci) continue;
              const otherGame = games[cj];
              for (const otherPairKey of ["pair1", "pair2"]) {
                const candidatePair = otherGame[otherPairKey];
                for (let qi = 0; qi < candidatePair.length; qi++) {
                  const swapIn = candidatePair[qi];
                  const swapInPartner = candidatePair[1 - qi];
                  if (Math.abs(getRating2(swapOut) - getRating2(swapIn)) > tolerance) continue;
                  const newBadPair = [keepIn, swapIn];
                  const newOtherPair = [swapOut, swapInPartner];
                  if (isPairRepeated(newBadPair[0], newBadPair[1])) continue;
                  if (isPairRepeated(newOtherPair[0], newOtherPair[1])) continue;
                  const newGame1p1 = badPairKey === "pair1" ? newBadPair : goodPair;
                  const newGame1p2 = badPairKey === "pair1" ? goodPair : newBadPair;
                  const otherGoodPair = otherGame[otherPairKey === "pair1" ? "pair2" : "pair1"];
                  const newGame2p1 = otherPairKey === "pair1" ? newOtherPair : otherGoodPair;
                  const newGame2p2 = otherPairKey === "pair1" ? otherGoodPair : newOtherPair;
                  if (isFullGameRepeated(newGame1p1, newGame1p2)) continue;
                  if (isFullGameRepeated(newGame2p1, newGame2p2)) continue;
                  game[badPairKey] = [...newBadPair];
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
  __name(applySwapFix, "applySwapFix");
  __name2(applySwapFix, "applySwapFix");
  const BEAM_SIZE = Math.min(12, gameScores.length);
  let bestResult = null, bestRepeats = Infinity;
  for (let b = 0; b < BEAM_SIZE; b++) {
    const attempt = greedyFrom(gameScores[b]);
    if (!attempt) continue;
    const fixed = applySwapFix(attempt.map((g) => ({ pair1: [...g.pair1], pair2: [...g.pair2], courtRule: g.courtRule, repeated: false })));
    const repeats = countRepeats(fixed);
    if (repeats < bestRepeats) {
      bestRepeats = repeats;
      bestResult = fixed;
      if (repeats === 0) break;
    }
  }
  if (!bestResult) return null;
  for (const g of bestResult) {
    g.repeated = isFullGameRepeated(g.pair1, g.pair2);
    g.pair1Repeated = isPairRepeated(g.pair1[0], g.pair1[1]);
    g.pair2Repeated = isPairRepeated(g.pair2[0], g.pair2[1]);
  }
  return bestResult;
}
__name(findBestCourtCombination, "findBestCourtCombination");
__name2(findBestCourtCombination, "findBestCourtCombination");
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
__name(updateAfterRound, "updateAfterRound");
__name2(updateAfterRound, "updateAfterRound");
function resetForCompetitive(state) {
  if (!state.opponentMap || typeof state.opponentMap !== "object") {
    state.opponentMap = {};
  }
  for (const p of state.activeplayers) {
    if (!state.opponentMap[p]) state.opponentMap[p] = {};
    for (const p2 of state.activeplayers) {
      if (p !== p2 && state.opponentMap[p][p2] === void 0) {
        state.opponentMap[p][p2] = 0;
      }
    }
  }
}
__name(resetForCompetitive, "resetForCompetitive");
__name2(resetForCompetitive, "resetForCompetitive");
function competitiveRound(state) {
  const { activeplayers, numCourts, restCount, allRounds, allPlayers } = state;
  const tierMap = calculateTiers(activeplayers, allPlayers);
  const selected = selectRestingAndPlaying({ ...state, numCourts });
  const resting = selected.resting;
  let playing = selected.playing;
  const candidateIndex = Number(state._balancedCandidateIndex || 0);
  if (candidateIndex === 1 && playing.length > 1) {
    playing = playing.slice(1).concat(playing[0]);
  } else if (candidateIndex === 2 && playing.length > 3) {
    const evens = playing.filter((_, i) => i % 2 === 0);
    const odds = playing.filter((_, i) => i % 2 === 1);
    playing = odds.concat(evens);
  }
  const { gameSet } = buildRepetitionHistory(allRounds);
  let proposed = findBestCourtCombination(playing, numCourts, tierMap, state, gameSet);
  if (!proposed) {
    const fb = randomRound({ ...state });
    proposed = fb.games.map((g) => ({ pair1: g.pair1, pair2: g.pair2, courtRule: 0, repeated: false }));
  }
  const finalGames = [];
  for (let c = 0; c < proposed.length; c++) {
    const p = proposed[c];
    if (p.repeated || p.courtRule === -1) {
      const tmp = { ...state, activeplayers: [...p.pair1, ...p.pair2], numCourts: 1, fixedPairs: [], restQueue: [...p.pair1, ...p.pair2] };
      const rr = randomRound(tmp);
      const g = rr.games[0] || { pair1: p.pair1, pair2: p.pair2 };
      finalGames.push({ court: c + 1, pair1: [...g.pair1], pair2: [...g.pair2], courtRule: 0, isRandom: true });
    } else {
      finalGames.push({ court: c + 1, pair1: [...p.pair1], pair2: [...p.pair2], courtRule: p.courtRule, isRandom: false });
    }
  }
  updateAfterRound(state, finalGames.map((g) => [g.pair1, g.pair2]));
  state.roundIndex = (state.roundIndex || 0) + 1;
  return {
    round: state.roundIndex,
    resting: resting.map((p) => `${p}#${(restCount[p] || 0) + 1}`),
    playing,
    games: finalGames
  };
}
__name(competitiveRound, "competitiveRound");
__name2(competitiveRound, "competitiveRound");
function cloneBalancedCandidateState(state, candidateIndex) {
  const clone = { ...state };
  clone.activeplayers = [...state.activeplayers || []];
  clone.restQueue = [...state.restQueue || []];
  clone.fixedPairs = (state.fixedPairs || []).map((pair) => [...pair]);
  clone.pairPlayedSet = new Set(state.pairPlayedSet || []);
  clone.gamesMap = new Set(state.gamesMap || []);
  clone.restCount = { ...state.restCount || {} };
  clone.opponentMap = {};
  for (const [player, opponents] of Object.entries(state.opponentMap || {})) {
    clone.opponentMap[player] = { ...opponents || {} };
  }
  clone.fixedPairGameQueue = state.fixedPairGameQueue ? JSON.parse(JSON.stringify(state.fixedPairGameQueue)) : state.fixedPairGameQueue;
  clone._balancedCandidateIndex = candidateIndex;
  return clone;
}
__name(cloneBalancedCandidateState, "cloneBalancedCandidateState");
__name2(cloneBalancedCandidateState, "cloneBalancedCandidateState");
function balancedRoundScore(round, state) {
  if (!round || !Array.isArray(round.games)) return -Infinity;
  const ratings = {};
  for (const player of state.allPlayers || []) {
    const raw = player.guest || player.unrated ? 1 : player.rating || player.clubRating || 1;
    ratings[player.name] = Number.isFinite(Number(raw)) ? Number(raw) : 1;
  }
  const previousRound = (state.allRounds || []).length ? state.allRounds[state.allRounds.length - 1] : null;
  const previousKeys = new Set((previousRound?.games || []).map((g) => gameKey(g.pair1, g.pair2)));
  const previousResting = new Set(
    (previousRound?.resting || []).map((player) => String(player).split("#")[0])
  );
  const historicalRestCount = {};
  for (const historicalRound of state.allRounds || []) {
    for (const restingPlayer of historicalRound?.resting || []) {
      const name = String(restingPlayer).split("#")[0];
      historicalRestCount[name] = (historicalRestCount[name] || 0) + 1;
    }
  }
  const candidateResting = (round.resting || []).map((player) => String(player).split("#")[0]);
  const consecutiveRests = candidateResting.filter((player) => previousResting.has(player)).length;
  const priorRestTotal = candidateResting.reduce(
    (total, player) => total + (historicalRestCount[player] || 0),
    0
  );
  let teamGapTotal = 0;
  let worstTeamGap = 0;
  let repeatedLastRound = 0;
  let repeatedOlderGames = 0;
  let repeatedPartners = 0;
  const courtStrengths = [];
  for (const game of round.games) {
    const p1 = game.pair1 || [];
    const p2 = game.pair2 || [];
    const team1 = p1.reduce((sum, p) => sum + (ratings[p] || 1), 0);
    const team2 = p2.reduce((sum, p) => sum + (ratings[p] || 1), 0);
    const gap = Math.abs(team1 - team2);
    teamGapTotal += gap;
    worstTeamGap = Math.max(worstTeamGap, gap);
    courtStrengths.push((team1 + team2) / Math.max(1, p1.length + p2.length));
    const matchKey = gameKey(p1, p2);
    if (previousKeys.has(matchKey)) repeatedLastRound += 1;
    else if (state.gamesMap && state.gamesMap.has(matchKey)) repeatedOlderGames += 1;
    if (p1.length === 2 && state.pairPlayedSet?.has(pairKey(p1[0], p1[1]))) repeatedPartners += 1;
    if (p2.length === 2 && state.pairPlayedSet?.has(pairKey(p2[0], p2[1]))) repeatedPartners += 1;
  }
  const courtSpread = courtStrengths.length ? Math.max(...courtStrengths) - Math.min(...courtStrengths) : 0;
  return -consecutiveRests * 1e12 - priorRestTotal * 1e9 - worstTeamGap * 1e6 - teamGapTotal * 1e5 - courtSpread * 1e4 - repeatedLastRound * 1e8 - repeatedOlderGames * 1e3 - repeatedPartners * 100;
}
__name(balancedRoundScore, "balancedRoundScore");
__name2(balancedRoundScore, "balancedRoundScore");
function copyBalancedCandidateState(target, source) {
  target.restQueue = [...source.restQueue || []];
  target.restCount = { ...source.restCount || {} };
  target.pairPlayedSet = new Set(source.pairPlayedSet || []);
  target.gamesMap = new Set(source.gamesMap || []);
  target.opponentMap = {};
  for (const [player, opponents] of Object.entries(source.opponentMap || {})) {
    target.opponentMap[player] = { ...opponents || {} };
  }
  target.roundIndex = source.roundIndex;
  target.fixedPairGameQueue = source.fixedPairGameQueue;
  target.fixedPairGameQueueHash = source.fixedPairGameQueueHash;
}
__name(copyBalancedCandidateState, "copyBalancedCandidateState");
__name2(copyBalancedCandidateState, "copyBalancedCandidateState");
function generateBestBalancedRound(state) {
  const candidates = [];
  for (let candidateIndex = 0; candidateIndex < 3; candidateIndex++) {
    const candidateState = cloneBalancedCandidateState(state, candidateIndex);
    const round = competitiveRound(candidateState);
    const qc = validateRound(round, candidateState);
    if (!qc.valid) continue;
    candidates.push({
      round,
      state: candidateState,
      score: balancedRoundScore(round, state),
      candidateIndex
    });
  }
  if (!candidates.length) return competitiveRound(state);
  candidates.sort((a, b) => b.score - a.score || a.candidateIndex - b.candidateIndex);
  const best = candidates[0];
  copyBalancedCandidateState(state, best.state);
  return best.round;
}
__name(generateBestBalancedRound, "generateBestBalancedRound");
__name2(generateBestBalancedRound, "generateBestBalancedRound");
function validateRound(rnd, state) {
  const fails = [];
  if (!rnd?.games) return { valid: false, hardFails: ["No games"] };
  const { games, playing } = rnd;
  const { numCourts, fixedPairs = [], gamesMap, courtFormats = [], courtTypes = [], allPlayers = [] } = state;
  if (games.length !== numCourts) fails.push(`Court count: got ${games.length}, expected ${numCourts}`);
  const seen = /* @__PURE__ */ new Set();
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    const courtIndex = Number.isFinite(Number(g.court)) ? Math.max(0, Number(g.court) - 1) : i;
    const expectedSize = courtFormats[courtIndex] === "singles" ? 1 : 2;
    if (!g.pair1 || g.pair1.length !== expectedSize) fails.push(`Court ${i + 1}: pair1 invalid`);
    if (!g.pair2 || g.pair2.length !== expectedSize) fails.push(`Court ${i + 1}: pair2 invalid`);
    for (const p of [...g.pair1 || [], ...g.pair2 || []]) {
      if (seen.has(p)) fails.push(`Duplicate player: ${p}`);
      seen.add(p);
    }
    const format = courtFormats[courtIndex] || "doubles";
    const type = String(courtTypes[courtIndex] || "free").toLowerCase();
    const players = [...g.pair1 || [], ...g.pair2 || []];
    const genders = players.map((player) => String(getGender(player, allPlayers) || "").toLowerCase());
    const men = genders.filter((gender) => gender === "male").length;
    const women = genders.filter((gender) => gender === "female").length;
    if (format === "singles") {
      if ((type === "md" || type === "men" || type === "singles-men") && men !== 2) {
        fails.push(`Court ${i + 1}: Men's Singles requires 2 male players`);
      }
      if ((type === "ld" || type === "wd" || type === "women" || type === "ladies" || type === "singles-women") && women !== 2) {
        fails.push(`Court ${i + 1}: Ladies' Singles requires 2 female players`);
      }
    } else {
      if (type === "md" && men !== 4) fails.push(`Court ${i + 1}: MD requires 4 male players`);
      if ((type === "ld" || type === "wd") && women !== 4) fails.push(`Court ${i + 1}: WD requires 4 female players`);
      if (type === "xd") {
        if (men !== 2 || women !== 2) fails.push(`Court ${i + 1}: XD requires 2 male and 2 female players`);
        const pair1Mixed = (g.pair1 || []).some((p) => String(getGender(p, allPlayers)).toLowerCase() === "male") && (g.pair1 || []).some((p) => String(getGender(p, allPlayers)).toLowerCase() === "female");
        const pair2Mixed = (g.pair2 || []).some((p) => String(getGender(p, allPlayers)).toLowerCase() === "male") && (g.pair2 || []).some((p) => String(getGender(p, allPlayers)).toLowerCase() === "female");
        if (!pair1Mixed || !pair2Mixed) fails.push(`Court ${i + 1}: each XD team requires 1 male and 1 female player`);
      }
    }
  }
  for (const p of playing || []) if (!seen.has(p)) fails.push(`Missing from courts: ${p}`);
  if (fixedPairs.length) {
    const restSet = new Set((rnd.resting || []).map((r) => r.split("#")[0]));
    for (const [a, b] of fixedPairs) {
      if (restSet.has(a) && restSet.has(b)) continue;
      if (!restSet.has(a) && !restSet.has(b)) {
        const together = games.some(
          (g) => g.pair1?.includes(a) && g.pair1?.includes(b) || g.pair2?.includes(a) && g.pair2?.includes(b)
        );
        if (!together) fails.push(`Fixed pair split: ${a} & ${b}`);
      }
    }
  }
  if (gamesMap && !state.balancedGamesMode) {
    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      if (!g.pair1 || !g.pair2) continue;
      const mk = gameKey(g.pair1, g.pair2);
      if (gamesMap.has(mk)) fails.push(`Court ${i + 1} repeated match`);
    }
  }
  return { valid: fails.length === 0, hardFails: fails };
}
__name(validateRound, "validateRound");
__name2(validateRound, "validateRound");
function mbmBestGame(pool, waitQueue, state) {
  const { opponentMap = {}, allRounds = [], allPlayers = [] } = state;
  function pairAge(a, b) {
    const key = pairKey(a, b);
    let lastRound = -1;
    for (let r = 0; r < allRounds.length; r++) {
      const rnd = allRounds[r];
      if (!rnd?.games) continue;
      for (const g of rnd.games) {
        if (!g.pair1 || !g.pair2) continue;
        if (pairKey(g.pair1[0], g.pair1[1]) === key || pairKey(g.pair2[0], g.pair2[1]) === key) lastRound = r;
      }
    }
    return lastRound === -1 ? allRounds.length + 1 : allRounds.length - lastRound;
  }
  __name(pairAge, "pairAge");
  __name2(pairAge, "pairAge");
  function oppFreshness(t1, t2) {
    let fresh = 0;
    for (const a of t1) for (const b of t2)
      if (!(opponentMap[a] || {})[b]) fresh++;
    return fresh;
  }
  __name(oppFreshness, "oppFreshness");
  __name2(oppFreshness, "oppFreshness");
  function waitWeight(players) {
    let w = 0;
    for (const p of players) {
      const idx = waitQueue.indexOf(p);
      w += idx === -1 ? 0 : waitQueue.length - idx;
    }
    return w;
  }
  __name(waitWeight, "waitWeight");
  __name2(waitWeight, "waitWeight");
  function scoreGame(pair1, pair2) {
    const opp = oppFreshness(pair1, pair2);
    const age = pairAge(pair1[0], pair1[1]) + pairAge(pair2[0], pair2[1]);
    const wait = waitWeight([...pair1, ...pair2]);
    return { opp, age, wait, total: opp * 1e3 + age * 10 + wait };
  }
  __name(scoreGame, "scoreGame");
  __name2(scoreGame, "scoreGame");
  let best = null;
  const n = pool.length;
  for (let i = 0; i < n - 3; i++) {
    for (let j = i + 1; j < n - 2; j++) {
      for (let k = j + 1; k < n - 1; k++) {
        for (let l = k + 1; l < n; l++) {
          const four = [pool[i], pool[j], pool[k], pool[l]];
          const pairings = [
            { p1: [four[0], four[1]], p2: [four[2], four[3]] },
            { p1: [four[0], four[2]], p2: [four[1], four[3]] },
            { p1: [four[0], four[3]], p2: [four[1], four[2]] }
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
__name(mbmBestGame, "mbmBestGame");
__name2(mbmBestGame, "mbmBestGame");
function sharedRoundStrict(state, useBalancedBands, standardPath = "") {
  const active = [...state.activeplayers || []];
  const allPlayers = state.allPlayers || [];
  const formats = Array.from({ length: state.numCourts || 0 }, (_, i) => (state.courtFormats || [])[i] || "doubles");
  const types = Array.from({ length: state.numCourts || 0 }, (_, i) => String((state.courtTypes || [])[i] || "free").toLowerCase());
  const seats = formats.reduce((sum, format) => sum + (format === "singles" ? 2 : 4), 0);
  const restNeeded = Math.max(0, active.length - seats);
  if (active.length < seats) throw new Error("Not enough active players for the selected courts");
  const rating = /* @__PURE__ */ __name2((name) => getRating(name, allPlayers), "rating");
  const gender = /* @__PURE__ */ __name2((name) => String(getGender(name, allPlayers) || "").toLowerCase(), "gender");
  const rankedActive = [...active].sort((a, b) => rating(b) - rating(a) || String(a).localeCompare(String(b)));
  const activeHalf = Math.ceil(rankedActive.length / 2);
  const suppliedBand = state.frozenBalancedBands;
  const activeBand = new Map(rankedActive.map((name, index) => [
    name,
    suppliedBand && Object.prototype.hasOwnProperty.call(suppliedBand, name) ? Number(suppliedBand[name]) === 1 ? 1 : 0 : index < activeHalf ? 1 : 0
  ]));
  const fixedMate = /* @__PURE__ */ new Map();
  for (const pair of state.fixedPairs || []) {
    if (pair?.length >= 2 && active.includes(pair[0]) && active.includes(pair[1])) {
      fixedMate.set(pair[0], pair[1]);
      fixedMate.set(pair[1], pair[0]);
    }
  }
  const queue = [
    ...(state.restQueue || []).filter((name, index, arr) => active.includes(name) && arr.indexOf(name) === index),
    ...active.filter((name) => !(state.restQueue || []).includes(name))
  ];
  const qpos = new Map(queue.map((name, index) => [name, index]));
  const subgroupPosition = /* @__PURE__ */ new Map();
  for (const sex of ["male", "female"]) for (const value of [1, 0]) {
    queue.filter((name) => gender(name) === sex && activeBand.get(name) === value).forEach((name, index) => subgroupPosition.set(name, index));
  }
  const restCount = state.restCount || {};
  const previousRest = new Set((state.allRounds?.at(-1)?.resting || []).map((raw) => String(raw).split("#")[0]));
  const secondPreviousRest = new Set((state.allRounds?.at(-2)?.resting || []).map((raw) => String(raw).split("#")[0]));
  const restedLastTwoRounds = new Set([...previousRest].filter((name) => secondPreviousRest.has(name)));
  const doubleRestTurns = Object.fromEntries(active.map((name) => [name, 0]));
  for (let roundIndex = 1; roundIndex < (state.allRounds || []).length; roundIndex++) {
    const before = new Set((state.allRounds[roundIndex - 1]?.resting || []).map((raw) => String(raw).split("#")[0]));
    const current = new Set((state.allRounds[roundIndex]?.resting || []).map((raw) => String(raw).split("#")[0]));
    for (const name of current) if (before.has(name) && Object.prototype.hasOwnProperty.call(doubleRestTurns, name)) {
      doubleRestTurns[name]++;
    }
  }
  const standardFreeQueue = queue;
  const standardFreePosition = new Map(standardFreeQueue.map((name, index) => [name, index]));
  const fastStandardFree = !useBalancedBands && (!standardPath || standardPath === "free") && formats.every((format) => format === "doubles") && types.every((type) => type === "free") && fixedMate.size === 0;
  const fastBalancedFree = useBalancedBands && formats.every((format) => format === "doubles") && types.every((type) => type === "free") && fixedMate.size === 0;
  const fastStandardXD = !useBalancedBands && (!standardPath || standardPath === "xd") && formats.every((format) => format === "doubles") && types.every((type) => type === "xd") && fixedMate.size === 0;
  const fastStandardMixed = !useBalancedBands && standardPath === "typed" && formats.every((format) => format === "doubles") && types.every((type) => ["free", "md", "ld", "wd", "xd"].includes(type)) && fixedMate.size === 0;
  const restCycle = active.length ? Math.min(...active.map((name) => restCount[name] || 0)) : 0;
  function randomCycleOrder(items) {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index--) {
      const random = new Uint32Array(1);
      crypto.getRandomValues(random);
      const swapIndex = random[0] % (index + 1);
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
  }
  __name(randomCycleOrder, "randomCycleOrder");
  __name2(randomCycleOrder, "randomCycleOrder");
  let updatedRestQueue = null;
  function standardFreeResting() {
    const selected = [];
    const selectedSet = /* @__PURE__ */ new Set();
    while (selected.length < restNeeded) {
      const available = active.filter((name) => !selectedSet.has(name));
      if (!available.length) break;
      const cycle = Math.min(...available.map((name) => restCount[name] || 0));
      const layer = available.filter((name) => (restCount[name] || 0) === cycle);
      layer.sort(
        (a, b) => Number(previousRest.has(a)) - Number(previousRest.has(b)) || (standardFreePosition.get(a) ?? active.length) - (standardFreePosition.get(b) ?? active.length)
      );
      const take = Math.min(restNeeded - selected.length, layer.length);
      for (const name of layer.slice(0, take)) {
        selected.push(name);
        selectedSet.add(name);
      }
    }
    return selected;
  }
  __name(standardFreeResting, "standardFreeResting");
  __name2(standardFreeResting, "standardFreeResting");
  function standardXdResting() {
    const requiredPerGender = formats.length * 2;
    const men = active.filter((name) => gender(name) === "male");
    const women = active.filter((name) => gender(name) === "female");
    if (men.length < requiredPerGender || women.length < requiredPerGender) {
      throw new Error(`XD requires at least ${requiredPerGender} men and ${requiredPerGender} women`);
    }
    let currentOrder = updatedRestQueue || queue;
    function selectGroup(pool, needed) {
      const selected2 = [], selectedSet = /* @__PURE__ */ new Set();
      const initialCycle = pool.length ? Math.min(...pool.map((name) => restCount[name] || 0)) : 0;
      while (selected2.length < needed) {
        const available = pool.filter((name) => !selectedSet.has(name));
        if (!available.length) break;
        const cycle = Math.min(...available.map((name) => restCount[name] || 0));
        const layer = available.filter((name) => (restCount[name] || 0) === cycle);
        const startsCycle = cycle > 0 && pool.every((name) => (restCount[name] || 0) === cycle);
        const crossesCycle = cycle > initialCycle;
        if (startsCycle || crossesCycle) {
          const shuffled = randomCycleOrder(pool);
          const groupSet = new Set(pool);
          let replacementIndex = 0;
          currentOrder = currentOrder.map((name) => groupSet.has(name) ? shuffled[replacementIndex++] : name);
          updatedRestQueue = currentOrder;
        }
        const position = new Map(currentOrder.map((name, index) => [name, index]));
        layer.sort(
          (a, b) => Number(previousRest.has(a)) - Number(previousRest.has(b)) || (position.get(a) ?? active.length) - (position.get(b) ?? active.length)
        );
        const take = Math.min(needed - selected2.length, layer.length);
        for (const name of layer.slice(0, take)) {
          selected2.push(name);
          selectedSet.add(name);
        }
      }
      return selected2;
    }
    __name(selectGroup, "selectGroup");
    __name2(selectGroup, "selectGroup");
    const selected = /* @__PURE__ */ new Set([
      ...selectGroup(men, men.length - requiredPerGender),
      ...selectGroup(women, women.length - requiredPerGender)
    ]);
    return currentOrder.filter((name) => selected.has(name));
  }
  __name(standardXdResting, "standardXdResting");
  __name2(standardXdResting, "standardXdResting");
  function standardMixedResting() {
    const men = active.filter((name) => gender(name) === "male");
    const women = active.filter((name) => gender(name) === "female");
    const menMinimum = types.reduce((sum, type) => sum + (type === "md" ? 4 : type === "xd" ? 2 : 0), 0);
    const womenMinimum = types.reduce((sum, type) => sum + (type === "ld" || type === "wd" ? 4 : type === "xd" ? 2 : 0), 0);
    const freeSeats = types.filter((type) => type === "free").length * 4;
    if (men.length < menMinimum || women.length < womenMinimum || active.length < menMinimum + womenMinimum + freeSeats) {
      throw new Error("Not enough eligible men and women for the selected MD, LD/WD, XD and Free courts");
    }
    const totalPlaying = menMinimum + womenMinimum + freeSeats;
    const queuePosition = new Map(queue.map((name, index) => [name, index]));
    function preview(pool, needed) {
      const selected2 = [...pool].sort(
        (a, b) => (restCount[a] || 0) - (restCount[b] || 0) || Number(previousRest.has(a)) - Number(previousRest.has(b)) || (queuePosition.get(a) ?? active.length) - (queuePosition.get(b) ?? active.length)
      ).slice(0, needed);
      const set = new Set(selected2);
      const projected = pool.map((name) => (restCount[name] || 0) + Number(set.has(name)));
      return {
        selected: selected2,
        spread: projected.length ? Math.max(...projected) - Math.min(...projected) : 0,
        squares: projected.reduce((sum, value) => sum + value * value, 0),
        consecutive: selected2.reduce((sum, name) => sum + Number(previousRest.has(name)), 0)
      };
    }
    __name(preview, "preview");
    __name2(preview, "preview");
    let allocation = null;
    const minimumPlayingMen = Math.max(menMinimum, totalPlaying - women.length);
    const maximumPlayingMen = Math.min(men.length, menMinimum + freeSeats);
    for (let playingMen = minimumPlayingMen; playingMen <= maximumPlayingMen; playingMen++) {
      const playingWomen = totalPlaying - playingMen;
      if (playingWomen < womenMinimum || playingWomen > women.length) continue;
      const menPreview = preview(men, men.length - playingMen);
      const womenPreview = preview(women, women.length - playingWomen);
      const score = [
        Math.max(menPreview.spread, womenPreview.spread),
        menPreview.spread + womenPreview.spread,
        menPreview.squares + womenPreview.squares,
        menPreview.consecutive + womenPreview.consecutive
      ];
      if (!allocation || compareVector(score, allocation.score) < 0) {
        allocation = { score, menRest: men.length - playingMen, womenRest: women.length - playingWomen };
      }
    }
    if (!allocation) throw new Error("No feasible gender allocation for the selected mixed court types");
    let currentOrder = updatedRestQueue || queue;
    if (types.length === 3 && types.filter((type) => type === "md").length === 1 && types.filter((type) => type === "ld" || type === "wd").length === 1 && types.filter((type) => type === "xd").length === 1 && allocation.menRest === 2 && allocation.womenRest === 1) {
      const mdIndex = types.indexOf("md"), ldIndex = types.findIndex((type) => type === "ld" || type === "wd"), xdIndex = types.indexOf("xd");
      const spread = /* @__PURE__ */ __name2((pool, history, selected2) => {
        const set = new Set(selected2), values = pool.map((name) => (history.counts[name] || 0) + Number(set.has(name)));
        return Math.max(...values) - Math.min(...values);
      }, "spread");
      let best = null;
      for (const menRest of combinations(men, 2)) for (const womenRest of combinations(women, 1)) {
        const resting = [...menRest, ...womenRest], restSet = new Set(resting);
        const projectedRest = active.map((name) => (restCount[name] || 0) + Number(restSet.has(name)));
        const restSpread = Math.max(...projectedRest) - Math.min(...projectedRest);
        const playingMen = men.filter((name) => !restSet.has(name)), playingWomen = women.filter((name) => !restSet.has(name));
        let typeScore = null;
        for (const mdPlayers of combinations(playingMen, 4)) {
          const mdSet = new Set(mdPlayers), xdMen = playingMen.filter((name) => !mdSet.has(name));
          for (const ldPlayers of combinations(playingWomen, 4)) {
            const ldSet = new Set(ldPlayers), xdWomen = playingWomen.filter((name) => !ldSet.has(name));
            const spreads = [
              spread(men, typeHistory[mdIndex], mdPlayers),
              spread(women, typeHistory[ldIndex], ldPlayers),
              spread(men, typeHistory[xdIndex], xdMen),
              spread(women, typeHistory[xdIndex], xdWomen)
            ];
            const score2 = [Math.max(...spreads), spreads.reduce((sum, value) => sum + value, 0)];
            if (!typeScore || compareVector(score2, typeScore) < 0) typeScore = score2;
          }
        }
        const score = [
          restSpread,
          resting.reduce((sum, name) => sum + Number(previousRest.has(name)), 0),
          ...typeScore || [99, 99],
          projectedRest.reduce((sum, value) => sum + value * value, 0),
          resting.reduce((sum, name) => sum + (qpos.get(name) ?? active.length), 0)
        ];
        if (!best || compareVector(score, best.score) < 0) best = { score, resting };
      }
      if (best) return currentOrder.filter((name) => best.resting.includes(name));
    }
    function opportunityProgress(name) {
      const playerGender = gender(name);
      const relevant = types.filter(
        (type) => type === "free" || playerGender === "male" && (type === "md" || type === "xd") || playerGender === "female" && (type === "ld" || type === "wd" || type === "xd")
      );
      const progress = [];
      for (const type of relevant) {
        let appearances = 0;
        for (const round of state.allRounds || []) for (const game of round.games || []) {
          if (String(game.format || "doubles").toLowerCase() !== "doubles") continue;
          if (String(game.courtType || "free").toLowerCase() !== type) continue;
          if ([...game.pair1 || [], ...game.pair2 || []].includes(name)) appearances++;
        }
        const seats2 = type === "xd" ? 2 : 4;
        progress.push(appearances / seats2);
      }
      return {
        floor: progress.length ? Math.min(...progress) : 0,
        total: progress.reduce((sum, value) => sum + value, 0)
      };
    }
    __name(opportunityProgress, "opportunityProgress");
    __name2(opportunityProgress, "opportunityProgress");
    function selectGroup(pool, needed) {
      const selected2 = [], selectedSet = /* @__PURE__ */ new Set();
      const initialCycle = pool.length ? Math.min(...pool.map((name) => restCount[name] || 0)) : 0;
      while (selected2.length < needed) {
        const available = pool.filter((name) => !selectedSet.has(name));
        if (!available.length) break;
        const cycle = Math.min(...available.map((name) => restCount[name] || 0));
        const layer = available.filter((name) => (restCount[name] || 0) === cycle);
        const startsCycle = cycle > 0 && pool.every((name) => (restCount[name] || 0) === cycle);
        const crossesCycle = cycle > initialCycle;
        if (startsCycle || crossesCycle) {
          const shuffled = randomCycleOrder(pool), groupSet = new Set(pool);
          let replacementIndex = 0;
          currentOrder = currentOrder.map((name) => groupSet.has(name) ? shuffled[replacementIndex++] : name);
          updatedRestQueue = currentOrder;
        }
        const position = new Map(currentOrder.map((name, index) => [name, index]));
        layer.sort(
          (a, b) => Number(previousRest.has(a)) - Number(previousRest.has(b)) || opportunityProgress(b).floor - opportunityProgress(a).floor || opportunityProgress(b).total - opportunityProgress(a).total || (position.get(a) ?? active.length) - (position.get(b) ?? active.length)
        );
        const take = Math.min(needed - selected2.length, layer.length);
        for (const name of layer.slice(0, take)) {
          selected2.push(name);
          selectedSet.add(name);
        }
      }
      return selected2;
    }
    __name(selectGroup, "selectGroup");
    __name2(selectGroup, "selectGroup");
    const selected = /* @__PURE__ */ new Set([
      ...selectGroup(men, allocation.menRest),
      ...selectGroup(women, allocation.womenRest)
    ]);
    return currentOrder.filter((name) => selected.has(name));
  }
  __name(standardMixedResting, "standardMixedResting");
  __name2(standardMixedResting, "standardMixedResting");
  function combinations(items, needed, start = 0, chosen = [], output = []) {
    if (chosen.length === needed) {
      output.push([...chosen]);
      return output;
    }
    for (let i = start; i <= items.length - (needed - chosen.length); i++) {
      chosen.push(items[i]);
      combinations(items, needed, i + 1, chosen, output);
      chosen.pop();
    }
    return output;
  }
  __name(combinations, "combinations");
  __name2(combinations, "combinations");
  function fixedRestOK(resting) {
    const set = new Set(resting);
    for (const [player, mate] of fixedMate) if (set.has(player) !== set.has(mate)) return false;
    return true;
  }
  __name(fixedRestOK, "fixedRestOK");
  __name2(fixedRestOK, "fixedRestOK");
  function restScore(resting) {
    const set = new Set(resting);
    const projected = active.map((name) => (restCount[name] || 0) + (set.has(name) ? 1 : 0));
    const spread = Math.max(...projected) - Math.min(...projected);
    const squares = projected.reduce((sum, value) => sum + value * value, 0);
    const consecutive = resting.reduce((sum, name) => sum + Number(previousRest.has(name)), 0);
    const fifoPosition = fastStandardFree ? standardFreePosition : qpos;
    const fifo = resting.reduce((sum, name) => sum + (fifoPosition.get(name) ?? active.length), 0);
    const subgroupFifo = resting.reduce((sum, name) => sum + (subgroupPosition.get(name) ?? active.length), 0);
    if (restNeeded === 1) {
      const name = resting[0];
      const lowestRestCount = restCount[name] || 0;
      return [lowestRestCount, consecutive, fifo];
    }
    return [spread, squares, consecutive, subgroupFifo, fifo];
  }
  __name(restScore, "restScore");
  __name2(restScore, "restScore");
  const compareVector = /* @__PURE__ */ __name2((a, b) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
    return 0;
  }, "compareVector");
  function historyForType(courtIndex) {
    const key = formats[courtIndex] + ":" + types[courtIndex];
    const counts = Object.fromEntries(active.map((name) => [name, 0]));
    const last = Object.fromEntries(active.map((name) => [name, -1]));
    for (let r = 0; r < (state.allRounds || []).length; r++) {
      for (const game of state.allRounds[r]?.games || []) {
        const historicalIndex = Math.max(0, Number(game.court || 1) - 1);
        const historicalKey = (game.format || formats[historicalIndex] || "doubles") + ":" + String(game.courtType || types[historicalIndex] || "free").toLowerCase();
        if (historicalKey !== key) continue;
        for (const name of [...game.pair1 || [], ...game.pair2 || []]) {
          counts[name] = (counts[name] || 0) + 1;
          last[name] = r;
        }
      }
    }
    return { counts, last };
  }
  __name(historyForType, "historyForType");
  __name2(historyForType, "historyForType");
  const typeHistory = formats.map((_, index) => historyForType(index));
  const restOptions = restNeeded ? fastStandardFree ? [{ resting: standardFreeResting(), score: [] }] : fastStandardXD ? [{ resting: standardXdResting(), score: [] }] : fastStandardMixed ? [{ resting: standardMixedResting(), score: [] }] : combinations(queue, restNeeded).filter(fixedRestOK).map((resting) => ({ resting, score: restScore(resting) })).sort((a, b) => compareVector(a.score, b.score)) : [{ resting: [], score: [] }];
  const pkey = /* @__PURE__ */ __name2((a, b) => [a, b].sort().join("&"), "pkey");
  const priorPairs = /* @__PURE__ */ new Map(), priorOpponents = /* @__PURE__ */ new Map(), priorGames = /* @__PURE__ */ new Map(), priorPlayerGroups = /* @__PURE__ */ new Map();
  for (const round of state.allRounds || []) for (const game of round.games || []) {
    if (game.pair1?.length === 2 && game.pair2?.length === 2) {
      for (const pair of [game.pair1, game.pair2]) priorPairs.set(pkey(pair[0], pair[1]), (priorPairs.get(pkey(pair[0], pair[1])) || 0) + 1);
      for (const a of game.pair1) for (const b of game.pair2) priorOpponents.set(pkey(a, b), (priorOpponents.get(pkey(a, b)) || 0) + 1);
      const gameKey2 = [pkey(game.pair1[0], game.pair1[1]), pkey(game.pair2[0], game.pair2[1])].sort().join(":");
      priorGames.set(gameKey2, (priorGames.get(gameKey2) || 0) + 1);
      const playerGroupKey = [...game.pair1, ...game.pair2].slice().sort().join("&");
      priorPlayerGroups.set(playerGroupKey, (priorPlayerGroups.get(playerGroupKey) || 0) + 1);
    }
  }
  const priorMixedPartners = new Map(active.map((name) => [name, 0]));
  for (const round of state.allRounds || []) {
    const historicalBands = round.balancedBands || round.balancedRatingMap && Object.fromEntries(
      Object.entries(round.balancedRatingMap).map(([name, value]) => [name, Number(value) >= 5 ? 1 : 0])
    );
    if (!historicalBands) continue;
    for (const game of round.games || []) for (const pair of [game.pair1, game.pair2]) {
      if (!Array.isArray(pair) || pair.length !== 2) continue;
      if (Number(historicalBands[pair[0]]) === Number(historicalBands[pair[1]])) continue;
      for (const name of pair) priorMixedPartners.set(name, (priorMixedPartners.get(name) || 0) + 1);
    }
  }
  const preferMixedBalancedRound = (state.allRounds || []).length % 2 === 1;
  const singlesTypeKey = /* @__PURE__ */ __name2((type) => ["md", "men", "singles-men"].includes(type) ? "singles-men" : ["ld", "wd", "women", "ladies", "singles-women"].includes(type) ? "singles-women" : "singles-free", "singlesTypeKey");
  const priorSinglesMeetings = /* @__PURE__ */ new Map();
  for (const round of state.allRounds || []) for (const game of round.games || []) {
    if ((game.pair1 || []).length !== 1 || (game.pair2 || []).length !== 1) continue;
    const key = singlesTypeKey(String(game.courtType || "free").toLowerCase()) + ":" + pkey(game.pair1[0], game.pair2[0]);
    priorSinglesMeetings.set(key, (priorSinglesMeetings.get(key) || 0) + 1);
  }
  function combinedRoundRobinOrder(type) {
    const key = singlesTypeKey(type);
    const pool = active.filter((name) => key === "singles-free" || key === "singles-men" && gender(name) === "male" || key === "singles-women" && gender(name) === "female");
    const rotation = [...pool].sort((a, b) => (qpos.get(a) ?? active.length) - (qpos.get(b) ?? active.length) || String(a).localeCompare(String(b)));
    if (rotation.length % 2) rotation.push(null);
    const order = /* @__PURE__ */ new Map();
    let sequence = 0;
    for (let round = 0; round < Math.max(0, rotation.length - 1); round++) {
      for (let index = 0; index < rotation.length / 2; index++) {
        const first = rotation[index], second = rotation[rotation.length - 1 - index];
        if (first && second) order.set(pkey(first, second), sequence++);
      }
      if (rotation.length > 2) rotation.splice(1, 0, rotation.pop());
    }
    return order;
  }
  __name(combinedRoundRobinOrder, "combinedRoundRobinOrder");
  __name2(combinedRoundRobinOrder, "combinedRoundRobinOrder");
  const combinedRoundRobin = new Map(types.map((type) => [singlesTypeKey(type), combinedRoundRobinOrder(type)]));
  const standardFreeMode = !useBalancedBands && formats.every((format) => format === "doubles") && types.every((type) => type === "free");
  function canFormFreshNonFixedPairs(resting) {
    const restSet = new Set(resting);
    const playing = active.filter((name) => !restSet.has(name));
    const fixedPlayersPlaying = /* @__PURE__ */ new Set();
    for (const [player, mate] of fixedMate) {
      const playerIn = playing.includes(player), mateIn = playing.includes(mate);
      if (playerIn !== mateIn) return false;
      if (playerIn) {
        fixedPlayersPlaying.add(player);
        fixedPlayersPlaying.add(mate);
      }
    }
    const free = playing.filter((name) => !fixedPlayersPlaying.has(name));
    if (free.length % 2) return false;
    const memo = /* @__PURE__ */ new Map();
    function match(remaining) {
      if (!remaining.length) return true;
      const key = remaining.slice().sort().join("|");
      if (memo.has(key)) return memo.get(key);
      const first = remaining[0];
      for (let index = 1; index < remaining.length; index++) {
        const second = remaining[index];
        if ((priorPairs.get(pkey(first, second)) || 0) > 0) continue;
        const next = remaining.slice(1, index).concat(remaining.slice(index + 1));
        if (match(next)) {
          memo.set(key, true);
          return true;
        }
      }
      memo.set(key, false);
      return false;
    }
    __name(match, "match");
    __name2(match, "match");
    return match(free);
  }
  __name(canFormFreshNonFixedPairs, "canFormFreshNonFixedPairs");
  __name2(canFormFreshNonFixedPairs, "canFormFreshNonFixedPairs");
  function canFormFreshTypedGames(resting) {
    const restSet = new Set(resting), playing = active.filter((name) => !restSet.has(name));
    const courtCandidates = types.map((type) => {
      const candidates = [];
      for (const group of combinations(playing, 4)) {
        const arrangements = [
          [[group[0], group[1]], [group[2], group[3]]],
          [[group[0], group[2]], [group[1], group[3]]],
          [[group[0], group[3]], [group[1], group[2]]]
        ];
        for (const [first, second] of arrangements) {
          const names = [...first, ...second], men = names.filter((name) => gender(name) === "male").length;
          if (type === "md" && men !== 4) continue;
          if ((type === "ld" || type === "wd") && men !== 0) continue;
          if (type === "xd" && (men !== 2 || first.filter((name) => gender(name) === "male").length !== 1 || second.filter((name) => gender(name) === "male").length !== 1)) continue;
          if ((priorPairs.get(pkey(first[0], first[1])) || 0) > 0 || (priorPairs.get(pkey(second[0], second[1])) || 0) > 0) continue;
          candidates.push({ players: group });
        }
      }
      return candidates;
    });
    if (courtCandidates.some((candidates) => !candidates.length)) return false;
    const order = types.map((_, index) => index).sort((a, b) => courtCandidates[a].length - courtCandidates[b].length);
    function assign(position, available) {
      if (position === order.length) return true;
      for (const candidate of courtCandidates[order[position]]) {
        if (!candidate.players.every((name) => available.has(name))) continue;
        const next = new Set(available);
        candidate.players.forEach((name) => next.delete(name));
        if (assign(position + 1, next)) return true;
      }
      return false;
    }
    __name(assign, "assign");
    __name2(assign, "assign");
    return assign(0, new Set(playing));
  }
  __name(canFormFreshTypedGames, "canFormFreshTypedGames");
  __name2(canFormFreshTypedGames, "canFormFreshTypedGames");
  function freeRestAlternatives() {
    if (!standardFreeMode || !restNeeded || !fastStandardFree) return restOptions;
    let combinationTotal = 1;
    const choose = Math.min(restNeeded, queue.length - restNeeded);
    for (let index = 1; index <= choose; index++) combinationTotal = combinationTotal * (queue.length - choose + index) / index;
    let restingGroups;
    if (combinationTotal <= 5e3) {
      restingGroups = combinations(queue, restNeeded);
    } else {
      const base = restOptions[0].resting, baseSet = new Set(base), playing = queue.filter((name) => !baseSet.has(name));
      restingGroups = [base];
      for (const out of base) for (const into of playing) restingGroups.push(base.map((name) => name === out ? into : name));
    }
    const unique = /* @__PURE__ */ new Map();
    for (const resting of restingGroups) {
      const key = [...resting].sort().join("|");
      if (!unique.has(key) && fixedRestOK(resting)) unique.set(key, { resting, score: restScore(resting) });
    }
    return [...unique.values()].sort((a, b) => compareVector(a.score, b.score));
  }
  __name(freeRestAlternatives, "freeRestAlternatives");
  __name2(freeRestAlternatives, "freeRestAlternatives");
  const freeOptions = freeRestAlternatives();
  const fairnessLength = restNeeded === 1 ? 2 : 3;
  const bestFairness = freeOptions[0]?.score.slice(0, fairnessLength) || [];
  const equallyFair = standardFreeMode ? freeOptions.filter((option) => compareVector(option.score.slice(0, fairnessLength), bestFairness) === 0) : [];
  const fifoRestKey = [...restOptions[0]?.resting || []].sort().join("|");
  const matchedFifoRestOption = equallyFair.find((option) => [...option.resting].sort().join("|") === fifoRestKey);
  const fifoRestOption = matchedFifoRestOption ? { ...matchedFifoRestOption, resting: [...restOptions[0]?.resting || []] } : restOptions[0];
  const playingNeeded = Math.max(0, active.length - restNeeded);
  const fixedPairUniqueMode = fixedMate.size > 0 && formats.every((format) => format === "doubles") && types.every((type) => type === "free");
  const canRelaxForUniqueMatch = (standardFreeMode || fixedPairUniqueMode) && restNeeded > 0 && restNeeded >= playingNeeded;
  function doubleRestRotationScore(option) {
    const restingSet = new Set(option.resting);
    const projected = active.map(
      (name) => (doubleRestTurns[name] || 0) + Number(restingSet.has(name) && previousRest.has(name))
    );
    return [
      Math.max(...projected) - Math.min(...projected),
      Math.max(...projected),
      option.resting.reduce((sum, name) => sum + Number(previousRest.has(name)), 0),
      ...option.score
    ];
  }
  __name(doubleRestRotationScore, "doubleRestRotationScore");
  __name2(doubleRestRotationScore, "doubleRestRotationScore");
  const relaxedRestOptions = canRelaxForUniqueMatch ? freeOptions.filter((option) => option.resting.every((name) => !restedLastTwoRounds.has(name))).sort((a, b) => compareVector(doubleRestRotationScore(a), doubleRestRotationScore(b))) : [];
  const fifoRestingKey = [...fifoRestOption?.resting || []].sort().join("|");
  let prioritizedRestOptions = standardFreeMode ? [
    fifoRestOption,
    ...(canRelaxForUniqueMatch ? relaxedRestOptions : []).filter((option) => [...option.resting].sort().join("|") !== fifoRestingKey)
  ] : canRelaxForUniqueMatch && fixedMate.size > 0 ? [
    fifoRestOption,
    ...relaxedRestOptions.filter((option) => [...option.resting].sort().join("|") !== fifoRestingKey)
  ] : freeOptions;
  if (fastStandardMixed && restNeeded) {
    let combinationTotal = 1;
    const choose = Math.min(restNeeded, queue.length - restNeeded);
    for (let index = 1; index <= choose; index++) combinationTotal = combinationTotal * (queue.length - choose + index) / index;
    let groups;
    if (combinationTotal <= 5e3) groups = combinations(queue, restNeeded);
    else {
      const base = restOptions[0].resting, baseSet = new Set(base), playing = queue.filter((name) => !baseSet.has(name));
      groups = [base];
      for (const out of base) for (const into of playing) groups.push(base.map((name) => name === out ? into : name));
    }
    const mixedOptions = [], seen = /* @__PURE__ */ new Set();
    for (const resting of groups) {
      const key = [...resting].sort().join("|");
      if (seen.has(key) || !fixedRestOK(resting)) continue;
      seen.add(key);
      const set = new Set(resting), projected = active.map((name) => (restCount[name] || 0) + Number(set.has(name)));
      const genderSpreads = ["male", "female"].map((sex) => {
        const values = active.filter((name) => gender(name) === sex).map((name) => (restCount[name] || 0) + Number(set.has(name)));
        return values.length ? Math.max(...values) - Math.min(...values) : 0;
      });
      const globalSpread = projected.length ? Math.max(...projected) - Math.min(...projected) : 0;
      mixedOptions.push({ resting, score: [Math.max(globalSpread, ...genderSpreads), globalSpread + genderSpreads[0] + genderSpreads[1], projected.reduce((sum, value) => sum + value * value, 0), resting.reduce((sum, name) => sum + Number(previousRest.has(name)), 0), resting.reduce((sum, name) => sum + (qpos.get(name) ?? active.length), 0)] });
    }
    mixedOptions.sort((a, b) => compareVector(a.score, b.score));
    const best = mixedOptions[0]?.score.slice(0, 4) || [];
    const fair = mixedOptions.filter((option) => compareVector(option.score.slice(0, 4), best) === 0);
    const feasible = fair.find((option) => canFormFreshTypedGames(option.resting));
    prioritizedRestOptions = feasible ? [feasible, ...mixedOptions.filter((option) => option !== feasible)] : mixedOptions;
  }
  if (useBalancedBands && formats.every((format) => format === "doubles") && types.every((type) => type === "free")) {
    const totalTop = active.reduce((sum, name) => sum + Number(activeBand.get(name) === 1), 0);
    const structurallyValid = prioritizedRestOptions.filter((option) => {
      const restingTop = option.resting.reduce(
        (sum, name) => sum + Number(activeBand.get(name) === 1),
        0
      );
      return (totalTop - restingTop) % 2 === 0;
    });
    if (structurallyValid.length) prioritizedRestOptions = structurallyValid;
  }
  function typeGenderOK(pair1, pair2, format, type) {
    const names = [...pair1, ...pair2], men = names.filter((name) => gender(name) === "male").length, women = names.filter((name) => gender(name) === "female").length;
    if (format === "singles") {
      if (["md", "men", "singles-men"].includes(type)) return men === 2;
      if (["ld", "wd", "women", "ladies", "singles-women"].includes(type)) return women === 2;
      return true;
    }
    if (type === "md") return men === 4;
    if (type === "ld" || type === "wd") return women === 4;
    if (type === "xd") return men === 2 && women === 2 && pair1.filter((name) => gender(name) === "male").length === 1 && pair2.filter((name) => gender(name) === "male").length === 1;
    return true;
  }
  __name(typeGenderOK, "typeGenderOK");
  __name2(typeGenderOK, "typeGenderOK");
  function fixedOK(pair1, pair2, playingSet) {
    const court = /* @__PURE__ */ new Set([...pair1, ...pair2]);
    for (const player of court) {
      const mate = fixedMate.get(player);
      if (!mate || !playingSet.has(mate)) continue;
      if (!court.has(mate)) return false;
      if (!(pair1.includes(player) && pair1.includes(mate) || pair2.includes(player) && pair2.includes(mate))) return false;
    }
    return true;
  }
  __name(fixedOK, "fixedOK");
  __name2(fixedOK, "fixedOK");
  function hasFixedTeam(pair) {
    return pair.length === 2 && fixedMate.get(pair[0]) === pair[1];
  }
  __name(hasFixedTeam, "hasFixedTeam");
  __name2(hasFixedTeam, "hasFixedTeam");
  function solve(playing) {
    if (!useBalancedBands) playing = reorderStandardPlayingByFairness(playing, state.allRounds || []);
    const rankedPlaying = [...playing].sort((a, b) => rating(b) - rating(a) || String(a).localeCompare(String(b)));
    const playingHalf = Math.ceil(rankedPlaying.length / 2);
    const allSingles = formats.every((format) => format === "singles");
    const band = useBalancedBands ? suppliedBand ? activeBand : allSingles ? activeBand : new Map(rankedPlaying.map((name, index) => [name, index < playingHalf ? 1 : 0])) : new Map(playing.map((name) => [name, 0]));
    const playingSet = new Set(playing);
    if (fastStandardFree || fastBalancedFree) {
      let bounded = /* @__PURE__ */ __name(function(position, available, games, score, enforceReturningSpread = true) {
        if (++nodes2 > (fastBalancedFree ? 5e3 : 2500)) return;
        if (position === formats.length) {
          if (!best2 || compareVector(score, best2.score) < 0) best2 = { score, games: [...games] };
          return;
        }
        if (best2 && compareVector(score, best2.score) >= 0) return;
        for (const candidate of candidates) {
          if (!candidate.players.every((name) => available.has(name))) continue;
          const returningOnCourt = candidate.players.reduce(
            (sum, name) => sum + Number(returningRested.has(name)),
            0
          );
          if (enforceReturningSpread && returningOnCourt > maxReturningPerCourt) continue;
          const next = new Set(available);
          candidate.players.forEach((name) => next.delete(name));
          bounded(position + 1, next, [...games, candidate], score.map((value, index) => value + (candidate.score[index] || 0)), enforceReturningSpread);
          if (best2 && best2.score.every((value) => value === 0)) return;
          if (nodes2 > (fastBalancedFree ? 5e3 : 2500)) return;
        }
      }, "bounded");
      __name2(bounded, "bounded");
      const history = typeHistory[0];
      const returningRested = new Set(playing.filter((name) => previousRest.has(name)));
      const maxReturningPerCourt = Math.ceil(returningRested.size / Math.max(1, formats.length));
      const ordered = [...playing].sort(
        (a, b) => (history.counts[a] || 0) - (history.counts[b] || 0) || history.last[a] + 1 - (history.last[b] + 1) || (qpos.get(a) ?? active.length) - (qpos.get(b) ?? active.length)
      );
      const candidates = [];
      for (const group of combinations(ordered, 4)) {
        for (const [pair1, pair2] of [
          [[group[0], group[1]], [group[2], group[3]]],
          [[group[0], group[2]], [group[1], group[3]]],
          [[group[0], group[3]], [group[1], group[2]]]
        ]) {
          const sum1 = pair1.reduce((sum, name) => sum + band.get(name), 0);
          const sum2 = pair2.reduce((sum, name) => sum + band.get(name), 0);
          const balancedFallback = fastBalancedFree && sum1 !== sum2;
          const pairRepeats = (priorPairs.get(pkey(pair1[0], pair1[1])) || 0) + (priorPairs.get(pkey(pair2[0], pair2[1])) || 0);
          const opponentRepeats = pair1.reduce((sum, a) => sum + pair2.reduce((inner, b) => inner + (priorOpponents.get(pkey(a, b)) || 0), 0), 0);
          const completeRepeats = priorGames.get([pkey(pair1[0], pair1[1]), pkey(pair2[0], pair2[1])].sort().join(":")) || 0;
          const mixedPlayers = [pair1, pair2].filter((pair) => band.get(pair[0]) !== band.get(pair[1])).flat();
          const mixedGame = mixedPlayers.length === 4;
          const score = fastBalancedFree ? [
            Number(balancedFallback),
            pairRepeats,
            Number(mixedGame !== preferMixedBalancedRound),
            group.reduce((sum, name) => sum + Number(returningRested.has(name) && !mixedPlayers.includes(name)), 0),
            mixedPlayers.reduce((sum, name) => sum + (priorMixedPartners.get(name) || 0), 0),
            completeRepeats,
            opponentRepeats
          ] : [pairRepeats, opponentRepeats];
          candidates.push({ pair1, pair2, players: group, score, balancedFallback });
        }
      }
      candidates.sort((a, b) => compareVector(a.score, b.score));
      let best2 = null, nodes2 = 0;
      bounded(0, new Set(ordered), [], Array(fastBalancedFree ? 7 : 2).fill(0));
      if (fastBalancedFree && !best2) {
        nodes2 = 0;
        bounded(0, new Set(ordered), [], Array(7).fill(0), false);
      }
      if (fastBalancedFree && !best2) return null;
      const selected = best2?.games || ordered.reduce((games, _, index) => {
        if (index % 4) return games;
        const group = ordered.slice(index, index + 4);
        if (group.length === 4) games.push({ pair1: [group[0], group[1]], pair2: [group[2], group[3]] });
        return games;
      }, []);
      return selected.map((game, courtIndex) => ({
        court: courtIndex + 1,
        pair1: [...game.pair1],
        pair2: [...game.pair2],
        format: "doubles",
        courtType: "free",
        balanceMode: game.balancedFallback ? "standard-fallback" : "balanced"
      }));
    }
    if (fastStandardXD) {
      let boundedXd = /* @__PURE__ */ __name(function(position, available, games, score) {
        if (++nodes2 > 3e3) return;
        if (position === formats.length) {
          if (!best2 || compareVector(score, best2.score) < 0) best2 = { score, games: [...games] };
          return;
        }
        if (best2 && compareVector(score, best2.score) >= 0) return;
        for (const candidate of candidates) {
          if (!candidate.players.every((name) => available.has(name))) continue;
          const next = new Set(available);
          candidate.players.forEach((name) => next.delete(name));
          boundedXd(position + 1, next, [...games, candidate], score.map((value, index) => value + (candidate.score[index] || 0)));
          if (best2 && best2.score.every((value) => value === 0)) return;
          if (nodes2 > 3e3) return;
        }
      }, "boundedXd");
      __name2(boundedXd, "boundedXd");
      const men = playing.filter((name) => gender(name) === "male");
      const women = playing.filter((name) => gender(name) === "female");
      const candidates = [];
      for (const maleGroup of combinations(men, 2)) for (const femaleGroup of combinations(women, 2)) {
        for (const [pair1, pair2] of [
          [[maleGroup[0], femaleGroup[0]], [maleGroup[1], femaleGroup[1]]],
          [[maleGroup[0], femaleGroup[1]], [maleGroup[1], femaleGroup[0]]]
        ]) {
          const pairRepeats = (priorPairs.get(pkey(pair1[0], pair1[1])) || 0) + (priorPairs.get(pkey(pair2[0], pair2[1])) || 0);
          const opponentRepeats = pair1.reduce((sum, a) => sum + pair2.reduce((inner, b) => inner + (priorOpponents.get(pkey(a, b)) || 0), 0), 0);
          candidates.push({ pair1, pair2, players: [...maleGroup, ...femaleGroup], score: [pairRepeats, opponentRepeats] });
        }
      }
      candidates.sort((a, b) => compareVector(a.score, b.score));
      let best2 = null, nodes2 = 0;
      boundedXd(0, new Set(playing), [], [0, 0]);
      if (!best2) return null;
      return best2.games.map((game, courtIndex) => ({
        court: courtIndex + 1,
        pair1: [...game.pair1],
        pair2: [...game.pair2],
        format: "doubles",
        courtType: "xd"
      }));
    }
    if (fastStandardMixed && types.length === 3 && types.filter((type) => type === "md").length === 1 && types.filter((type) => type === "ld" || type === "wd").length === 1 && types.filter((type) => type === "xd").length === 1) {
      const mdIndex = types.indexOf("md");
      const ldIndex = types.findIndex((type) => type === "ld" || type === "wd");
      const xdIndex = types.indexOf("xd");
      const men = playing.filter((name) => gender(name) === "male");
      const women = playing.filter((name) => gender(name) === "female");
      if (men.length !== 6 || women.length !== 6) return null;
      const projectedSpread = /* @__PURE__ */ __name2((pool, history, selected) => {
        const set = new Set(selected);
        const values = pool.map((name) => (history.counts[name] || 0) + Number(set.has(name)));
        return Math.max(...values) - Math.min(...values);
      }, "projectedSpread");
      let allocation = null;
      const allMen = active.filter((name) => gender(name) === "male");
      const allWomen = active.filter((name) => gender(name) === "female");
      for (const mdPlayers of combinations(men, 4)) {
        const mdSet = new Set(mdPlayers), xdMen = men.filter((name) => !mdSet.has(name));
        for (const ldPlayers of combinations(women, 4)) {
          const ldSet = new Set(ldPlayers), xdWomen = women.filter((name) => !ldSet.has(name));
          const xdPlayers = [...xdMen, ...xdWomen];
          const spreads = [
            projectedSpread(allMen, typeHistory[mdIndex], mdPlayers),
            projectedSpread(allWomen, typeHistory[ldIndex], ldPlayers),
            projectedSpread(allMen, typeHistory[xdIndex], xdMen),
            projectedSpread(allWomen, typeHistory[xdIndex], xdWomen)
          ];
          const score = [Math.max(...spreads), spreads.reduce((sum, value) => sum + value, 0)];
          if (!allocation || compareVector(score, allocation.score) < 0) allocation = { score, mdPlayers, ldPlayers, xdMen, xdWomen, xdPlayers };
        }
      }
      if (!allocation) return null;
      const bestSameGenderGame = /* @__PURE__ */ __name2((group) => {
        const arrangements = [
          [[group[0], group[1]], [group[2], group[3]]],
          [[group[0], group[2]], [group[1], group[3]]],
          [[group[0], group[3]], [group[1], group[2]]]
        ];
        return arrangements.map(([pair1, pair2]) => ({ pair1, pair2, score: [
          (priorPairs.get(pkey(pair1[0], pair1[1])) || 0) + (priorPairs.get(pkey(pair2[0], pair2[1])) || 0),
          pair1.reduce((sum, a) => sum + pair2.reduce((inner, b) => inner + (priorOpponents.get(pkey(a, b)) || 0), 0), 0)
        ] })).sort((a, b) => compareVector(a.score, b.score))[0];
      }, "bestSameGenderGame");
      const mdGame = bestSameGenderGame(allocation.mdPlayers);
      const ldGame = bestSameGenderGame(allocation.ldPlayers);
      const xdArrangements = [
        [[allocation.xdMen[0], allocation.xdWomen[0]], [allocation.xdMen[1], allocation.xdWomen[1]]],
        [[allocation.xdMen[0], allocation.xdWomen[1]], [allocation.xdMen[1], allocation.xdWomen[0]]]
      ];
      const xdGame = xdArrangements.map(([pair1, pair2]) => ({ pair1, pair2, score: [
        (priorPairs.get(pkey(pair1[0], pair1[1])) || 0) + (priorPairs.get(pkey(pair2[0], pair2[1])) || 0),
        pair1.reduce((sum, a) => sum + pair2.reduce((inner, b) => inner + (priorOpponents.get(pkey(a, b)) || 0), 0), 0)
      ] })).sort((a, b) => compareVector(a.score, b.score))[0];
      const games = [];
      games[mdIndex] = { court: mdIndex + 1, pair1: mdGame.pair1, pair2: mdGame.pair2, format: "doubles", courtType: "md" };
      games[ldIndex] = { court: ldIndex + 1, pair1: ldGame.pair1, pair2: ldGame.pair2, format: "doubles", courtType: types[ldIndex] };
      games[xdIndex] = { court: xdIndex + 1, pair1: xdGame.pair1, pair2: xdGame.pair2, format: "doubles", courtType: "xd" };
      return games;
    }
    const courtCandidates = formats.map((format, courtIndex) => {
      const size = format === "singles" ? 2 : 4, output = [];
      for (const group of combinations(playing, size)) {
        if (format === "singles") {
          const pair1 = [group[0]], pair2 = [group[1]];
          if (fixedMate.has(group[0]) || fixedMate.has(group[1])) continue;
          if (useBalancedBands && band.get(group[0]) !== band.get(group[1]) || !typeGenderOK(pair1, pair2, format, types[courtIndex])) continue;
          output.push({ pair1, pair2, players: group });
        } else {
          const arrangements = [[[group[0], group[1]], [group[2], group[3]]], [[group[0], group[2]], [group[1], group[3]]], [[group[0], group[3]], [group[1], group[2]]]];
          for (const [pair1, pair2] of arrangements) {
            if (!fixedOK(pair1, pair2, playingSet) || !typeGenderOK(pair1, pair2, format, types[courtIndex])) continue;
            const sum1 = pair1.reduce((sum, name) => sum + band.get(name), 0), sum2 = pair2.reduce((sum, name) => sum + band.get(name), 0);
            if (useBalancedBands && !hasFixedTeam(pair1) && !hasFixedTeam(pair2) && sum1 !== sum2) continue;
            output.push({ pair1: [...pair1], pair2: [...pair2], players: group });
          }
        }
      }
      const history = typeHistory[courtIndex];
      for (const candidate of output) {
        const names = [...candidate.pair1, ...candidate.pair2];
        const maximumAppearances = Math.max(...names.map((name) => history.counts[name] || 0));
        const appearances = names.reduce((sum, name) => sum + (history.counts[name] || 0), 0);
        const recency = names.reduce((sum, name) => sum + (history.last[name] + 1), 0);
        const completeRepeats = candidate.pair1.length === 2 ? priorGames.get([pkey(candidate.pair1[0], candidate.pair1[1]), pkey(candidate.pair2[0], candidate.pair2[1])].sort().join(":")) || 0 : 0;
        const pairRepeats = candidate.pair1.length === 2 ? (priorPairs.get(pkey(candidate.pair1[0], candidate.pair1[1])) || 0) + (priorPairs.get(pkey(candidate.pair2[0], candidate.pair2[1])) || 0) : 0;
        const nonFixedPairRepeats = candidate.pair1.length === 2 ? (hasFixedTeam(candidate.pair1) ? 0 : priorPairs.get(pkey(candidate.pair1[0], candidate.pair1[1])) || 0) + (hasFixedTeam(candidate.pair2) ? 0 : priorPairs.get(pkey(candidate.pair2[0], candidate.pair2[1])) || 0) : 0;
        const opponentRepeats = [...candidate.pair1].reduce((sum, a) => sum + candidate.pair2.reduce((inner, b) => inner + (priorOpponents.get(pkey(a, b)) || 0), 0), 0);
        const mixedPlayers = candidate.pair1.length === 2 ? [candidate.pair1, candidate.pair2].filter((pair) => band.get(pair[0]) !== band.get(pair[1])).flat() : [];
        const mixedGame = candidate.pair1.length === 2 && mixedPlayers.length === 4;
        const balancedPatternPenalty = useBalancedBands && candidate.pair1.length === 2 ? Number(mixedGame !== preferMixedBalancedRound) : 0;
        const returningPlayerMissesMixed = useBalancedBands && candidate.pair1.length === 2 ? [...candidate.pair1, ...candidate.pair2].reduce((sum, name) => sum + Number(previousRest.has(name) && !mixedPlayers.includes(name)), 0) : 0;
        const mixedOpportunityCost = useBalancedBands ? mixedPlayers.reduce((sum, name) => sum + (priorMixedPartners.get(name) || 0), 0) : 0;
        candidate.score = candidate.pair1.length === 1 ? [
          maximumAppearances,
          appearances,
          priorSinglesMeetings.get(singlesTypeKey(types[courtIndex]) + ":" + pkey(candidate.pair1[0], candidate.pair2[0])) || 0,
          combinedRoundRobin.get(singlesTypeKey(types[courtIndex]))?.get(pkey(candidate.pair1[0], candidate.pair2[0])) ?? 1e5,
          recency,
          0,
          0
        ] : useBalancedBands ? [nonFixedPairRepeats, balancedPatternPenalty, returningPlayerMissesMixed, mixedOpportunityCost, completeRepeats, maximumAppearances, appearances, recency, pairRepeats, opponentRepeats] : [nonFixedPairRepeats, completeRepeats, maximumAppearances, appearances, recency, pairRepeats, opponentRepeats];
      }
      return output.sort((a, b) => compareVector(a.score, b.score));
    });
    const order = formats.map((_, index) => index).sort((a, b) => courtCandidates[a].length - courtCandidates[b].length);
    const scoreLength = useBalancedBands ? 10 : 7;
    const suffixMinimum = Array(order.length + 1).fill(null).map(() => Array(scoreLength).fill(0));
    for (let position = order.length - 1; position >= 0; position--) {
      const minimum = courtCandidates[order[position]][0]?.score || [0, 0, 0, 0];
      suffixMinimum[position] = suffixMinimum[position + 1].map((value, index) => value + (minimum[index] || 0));
    }
    let best = null, nodes = 0;
    function mixedCompletionScore(games, fallbackScore) {
      if (!fastStandardMixed) return fallbackScore;
      const spreads = [];
      for (const type of [...new Set(types)]) {
        const courtIndex = types.indexOf(type);
        const history = typeHistory[courtIndex];
        const eligible = active.filter(
          (name) => type === "free" || type === "md" && gender(name) === "male" || (type === "ld" || type === "wd") && gender(name) === "female" || type === "xd"
        );
        const selected = new Set(games.filter((game) => game.courtType === type).flatMap((game) => [...game.pair1, ...game.pair2]));
        const projected = eligible.map((name) => (history.counts[name] || 0) + Number(selected.has(name)));
        if (projected.length) spreads.push(Math.max(...projected) - Math.min(...projected));
      }
      return [Math.max(0, ...spreads), spreads.reduce((sum, value) => sum + value, 0), ...fallbackScore];
    }
    __name(mixedCompletionScore, "mixedCompletionScore");
    __name2(mixedCompletionScore, "mixedCompletionScore");
    function dfs(position, available, games, score) {
      if (++nodes > 1e6) return;
      if (best && fixedMate.size > 0 && best.score[0] === 0 && best.score[1] === 0) return;
      if (best && fastStandardMixed && best.score[2] === 0 && best.score[3] === 0) return;
      if (best && !useBalancedBands && !fastStandardMixed && fixedMate.size === 0) return;
      if (best && !fastStandardMixed) {
        const lowerBound = score.map((value, index) => value + (suffixMinimum[position][index] || 0));
        if (compareVector(lowerBound, best.score) >= 0) return;
      }
      if (position === order.length) {
        const completeScore = mixedCompletionScore(games, score);
        if (!best || compareVector(completeScore, best.score) < 0) best = { score: completeScore, games: [...games].sort((a, b) => a.court - b.court) };
        return;
      }
      const courtIndex = order[position];
      for (const candidate of courtCandidates[courtIndex]) {
        if (!candidate.players.every((name) => available.has(name))) continue;
        const next = new Set(available);
        candidate.players.forEach((name) => next.delete(name));
        dfs(position + 1, next, [...games, { court: courtIndex + 1, pair1: candidate.pair1, pair2: candidate.pair2, format: formats[courtIndex], courtType: types[courtIndex] }], score.map((value, index) => value + (candidate.score[index] || 0)));
      }
    }
    __name(dfs, "dfs");
    __name2(dfs, "dfs");
    dfs(0, new Set(playing), [], useBalancedBands ? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] : [0, 0, 0, 0, 0, 0, 0]);
    return best?.games || null;
  }
  __name(solve, "solve");
  __name2(solve, "solve");
  let bestSinglesResult = null;
  let bestSinglesScore = null;
  let bestFixedResult = null;
  let bestFixedScore = null;
  let bestStandardFreeResult = null;
  let bestStandardFreeScore = null;
  const bestSinglesRestScore = (prioritizedRestOptions[0]?.score || []).slice(0, 3);
  for (const option of prioritizedRestOptions) {
    if (standardPath === "singles" && compareVector(option.score.slice(0, 3), bestSinglesRestScore) !== 0) continue;
    const restSet = new Set(option.resting), playing = active.filter((name) => !restSet.has(name));
    const games = solve(playing);
    if (!games) continue;
    const result = { round: (state.roundIndex || 0) + 1, resting: option.resting.map((name) => `${name}#${(restCount[name] || 0) + 1}`), playing, games };
    if (updatedRestQueue) result.updatedRestQueue = updatedRestQueue;
    if (useBalancedBands) {
      const ranked = [...playing].sort((a, b) => rating(b) - rating(a) || String(a).localeCompare(String(b)));
      const half = Math.ceil(ranked.length / 2);
      const singlesOnly = formats.every((format) => format === "singles");
      result.balancedBands = Object.fromEntries(ranked.map((name, index) => [
        name,
        suppliedBand || singlesOnly ? activeBand.get(name) : index < half ? 1 : 0
      ]));
    }
    if (standardPath === "singles") {
      const repeatOpponents = games.reduce((sum, game) => sum + (priorOpponents.get(pkey(game.pair1[0], game.pair2[0])) || 0), 0);
      const opportunityMaximum = games.reduce((sum, game) => {
        const courtIndex = Math.max(0, Number(game.court || 1) - 1);
        const history = typeHistory[courtIndex];
        return sum + Math.max(...[...game.pair1, ...game.pair2].map((name) => history.counts[name] || 0));
      }, 0);
      const score = [repeatOpponents, opportunityMaximum, ...option.score.slice(3)];
      if (!bestSinglesResult || compareVector(score, bestSinglesScore) < 0) {
        bestSinglesResult = result;
        bestSinglesScore = score;
      }
      if (repeatOpponents === 0) break;
      continue;
    }
    if (standardFreeMode && fixedMate.size === 0) {
      const playerGroupRepeats = games.reduce((sum, game) => {
        if (game.pair1.length !== 2 || game.pair2.length !== 2) return sum;
        const key = [...game.pair1, ...game.pair2].slice().sort().join("&");
        return sum + (priorPlayerGroups.get(key) || 0);
      }, 0);
      const pairRepeats = games.reduce((sum, game) => sum + [game.pair1, game.pair2].reduce(
        (pairSum, pair) => pairSum + (pair.length === 2 ? priorPairs.get(pkey(pair[0], pair[1])) || 0 : 0),
        0
      ), 0);
      const completeRepeats = games.reduce((sum, game) => {
        if (game.pair1.length !== 2 || game.pair2.length !== 2) return sum;
        const key = [pkey(game.pair1[0], game.pair1[1]), pkey(game.pair2[0], game.pair2[1])].sort().join(":");
        return sum + (priorGames.get(key) || 0);
      }, 0);
      const opponentRepeats = games.reduce((sum, game) => sum + game.pair1.reduce(
        (outer, a) => outer + game.pair2.reduce((inner, b) => inner + (priorOpponents.get(pkey(a, b)) || 0), 0),
        0
      ), 0);
      const score = [playerGroupRepeats, pairRepeats, completeRepeats, opponentRepeats];
      const hardScore = score.slice(0, 3);
      const bestHardScore = bestStandardFreeScore?.slice(0, 3);
      if (!bestStandardFreeResult || compareVector(hardScore, bestHardScore) < 0) {
        bestStandardFreeResult = result;
        bestStandardFreeScore = score;
      }
      if (playerGroupRepeats === 0 && pairRepeats === 0 && completeRepeats === 0) break;
      continue;
    }
    if (fixedMate.size > 0 && (!useBalancedBands || canRelaxForUniqueMatch)) {
      const restSetForScore = new Set(option.resting);
      const projected = active.map((name) => (restCount[name] || 0) + Number(restSetForScore.has(name)));
      const restSpread = Math.max(...projected) - Math.min(...projected);
      const consecutiveRest = option.resting.reduce((sum, name) => sum + Number(previousRest.has(name)), 0);
      const playerGroupRepeats = games.reduce((sum, game) => {
        if (game.pair1.length !== 2 || game.pair2.length !== 2) return sum;
        const key = [...game.pair1, ...game.pair2].slice().sort().join("&");
        return sum + (priorPlayerGroups.get(key) || 0);
      }, 0);
      const completeRepeats = games.reduce((sum, game) => {
        if (game.pair1.length !== 2 || game.pair2.length !== 2) return sum;
        const key = [pkey(game.pair1[0], game.pair1[1]), pkey(game.pair2[0], game.pair2[1])].sort().join(":");
        return sum + (priorGames.get(key) || 0);
      }, 0);
      const nonFixedPairRepeats = games.reduce((sum, game) => sum + [game.pair1, game.pair2].reduce((pairSum, pair) => {
        if (pair.length !== 2 || hasFixedTeam(pair)) return pairSum;
        return pairSum + (priorPairs.get(pkey(pair[0], pair[1])) || 0);
      }, 0), 0);
      const squares = projected.reduce((sum, value) => sum + value * value, 0);
      const fifo = option.resting.reduce((sum, name) => sum + (qpos.get(name) ?? active.length), 0);
      const score = canRelaxForUniqueMatch ? [playerGroupRepeats, ...doubleRestRotationScore(option), completeRepeats, nonFixedPairRepeats, restSpread, squares, fifo] : [consecutiveRest, completeRepeats, nonFixedPairRepeats, restSpread, squares, fifo];
      if (!bestFixedResult || compareVector(score, bestFixedScore) < 0) {
        bestFixedResult = result;
        bestFixedScore = score;
      }
      if (playerGroupRepeats === 0 && completeRepeats === 0 && nonFixedPairRepeats === 0) break;
      continue;
    }
    return result;
  }
  if (bestSinglesResult) return bestSinglesResult;
  if (bestFixedResult) return bestFixedResult;
  if (bestStandardFreeResult) return bestStandardFreeResult;
  throw new Error(`No valid ${useBalancedBands ? "Balanced" : "Standard"} round satisfies the selected formats, FIFO, eligibility and fixed-pair rules`);
}
__name(sharedRoundStrict, "sharedRoundStrict");
__name2(sharedRoundStrict, "sharedRoundStrict");
function reorderStandardPlayingByFairness(playing, allRounds) {
  const original = new Map((playing || []).map((name, index) => [name, index]));
  const sharedGames = new Map((playing || []).map((name) => [name, /* @__PURE__ */ new Set()]));
  const partners = new Map((playing || []).map((name) => [name, /* @__PURE__ */ new Set()]));
  const gamesPlayed = new Map((playing || []).map((name) => [name, 0]));
  const poolSet = new Set(playing || []);
  for (const round of allRounds || []) for (const game of round?.games || []) {
    const left = game?.pair1 || [], right = game?.pair2 || [];
    const names = [...left, ...right].filter((name) => poolSet.has(name));
    for (const name of names) gamesPlayed.set(name, (gamesPlayed.get(name) || 0) + 1);
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      sharedGames.get(names[i])?.add(names[j]);
      sharedGames.get(names[j])?.add(names[i]);
    }
    for (const pair of [left, right]) {
      if (pair.length !== 2 || !poolSet.has(pair[0]) || !poolSet.has(pair[1])) continue;
      partners.get(pair[0])?.add(pair[1]);
      partners.get(pair[1])?.add(pair[0]);
    }
  }
  const possible = Math.max(0, (playing || []).length - 1);
  return [...playing || []].sort((a, b) => possible - (sharedGames.get(b)?.size || 0) - (possible - (sharedGames.get(a)?.size || 0)) || possible - (partners.get(b)?.size || 0) - (possible - (partners.get(a)?.size || 0)) || (gamesPlayed.get(a) || 0) - (gamesPlayed.get(b) || 0) || (original.get(a) || 0) - (original.get(b) || 0));
}
__name(reorderStandardPlayingByFairness, "reorderStandardPlayingByFairness");
__name2(reorderStandardPlayingByFairness, "reorderStandardPlayingByFairness");
function standardFreeDoublesRound(state) {
  return sharedRoundStrict(state, false, "free");
}
__name(standardFreeDoublesRound, "standardFreeDoublesRound");
__name2(standardFreeDoublesRound, "standardFreeDoublesRound");
function standardXdDoublesRound(state) {
  return sharedRoundStrict(state, false, "xd");
}
__name(standardXdDoublesRound, "standardXdDoublesRound");
__name2(standardXdDoublesRound, "standardXdDoublesRound");
function standardMixedTypedDoublesRound(state) {
  return sharedRoundStrict(state, false, "typed");
}
__name(standardMixedTypedDoublesRound, "standardMixedTypedDoublesRound");
__name2(standardMixedTypedDoublesRound, "standardMixedTypedDoublesRound");
function standardCombinedRound(state) {
  const courtCount = state.numCourts || 0;
  const formats = Array.from({ length: courtCount }, (_, index) => String((state.courtFormats || [])[index] || "doubles").toLowerCase());
  if (!formats.includes("doubles") || !formats.includes("singles")) {
    throw new Error("Standard Combined requires at least one Doubles court and one Singles court");
  }
  return sharedRoundStrict(state, false, "combined");
}
__name(standardCombinedRound, "standardCombinedRound");
__name2(standardCombinedRound, "standardCombinedRound");
function standardSinglesRound(state) {
  const courtCount = state.numCourts || 0;
  const formats = Array.from({ length: courtCount }, (_, index) => String((state.courtFormats || [])[index] || "doubles").toLowerCase());
  if (!formats.every((format) => format === "singles")) {
    throw new Error("Standard Singles requires every selected court to use the Singles format");
  }
  const active = [...state.activeplayers || []];
  const allPlayers = state.allPlayers || [];
  const types = Array.from({ length: courtCount }, (_, index) => String((state.courtTypes || [])[index] || "free").toLowerCase());
  const seats = courtCount * 2;
  if (active.length < seats) throw new Error("Not enough active players for the selected Singles courts");
  const gender = /* @__PURE__ */ __name2((name) => String(getGender(name, allPlayers) || "").toLowerCase(), "gender");
  const eligible = /* @__PURE__ */ __name2((name, type) => {
    if (["md", "men", "singles-men"].includes(type)) return gender(name) === "male";
    if (["ld", "wd", "women", "ladies", "singles-women"].includes(type)) return gender(name) === "female";
    return true;
  }, "eligible");
  const choose = /* @__PURE__ */ __name2((items, needed, start = 0, picked = [], output = []) => {
    if (picked.length === needed) {
      output.push([...picked]);
      return output;
    }
    for (let index = start; index <= items.length - (needed - picked.length); index++) {
      picked.push(items[index]);
      choose(items, needed, index + 1, picked, output);
      picked.pop();
    }
    return output;
  }, "choose");
  const restCount = state.restCount || {};
  const previousRest = new Set((state.allRounds?.at(-1)?.resting || []).map((raw) => String(raw).split("#")[0]));
  const queue = [
    ...(state.restQueue || []).filter((name, index, array) => active.includes(name) && array.indexOf(name) === index),
    ...active.filter((name) => !(state.restQueue || []).includes(name))
  ];
  const queuePosition = new Map(queue.map((name, index) => [name, index]));
  const typeKey = /* @__PURE__ */ __name2((type) => ["md", "men", "singles-men"].includes(type) ? "singles-men" : ["ld", "wd", "women", "ladies", "singles-women"].includes(type) ? "singles-women" : "singles-free", "typeKey");
  const appearances = Object.fromEntries(types.map((type) => [typeKey(type), Object.fromEntries(active.map((name) => [name, 0]))]));
  const meetings = /* @__PURE__ */ new Map();
  for (const round of state.allRounds || []) for (const game of round.games || []) {
    if ((game.pair1 || []).length !== 1 || (game.pair2 || []).length !== 1) continue;
    const historicalType = typeKey(String(game.courtType || "free").toLowerCase());
    if (!appearances[historicalType]) appearances[historicalType] = Object.fromEntries(active.map((name) => [name, 0]));
    const first = game.pair1[0], second = game.pair2[0];
    appearances[historicalType][first] = (appearances[historicalType][first] || 0) + 1;
    appearances[historicalType][second] = (appearances[historicalType][second] || 0) + 1;
    const key = historicalType + ":" + [first, second].sort().join("&");
    meetings.set(key, (meetings.get(key) || 0) + 1);
  }
  function roundRobinOrder(pool) {
    const rotation = [...pool].sort((a, b) => (queuePosition.get(a) ?? active.length) - (queuePosition.get(b) ?? active.length) || String(a).localeCompare(String(b)));
    if (rotation.length % 2) rotation.push(null);
    const order = /* @__PURE__ */ new Map();
    let sequence = 0;
    for (let round = 0; round < Math.max(0, rotation.length - 1); round++) {
      for (let index = 0; index < rotation.length / 2; index++) {
        const first = rotation[index], second = rotation[rotation.length - 1 - index];
        if (first && second) order.set([first, second].sort().join("&"), sequence++);
      }
      if (rotation.length > 2) rotation.splice(1, 0, rotation.pop());
    }
    return order;
  }
  __name(roundRobinOrder, "roundRobinOrder");
  __name2(roundRobinOrder, "roundRobinOrder");
  const roundRobin = {
    "singles-men": roundRobinOrder(active.filter((name) => gender(name) === "male")),
    "singles-women": roundRobinOrder(active.filter((name) => gender(name) === "female")),
    "singles-free": roundRobinOrder(active)
  };
  const compare = /* @__PURE__ */ __name2((left, right) => {
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
      if ((left[index] || 0) !== (right[index] || 0)) return (left[index] || 0) - (right[index] || 0);
    }
    return 0;
  }, "compare");
  const restNeeded = active.length - seats;
  let best = null;
  const restOptions = restNeeded ? choose(queue, restNeeded) : [[]];
  for (const resting of restOptions) {
    let search = /* @__PURE__ */ __name(function(position, available, games) {
      if (position === order.length) {
        const typeSpreads = [];
        for (const key of [...new Set(types.map(typeKey))]) {
          const selected = new Set(games.filter((game) => game.key === key).flatMap((game) => game.pair));
          const relevant = active.filter((name) => key === "singles-free" || eligible(name, key));
          const values = relevant.map((name) => (appearances[key]?.[name] || 0) + Number(selected.has(name)));
          if (values.length) typeSpreads.push(Math.max(...values) - Math.min(...values));
        }
        const opponentCounts = games.map((game) => meetings.get(game.key + ":" + game.pair.slice().sort().join("&")) || 0);
        const roundRobinPriority = games.reduce((sum, game) => sum + (roundRobin[game.key]?.get(game.pair.slice().sort().join("&")) ?? 1e5), 0);
        const score = [
          restSpread,
          consecutive,
          opponentCounts.reduce((sum, value) => sum + value, 0),
          Math.max(0, ...opponentCounts),
          roundRobinPriority,
          Math.max(0, ...typeSpreads),
          typeSpreads.reduce((sum, value) => sum + value, 0),
          restSquares,
          fifo
        ];
        if (!best || compare(score, best.score) < 0) best = { score, resting: [...resting], playing: [...playing], games: [...games] };
        return;
      }
      const courtIndex = order[position];
      for (const candidate of candidates[courtIndex]) {
        if (!candidate.pair.every((name) => available.has(name))) continue;
        const next = new Set(available);
        candidate.pair.forEach((name) => next.delete(name));
        search(position + 1, next, [...games, { court: courtIndex + 1, pair: candidate.pair, type: candidate.type, key: candidate.key }]);
      }
    }, "search");
    __name2(search, "search");
    const restSet = new Set(resting);
    const playing = active.filter((name) => !restSet.has(name));
    const projectedRest = active.map((name) => (restCount[name] || 0) + Number(restSet.has(name)));
    const restSpread = Math.max(...projectedRest) - Math.min(...projectedRest);
    const consecutive = resting.reduce((sum, name) => sum + Number(previousRest.has(name)), 0);
    const restSquares = projectedRest.reduce((sum, value) => sum + value * value, 0);
    const fifo = resting.reduce((sum, name) => sum + (queuePosition.get(name) ?? active.length), 0);
    const candidates = types.map((type) => {
      const pool = playing.filter((name) => eligible(name, type));
      return choose(pool, 2).map((pair) => ({ pair, type, key: typeKey(type) }));
    });
    if (candidates.some((list) => !list.length)) continue;
    const order = candidates.map((_, index) => index).sort((a, b) => candidates[a].length - candidates[b].length);
    search(0, new Set(playing), []);
  }
  if (!best) throw new Error("No valid Standard Singles round satisfies eligibility and resting rules");
  return {
    round: (state.roundIndex || 0) + 1,
    resting: best.resting.map((name) => `${name}#${(restCount[name] || 0) + 1}`),
    playing: best.playing,
    games: best.games.sort((a, b) => a.court - b.court).map((game) => ({
      court: game.court,
      pair1: [game.pair[0]],
      pair2: [game.pair[1]],
      format: "singles",
      courtType: game.type,
      isSingles: true
    }))
  };
}
__name(standardSinglesRound, "standardSinglesRound");
__name2(standardSinglesRound, "standardSinglesRound");
function standardRoundStrict(state) {
  const courtCount = state.numCourts || 0;
  const formats = Array.from({ length: courtCount }, (_, index) => String((state.courtFormats || [])[index] || "doubles").toLowerCase());
  const types = Array.from({ length: courtCount }, (_, index) => String((state.courtTypes || [])[index] || "free").toLowerCase());
  const allDoubles = formats.every((format) => format === "doubles");
  const allSingles = formats.every((format) => format === "singles");
  if (allSingles) return standardSinglesRound(state);
  if (allDoubles && types.every((type) => type === "free")) return standardFreeDoublesRound(state);
  if (allDoubles && types.every((type) => type === "xd")) return standardXdDoublesRound(state);
  if (allDoubles) return standardMixedTypedDoublesRound(state);
  return standardCombinedRound(state);
}
__name(standardRoundStrict, "standardRoundStrict");
__name2(standardRoundStrict, "standardRoundStrict");
function balancedRoundStrict(state) {
  return sharedRoundStrict(state, true);
}
__name(balancedRoundStrict, "balancedRoundStrict");
__name2(balancedRoundStrict, "balancedRoundStrict");
function restartGenerationCycleFromLatestRound(state) {
  const latest = Array.isArray(state.allRounds) && state.allRounds.length ? state.allRounds[state.allRounds.length - 1] : null;
  state.allRounds = latest ? [latest] : [];
  state.gamesMap = /* @__PURE__ */ new Set();
  state.pairPlayedSet = /* @__PURE__ */ new Set();
  state.fixedPairGameQueue = null;
  state.fixedPairGameQueueHash = null;
  for (const game of latest?.games || []) {
    if (!game?.pair1 || !game?.pair2) continue;
    const left = [...game.pair1].sort().join("&");
    const right = [...game.pair2].sort().join("&");
    state.gamesMap.add([left, right].sort().join(":"));
    if (game.pair1.length === 2) state.pairPlayedSet.add(pairKey(game.pair1[0], game.pair1[1]));
    if (game.pair2.length === 2) state.pairPlayedSet.add(pairKey(game.pair2[0], game.pair2[1]));
  }
}
__name(restartGenerationCycleFromLatestRound, "restartGenerationCycleFromLatestRound");
__name2(restartGenerationCycleFromLatestRound, "restartGenerationCycleFromLatestRound");
async function handleGenerateRound(request, env) {
  const req = await request.json();
  const restCount = Object.fromEntries(req.restCount || []);
  const opponentMap = Object.fromEntries((req.opponentMap || []).map(([p, inner]) => [p, Object.fromEntries(inner)]));
  const pairPlayedSet = new Set(req.pairPlayedSet || []);
  const gamesMap = new Set(req.gamesMap || []);
  const allRounds = req.allRounds || [];
  let lastRound = [];
  if (allRounds.length) {
    const last = allRounds[allRounds.length - 1];
    if (last?.games) lastRound = last.games.flatMap((g) => [...g.pair1 || [], ...g.pair2 || []]);
  }
  const state = {
    activeplayers: req.activeplayers || [],
    numCourts: req.numCourts,
    courts: req.courts || req.numCourts,
    fixedPairs: req.fixedPairs || [],
    restQueue: req.restQueue || [],
    restCount,
    opponentMap,
    pairPlayedSet,
    gamesMap,
    allRounds,
    playMode: req.playMode || "random",
    minRounds: req.minRounds || 6,
    lastMode: req.lastMode || null,
    allPlayers: req.allPlayers || [],
    roundIndex: req.roundIndex || 0,
    lastRound,
    fixedPairGameQueue: req.fixedPairGameQueue || null,
    fixedPairGameQueueHash: req.fixedPairGameQueueHash || null,
    courtTypes: req.courtTypes || [],
    courtFormats: req.courtFormats || [],
    standardGamesMode: req.standardGamesMode || false,
    balancedGamesMode: req.balancedGamesMode || req.gameGenerationMode === "balanced",
    gameGenerationMode: req.gameGenerationMode || (req.balancedGamesMode ? "balanced" : "standard"),
    frozenBalancedBands: req.balancedBands && typeof req.balancedBands === "object" ? req.balancedBands : null
  };
  if (req._mbmCall) {
    const waitQueue = req._mbmWaitQueue || [];
    const game = mbmBestGame(state.activeplayers, waitQueue, state);
    if (!game) return json({ error: "Not enough players" }, 400);
    return json({ games: [{ court: 1, pair1: game.pair1, pair2: game.pair2 }] });
  }
  const hasDoubleTypedCourts = (state.courtTypes || []).some(
    (type) => type === "MD" || type === "LD" || type === "WD" || type === "XD"
  );
  const hasSinglesCourts = (state.courtFormats || []).some((f) => f === "singles");
  const useComp = state.playMode === "competitive";
  const useBalanced = state.balancedGamesMode || state.gameGenerationMode === "balanced";
  const useRatingAware = useComp || useBalanced;
  if (useRatingAware && state.lastMode !== (useBalanced ? "balanced" : "competitive")) resetForCompetitive(state);
  let result = null;
  let fallbackUsed = false;
  let finalQc = { valid: false, hardFails: ["Round was not generated"] };
  for (let attempt = 0; attempt < 3; attempt++) {
    let roundFn;
    if (useBalanced) roundFn = balancedRoundStrict;
    else if (false) roundFn = useBalanced ? (state2) => generateBestBalancedTypedRound(state2, typedRound) : typedRound;
    else if (!useComp) roundFn = standardRoundStrict;
    else if (false) roundFn = useBalanced ? (state2) => generateBestBalancedTypedRound(state2, typedBestRound) : typedBestRound;
    else if (useBalanced) roundFn = generateBestBalancedRound;
    else if (useRatingAware) roundFn = competitiveRound;
    else roundFn = randomRound;
    try {
      result = roundFn(state);
    } catch (error) {
      if (!useBalanced && !useComp && attempt === 0) {
        restartGenerationCycleFromLatestRound(state);
        fallbackUsed = true;
        continue;
      }
      throw error;
    }
    const qc = validateRound(result, state);
    finalQc = qc;
    if (qc.valid) break;
    if (!useBalanced && !useComp && attempt === 0) {
      restartGenerationCycleFromLatestRound(state);
      fallbackUsed = true;
      result = null;
      continue;
    }
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
  if (!result) return json({ error: "Failed to generate round" }, 500);
  if (!finalQc.valid) {
    return json({
      error: "Unable to generate a valid round for the selected court formats",
      details: finalQc.hardFails || []
    }, 422);
  }
  return json({
    games: result.games,
    resting: result.resting,
    playing: result.playing,
    roundIndex: state.roundIndex,
    lastMode: useBalanced ? "balanced" : useComp ? "competitive" : "random",
    updatedPairPlayedSet: [...state.pairPlayedSet],
    updatedGamesMap: [...state.gamesMap],
    updatedOpponentMap: Object.entries(state.opponentMap).map(([p, inner]) => [p, Object.entries(inner)]),
    updatedFixedPairGameQueue: state.fixedPairGameQueue,
    updatedFixedPairGameQueueHash: state.fixedPairGameQueueHash,
    updatedRestQueue: result.updatedRestQueue || null,
    balancedBands: result.balancedBands || null,
    fallbackUsed
  });
}
__name(handleGenerateRound, "handleGenerateRound");
__name2(handleGenerateRound, "handleGenerateRound");
function lineAppUrl(env) {
  try {
    const url = new URL(env.LINE_APP_URL || "https://scs-app.com/");
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new Error("LINE_APP_URL must use HTTPS");
    }
    return url;
  } catch {
    return new URL("https://scs-app.com/");
  }
}
__name(lineAppUrl, "lineAppUrl");
__name2(lineAppUrl, "lineAppUrl");
function lineCallbackUrl(request, env) {
  if (env.LINE_CALLBACK_URL) return env.LINE_CALLBACK_URL;
  return new URL("/auth/line/callback", request.url).toString();
}
__name(lineCallbackUrl, "lineCallbackUrl");
__name2(lineCallbackUrl, "lineCallbackUrl");
function lineRedirect(env, key, value) {
  const target = lineAppUrl(env);
  target.hash = key + "=" + encodeURIComponent(String(value || "unknown"));
  return new Response(null, {
    status: 302,
    headers: {
      "Location": target.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer"
    }
  });
}
__name(lineRedirect, "lineRedirect");
__name2(lineRedirect, "lineRedirect");
function lineRandom(bytes = 24) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  let binary = "";
  for (const value of data) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(lineRandom, "lineRandom");
__name2(lineRandom, "lineRandom");
function readCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return part.slice(index + 1).trim();
    }
  }
  return null;
}
__name(readCookie, "readCookie");
__name2(readCookie, "readCookie");
function lineStateCookie(value, maxAge) {
  return "scs_line_state=" + encodeURIComponent(value || "") + "; Path=/auth/line; HttpOnly; Secure; SameSite=Lax; Max-Age=" + String(maxAge);
}
__name(lineStateCookie, "lineStateCookie");
__name2(lineStateCookie, "lineStateCookie");
function lineSafeNickname(value) {
  const nickname = String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60);
  return nickname || "LINE Player";
}
__name(lineSafeNickname, "lineSafeNickname");
__name2(lineSafeNickname, "lineSafeNickname");
async function lineVerifierHash(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(lineVerifierHash, "lineVerifierHash");
__name2(lineVerifierHash, "lineVerifierHash");
function lineValidHandoff(id, verifier) {
  return /^[a-f0-9-]{36}$/i.test(String(id || "")) && /^[A-Za-z0-9_-]{40,128}$/.test(String(verifier || ""));
}
__name(lineValidHandoff, "lineValidHandoff");
__name2(lineValidHandoff, "lineValidHandoff");
async function handleLineStart(request, env) {
  if (!env.LINE_CHANNEL_ID || !env.LINE_CHANNEL_SECRET || !env.TOKEN_SECRET) {
    return lineRedirect(env, "line_error", "not_configured");
  }
  const url = new URL(request.url);
  const handoffId = url.searchParams.get("handoff_id") || "";
  if (handoffId && !/^[a-f0-9-]{36}$/i.test(handoffId)) {
    return lineRedirect(env, "line_error", "invalid_handoff");
  }
  let verifierHash = "";
  if (handoffId) {
    try {
      const rows = await sbGet(
        env,
        "line_login_handoffs",
        "id=eq." + encodeURIComponent(handoffId) + "&status=eq.pending&select=id,verifier_hash,expires_at"
      );
      const handoff = rows && rows[0];
      if (!handoff || new Date(handoff.expires_at).getTime() <= Date.now()) {
        return lineRedirect(env, "line_error", "invalid_handoff");
      }
      verifierHash = handoff.verifier_hash;
    } catch {
      return lineRedirect(env, "line_error", "handoff_not_ready");
    }
  }
  const nonce = lineRandom(24);
  const stateSecret = env.LINE_STATE_SECRET || env.TOKEN_SECRET;
  const state = await signToken({
    purpose: "line_oauth_state",
    nonce,
    handoffId: handoffId || null,
    verifierHash: verifierHash || null,
    exp: Date.now() + 10 * 60 * 1e3
  }, stateSecret);
  const authorize = new URL("https://access.line.me/oauth2/v2.1/authorize");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", env.LINE_CHANNEL_ID);
  authorize.searchParams.set("redirect_uri", lineCallbackUrl(request, env));
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("scope", "openid profile");
  authorize.searchParams.set("nonce", nonce);
  return new Response(null, {
    status: 302,
    headers: {
      "Location": authorize.toString(),
      "Set-Cookie": lineStateCookie(state, 600),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer"
    }
  });
}
__name(handleLineStart, "handleLineStart");
__name2(handleLineStart, "handleLineStart");
async function handleLineHandoffCreate(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!env.TOKEN_SECRET) return json({ error: "Social login is not configured" }, 503);
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  const verifier = String(body.verifier || "");
  const deviceCode = String(body.deviceCode || "").toUpperCase();
  if (!lineValidHandoff(id, verifier) || !/^[A-HJ-NP-Z2-9]{8}$/.test(deviceCode)) {
    return json({ error: "Invalid handoff" }, 400);
  }
  try {
    await sbUpsert(env, "line_login_handoffs", {
      id,
      device_code: deviceCode,
      verifier_hash: await lineVerifierHash(verifier),
      status: "pending",
      account_id: null,
      completion_proof: null,
      created_at: (/* @__PURE__ */ new Date()).toISOString(),
      completed_at: null,
      expires_at: new Date(Date.now() + 10 * 60 * 1e3).toISOString()
    }, "id");
    return json({ ok: true });
  } catch {
    return json({ error: "iPhone app login is not ready yet." }, 503);
  }
}
__name(handleLineHandoffCreate, "handleLineHandoffCreate");
__name2(handleLineHandoffCreate, "handleLineHandoffCreate");
async function handleLineDevice(request, env) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const url = new URL(request.url);
  const code = String(url.searchParams.get("code") || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) return lineRedirect(env, "line_error", "invalid_handoff");
  try {
    const rows = await sbGet(
      env,
      "line_login_handoffs",
      "device_code=eq." + encodeURIComponent(code) + "&status=eq.pending&select=id,expires_at"
    );
    const handoff = rows && rows[0];
    if (!handoff || new Date(handoff.expires_at).getTime() <= Date.now()) {
      return lineRedirect(env, "line_error", "invalid_handoff");
    }
    const startUrl = new URL("/auth/line/start", request.url);
    startUrl.searchParams.set("handoff_id", handoff.id);
    return new Response(null, {
      status: 302,
      headers: { "Location": startUrl.toString(), "Cache-Control": "no-store" }
    });
  } catch {
    return lineRedirect(env, "line_error", "handoff_not_ready");
  }
}
__name(handleLineDevice, "handleLineDevice");
__name2(handleLineDevice, "handleLineDevice");
async function handleLineCallback(request, env) {
  const url = new URL(request.url);
  const clearCookie = lineStateCookie("", 0);
  if (url.searchParams.get("error")) {
    const returnedState = url.searchParams.get("state") || "";
    const state = await verifyToken(returnedState, env.LINE_STATE_SECRET || env.TOKEN_SECRET || "");
    if (state && state.handoffId) {
      await sbPatch(
        env,
        "line_login_handoffs",
        "id=eq." + encodeURIComponent(state.handoffId),
        { status: "cancelled" }
      ).catch(() => {
      });
    }
    const response = state && state.handoffId ? lineRedirect(env, "line_handoff", "cancelled") : lineRedirect(env, "line_error", "cancelled");
    response.headers.set("Set-Cookie", clearCookie);
    return response;
  }
  try {
    if (!env.LINE_CHANNEL_ID || !env.LINE_CHANNEL_SECRET || !env.TOKEN_SECRET) {
      throw new Error("not_configured");
    }
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    const cookieState = readCookie(request, "scs_line_state");
    if (!code || !returnedState) {
      throw new Error("invalid_state");
    }
    const stateSecret = env.LINE_STATE_SECRET || env.TOKEN_SECRET;
    const state = await verifyToken(returnedState, stateSecret);
    if (!state || state.purpose !== "line_oauth_state" || !state.nonce) {
      throw new Error("invalid_state");
    }
    if (!state.handoffId && (!cookieState || returnedState !== cookieState)) {
      throw new Error("invalid_state");
    }
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: lineCallbackUrl(request, env),
      client_id: env.LINE_CHANNEL_ID,
      client_secret: env.LINE_CHANNEL_SECRET
    });
    const tokenResponse = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString()
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData.id_token) throw new Error("token_exchange_failed");
    const verifyBody = new URLSearchParams({
      id_token: tokenData.id_token,
      client_id: env.LINE_CHANNEL_ID,
      nonce: state.nonce
    });
    const verifyResponse = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: verifyBody.toString()
    });
    const profile = await verifyResponse.json().catch(() => ({}));
    if (!verifyResponse.ok || !profile.sub) throw new Error("id_token_invalid");
    const lineUserId = String(profile.sub);
    const nickname = lineSafeNickname(profile.name);
    let accounts;
    try {
      accounts = await sbGet(
        env,
        "user_accounts",
        "line_user_id=eq." + encodeURIComponent(lineUserId) + "&select=id,nickname,email,gender,auth_provider,line_picture_url,line_nickname_confirmed"
      );
    } catch (error) {
      if (String(error.message || "").includes("line_user_id")) throw new Error("database_not_ready");
      throw error;
    }
    let account;
    if (accounts && accounts.length) {
      account = accounts[0];
      const updates = {
        line_display_name: nickname,
        line_picture_url: profile.picture || null,
        auth_provider: mergeAuthProvider(account.auth_provider, "line")
      };
      if (!account.email && profile.email) updates.email = String(profile.email).toLowerCase();
      await sbPatch(env, "user_accounts", "id=eq." + encodeURIComponent(account.id), updates);
      account = { ...account, ...updates };
    } else {
      const lineEmail = profile.email ? String(profile.email).trim().toLowerCase() : null;
      let emailAccounts = [];
      if (lineEmail) {
        emailAccounts = await sbGet(
          env,
          "user_accounts",
          "email=ilike." + encodeURIComponent(lineEmail) + "&select=id,nickname,email,gender,auth_provider,line_picture_url,line_nickname_confirmed&limit=1"
        );
      }
      if (emailAccounts && emailAccounts.length) {
        account = emailAccounts[0];
        const updates = {
          line_user_id: lineUserId,
          line_display_name: nickname,
          line_picture_url: profile.picture || null,
          line_nickname_confirmed: true,
          auth_provider: mergeAuthProvider(account.auth_provider, "line")
        };
        await sbPatch(env, "user_accounts", "id=eq." + encodeURIComponent(account.id), updates);
        account = { ...account, ...updates };
      } else {
        const created = await sbPost(env, "user_accounts", {
          user_id: "line:" + lineUserId,
          nickname,
          email: lineEmail,
          gender: null,
          password_hash: null,
          recovery_word: null,
          auth_provider: "line",
          line_user_id: lineUserId,
          line_display_name: nickname,
          line_picture_url: profile.picture || null,
          line_nickname_confirmed: false
        });
        account = created[0];
      }
    }
    const ticket = await signToken({
      purpose: "line_login_ticket",
      accountId: account.id,
      exp: Date.now() + 2 * 60 * 1e3
    }, env.TOKEN_SECRET);
    if (state.handoffId) {
      const rows = await sbGet(
        env,
        "line_login_handoffs",
        "id=eq." + encodeURIComponent(state.handoffId) + "&select=id,verifier_hash,status,expires_at"
      );
      const handoff = rows && rows[0];
      if (!handoff || handoff.status !== "pending" || new Date(handoff.expires_at).getTime() <= Date.now() || handoff.verifier_hash !== state.verifierHash) {
        throw new Error("invalid_handoff");
      }
      const completionProof = await signToken({
        purpose: "line_handoff_completion",
        handoffId: handoff.id,
        verifierHash: handoff.verifier_hash,
        accountId: account.id,
        exp: Date.now() + 10 * 60 * 1e3
      }, env.TOKEN_SECRET);
      await sbPatch(
        env,
        "line_login_handoffs",
        "id=eq." + encodeURIComponent(handoff.id),
        {
          status: "complete",
          account_id: String(account.id),
          completion_proof: completionProof,
          completed_at: (/* @__PURE__ */ new Date()).toISOString()
        }
      );
      const response2 = lineRedirect(env, "line_handoff", "complete");
      response2.headers.set("Set-Cookie", clearCookie);
      return response2;
    }
    const response = lineRedirect(env, "line_auth", ticket);
    response.headers.set("Set-Cookie", clearCookie);
    return response;
  } catch (error) {
    const known = /* @__PURE__ */ new Set([
      "not_configured",
      "invalid_state",
      "token_exchange_failed",
      "id_token_invalid",
      "database_not_ready",
      "invalid_handoff",
      "handoff_not_ready"
    ]);
    const code = known.has(error.message) ? error.message : "login_failed";
    const response = lineRedirect(env, "line_error", code);
    response.headers.set("Set-Cookie", clearCookie);
    return response;
  }
}
__name(handleLineCallback, "handleLineCallback");
__name2(handleLineCallback, "handleLineCallback");
async function handleLineHandoffStatus(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!env.TOKEN_SECRET) return json({ error: "Social login is not configured" }, 503);
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  const verifier = String(body.verifier || "");
  if (!lineValidHandoff(id, verifier)) return json({ error: "Invalid handoff" }, 400);
  const rows = await sbGet(
    env,
    "line_login_handoffs",
    "id=eq." + encodeURIComponent(id) + "&select=id,verifier_hash,status,account_id,completion_proof,expires_at"
  );
  const handoff = rows && rows[0];
  if (!handoff) return json({ status: "pending" });
  const verifierHash = await lineVerifierHash(verifier);
  if (handoff.verifier_hash !== verifierHash) return json({ error: "Invalid handoff" }, 403);
  if (new Date(handoff.expires_at).getTime() <= Date.now()) {
    await sbDelete(env, "line_login_handoffs", "id=eq." + encodeURIComponent(id)).catch(() => {
    });
    return json({ status: "expired" }, 410);
  }
  if (handoff.status === "cancelled") {
    await sbDelete(env, "line_login_handoffs", "id=eq." + encodeURIComponent(id)).catch(() => {
    });
    return json({ status: "cancelled" });
  }
  if (handoff.status !== "complete") return json({ status: "pending" });
  const proof = await verifyToken(handoff.completion_proof || "", env.TOKEN_SECRET);
  if (!proof || !["line_handoff_completion", "google_handoff_completion"].includes(proof.purpose) || proof.handoffId !== id || proof.verifierHash !== verifierHash || String(proof.accountId) !== String(handoff.account_id)) {
    return json({ error: "Invalid handoff proof" }, 403);
  }
  const provider = proof.provider === "google" || proof.purpose === "google_handoff_completion" ? "google" : "line";
  const ticket = await signToken({
    purpose: provider + "_login_ticket",
    accountId: proof.accountId,
    exp: Date.now() + 2 * 60 * 1e3
  }, env.TOKEN_SECRET);
  await sbDelete(env, "line_login_handoffs", "id=eq." + encodeURIComponent(id)).catch(() => {
  });
  return json({ status: "complete", ticket, provider });
}
__name(handleLineHandoffStatus, "handleLineHandoffStatus");
__name2(handleLineHandoffStatus, "handleLineHandoffStatus");
async function handleLineComplete(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!env.TOKEN_SECRET) return json({ error: "LINE Login is not configured" }, 503);
  const body = await request.json().catch(() => ({}));
  const payload = await verifyToken(body.ticket || "", env.TOKEN_SECRET);
  if (!payload || payload.purpose !== "line_login_ticket" || !payload.accountId) {
    return json({ error: "LINE login expired. Please try again." }, 401);
  }
  const rows = await sbGet(
    env,
    "user_accounts",
    "id=eq." + encodeURIComponent(payload.accountId) + "&select=id,nickname,email,gender,auth_provider,line_picture_url,line_nickname_confirmed"
  );
  if (!rows || !rows.length) return json({ error: "LINE account was not found." }, 404);
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
      authProvider: account.auth_provider || "line",
      picture: account.line_picture_url || null
    }
  });
}
__name(handleLineComplete, "handleLineComplete");
__name2(handleLineComplete, "handleLineComplete");
async function handleLineNickname(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!env.TOKEN_SECRET) return json({ error: "LINE Login is not configured" }, 503);
  const body = await request.json().catch(() => ({}));
  const payload = await verifyToken(body.ticket || "", env.TOKEN_SECRET);
  if (!payload || payload.purpose !== "line_login_ticket" || !payload.accountId) {
    return json({ error: "LINE login expired. Please try again." }, 401);
  }
  const nickname = String(body.nickname || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40);
  if (!nickname) return json({ error: "Please enter your player nickname." }, 400);
  const gender = String(body.gender || "");
  if (!["Male", "Female"].includes(gender)) {
    return json({ error: "Please select your gender." }, 400);
  }
  const rows = await sbPatch(
    env,
    "user_accounts",
    "id=eq." + encodeURIComponent(payload.accountId),
    { nickname, gender, line_nickname_confirmed: true },
    "return=representation"
  );
  const account = rows && rows[0];
  if (!account) return json({ error: "LINE account was not found." }, 404);
  return json({
    user: {
      id: account.id,
      nickname: account.nickname,
      displayName: account.nickname,
      email: account.email || null,
      gender: account.gender || gender,
      authProvider: account.auth_provider || "line",
      picture: account.line_picture_url || null
    }
  });
}
__name(handleLineNickname, "handleLineNickname");
__name2(handleLineNickname, "handleLineNickname");
function googleAppUrl(env) {
  try {
    const url = new URL(env.GOOGLE_APP_URL || env.LINE_APP_URL || "https://scs-app.com/");
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new Error("GOOGLE_APP_URL must use HTTPS");
    }
    return url;
  } catch {
    return new URL("https://scs-app.com/");
  }
}
__name(googleAppUrl, "googleAppUrl");
__name2(googleAppUrl, "googleAppUrl");
function googleCallbackUrl(request, env) {
  if (env.GOOGLE_CALLBACK_URL) return env.GOOGLE_CALLBACK_URL;
  return new URL("/auth/google/callback", request.url).toString();
}
__name(googleCallbackUrl, "googleCallbackUrl");
__name2(googleCallbackUrl, "googleCallbackUrl");
function googleRedirect(env, key, value) {
  const target = googleAppUrl(env);
  target.hash = key + "=" + encodeURIComponent(String(value || "unknown"));
  return new Response(null, {
    status: 302,
    headers: {
      "Location": target.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer"
    }
  });
}
__name(googleRedirect, "googleRedirect");
__name2(googleRedirect, "googleRedirect");
function googleStateCookie(value, maxAge) {
  return "scs_google_state=" + encodeURIComponent(value || "") + "; Path=/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=" + String(maxAge);
}
__name(googleStateCookie, "googleStateCookie");
__name2(googleStateCookie, "googleStateCookie");
function googleSafeDisplayName(value) {
  const name = String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60);
  return name || "Google Player";
}
__name(googleSafeDisplayName, "googleSafeDisplayName");
__name2(googleSafeDisplayName, "googleSafeDisplayName");
function mergeAuthProvider(existing, provider) {
  const providers = String(existing || "").split("_").map((value) => value.trim()).filter(Boolean);
  if (!providers.includes(provider)) providers.push(provider);
  return providers.length ? providers.join("_") : provider;
}
__name(mergeAuthProvider, "mergeAuthProvider");
__name2(mergeAuthProvider, "mergeAuthProvider");
async function handleGoogleStart(request, env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.TOKEN_SECRET) {
    return googleRedirect(env, "google_error", "not_configured");
  }
  const url = new URL(request.url);
  const handoffId = url.searchParams.get("handoff_id") || "";
  if (handoffId && !/^[a-f0-9-]{36}$/i.test(handoffId)) {
    return googleRedirect(env, "google_error", "invalid_handoff");
  }
  let verifierHash = "";
  if (handoffId) {
    try {
      const rows = await sbGet(
        env,
        "line_login_handoffs",
        "id=eq." + encodeURIComponent(handoffId) + "&status=eq.pending&select=id,verifier_hash,expires_at"
      );
      const handoff = rows && rows[0];
      if (!handoff || new Date(handoff.expires_at).getTime() <= Date.now()) {
        return googleRedirect(env, "google_error", "invalid_handoff");
      }
      verifierHash = handoff.verifier_hash;
    } catch {
      return googleRedirect(env, "google_error", "handoff_not_ready");
    }
  }
  const nonce = lineRandom(24);
  const state = await signToken({
    purpose: "google_oauth_state",
    nonce,
    handoffId: handoffId || null,
    verifierHash: verifierHash || null,
    exp: Date.now() + 10 * 60 * 1e3
  }, env.GOOGLE_STATE_SECRET || env.TOKEN_SECRET);
  const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", googleCallbackUrl(request, env));
  authorize.searchParams.set("scope", "openid profile email");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("nonce", nonce);
  return new Response(null, {
    status: 302,
    headers: {
      "Location": authorize.toString(),
      "Set-Cookie": googleStateCookie(state, 600),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer"
    }
  });
}
__name(handleGoogleStart, "handleGoogleStart");
__name2(handleGoogleStart, "handleGoogleStart");
async function handleGoogleDevice(request, env) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const url = new URL(request.url);
  const code = String(url.searchParams.get("code") || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) return googleRedirect(env, "google_error", "invalid_handoff");
  try {
    const rows = await sbGet(
      env,
      "line_login_handoffs",
      "device_code=eq." + encodeURIComponent(code) + "&status=eq.pending&select=id,expires_at"
    );
    const handoff = rows && rows[0];
    if (!handoff || new Date(handoff.expires_at).getTime() <= Date.now()) {
      return googleRedirect(env, "google_error", "invalid_handoff");
    }
    const startUrl = new URL("/auth/google/start", request.url);
    startUrl.searchParams.set("handoff_id", handoff.id);
    return new Response(null, {
      status: 302,
      headers: { "Location": startUrl.toString(), "Cache-Control": "no-store" }
    });
  } catch {
    return googleRedirect(env, "google_error", "handoff_not_ready");
  }
}
__name(handleGoogleDevice, "handleGoogleDevice");
__name2(handleGoogleDevice, "handleGoogleDevice");
async function handleGoogleCallback(request, env) {
  const url = new URL(request.url);
  const clearCookie = googleStateCookie("", 0);
  if (url.searchParams.get("error")) {
    const returnedState = url.searchParams.get("state") || "";
    const state = await verifyToken(returnedState, env.GOOGLE_STATE_SECRET || env.TOKEN_SECRET || "");
    if (state && state.handoffId) {
      await sbPatch(
        env,
        "line_login_handoffs",
        "id=eq." + encodeURIComponent(state.handoffId),
        { status: "cancelled" }
      ).catch(() => {
      });
    }
    const response = state && state.handoffId ? googleRedirect(env, "google_handoff", "cancelled") : googleRedirect(env, "google_error", "cancelled");
    response.headers.set("Set-Cookie", clearCookie);
    return response;
  }
  try {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.TOKEN_SECRET) {
      throw new Error("not_configured");
    }
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    const cookieState = readCookie(request, "scs_google_state");
    if (!code || !returnedState) throw new Error("invalid_state");
    const state = await verifyToken(returnedState, env.GOOGLE_STATE_SECRET || env.TOKEN_SECRET);
    if (!state || state.purpose !== "google_oauth_state" || !state.nonce) throw new Error("invalid_state");
    if (!state.handoffId && (!cookieState || returnedState !== cookieState)) throw new Error("invalid_state");
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: googleCallbackUrl(request, env),
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET
    });
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString()
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData.id_token) throw new Error("token_exchange_failed");
    const verifyUrl = new URL("https://oauth2.googleapis.com/tokeninfo");
    verifyUrl.searchParams.set("id_token", tokenData.id_token);
    const verifyResponse = await fetch(verifyUrl.toString(), { headers: { "Accept": "application/json" } });
    const profile = await verifyResponse.json().catch(() => ({}));
    const validIssuer = profile.iss === "https://accounts.google.com" || profile.iss === "accounts.google.com";
    if (!verifyResponse.ok || !profile.sub || profile.aud !== env.GOOGLE_CLIENT_ID || !validIssuer || profile.nonce !== state.nonce || Number(profile.exp || 0) * 1e3 <= Date.now()) {
      throw new Error("id_token_invalid");
    }
    const googleUserId = String(profile.sub);
    const email = profile.email && (profile.email_verified === true || profile.email_verified === "true") ? String(profile.email).trim().toLowerCase() : null;
    const displayName = googleSafeDisplayName(profile.name);
    let accounts;
    try {
      accounts = await sbGet(
        env,
        "user_accounts",
        "google_user_id=eq." + encodeURIComponent(googleUserId) + "&select=id,nickname,email,gender,auth_provider,google_picture_url,google_nickname_confirmed"
      );
    } catch (error) {
      if (String(error.message || "").includes("google_user_id")) throw new Error("database_not_ready");
      throw error;
    }
    let account;
    if (accounts && accounts.length) {
      account = accounts[0];
      const updates = {
        google_display_name: displayName,
        google_picture_url: profile.picture || null,
        auth_provider: mergeAuthProvider(account.auth_provider, "google")
      };
      if (!account.email && email) updates.email = email;
      await sbPatch(env, "user_accounts", "id=eq." + encodeURIComponent(account.id), updates);
      account = { ...account, ...updates };
    } else {
      let emailAccounts = [];
      if (email) {
        emailAccounts = await sbGet(
          env,
          "user_accounts",
          "email=ilike." + encodeURIComponent(email) + "&select=id,nickname,email,gender,auth_provider,google_picture_url,google_nickname_confirmed&limit=1"
        );
      }
      if (emailAccounts && emailAccounts.length) {
        account = emailAccounts[0];
        const updates = {
          google_user_id: googleUserId,
          google_display_name: displayName,
          google_picture_url: profile.picture || null,
          google_nickname_confirmed: true,
          auth_provider: mergeAuthProvider(account.auth_provider, "google")
        };
        await sbPatch(env, "user_accounts", "id=eq." + encodeURIComponent(account.id), updates);
        account = { ...account, ...updates };
      } else {
        const created = await sbPost(env, "user_accounts", {
          user_id: "google:" + googleUserId,
          nickname: displayName,
          email,
          gender: null,
          password_hash: null,
          recovery_word: null,
          auth_provider: "google",
          google_user_id: googleUserId,
          google_display_name: displayName,
          google_picture_url: profile.picture || null,
          google_nickname_confirmed: false
        });
        account = created[0];
      }
    }
    const ticket = await signToken({
      purpose: "google_login_ticket",
      accountId: account.id,
      exp: Date.now() + 2 * 60 * 1e3
    }, env.TOKEN_SECRET);
    if (state.handoffId) {
      const rows = await sbGet(
        env,
        "line_login_handoffs",
        "id=eq." + encodeURIComponent(state.handoffId) + "&select=id,verifier_hash,status,expires_at"
      );
      const handoff = rows && rows[0];
      if (!handoff || handoff.status !== "pending" || new Date(handoff.expires_at).getTime() <= Date.now() || handoff.verifier_hash !== state.verifierHash) {
        throw new Error("invalid_handoff");
      }
      const completionProof = await signToken({
        purpose: "google_handoff_completion",
        provider: "google",
        handoffId: handoff.id,
        verifierHash: handoff.verifier_hash,
        accountId: account.id,
        exp: Date.now() + 10 * 60 * 1e3
      }, env.TOKEN_SECRET);
      await sbPatch(
        env,
        "line_login_handoffs",
        "id=eq." + encodeURIComponent(handoff.id),
        {
          status: "complete",
          account_id: String(account.id),
          completion_proof: completionProof,
          completed_at: (/* @__PURE__ */ new Date()).toISOString()
        }
      );
      const response2 = googleRedirect(env, "google_handoff", "complete");
      response2.headers.set("Set-Cookie", clearCookie);
      return response2;
    }
    const response = googleRedirect(env, "google_auth", ticket);
    response.headers.set("Set-Cookie", clearCookie);
    return response;
  } catch (error) {
    const known = /* @__PURE__ */ new Set([
      "not_configured",
      "invalid_state",
      "token_exchange_failed",
      "id_token_invalid",
      "database_not_ready",
      "invalid_handoff",
      "handoff_not_ready"
    ]);
    const code = known.has(error.message) ? error.message : "login_failed";
    const response = googleRedirect(env, "google_error", code);
    response.headers.set("Set-Cookie", clearCookie);
    return response;
  }
}
__name(handleGoogleCallback, "handleGoogleCallback");
__name2(handleGoogleCallback, "handleGoogleCallback");
async function handleGoogleComplete(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!env.TOKEN_SECRET) return json({ error: "Google Login is not configured" }, 503);
  const body = await request.json().catch(() => ({}));
  const payload = await verifyToken(body.ticket || "", env.TOKEN_SECRET);
  if (!payload || payload.purpose !== "google_login_ticket" || !payload.accountId) {
    return json({ error: "Google login expired. Please try again." }, 401);
  }
  const rows = await sbGet(
    env,
    "user_accounts",
    "id=eq." + encodeURIComponent(payload.accountId) + "&select=id,nickname,email,gender,auth_provider,google_picture_url,google_nickname_confirmed"
  );
  if (!rows || !rows.length) return json({ error: "Google account was not found." }, 404);
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
      authProvider: account.auth_provider || "google",
      picture: account.google_picture_url || null
    }
  });
}
__name(handleGoogleComplete, "handleGoogleComplete");
__name2(handleGoogleComplete, "handleGoogleComplete");
async function handleGoogleNickname(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!env.TOKEN_SECRET) return json({ error: "Google Login is not configured" }, 503);
  const body = await request.json().catch(() => ({}));
  const payload = await verifyToken(body.ticket || "", env.TOKEN_SECRET);
  if (!payload || payload.purpose !== "google_login_ticket" || !payload.accountId) {
    return json({ error: "Google login expired. Please try again." }, 401);
  }
  const nickname = String(body.nickname || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40);
  if (!nickname) return json({ error: "Please enter your player nickname." }, 400);
  const gender = String(body.gender || "");
  if (!["Male", "Female"].includes(gender)) {
    return json({ error: "Please select your gender." }, 400);
  }
  const rows = await sbPatch(
    env,
    "user_accounts",
    "id=eq." + encodeURIComponent(payload.accountId),
    { nickname, gender, google_nickname_confirmed: true },
    "return=representation"
  );
  const account = rows && rows[0];
  if (!account) return json({ error: "Google account was not found." }, 404);
  return json({
    user: {
      id: account.id,
      nickname: account.nickname,
      displayName: account.nickname,
      email: account.email || null,
      gender: account.gender || gender,
      authProvider: account.auth_provider || "google",
      picture: account.google_picture_url || null
    }
  });
}
__name(handleGoogleNickname, "handleGoogleNickname");
__name2(handleGoogleNickname, "handleGoogleNickname");
async function handleNicknameUpdate(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || "");
  const sessionToken = String(body.sessionToken || "");
  const nickname = String(body.nickname || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40);
  if (!userId || !sessionToken) return json({ error: "Please sign in again." }, 401);
  if (!nickname) return json({ error: "Please enter your player nickname." }, 400);
  const sessions = await sbGet(
    env,
    "active_sessions",
    "user_account_id=eq." + encodeURIComponent(userId) + "&token=eq." + encodeURIComponent(sessionToken) + "&select=user_account_id"
  );
  if (!sessions || !sessions.length) return json({ error: "Your session has expired. Please sign in again." }, 401);
  const rows = await sbPatch(
    env,
    "user_accounts",
    "id=eq." + encodeURIComponent(userId),
    { nickname, line_nickname_confirmed: true },
    "return=representation"
  );
  const account = rows && rows[0];
  if (!account) return json({ error: "Account was not found." }, 404);
  return json({
    user: {
      id: account.id,
      nickname: account.nickname,
      displayName: account.nickname,
      email: account.email || null,
      authProvider: account.auth_provider || "email",
      picture: account.line_picture_url || null
    }
  });
}
__name(handleNicknameUpdate, "handleNicknameUpdate");
__name2(handleNicknameUpdate, "handleNicknameUpdate");
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
