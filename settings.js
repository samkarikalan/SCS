/* ============================================================
HOME -- Theme, font size, language, reset actions
File: home.js
============================================================ */

let pendingAction = null;

function t(key) {
return translations[currentLang]?.[key] || key;
}

function showConfirm(messageKey, action) {
const overlay = document.getElementById("confirmOverlay");
const title   = document.getElementById("confirmTitle");
const yesBtn  = document.getElementById("confirmYes");
const cancelBtn = document.getElementById("confirmCancel");

title.textContent = t(messageKey);
yesBtn.textContent = t("yes");
cancelBtn.textContent = t("cancel");

pendingAction = action;
overlay.classList.remove("hidden");

// ✅ YES button
yesBtn.onclick = () => {
pendingAction && pendingAction();
closeConfirm();
};

// ✅ CANCEL button (THIS enables it)
cancelBtn.onclick = closeConfirm;
}

function closeConfirm() {
document.getElementById("confirmOverlay").classList.add("hidden");
pendingAction = null;
}

let currentLang = "en";

/* Language picker in Settings */
function settingsToggleLangPicker() {
const picker = document.getElementById('settingsLangPicker');
if (picker) picker.style.display = picker.style.display === 'none' ? '' : 'none';
}

function setLanguage(lang) {
  currentLang = lang;
  localStorage.setItem("appLanguage", lang);
  document.documentElement.lang = lang === 'jp' ? 'ja' : lang;
  document.documentElement.classList.toggle('lang-jp', lang === 'jp');
  document.body?.classList.toggle('lang-jp', lang === 'jp');

  var languageLabels = { en: '🇺🇸 English', jp: '🇯🇵 日本語', kr: '🇰🇷 한국어', zh: '🇨🇳 中文', vi: '🇻🇳 Tiếng Việt' };
  ['mlLangCurrent', 'authLangCurrent'].forEach(function(id) {
    var langEl = document.getElementById(id);
    if (langEl) langEl.textContent = (languageLabels[lang] || languageLabels.en) + ' ▾';
  });

  document.querySelectorAll("[id^='lang_']").forEach(btn => {
    btn.classList.remove("active");
  });
  document.getElementById("lang_" + lang)?.classList.add("active");

  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.dataset.i18n;
    el.textContent = translations[lang][key] || key;
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const key = el.dataset.i18nPlaceholder;
    el.placeholder = translations[lang][key] || "";
  });

  if (window.SCSOfflineRounds && typeof window.SCSOfflineRounds.refreshControls === 'function') {
    window.SCSOfflineRounds.refreshControls();
  }

  if (typeof renderMyCardSlotsUI === 'function' && document.getElementById('mcUpcomingSlots')) {
    renderMyCardSlotsUI(false);
  }
  if (typeof renderVaultHomeSlotsUI === 'function' && document.getElementById('vaultUpcomingSlots')) {
    renderVaultHomeSlotsUI(false);
  }
  if (typeof vaultVenuesRenderList === 'function') {
    const venuesPage = document.getElementById('vaultVenuesPage');
    if (venuesPage && venuesPage.style.display !== 'none') vaultVenuesRenderList(false);
  }
  if (typeof vaultSlotsVenueChanged === 'function') {
    vaultSlotsVenueChanged('create');
    vaultSlotsVenueChanged('manage');
  }
  if (typeof renderDashboard === 'function') {
    const dashPage = document.getElementById('dashboardPage');
    if (dashPage && dashPage.style.display !== 'none') renderDashboard();
  }
  if (typeof syncExperienceModeUI === 'function') syncExperienceModeUI();
  if (typeof updateModePill === 'function' && typeof appMode !== 'undefined' && appMode) updateModePill(appMode);
  if (typeof showRound === 'function' && typeof currentRoundIndex !== 'undefined') {
    const roundsPage = document.getElementById('roundsPage');
    if (roundsPage && roundsPage.style.display !== 'none' && currentRoundIndex >= 0) showRound(currentRoundIndex);
  }
  
  if (typeof loadHelp === "function" && typeof currentHelpSection !== "undefined") loadHelp(currentHelpSection);
}

function settingsSelectLang(lang, flag, name) {
const val = document.getElementById('settingsLangValue');
if (val) val.textContent = flag + ' ' + name;
const picker = document.getElementById('settingsLangPicker');
if (picker) picker.style.display = 'none';
setLanguage(lang);
if (typeof mlSyncLangDisplay === 'function') mlSyncLangDisplay();
}

/* Keep toggleLangMenu as no-op for any remaining refs */
function toggleLangMenu() {}
function _closeLangMenu() {}

const langFlagMap = {
en: "🇺🇸",
jp: "🇯🇵",
zh: "🇨🇳",
kr: "🇰🇷",
vi: "🇻🇳"

};
/* ===== Theme ===== */

function initLanguage() {
const savedLang = localStorage.getItem("appLanguage");
const supportedLangs = ["en", "jp", "kr", "vi", "zh"];
const langNames = { en: "English", jp: "日本語", kr: "한국어", zh: "中文", vi: "Tiếng Việt" };

const lang = supportedLangs.includes(savedLang) ? savedLang : (() => {
const b = navigator.language.toLowerCase();
if (b.startsWith("ja")) return "jp";
if (b.startsWith("ko")) return "kr";
if (b.startsWith("vi")) return "vi";
if (b.startsWith("zh")) return "zh";
return "en";
})();

// Update settings label
const flag = langFlagMap[lang] || "🌐";
const val = document.getElementById("settingsLangValue");
if (val) val.textContent = flag + " " + (langNames[lang] || lang);

setLanguage(lang);
}

function initTheme() {
  const saved = localStorage.getItem('app-theme');
  if (saved) applyTheme(saved);
  else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark ? 'dark' : 'light');
  }
}

// Build 606: whole-app scaling uses CSS zoom. Values above 100% make a full-width
// phone layout wider than the viewport, so they are not valid sizes for the current UI.
// Keep only sizes that can be displayed without clipping the Welcome/header tiles.
function _fontScaleLimits() {
  return { min: 88, max: 100 };
}

function _autoFontScale() {
  const width = Math.min(window.innerWidth || 390, screen.width || 390);
  if (width <= 360) return 94;
  return 100;
}

function _syncFontSliderLimits() {
  const limits = _fontScaleLimits();
  const slider = document.getElementById('fontScaleSlider');
  if (slider) {
    slider.min = String(limits.min);
    slider.max = String(limits.max);
    slider.step = '1';
  }
  return limits;
}

function initFontSize() {
  _syncFontSliderLimits();
  const savedScale = localStorage.getItem('appFontScale');
  const savedLegacy = localStorage.getItem('appFontSize');
  const firstScale = savedScale !== null ? Number(savedScale)
    : (savedLegacy ? _fontScaleFromValue(savedLegacy) : _autoFontScale());
  setFontSize(firstScale);
}

function applyTheme(mode) {
  mode = mode === 'light' ? 'light' : 'dark';
  var isLight = mode === 'light';
  var root = document.documentElement;
  var body = document.body;
  var bg = isLight ? '#f4f6fb' : '#0f0f13';

  // Apply the theme to both root and body. The root background paints the
  // iOS standalone safe-area/status-bar region immediately.
  root.classList.toggle('app-light', isLight);
  root.classList.toggle('app-dark', !isLight);
  body.classList.toggle('app-light', isLight);
  body.classList.toggle('app-dark', !isLight);
  root.style.backgroundColor = bg;
  body.style.backgroundColor = bg;
  root.style.colorScheme = mode;
  root.setAttribute('data-theme', mode);
  body.setAttribute('data-theme', mode);

  document.getElementById('theme_light')?.classList.toggle('active', isLight);
  document.getElementById('theme_dark')?.classList.toggle('active', !isLight);
  localStorage.setItem('app-theme', mode);

  var icon = isLight ? '☀️' : '🌙';
  document.querySelectorAll('.scs-topbar-theme').forEach(function(btn) { btn.textContent = icon; });

  // Keep browser/PWA chrome in sync with the visible page.
  var metaTheme = document.getElementById('metaThemeColor');
  if (metaTheme) metaTheme.setAttribute('content', bg);
}

function setTheme(mode) {
  applyTheme(mode);
}

function scsToggleTheme() {
  var current = localStorage.getItem('app-theme') ||
    (document.documentElement.classList.contains('app-light') ? 'light' : 'dark');
  applyTheme(current === 'light' ? 'dark' : 'light');
}

function _fontScaleFromValue(value) {
  const legacy = { small: 94, medium: 100, large: 106, xlarge: 112 };
  if (typeof value === 'string' && legacy[value] !== undefined) return legacy[value];
  const n = Number(value);
  const limits = _fontScaleLimits();
  return Number.isFinite(n) ? Math.max(limits.min, Math.min(limits.max, n)) : _autoFontScale();
}

function _fontScaleBucket(scale) {
  if (scale < 97) return 'small';
  if (scale < 104) return 'medium';
  if (scale < 110) return 'large';
  return 'xlarge';
}

