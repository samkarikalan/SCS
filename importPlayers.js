/* ============================================================
   IMPORT PLAYERS MODAL
   File: importPlayers.js
   ============================================================ */

/* =========================
   HELPERS
========================= */

// Universal unique-add utility -- used for all three lists
function addToListIfNotExists(list, player) {
  const exists = list.findIndex(
    p => p.displayName.trim().toLowerCase() === player.displayName.trim().toLowerCase()
  );
  if (exists >= 0) return false;
  list.push({ ...player });
  return true;
}

function newImportDeduplicate(list) {
  const map = new Map();
  list.forEach(player => {
    const key = player.displayName.trim().toLowerCase();
    map.set(key, player); // keep latest
  });
  return Array.from(map.values());
}

// Shared gender lookup builder
function buildGenderLookup() {
  const lookup = { male: "Male", m: "Male", female: "Female", f: "Female" };
  if (typeof translations !== "undefined") {
    Object.values(translations).forEach(langObj => {
      if (langObj.male)   lookup[langObj.male.toLowerCase()]   = "Male";
      if (langObj.female) lookup[langObj.female.toLowerCase()] = "Female";
    });
  }
  return lookup;
}

// Parse raw textarea text into [{ displayName, gender }]
function parsePlayerLines(text, defaultGender) {
  const genderLookup = buildGenderLookup();
  const players = [];

  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;

    // Stop at waitlist/court full section
    if (/court full|waitlist|\bwl\b/i.test(line)) break;

    // Skip non-player lines (URLs, markdown headers, date/time, venue)
    if (/https?:\/\//i.test(line)) continue;
    if (/^\*|\*$/.test(line)) continue;  // skip lines starting or ending with *
    if (/\d{1,2}:\d{2}/.test(line)) continue;
    if (/\d{1,2}-[A-Za-z]{3}/.test(line)) continue;

    let gender = defaultGender;

    // Remove leading numbering: "1. John" → "John"
    const numMatch = line.match(/^(\d+\.?\s*)?(.*)$/);
    if (numMatch) line = numMatch[2].trim();
    line = line.replace(/\.$/, '').trim();
    // Remove trailing dot: "Anand P." → "Anand P"
    line = line.replace(/\.$/, '').trim();

    // "name, gender" format
    if (line.includes(",")) {
      const [name, g] = line.split(",").map(p => p.trim());
      line = name;
      if (g && genderLookup[g.toLowerCase()]) gender = genderLookup[g.toLowerCase()];
    }

    // Parentheses are commonly used by SlotBookings to show the actual player nickname:
    //   "Krishna (Kalyan)" -> "Kalyan"
    // Keep the old gender shorthand behaviour for values such as "John (M)".
    const parenMatch = line.match(/\(([^)]+)\)/);
    if (parenMatch) {
      const insideRaw = parenMatch[1].trim();
      const insideKey = insideRaw.toLowerCase();
      if (genderLookup[insideKey]) {
        gender = genderLookup[insideKey];
        line = line.replace(/\([^)]+\)/, "").trim();
      } else if (insideRaw) {
        line = insideRaw;
      }
    }

    // Remove decorative emoji/symbols while preserving multilingual names.
    // Example: "Shivam✨" -> "Shivam"; Japanese/other letters remain intact.
    try {
      line = line.replace(/[^\p{L}\p{M}\p{N}\s.'_-]/gu, '').replace(/\s+/g, ' ').trim();
    } catch (e) {
      line = line.replace(/[★☆✨⭐️]/g, '').trim();
    }

    if (!line) continue;
    addToListIfNotExists(players, { displayName: line, gender });
  }

  return players;
}

/* =========================
   STATE
========================= */
const newImportState = {
  historyPlayers:     [],
  favoritePlayers:    [],
  selectedPlayers:    [],
  currentSelectMode:  "history",
  unavailablePlayers: new Set()
};

/* ── Availability helper -- used by ALL card renderers ── */
function playerAvailDot(displayName) {
  const key = (displayName || "").trim().toLowerCase();
  const busy = (newImportState.unavailablePlayers || new Set()).has(key) ||
    (newImportState.slotUnavailablePlayers || new Set()).has(key);
  return ``;
}
function playerIsBusy(displayName) {
  const key = (displayName || "").trim().toLowerCase();
  return (newImportState.unavailablePlayers || new Set()).has(key) ||
    (newImportState.slotUnavailablePlayers || new Set()).has(key);
}

let newImportModal;
let newImportSelectCards;
let newImportSelectedCards;
let newImportSelectedCount;
let newImportSearch;

/* =========================
   INIT
========================= */
document.addEventListener("DOMContentLoaded", () => {
  newImportModal         = document.getElementById("newImportModal");
  newImportSelectCards   = document.getElementById("newImportSelectCards");
  newImportSelectedCards = document.getElementById("newImportSelectedCards");
  newImportSelectedCount = document.getElementById("newImportSelectedCount");
  newImportSearch        = document.getElementById("newImportSearch");

  newImportLoadHistory();
  newImportLoadFavorites();
  newImportRefreshSelectCards();
  newImportRefreshSelectedCards();

  newImportSelectCards.addEventListener("click", newImportHandleCardClick);
  newImportSearch.addEventListener("input", newImportRefreshSelectCards);

  // Selected cards click handler
  newImportSelectedCards.addEventListener("click", newImportHandleSelectedCardClick);

  // Browse list click handler — checks clicked element then walks up to card for tap-to-add
  document.addEventListener("click", function(e) {
    let browseAction = e.target.dataset.browseAction;
    let browsePlayer = e.target.dataset.browsePlayer;

    // If no action on element, check parent card for any browse-action
    if (!browseAction) {
      const card = e.target.closest('[data-browse-action]');
      if (card) {
        browseAction = card.dataset.browseAction;
        browsePlayer = card.dataset.browsePlayer;
      }
    }

    if (!browseAction || !browsePlayer) return;
    newImportHandleBrowseCardClick(browseAction, browsePlayer);
  });
});

/* =========================
   MODAL OPEN / CLOSE
========================= */
function newImportShowModal() {
  // The same Existing Players modal is also used inside Slot Manager ->
  // Create Slot.  When any Assist child is open it must be lifted above the
  // Assist child/sheet stack, not only when PlayersPage is the child.
  var assistPlayersPage = document.getElementById('playersPage');
  var assistChildOpen = document.body.classList.contains('scs-guide-child-open') ||
    !!document.querySelector('.scs-assist-child-page') ||
    !!(assistPlayersPage && assistPlayersPage.classList.contains('scs-assist-child-page'));
  newImportModal.classList.toggle('scs-assist-import-modal', assistChildOpen);
  newImportModal.style.display = "flex";
  syncPlayersFromMaster(); // ensure latest ratings before rendering
  newImportLoadHistory();
  newImportLoadFavorites();
  _newImportFilterToClub(); // filter both to current club (async, refreshes cards when done)

  // Pre-populate selected list with currently active players
  newImportState.selectedPlayers = [];
  if (typeof schedulerState !== 'undefined' && schedulerState.allPlayers) {
    schedulerState.allPlayers.filter(p => p.active).forEach(function(p) {
      newImportState.selectedPlayers.push({ displayName: p.name, gender: p.gender || 'Male' });
    });
  }

  newImportRefreshSelectCards();
  newImportRefreshSelectedCards();
  // Default to Browse tab and load players immediately
  addPlayersShowTab('browse');

  // Hide Replace button — not needed anymore (we update in place)
  var replaceBtn = document.getElementById('newImportReplaceBtn');
  if (replaceBtn) replaceBtn.style.display = 'none';

  // Update Add button label
  var addBtn = document.getElementById('newImportAddBtn');
  if (addBtn) {
    var hasPlayers = typeof schedulerState !== 'undefined' &&
      schedulerState.allPlayers && schedulerState.allPlayers.some(p => p.active);
    addBtn.textContent = t(hasPlayers ? 'update' : 'add');
  }
  // Load availability status in background -- refresh cards when done
  if (typeof dbGetUnavailablePlayers === "function") {
    dbGetUnavailablePlayers().then(unavailable => {
      newImportState.unavailablePlayers = unavailable;
      newImportRefreshSelectCards();
    });
  }
}

