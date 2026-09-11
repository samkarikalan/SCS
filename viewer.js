/* ============================================================
   VIEWER.JS -- Completely isolated from organiser mode
   - Never touches allRounds, currentRoundIndex, roundsPage
   - Never calls setViewerMode, appMode, or organiser functions
   - Uses #viewerPage and #viewerResults only
   ============================================================ */

var _vSessionId   = null;
var _vLastUpdated = null;
var _vPollTimer   = null;
var _vMeta        = null;
var _vRoundsData  = [];

/* ── Entry point ── */
async function viewerOpen(sessionId) {
  try {
    const rows = await sbGet('sessions',
      `id=eq.${sessionId}&select=id,rounds_data,started_by,created_at,updated_at,status,club_id`
    );
    if (!rows || !rows.length) { alert('Session not found.'); return; }
    const sess = rows[0];
    if (!sess.rounds_data || !sess.rounds_data.length) {
      alert('No rounds data yet.'); return;
    }
    _vSessionId   = sessionId;
    _vLastUpdated = sess.updated_at;
    _vRoundsData  = sess.rounds_data;
    var viewerClubName = '';
    try {
      if (sess.club_id && typeof dbGetClubs === 'function') {
        var viewerClubs = await dbGetClubs();
        var viewerClub = (viewerClubs || []).find(function(c){ return c.id === sess.club_id; });
        viewerClubName = viewerClub ? (viewerClub.name || '') : '';
      }
    } catch(_viewerClubErr) {}
    _vMeta = {
      started_by: sess.started_by,
      created_at: sess.created_at,
      club_name:  viewerClubName,
      status:     sess.status
    };
    _vShowPage();
    _vRender(_vRoundsData);
    if (sess.status === 'live') {
      viewerStartPoll();
    } else {
      // Past session -- go straight to Summary tab
      vSwitchTab('summary');
    }
  } catch (e) {
    console.warn('viewerOpen error:', e.message);
    alert('Could not load session.');
  }
}

/* ── Back button ── */
function viewerGoBack() {
  viewerStopPoll();
  _vHidePage();

  // Live-session detail is opened from My Hub/Home. Closing it must return to
  // the My Hub Home screen, not the legacy Dashboard page.
  try { appMode = 'viewer'; } catch (_) {}
  try { welcomeSelectedWorkspace = 'viewer'; } catch (_) {}
  try { sessionStorage.setItem('appMode', 'viewer'); } catch (_) {}
  try { localStorage.setItem('kbrr_app_mode', 'viewer'); } catch (_) {}
  if (typeof applyMode === 'function') { try { applyMode('viewer'); } catch (_) {} }
  if (typeof showHomeScreen === 'function') {
    showHomeScreen();
    if (typeof setMyHubTopTabView === 'function') {
      try { setMyHubTopTabView('home'); } catch (_) {}
    }
    if (typeof scsSyncPrimaryBottomNav === 'function') {
      try { scsSyncPrimaryBottomNav('viewer'); } catch (_) {}
    }
    return;
  }
}

/* ── Show/hide viewerPage only ── */
function _vShowPage() {
  if (typeof homeHideScreen === 'function') homeHideScreen();
  document.body.classList.add('viewer-detail-open');
  document.querySelectorAll('.page').forEach(function(p) { p.style.display = 'none'; });
  var vPage = document.getElementById('viewerPage');
  if (vPage) vPage.style.display = 'block';
  window._vSessionTabPinned = false;
  // Update viewer header nickname subtitle
  var nickEl = document.getElementById('viewerHeaderNickname');
  if (nickEl) {
    var user = (typeof authGetUser === 'function') ? authGetUser() : null;
    nickEl.textContent = (user && user.nickname) ? user.nickname : 'Live Session';
  }
}

function _vHidePage() {
  document.body.classList.remove('viewer-detail-open');
  var vPage = document.getElementById('viewerPage');
  if (vPage) vPage.style.display = 'none';
  window._vSessionTabPinned = false;
}

