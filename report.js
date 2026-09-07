/* ============================================================
   report.js -- Club Monthly Report Generator
   Reads from: players (via memberships), sessions array
   Exports to: kariscs/SCS_Report on GitHub Pages
   ============================================================ */

const REPORT_GITHUB_OWNER = 'kariscs';
const REPORT_GITHUB_REPO  = 'SCS_Report';
const REPORT_GITHUB_API   = 'https://api.github.com';
const REPORT_PAGE_URL     = 'https://scs-app.com/';

/* ── Get current month string e.g. "2026-04" ── */
function reportCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

function reportMonthLabel() {
  const d = new Date();
  return d.toLocaleString('default', { month: 'long', year: 'numeric' });
}

/* ── Fetch all player data for report ── */
async function reportFetchData() {
  const club = (typeof getMyClub === 'function') ? getMyClub() : null;
  if (!club || !club.id) throw new Error('No club selected');

  const month = reportCurrentMonth();

  // ── Try server first, fall back to local ──
  let memberships = null;
  let allSessions = [];
  let usingLocal  = false;

  try {
    // 1. Get all sessions for this club this month
    allSessions = await sbGet('sessions',
      `club_id=eq.${club.id}&status=eq.completed&select=id,date,players,rounds_data,shuttle_data`
    ) || [];

    // 2. Get memberships for current rating/points
    memberships = await sbGet('memberships',
      `club_id=eq.${club.id}&select=id,nickname,club_rating,club_points`
    );
  } catch(e) {
    // ── Offline: fall back to local data ──
    usingLocal = true;
    const localPlayers = JSON.parse(localStorage.getItem('newImportHistory') || '[]');
    memberships = localPlayers.map(p => ({
      nickname:    p.displayName || p.name || '',
      club_rating: p.activeRating || p.rating || 1.0,
      club_points: p.club_points  || 0
    }));

    // Build sessions from local allRounds if available
    if (typeof allRounds !== 'undefined' && allRounds.length) {
      const _rToday = (typeof localDateStr === 'function') ? localDateStr() : (() => { const _n=new Date(),_p=n=>String(n).padStart(2,'0'); return `${_n.getFullYear()}-${_p(_n.getMonth()+1)}-${_p(_n.getDate())}`; })();
      allSessions = [{ date: _rToday, players: memberships.map(m => ({ name: m.nickname })), rounds_data: allRounds, shuttle_data: null }];
    }
  }

  if (!memberships || !memberships.length) throw new Error('No players found');

  const monthSessions = allSessions.filter(s => s.date && s.date.startsWith(month));

  // 3. Build per-player stats from sessions
  const _base = n => (n||'').replace(/#\d+$/, '').trim();
  const statsMap = {};
  for (const sess of monthSessions) {
    const costPerPlayer = sess.shuttle_data ? (parseFloat(sess.shuttle_data.cost_per_player) || 0) : 0;
    const roundsData    = sess.rounds_data || [];

    const winsMap = {}, lossesMap = {};
    for (const round of roundsData) {
      for (const game of (round.games || [])) {
        if (!game.winner) continue;
        const winners = game.winner === 'L' ? (game.pair1 || []) : (game.pair2 || []);
        const losers  = game.winner === 'L' ? (game.pair2 || []) : (game.pair1 || []);
        winners.forEach(n => { const b=_base(n); winsMap[b]   = (winsMap[b]   || 0) + 1; });
        losers.forEach(n  => { const b=_base(n); lossesMap[b] = (lossesMap[b] || 0) + 1; });
      }
    }

    // Use sess.players if available, else derive unique names from rounds_data
    let sessPlayerNames = (sess.players || []).map(p => _base(p.name || p.player_name || '')).filter(Boolean);
    if (!sessPlayerNames.length) {
      const seen = new Set();
      for (const round of roundsData) {
        for (const game of (round.games || [])) {
          [...(game.pair1||[]), ...(game.pair2||[])].forEach(n => seen.add(_base(n)));
        }
      }
      sessPlayerNames = Array.from(seen);
    }

    for (const name of sessPlayerNames) {
      if (!name) continue;
      if (!statsMap[name]) statsMap[name] = { wins: 0, losses: 0, cost: 0, sessions: 0 };
      statsMap[name].sessions += 1;
      statsMap[name].wins     += winsMap[name]   || 0;
      statsMap[name].losses   += lossesMap[name] || 0;
      statsMap[name].cost     += costPerPlayer;
    }
  }

  // 4. Merge with ratings/points — show ALL members
  const players = memberships.map(m => {
    const name  = m.nickname || '';
    const st    = statsMap[name] || { wins: 0, losses: 0, cost: 0, sessions: 0 };
    const games = st.wins + st.losses;
    return {
      name,
      rating:      parseFloat(m.club_rating) || 1.0,
      points:      Math.round((parseFloat(m.club_points) || 0) * 100) / 100,
      monthWins:   st.wins,
      monthLosses: st.losses,
      monthGames:  games,
      monthCost:   Math.round(st.cost),
      sessCount:   st.sessions,
      winRate:     games > 0 ? Math.round((st.wins / games) * 100) : 0,
    };
  }).filter(p => p.name)
    .sort((a, b) => b.rating - a.rating);

  return { club, players, month, monthLabel: reportMonthLabel(), usingLocal };
}

/* ── Build HTML string ── */
function reportBuildHTML({ club, players, monthLabel }) {
  const maxRating  = Math.max(...players.map(p => p.rating), 5);
  const maxSess    = Math.max(...players.map(p => p.sessCount), 1);
  const maxCost    = Math.max(...players.map(p => p.monthCost), 1);
  const maxPts     = Math.max(...players.map(p => p.points), 1);

  const totalCost  = players.reduce((a, p) => a + p.monthCost, 0);
  const avgRating  = players.length ? (players.reduce((a,p) => a+p.rating,0)/players.length).toFixed(1) : '--';
  const avgSess    = players.length ? (players.reduce((a,p) => a+p.sessCount,0)/players.length).toFixed(1) : '--';
  const topRating  = players.length ? players[0].rating.toFixed(1) : '--';
  const mostActive = players.length ? [...players].sort((a,b)=>b.sessCount-a.sessCount)[0] : null;
  const topPts     = players.length ? [...players].sort((a,b)=>b.points-a.points)[0] : null;

  function rank(i) {
    if (i===0) return '🥇'; if (i===1) return '🥈'; if (i===2) return '🥉';
    return `<span style="opacity:0.4;font-size:0.65rem;">${i+1}</span>`;
  }

  function pct(val, max) { return Math.round((val/max)*100); }

  function playerRows(sortKey, maxVal, valFn, displayFn) {
    return [...players]
      .sort((a,b) => b[sortKey]-a[sortKey])
      .map((p,i) => `
        <div class="w-row">
          <div class="r-rank">${rank(i)}</div>
          <div class="r-name">${p.name}</div>
          <div class="r-track"><div class="r-fill" style="width:${pct(valFn(p),maxVal)}%;"></div></div>
          <div class="r-val">${displayFn(p)}</div>
        </div>`).join('');
  }

  function axisLabels(vals) {
    return vals.map(v=>`<span>${v}</span>`).join('');
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${club.name} -- ${monthLabel} Report</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'DM Sans',sans-serif;background:#0a0a12;color:#fff;padding:16px;max-width:420px;margin:0 auto;min-height:100vh;}
.widget{border-radius:26px;overflow:hidden;margin-bottom:14px;position:relative;}
.w-header{padding:20px 20px 16px;position:relative;}
.w-club{font-size:0.68rem;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;opacity:0.7;margin-bottom:2px;}
.w-title{font-size:1.6rem;font-weight:700;letter-spacing:-0.5px;line-height:1.1;}
.w-icon{position:absolute;right:20px;top:18px;font-size:2.4rem;opacity:0.25;}
.w-meta{display:flex;gap:14px;margin-top:6px;flex-wrap:wrap;}
.w-meta-item{font-size:0.72rem;opacity:0.65;}
.w-meta-item strong{font-size:0.82rem;opacity:1;font-weight:600;margin-right:2px;}
.w-divider{height:1px;background:rgba(255,255,255,0.12);margin:0 20px;}
.w-rows{padding:8px 0 4px;}
.w-row{display:flex;align-items:center;padding:8px 20px;gap:10px;}
.r-rank{font-size:0.75rem;width:22px;flex-shrink:0;text-align:center;}
.r-name{font-size:0.8rem;font-weight:600;width:82px;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.r-track{flex:1;height:5px;background:rgba(255,255,255,0.12);border-radius:10px;overflow:hidden;position:relative;}
.r-fill{height:100%;border-radius:10px;position:absolute;left:0;top:0;}
.r-val{font-family:'DM Mono',monospace;font-size:0.72rem;font-weight:600;width:52px;text-align:right;flex-shrink:0;}
.w-axis{display:flex;justify-content:space-between;padding:4px 20px 14px;}
.w-axis span{font-size:0.55rem;opacity:0.3;font-family:'DM Mono',monospace;}
/* W1 Rating - Purple */
.w1{background:linear-gradient(145deg,#1a1040,#2d1b6e,#1e1060);border:1px solid rgba(160,120,255,0.25);box-shadow:0 8px 32px rgba(108,60,255,0.3);}
.w1 .r-fill{background:linear-gradient(90deg,#a78bfa,#c4b5fd);}
.w1 .r-val{color:#c4b5fd;}
.w1 .w-meta-item strong{color:#a78bfa;}
/* W2 Sessions - Teal */
.w2{background:linear-gradient(145deg,#0a2a2a,#0d4040,#0a3030);border:1px solid rgba(45,206,137,0.25);box-shadow:0 8px 32px rgba(20,180,140,0.25);}
.w2 .r-fill{background:linear-gradient(90deg,#2dce89,#7ef0c0);}
.w2 .r-val{color:#7ef0c0;}
.w2 .w-meta-item strong{color:#2dce89;}
/* W3 Cost - Gold */
.w3{background:linear-gradient(145deg,#1e1400,#3d2800,#2a1c00);border:1px solid rgba(245,200,66,0.25);box-shadow:0 8px 32px rgba(245,180,40,0.2);}
.w3 .r-fill{background:linear-gradient(90deg,#f5c842,#ffe599);}
.w3 .r-val{color:#ffe599;}
.w3 .w-meta-item strong{color:#f5c842;}
/* W4 Points - Coral */
.w4{background:linear-gradient(145deg,#1e0814,#3d1028,#2a0c1e);border:1px solid rgba(232,93,117,0.25);box-shadow:0 8px 32px rgba(232,93,117,0.2);}
.w4 .g-row{display:flex;align-items:center;padding:7px 20px;gap:10px;}
.w4 .g-name{font-size:0.8rem;font-weight:600;width:82px;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.w4 .g-track{flex:1;height:22px;background:rgba(255,255,255,0.07);border-radius:8px;overflow:hidden;}
.w4 .g-fill{height:100%;border-radius:8px;display:flex;align-items:center;padding-left:8px;font-size:0.62rem;font-weight:700;color:rgba(255,255,255,0.9);}
.w4 .g-num{font-family:'DM Mono',monospace;font-size:0.72rem;font-weight:600;width:38px;text-align:right;flex-shrink:0;color:#f9a8b8;}
.footer{text-align:center;font-size:0.6rem;color:rgba(255,255,255,0.18);padding:8px 0 12px;letter-spacing:0.5px;}
</style>
</head>
<body>

<!-- WIDGET 1 -- SESSIONS -->
<div class="widget w2">
  <div class="w-header">
    <div class="w-club">${club.name} · ${monthLabel}</div>
    <div class="w-title">Sessions</div>
    <div class="w-icon">🎮</div>
    <div class="w-meta">
      <div class="w-meta-item">Most <strong>${mostActive ? mostActive.sessCount : '--'}</strong></div>
      <div class="w-meta-item">Avg <strong>${avgSess}</strong></div>
    </div>
  </div>
  <div class="w-divider"></div>
  <div class="w-rows">
    ${playerRows('sessCount', maxSess, p=>p.sessCount, p=>p.sessCount)}
  </div>
  <div class="w-axis">${axisLabels(['0','','','','',maxSess])}</div>
</div>

<!-- WIDGET 2 -- COST -->
<div class="widget w3">
  <div class="w-header">
    <div class="w-club">${club.name} · ${monthLabel}</div>
    <div class="w-title">Cost</div>
    <div class="w-icon">💴</div>
    <div class="w-meta">
      <div class="w-meta-item">Total <strong>¥${totalCost.toLocaleString()}</strong></div>
      <div class="w-meta-item">Max <strong>¥${maxCost.toLocaleString()}</strong></div>
    </div>
  </div>
  <div class="w-divider"></div>
  <div class="w-rows">
    ${playerRows('monthCost', maxCost, p=>p.monthCost, p=>'¥'+p.monthCost.toLocaleString())}
  </div>
  <div class="w-axis">${axisLabels(['¥0','','','','','¥'+maxCost.toLocaleString()])}</div>
</div>

<!-- WIDGET 3 -- RATING -->
<div class="widget w1">
  <div class="w-header">
    <div class="w-club">${club.name} · ${monthLabel}</div>
    <div class="w-title">Rating</div>
    <div class="w-icon">⭐</div>
    <div class="w-meta">
      <div class="w-meta-item">Top <strong>${topRating}</strong></div>
      <div class="w-meta-item">Avg <strong>${avgRating}</strong></div>
      <div class="w-meta-item">Scale <strong>0 - 5</strong></div>
    </div>
  </div>
  <div class="w-divider"></div>
  <div class="w-rows">
    ${playerRows('rating', 5, p=>p.rating, p=>p.rating.toFixed(1))}
  </div>
  <div class="w-axis">${axisLabels(['0','1','2','3','4','5'])}</div>
</div>

<!-- WIDGET 4 -- POINTS -->
<div class="widget w4">
  <div class="w-header">
    <div class="w-club">${club.name} · ${monthLabel}</div>
    <div class="w-title">Points</div>
    <div class="w-icon">🏆</div>
    <div class="w-meta">
      <div class="w-meta-item">Top <strong>${topPts ? topPts.points : '--'} pts</strong></div>
    </div>
  </div>
  <div class="w-divider"></div>
  <div class="w-rows">
    ${[...players].sort((a,b)=>b.points-a.points).map((p,i)=>`
      <div class="g-row">
        <div class="g-name">${p.name}</div>
        <div class="g-track">
          <div class="g-fill" style="width:${pct(p.points,maxPts)}%;background:linear-gradient(90deg,#e85d75,#f9a8b8);">${p.points.toFixed(1)}</div>
        </div>
        <div class="g-num">${p.points.toFixed(1)}</div>
      </div>`).join('')}
  </div>
  <div class="w-axis">${axisLabels(['0','','','','',maxPts])}</div>
</div>

<div class="footer">Generated by KariBRR · ${monthLabel}</div>
</body>
</html>`;
}

/* ── Write HTML to GitHub Pages repo ── */
async function reportExportToGitHub(htmlContent, clubSlug, monthStr) {
  const filename = `${clubSlug}_${monthStr}.html`;
  const apiUrl   = `${REPORT_GITHUB_API}/repos/${REPORT_GITHUB_OWNER}/${REPORT_GITHUB_REPO}/contents/${filename}`;

  const token = (typeof getGithubToken === 'function') ? getGithubToken() : localStorage.getItem('kbrr_admin_token');

  // Check if file exists to get SHA
  let sha = null;
  try {
    const checkHeaders = { 'Accept': 'application/vnd.github+json' };
    if (token) checkHeaders['Authorization'] = `token ${token}`;
    const check = await fetch(apiUrl, { headers: checkHeaders });
    if (check.ok) { const j = await check.json(); sha = j.sha; }
  } catch(e) { /* new file */ }

  // Encode HTML as base64 (UTF-8 safe)
  const encoded = btoa(unescape(encodeURIComponent(htmlContent)));

  const body = {
    message: `Report: ${clubSlug} ${monthStr}`,
    content: encoded,
    ...(sha ? { sha } : {})
  };

  const putHeaders = { 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' };
  if (token) putHeaders['Authorization'] = `token ${token}`;

  const res = await fetch(apiUrl, {
    method: 'PUT',
    headers: putHeaders,
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Export failed');
  }

  return `${REPORT_PAGE_URL}${filename}`;
}

/* ── Main entry: generate + export ── */
async function reportGenerate() {
  const statusEl = document.getElementById('reportStatus');
  const btnEl    = document.getElementById('reportGenerateBtn');
  const linkEl   = document.getElementById('reportLink');

  function setStatus(msg, color) {
    if (statusEl) { statusEl.textContent = msg; statusEl.style.color = color || 'var(--muted)'; }
  }

  if (btnEl) btnEl.disabled = true;
  if (linkEl) linkEl.style.display = 'none';
  setStatus(t('loading') + '...');

  try {
    // 1. Fetch data
    setStatus('📊 ' + (t('loading') || 'Loading data...'));
    const data = await reportFetchData();

    // 2. Build HTML
    setStatus('🎨 Building report...');
    const html = reportBuildHTML(data);

    // 3. Export to GitHub
    setStatus('☁️ Uploading...');
    const clubSlug = data.club.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g,'');
    const url = await reportExportToGitHub(html, clubSlug, data.month);

    // 4. Show link
    setStatus('✅ Report published!', '#2dce89');
    if (linkEl) {
      linkEl.href = url;
      linkEl.textContent = url;
      linkEl.style.display = '';
    }
    if (btnEl) btnEl.disabled = false;

  } catch(e) {
    setStatus('❌ ' + e.message, '#e63757');
    if (btnEl) btnEl.disabled = false;
  }
}


/* ============================================================
   VIEWER REPORT — fetch + render per month
============================================================ */
async function reportFetchMonthData(year, month, clubId) {
  // clubId = null means all clubs for this user
  const monthStr = year + '-' + String(month).padStart(2, '0');
  const authUser = (typeof authGetUser === 'function') ? authGetUser() : null;

  // Determine which club IDs to fetch
  let clubIds = [];
  let clubLabel = (typeof t === 'function' && t('reportAllClubs')) || 'All Clubs';
  if (clubId) {
    clubIds = [clubId];
    // Find club name from memberships cache or getMyClub
    const club = (typeof getMyClub === 'function') ? getMyClub() : null;
    clubLabel = (club && club.id === clubId) ? (club.name || clubId) : clubId;
  } else if (authUser) {
    try {
      const mems = await sbGet('memberships',
        'user_account_id=eq.' + authUser.id + '&select=club_id').catch(function(){ return []; });
      clubIds = mems.map(function(m){ return m.club_id; }).filter(Boolean);
    } catch(e) { clubIds = []; }
    if (!clubIds.length) {
      const club = (typeof getMyClub === 'function') ? getMyClub() : null;
      if (club && club.id) clubIds = [club.id];
    }
  } else {
    const club = (typeof getMyClub === 'function') ? getMyClub() : null;
    if (!club || !club.id) throw new Error('No club found');
    clubIds = [club.id];
    clubLabel = club.name || '';
  }

  if (!clubIds.length) throw new Error('No clubs found');

  let sessions = [];
  let memberships = [];
  try {
    const allSess = await sbGet('sessions',
      'club_id=in.(' + clubIds.join(',') + ')&status=eq.completed&select=id,date,players,rounds_data,shuttle_data,club_id');
    sessions = (allSess || []).filter(function(s) { return s.date && s.date.startsWith(monthStr); });
  } catch(e) { sessions = []; }

  try {
    memberships = await sbGet('memberships',
      'club_id=in.(' + clubIds.join(',') + ')&select=id,nickname,club_rating,club_points') || [];
  } catch(e) { memberships = []; }

  const _base = function(n) { return (n||'').replace(/#\d+$/, '').trim(); };
  const statsMap = {};
  for (const sess of sessions) {
    const costPP = sess.shuttle_data ? (parseFloat(sess.shuttle_data.cost_per_player) || 0) : 0;
    const wins = {}, losses = {};
    for (const round of (sess.rounds_data || [])) {
      for (const game of (round.games || [])) {
        if (!game.winner) continue;
        const w = game.winner === 'L' ? game.pair1 : game.pair2;
        const l = game.winner === 'L' ? game.pair2 : game.pair1;
        (w||[]).forEach(function(n) { const b=_base(n); wins[b]   = (wins[b]   || 0) + 1; });
        (l||[]).forEach(function(n) { const b=_base(n); losses[b] = (losses[b] || 0) + 1; });
      }
    }
    // Build player list from sess.players if available, else derive from rounds_data
    var sessPlayerNames = (sess.players || []).map(function(p) { return _base(p.name || p.player_name || ''); }).filter(Boolean);
    if (!sessPlayerNames.length) {
      // Fallback: extract unique player names from rounds_data
      const seen = new Set();
      for (const round of (sess.rounds_data || [])) {
        for (const game of (round.games || [])) {
          [...(game.pair1||[]), ...(game.pair2||[])].forEach(function(n) { seen.add(_base(n)); });
        }
      }
      sessPlayerNames = Array.from(seen);
    }
    for (const name of sessPlayerNames) {
      if (!name) continue;
      if (!statsMap[name]) statsMap[name] = { wins:0, losses:0, cost:0, sessions:0 };
      statsMap[name].sessions += 1;
      statsMap[name].wins     += wins[name]   || 0;
      statsMap[name].losses   += losses[name] || 0;
      statsMap[name].cost     += costPP;
    }
  }

  const players = memberships.map(function(m) {
    const name = m.nickname || '';
    const st   = statsMap[name] || { wins:0, losses:0, cost:0, sessions:0 };
    return { name, rating: parseFloat(m.club_rating)||1.0, points: parseFloat(m.club_points)||0,
             sessions: st.sessions, cost: Math.round(st.cost), wins: st.wins, losses: st.losses };
  }).filter(function(p) { return p.name; }).sort(function(a,b) { return b.rating - a.rating; });

  const totalSessions = sessions.length;
  const totalCost     = players.reduce(function(s,p) { return s+p.cost; }, 0);
  const avgRating     = players.length ? (players.reduce(function(s,p){return s+p.rating;},0)/players.length).toFixed(1) : '--';
  const topRating     = players.length ? players[0].rating.toFixed(1) : '--';
  const topPoints     = players.length ? [...players].sort(function(a,b){return b.points-a.points;})[0] : null;
  const mostSessions  = players.length ? [...players].sort(function(a,b){return b.sessions-a.sessions;})[0] : null;

  return { clubLabel, players, year, month, monthStr, totalSessions, totalCost, topRating, avgRating, topPoints, mostSessions };
}

function reportRenderViewerPage(data) {
  const ct = document.getElementById('r2Content');
  if (!ct || !data) return;
  const { clubLabel, players, year, month, totalSessions, totalCost, topRating, avgRating, topPoints, mostSessions } = data;
  const reportLocale = ({ en:'en-US', jp:'ja-JP', kr:'ko-KR', vi:'vi-VN', zh:'zh-CN' })[(typeof currentLang !== 'undefined' ? currentLang : 'en')] || 'en-US';
  const monthLabel = new Date(year, month - 1, 1).toLocaleString(reportLocale, { month:'short', year:'numeric' });
  const tr = function(key, fallback) { return (typeof t === 'function' && t(key)) || fallback; };
  const label  = (clubLabel || tr('reportAllClubs','All Clubs')) + ' · ' + monthLabel;

  const maxSess   = Math.max.apply(null, players.map(function(p){return p.sessions;}), 1);
  const maxCost   = Math.max.apply(null, players.map(function(p){return p.cost;}), 1);
  const maxRating = Math.max.apply(null, players.map(function(p){return p.rating;}), 5);
  const maxPoints = Math.max.apply(null, players.map(function(p){return p.points;}), 1);

  function pct(v, mx) { return mx > 0 ? Math.min(100, Math.round(v/mx*100)) : 0; }
  function medal(i) { return i===0?'🥇 ':i===1?'🥈 ':i===2?'🥉 ':(i+1)+' '; }

  var _r2WidgetCounter = 0;

  window.reportToggleMore = function(btn, id) {
    var more = document.getElementById(id);
    if (!more || !btn) return;
    var opening = more.style.display === 'none';
    more.style.display = opening ? 'block' : 'none';
    btn.textContent = opening ? btn.dataset.lessText : btn.dataset.moreText;
  };

  function widget(color, bg, title, icon, subtitle, sorted, valFn, labelFn) {
    const wid = 'r2w' + (++_r2WidgetCounter);
    const PREVIEW = 3;

    function makeRow(p, i) {
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
        '<div style="width:82px;font-size:0.72rem;color:#ccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + medal(i) + p.name + '</div>' +
        '<div style="flex:1;height:16px;background:rgba(255,255,255,0.07);border-radius:6px;overflow:hidden;">' +
          '<div style="height:100%;width:' + pct(valFn(p), valFn(sorted[0])) + '%;background:' + color + ';border-radius:6px;"></div>' +
        '</div>' +
        '<div style="width:38px;font-size:0.7rem;color:#aaa;text-align:right;">' + labelFn(p) + '</div>' +
      '</div>';
    }

    const topRows  = sorted.slice(0, PREVIEW).map(function(p,i){ return makeRow(p,i); }).join('');
    const restRows = sorted.slice(PREVIEW).map(function(p,i){ return makeRow(p, i+PREVIEW); }).join('');
    const hasMore  = sorted.length > PREVIEW;

    const moreCount = sorted.length - PREVIEW;
    const showMoreText = tr('reportShowMore','Show {count} more').replace('{count}', String(moreCount)) + ' ▾';
    const showLessText = tr('reportShowLess','Show less') + ' ▴';
    const attr = function(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); };
    return '<div style="background:' + bg + ';border-radius:16px;padding:16px;margin-bottom:10px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
        '<div style="font-size:0.62rem;color:' + color + ';font-weight:700;letter-spacing:1px;">' + label.toUpperCase() + '</div>' +
        '<span style="font-size:1.4rem;">' + icon + '</span>' +
      '</div>' +
      '<div style="font-size:1.1rem;font-weight:800;color:#fff;margin-bottom:2px;">' + title + '</div>' +
      '<div style="font-size:0.72rem;color:#6b7db3;margin-bottom:12px;">' + subtitle + '</div>' +
      topRows +
      (hasMore
        ? '<div id="' + wid + '_more" style="display:none;">' + restRows + '</div>' +
          '<button data-more-text="' + attr(showMoreText) + '" data-less-text="' + attr(showLessText) + '" onclick="reportToggleMore(this,\'' + wid + '_more\')" ' +
          'style="margin-top:6px;background:rgba(255,255,255,0.07);border:none;border-radius:8px;color:#aaa;font-size:0.72rem;padding:5px 12px;cursor:pointer;width:100%;">' + showMoreText + '</button>'
        : '') +
    '</div>';
  }

  const sessSorted   = [...players].sort(function(a,b){return b.sessions-a.sessions;});
  const costSorted   = [...players].sort(function(a,b){return b.cost-a.cost;});
  const ratingSorted = [...players].sort(function(a,b){return b.rating-a.rating;});
  const pointsSorted = [...players].sort(function(a,b){return b.points-a.points;});

  _r2WidgetCounter = 0;
  ct.innerHTML =
    widget('#14b8a6','#0d2d2a',tr('sessions','Sessions'),'🎮',
      tr('reportTotal','Total') + ' ' + totalSessions + ' · ' + tr('reportMost','Most') + ' ' + (mostSessions?mostSessions.sessions:0),
      sessSorted, function(p){return p.sessions;}, function(p){return p.sessions;}) +
    widget('#f59e0b','#2d1f0d',tr('cost','Cost'),'💴',
      tr('reportTotal','Total') + ' ¥' + totalCost.toLocaleString(reportLocale),
      costSorted, function(p){return p.cost;}, function(p){return '¥'+p.cost;}) +
    widget('#7c3aed','#1a0d2e',tr('rating','Rating'),'⭐',
      tr('reportTop','Top') + ' ' + topRating + ' · ' + tr('reportAverage','Avg') + ' ' + avgRating,
      ratingSorted, function(p){return p.rating;}, function(p){return p.rating.toFixed(1);}) +
    widget('#e85d75','#2d0d1a',tr('reportPoints','Points'),'🏆',
      tr('reportTop','Top') + ' ' + (topPoints?topPoints.points.toFixed(1):'--'),
      pointsSorted, function(p){return p.points;}, function(p){return p.points.toFixed(1);});
}