function newImportHideModal() {
  newImportModal.style.display = "none";
  newImportModal.classList.remove('scs-assist-import-modal');
  if (newImportModal.dataset) {
    delete newImportModal.dataset.returnMode;
    delete newImportModal.dataset.targetSlotId;
  }
  window._newImportReturnMode = null;
  window._vsAddPlayersTargetSlotId = null;
  newImportState.selectedPlayers = [];
  newImportState.slotUnavailablePlayers = new Set();
}

/* =========================
   TAB SWITCH
========================= */
function newImportShowSelectMode(mode) {
  newImportState.currentSelectMode = mode;

  document.querySelectorAll(".newImport-subtab-btn")
    .forEach(btn => btn.classList.remove("active"));

  document.getElementById(
    "newImport" + mode.charAt(0).toUpperCase() + mode.slice(1) + "Btn"
  )?.classList.add("active");

  const clearHistory   = document.getElementById("newImportClearHistoryBtn");
  const clearFavorites = document.getElementById("newImportClearFavoritesBtn");
  const listContainer  = document.getElementById("newImportSelectCards");
  const addSection     = document.getElementById("newImportAddPlayersSection");
  const searchInput    = document.getElementById("newImportSearch");

  // Always hide vault section (removed from import modal)
  const vaultSection = document.getElementById("newImportVaultSection");
  if (vaultSection) vaultSection.style.display = "none";

  if (mode === "addplayers") {
    listContainer.style.display  = "none";
    addSection.style.display     = "block";
    searchInput.style.display    = "none";
    clearHistory.style.display   = "none";
    clearFavorites.style.display = "none";
    const ta = document.getElementById("players-names");
    if (ta && typeof translations !== "undefined" && translations[currentLang]?.importExample) {
      ta.placeholder = translations[currentLang].importExample;
    }
    return;
  }

  // Leaving addplayers tab -- reset star toggle state
  newImportResetFavToggle();

  listContainer.style.display = "flex";
  addSection.style.display    = "none";
  searchInput.style.display   = "block";

  if (mode === "history") {
    clearHistory.style.display   = "block";
    clearFavorites.style.display = "none";
  } else {
    clearHistory.style.display   = "none";
    clearFavorites.style.display = "block";
  }

  newImportRefreshSelectCards();
}

/* =========================
   VALID PLAYER NAME FILTER
   Strips junk from old paste-import leftovers
========================= */
function isValidPlayerName(name) {
  if (!name || typeof name !== "string") return false;
  const n = name.trim();
  if (n.length < 2)   return false;       // too short
  if (n.length > 40)  return false;       // too long (URLs, sentences)
  if (n.startsWith("*")) return false;    // schedule/annotation lines
  if (n.includes("http")) return false;   // URLs
  if (n.includes("www.")) return false;   // URLs
  if (n.includes(".com")) return false;   // URLs
  if (n.includes(".slotbooking")) return false;
  if (/^[\d\s\-:\/]+$/.test(n)) return false;  // pure numbers/dates/times
  return true;
}

/* =========================
   STORAGE -- HISTORY
========================= */
function newImportLoadHistory() {
  const raw = JSON.parse(localStorage.getItem("newImportHistory") || "[]");
  newImportState.historyPlayers = raw.filter(p => p && p.displayName);
  // Filter to club members if logged in
  _newImportFilterToClub();
}

// Filter history and favourites to only players in the current club
async function _newImportFilterToClub() {
  const club = (typeof getMyClub === 'function') ? getMyClub() : { id: null };
  if (!club.id) return; // no club -- show all history as-is

  try {
    const clubPlayers = await dbGetPlayers();
    if (!clubPlayers || !clubPlayers.length) return;
    const clubNames = new Set(clubPlayers.map(p => p.name.trim().toLowerCase()));

    // Filter history
    newImportState.historyPlayers = newImportState.historyPlayers.filter(
      p => clubNames.has((p.displayName || '').trim().toLowerCase())
    );

    // Filter favourites
    newImportState.favoritePlayers = newImportState.favoritePlayers.filter(
      p => clubNames.has((p.displayName || '').trim().toLowerCase())
    );

    newImportRefreshSelectCards();
  } catch(e) { /* silent -- fall back to unfiltered */ }
}

/* =========================
   STORAGE -- FAVORITES (individual players)
========================= */
function newImportLoadFavorites() {
  const data = localStorage.getItem("newImportFavorites");
  newImportState.favoritePlayers = data ? newImportDeduplicate(JSON.parse(data)) : [];
  localStorage.setItem("newImportFavorites", JSON.stringify(newImportState.favoritePlayers));
}

function newImportSaveFavorites() {
  localStorage.setItem("newImportFavorites", JSON.stringify(newImportState.favoritePlayers));
}

/* =========================
   STORAGE -- FAVORITE SETS
========================= */
function newImportLoadFavoriteSets() {
  try { return JSON.parse(localStorage.getItem("newImportFavoriteSets") || "[]"); }
  catch { return []; }
}

function newImportSaveFavoriteSets(sets) {
  localStorage.setItem("newImportFavoriteSets", JSON.stringify(sets));
}

/* =========================
   RENDER -- SELECT CARDS
========================= */
function newImportRefreshSelectCards() {
  if (newImportState.currentSelectMode === "addplayers") return;

  newImportSelectCards.innerHTML = "";

  // ── Favorite Sets (top of favorites tab only) ──
  if (newImportState.currentSelectMode === "favorites") {
    const sets = newImportLoadFavoriteSets();
    sets.forEach(set => {
      const safeName = set.name.replace(/'/g, "\\'");
      const setCard  = document.createElement("div");
      setCard.className    = "newImport-set-card";
      setCard.dataset.open = "false";

      setCard.innerHTML = `
        <div class="newImport-set-header">
          <div class="newImport-set-info">
            <span class="newImport-set-icon">★</span>
            <span class="newImport-set-name">${set.name}</span>
            <span class="newImport-set-count">${set.players.length} players</span>
            <span class="newImport-set-chevron">▶</span>
          </div>
          <div class="newImport-set-actions">
            <button class="newImport-set-addall-btn" data-setname="${safeName}">+ All</button>
            <button class="newImport-set-delete-btn" data-setname="${safeName}">×</button>
          </div>
        </div>
        <div class="newImport-set-players" style="display:none">
          ${set.players.map(p => {
            const busy = playerIsBusy(p.displayName);
            return `
            <div class="newImport-set-player-row${busy ? ' player-busy' : ''}">
              <img src="${p.gender === 'Male' ? 'male.png' : 'female.png'}"
                class="newImport-set-player-img"
                style="${busy ? 'opacity:0.4' : ''}; cursor:default">
              <span class="newImport-set-player-name" style="${busy ? 'opacity:0.5' : ''}">${p.displayName}</span>
              ${playerAvailDot(p.displayName)}
              <span class="rating-badge" style="font-size:0.68rem;padding:2px 5px;" data-player="${p.displayName}">${getActiveRating(p.displayName).toFixed(1)}</span>
              <button class="newImport-set-player-remove-btn"
                data-setname="${safeName}"
                data-name="${p.displayName.replace(/"/g, '&quot;')}">×</button>
              <button class="newImport-set-player-add-btn ${busy ? 'disabled-btn' : ''}"
                data-name="${p.displayName.replace(/"/g, '&quot;')}"
                data-gender="${p.gender}"
                ${busy ? "disabled title=t('alreadyPlayingSession')" : ""}>+</button>
            </div>`;
          }).join("")}
          <div class="newImport-set-addplayer-row" style="position:relative">
            <input type="text"
              class="newImport-set-addplayer-input"
              data-setname="${safeName}"
              autocomplete="off"
              placeholder="${t('searchToAddPlayer')}">
            <div class="newImport-set-addplayer-dropdown" data-setname="${safeName}" style="display:none"></div>
          </div>
        </div>
      `;

      newImportSelectCards.appendChild(setCard);
    });
  }

  // ── Individual players (history / favorites) ──
  const source =
    newImportState.currentSelectMode === "favorites"
      ? [...newImportState.favoritePlayers]
      : [...newImportState.historyPlayers];

  source.sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" })
  );

  const search = newImportSearch.value.toLowerCase();

  // Get unavailable players from cache (populated on modal open)
  const unavailable = newImportState.unavailablePlayers || new Set();

  source
    .filter(p => p.displayName.toLowerCase().includes(search))
    .forEach(p => {
      const nameNorm  = p.displayName.trim().toLowerCase();
      const added     = newImportState.selectedPlayers.some(sp => sp.displayName.trim().toLowerCase() === nameNorm);
      const fav       = newImportState.currentSelectMode === "favorites"
        ? true
        : newImportState.favoritePlayers.some(fp => fp.displayName.trim().toLowerCase() === nameNorm);
      const card = document.createElement("div");
      // Only selectedPlayers drives green state — inSession removed to avoid stale override
      card.className = "newImport-player-card " + (p.gender === "Female" ? "female" : "male") + (added ? " player-added" : "");
      const rating1 = getActiveRating(p.displayName).toFixed(1);
      const statusDot = ``;

      // Always tappable — toggle add/remove based only on selectedPlayers
      card.dataset.browseAction = added ? 'remove-by-name' : 'add';
      card.dataset.browsePlayer = p.displayName;
      card.style.cursor = 'pointer';

      card.innerHTML = `
        <div class="newImport-player-top">
          <img src="${p.gender === "Male" ? "male.png" : "female.png"}" style="cursor:default">
          <div class="newImport-player-name">${p.displayName}${added ? ' <span style="font-size:0.7rem;color:#22c55e;">✓</span>' : ''}</div>
          ${statusDot}
        </div>
        <div class="newImport-player-actions">
          <span class="rating-badge" data-player="${p.displayName}">${rating1}</span>
          <button class="circle-btn favorite ${fav ? 'active-favorite' : ''}"
            data-action="favorite" data-player="${p.displayName}">
            ${fav ? "★" : "☆"}
          </button>
          <button class="circle-btn delete" data-action="delete" data-player="${p.displayName}">×</button>
        </div>
      `;
      newImportSelectCards.appendChild(card);
    });
}