/* ── Main render ── */
function _vRender(roundsData) {
  const container = document.getElementById('viewerResults');
  if (!container) return;
  container.innerHTML = '';
  if (!roundsData || !roundsData.length) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:0.85rem;">' + t('noRoundsYet') + '</div>';
    return;
  }
  container.appendChild(_vBuildSubTabs());
  const livePanel = document.createElement('div');
  livePanel.id = 'vPanelLive';
  livePanel.appendChild(_vBuildInfoBar());
  const lastIdx = roundsData.length - 1;
  livePanel.appendChild(_vBuildRound(roundsData[lastIdx]));
  livePanel.appendChild(_vBuildRoundDashboard(roundsData));
  container.appendChild(livePanel);
  const summaryPanel = document.createElement('div');
  summaryPanel.id = 'vPanelSummary';
  summaryPanel.style.display = 'none';
  container.appendChild(summaryPanel);
}

/* ── Sub-tabs ── */
function _vBuildSubTabs() {
  const bar = document.createElement('div');
  bar.className = 'viewer-subtabs';
  const isLive = _vMeta && _vMeta.status === 'live';
  bar.innerHTML = isLive
    ? `<button class="viewer-subtab-btn active" id="vTabLive" onclick="vSwitchTab('live')">🏸 Live</button>
       <button class="viewer-subtab-btn" id="vTabSummary" onclick="vSwitchTab('summary')">📊 Summary</button>`
    : `<button class="viewer-subtab-btn active" id="vTabSummary" onclick="vSwitchTab('summary')">📊 Summary</button>`;
  return bar;
}

function vSwitchTab(tab) {
  document.getElementById('vTabLive')?.classList.toggle('active', tab === 'live');
  document.getElementById('vTabSummary')?.classList.toggle('active', tab === 'summary');
  const live    = document.getElementById('vPanelLive');
  const summary = document.getElementById('vPanelSummary');
  if (!live || !summary) return;
  if (tab === 'live') {
    live.style.display = ''; summary.style.display = 'none';
  } else {
    live.style.display = 'none'; summary.style.display = '';
    _vRenderSummary(summary);
  }
}

/* ── Info bar ── */
function _vBuildInfoBar() {
  const bar = document.createElement('div');
  bar.className = 'viewer-info-bar';
  const meta    = _vMeta || {};
  const elapsed = _vElapsed(meta.created_at);
  const isLive  = meta.status === 'live';
  bar.innerHTML = `
    <span class="viewer-info-dot" style="${isLive ? '' : 'background:#9e9e9e;animation:none;'}"></span>
    <span class="viewer-info-text">
      <strong>${meta.club_name || ''}</strong>
      ${meta.started_by ? ' · ' + meta.started_by : ''}
      ${elapsed ? ' · ' + elapsed : ''}
      ${!isLive ? ' · <em>Completed</em>' : ''}
    </span>
  `;
  return bar;
}

function _vElapsed(isoStr) {
  if (!isoStr) return '';
  const ms = Date.now() - new Date(isoStr).getTime();
  const m  = Math.floor(ms / 60000);
  if (m < 1)  return t('justStarted');
  if (m < 60) return m + 'm';
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}