function setFontSize(value) {
  const root = document.documentElement;
  const scale = _fontScaleFromValue(value);
  const zoom = scale / 100;
  const zoomText = zoom.toFixed(3).replace(/0+$/,'').replace(/\.$/,'') || '1';

  // Build 588: this setting now behaves like page zoom, not text-only scaling.
  // Keep 1rem as the typography baseline so px, rem, icons, cards and spacing
  // all grow together through CSS zoom.
  root.style.setProperty('--base-font-size', '1rem');
  root.style.setProperty('--app-font-scale', zoomText);
  root.style.setProperty('--app-ui-zoom', zoomText);
  root.setAttribute('data-font-size', _fontScaleBucket(scale));
  root.setAttribute('data-font-scale', String(scale));
  localStorage.setItem('appFontScale', String(scale));
  localStorage.setItem('appFontSize', _fontScaleBucket(scale));
  const slider = document.getElementById('fontScaleSlider');
  const valueEl = document.getElementById('fontScaleValue');
  if (slider) slider.value = String(scale);
  if (valueEl) valueEl.textContent = Math.round(scale) + '%';
}

function appearFontSliderInput(value) {
  const scale = _fontScaleFromValue(value);
  _appearPending.font = scale;
  const valueEl = document.getElementById('fontScaleValue');
  if (valueEl) valueEl.textContent = Math.round(scale) + '%';
  _appearUpdateApplyBtn();
}


/* ── Appearance panel: pending selections ── */
var _appearPending = { theme: null, font: null };

function appearSyncFromSaved() {
  _syncFontSliderLimits();
  // Sync pill active states from saved prefs when settings page opens
  const theme = localStorage.getItem('app-theme') || 'light';
  const font  = Number(localStorage.getItem('appFontScale')) || _fontScaleFromValue(localStorage.getItem('appFontSize') || 'xlarge');

  // Theme pills
  ['theme_light','theme_dark'].forEach(id => document.getElementById(id)?.classList.remove('active'));
  document.getElementById(theme === 'light' ? 'theme_light' : 'theme_dark')?.classList.add('active');

  // iOS-style font slider
  const fontSlider = document.getElementById('fontScaleSlider');
  const fontValue = document.getElementById('fontScaleValue');
  if (fontSlider) fontSlider.value = String(font);
  if (fontValue) fontValue.textContent = Math.round(font) + '%';

  // Reset pending state
  _appearPending = { theme: null, font: null };

  _appearUpdateApplyBtn();
}