/* =========================
   SET CARD CLICK HANDLER
   Handles expand, +All, ×delete, +player
   All via event delegation on newImportSelectCards
========================= */
document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("newImportSelectCards");
  container?.addEventListener("click",   newImportHandleSetClick);
  container?.addEventListener("keydown", newImportHandleSetClick);
  container?.addEventListener("input",   newImportHandleSetClick);
});

function newImportHandleSetClick(e) {

  // ── Expand / collapse set ──
  const setInfo = e.target.closest(".newImport-set-info");
  if (setInfo) {
    const setCard  = setInfo.closest(".newImport-set-card");
    const players  = setCard.querySelector(".newImport-set-players");
    const chevron  = setCard.querySelector(".newImport-set-chevron");
    const isOpen   = setCard.dataset.open === "true";
    setCard.dataset.open    = isOpen ? "false" : "true";
    players.style.display   = isOpen ? "none" : "block";
    chevron.textContent     = isOpen ? "▶" : "▼";
    return;
  }

  // ── + All button ──
  if (e.target.matches(".newImport-set-addall-btn")) {
    const setName = e.target.dataset.setname;
    newImportLoadSetToSelected(setName);
    return;
  }

  // ── × Delete set ──
  if (e.target.matches(".newImport-set-delete-btn")) {
    const setName = e.target.dataset.setname;
    newImportDeleteFavoriteSet(setName);
    return;
  }

  // ── Gender toggle for set player ──
  if (e.target.matches(".newImport-set-player-img")) {
    const setName  = e.target.dataset.setname;
    const name     = e.target.dataset.name;
    const sets     = newImportLoadFavoriteSets();
    const set      = sets.find(s => s.name === setName);
    if (!set) return;
    const player   = set.players.find(p => p.displayName === name);
    if (!player) return;
    player.gender  = player.gender === "Male" ? "Female" : "Male";
    newImportSaveFavoriteSets(sets);
    // Update img src immediately without full refresh
    e.target.src           = player.gender === "Male" ? "male.png" : "female.png";
    e.target.dataset.gender = player.gender;
    return;
  }

  // ── + Add new player to set from inline input ──
  // ── Search dropdown for add-to-set input ──
  if (e.target.matches(".newImport-set-addplayer-input") && e.type === "input") {
    const input   = e.target;
    const setName = input.dataset.setname;
    const query   = input.value.trim().toLowerCase();
    const dropdown = input.closest(".newImport-set-addplayer-row")
                        ?.querySelector(".newImport-set-addplayer-dropdown");
    if (!dropdown) return;

    if (!query) { dropdown.style.display = "none"; dropdown.innerHTML = ""; return; }

    const sets = newImportLoadFavoriteSets();
    const set  = sets.find(s => s.name === setName);
    const registered = newImportState.historyPlayers || [];
    const alreadyIn  = new Set((set?.players || []).map(p => p.displayName.trim().toLowerCase()));

    const matches = registered.filter(p =>
      p.displayName.toLowerCase().includes(query) &&
      !alreadyIn.has(p.displayName.trim().toLowerCase())
    ).slice(0, 8);

    if (!matches.length) {
      dropdown.innerHTML = "<div class='set-add-dropdown-empty'>' + t('noRegisteredPlayers') + '</div>";
      dropdown.style.display = "block";
      return;
    }

    dropdown.innerHTML = matches.map(p => `
      <div class="set-add-dropdown-item"
           data-setname="${setName.replace(/"/g, '&quot;')}"
           data-name="${p.displayName.replace(/"/g, '&quot;')}"
           data-gender="${p.gender || 'Male'}">
        <img src="${p.gender === 'Female' ? 'female.png' : 'male.png'}" class="gender-icon" style="width:16px;height:16px">
        ${p.displayName}
      </div>
    `).join("");
    dropdown.style.display = "block";
    return;
  }

  // ── Select from dropdown ──
  if (e.target.closest(".set-add-dropdown-item")) {
    const item    = e.target.closest(".set-add-dropdown-item");
    const setName = item.dataset.setname;
    const name    = item.dataset.name;
    const gender  = item.dataset.gender;

    const sets = newImportLoadFavoriteSets();
    const set  = sets.find(s => s.name === setName);
    if (!set) return;

    if (!set.players.some(p => p.displayName.trim().toLowerCase() === name.trim().toLowerCase())) {
      set.players.push({ displayName: name, gender: gender || "Male" });
      newImportSaveFavoriteSets(sets);
    }

    // Clear input + close dropdown
    const row = item.closest(".newImport-set-addplayer-row");
    if (row) {
      const inp = row.querySelector(".newImport-set-addplayer-input");
      const dd  = row.querySelector(".newImport-set-addplayer-dropdown");
      if (inp) inp.value = "";
      if (dd)  { dd.style.display = "none"; dd.innerHTML = ""; }
    }
    newImportRefreshSelectCards();
    return;
  }

  // ── Click outside closes dropdown ──
  if (!e.target.closest(".newImport-set-addplayer-row")) {
    document.querySelectorAll(".newImport-set-addplayer-dropdown").forEach(dd => {
      dd.style.display = "none"; dd.innerHTML = "";
    });
  }

  // ── × Remove single player from set ──
  if (e.target.matches(".newImport-set-player-remove-btn")) {
    const setName     = e.target.dataset.setname;
    const displayName = e.target.dataset.name;
    const sets        = newImportLoadFavoriteSets();
    const set         = sets.find(s => s.name === setName);
    if (set) {
      set.players = set.players.filter(p => p.displayName !== displayName);
      newImportSaveFavoriteSets(sets);
      newImportRefreshSelectCards();
    }
    return;
  }

  // ── + Add single player from set ──
  if (e.target.matches(".newImport-set-player-add-btn")) {
    const displayName = e.target.dataset.name;
    const gender      = e.target.dataset.gender;
    addToListIfNotExists(newImportState.selectedPlayers, { displayName, gender });
    // Visual feedback
    e.target.textContent = "✓";
    e.target.disabled    = true;
    newImportRefreshSelectedCards();
    return;
  }
}

