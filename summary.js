/* ============================================================
   SUMMARY TAB -- Round report and HTML export
   File: summary.js
   ============================================================ */

/* ── renderSummaryFromSession
   Fetches the current session from Supabase and renders using
   the viewer's existing _vRenderSummary + _vBuildRound renderers.
   Falls back to in-memory allRounds if no session ID found.
── */
async function renderSummaryFromSession() {
  const reportEl = document.getElementById('reportContainer');
  const exportEl = document.getElementById('export');
  if (reportEl) reportEl.innerHTML = '';
  if (exportEl)  exportEl.innerHTML = '';

  // Show loading state
  if (reportEl) reportEl.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted)"><div class="help-spinner"></div></div>';

  try {
    // Try to get session data from Supabase
    const sessionId = (typeof getMySessionId === 'function') ? getMySessionId() : null;
    let roundsData = null;
    let meta = {};

    if (sessionId) {
      const rows = await sbGet('sessions',
        `id=eq.${sessionId}&select=id,rounds_data,started_by,created_at,updated_at,status`
      );
      if (rows && rows.length) {
        roundsData = rows[0].rounds_data || [];
        meta = {
          started_by: rows[0].started_by,
          created_at: rows[0].created_at,
          club_name:  (typeof getMyClub === 'function') ? getMyClub().name : '',
          status:     rows[0].status
        };
      }
    }

    // Fallback to in-memory allRounds
    if (!roundsData || !roundsData.length) {
      if (Array.isArray(allRounds) && allRounds.length > 0) {
        roundsData = allRounds;
      }
    }

    if (!roundsData || !roundsData.length) {
      if (reportEl) reportEl.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:0.9rem;">' + t('noSessionDataAvail') + '</div>';
      return;
    }

    // Store in viewer state so _vRenderSummary can use it
    window._vRoundsData = roundsData;
    window._vMeta = meta;

    // Render using viewer's summary renderer into reportContainer + export
    if (reportEl) {
      reportEl.innerHTML = '';
      if (typeof _vRenderSummary === 'function') {
        _vRenderSummary(reportEl);
      }
    }

  } catch(e) {
    if (reportEl) reportEl.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:0.9rem;">' + t('couldNotLoadSession') + '</div>';
  }
}

// Keep renderRounds as a no-op so existing calls don't crash
function renderRounds() {}


// ExportCSS.js

async function createSummaryCSS() {
  return `
/* Summary */
.report-header,
.player-card {
  display: grid;
  grid-template-columns: 50px 1fr minmax(60px, auto) minmax(60px, auto) minmax(60px, auto);
  align-items: center;
  gap: 10px;
}

/* Header styling */
.report-header {
  margin: 5px 0;
  background: #800080;
  font-weight: bold;
  color: #fff;
  padding: 6px;
  border-radius: 6px;
  margin-bottom: 1px;
  position: sticky;
  z-index: 10;
}

/* Player card styling */
.player-card {
  background: #296472;
  color: #fff;
  padding: 2px;
  margin: 5px 0;
  border-radius: 1.1rem;
  border: 1px solid #555;
  box-shadow: 0 0 4px rgba(0,0,0,0.4);
}

/* Rank styling */
.player-card .rank {
  text-align: center;
  font-size: 1.1rem;
  font-weight: bold;
}

/* Name column */
.player-card .name {
  font-size: 1.1rem;
  padding-left: 6px;
}


.export-round {
  margin: 15px 3px 3px;
  border: 3px solid #800080;
}

.export-round-title {
  font-size: 1.125rem;
  font-weight: 600;
  margin-bottom: 16px;
  border-bottom: 1px solid #000;
  padding-bottom: 4px;
  text-align: center;
}

.export-match {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 5px;
}

.export-team {
  position: relative;           /* allow positioning of trophy */
  padding: 10px 25px 10px 10px; /* top/right/bottom/left; right space for trophy */
  display: flex;                /* use flex for centering and spacing */
  flex-direction: column;       /* stack players vertically */
  align-items: center;          /* center horizontally */
  justify-content: center;      /* center vertically */
  border: 2px solid #333;    /* boundary */
  border-radius: 8px;           /* optional rounded corners */
  width: 37%;             /* ensures all boxes roughly same size */
  background-color:none;    /* optional light background */
  text-align: center;           /* center text inside */
}

/* Trophy on the right for winning team */
.export-team::after {
  content: '🏆';
  position: absolute;
  right: 5px;                   /* stick to right edge */
  top: 50%;                     /* vertically center */
  transform: translateY(-50%);
  display: none;                 /* hidden by default */
}

.export-team.winner::after {
  display: inline-block;
}



.export-vs {
  width: 10%;
  text-align: center;
  font-weight: 600;
}

/* Sitting out */
.export-rest-title {
  margin: 5px;
  font-weight: 600;
}

.export-rest-box {
  margin: 5px;
  font-size: .8125rem;
}

`;
}

async function exportBRR2HTML() {
  const SUMMARY_CSS = await createSummaryCSS();
  showPage('summaryPage');
  await new Promise(r => setTimeout(r, 300));

  const page = document.getElementById('summaryPage');
  if (!page) return alert("Export page not found");

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BRR Export</title>
<style>
${SUMMARY_CSS}
</style>
</head>
<body>
${page.outerHTML}
</body>
</html>
`;

  // ✅ Android WebView
  if (window.Android && typeof Android.saveHtml === "function") {
    Android.saveHtml(html);
  }

  // ✅ iOS WebView (if you implemented message handler)
  else if (window.webkit && window.webkit.messageHandlers?.saveHtml) {
    window.webkit.messageHandlers.saveHtml.postMessage(html);
  }

  // ✅ Normal browser fallback (download file)
  else {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "BRR_Export.html";
    a.click();

    URL.revokeObjectURL(url);
  }
}