function appearSelect(type, value, btn) {
  // Highlight selected pill
  const group = btn.closest('.appear-pill-group') || btn.parentElement;
  group.querySelectorAll('.pref-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  btn.classList.add('appear-pulse');
  setTimeout(() => btn.classList.remove('appear-pulse'), 400);

  // Theme is a direct setting: apply it immediately across the whole app.
  // Other appearance controls keep their existing Apply Changes workflow.
  if (type === 'theme') {
    _appearPending.theme = null;
    applyTheme(value);
  } else if (type === 'font') {
    _appearPending.font = value;
  }

  _appearUpdateApplyBtn();
}

function _appearUpdateApplyBtn() {
  const btn   = document.getElementById('appearApplyBtn');
  const bar   = document.getElementById('appearPreviewBar');
  const label = document.getElementById('appearPreviewLabel');
  const hasPending = Object.values(_appearPending).some(v => v !== null);
  if (hasPending) {
    btn?.classList.add('appear-apply-ready');
    if (bar) bar.style.display = '';
    const parts = [];
    if (_appearPending.theme) parts.push(_appearPending.theme === 'light' ? '☀️ Light' : '🌙 Dark');
    if (_appearPending.font)  parts.push(Math.round(_appearPending.font) + '% font');
    if (label) label.textContent = parts.join(' · ') + ' — tap Apply';
  } else {
    btn?.classList.remove('appear-apply-ready');
    if (bar) bar.style.display = 'none';
  }
}



function appearApply() {
  const btn = document.getElementById('appearApplyBtn');

  // Apply all pending to the whole app
  if (_appearPending.theme) applyTheme(_appearPending.theme);
  if (_appearPending.font)  setFontSize(_appearPending.font);

  // Success animation
  if (btn) {
    btn.classList.add('appear-apply-success');
    btn.innerHTML = '<span>✓</span> Applied!';
    setTimeout(() => {
      btn.classList.remove('appear-apply-ready', 'appear-apply-success');
      btn.innerHTML = '<span id="appearApplyIcon">✦</span> Apply Changes';
    }, 1500);
  }

  _appearPending = { theme: null, font: null };
  const bar = document.getElementById('appearPreviewBar');
  if (bar) bar.style.display = 'none';
}

function ResetAll() {
location.reload(); // This refreshes the entire app clean
document.getElementById("reset_all").classList.remove("active");
}

function resetRounds() {
// 1️⃣ Clear all previous rounds
allRounds.length = 0;
initScheduler(1);  
clearPreviousRound();
goToRounds();
report();
sessionFinished = false;
document.getElementById("nextBtn").disabled = false;
// Shuffle state managed by _syncShuffleBtn
if (typeof _syncShuffleBtn   === 'function') _syncShuffleBtn();
if (typeof _syncModeBanner   === 'function') _syncModeBanner();

// Optional: also disable End to prevent double-click
//document.getElementById("endBtn").disabled = false;

const btn = document.getElementById("reset_rounds_btn");
if (btn) {
btn.classList.remove("active");
}
}

/* =========================
PLAYER MANAGEMENT (Settings Tab)
========================= */
const ADMIN_DEFAULT_PASSWORD = "1234";
let adminModalMode = "unlock"; // "unlock" | "changepwd"

function adminGetPassword() {
return localStorage.getItem("adminPassword") || ADMIN_DEFAULT_PASSWORD;
}

// ── Unlock flow ──
// playerMgmtUnlock/Lock no longer needed -- Players tab handles this directly

// ── Change password flow ──
function playerMgmtChangePwd() {
adminModalMode = "changepwd";
document.getElementById("adminModalTitle").textContent = t("changePassword");
document.getElementById("adminPasswordConfirmRow").style.display = "block";
document.getElementById("adminModalError").textContent = "";
document.getElementById("adminPasswordInput").value = "";
document.getElementById("adminPasswordConfirm").value = "";
document.getElementById("adminModal").style.display = "flex";
setTimeout(() => document.getElementById("adminPasswordInput").focus(), 100);
}

function adminCloseModal() {
document.getElementById("adminModal").style.display = "none";
}

function adminVerifyPassword() {
const input = document.getElementById("adminPasswordInput").value;
const err   = document.getElementById("adminModalError");

if (adminModalMode === "unlock") {
if (input === adminGetPassword()) {
adminCloseModal();
document.getElementById("playerMgmtLocked").style.display = "none";
document.getElementById("playerMgmtUnlocked").style.display = "block";
playerMgmtRenderList();
} else {
err.textContent = t("wrongPassword");
document.getElementById("adminPasswordInput").value = "";
}

} else if (adminModalMode === "changepwd") {
const confirm = document.getElementById("adminPasswordConfirm").value;
if (input.length < 4) {
err.textContent = t("passwordMin4"); return;
}
if (input !== confirm) {
err.textContent = t("passwordsNotMatchDot"); return;
}
localStorage.setItem("adminPassword", input);
adminCloseModal();
alert("Password changed successfully.");
}
}

// ── Player subtabs: All / Playing ──
function playerSubtabShow(tab) {
var elAll     = document.getElementById('playerSubtabAll');
var elPlaying = document.getElementById('playerSubtabPlaying');
var elAllBtn  = document.getElementById('playerSubtabAllBtn');
var elPlayBtn = document.getElementById('playerSubtabPlayingBtn');
if (elAll)     elAll.style.display     = tab === 'all'     ? '' : 'none';
if (elPlaying) elPlaying.style.display = tab === 'playing' ? '' : 'none';
if (elAllBtn)  elAllBtn.classList.toggle('active',  tab === 'all');
if (elPlayBtn) elPlayBtn.classList.toggle('active', tab === 'playing');
if (tab === 'all')     playerMgmtRenderList();
if (tab === 'playing') playerPlayingRenderList();
}

async function playerPlayingRenderList() {
const container = document.getElementById('playerPlayingList');
container.innerHTML = '<p style="color:#aaa;font-size:0.85rem">' + t('loading') + '</p>';
const admin = isAdminMode();

try {
const club = (typeof getMyClub === 'function') ? getMyClub() : { id: null };

let rows;
if (club.id) {
  rows = await sbGet('memberships',
    `club_id=eq.${club.id}&is_playing=eq.true&select=nickname,player_id,players(gender)&order=nickname.asc`
  );
  rows = (rows || []).map(m => ({ name: m.nickname, gender: m.players?.gender || 'Male' }));
} else {
  container.innerHTML = '<p class="player-mgmt-empty">' + t('joinClubToPlay') + '</p>';
  return;
}

if (!rows || !rows.length) {
  container.innerHTML = '<p class="player-mgmt-empty">' + t('noPlayersLocked') + '</p>';
  return;
}

container.innerHTML = '';

// Release All button -- admin and organiser (user)
if (admin || getClubMode() === 'user' || (typeof appMode !== 'undefined' && appMode === 'organiser')) {
  const bar = document.createElement('div');
  bar.style.cssText = 'padding:8px 0 12px;';
  const releaseAllBtn = document.createElement('button');
  releaseAllBtn.className = 'player-mgmt-add-btn';
  releaseAllBtn.style.background = '#e63757';
  releaseAllBtn.textContent = t('releaseAll') + ' (' + rows.length + ')';
  releaseAllBtn.onclick = playerPlayingReleaseAll;
  bar.appendChild(releaseAllBtn);
  container.appendChild(bar);
}

rows.forEach(function(p) {
  const row = document.createElement('div');
  row.className = 'player-mgmt-row';
  const started = p.session_started_at
    ? new Date(p.session_started_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
    : '--';

  const img = document.createElement('img');
  img.src = p.gender === 'Female' ? 'female.png' : 'male.png';
  img.className = 'player-mgmt-avatar';
  img.style.cursor = 'default';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'player-mgmt-name';
  nameSpan.textContent = p.name;

  const timeSpan = document.createElement('span');
  timeSpan.style.cssText = 'font-size:0.75rem;color:var(--muted);margin-right:8px';
  timeSpan.textContent = '';  // no session time in new schema

  row.appendChild(img);
  row.appendChild(nameSpan);
  row.appendChild(timeSpan);

  if (admin || getClubMode() === 'user' || (typeof appMode !== 'undefined' && appMode === 'organiser')) {
    const btn = document.createElement('button');
    btn.className = 'player-mgmt-del-btn';
    btn.style.cssText = 'background:#e63757;color:#fff;border:none;border-radius:20px;padding:4px 10px;font-size:0.8rem';
    btn.textContent = '🔓';
    btn.onclick = function() { playerPlayingRelease(p.name); };
    row.appendChild(btn);
  }

  container.appendChild(row);
});

} catch(e) {
container.innerHTML = '<p class="player-mgmt-empty">' + t('failedLoadConnection') + '</p>';
console.error('playerPlayingRenderList error:', e);
}
}

async function playerPlayingRelease(name) {
if (!confirm('"' + name + '" ' + t('releaseFromSession'))) return;
try {
const _rc = (typeof getMyClub === 'function') ? getMyClub() : { id: null };
await sbPatch('memberships', `club_id=eq.${_rc.id}&nickname=ilike.${name}`, {
is_playing: false
});
playerPlayingRenderList();
} catch(e) { alert('Failed to release: ' + e.message); }
}

async function playerPlayingReleaseAll() {
if (!confirm(t('releaseAllConfirm'))) return;
try {
const club = (typeof getMyClub === 'function') ? getMyClub() : { id: null };
if (!club.id) { alert('No club logged in.'); return; }
await sbPatch('memberships', `club_id=eq.${club.id}&is_playing=eq.true`, { is_playing: false });
playerPlayingRenderList();
} catch(e) { alert('Failed: ' + e.message); }
}

// ── Render master player list ──
async function playerMgmtRenderList() {
const container = document.getElementById("playerMgmtList");
container.innerHTML = "<p style='color:#aaa;font-size:0.85rem'>" + t('loading') + "</p>";

// Always use syncToLocal as single source of truth -- never fetch directly
if (!newImportState.historyPlayers || !newImportState.historyPlayers.length) {
await syncToLocal();
}
let players = newImportState.historyPlayers || [];

container.innerHTML = "";

if (players.length === 0) {
container.innerHTML = '<p class="player-mgmt-empty">' + t('noPlayersInDb') + '</p>';
return;
}

const sorted = [...players].sort((a, b) =>
a.displayName.localeCompare(b.displayName)
);

// Toolbar hidden -- all edits are in the Players tab
const toolbar = document.getElementById("playerMgmtToolbar");
if (toolbar) toolbar.style.display = "none";

sorted.forEach((p, i) => {
const row = document.createElement("div");
row.className = "player-mgmt-row";
const safeName = p.displayName.replace(/'/g, "'");
const rating = (typeof getActiveRating === "function" ? getActiveRating(p.displayName) : getRating(p.displayName)).toFixed(1);
// Settings is read-only -- all edits happen in the Players tab
row.innerHTML = `<img src="${p.gender === 'Female' ? 'female.png' : 'male.png'}" class="player-mgmt-avatar" style="cursor:default"> <span class="player-mgmt-name player-mgmt-name-link" onclick="showPlayerStats('${safeName}')">${p.displayName}</span> <span class="rating-badge" style="font-size:0.8rem;padding:2px 7px">${rating}</span>`;
container.appendChild(row);
});
}

// ── Save rating to master DB ──
function playerMgmtSaveRating(displayName, value) {
const rating = parseFloat(value);
if (isNaN(rating)) return;
setRating(displayName, rating);  // single write gateway
syncRatings();                   // refresh all visible badges
updatePlayerList();
}

// ── Toggle gender ──
async function playerMgmtToggleGender(displayName) {
const key = displayName.trim().toLowerCase();
const hp  = newImportState.historyPlayers.find(p => p.displayName.trim().toLowerCase() === key);
if (!hp) return;
hp.gender = hp.gender === "Female" ? "Male" : "Female";
localStorage.setItem("newImportHistory", JSON.stringify(newImportState.historyPlayers));
// Sync gender to Supabase
try {
// gender is on players table -- find player_id via membership
const _gc = (typeof getMyClub === 'function') ? getMyClub() : { id: null };
if (_gc.id) {
const _mrows = await sbGet('memberships', `club_id=eq.${_gc.id}&nickname=ilike.${encodeURIComponent(displayName.trim())}&select=player_id`).catch(()=>[]);
if (_mrows.length) await sbPatch('players', `id=eq.${_mrows[0].player_id}`, { gender: hp.gender });
}
} catch(e) { /* silent */ }
syncPlayersFromMaster();
updatePlayerList();
playerMgmtRenderList();
}

// ── Delete from master DB ──
async function playerMgmtDelete(displayName) {
if (!confirm(`${t('removePlayer')} "${displayName}"?`)) return;
const key = displayName.trim().toLowerCase();

// Remove from Supabase club_members
try {
const club = getMyClub();
if (club.id) {
await sbDelete('memberships', `club_id=eq.${club.id}&nickname=ilike.${encodeURIComponent(displayName.trim())}`);
}
} catch(e) { /* silent */ }

// Remove from local cache
newImportState.historyPlayers = newImportState.historyPlayers.filter(
p => p.displayName.trim().toLowerCase() !== key
);
localStorage.setItem("newImportHistory", JSON.stringify(newImportState.historyPlayers));
playerMgmtRenderList();
}

// ── Add new player ──
function playerMgmtAddNew() {
const name = prompt("Enter player name:");
if (!name || !name.trim()) return;
const trimmed = name.trim();
const key = trimmed.toLowerCase();
if (newImportState.historyPlayers.some(p => p.displayName.trim().toLowerCase() === key)) {
alert("Player already exists."); return;
}
newImportState.historyPlayers.unshift({ displayName: trimmed, gender: "Male", rating: 1.0, clubRating: 1.0, activeRating: 1.0 });
localStorage.setItem("newImportHistory", JSON.stringify(newImportState.historyPlayers));
playerMgmtRenderList();
}

/* =============================================================
GITHUB ADMIN -- Token + Club Management
Added: step82
============================================================= */

// ── Token UI ──────────────────────────────────────────────────

// ── Club Admin (Supabase) ────────────────────────────────────

function clubAdminInit() {
sbRenderClubStatus();
updateRegisterTabVisibility();
}

function sbShowClubTab(tab) {
["join","create","players"].forEach(t => {
const content = document.getElementById("clubTab" + t.charAt(0).toUpperCase() + t.slice(1));
const btn     = document.getElementById("clubTab" + t.charAt(0).toUpperCase() + t.slice(1) + "Btn");
if (content) content.style.display = t === tab ? "block" : "none";
if (btn) btn.classList.toggle("active", t === tab);
});
if (tab === "players") { playerSubtabShow('all'); }
if (tab === "create") sbPopulateDeleteDropdown();
}

function sbRenderClubStatus() {
const club  = getMyClub();
const mode  = getClubMode();
const el    = document.getElementById("sbClubStatus");
const badge = document.getElementById("sbModeBadge");

if (el) el.textContent = club.name ? club.name : t("noClubSelected");

if (badge) {
if (mode === "admin") {
badge.textContent = t('adminBadgeFull');
badge.style.background = "#2dce89";
badge.style.color = "#fff";
badge.style.display = "inline-block";
} else if (mode === "user") {
badge.textContent = t("userBadgeFull");
badge.style.background = "#5e72e4";
badge.style.color = "#fff";
badge.style.display = "inline-block";
} else {
badge.style.display = "none";
}
}

// Restore rating mode UI if already logged in
if (club.id) {
const isTrusted = localStorage.getItem("kbrr_club_trusted") === "true";
const ratingMode = localStorage.getItem("kbrr_rating_mode") || "local";
const wrap = document.getElementById("sbRatingModeWrap");
if (wrap) {
wrap.style.display = isTrusted ? "block" : "none";
document.getElementById("sbRatingGlobal")?.classList.toggle("active", ratingMode === "global");
document.getElementById("sbRatingLocal")?.classList.toggle("active",  ratingMode === "local");
}
}

// Also sync Vault status strip
vaultSyncStatus();
}

/* ── Vault tab functions ── */
function vaultShowTab(tab, btn) {
document.querySelectorAll('.vault-inner-content').forEach(c => c.classList.remove('active'));
document.querySelectorAll('.vault-inner-tab, .vault-tab').forEach(b => b.classList.remove('active'));
const content = document.getElementById('vaultTab' + tab.charAt(0).toUpperCase() + tab.slice(1));
if (content) content.classList.add('active');
if (btn) btn.classList.add('active');
if (tab === 'players')  playerPlayingRenderList();
if (tab === 'register') vaultRenderRegister();
if (tab === 'modify')   vaultRenderModify();
if (tab === 'requests') { if (typeof vaultLoadRequests === 'function') vaultLoadRequests(); }
}

/* ── Vault Modify tab -- admin-only player edits ── */
/* ── Vault Modify -- SCS-style player list ── */

var _vmAllPlayers = []; // full loaded list for client-side filter

async function vaultRenderModify() {
const container = document.getElementById('vaultModifyList');
if (!container) return;

const club = (typeof getMyClub === 'function') ? getMyClub() : { id: null };
if (!club.id) {
container.innerHTML = '<p class="player-mgmt-empty">' + t('joinClubToManage') + '</p>';
return;
}

container.innerHTML = '<p class="player-mgmt-empty"><span class="vm-spinner"></span> ' + t('loading') + '</p>';

try {
const clubPlayers = await dbGetPlayers(true);

// Fetch memberships to get user_account_id for each player
const mems = await sbGet('memberships',
  'club_id=eq.' + club.id + '&select=nickname,user_account_id'
).catch(() => []);
const memMap = {};
(mems || []).forEach(m => { if (m.nickname) memMap[m.nickname.toLowerCase()] = m.user_account_id; });

_vmAllPlayers = (clubPlayers || []).map(p => ({
  id:            p.membershipId || p.id,
  playerId:      p.id,
  displayName:   String(p.name || '').trim(),
  gender:        p.gender || 'Male',
  rating:        parseFloat(p.clubRating) || parseFloat(p.rating) || 1.0,
  wins:          p.wins   || 0,
  losses:        p.losses || 0,
  userId:        memMap[(p.name || '').toLowerCase()] || null,
})).sort((a, b) => a.displayName.localeCompare(b.displayName));

vaultModifyFilter();

} catch(e) {
container.innerHTML = '<p class="player-mgmt-empty">' + t('failedLoadPlayers') + '</p>';
console.error('vaultRenderModify error:', e);
}
}

function vaultModifyFilter() {
const search = (document.getElementById('vmSearchInput')?.value || '').toLowerCase();
const gender = document.getElementById('vmFilterGender')?.value || '';
const container = document.getElementById('vaultModifyList');
const countEl   = document.getElementById('vmPlayerCount');
if (!container) return;

let filtered = _vmAllPlayers;
if (search) filtered = filtered.filter(p => p.displayName.toLowerCase().includes(search));
if (gender) filtered = filtered.filter(p => (p.gender || 'Male') === gender);

if (countEl) countEl.textContent = filtered.length + ' ' + (filtered.length !== 1 ? t('playerPlural') : t('playerSingular'));

if (!filtered.length) {
container.innerHTML = '<p class="player-mgmt-empty">' + t('noPlayersMatch') + '</p>';
return;
}

container.innerHTML = filtered.map(p => {
const g   = p.gender === 'Female' ? 'female' : 'male';
const visibleInitial = String(p.displayName || '').match(/[\p{L}\p{N}]/u);
const ini = (visibleInitial ? visibleInitial[0] : '?').toUpperCase();
const rating = p.rating.toFixed(1);
const userIdTag = p.userId
? `<span class="vm-userid-chip">${t("registeredBadge")}</span>`
: `<span class="vm-userid-chip vm-unlinked">${t("noAccountBadge")}</span>`;
const safeId = _vmEsc(p.id);
return `<div class="vm-player-row ${g}"> <div class="vm-avatar ${g}">${ini}</div> <div class="vm-player-info"> <div class="vm-player-name-row"> <span class="vm-player-name">${_vmEsc(p.displayName)}</span> ${userIdTag} </div> <div class="vm-player-meta">${(p.gender||'Male')==="Female"?t("genderFemale"):t("genderMale")} · ★${rating} · ${p.wins}${t("winsShort")} ${p.losses}${t("lossesShort")}</div> </div> <div class="vm-row-actions"> <button class="vm-edit-btn" onclick="vmOpenEditModal('${safeId}')" title="Edit">✎</button> <button class="vm-delete-btn" onclick="vmDeletePlayer('${safeId}','${_vmEsc(p.displayName)}')" title="Delete">✕</button> </div> </div>`;
}).join('');
}

function _vmEsc(s) {
return String(s || '')
.replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>')
.replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function vmOpenEditModal(playerId) {
const p = _vmAllPlayers.find(x => x.id === playerId);
if (!p) return;
document.getElementById('vmEditPlayerId').value    = p.id;
document.getElementById('vmEditUserAccountId').value = p.userAccountId || '';
document.getElementById('vmEditName').value        = p.displayName;
document.getElementById('vmEditGender').value      = p.gender || 'Male';
document.getElementById('vmEditRating').value      = p.rating.toFixed(1);
document.getElementById('vmEditWins').value        = p.wins;
document.getElementById('vmEditLosses').value      = p.losses;
document.getElementById('vmEditUserId').value      = p.userId || '';
document.getElementById('vmEditPassword').value    = '';
const fb = document.getElementById('vmEditFeedback');
if (fb) { fb.textContent = ''; fb.style.color = ''; }
document.getElementById('vmEditModal').classList.add('open');
}

function vmCloseEditModal(e) {
if (!e || e.target === document.getElementById('vmEditModal')) {
document.getElementById('vmEditModal').classList.remove('open');
}
}

async function vmSaveEdit() {
const playerId     = document.getElementById('vmEditPlayerId').value;
const userAcctId   = document.getElementById('vmEditUserAccountId').value;
const nameInput    = document.getElementById('vmEditName');
let name           = nameInput.value;
const gender       = document.getElementById('vmEditGender').value;
const rating       = parseFloat(document.getElementById('vmEditRating').value) || 1.0;
const wins         = parseInt(document.getElementById('vmEditWins').value)   || 0;
const losses       = parseInt(document.getElementById('vmEditLosses').value) || 0;
const newUserId    = document.getElementById('vmEditUserId').value.trim().toLowerCase();
const newPassword  = document.getElementById('vmEditPassword').value.trim();
const fb           = document.getElementById('vmEditFeedback');
const setFb = (msg, ok) => { if (fb) { fb.textContent = msg; fb.style.color = ok ? 'var(-green)' : 'var(-red)'; } };

try { name = scsRequireValidPlayerName(name); }
catch (e) { setFb(e.message || t('invalidPlayerName'), false); return; }
nameInput.value = name;

setFb(t('saving'), true);
try {
const club = (typeof getMyClub === 'function') ? getMyClub() : null;
const _vm  = _vmAllPlayers.find(x => x.id === playerId);

// 1. Update membership (nickname + club_rating)
if (club?.id) {
  await sbPatch('memberships', `id=eq.${playerId}`, {
    nickname:    name,
    club_rating: Math.round(rating * 10) / 10
  });
}

// 2. Update player (gender)
if (_vm?.playerId) {
  await sbPatch('players', `id=eq.${_vm.playerId}`, { name, gender });
}

// 3. Update local state
const hp = (newImportState.historyPlayers || []).find(
  p => p.displayName && p.displayName.trim().toLowerCase() === _vmAllPlayers.find(x => x.id === playerId)?.displayName.trim().toLowerCase()
);
if (hp) {
  hp.displayName = name;
  hp.gender      = gender;
  hp.activeRating = Math.round(rating * 10) / 10;
  hp.clubRating   = Math.round(rating * 10) / 10;
}
localStorage.setItem('newImportHistory', JSON.stringify(newImportState.historyPlayers));
if (typeof syncPlayersFromMaster === 'function') syncPlayersFromMaster();
if (typeof updatePlayerList === 'function') updatePlayerList();

setFb(t('saved'), true);
setTimeout(() => {
  document.getElementById('vmEditModal').classList.remove('open');
  vaultRenderModify();
}, 600);

} catch(e) {
setFb('❌ ' + e.message, false);
}
}

async function vmDeletePlayer(playerId, displayName) {
if (!confirm(`${t('removePlayer')} "${displayName}"?`)) return;
try {
// Remove from club only -- delete membership, keep global player
const _dclub = (typeof getMyClub === 'function') ? getMyClub() : { id: null };
await sbDelete('memberships', `id=eq.${playerId}&club_id=eq.${_dclub.id}`);
_vmAllPlayers = _vmAllPlayers.filter(x => x.id !== playerId);
// also update local history
if (newImportState && newImportState.historyPlayers) {
newImportState.historyPlayers = newImportState.historyPlayers.filter(
h => h.displayName?.trim().toLowerCase() !== displayName.trim().toLowerCase()
);
localStorage.setItem('newImportHistory', JSON.stringify(newImportState.historyPlayers));
}
if (typeof syncPlayersFromMaster === 'function') syncPlayersFromMaster();
if (typeof updatePlayerList === 'function') updatePlayerList();
vaultModifyFilter();
} catch(e) {
alert('Failed to remove player: ' + e.message);
}
}

// vaultToggleGender and vaultDeletePlayer replaced by vmSaveEdit / vmDeletePlayer above

// ── Club Management -- OTP-based create/delete ──

var _clubCreateEmail = ''; // store email during OTP flow
var _clubDeleteEmail = ''; // store registration email during delete OTP flow
var _clubDeleteId    = ''; // store selected club id during delete OTP flow

function toggleClubMgmt(forceOpen) {
const panel = document.getElementById('clubMgmtPanel');
const arrow = document.getElementById('clubMgmtArrow');
const open  = forceOpen === true ? true : panel.style.display === 'none';
panel.style.display = open ? 'block' : 'none';
arrow.textContent   = open ? '▼' : '▶';
if (open) sbPopulateDeleteDropdown();
}

/* ── CREATE CLUB -- Direct (no OTP needed) ── */
async function clubCreateSendOtp() {
// Renamed but now creates directly without OTP
const name    = document.getElementById('sbNewClubName')?.value.trim();
const adminPw = document.getElementById('sbNewClubAdminPw')?.value.trim();
const fb      = document.getElementById('clubCreateFeedback');
const setFb   = (msg, ok) => { if (fb) { fb.textContent = msg; fb.style.color = ok ? '#2dce89' : '#e63757'; } };

if (!name)    { setFb(t('enterClubName'), false); return; }
if (!adminPw) { setFb(t('enterAdminPw'), false); return; }

setFb(t('creatingClubDot'), true);
try {
const club = await dbAddClub(name, null, adminPw);
setMyClub(club.id, club.name);
localStorage.setItem('kbrr_club_mode',    'admin');
localStorage.setItem('kbrr_rating_field', 'club_rating');
['sbNewClubName','sbNewClubAdminPw'].forEach(id => {
const el = document.getElementById(id); if (el) el.value = '';
});
setFb('✅ ' + club.name + ' ' + (t('saved')||'created!'), true);
sbRenderClubStatus();
vaultSyncStatus();
if (typeof clubLoginRefresh === 'function') clubLoginRefresh();
await syncToLocal();
} catch(e) { setFb('❌ ' + e.message, false); }
}

async function clubCreateResend() { /* no longer needed */ }
async function clubCreateVerify() { /* no longer needed */ }

/* Reset every protected workspace that belongs to a deleted club. */
async function logoutBothManagementWorkspaces(deletedClubId) {
  var targetId = String(deletedClubId || '');
  var organiserMatches = targetId && String(localStorage.getItem('kbrr_org_club_id') || '') === targetId;
  var vaultMatches = targetId && String(localStorage.getItem('kbrr_vault_club_id') || '') === targetId;

  if (organiserMatches) {
    ['kbrr_org_club_id', 'kbrr_org_club_name'].forEach(function(key) {
      localStorage.removeItem(key);
    });
    localStorage.removeItem('scs_organiser_verified');
    sessionStorage.removeItem('scs_organiser_verified');
    if (window.__scsWelcomeHubData) window.__scsWelcomeHubData.organiser = {};
  }

  if (vaultMatches) {
    ['kbrr_vault_club_id', 'kbrr_vault_club_name'].forEach(function(key) {
      localStorage.removeItem(key);
    });
    localStorage.removeItem('scs_vault_verified');
    sessionStorage.removeItem('scs_vault_verified');
    if (window.__scsWelcomeHubData) window.__scsWelcomeHubData.vault = {};
  }

  if (organiserMatches || vaultMatches) {
    localStorage.removeItem('kbrr_club_mode');
    localStorage.removeItem('kbrr_club_trusted');
  }

  var currentMode = sessionStorage.getItem('appMode') || localStorage.getItem('kbrr_app_mode') || '';
  if ((currentMode === 'organiser' && organiserMatches) || (currentMode === 'vault' && vaultMatches)) {
    localStorage.removeItem('kbrr_app_mode');
    sessionStorage.removeItem('appMode');
    if (typeof appMode !== 'undefined') appMode = null;
  }
}

/* ── DELETE CLUB -- Admin password check ── */
function vaultOpenDeleteOnly() {
  // Clear previous feedback and password
  const pw = document.getElementById('sbDeleteAdminPw');
  const fb = document.getElementById('clubDeleteFeedback');
  if (pw) pw.value = '';
  if (fb) fb.textContent = '';
  if (typeof homeGo === 'function') homeGo('vaultClubMgmtPage', null);
}

async function clubDeleteWithPassword() {
const pwInput = document.getElementById('sbDeleteAdminPw');
const fb      = document.getElementById('clubDeleteFeedback');
const setFb   = (msg, ok) => { if (fb) { fb.textContent = msg; fb.style.color = ok ? '#2dce89' : '#e63757'; } };

const myClub = (typeof getMyClub === 'function') ? getMyClub() : null;
if (!myClub || !myClub.id) { setFb(t('selectClubToDelete'), false); return; }

const pw = pwInput?.value.trim();
if (!pw) { setFb(t('enterAdminPw'), false); return; }

setFb(t('verifyingDot'), true);
try {
const clubs = await sbGet('clubs', `id=eq.${myClub.id}&select=id,name,admin_password`);
if (!clubs || !clubs.length) { setFb(t('clubNotFound'), false); return; }
if (clubs[0].admin_password !== pw) { setFb(t('wrongAdminPassword'), false); return; }

const clubName = clubs[0].name || '';

await dbDeleteClub(myClub.id);

// Only clear management access after the database confirms the deletion.
// A failed delete must leave the administrator signed in so they can retry.
if (typeof logoutBothManagementWorkspaces === 'function') {
  await logoutBothManagementWorkspaces(myClub.id);
}
sbClearClub();

if (pwInput) pwInput.value = '';
setFb('✅ Club "' + clubName + '" deleted.', true);

// Return to mode select after short delay
setTimeout(function() {
  var overlay = document.getElementById('modeSelectOverlay');
  if (overlay) {
    if (typeof mlSyncLangDisplay === 'function') mlSyncLangDisplay();
    overlay.style.display = 'flex';
  }
}, 1500);

} catch (e) { setFb('❌ ' + e.message, false); }
}

function vaultRenderRegister() {
const container = document.getElementById('vaultRegisterContainer');
if (!container) return;
const club = (typeof getMyClub === 'function') ? getMyClub() : { name: null };
const vregJp = {registeringFor:'登録先：',individual:'個別登録',bulk:'一括登録',nickname:'ニックネーム',playerNickname:'選手のニックネーム',gender:'性別',male:'男性',female:'女性',rating:'レーティング',defaultValue:'初期値 1.0',defaultPassword:'デフォルトパスワード',claimHint:'選手がアカウント取得時に使用',passwordExample:'例：club123',registerPlayer:'選手を登録',addSession:'今日のセッションに追加',pasteNames:'名前を貼り付け（1行に1人）',defaultGender:'初期の性別：',passwordAll:'全選手のデフォルトパスワード',addList:'リストに追加',registerAll:'すべて登録'};
const vregText = function(key, fallback) { return (localStorage.getItem('appLanguage') || 'en') === 'jp' ? (vregJp[key] || fallback) : fallback; };

if (!club.name) {
container.innerHTML = '<div class="register-club-label">' + t('noClubSelectedJoin') + '</div>';
return;
}

container.innerHTML = `
<div class="register-form">
<div class="register-club-label">🏸 ${vregText('registeringFor','Registering for:')} <strong>${club.name}</strong></div>

  <!-- Tabs -->
  <div class="vault-inner-tabs">
    <button id="vregTabIndividual" class="vault-inner-tab active" onclick="vaultRegisterShowTab('individual')">${vregText('individual','Individual')}</button>
    <button id="vregTabBulk"       class="vault-inner-tab"        onclick="vaultRegisterShowTab('bulk')">${vregText('bulk','Bulk Import')}</button>
  </div>

  <!-- Individual tab -->
  <div id="vregPanelIndividual">
    <div class="register-field">
      <label class="register-label">${vregText('nickname','Nickname')}</label>
      <input type="text" id="vregNickname" class="register-input" placeholder="${vregText('playerNickname','Player nickname')}">
    </div>
    <div class="register-field">
      <label class="register-label">${vregText('gender','Gender')}</label>
      <select id="vregGender" class="register-input">
        <option value="Male">${vregText('male','Male')}</option>
        <option value="Female">${vregText('female','Female')}</option>
      </select>
    </div>
    <div class="register-field">
      <label class="register-label">${vregText('rating','Rating')} <span class="register-hint">${vregText('defaultValue','default 1.0')}</span></label>
      <input type="number" id="vregRating" class="register-input register-rating-input" value="1.0" min="1.0" max="5.0" step="0.1">
    </div>
    <div class="register-field">
      <label class="register-label">${vregText('defaultPassword','Default Password')} <span class="register-hint">${vregText('claimHint','player uses this to claim account')}</span></label>
      <input type="text" id="vregDefaultPassword" class="register-input" placeholder="${vregText('passwordExample','e.g. club123')}">
    </div>
    <div id="vregFeedback" class="register-feedback" style="min-height:18px;margin-bottom:10px"></div>
    <button class="register-save-btn" onclick="vaultDoRegisterPlayer()">${vregText('registerPlayer','Register Player')}</button>
    <button class="register-add-session-btn" id="vregAddToSessionBtn" style="display:none;" onclick="vaultRegisterAndAddToSession(this)">+ ${vregText('addSession',"Add to Today's Session")}</button>
  </div>

  <!-- Bulk tab -->
  <div id="vregPanelBulk" style="display:none">
    <div class="auth-field" style="margin-bottom:10px">
      <label class="register-label">${vregText('pasteNames','Paste names (one per line)')}</label>
      <textarea id="regNamesArea" class="register-textarea" rows="5"
        placeholder="Raja&#10;Kari, Female&#10;Venkat"></textarea>
    </div>
    <div class="register-gender-row" style="margin-bottom:10px">
      <span class="register-label" style="margin:0 8px 0 0">${vregText('defaultGender','Default gender:')}</span>
      <button id="regDefaultMale"   class="register-gender-img-btn active" onclick="regSetDefaultGender('Male')">
        <img src="male.png" class="reg-gender-img"><span>${vregText('male','Male')}</span>
      </button>
      <button id="regDefaultFemale" class="register-gender-img-btn" onclick="regSetDefaultGender('Female')">
        <img src="female.png" class="reg-gender-img"><span>${vregText('female','Female')}</span>
      </button>
    </div>
    <div class="register-field">
      <label class="register-label">${vregText('passwordAll','Default Password for all')} <span class="register-hint">${vregText('claimHint','players use this to claim account')}</span></label>
      <input type="text" id="vregBulkDefaultPassword" class="register-input" placeholder="${vregText('passwordExample','e.g. club123')}">
    </div>
    <button class="register-add-btn" onclick="regAddToStaging()">${vregText('addList','Add to List')}</button>
    <div id="regStagingContainer" class="reg-staging-container"></div>
    <div id="registerFeedback" class="register-feedback"></div>
    <button class="register-save-btn" id="regRegisterAllBtn" onclick="vaultRegisterAll()" style="display:none">
      ✅ ${vregText('registerAll','Register All')}
    </button>
  </div>
</div>`;

window._regDefaultGender = 'Male';
if (typeof _regStagingList !== 'undefined') _regStagingList = [];
}

function vaultRegisterShowTab(tab) {
document.getElementById('vregTabIndividual').classList.toggle('active', tab === 'individual');
document.getElementById('vregTabBulk').classList.toggle('active',       tab === 'bulk');
document.getElementById('vregPanelIndividual').style.display = tab === 'individual' ? '' : 'none';
document.getElementById('vregPanelBulk').style.display       = tab === 'bulk'       ? '' : 'none';
if (tab === 'bulk' && typeof _regStagingList !== 'undefined') {
_regStagingList = [];
if (typeof regRenderStaging === 'function') regRenderStaging();
}
}

async function vaultRegisterAll() {
// Same as regRegisterAll but uses bulk default password for all players
const defPw = document.getElementById('vregBulkDefaultPassword')?.value.trim();
const fb    = document.getElementById('registerFeedback');
const btn   = document.getElementById('regRegisterAllBtn');
const setFb = (msg, ok) => { if (fb) { fb.textContent = msg; fb.className = 'register-feedback ' + (ok ? 'success' : 'error'); } };

if (!defPw) { setFb(t('enterDefaultPwAll'), false); return; }

const club    = (typeof getMyClub === 'function') ? getMyClub() : { id: null };
if (!club.id) { setFb(t('noClubSelectedJoin'), false); return; }

const pending = _regStagingList.filter(p => p.status === 'pending' || p.status === 'error');
if (!pending.length) return;

btn.disabled = true;
setFb(t('registeringDot'), true);

let successCount = 0, failCount = 0;

for (let i = 0; i < _regStagingList.length; i++) {
const p = _regStagingList[i];
if (p.status === 'success') continue;
const playerRating = Number(p.rating);
if (!Number.isFinite(playerRating) || playerRating < 1 || playerRating > 5) {
  _regStagingList[i].status = 'error';
  failCount++;
  if (typeof regRenderStaging === 'function') regRenderStaging();
  continue;
}
try {
const cleanName = scsRequireValidPlayerName(p.name);
_regStagingList[i].name = cleanName;
// Check duplicate
const existing = await sbGet('memberships',
'club_id=eq.' + club.id + '&nickname=ilike.' + encodeURIComponent(cleanName) + '&select=id');
if (existing && existing.length) { _regStagingList[i].status = 'duplicate'; failCount++; continue; }

  // Create player row
  const created = await sbPost('players', {
    name:             cleanName,
    gender:           p.gender,
    global_rating:    playerRating,
    global_points:    0,
    default_password: defPw
  });
  const player = created[0];

  // Create membership -- no auto-link, player must claim via default password
  await sbPost('memberships', {
    player_id:   player.id,
    club_id:     club.id,
    nickname:    cleanName,
    club_rating: playerRating,
    club_points: 0
  });

  _regStagingList[i].status = 'success';
  successCount++;
} catch(e) {
  _regStagingList[i].status = 'error';
  failCount++;
}
if (typeof regRenderStaging === 'function') regRenderStaging();

}

btn.disabled = false;
const parts = [];
if (successCount) parts.push('✅ ' + successCount + ' ' + (t('registeredBadge')||'registered'));
if (failCount)    parts.push('⚠️ ' + failCount + ' skipped');
setFb(parts.join('  '), !failCount);

localStorage.removeItem('kbrr_cache_players');
localStorage.removeItem('kbrr_cache_ts');

// Show Add all to Session button if any succeeded
if (successCount > 0) {
  const successPlayers = _regStagingList.filter(p => p.status === 'success').map(p => ({ name: p.name, gender: p.gender || 'Male' }));
  const existingAddBtn = document.getElementById('vregBulkAddToSessionBtn');
  if (existingAddBtn) existingAddBtn.remove();
  const addBtn = document.createElement('button');
  addBtn.className = 'register-add-session-btn';
  addBtn.id = 'vregBulkAddToSessionBtn';
  addBtn.textContent = '+ Add ' + successCount + ' player' + (successCount > 1 ? 's' : '') + ' to Today\'s Session';
  addBtn.onclick = function() { vaultBulkAddToSession(successPlayers, this); };
  btn.parentNode.insertBefore(addBtn, btn.nextSibling); // insert AFTER Register All btn
}
}

async function vaultDoRegisterPlayer() {
const club     = (typeof getMyClub === 'function') ? getMyClub() : { id: null };
const nicknameInput = document.getElementById('vregNickname');
let nickname = nicknameInput ? nicknameInput.value : '';
const gender   = document.getElementById('vregGender')?.value || 'Male';
const ratingInput = document.getElementById('vregRating');
const ratingRaw = ratingInput?.value ?? '';
const rating   = Number(ratingRaw);
const defPw    = document.getElementById('vregDefaultPassword')?.value.trim();
const fb       = document.getElementById('vregFeedback');
const setFb    = (msg, ok) => { if (fb) { fb.textContent = msg; fb.style.color = ok ? 'var(-green,#2dce89)' : 'var(-red,#e63757)'; } };

if (!club.id)   { setFb(t('noClubSelectedJoin'), false); return; }
try { nickname = scsRequireValidPlayerName(nickname); }
catch (e) { setFb(e.message || t('invalidPlayerName'), false); return; }
if (nicknameInput) nicknameInput.value = nickname;
if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
  setFb((localStorage.getItem('appLanguage') || 'en') === 'jp' ? 'レーティングは1から5の間で入力してください。' : 'Rating must be between 1 and 5.', false);
  if (ratingInput) ratingInput.focus();
  return;
}
if (!defPw)     { setFb(t('enterDefaultPw'), false); return; }

setFb(t('registeringDot'), true);
try {
// Check nickname not already in this club
const existing = await sbGet('memberships',
'club_id=eq.' + club.id + '&nickname=ilike.' + encodeURIComponent(nickname) + '&select=id');
if (existing && existing.length) { setFb(t('nicknameExists'), false); return; }

// Create player row
const created = await sbPost('players', {
  name:             nickname,
  gender:           gender,
  global_rating:    rating,
  global_points:    0,
  default_password: defPw
});
const player = created[0];

// Create membership -- player must claim via default password
await sbPost('memberships', {
  player_id:   player.id,
  club_id:     club.id,
  nickname:    nickname,
  club_rating: rating,
  club_points: 0
});

setFb('✅ ' + nickname + ' registered!', true);
// Show Add to Session button
const addBtn = document.getElementById('vregAddToSessionBtn');
if (addBtn) {
  addBtn.style.display = '';
  addBtn.dataset.name   = nickname;
  addBtn.dataset.gender = gender;
}
// Clear fields for next entry
document.getElementById('vregNickname').value = '';
document.getElementById('vregDefaultPassword').value = '';
document.getElementById('vregRating').value = '1.0';
// Invalidate player cache
localStorage.removeItem('kbrr_cache_players');
localStorage.removeItem('kbrr_cache_ts');

} catch(e) {
setFb('❌ ' + e.message, false);
}
}

function vaultSyncStatus() {
const club = (typeof getMyClub === 'function') ? getMyClub() : { id: null, name: null };
const mode = (typeof getClubMode === 'function') ? getClubMode() : null;

const dot   = document.getElementById('vaultStatusDot');
const name  = document.getElementById('vaultStatusName');
const role  = document.getElementById('vaultStatusRole');
const strip = document.getElementById('vaultStatusStrip');

if (!name) return; // vault section not yet in DOM

if (club.name) {
if (name)  name.textContent  = club.name;
if (dot)   { dot.style.background = '#2dce89'; dot.style.boxShadow = '0 0 0 3px rgba(45,206,137,0.2)'; }
if (strip) strip.style.borderColor = 'rgba(45,206,137,0.2)';
if (role) {
role.style.display = 'inline-block';
if (mode === 'admin') { role.textContent = t('adminBadge')||'ADMIN'; role.style.background = '#2dce89'; role.style.color = '#000'; }
else                  { role.textContent = t('userBadge')||'USER';  role.style.background = 'var(-accent)'; role.style.color = '#fff'; }
}
// Modify tab -- admin only
const modifyBtn = document.getElementById('vaultTabModifyBtn');
if (modifyBtn) modifyBtn.style.display = mode === 'admin' ? '' : 'none';
} else {
if (name)  name.textContent  = t('noClubSelected');
if (dot)   { dot.style.background = 'var(-muted)'; dot.style.boxShadow = 'none'; }
if (role)  role.style.display = 'none';
}

}

function sbRenderRatingMode(isTrusted) {
// global mode blocked until fully tested -- hide UI always
const wrap = document.getElementById("sbRatingModeWrap");
if (wrap) wrap.style.display = "none";
localStorage.setItem("kbrr_rating_mode", "local");
}

function sbSetRatingMode(mode) {
localStorage.setItem("kbrr_rating_mode", mode);
document.getElementById("sbRatingGlobal")?.classList.toggle("active", mode === "global");
document.getElementById("sbRatingLocal")?.classList.toggle("active",  mode === "local");
// Re-sync so activeRating is recomputed from the correct field for the new mode
if (typeof syncToLocal === "function") syncToLocal();
}

function sbClearClub() {
clearMyClub();
localStorage.removeItem('kbrr_club_mode');
localStorage.removeItem('kbrr_club_trusted');
localStorage.removeItem('kbrr_rating_mode');
localStorage.removeItem('kbrr_rating_field');
localStorage.removeItem('kbrr_rating_field');

// Clear all player data on logout
localStorage.removeItem('newImportHistory');
localStorage.removeItem('schedulerPlayers');
if (typeof newImportState !== 'undefined' && newImportState) {
newImportState.historyPlayers = [];
newImportState.selectedPlayers = [];
}
if (typeof schedulerState !== 'undefined' && schedulerState) {
schedulerState.allPlayers    = [];
schedulerState.activeplayers = [];
}

document.getElementById('sbRatingModeWrap') && (document.getElementById('sbRatingModeWrap').style.display = 'none');
sbRenderClubStatus();
vaultSyncStatus();
if (typeof clubLoginRefresh === 'function') clubLoginRefresh();
updateRegisterTabVisibility();

// Reset app mode to viewer after club logout
localStorage.setItem('kbrr_app_mode', 'viewer');
sessionStorage.setItem('appMode', 'viewer');
if (typeof appMode !== 'undefined') appMode = 'viewer';
if (typeof updateModePill === 'function') updateModePill('viewer');
}

// sbDeleteClub replaced by clubDeleteSendOtp/clubDeleteVerify (OTP flow)

async function sbPopulateDeleteDropdown() {
const select = document.getElementById("sbDeleteClubSelect");
if (!select) return;
// Only show the currently connected club — prevent deleting other clubs
const myClub = getMyClub();
select.innerHTML = '<option value="">' + (t('selectClubDelete')||'-- Select club to delete --') + '</option>';
if (myClub && myClub.id && myClub.name) {
  const opt = document.createElement("option");
  opt.value = myClub.id;
  opt.textContent = myClub.name;
  select.appendChild(opt);
}
}

function getClubMode() {
return localStorage.getItem("kbrr_club_mode") || null; // "admin" | "user" | null
}

function isAdminMode() {
return getClubMode() === "admin";
}

// sbCreateClub replaced by clubCreateSendOtp/clubCreateVerify (OTP flow)

function sbFeedback(msg, color) {
const el = document.getElementById("sbClubFeedback");
if (!el) return;
el.textContent = msg;
el.style.color = color === "green" ? "#2dce89" : color === "red" ? "#e63757" : "#888";
}

function updateRegisterTabVisibility() {
// Vault tab moved to top nav -- no longer in import modal, nothing to update here
}

/* =============================================================
PLAYER STATS MODAL
============================================================= */
async function showPlayerStats(name) {
const modal    = document.getElementById("playerStatsModal");
const content  = document.getElementById("playerStatsContent");
if (!modal || !content) return;

content.innerHTML = "<div class='stats-loading'>" + t('loading') + "</div>";
modal.style.display = "flex";

try {
const rows = await sbGet(
"players",
`name=ilike.${encodeURIComponent(name)}&select=name,gender,wins,losses,sessions`
);
if (!rows || !rows.length) {
content.innerHTML = "<div class='stats-loading'>" + t('playerNotFound') + "</div>";
return;
}
const p      = rows[0];
const gender = p.gender || "Male";
// Single gate -- sync first, then read activeRating
await syncToLocal();
const rating = getActiveRating(name).toFixed(1);
const wins     = p.wins   || 0;
const losses   = p.losses || 0;
const sessions = Array.isArray(p.sessions) ? p.sessions : [];
const genderImg = gender === "Female" ? "female.png" : "male.png";
const total    = wins + losses;
const winPct   = total > 0 ? Math.round((wins / total) * 100) : 0;

const sessionRows = sessions.length
  ? sessions.map(s => `
      <tr>
        <td>${s.date || "--"}</td>
        <td>${s.wins || 0}</td>
        <td>${s.losses || 0}</td>
        <td>${parseFloat(s.rating || 0).toFixed(1)}</td>
      </tr>`).join("")
  : `<tr><td colspan="4" style="text-align:center;color:var(--muted)">No sessions yet</td></tr>`;

content.innerHTML = `
  <div class="stats-header">
    <img src="${genderImg}" class="stats-avatar">
    <div class="stats-name">${p.name}</div>
    <div class="stats-gender">${gender}</div>
  </div>
  <div class="stats-row">
    <div class="stats-box">
      <div class="stats-box-value">${rating}</div>
      <div class="stats-box-label">Rating</div>
    </div>
    <div class="stats-box">
      <div class="stats-box-value">${wins}</div>
      <div class="stats-box-label">Wins</div>
    </div>
    <div class="stats-box">
      <div class="stats-box-value">${losses}</div>
      <div class="stats-box-label">Losses</div>
    </div>
    <div class="stats-box">
      <div class="stats-box-value">${winPct}%</div>
      <div class="stats-box-label">Win %</div>
    </div>
  </div>
  <div class="stats-section-title">Recent Sessions</div>
  <table class="stats-table">
    <thead>
      <tr><th>Date</th><th>W</th><th>L</th><th>Rating</th></tr>
    </thead>
    <tbody>${sessionRows}</tbody>
  </table>
`;

} catch (e) {
content.innerHTML = "<div class='stats-loading'>Failed to load stats.</div>";
}
}

function closePlayerStats() {
const modal = document.getElementById("playerStatsModal");
if (modal) modal.style.display = "none";
}

/* ── Mode Launcher -- Language Picker ── */
function _mlLangLabel() {
var saved = localStorage.getItem('appLanguage') || 'en';
var map = { en: '🇺🇸 English', jp: '🇯🇵 日本語', kr: '🇰🇷 한국어', zh: '🇨🇳 中文', vi: '🇻🇳 Tiếng Việt' };
return map[saved] || '🇺🇸 English';
}

function mlToggleLang() {
var picker = document.getElementById('mlLangPicker');
if (picker) picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
}

function mlSelectLang(code, flag, name) {
// Close every legacy picker instance before and after applying the language.
document.querySelectorAll('.ml-lang-picker').forEach(function(p) { p.style.display = 'none'; });
// Apply language and update display
settingsSelectLang(code, flag, name);
mlSyncLangDisplay();
document.querySelectorAll('.ml-lang-picker').forEach(function(p) { p.style.display = 'none'; });
}

function mlSyncLangDisplay() {
var saved = localStorage.getItem('appLanguage') || 'en';
if (typeof setLanguage === 'function' && typeof currentLang !== 'undefined' && currentLang !== saved) {
setLanguage(saved);
}
var label = _mlLangLabel();
var el = document.getElementById('mlLangCurrent');
if (el) el.textContent = label + ' ▾';
// Also sync auth welcome lang button
var authEl = document.getElementById('authLangCurrent');
if (authEl) authEl.textContent = label + ' ▾';
}

/* ── Auth welcome screen lang toggle (separate IDs to avoid conflict) ── */
function authToggleLang() {
  var picker = document.getElementById('authLangPicker');
  if (picker) picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
}

function authSelectLang(code, flag, name) {
  var picker = document.getElementById('authLangPicker');
  if (picker) picker.style.display = 'none';
  settingsSelectLang(code, flag, name);
  mlSyncLangDisplay();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLanguage, { once: true });
} else {
  initLanguage();
}


/* ============================================================
   BUILD 490 — Settings-controlled single sync schedule
   kbrr_last_sync is the only persisted sync status/timestamp.
============================================================ */
var _scsSettingsSyncTimer = null;
var _scsSyncGatewayPromise = null;

function scsGetSyncInterval() {
  var value = parseInt(localStorage.getItem('scs_sync_interval_minutes') || '5', 10);
  return [0,1,5,15,30,60].includes(value) ? value : 5;
}

function scsReadLastSync() {
  try {
    var raw = localStorage.getItem('kbrr_last_sync');
    if (!raw) return null;
    var saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return null;
    // Older builds stored only the human-readable message. Keep it readable,
    // but do not invent a time that was never recorded.
    return saved;
  } catch (_) { return null; }
}

function scsFormatLastSync(timestamp) {
  if (!timestamp) return (typeof t === 'function' ? t('never') : 'Never');
  try {
    return new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
      day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'
    }).format(new Date(Number(timestamp)));
  } catch (_) { return new Date(Number(timestamp)).toLocaleString(); }
}