/* =========================
   CARD ACTIONS (history / favorites individual players)
========================= */
function newImportHandleCardClick(e) {
  // Check clicked element first, then walk up to card for tap-to-add
  let action = e.target.dataset.action;
  let playerName = e.target.dataset.player;

  // If no action on the element itself, check parent card
  if (!action) {
    const card = e.target.closest('[data-action]');
    if (card) {
      action = card.dataset.action;
      playerName = card.dataset.player;
    }
  }

  if (!action || !playerName) return;

  const playerNameNorm = playerName.trim().toLowerCase();

  // Helper: refresh both panels after toggle
  function refreshBrowsePanels() {
    newImportRefreshSelectedCards();
    const favPanel = document.getElementById('addPlayersFavPanel');
    if (favPanel && favPanel.style.display !== 'none') {
      newImportRenderFavorites();
    } else {
      newImportRefreshSelectCards();
    }
  }

  // REMOVE BY NAME — tap selected player in browse to deselect
  if (action === "remove-by-name") {
    const idx = newImportState.selectedPlayers.findIndex(p => p.displayName.trim().toLowerCase() === playerNameNorm);
    if (idx >= 0) newImportState.selectedPlayers.splice(idx, 1);

    // Remove from schedulerState immediately so they're no longer busy/in-session
    if (typeof schedulerState !== 'undefined') {
      const si = schedulerState.allPlayers.findIndex(p => p.name.trim().toLowerCase() === playerNameNorm);
      if (si >= 0) schedulerState.allPlayers.splice(si, 1);
      const ai = schedulerState.activeplayers.findIndex(n => n.trim().toLowerCase() === playerNameNorm);
      if (ai >= 0) schedulerState.activeplayers.splice(ai, 1);
    }
    if (typeof dbReleaseSessionSlots === 'function') dbReleaseSessionSlots([playerName]);

    refreshBrowsePanels();
    if (typeof homeUpdateStepper === 'function') homeUpdateStepper();
    return;
  }

  const source =
    newImportState.currentSelectMode === "favorites"
      ? newImportState.favoritePlayers
      : newImportState.historyPlayers;

  const player = source.find(p => p.displayName.trim().toLowerCase() === playerNameNorm)
    || { displayName: playerName, gender: 'Male' }; // fallback for browse-rendered players

  // TAP TO ADD
  if (action === "add") {
    addToListIfNotExists(newImportState.selectedPlayers, player);
    refreshBrowsePanels();
    return;
  }

  // TOGGLE GENDER -- disabled, edits only in Vault Modify
  if (action === "gender") { return; }

  // TOGGLE FAVORITE
  if (action === "favorite") {
    const i = newImportState.favoritePlayers.findIndex(p => p.displayName.trim().toLowerCase() === player.displayName.trim().toLowerCase());
    if (i >= 0) {
      newImportState.favoritePlayers.splice(i, 1);
    } else {
      addToListIfNotExists(newImportState.favoritePlayers, player);
    }
    newImportSaveFavorites();
    newImportRefreshSelectCards();
    return;
  }

  // DELETE
  if (action === "delete") {
    const removeIndex = source.findIndex(p => p.displayName === playerName);
    if (removeIndex >= 0) source.splice(removeIndex, 1);
    if (newImportState.currentSelectMode === "history") {
      localStorage.setItem("newImportHistory", JSON.stringify(newImportState.historyPlayers));
    } else {
      localStorage.setItem("newImportFavorites", JSON.stringify(newImportState.favoritePlayers));
    }
    newImportRefreshSelectCards();
  }
}

function newImportHandleSelectedCardClick(e) {
  // Check clicked element then walk up to card for tap-to-remove
  let action = e.target.dataset.action;
  let idx    = e.target.dataset.index;

  if (!action) {
    const card = e.target.closest('[data-action="remove-selected"]');
    if (card) {
      action = card.dataset.action;
      idx    = card.dataset.index;
    }
  }

  if (!action) return;

  // TAP CARD TO REMOVE from selected
  if (action === "remove-selected") {
    const i = parseInt(idx);
    if (!isNaN(i)) {
      newImportState.selectedPlayers.splice(i, 1);
      newImportRefreshSelectedCards();
      // Re-render active tab
      const favPanel = document.getElementById('addPlayersFavPanel');
      if (favPanel && favPanel.style.display !== 'none') {
        newImportRenderFavorites();
      } else {
        newImportRefreshSelectCards();
      }
      addPlayersBrowseFilter();
    }
    return;
  }
}

function newImportHandleBrowseCardClick(action, playerName) {
  // Look up in browse list first, fall back to favorites list
  const player = _browseAllPlayers.find(p =>
    (p.displayName || p.name || "").toLowerCase() === playerName.toLowerCase()
  ) || newImportState.favoritePlayers.find(p =>
    (p.displayName || "").toLowerCase() === playerName.toLowerCase()
  ) || { displayName: playerName, gender: 'Male' };

  const displayName = player.displayName || player.name || playerName;

  // Helper: refresh whichever panel is currently visible
  function refreshActivePanel() {
    newImportRefreshSelectedCards();
    const favPanel = document.getElementById('addPlayersFavPanel');
    if (favPanel && favPanel.style.display !== 'none') {
      newImportRenderFavorites();
    } else {
      addPlayersBrowseFilter();
    }
  }

  if (action === "add") {
    addToListIfNotExists(newImportState.selectedPlayers, player);
    refreshActivePanel();
    return;
  }

  if (action === "remove-by-name") {
    const idx = newImportState.selectedPlayers.findIndex(p => (p.displayName || "").toLowerCase() === displayName.toLowerCase());
    if (idx >= 0) newImportState.selectedPlayers.splice(idx, 1);

    // Remove from schedulerState immediately so they're no longer busy/in-session
    if (typeof schedulerState !== 'undefined') {
      const nameKey = displayName.trim().toLowerCase();
      const si = schedulerState.allPlayers.findIndex(p => p.name.trim().toLowerCase() === nameKey);
      if (si >= 0) schedulerState.allPlayers.splice(si, 1);
      const ai = schedulerState.activeplayers.findIndex(n => n.trim().toLowerCase() === nameKey);
      if (ai >= 0) schedulerState.activeplayers.splice(ai, 1);
    }
    if (typeof dbReleaseSessionSlots === 'function') dbReleaseSessionSlots([displayName]);

    refreshActivePanel();
    if (typeof homeUpdateStepper === 'function') homeUpdateStepper();
    return;
  }

  if (action === "favorite") {
    const i = newImportState.favoritePlayers.findIndex(p => p.displayName.trim().toLowerCase() === displayName.toLowerCase());
    if (i >= 0) newImportState.favoritePlayers.splice(i, 1);
    else addToListIfNotExists(newImportState.favoritePlayers, player);
    newImportSaveFavorites();
    addPlayersBrowseFilter();
    return;
  }

  if (action === "delete") {
    // Remove from browse list cache and re-render
    const bi = _browseAllPlayers.findIndex(p => (p.displayName || p.name || "").toLowerCase() === displayName.toLowerCase());
    if (bi >= 0) _browseAllPlayers.splice(bi, 1);
    addPlayersBrowseFilter();
    return;
  }
}

/* =========================
   SELECTED LIST
========================= */
function newImportRefreshSelectedCards() {
  newImportSelectedCards.innerHTML = "";
  const selectedCount = newImportState.selectedPlayers.length;
  newImportSelectedCount.textContent = selectedCount;

  // Final Add must only be available when there is at least one player
  // in the Selected list. Keep this in the central selected-list refresh so
  // Browse, Favorites, Type, Clear and remove actions all stay in sync.
  const addBtn = document.getElementById("newImportAddBtn");
  if (addBtn) {
    addBtn.disabled = selectedCount === 0;
    addBtn.setAttribute("aria-disabled", selectedCount === 0 ? "true" : "false");
  }

  newImportState.selectedPlayers.forEach((p, i) => {
    const card = document.createElement("div");
    card.className = "newImport-player-card " + (p.gender === "Female" ? "female" : "male") + " player-added";
    card.dataset.action = 'remove-selected';
    card.dataset.index  = i;
    card.style.cursor   = 'pointer';
    card.innerHTML = `
      <div class="newImport-player-top">
        <img src="${p.gender === "Male" ? "male.png" : "female.png"}"
             style="cursor:default">
        <div class="newImport-player-name">${p.displayName}</div>
        ${playerAvailDot(p.displayName)}
      </div>
      <div class="newImport-player-actions newImport-selected-card-actions">
        <span class="rating-badge" data-player="${p.displayName}">${getActiveRating(p.displayName).toFixed(1)}</span>
      </div>
    `;
    newImportSelectedCards.appendChild(card);
  });
}