/* ── Round builder -- uses same CSS classes as organiser ── */
function _vBuildRound(data) {
  if (!data) return document.createElement('div');
  const lang = (typeof currentLang !== 'undefined') ? currentLang : 'en';
  const tr   = (typeof translations !== 'undefined') ? (translations[lang] || {}) : {};

  const roundNum = data.round || 1;
  const roundColorClass = 'round-n-' + ((roundNum - 1) % 10 + 1);
  const wrapper = document.createElement('div');
  wrapper.className = 'round-wrapper viewer-rounds ' + roundColorClass;

  const header = document.createElement('div');
  header.className = 'round-header roundTitle';
  header.style.cssText = 'border-left:none!important;padding-left:0;text-align:center;font-size:0.9rem;';
  header.textContent = (tr.roundno || (t('round') + ' ')) + data.round;
  if (Number.isFinite(Number(data.durationMs))) {
    const duration = document.createElement('span');
    duration.className = 'round-duration';
    duration.textContent = typeof formatRoundDuration === 'function'
      ? formatRoundDuration(data.durationMs)
      : '00:00';
    duration.setAttribute('aria-label', 'Round duration ' + duration.textContent);
    header.appendChild(duration);
  }
  wrapper.appendChild(header);

  (data.games || []).forEach((game, gi) => {
    const courtDiv = document.createElement('div');
    courtDiv.className = 'courtcard court-' + (gi + 1);

    const courtName = document.createElement('div');
    courtName.className = 'courtname';
    courtName.textContent = (t('court') || 'Court') + ' ' + (gi + 1);
    courtDiv.appendChild(courtName);

    const teamsDiv = document.createElement('div');
    teamsDiv.className = 'teams';

    ['L', 'R'].forEach((side, si) => {
      const teamDiv = document.createElement('div');
      teamDiv.className = 'team';
      teamDiv.dataset.teamSide = side;
      teamDiv.style.pointerEvents = 'none';

      if (game.winner === side) {
        teamDiv.classList.add('winner');
        const cup = document.createElement('img');
        cup.src = 'win-cup.png';
        cup.className = 'win-cup active';
        cup.style.cssText = 'pointer-events:none;visibility:visible;opacity:1;filter:none;';
        teamDiv.appendChild(cup);
      }

      const players = side === 'L' ? (game.pair1 || []) : (game.pair2 || []);
      players.forEach(name => {
        const btn = document.createElement('button');
        btn.className = side === 'L' ? 'Lplayer-btn' : 'Rplayer-btn';
        btn.textContent = name;
        btn.style.pointerEvents = 'none';
        btn.tabIndex = -1;
        teamDiv.appendChild(btn);
      });

      teamsDiv.appendChild(teamDiv);

      if (si === 0) {
        const vs = document.createElement('div');
        vs.className = 'vs-divider';
        vs.innerHTML = `<div class="vs-line"></div><span>${t('vsLabel')}</span><div class="vs-line"></div>`;
        teamsDiv.appendChild(vs);
      }
    });

    courtDiv.appendChild(teamsDiv);
    wrapper.appendChild(courtDiv);
  });

  if (data.resting && data.resting.length) {
    const tr2 = (typeof translations !== 'undefined') ? (translations[(typeof currentLang !== 'undefined') ? currentLang : 'en'] || {}) : {};
    const restRow = document.createElement('div');
    restRow.className = 'round-header viewer-resting-row';
    restRow.style.cssText = 'border-left:none!important;padding-left:10px;';
    restRow.textContent = tr2.sittingOut || t('resting');
    const restBox = document.createElement('div');
    restBox.className = 'rest-box';
    restBox.style.display = 'flex';
    data.resting.forEach(name => {
      const chip = document.createElement('span');
      chip.className = 'rest-btn';
      chip.textContent = name.split('#')[0];
      chip.style.cssText = 'pointer-events:none;cursor:default;';
      restBox.appendChild(chip);
    });
    restRow.appendChild(restBox);
    wrapper.appendChild(restRow);
  }

  return wrapper;
}


/* ── Read-only Dashboard inside Live Watch ──
   Uses only the session rounds_data. It never reads or mutates organiser state. */
function _vBaseName(name) {
  return String(name || '').split('#')[0].trim();
}

function _vCollectDashboardData(roundsData) {
  const names = new Set();
  const played = new Map();
  const rested = new Map();
  const roundMarks = new Map();
  const pairCounts = new Map();
  const oppCounts = new Map();

  const bump = (map, a, b) => {
    if (!a || !b || a === b) return;
    if (!map.has(a)) map.set(a, new Map());
    map.get(a).set(b, (map.get(a).get(b) || 0) + 1);
  };
  const mark = (name, idx, value) => {
    if (!roundMarks.has(name)) roundMarks.set(name, []);
    roundMarks.get(name)[idx] = value;
  };

  (roundsData || []).forEach((round, ri) => {
    (round.resting || []).forEach(raw => {
      const name = _vBaseName(raw);
      if (!name) return;
      names.add(name);
      rested.set(name, (rested.get(name) || 0) + 1);
      mark(name, ri, 'rest');
    });
    (round.games || []).forEach(game => {
      const p1 = (game.pair1 || []).map(_vBaseName).filter(Boolean);
      const p2 = (game.pair2 || []).map(_vBaseName).filter(Boolean);
      [...p1, ...p2].forEach(name => {
        names.add(name);
        played.set(name, (played.get(name) || 0) + 1);
        mark(name, ri, 'played');
      });
      for (let i = 0; i < p1.length; i++) for (let j = i + 1; j < p1.length; j++) { bump(pairCounts,p1[i],p1[j]); bump(pairCounts,p1[j],p1[i]); }
      for (let i = 0; i < p2.length; i++) for (let j = i + 1; j < p2.length; j++) { bump(pairCounts,p2[i],p2[j]); bump(pairCounts,p2[j],p2[i]); }
      p1.forEach(a => p2.forEach(b => { bump(oppCounts,a,b); bump(oppCounts,b,a); }));
    });
  });

  return {
    names: [...names], played, rested, roundMarks, pairCounts, oppCounts,
    rounds: roundsData || []
  };
}