function scsUpdateSyncSettingsUI() {
  var interval = scsGetSyncInterval();
  var select = document.getElementById('settingsSyncInterval');
  if (select) select.value = String(interval);
  var saved = scsReadLastSync();
  var lastEl = document.getElementById('settingsLastSync');
  if (lastEl) lastEl.textContent = saved && saved.at ? scsFormatLastSync(saved.at) : (typeof t === 'function' ? t('never') : 'Never');
  var head = document.getElementById('settingsHeaderSyncStatus');
  if (head) head.textContent = (typeof t === 'function' ? t('sync') : 'Sync');
}

function scsHasActiveRoundSession() {
  // Compatibility helper: background workspace sync is paused for the entire
  // time Round Manager is visible, even before a live session is started.
  try {
    return typeof window.scsIsRoundManagerVisible === 'function' && window.scsIsRoundManagerVisible();
  } catch (_) {
    return false;
  }
}

function scsScheduleAutoSync() {
  if (_scsSettingsSyncTimer) clearInterval(_scsSettingsSyncTimer);
  _scsSettingsSyncTimer = null;
  var minutes = scsGetSyncInterval();
  if (!minutes) return;
  _scsSettingsSyncTimer = setInterval(function() {
    if (document.visibilityState !== 'visible') return;
    if (scsHasActiveRoundSession()) return;
    scsSyncGateway('auto', true);
  }, minutes * 60 * 1000);
}