function newImportRemoveSelected(i) {
  // Only remove from the modal selection list — session syncs when Update/Add is pressed
  newImportState.selectedPlayers.splice(i, 1);
  newImportRefreshSelectedCards();
  newImportRefreshSelectCards();
}

function newImportClearSelected() {
  newImportState.selectedPlayers = [];
  newImportRefreshSelectedCards();
  newImportRefreshSelectCards();
}

/* =========================
   CLEAR LISTS
========================= */
function newImportClearHistory() {
  if (!confirm(t("clearHistoryConfirm"))) return;
  newImportState.historyPlayers = [];
  localStorage.setItem("newImportHistory", "[]");
  newImportRefreshSelectCards();
}

function newImportClearFavorites() {
  if (!confirm(t("clearFavoritesConfirm"))) return;
  newImportState.favoritePlayers = [];
  localStorage.setItem("newImportFavorites", "[]");
  newImportRefreshSelectCards();
}

/* =========================
   FAVORITE SETS -- SAVE INPUT TOGGLE
========================= */
function newImportResetFavToggle() {
  const row  = document.getElementById("newImportFavoriteSetRow");
  const icon = document.getElementById("addPlayerFavToggle");
  if (row)  row.style.display  = "none";
  if (icon) {
    icon.textContent = "☆";
    icon.style.color = "rgba(255,255,255,0.5)";
  }
  newImportState.addToFavOnAdd = false;
}

function newImportToggleAddFav() {
  const row  = document.getElementById("newImportFavoriteSetRow");
  const icon = document.getElementById("addPlayerFavToggle");
  if (!row || !icon) return;

  const isOpen = row.style.display !== "none";

  if (isOpen) {
    // Close -- turn star off
    row.style.display            = "none";
    icon.textContent             = "☆";
    icon.style.color             = "rgba(255,255,255,0.5)";
    newImportState.addToFavOnAdd = false;
  } else {
    // Open -- turn star on
    row.style.display            = "block";
    icon.textContent             = "★";
    icon.style.color             = "var(--amber)";
    newImportState.addToFavOnAdd = true;
    document.getElementById("newImportSetName")?.focus();
  }
}

function newImportSaveFavoriteSet() {
  const setNameInput = document.getElementById("newImportSetName");
  const setName      = setNameInput.value.trim();
  if (!setName) { setNameInput.focus(); return; }

  const textarea = document.getElementById("players-names");
  const text     = textarea?.value.trim();
  if (!text) { alert("No players in the text area"); return; }

  const defaultGender = document.getElementById("player-gender")?.value || "Male";
  const players = parsePlayerLines(text, defaultGender);
  if (!players.length) { alert("No valid player names found"); return; }

  const sets = newImportLoadFavoriteSets();
  const existingIdx = sets.findIndex(
    s => s.name.trim().toLowerCase() === setName.toLowerCase()
  );
  if (existingIdx >= 0) {
    // Same name exists -- ask user to confirm overwrite or pick a new name
    const overwrite = confirm(`"${sets[existingIdx].name}" ${t('alreadyExists')}.\n${t('replaceBtn')}?`);
    if (!overwrite) {
      setNameInput.focus();
      setNameInput.select();
      return;
    }
    sets[existingIdx].players = players;
  } else {
    sets.push({ name: setName, players });
  }
  newImportSaveFavoriteSets(sets);

  setNameInput.value = "";
  newImportResetFavToggle();
  newImportShowSelectMode("favorites");
}

function newImportDeleteFavoriteSet(setName) {
  if (!confirm(`${t("deleteSetConfirm")} "${setName}"?`)) return;
  const sets = newImportLoadFavoriteSets().filter(s => s.name !== setName);
  newImportSaveFavoriteSets(sets);
  newImportRefreshSelectCards();
}

function newImportLoadSetToSelected(setName) {
  const sets = newImportLoadFavoriteSets();
  const set  = sets.find(s => s.name === setName);
  if (!set) return;

  const registered = newImportState.historyPlayers || [];
  const registeredKeys = new Set(registered.map(p => p.displayName.trim().toLowerCase()));

  set.players.forEach(p => {
    const key = (p.displayName || p.name || "").trim().toLowerCase();
    if (registeredKeys.has(key)) {
      // Use the registered version (correct name/gender/rating from Supabase)
      const reg = registered.find(r => r.displayName.trim().toLowerCase() === key);
      addToListIfNotExists(newImportState.selectedPlayers, reg || p);
    }
    // Silently skip unregistered players from sets
  });

  newImportRefreshSelectedCards();
  newImportRefreshSelectCards();
}