function _vBuildRoundDashboard(roundsData) {
  const data = _vCollectDashboardData(roundsData);
  const group = document.createElement('div');
  group.className = 'player-history-group dashboard-tabs-group viewer-dashboard-group';

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'player-history-group-title';

  const body = document.createElement('div');
  body.className = 'player-history-group-body dashboard-tabs-body';

  // Live Watch is read-only, but the Dashboard card keeps the same
  // expand/collapse behaviour and visual structure as Round Manager.
  const open = localStorage.getItem('viewerDashboardOpen') !== 'false';
  if (!open) body.classList.add('rest-collapsed');
  header.innerHTML =
    '<span class="round-card-icon dashboard-card-icon" aria-hidden="true"><svg viewBox="0 0 32 32"><rect x="4" y="18" width="6" height="10" rx="1"></rect><rect x="13" y="10" width="6" height="18" rx="1"></rect><rect x="22" y="4" width="6" height="24" rx="1"></rect></svg></span>' +
    '<span class="round-card-copy"><span class="round-card-title">' + (t('dashboard') || 'Dashboard') + '</span><span class="round-card-subtitle">' + (t('dashboardHistoryHint') || 'View history, players, reports & more') + '</span></span>' +
    '<span class="player-history-group-arrow">' + (open ? '▴' : '▾') + '</span>';
  header.onclick = function() {
    const collapsed = body.classList.contains('rest-collapsed');
    body.classList.toggle('rest-collapsed', !collapsed);
    header.querySelector('.player-history-group-arrow').textContent = collapsed ? '▴' : '▾';
    localStorage.setItem('viewerDashboardOpen', collapsed ? 'true' : 'false');
  };

  const tabs = document.createElement('div');
  tabs.className = 'dashboard-history-tabs';
  tabs.setAttribute('role', 'tablist');

  const panels = document.createElement('div');
  panels.className = 'dashboard-history-panels';

  const entries = [
    ['rounds', t('rounds') || 'Rounds', _vBuildDashboardRounds(data)],
    ['pairing', t('pairing') || 'Pairing', _vBuildRelationshipTable(data, false)],
    ['opponents', t('opponents') || 'Opponents', _vBuildRelationshipTable(data, true)]
  ];

  let activeTab = localStorage.getItem('viewerDashboardHistoryTab') || 'rounds';
  if (!entries.some(entry => entry[0] === activeTab)) activeTab = 'rounds';

  const activate = key => {
    activeTab = key;
    localStorage.setItem('viewerDashboardHistoryTab', key);
    tabs.querySelectorAll('.dashboard-history-tab').forEach(btn => {
      const on = btn.dataset.tab === key;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    panels.querySelectorAll('.dashboard-history-panel').forEach(panel => {
      panel.classList.toggle('active', panel.dataset.panel === key);
    });
  };

  entries.forEach(([key, label, content]) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'dashboard-history-tab';
    tab.dataset.tab = key;
    tab.setAttribute('role', 'tab');
    tab.textContent = label;
    tab.onclick = event => { event.stopPropagation(); activate(key); };
    tabs.appendChild(tab);

    const panel = document.createElement('div');
    panel.className = 'dashboard-history-panel dashboard-history-panel-' + key;
    panel.dataset.panel = key;
    panel.setAttribute('role', 'tabpanel');
    panel.appendChild(content);
    panels.appendChild(panel);
  });

  body.append(tabs, panels);
  group.append(header, body);
  activate(activeTab);
  return group;
}

function _vBuildDashboardRounds(data) {
  // Match Round Manager's exact Dashboard > Rounds DOM/class structure.
  const section = document.createElement('div');
  section.className = 'round-header rested-info-section player-history-section';

  const box = document.createElement('div');
  box.className = 'rested-info-box player-history-box';
  const scroll = document.createElement('div');
  scroll.className = 'player-history-scroll';
  const table = document.createElement('table');
  table.className = 'player-history-table';

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  [t('players') || 'Players', t('played') || 'Played', t('rested') || 'Rested'].forEach(txt => {
    const th = document.createElement('th'); th.textContent = txt; hr.appendChild(th);
  });
  for (let i = data.rounds.length - 1; i >= 0; i--) {
    const th = document.createElement('th');
    th.textContent = ((typeof translations !== 'undefined' && translations[currentLang]?.roundShort) || 'R') + (data.rounds[i].round || (i + 1));
    hr.appendChild(th);
  }
  thead.appendChild(hr); table.appendChild(thead);

  const tbody = document.createElement('tbody');
  data.names.forEach(name => {
    const tr = document.createElement('tr');
    const n = document.createElement('td'); n.textContent = name; n.className = 'player-history-name'; tr.appendChild(n);
    const p = document.createElement('td'); p.textContent = String(data.played.get(name) || 0); p.className = 'player-history-played-count'; tr.appendChild(p);
    const r = document.createElement('td'); r.textContent = String(data.rested.get(name) || 0); r.className = 'player-history-rested-count'; tr.appendChild(r);
    const marks = data.roundMarks.get(name) || [];
    for (let i = data.rounds.length - 1; i >= 0; i--) {
      const td = document.createElement('td');
      if (marks[i] === 'played') { td.textContent = '●'; td.className = 'player-history-played'; }
      else if (marks[i] === 'rest') { td.textContent = '×'; td.className = 'player-history-rest'; }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  scroll.appendChild(table); box.appendChild(scroll); section.appendChild(box);
  return section;
}

function _vBuildRelationshipTable(data, isOpponent) {
  // Match Round Manager's Pairing/Opponents panel class structure. The data is
  // derived from live rounds only, so this remains display-only.
  const map = isOpponent ? data.oppCounts : data.pairCounts;
  const section = document.createElement('div');
  section.className = 'round-header not-yet-paired-section';
  const box = document.createElement('div');
  box.className = 'not-yet-paired-box';
  const scroll = document.createElement('div');
  scroll.className = 'not-yet-paired-scroll';
  const table = document.createElement('table');
  table.className = 'not-yet-paired-table';

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  const h1 = document.createElement('th'); h1.textContent = t('players') || 'Players';
  const h2 = document.createElement('th'); h2.textContent = '';
  const h3 = document.createElement('th'); h3.className = 'not-yet-paired-partner-heading'; h3.textContent = isOpponent ? (t('opponents') || 'Opponents') : (t('pairing') || 'Pairing');
  hr.append(h1, h2, h3); thead.appendChild(hr); table.appendChild(thead);

  const tbody = document.createElement('tbody');
  data.names.forEach(name => {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td'); tdName.textContent = name; tdName.className = 'player-history-name'; tr.appendChild(tdName);
    const tdCount = document.createElement('td'); tdCount.className = 'not-yet-paired-count'; tdCount.textContent = ''; tr.appendChild(tdCount);
    const tdRel = document.createElement('td'); tdRel.className = 'not-yet-paired-list';
    data.names.filter(other => other !== name).forEach(other => {
      const count = (map.get(name) && map.get(name).get(other)) || 0;
      const chip = document.createElement('span');
      chip.className = 'not-yet-paired-chip relationship-player-card ' + (count > 0 ? 'paired-chip' : 'unpaired-chip');
      chip.style.pointerEvents = 'none';
      const label = document.createElement('span'); label.textContent = other; chip.appendChild(label);
      const pill = document.createElement('span');
      pill.className = 'relationship-count-pill relationship-count-' + (count <= 0 ? 'zero' : count === 1 ? 'one' : count === 2 ? 'two' : count === 3 ? 'three' : 'many');
      pill.textContent = String(count); chip.appendChild(pill); tdRel.appendChild(chip);
    });
    tr.appendChild(tdRel); tbody.appendChild(tr);
  });
  table.appendChild(tbody); scroll.appendChild(table); box.appendChild(scroll); section.appendChild(box);
  return section;
}

/* ── Summary tab ── */
function _vRenderSummary(container) {
  container.innerHTML = '';
  const lang = (typeof currentLang !== 'undefined') ? currentLang : 'en';
  const tr   = (typeof translations !== 'undefined') ? (translations[lang] || {}) : {};

  const stats = new Map();
  for (const round of _vRoundsData) {
    for (const name of (round.resting || [])) {
      const base = name.split('#')[0];
      if (!stats.has(base)) stats.set(base, { wins: 0, played: 0, rest: 0 });
      stats.get(base).rest++;
    }
    for (const game of (round.games || [])) {
      [...(game.pair1 || []), ...(game.pair2 || [])].forEach(name => {
        if (!stats.has(name)) stats.set(name, { wins: 0, played: 0, rest: 0 });
        stats.get(name).played++;
      });
      if (game.winner) {
        const winners = game.winner === 'L' ? (game.pair1 || []) : (game.pair2 || []);
        winners.forEach(name => {
          if (!stats.has(name)) stats.set(name, { wins: 0, played: 0, rest: 0 });
          stats.get(name).wins++;
        });
      }
    }
  }

  const sorted = [...stats.entries()]
    .map(([name, s]) => ({ name, ...s }))
    .sort((a, b) => b.wins - a.wins || b.played - a.played);

  const header = document.createElement('div');
  header.className = 'report-header';
  header.innerHTML = `
    <div class="header-strip"></div>
    <div class="header-rank">Rank</div>
    <div class="header-name">Name</div>
    <div class="header-wins">W</div>
    <div class="header-played">P</div>
    <div class="header-rested">R</div>
  `;
  container.appendChild(header);

  sorted.forEach((p, idx) => {
    const colors = ['#f5a623','#9b9b9b','#cd7f32','#9e9e9e'];
    const card = document.createElement('div');
    card.className = 'player-card ' + (idx < 3 ? 'top-' + (idx + 1) : '');
    card.style.setProperty('--strip-color', colors[Math.min(idx, 3)]);
    card.innerHTML = `
      <div class="rating-strip"></div>
      <div class="rank">#${idx + 1}</div>
      <div class="name">${p.name}</div>
      <div class="stat wins">${p.wins}</div>
      <div class="stat played">${p.played}</div>
      <div class="stat rest">${p.rest}</div>
      <span class="rating-badge"></span>
      <div class="stat-label lbl-wins">W</div>
      <div class="stat-label lbl-played">P</div>
      <div class="stat-label lbl-rest">R</div>
    `;
    container.appendChild(card);
  });

  // Live Watch Summary: show the same read-only round dashboard used by
  // Round Manager (Rounds / Pairing / Opponents) before the round cards.
  container.appendChild(_vBuildRoundDashboard(_vRoundsData));

  const roundsTitle = document.createElement('div');
  roundsTitle.className = 'round-header';
  roundsTitle.style.margin = '16px 4px 6px';
  roundsTitle.textContent = tr.rounds || t('roundsLabel');
  container.appendChild(roundsTitle);

  for (let i = _vRoundsData.length - 1; i >= 0; i--) {
    container.appendChild(_vBuildRound(_vRoundsData[i]));
  }
}

/* ── Polling ── */
function viewerStartPoll() {
  viewerStopPoll();
  _vPollTimer = setInterval(async () => {
    try {
      const vPage = document.getElementById('viewerPage');
      if (!vPage || vPage.style.display === 'none') { viewerStopPoll(); return; }
      const rows = await sbGet('sessions',
        `id=eq.${_vSessionId}&select=rounds_data,started_by,created_at,updated_at,status`
      );
      if (!rows || !rows.length) { viewerStopPoll(); return; }
      const sess = rows[0];
      if (sess.updated_at === _vLastUpdated) return;
      _vLastUpdated = sess.updated_at;
      _vMeta = { started_by: sess.started_by, created_at: sess.created_at,
        club_name: (typeof getMyClub === 'function') ? getMyClub().name : '', status: sess.status };
      _vRoundsData = sess.rounds_data || [];
      _vRender(_vRoundsData);
      _vFlashLatest();
      if (sess.status === 'completed') viewerStopPoll();
    } catch (e) { /* silent */ }
  }, 60000);
}

function viewerStopPoll() {
  if (_vPollTimer) { clearInterval(_vPollTimer); _vPollTimer = null; }
}

function _vFlashLatest() {
  const el = document.querySelector('#viewerResults .round-wrapper');
  if (!el) return;
  el.classList.remove('viewer-flash');
  void el.offsetWidth;
  el.classList.add('viewer-flash');
  setTimeout(() => el.classList.remove('viewer-flash'), 1000);
}

/* ── Club login UI state ── */
function clubLoginRefresh() {
  const club = (typeof getMyClub === 'function') ? getMyClub() : null;
  const mode = localStorage.getItem('kbrr_club_mode');
  const loggedIn = !!(club && club.id);

  const loggedInState = document.getElementById('clubLoggedInState');
  const loginForm     = document.getElementById('clubLoginForm');
  if (loggedInState) loggedInState.style.display = loggedIn ? '' : 'none';
  if (loginForm)     loginForm.style.display     = loggedIn ? 'none' : '';

  if (loggedIn) {
    const dot  = document.getElementById('clubLoginDot');
    const name = document.getElementById('clubLoginName');
    const role = document.getElementById('clubLoginRole');
    if (name) name.textContent = club.name;
    if (dot)  { dot.style.background = '#2dce89'; dot.style.boxShadow = '0 0 0 3px rgba(45,206,137,0.2)'; }
    if (role) {
      role.textContent = mode === 'admin' ? (t('adminBadge')||'ADMIN') : (t('userBadge')||'USER');
      role.style.background = mode === 'admin' ? '#2dce89' : 'var(--accent)';
      role.style.color = mode === 'admin' ? '#000' : '#fff';
      role.style.display = 'inline-block';
    }
  }

  // Refresh all home tiles to reflect new club
  if (typeof homeRefreshTiles        === 'function') homeRefreshTiles();
  if (typeof homeRefreshJoinClubTile === 'function') homeRefreshJoinClubTile();
  if (typeof vaultSyncStatus         === 'function') vaultSyncStatus();
  if (typeof updateModePill          === 'function') updateModePill(localStorage.getItem('kbrr_app_mode') || 'viewer');
}

function clubLoginSwitch() {
  // Show login form to allow changing club
  const loggedInState = document.getElementById('clubLoggedInState');
  const loginForm     = document.getElementById('clubLoginForm');
  if (loggedInState) loggedInState.style.display = 'none';
  if (loginForm)     loginForm.style.display     = '';
  viewerLoadClubs();
}

/* ── Club login ── */
async function viewerLoadClubs() {
  const select   = document.getElementById('sbClubSelectViewer');
  const feedback = document.getElementById('sbClubFeedbackViewer');
  const setFb = (msg, ok) => { if (feedback) { feedback.textContent = msg; feedback.style.color = ok ? '#2dce89' : '#e63757'; } };
  if (!select) return;
  select.innerHTML = '<option value="">' + (t('loadingClubs')||'-- Loading clubs... --') + '</option>';
  try {
    const clubs = await sbGet('clubs', 'select=id,name&order=name.asc');
    select.innerHTML = '<option value="">' + (t('selectClub')||'-- Select club --') + '</option>';
    if (!clubs.length) { setFb(t('noClubsFoundDot'), false); return; }
    clubs.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id; opt.textContent = c.name;
      select.appendChild(opt);
    });
    setFb('', true);
    const cur = (typeof getMyClub === 'function') ? getMyClub() : null;
    if (cur && cur.id) select.value = cur.id;
  } catch (e) {
    select.innerHTML = '<option value="">' + (t('selectClub')||'-- Select club --') + '</option>';
    setFb(t('couldNotLoadClubsErr') + ' ' + e.message, false);
    console.warn('viewerLoadClubs:', e.message);
  }
}

async function viewerJoinClub() {
  const select   = document.getElementById('sbClubSelectViewer');
  const pwInput  = document.getElementById('sbPasswordInputViewer');
  const feedback = document.getElementById('sbClubFeedbackViewer');
  const status   = document.getElementById('sbClubStatusViewer');
  const setFb = (msg, ok) => { if (feedback) { feedback.textContent = msg; feedback.style.color = ok ? '#2dce89' : '#e63757'; } };
  if (!select || !select.value) { setFb(t('pleaseSelectClub'), false); return; }
  const pw = pwInput ? pwInput.value.trim() : '';
  if (!pw) { setFb(t('enterPasswordHint'), false); return; }
  try {
    // Club Management only accepts admin password
    const clubs = await sbGet('clubs', `id=eq.${select.value}&admin_password=eq.${encodeURIComponent(pw)}&select=id,name`);
    if (!clubs.length) throw new Error(t('wrongPasswordHint'));

    const role = 'admin';

    if (typeof setMyClub === 'function') setMyClub(clubs[0].id, clubs[0].name);
    localStorage.setItem('kbrr_club_mode', role);
    localStorage.setItem('kbrr_rating_field', 'club_rating');
    if (pwInput) pwInput.value = '';
    setFb(role === 'admin' ? '✅ Joined as Admin' : t('joinedSuccessfully'), true);
    clubLoginRefresh();
    if (typeof syncToLocal === 'function') syncToLocal();
  } catch (e) { setFb('❌ ' + e.message, false); }
}

/* ══════════════════════════════════════════════
   ORGANISER CLUB LOGIN -- uses member password
   ══════════════════════════════════════════════ */

function orgClubLoginRefresh() {
  const club = (typeof getMyClub === 'function') ? getMyClub() : null;
  const loggedIn = !!(club && club.id);

  const loggedInState = document.getElementById('orgClubLoggedInState');
  const loginForm     = document.getElementById('orgClubLoginForm');
  if (loggedInState) loggedInState.style.display = loggedIn ? '' : 'none';
  if (loginForm)     loginForm.style.display     = loggedIn ? 'none' : '';

  if (loggedIn) {
    const dot  = document.getElementById('orgClubLoginDot');
    const name = document.getElementById('orgClubLoginName');
    const role = document.getElementById('orgClubLoginRole');
    if (name) name.textContent = club.name;
    if (dot)  { dot.style.background = '#6c8cff'; dot.style.boxShadow = '0 0 0 3px rgba(108,140,255,0.2)'; }
    if (role) {
      role.textContent = t('sessionBadge');
      role.style.background = 'rgba(108,140,255,0.18)';
      role.style.color = '#6c8cff';
      role.style.display = 'inline-block';
    }
  }
}

function orgClubLoginSwitch() {
  if (typeof isDemoMode === 'function' && isDemoMode()) {
    if (typeof showDemoClubBlock === 'function') showDemoClubBlock();
    return;
  }
  const loggedInState = document.getElementById('orgClubLoggedInState');
  const loginForm     = document.getElementById('orgClubLoginForm');
  if (loggedInState) loggedInState.style.display = 'none';
  if (loginForm)     loginForm.style.display     = '';
  orgLoadClubs();
}

async function orgLoadClubs() {
  const select   = document.getElementById('orgClubSelect');
  const feedback = document.getElementById('orgClubFeedback');
  const setFb = (msg, ok) => { if (feedback) { feedback.textContent = msg; feedback.style.color = ok ? '#2dce89' : '#e63757'; } };
  if (!select) return;
  select.innerHTML = '<option value="">' + (t('loadingClubs')||'-- Loading clubs... --') + '</option>';
  try {
    const clubs = await sbGet('clubs', 'select=id,name&order=name.asc');
    select.innerHTML = '<option value="">' + (t('selectClub')||'-- Select club --') + '</option>';
    if (!clubs.length) { setFb(t('noClubsFoundDot'), false); return; }
    clubs.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id; opt.textContent = c.name;
      select.appendChild(opt);
    });
    const cur = (typeof getMyClub === 'function') ? getMyClub() : null;
    if (cur && cur.id) select.value = cur.id;
    setFb('', true);
  } catch (e) {
    select.innerHTML = '<option value="">' + (t('selectClub')||'-- Select club --') + '</option>';
    setFb(t('couldNotLoadClubsErr') + ' ' + e.message, false);
  }
}