function scsSetSyncInterval(value) {
  var minutes = parseInt(value, 10);
  if (![0,1,5,15,30,60].includes(minutes)) minutes = 5;
  localStorage.setItem('scs_sync_interval_minutes', String(minutes));
  scsScheduleAutoSync();
  var message = document.getElementById('settingsSyncMessage');
  if (message) message.textContent = minutes ? ((typeof t === 'function' ? t('autoSyncSet') : 'Automatic sync updated.')) : ((typeof t === 'function' ? t('manualSyncSet') : 'Automatic sync is off.'));
}

async function scsSyncGateway(source, quiet) {
  // One gateway and one in-flight promise for startup/resume/automatic/manual requests.
  if (_scsSyncGatewayPromise) return _scsSyncGatewayPromise;

  var buttons = [document.getElementById('settingsHeaderSyncBtn'), document.getElementById('settingsSyncNowBtn')].filter(Boolean);
  buttons.forEach(function(btn){ btn.disabled = true; btn.classList.add('is-syncing'); });
  var message = document.getElementById('settingsSyncMessage');
  if (message && !quiet) message.textContent = (typeof t === 'function' ? t('syncing') : 'Syncing…');

  _scsSyncGatewayPromise = (async function() {
    try {
      if (typeof flushSyncQueue === 'function') await flushSyncQueue();

      // The original server-master player sync remains the authoritative core.
      // It records kbrr_last_sync and emits scs:data-synced on completion.
      if (typeof syncToLocal === 'function') await syncToLocal();

      var jobs = [];
      function add(fn) { if (typeof fn === 'function') jobs.push(Promise.resolve().then(fn)); }
      add(typeof syncGlobalPlayersCache === 'function' ? syncGlobalPlayersCache : null);
      add(typeof restoreUserClubRoles === 'function' ? restoreUserClubRoles : null);
      add(typeof getOrganiserEligibleClubs === 'function' ? getOrganiserEligibleClubs : null);
      add(typeof _mcsLoadMonthSlots === 'function' ? _mcsLoadMonthSlots : null);
      add(typeof _vhsLoadMonthSlots === 'function' ? _vhsLoadMonthSlots : null);
      add(typeof renderLauncherStartSessionCard === 'function' ? renderLauncherStartSessionCard : null);
      await Promise.allSettled(jobs);
      if (typeof window.scsPrefetchWelcomeHubData === 'function') await window.scsPrefetchWelcomeHubData();

      // If the core sync could not write a status (for example no club selected),
      // record completion here using the same canonical key.
      var saved = scsReadLastSync();
      var now = Date.now();
      if (!saved || !saved.at) {
        localStorage.setItem('kbrr_last_sync', JSON.stringify({
          msg: (typeof t === 'function' ? t('syncCompleted') : 'Sync completed.'),
          color: '#2dce89', at: now, ok: true
        }));
        window.dispatchEvent(new CustomEvent('scs:data-synced', { detail:{ source:source || 'manual', at:now, ok:true } }));
      }
      scsUpdateSyncSettingsUI();
      if (message && !quiet) message.textContent = (typeof t === 'function' ? t('syncCompleted') : 'Sync completed.');
      return true;
    } catch (error) {
      console.warn('SCS sync gateway failed:', error);
      if (message && !quiet) message.textContent = (typeof t === 'function' ? t('syncFailed') : 'Sync failed. Please try again.');
      return false;
    } finally {
      buttons.forEach(function(btn){ btn.disabled = false; btn.classList.remove('is-syncing'); });
      _scsSyncGatewayPromise = null;
    }
  })();
  return _scsSyncGatewayPromise;
}

// Keep the UI callback name for existing HTML, but route it to the one gateway.
function scsRunManualSync(source, quiet) { return scsSyncGateway(source || 'manual', !!quiet); }
window.scsSyncGateway = scsSyncGateway;
window.scsRunManualSync = scsRunManualSync;
window.scsSetSyncInterval = scsSetSyncInterval;

window.addEventListener('scs:data-synced', scsUpdateSyncSettingsUI);
window.addEventListener('storage', function(event) {
  if (event.key === 'kbrr_last_sync') scsUpdateSyncSettingsUI();
});
document.addEventListener('DOMContentLoaded', function() {
  scsUpdateSyncSettingsUI();
  scsScheduleAutoSync();
});
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState !== 'visible') return;
  var minutes = scsGetSyncInterval();
  var saved = scsReadLastSync();
  var last = saved && Number(saved.at) ? Number(saved.at) : 0;
  if (scsHasActiveRoundSession()) return;
  if (minutes && Date.now() - last >= minutes * 60 * 1000) scsSyncGateway('resume', true);
});