/* =========================
   ADD PLAYER (from Add Players tab)
========================= */
async function addPlayer() {
  const textarea = document.getElementById("players-names");
  if (!textarea) return;
  const text = textarea.value.trim();
  if (!text) return;

  const defaultGender    = document.getElementById("player-gender")?.value || "Male";
  const extractedPlayers = parsePlayerLines(text, defaultGender);
  if (!extractedPlayers.length) return;

  const registered    = newImportState.historyPlayers || [];
  const registeredMap = new Map(registered.map(p => [p.displayName.trim().toLowerCase(), p]));
  const foundLocally  = [];
  const notFoundNames = [];

  extractedPlayers.forEach(player => {
    const key = player.displayName.trim().toLowerCase();
    const reg = registeredMap.get(key);
    if (reg) foundLocally.push(reg);
    else notFoundNames.push(player);
  });

  // Existing globally-known players remain reusable exactly as before.
  const fromSupabase = [];
  const stillMissing = [];
  if (notFoundNames.length) {
    const cached = typeof getGlobalPlayersCache === "function" ? getGlobalPlayersCache() : [];
    const globalMap = new Map(cached.map(p => [p.displayName.trim().toLowerCase(), p]));
    notFoundNames.forEach(player => {
      const key = player.displayName.trim().toLowerCase();
      const found = globalMap.get(key);
      if (found) fromSupabase.push(found);
      else stillMissing.push(player);
    });
  }

  // New behaviour: register truly new typed/imported names immediately.
  // Default claim password is the current club name.
  const autoRegistered = [];
  if (stillMissing.length) {
    const club = (typeof getMyClub === "function") ? getMyClub() : null;
    const clubName = String((club && club.name) || localStorage.getItem('kbrr_my_club_name') || '').trim();
    if (!club || !club.id || !clubName) {
      alert('Select a club before adding new players.');
      return;
    }

    const addBtn = document.querySelector('.add-player-btn, #addPlayerBtn');
    if (addBtn) addBtn.disabled = true;
    try {
      for (const p of stillMissing) {
        let cleanName = String(p.displayName || '').trim();
        if (typeof scsRequireValidPlayerName === 'function') cleanName = scsRequireValidPlayerName(cleanName);
        if (!cleanName) continue;

        // Re-check membership first to protect against a stale local cache / double tap.
        const existingMembership = await sbGet('memberships',
          'club_id=eq.' + encodeURIComponent(club.id) +
          '&nickname=ilike.' + encodeURIComponent(cleanName) +
          '&select=player_id,nickname&limit=1').catch(() => []);

        if (existingMembership && existingMembership.length) {
          const known = (newImportState.historyPlayers || []).find(x =>
            String(x.displayName || '').trim().toLowerCase() === cleanName.toLowerCase());
          autoRegistered.push(known || { displayName: cleanName, gender: p.gender || defaultGender, playerId: existingMembership[0].player_id });
          continue;
        }

        const created = await sbPost('players', {
          name: cleanName,
          gender: p.gender === 'Female' ? 'Female' : 'Male',
          global_rating: 1.0,
          global_points: 0,
          default_password: clubName
        });
        const player = created && created[0];
        if (!player || !player.id) throw new Error('Could not register ' + cleanName);

        await sbPost('memberships', {
          player_id: player.id,
          club_id: club.id,
          nickname: cleanName,
          club_rating: 1.0,
          club_points: 0
        });

        autoRegistered.push({
          ...player,
          playerId: player.id,
          displayName: cleanName,
          gender: p.gender === 'Female' ? 'Female' : 'Male',
          rating: 1.0
        });
      }

      try { localStorage.removeItem('kbrr_cache_players'); } catch (e) {}
      try { localStorage.removeItem('kbrr_cache_ts'); } catch (e) {}
      try { localStorage.removeItem('kbrr_cache_club_id'); } catch (e) {}
      if (typeof syncToLocal === 'function') {
        try { await syncToLocal(); } catch (e) {}
      }
    } catch (e) {
      alert('Failed to register new player: ' + (e && e.message ? e.message : e));
      return;
    } finally {
      if (addBtn) addBtn.disabled = false;
    }
  }

  const allFound = [...foundLocally, ...fromSupabase, ...autoRegistered];
  allFound.forEach(reg => {
    addToListIfNotExists(newImportState.selectedPlayers, reg);
    if (newImportState.addToFavOnAdd) addToListIfNotExists(newImportState.favoritePlayers, reg);
  });

  if (newImportState.addToFavOnAdd) newImportSaveFavorites();
  newImportRefreshSelectedCards();
  newImportRefreshSelectCards();

  textarea.value = "";
  textarea.style.height = "";

  // After typed players are added, dismiss the mobile keyboard and return
  // the user to the selected-player list at the top of the modal.
  textarea.blur();
  if (document.activeElement && typeof document.activeElement.blur === "function") {
    document.activeElement.blur();
  }
  setTimeout(() => {
    const selectedSection = document.querySelector(".newImport-selected-section");
    if (selectedSection && typeof selectedSection.scrollIntoView === "function") {
      selectedSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, 180);

  // New players were registered automatically, so the old "Not registered / Register them" prompt is no longer needed.
  const feedback = document.getElementById("addPlayerFeedback");
  if (feedback) {
    feedback.innerHTML = '';
    feedback.style.display = "none";
  }
}

/* =========================
   SEND SKIPPED TO REGISTER TAB
========================= */
function addPlayerSendToRegister(names) {
  // Hide feedback
  const feedback = document.getElementById("addPlayerFeedback");
  if (feedback) feedback.style.display = "none";

  // Close import modal
  if (typeof newImportHideModal === "function") newImportHideModal();
  if (typeof hideImportModal    === "function") hideImportModal();

  // Pre-fill staging list with skipped names
  if (typeof _regStagingList !== "undefined") {
    names.forEach(name => {
      if (!_regStagingList.find(s => s.name.toLowerCase() === name.toLowerCase())) {
        _regStagingList.push({
          id:     Date.now() + Math.random(),
          name:   name.trim(),
          gender: "Male",
          rating: 1.0,
          status: "pending"
        });
      }
    });
  }

  // Navigate to vault register page
  if (typeof homeGo === "function") {
    homeGo("vaultRegisterPage", null);
    // Switch to bulk tab and show staging
    setTimeout(() => {
      if (typeof vaultRegisterShowTab === "function") vaultRegisterShowTab("bulk");
      if (typeof regRenderStaging     === "function") regRenderStaging();
    }, 300);
  } else {
    alert("Please go to Vault → Register to add these players: " + names.join(", "));
  }
}

/* =========================
   FINAL IMPORT -- OK button
========================= */
function newImportAddPlayers() {
  if (!newImportState.selectedPlayers.length) { alert("No players selected"); return; }
  addPlayersFromInputUI();
}

/* =============================================================
   REGISTER TAB -- Supabase DB player registration
   Added: step82
============================================================= */

// ── Staging list for bulk registration ───────────────────────
let _regStagingList = []; // [{ id, name, gender, rating }]

function newImportRenderRegister(keepStaging = false) {
  const listContainer = document.getElementById("newImportSelectCards");
  const club = (typeof getMyClub === "function") ? getMyClub() : { name: null };

  listContainer.style.display = "block";
  if (!keepStaging) _regStagingList = [];

  listContainer.innerHTML = `
    <div class="register-form">
      <div class="register-club-label">
        ${club.name
          ? `🏸 Registering for: <strong>${club.name}</strong>`
          : t("noClubSelectedWarn2")}
      </div>
      ${club.name ? `
      <div class="register-field">
        <label class="register-label">Paste names (one per line)</label>
        <textarea id="regNamesArea"
                  class="register-textarea"
                  rows="4"
                  placeholder="Raja&#10;Kari, Female&#10;Venkat"></textarea>
      </div>
      <div class="register-gender-row" style="margin-bottom:10px">
        <span class="register-label" style="margin:0 8px 0 0">Default gender:</span>
        <button id="regDefaultMale"   class="register-gender-img-btn active"
                onclick="regSetDefaultGender('Male')">
          <img src="male.png" class="reg-gender-img"><span>Male</span>
        </button>
        <button id="regDefaultFemale" class="register-gender-img-btn"
                onclick="regSetDefaultGender('Female')">
          <img src="female.png" class="reg-gender-img"><span>Female</span>
        </button>
      </div>
      <button class="register-add-btn" onclick="regAddToStaging()">Add to List</button>
      <div id="regStagingContainer" class="reg-staging-container"></div>
      <div id="registerFeedback" class="register-feedback"></div>
      <button class="register-save-btn" id="regRegisterAllBtn"
              onclick="regRegisterAll()" style="display:none">
        ✅ Register All
      </button>
      ` : ""}
    </div>
  `;
  window._regDefaultGender = "Male";
}

function regSetDefaultGender(gender) {
  window._regDefaultGender = gender;
  document.getElementById("regDefaultMale")  ?.classList.toggle("active", gender === "Male");
  document.getElementById("regDefaultFemale")?.classList.toggle("active", gender === "Female");
}

function regAddToStaging() {
  const area = document.getElementById("regNamesArea");
  if (!area || !area.value.trim()) return;

  const parsed = parsePlayerLines(area.value, window._regDefaultGender || "Male");
  if (!parsed.length) return;

  var invalidCount = 0;
  parsed.forEach(p => {
    var checked = typeof scsNormalizePlayerName === 'function' ? scsNormalizePlayerName(p.displayName) : {name:String(p.displayName || '').trim(),valid:!!String(p.displayName || '').trim()};
    if (!checked.valid) { invalidCount++; return; }
    // Avoid staging duplicates by name
    if (!_regStagingList.find(s => s.name.toLowerCase() === checked.name.toLowerCase())) {
      _regStagingList.push({
        id:     Date.now() + Math.random(),
        name:   checked.name,
        gender: p.gender,
        rating: 1.0,
        status: "pending" // pending | success | duplicate | error
      });
    }
  });

  area.value = "";
  regRenderStaging();
  if (invalidCount) {
    var feedback = document.getElementById('registerFeedback');
    if (feedback) { feedback.textContent = (typeof t === 'function' ? t('invalidPlayerName') : 'Invalid player name') + ' (' + invalidCount + ')'; feedback.className = 'register-feedback error'; }
  }
}

function regRenderStaging() {
  const container = document.getElementById("regStagingContainer");
  const registerBtn = document.getElementById("regRegisterAllBtn");
  const feedback = document.getElementById("registerFeedback");
  if (!container) return;

  if (_regStagingList.length === 0) {
    container.innerHTML = "";
    if (registerBtn) registerBtn.style.display = "none";
    return;
  }

  if (registerBtn) registerBtn.style.display = "block";
  if (feedback) feedback.textContent = "";

  // Use newImport-cards-container layout same as favorites tab
  container.className = "newImport-cards-container reg-staging-container";

  // Column header row
  const header = `<div class="reg-staging-header">
    <span class="reg-staging-header-name">Name</span>
    <span class="reg-staging-header-rating">Rating</span>
  </div>`;

  const rows = _regStagingList.map((p, i) => {
    const done      = p.status === "success";
    const statusBadge =
      p.status === "success"   ? `<span class="reg-status-badge reg-ok">✅</span>` :
      p.status === "duplicate" ? `<span class="reg-status-badge reg-dup">⚠️ Duplicate</span>` :
      p.status === "error"     ? `<span class="reg-status-badge reg-err">❌ Error</span>` : "";

    const cardClass = done ? "newImport-player-card reg-card-done" : "newImport-player-card";
    const genderImg = p.gender === "Female" ? "female.png" : "male.png";
    const busyNote  = "";

    return `
      <div class="${cardClass}" id="regCard-${i}">
        <div class="newImport-player-top">
          <img src="${genderImg}"
               ${!done ? `onclick="regToggleGender(${i})" title="${t('tapToToggleGender')}" style="cursor:pointer"` : ""}
               >
          <div class="newImport-player-name">
            ${done
              ? `<span>${p.name}</span>`
              : `<input class="reg-name-inline" type="text"
                        value="${p.name}"
                        onchange="regUpdateName(${i}, this.value)">`
            }
          </div>
          ${busyNote}
        </div>
        <div class="newImport-player-actions">
          <input class="reg-rating-badge-input" type="number"
                 value="${p.rating}" min="1.0" max="5.0" step="0.1"
                 title="${t('startingRating')}"
                 onchange="regUpdateRating(${i}, this.value)"
                 ${done ? "disabled" : ""}>
          ${statusBadge}
          ${!done
            ? `<button class="circle-btn delete" onclick="regDeleteStaging(${i})" title="Remove">×</button>`
            : ""}
        </div>
      </div>`;
  }).join("");
  container.innerHTML = header + rows;
}

function regToggleGender(i) {
  if (!_regStagingList[i]) return;
  _regStagingList[i].gender = _regStagingList[i].gender === "Male" ? "Female" : "Male";
  regRenderStaging();
}

function regUpdateName(i, val) {
  if (!_regStagingList[i]) return;
  var checked = typeof scsNormalizePlayerName === 'function' ? scsNormalizePlayerName(val) : {name:String(val || '').trim(),valid:true};
  _regStagingList[i].name = checked.name;
  _regStagingList[i].status = checked.valid ? 'pending' : 'error';
  regRenderStaging();
}

function regUpdateRating(i, val) {
  if (!_regStagingList[i]) return;
  const r = parseFloat(val);
  _regStagingList[i].rating = isNaN(r) ? 1 : Math.min(5, Math.max(1, r));
}

function regDeleteStaging(i) {
  _regStagingList.splice(i, 1);
  regRenderStaging();
}

async function regRegisterAll() {
  const club = (typeof getMyClub === "function") ? getMyClub() : { id: null };
  const feedback = document.getElementById("registerFeedback");
  const btn = document.getElementById("regRegisterAllBtn");
  if (!club.id) {
    if (feedback) { feedback.textContent = t("noClubSelectedWarn2"); feedback.className = "register-feedback error"; }
    return;
  }

  if (typeof isAdminMode === "function" && !isAdminMode()) {
    if (feedback) { feedback.textContent = t("adminModeRequired"); feedback.className = "register-feedback error"; }
    return;
  }

  // Use a placeholder -- actual auth done at club join time
  const adminPassword = "__session_admin__";

  const pending = _regStagingList.filter(p => p.status === "pending" || p.status === "error" || p.status === "duplicate");
  if (!pending.length) return;

  btn.disabled = true;
  if (feedback) { feedback.textContent = "Registering..."; feedback.className = "register-feedback"; }

  let successCount = 0;
  let failCount    = 0;

  for (let i = 0; i < _regStagingList.length; i++) {
    const p = _regStagingList[i];
    if (p.status === "success") continue;

    try {
      const newPlayer = await dbAddPlayer(p.name, p.gender, adminPassword);
      if (p.rating > 0) {
        await dbOverrideRating(newPlayer.id, p.rating);
      }
      _regStagingList[i].status = "success";
      successCount++;
    } catch (e) {
      const msg = e.message || "";
      _regStagingList[i].status = msg.includes("already exists") ? "duplicate" : "error";
      failCount++;
    }

    // Re-render after each to show live progress
    regRenderStaging();
  }

  btn.disabled = false;

  // Summary feedback
  const parts = [];
  if (successCount) parts.push(`✅ ${successCount} registered`);
  if (failCount)    parts.push(`⚠️ ${failCount} skipped`);
  if (feedback) {
    feedback.textContent = parts.join("  ");
    feedback.className = failCount ? "register-feedback error" : "register-feedback success";
  }

  // Silently add successfully registered players to selected list
  if (successCount) {
    _regStagingList
      .filter(p => p.status === "success")
      .forEach(p => addToListIfNotExists(newImportState.selectedPlayers, { displayName: p.name, gender: p.gender, rating: p.rating || 1.0 }));
    newImportRefreshSelectedCards();
  }
}

/* =============================================================
   ADD PLAYERS -- BROWSE TAB
============================================================= */

let _browseAllPlayers = []; // cached list for current scope

/* Render favorites tab content into the addPlayersFavPanel */
function newImportRenderFavorites() {
  newImportLoadFavorites();
  const setsContainer = document.getElementById('newImportFavSetsContainer');
  const listContainer = document.getElementById('newImportFavList');
  if (!setsContainer || !listContainer) return;

  setsContainer.innerHTML = '';
  listContainer.innerHTML = '';

  // ── Favorite Sets ──
  const sets = newImportLoadFavoriteSets();
  sets.forEach(set => {
    const safeName = set.name.replace(/'/g, "\'");
    const setCard  = document.createElement('div');
    setCard.className    = 'newImport-set-card';
    setCard.dataset.open = 'false';
    setCard.innerHTML = `
      <div class="newImport-set-header">
        <div class="newImport-set-info">
          <span class="newImport-set-icon">★</span>
          <span class="newImport-set-name">${set.name}</span>
          <span class="newImport-set-count">${set.players.length} players</span>
          <span class="newImport-set-chevron">▶</span>
        </div>
        <div class="newImport-set-actions">
          <button class="newImport-set-addall-btn" data-setname="${safeName}">+ All</button>
          <button class="newImport-set-delete-btn" data-setname="${safeName}">×</button>
        </div>
      </div>
      <div class="newImport-set-players" style="display:none">
        ${set.players.map(p => {
          const busy = playerIsBusy(p.displayName);
          return `
          <div class="newImport-set-player-row${busy ? ' player-busy' : ''}">
            <img src="${p.gender === 'Male' ? 'male.png' : 'female.png'}"
              class="newImport-set-player-img"
              style="${busy ? 'opacity:0.4' : ''}; cursor:default">
            <span class="newImport-set-player-name" style="${busy ? 'opacity:0.5' : ''}">${p.displayName}</span>
            ${playerAvailDot(p.displayName)}
            <span class="rating-badge" style="font-size:0.68rem;padding:2px 5px;" data-player="${p.displayName}">${getActiveRating(p.displayName).toFixed(1)}</span>
            <button class="newImport-set-player-remove-btn"
              data-setname="${safeName}"
              data-name="${p.displayName.replace(/"/g, '&quot;')}">×</button>
            <button class="newImport-set-player-add-btn ${busy ? 'disabled-btn' : ''}"
              data-name="${p.displayName.replace(/"/g, '&quot;')}"
              data-gender="${p.gender}"
              ${busy ? 'disabled' : ''}>+</button>
          </div>`;
        }).join('')}
        <div class="newImport-set-addplayer-row" style="position:relative">
          <input type="text"
            class="newImport-set-addplayer-input"
            data-setname="${safeName}"
            autocomplete="off"
            placeholder="${t('searchToAddPlayer')}">
          <div class="newImport-set-addplayer-dropdown" data-setname="${safeName}" style="display:none"></div>
        </div>
      </div>
    `;
    setsContainer.appendChild(setCard);
  });

  // Wire set card click events
  setsContainer.addEventListener('click',   newImportHandleSetClick);
  setsContainer.addEventListener('keydown', newImportHandleSetClick);
  setsContainer.addEventListener('input',   newImportHandleSetClick);

  // ── Individual favorite players ──
  const source = [...newImportState.favoritePlayers]
    .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));

  const unavailable = newImportState.unavailablePlayers || new Set();

  source.forEach(p => {
    const nameNorm  = p.displayName.trim().toLowerCase();
    const added     = newImportState.selectedPlayers.some(sp => sp.displayName.trim().toLowerCase() === nameNorm);
    const rating1   = getActiveRating(p.displayName).toFixed(1);
    const statusDot = ``;

    const card = document.createElement('div');
    card.className = 'newImport-player-card ' + (p.gender === 'Female' ? 'female' : 'male') + (added ? ' player-added' : '');
    // Always tappable — toggle based only on selectedPlayers
    card.dataset.browseAction = added ? 'remove-by-name' : 'add';
    card.dataset.browsePlayer = p.displayName;
    card.style.cursor = 'pointer';
    card.innerHTML = `
      <div class="newImport-player-top">
        <img src="${p.gender === 'Male' ? 'male.png' : 'female.png'}" style="cursor:default">
        <div class="newImport-player-name">${p.displayName}${added ? ' <span style="font-size:0.7rem;color:#22c55e;">✓</span>' : ''}</div>
        ${statusDot}
      </div>
      <div class="newImport-player-actions">
        <span class="rating-badge" data-player="${p.displayName}">${rating1}</span>
        <button class="circle-btn favorite active-favorite"
          data-action="favorite" data-player="${p.displayName}">★</button>
        <button class="circle-btn delete" data-action="delete" data-player="${p.displayName}">×</button>
      </div>
    `;
    listContainer.appendChild(card);
  });

  // Wire individual card click events — use browse handler so data-browse-action works
  if (!listContainer.dataset.browseClickWired) {
    listContainer.dataset.browseClickWired = '1';
    listContainer.addEventListener('click', function(e) {
      const card = e.target.closest('[data-browse-action]');
      if (!card) return;
      const action = card.dataset.browseAction;
      const player = card.dataset.browsePlayer;
      if (action && player) newImportHandleBrowseCardClick(action, player);
    });
  }
}