async function orgJoinClub() {
  const select   = document.getElementById('orgClubSelect');
  const pwInput  = document.getElementById('orgClubPassword');
  const feedback = document.getElementById('orgClubFeedback');
  const setFb = (msg, ok) => { if (feedback) { feedback.textContent = msg; feedback.style.color = ok ? '#2dce89' : '#e63757'; } };
  if (!select || !select.value) { setFb(t('pleaseSelectClub'), false); return; }
  const pw = pwInput ? pwInput.value.trim() : '';
  if (!pw) { setFb(t('enterMemberPwHint'), false); return; }
  try {
    // Accept member password (not admin)
    const clubs = await sbGet('clubs', `id=eq.${select.value}&select_password=eq.${encodeURIComponent(pw)}&select=id,name`);
    if (!clubs.length) throw new Error(t('wrongPasswordHint'));

    if (typeof setMyClub === 'function') setMyClub(clubs[0].id, clubs[0].name);
    localStorage.setItem('kbrr_club_mode', 'user');
    localStorage.setItem('kbrr_rating_field', 'club_rating');
    if (pwInput) pwInput.value = '';
    setFb(t('connectedAsMember'), true);
    orgClubLoginRefresh();
    if (typeof syncToLocal === 'function') syncToLocal();
    if (typeof homeRefreshScreen === 'function') homeRefreshScreen();
  } catch (e) { setFb('❌ ' + e.message, false); }
}