function addPlayersShowTab(tab) {
  const typeBtn    = document.getElementById("addPlayersTypeBtn");
  const browseBtn  = document.getElementById("addPlayersBrowseBtn");
  const favBtn     = document.getElementById("addPlayersFavBtn");
  const typePanel  = document.getElementById("addPlayersTypePanel");
  const browsePanel = document.getElementById("addPlayersBrowsePanel");
  const favPanel   = document.getElementById("addPlayersFavPanel");
  if (!typePanel || !browsePanel) return;

  // Deactivate all tabs and hide all panels
  [typeBtn, browseBtn, favBtn].forEach(b => b?.classList.remove("active"));
  [typePanel, browsePanel, favPanel].forEach(p => { if (p) p.style.display = "none"; });

  if (tab === "browse") {
    browseBtn?.classList.add("active");
    browsePanel.style.display = "block";
    addPlayersBrowseLoad();
  } else if (tab === "favorites") {
    favBtn?.classList.add("active");
    if (favPanel) favPanel.style.display = "block";
    newImportRenderFavorites();
  } else {
    typeBtn?.classList.add("active");
    typePanel.style.display = "block";
  }
}

async function addPlayersBrowseLoad() {
  const scope     = document.getElementById("addPlayersBrowseScope")?.value || "club";
  const listEl    = document.getElementById("addPlayersBrowseList");
  if (!listEl) return;

  listEl.innerHTML = "<div style='padding:10px;color:var(--muted)'>Loading...</div>";

  try {
    let players = [];
    if (scope === "club") {
      // Use the normal player cache here. A forced fetch on every slot add makes
      // the picker feel slow, and player edits already invalidate this cache.
      const clubPlayers = await dbGetPlayers(false);
      players = (clubPlayers || []).map(p => ({
        id:           p.id || p.player_id || p.playerId,
        playerId:     p.id || p.player_id || p.playerId,
        membershipId: p.membershipId,
        displayName: p.name,
        gender:      p.gender || "Male",
        rating:      parseFloat(p.rating) || 1.0
      }));
    } else {
      // Fetch all memberships for this club
      const club = (typeof getMyClub === 'function') ? getMyClub() : { id: null };
      const raw = club.id
        ? await sbGet("memberships", `club_id=eq.${club.id}&order=nickname.asc&select=nickname,club_rating,players(gender,global_rating)`)
        : [];
      players = raw.map(m => ({
        id:          m.player_id,
        playerId:    m.player_id,
        displayName: m.nickname,
        gender:      m.players?.gender || "Male",
        rating:      parseFloat(m.club_rating) || 1.0
      }));
    }
    _browseAllPlayers = players;
    // Refresh availability before rendering
    if (typeof dbGetUnavailablePlayers === "function") {
      dbGetUnavailablePlayers().then(unavailable => {
        newImportState.unavailablePlayers = unavailable;
        addPlayersBrowseRender(_browseAllPlayers);
      });
    } else {
      addPlayersBrowseRender(_browseAllPlayers);
    }
  } catch (e) {
    listEl.innerHTML = "<div style='padding:10px;color:red'>Failed to load players.</div>";
  }
}

function addPlayersBrowseFilter() {
  const q = (document.getElementById("addPlayersBrowseSearch")?.value || "").toLowerCase();
  const filtered = _browseAllPlayers.filter(p =>
    (p.displayName || p.name || "").toLowerCase().includes(q)
  );
  addPlayersBrowseRender(filtered);
}

function addPlayersBrowseRender(players) {
  const listEl = document.getElementById("addPlayersBrowseList");
  if (!listEl) return;

  if (!players.length) {
    listEl.innerHTML = "<div style='padding:10px;color:var(--muted)'>No players found.</div>";
    return;
  }

  const selectedNames = new Set(
    (newImportState.selectedPlayers || []).map(p => (p.displayName || p.name || "").toLowerCase())
  );
  const blockedNames = newImportState.slotUnavailablePlayers || new Set();

  listEl.className = "newImport-cards-container";
  listEl.innerHTML = players.map(p => {
    const name       = p.displayName || p.name || "";
    const gender     = p.gender || "Male";
    const genderImg  = gender === "Female" ? "female.png" : "male.png";
    const nameKey    = name.toLowerCase();
    const isSelected = selectedNames.has(nameKey);
    const isBlocked  = blockedNames.has(nameKey);
    const fav        = (newImportState.favoritePlayers || []).some(fp => fp.displayName.trim().toLowerCase() === name.toLowerCase());
    const rating     = getActiveRating(name).toFixed(1);
    const nameSafe   = name.replace(/'/g, "\\'");
    return `
      <div class="newImport-player-card ${gender === 'Female' ? 'female' : 'male'}${isSelected ? ' player-added' : ''}${isBlocked ? ' player-busy' : ''}"
        ${isBlocked ? '' : `data-browse-action="${isSelected ? 'remove-by-name' : 'add'}" data-browse-player="${nameSafe}"`} style="cursor:${isBlocked ? 'default' : 'pointer'};${isBlocked ? 'opacity:0.55;' : ''}">
        <div class="newImport-player-top">
          <img src="${genderImg}" style="cursor:default">
          <div class="newImport-player-name">${name}${isSelected ? ' <span style="font-size:0.7rem;color:#22c55e;">✓</span>' : ''}</div>
          ${playerAvailDot(name)}
        </div>
        <div class="newImport-player-actions">
          <span class="rating-badge">${rating}</span>
          <button class="circle-btn favorite ${fav ? 'active-favorite' : ''}"
            data-browse-action="favorite" data-browse-player="${nameSafe}">
            ${fav ? "★" : "☆"}
          </button>
        </div>
      </div>`;
  }).join("");
}

function addPlayersBrowseToggle(name) {
  const player = _browseAllPlayers.find(p =>
    (p.displayName || p.name || "").toLowerCase() === name.toLowerCase()
  );
  if (!player) return;

  const displayName = player.displayName || player.name || "";
  const idx = newImportState.selectedPlayers.findIndex(
    p => (p.displayName || p.name || "").toLowerCase() === displayName.toLowerCase()
  );

  if (idx >= 0) {
    // Remove from selected
    newImportState.selectedPlayers.splice(idx, 1);
  } else {
    // Add to selected
    addToListIfNotExists(newImportState.selectedPlayers, player);
  }

  newImportRefreshSelectedCards();
  // Re-render browse list to update +/- buttons
  addPlayersBrowseFilter();
}
