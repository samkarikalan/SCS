// Build 394: skip the extra Google/LINE handoff pages and open authentication directly.

// Build 393: show today's playable organiser slot without the removed organiser-login gate.
// Initialise welcome state before any carousel code can run. This keeps the
// hub refresh usable even if a later, unrelated startup component fails.
window.__scsWelcomeHubData = window.__scsWelcomeHubData || {
  player: null,
  organiser: null,
  vault: null,
  refreshedAt: 0
};
window.__scsWelcomeHubRefreshPromise = null;
window.__scsWelcomeHubRefreshGeneration = 0;

// Shared selection used by the launcher, carousel and Assist controller.
// It must exist before any startup path reads it; later restoration code can
// replace this default with the saved workspace.
var welcomeSelectedWorkspace = 'organiser';

window.__scsStartupBeganAt = performance.now();
window.scsFinishStartup = function scsFinishStartup() {
  var splash = document.getElementById('scsStartupSplash');
  if (!splash || splash.classList.contains('is-ready')) return;
  var elapsed = performance.now() - (window.__scsStartupBeganAt || 0);
  var delay = Math.max(0, 650 - elapsed);
  window.setTimeout(function() {
    requestAnimationFrame(function() {
      splash.classList.add('is-ready');
      window.setTimeout(function() { if (splash && splash.parentNode) splash.remove(); }, 360);
    });
  }, delay);
};
window.setTimeout(function() {
  if (typeof window.scsFinishStartup === 'function') window.scsFinishStartup();
}, 7000);

// Build 392: preload every workspace while the startup ring is visible.
// Mode changes can then render from the prepared in-memory/local cache and
// perform only a quiet freshness sync instead of starting a first-time load.
window.__scsWorkspacePrefetchReady = false;
window.__scsWorkspacePrefetchPromise = null;
window.scsPrefetchAllWorkspaceData = function scsPrefetchAllWorkspaceData() {
  if (window.__scsWorkspacePrefetchPromise) return window.__scsWorkspacePrefetchPromise;

  var jobs = [];
  function addJob(name, fn) {
    if (typeof fn !== 'function') return;
    jobs.push(Promise.resolve().then(fn).catch(function(error) {
      console.warn('Startup prefetch skipped (' + name + '):', error && (error.message || error));
      return null;
    }));
  }

  // Shared account, membership and player data used across all workspaces.
  addJob('local player sync', function() {
    return typeof syncToLocal === 'function' ? syncToLocal() : null;
  });
  addJob('global player cache', function() {
    return typeof syncGlobalPlayersCache === 'function' ? syncGlobalPlayersCache() : null;
  });
  addJob('organiser clubs', function() {
    return typeof getOrganiserEligibleClubs === 'function' ? getOrganiserEligibleClubs() : null;
  });

  // Player and Club Manager calendar/slot data. Their loaders populate the
  // same in-memory maps later used by their workspace renderers.
  addJob('player slots', function() {
    return typeof _mcsLoadMonthSlots === 'function' ? _mcsLoadMonthSlots() : null;
  });
  addJob('club manager slots', function() {
    return typeof _vhsLoadMonthSlots === 'function' ? _vhsLoadMonthSlots() : null;
  });

  // Welcome/dashboard counters and role labels use these shared refreshes.
  addJob('welcome roles', function() {
    return typeof restoreUserClubRoles === 'function' ? restoreUserClubRoles() : null;
  });
  addJob('launcher session', function() {
    return typeof renderLauncherStartSessionCard === 'function' ? renderLauncherStartSessionCard() : null;
  });

  window.__scsWorkspacePrefetchPromise = Promise.allSettled(jobs).then(async function() {
    // The mode-selection page is rendered only from this completed startup cache.
    // Run it after role restoration and slot prefetch so every label/count/photo
    // uses the same resolved club context as the actual workspace pages.
    if (typeof window.scsPrefetchWelcomeHubData === 'function') {
      // A fresh install may start an anonymous welcome request before account
      // and club-role restoration completes. Force one resolved-role pass so
      // the Round Manager club picker is populated on its first appearance.
      await window.scsPrefetchWelcomeHubData(true);
    }
    window.__scsWorkspacePrefetchReady = true;
    window.dispatchEvent(new CustomEvent('scs:workspace-prefetch-ready'));
    return true;
  });
  return window.__scsWorkspacePrefetchPromise;
};


/* ══════════════════════════════════════════════
   MODE SYSTEM -- Viewer / Organiser
   Stored in sessionStorage (resets on app close)
══════════════════════════════════════════════ */

var appMode = null; // 'viewer' | 'organiser'

/* Cross-device Organiser/Vault grants. Stores verified roles, never passwords. */
async function getLinkedManagementClub(role) {
  var user = (typeof authGetUser === 'function') ? authGetUser() : null;
  if (!user || !user.id || !['organiser', 'vault'].includes(role)) return null;
  var verifiedColumn = role === 'organiser' ? 'organiser_verified' : 'vault_verified';
  var active = await sbGet('user_club_roles',
    'user_account_id=eq.' + user.id +
    '&' + verifiedColumn + '=eq.true' +
    '&order=updated_at.desc&select=club_id')
    .catch(function() { return []; });
  if (!active || !active.length) return null;
  var clubs = await sbGet('clubs', 'id=eq.' + active[0].club_id + '&select=id,name')
    .catch(function() { return []; });
  return clubs && clubs[0] ? clubs[0] : null;
}

async function saveUserClubRole(clubId, role) {
  var user = (typeof authGetUser === 'function') ? authGetUser() : null;
  if (!user || !user.id || !clubId || !['organiser', 'vault'].includes(role)) return;

  // Organiser and Club Manager are independent workspaces. Restrict only a
  // duplicate grant for the same role; never compare one role with the other.
  var verifiedColumn = role === 'organiser' ? 'organiser_verified' : 'vault_verified';
  var active = await sbGet('user_club_roles',
    'user_account_id=eq.' + user.id +
    '&' + verifiedColumn + '=eq.true' +
    '&order=updated_at.desc&select=club_id')
    .catch(function() { return []; });
  var linked = (active || []).find(function(g) { return String(g.club_id) !== String(clubId); });
  if (linked) {
    // Move this role to the newly selected club while preserving any other
    // workspace grant stored on the old row.
    var oldRows = await sbGet('user_club_roles',
      'user_account_id=eq.' + user.id + '&club_id=eq.' + linked.club_id +
      '&select=organiser_verified,vault_verified').catch(function() { return []; });
    var old = oldRows && oldRows[0] ? oldRows[0] : {};
    await sbUpsert('user_club_roles', {
      user_account_id: user.id,
      club_id: linked.club_id,
      organiser_verified: role === 'organiser' ? false : !!old.organiser_verified,
      vault_verified: role === 'vault' ? false : !!old.vault_verified,
      updated_at: new Date().toISOString()
    }, 'user_account_id,club_id');
  }

  var rows = await sbGet('user_club_roles',
    'user_account_id=eq.' + user.id + '&club_id=eq.' + clubId +
    '&select=organiser_verified,vault_verified').catch(function() { return []; });
  var current = rows && rows[0] ? rows[0] : {};
  var data = {
    user_account_id: user.id,
    club_id: clubId,
    organiser_verified: role === 'organiser' ? true : !!current.organiser_verified,
    vault_verified: role === 'vault' ? true : !!current.vault_verified,
    updated_at: new Date().toISOString()
  };
  await sbUpsert('user_club_roles', data, 'user_account_id,club_id');
}

/* Explicit role logout must also disable cross-device auto-login. */
async function revokeUserClubRole(clubId, role) {
  var user = (typeof authGetUser === 'function') ? authGetUser() : null;
  if (!user || !user.id || !clubId || !['organiser', 'vault'].includes(role)) return;
  var rows = await sbGet('user_club_roles',
    'user_account_id=eq.' + user.id + '&club_id=eq.' + clubId +
    '&select=organiser_verified,vault_verified').catch(function() { return []; });
  var current = rows && rows[0] ? rows[0] : {};
  await sbUpsert('user_club_roles', {
    user_account_id: user.id,
    club_id: clubId,
    organiser_verified: role === 'organiser' ? false : !!current.organiser_verified,
    vault_verified: role === 'vault' ? false : !!current.vault_verified,
    updated_at: new Date().toISOString()
  }, 'user_account_id,club_id');
}

function syncRoundAndSlotManagerClub(clubId, clubName) {
  clubId = String(clubId || '');
  clubName = clubName || '';
  if (!clubId) return;
  // Round Manager and Slot Manager intentionally share one selected club.
  // Keep both workspace keys aligned whenever either manager changes clubs.
  localStorage.setItem('kbrr_org_club_id', clubId);
  localStorage.setItem('kbrr_org_club_name', clubName);
  localStorage.setItem('kbrr_vault_club_id', clubId);
  localStorage.setItem('kbrr_vault_club_name', clubName);
  // Database session helpers read the shared active-club keys. Keep them in
  // lockstep when a manager club is restored automatically as well as when
  // the user changes it manually.
  localStorage.setItem('kbrr_my_club_id', clubId);
  localStorage.setItem('kbrr_my_club_name', clubName);
}

function hasVerifiedWorkspaceRole(role) {
  var isOrganiser = role === 'organiser';
  var verifiedKey = isOrganiser ? 'scs_organiser_verified' : 'scs_vault_verified';
  var clubKey = isOrganiser ? 'kbrr_org_club_id' : 'kbrr_vault_club_id';
  var verified = sessionStorage.getItem(verifiedKey) === '1' ||
    localStorage.getItem(verifiedKey) === '1';
  var clubId = localStorage.getItem(clubKey) || '';
  if (verified && clubId) return true;

  if (verified && !clubId) {
    sessionStorage.removeItem(verifiedKey);
    localStorage.removeItem(verifiedKey);
  }
  return false;
}

/* Organiser access follows club membership. No organiser password is stored or
   requested. Club Manager access is independent. */
async function getOrganiserEligibleClubs(userOverride) {
  var user = userOverride || ((typeof authGetUser === 'function') ? authGetUser() : null);

  // Only the shared Demo account is restricted to the Demo club.
  // A normal signed-in user must always see every club membership even if
  // Demo is the currently active club or a stale demo-mode flag remains.
  var demoFlag = typeof isDemoMode === 'function' && isDemoMode();
  var demoEmail = (typeof DEMO_EMAIL !== 'undefined' && DEMO_EMAIL) ? String(DEMO_EMAIL).toLowerCase() : '';
  var userEmail = user && user.email ? String(user.email).toLowerCase() : '';
  var isSharedDemoAccount = demoFlag && demoEmail && userEmail === demoEmail;
  if (isSharedDemoAccount) {
    var demoClub = (typeof getMyClub === 'function') ? getMyClub() : null;
    return demoClub && demoClub.id ? [{ id: demoClub.id, name: demoClub.name || '', source: 'demo' }] : [];
  }

  if (!user || !user.id) return [];

  var cachedId = localStorage.getItem('kbrr_org_club_id') || '';
  var cachedName = localStorage.getItem('kbrr_org_club_name') || '';

  // Build 811: offline Round Manager may use only the organiser club that was
  // previously verified online on this device. Subscription access is still
  // enforced by switchMode()/canAccessMode() before this function is reached.
  if (navigator.onLine === false) {
    var cachedVerified = localStorage.getItem('scs_organiser_verified') === '1';
    return (cachedVerified && cachedId)
      ? [{ id: String(cachedId), name: cachedName || '', source: 'offline-cache' }]
      : [];
  }

  var memberships;
  var memberships;
  try {
    memberships = await sbGet('memberships',
      'user_account_id=eq.' + encodeURIComponent(user.id) + '&select=club_id');
  } catch (error) {
    // Membership controls Round Manager access. Never fall back to a cached
    // organiser club here, because the player may already have left it.
    return [];
  }

  var ids = Array.from(new Set((memberships || []).map(function(membership) {
    return String(membership.club_id || '');
  }).filter(Boolean)));
  var clubs = ids.length
    ? await sbGet('clubs', 'id=in.(' + ids.map(encodeURIComponent).join(',') + ')&select=id,name&order=name.asc')
        .catch(function() { return []; })
    : [];
  var options = (clubs || []).map(function(club) {
    return { id: String(club.id), name: club.name || '', source: 'membership' };
  });

  // A signed-in user may explicitly choose the Demo club for Round Manager.
  // This is deliberately separate from global isDemoMode(), so their account,
  // Home profile and My Card remain the real signed-in user.
  if (typeof isRoundManagerDemoMode === 'function' && isRoundManagerDemoMode() &&
      typeof DEMO_CLUB_ID !== 'undefined' && DEMO_CLUB_ID &&
      !options.some(function(club) { return club.id === String(DEMO_CLUB_ID); })) {
    options.unshift({
      id: String(DEMO_CLUB_ID),
      name: (typeof DEMO_CLUB_NAME !== 'undefined' && DEMO_CLUB_NAME) ? DEMO_CLUB_NAME : 'Demo',
      source: 'demo'
    });
  }

  // A verified Club Manager can also use Round Manager for that club.
  // If the account is not yet a club member, login restoration will create
  // the player's membership automatically so the two roles stay aligned.
  var vaultVerified = (typeof hasVerifiedWorkspaceRole === 'function' && hasVerifiedWorkspaceRole('vault')) ||
    sessionStorage.getItem('scs_vault_verified') === '1' || localStorage.getItem('scs_vault_verified') === '1';
  var vaultClubId = localStorage.getItem('kbrr_vault_club_id') || '';
  if (vaultVerified && vaultClubId && !options.some(function(club) { return club.id === String(vaultClubId); })) {
    options.unshift({
      id: String(vaultClubId),
      name: localStorage.getItem('kbrr_vault_club_name') || '',
      source: 'vault'
    });
  }

  // A player with no club can still enter Round Manager through the existing
  // Demo club. Do not change the normal club list for existing members.
  if (!options.length && typeof DEMO_CLUB_ID !== 'undefined' && DEMO_CLUB_ID) {
    options.push({
      id: String(DEMO_CLUB_ID),
      name: (typeof DEMO_CLUB_NAME !== 'undefined' && DEMO_CLUB_NAME) ? DEMO_CLUB_NAME : 'Demo',
      source: 'demo'
    });
  }
  return options;
}

async function ensureClubManagerPlayerMembership(userOverride, clubId, chosenNickname) {
  var user = userOverride || ((typeof authGetUser === 'function') ? authGetUser() : null);
  clubId = String(clubId || '');
  if (!user || !user.id || !clubId) return null;

  // Never create a duplicate membership for the same signed-in account.
  var existing = await sbGet('memberships',
    'club_id=eq.' + encodeURIComponent(clubId) +
    '&user_account_id=eq.' + encodeURIComponent(user.id) +
    '&select=id,player_id,nickname,club_rating&limit=1'
  ).catch(function() { return []; });
  if (existing && existing.length) return existing[0];

  // The account nickname is the first choice for a new club membership.
  // A caller-supplied nickname is used only after the UI has asked the user
  // to choose a different nickname for this club.
  var accountNickname = String(user.nickname || user.displayName || user.name || '').trim();
  if (!accountNickname && user.email) accountNickname = String(user.email).split('@')[0].trim();
  var nickname = String(chosenNickname || accountNickname || '').trim();
  if (!nickname) {
    return { needsNickname: true, suggestedNickname: '' };
  }

  // A matching nickname may already exist as an unregistered club player.
  // In that case, reuse/claim that existing membership for this signed-in user.
  // Only a nickname already linked to a DIFFERENT account is a real conflict.
  var conflict = await sbGet('memberships',
    'club_id=eq.' + encodeURIComponent(clubId) +
    '&nickname=ilike.' + encodeURIComponent(nickname) +
    '&select=id,player_id,user_account_id,club_rating&limit=1'
  ).catch(function() { return []; });
  if (conflict && conflict.length) {
    var matchingMembership = conflict[0];
    if (!matchingMembership.user_account_id) {
      await sbPatch('memberships', 'id=eq.' + encodeURIComponent(matchingMembership.id),
        { user_account_id: user.id }).catch(function() {});
      if (matchingMembership.player_id) {
        await sbPatch('players',
          'id=eq.' + encodeURIComponent(matchingMembership.player_id) + '&user_account_id=is.null',
          { user_account_id: user.id }).catch(function() {});
      }
      localStorage.removeItem('kbrr_cache_players');
      localStorage.removeItem('kbrr_cache_ts');
      localStorage.removeItem('kbrr_cache_club_id');
      matchingMembership.user_account_id = user.id;
      return matchingMembership;
    }
    if (String(matchingMembership.user_account_id) === String(user.id)) {
      return matchingMembership;
    }
    return { needsNickname: true, suggestedNickname: nickname, nicknameConflict: true };
  }

  // Reuse the account's existing player identity wherever possible, while
  // allowing the membership nickname to differ from club to club.
  var linkedMemberships = await sbGet('memberships',
    'user_account_id=eq.' + encodeURIComponent(user.id) +
    '&select=player_id,club_rating&limit=1'
  ).catch(function() { return []; });

  var playerId = linkedMemberships && linkedMemberships[0] && linkedMemberships[0].player_id
    ? String(linkedMemberships[0].player_id) : '';
  var rating = Number(linkedMemberships && linkedMemberships[0] && linkedMemberships[0].club_rating);
  if (!(rating >= 1 && rating <= 5)) rating = 1;

  if (!playerId) {
    var playerRows = await sbGet('players',
      'user_account_id=eq.' + encodeURIComponent(user.id) +
      '&select=id,name,global_rating&limit=1'
    ).catch(function() { return []; });
    if (playerRows && playerRows.length) {
      playerId = String(playerRows[0].id || '');
      var globalRating = Number(playerRows[0].global_rating);
      if (globalRating >= 1 && globalRating <= 5) rating = globalRating;
    }
  }

  if (!playerId) {
    var gender = ['Male', 'Female'].includes(user.gender) ? user.gender : 'Male';
    var created = await sbPost('players', {
      name: accountNickname || nickname,
      gender: gender,
      global_rating: rating,
      global_points: 0
    });
    if (!created || !created[0] || !created[0].id) return null;
    playerId = String(created[0].id);
    await sbPatch('players', 'id=eq.' + encodeURIComponent(playerId), { user_account_id: user.id }).catch(function() {});
  } else {
    await sbPatch('players', 'id=eq.' + encodeURIComponent(playerId) + '&user_account_id=is.null',
      { user_account_id: user.id }).catch(function() {});
  }

  var createdMembership = await sbPost('memberships', {
    player_id: playerId,
    club_id: clubId,
    nickname: nickname,
    club_rating: rating,
    club_points: 0,
    user_account_id: user.id
  }).catch(function() { return null; });

  localStorage.removeItem('kbrr_cache_players');
  localStorage.removeItem('kbrr_cache_ts');
  localStorage.removeItem('kbrr_cache_club_id');
  return createdMembership && createdMembership[0] ? createdMembership[0] : null;
}

async function syncOrganiserMembershipAccess(userOverride, selectedClubId) {
  var options = await getOrganiserEligibleClubs(userOverride);
  if (!options.length) {
    sessionStorage.removeItem('scs_organiser_verified');
    localStorage.removeItem('scs_organiser_verified');
    localStorage.removeItem('kbrr_org_club_id');
    localStorage.removeItem('kbrr_org_club_name');
    return null;
  }
  var cachedId = localStorage.getItem('kbrr_org_club_id') || '';
  var activeClub = (typeof getMyClub === 'function') ? getMyClub() : null;
  var preferredId = selectedClubId || (activeClub && activeClub.id) || cachedId;
  var club = options.find(function(option) { return option.id === String(preferredId || ''); }) || options[0];
  sessionStorage.setItem('scs_organiser_verified', '1');
  localStorage.setItem('scs_organiser_verified', '1');
  syncRoundAndSlotManagerClub(club.id, club.name || '');
  return club;
}

async function restoreUserClubRoles(userOverride) {
  var user = userOverride || ((typeof authGetUser === 'function') ? authGetUser() : null);
  if (!user || !user.id) return;

  // Preserve the user's explicit Welcome-page defaults before refreshing
  // permissions. A refresh/app update must not replace them merely because a
  // different permission row is newer or appears first in the server result.
  var savedOrganiserClubId = localStorage.getItem('kbrr_org_club_id') || '';
  var savedVaultClubId = localStorage.getItem('kbrr_vault_club_id') || '';

  var grants = await sbGet('user_club_roles',
    'user_account_id=eq.' + user.id +
    '&order=updated_at.desc&select=club_id,organiser_verified,vault_verified,updated_at')
    .catch(function() { return null; });
  if (grants === null) return; // Offline/server error: preserve last known local access.
  var currentMemberships = await sbGet('memberships',
    'user_account_id=eq.' + encodeURIComponent(user.id) + '&select=club_id')
    .catch(function() { return null; });
  if (currentMemberships === null) return;
  var currentMembershipClubIds = new Set((currentMemberships || []).map(function(row) {
    return String(row.club_id || '');
  }).filter(Boolean));
  grants = (grants || []).filter(function(grant) {
    return currentMembershipClubIds.has(String(grant.club_id || ''));
  });

  // Restore each workspace independently. The newest active grant for each
  // role wins, and the two roles may point to different clubs.
  var orgGrant = grants.find(function(g) {
    return g.organiser_verified && savedOrganiserClubId && String(g.club_id) === String(savedOrganiserClubId);
  }) || grants.find(function(g) { return g.organiser_verified; }) || null;
  var vaultGrant = grants.find(function(g) {
    return g.vault_verified && savedVaultClubId && String(g.club_id) === String(savedVaultClubId);
  }) || grants.find(function(g) { return g.vault_verified; }) || null;
  var ids = [];
  if (orgGrant) ids.push(orgGrant.club_id);
  if (vaultGrant && !ids.includes(vaultGrant.club_id)) ids.push(vaultGrant.club_id);
  var clubs = ids.length
    ? await sbGet('clubs', 'id=in.(' + ids.join(',') + ')&select=id,name').catch(function() { return null; })
    : [];
  if (clubs === null) return;

  ['scs_organiser_verified', 'scs_vault_verified'].forEach(function(key) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  });
  ['kbrr_org_club_id', 'kbrr_org_club_name', 'kbrr_vault_club_id', 'kbrr_vault_club_name']
    .forEach(function(key) { localStorage.removeItem(key); });

  var names = {};
  (clubs || []).forEach(function(c) { names[c.id] = c.name || ''; });
  if (orgGrant && !Object.prototype.hasOwnProperty.call(names, orgGrant.club_id)) orgGrant = null;
  if (vaultGrant && !Object.prototype.hasOwnProperty.call(names, vaultGrant.club_id)) vaultGrant = null;

  if (orgGrant) {
    localStorage.setItem('scs_organiser_verified', '1');
    sessionStorage.setItem('scs_organiser_verified', '1');
    localStorage.setItem('kbrr_org_club_id', orgGrant.club_id);
    localStorage.setItem('kbrr_org_club_name', names[orgGrant.club_id] || '');
  }
  if (vaultGrant) {
    localStorage.setItem('scs_vault_verified', '1');
    sessionStorage.setItem('scs_vault_verified', '1');
    localStorage.setItem('kbrr_vault_club_id', vaultGrant.club_id);
    localStorage.setItem('kbrr_vault_club_name', names[vaultGrant.club_id] || '');

    // A deleted membership is authoritative. Never recreate a removed player
    // merely because an older Club Manager grant still exists.
  }

  // Membership-based Organiser access remains independent of Club Manager.
  // Organiser access is membership-based. Prefer the club explicitly chosen
  // on Welcome even when it has no separate user_club_roles row; the
  // membership sync validates it and safely falls back if it is no longer
  // eligible.
  var restoredOrganiserClub = await syncOrganiserMembershipAccess(user, savedOrganiserClubId || (orgGrant ? orgGrant.club_id : ''));
  if (restoredOrganiserClub && restoredOrganiserClub.id) {
    // Keep the Welcome card's in-memory choice aligned with the persisted
    // last-used Round Manager club. Otherwise an earlier first-club render can
    // remain stuck for the rest of this page load.
    window.__scsWelcomeOrganiserChoice = String(restoredOrganiserClub.id);
  }
}

function getVisibleWorkspaces() {
  // Build 961: Welcome is a single-selection launcher. Round Manager and Slot
  // Manager already provide access back to My Hub, so showing multiple hub
  // cards on Welcome is redundant. Migrate any older multi-card preference to
  // the last workspace the user actually used when possible.
  var raw = localStorage.getItem('scs_visible_workspaces');
  if (raw !== null) {
    try {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        var valid = parsed.filter(function(role) {
          return ['viewer', 'organiser', 'vault'].includes(role);
        });
        var savedMode = localStorage.getItem('kbrr_app_mode') || '';
        var selected = valid.includes(savedMode) ? savedMode : (valid[0] || '');
        var normalized = selected ? [selected] : [];
        localStorage.setItem('scs_visible_workspaces', JSON.stringify(normalized));
        return normalized;
      }
    } catch (e) {}
  }
  // Fresh installs start with Round Manager as the single Welcome hub.
  // Existing saved Welcome selections are preserved above.
  var defaults = ['organiser'];
  localStorage.setItem('scs_visible_workspaces', JSON.stringify(defaults));
  return defaults;
}

function saveVisibleWorkspaces(roles) {
  // Welcome stores at most one selected hub.
  var selected = '';
  if (Array.isArray(roles)) {
    for (var i = roles.length - 1; i >= 0; i--) {
      if (['viewer', 'organiser', 'vault'].includes(roles[i])) {
        selected = roles[i];
        break;
      }
    }
  }
  localStorage.setItem('scs_visible_workspaces', JSON.stringify(selected ? [selected] : []));
  return true;
}

// Welcome remove buttons are usage-aware. Keep the existing threshold/behaviour
// and apply it equally to My Hub, Round Manager and Slot Manager.
var WELCOME_MODE_UNUSED_MS = 60 * 60 * 1000;
var _welcomeModeUsageTimer = null;

function welcomeModeUsageKey(role) {
  return 'scs_welcome_mode_last_used_' + role;
}

function welcomeEnsureModeUsageStarted(role) {
  var key = welcomeModeUsageKey(role);
  var value = Number(localStorage.getItem(key) || 0);
  if (!value) {
    value = Date.now();
    localStorage.setItem(key, String(value));
  }
  return value;
}

function welcomeMarkModeUsed(role) {
  if (!['viewer', 'organiser', 'vault'].includes(role)) return;
  localStorage.setItem(welcomeModeUsageKey(role), String(Date.now()));
  syncWelcomeModeControls(getVisibleWorkspaces());
}

function welcomeModeCanRemove(role) {
  if (!['viewer', 'organiser', 'vault'].includes(role)) return false;
  var lastUsed = welcomeEnsureModeUsageStarted(role);
  return (Date.now() - lastUsed) >= WELCOME_MODE_UNUSED_MS;
}

function welcomeRemoveMode(role, event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  if (!['viewer', 'organiser', 'vault'].includes(role)) return;
  var roles = getVisibleWorkspaces().filter(function(item) { return item !== role; });
  saveVisibleWorkspaces(roles);
  syncExperienceModeUI();
}

function welcomeToggleAddMenu(event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  var menu = document.getElementById('welcomeAddModeMenu');
  if (!menu) return;
  menu.hidden = !menu.hidden;
}

function welcomeAddMode(role, event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  if (!['viewer', 'organiser', 'vault'].includes(role)) return;
  // Build 961: selecting a hub replaces the current Welcome card instead of
  // accumulating another card.
  localStorage.setItem(welcomeModeUsageKey(role), String(Date.now()));
  saveVisibleWorkspaces([role]);
  var menu = document.getElementById('welcomeAddModeMenu');
  if (menu) menu.hidden = true;
  syncExperienceModeUI();
  if (typeof welcomeSelectWorkspace === 'function') welcomeSelectWorkspace(role);
}

function syncWelcomeModeControls(roles) {
  var selectors = {
    viewer: '.simple-mode-my .welcome-mode-remove',
    organiser: '.simple-mode-round .welcome-mode-remove',
    vault: '.simple-mode-slot .welcome-mode-remove'
  };
  ['viewer','organiser','vault'].forEach(function(role) {
    var remove = document.querySelector(selectors[role]);
    if (roles.includes(role)) welcomeEnsureModeUsageStarted(role);
    if (remove) remove.hidden = !roles.includes(role) || !welcomeModeCanRemove(role);
  });
  if (_welcomeModeUsageTimer) clearTimeout(_welcomeModeUsageTimer);
  var nextWait = Infinity;
  ['viewer','organiser','vault'].forEach(function(role) {
    if (!roles.includes(role)) return;
    var lastUsed = Number(localStorage.getItem(welcomeModeUsageKey(role)) || Date.now());
    var remaining = WELCOME_MODE_UNUSED_MS - (Date.now() - lastUsed);
    if (remaining > 0) nextWait = Math.min(nextWait, remaining);
  });
  if (isFinite(nextWait)) {
    _welcomeModeUsageTimer = setTimeout(function() {
      syncWelcomeModeControls(getVisibleWorkspaces());
    }, Math.max(250, nextWait + 50));
  }
  var addWrap = document.getElementById('welcomeAddModeWrap');
  var switchButtons = {
    viewer: document.getElementById('welcomeAddViewer'),
    organiser: document.getElementById('welcomeAddRound'),
    vault: document.getElementById('welcomeAddSlot')
  };
  var activeRole = roles[0] || 'organiser';
  Object.keys(switchButtons).forEach(function(role) {
    var button = switchButtons[role];
    if (!button) return;
    var active = role === activeRole;
    button.hidden = false;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.tabIndex = active ? 0 : -1;
  });
  // The compact three-way slider replaces the old + menu and always stays visible.
  if (addWrap) addWrap.hidden = false;
}

function getExperienceMode() {
  // Retain the established experience styling for the selected launcher card.
  // The visible Welcome choice is now single-select.
  var role = getVisibleWorkspaces()[0] || '';
  return role === 'vault' ? 'advanced' : (role === 'organiser' ? 'intermediate' : 'standard');
}

function experienceAllowsRole(role) {
  var selected = getVisibleWorkspaces()[0] || '';
  if (!selected) return false;
  if (role === selected) return true;
  // Round Manager and Slot Manager both include the existing My Hub access.
  if (role === 'viewer' && (selected === 'organiser' || selected === 'vault')) return true;
  return false;
}

function syncExperienceModeUI() {
  var roles = getVisibleWorkspaces();
  var level = getExperienceMode();
  document.body.classList.toggle('experience-standard', level === 'standard');
  document.body.classList.toggle('experience-intermediate', level === 'intermediate');
  document.body.classList.toggle('experience-advanced', level === 'advanced');

  ['standard','intermediate','advanced'].forEach(function(name) {
    document.getElementById('experience_' + name)?.classList.toggle('active', name === level);
  });

  var welcomeIds = { viewer: 'experienceModeViewer', organiser: 'experienceModeOrganiser', vault: 'experienceModeVault' };
  Object.keys(welcomeIds).forEach(function(role) {
    var el = document.getElementById(welcomeIds[role]);
    if (el) el.style.display = roles.includes(role) ? '' : 'none';
  });
  var simpleMap = { viewer: '.simple-mode-my', organiser: '.simple-mode-round', vault: '.simple-mode-slot' };
  // Welcome is a true single-card launcher. Use the semantic hidden state as
  // the source of truth (plus inline display for older CSS) so no later theme
  // or layout rule can accidentally bring inactive cards back into flow.
  var activeWelcomeRole = roles[0] || 'organiser';
  Object.keys(simpleMap).forEach(function(role) {
    document.querySelectorAll(simpleMap[role]).forEach(function(el) {
      var isActive = role === activeWelcomeRole;
      el.hidden = !isActive;
      el.setAttribute('aria-hidden', isActive ? 'false' : 'true');
      el.style.display = isActive ? '' : 'none';
    });
  });
  syncWelcomeModeControls(roles);
  document.querySelectorAll('.welcome-carousel-dot').forEach(function(dot, index) {
    var role = ['viewer', 'organiser', 'vault'][index];
    dot.style.display = roles.includes(role) ? '' : 'none';
  });

  var section = document.getElementById('experienceOrganiserSection');
  if (section) section.style.display = roles.includes('organiser') ? '' : 'none';
  var caption = document.getElementById('mlExperienceCaption');
  if (caption) caption.textContent = roles.length === 0 ? '' : (roles.length === 3 ? t('allClubWorkspaces') : (roles.length === 2 ? 'Selected workspaces' : ''));
  var description = document.getElementById('experienceModeDescription');
  if (description) description.textContent = roles.length === 0 ? 'Add a mode to Welcome' : 'Selected Welcome modes';

  var preferred = (typeof welcomeSelectedWorkspace !== 'undefined' && welcomeSelectedWorkspace) || appMode || 'viewer';
  var next = roles.includes(preferred) ? preferred : (roles[0] || '');
  if (next && typeof welcomeSelectWorkspace === 'function') welcomeSelectWorkspace(next);
}

function setExperienceMode(level) {
  // Build 961: Workspace setting is also single-select. Keep the historical
  // level IDs so existing settings markup/callers remain compatible.
  var role = level === 'advanced' ? 'vault' : (level === 'intermediate' ? 'organiser' : 'viewer');
  saveVisibleWorkspaces([role]);
  localStorage.setItem('scs_experience_mode', level);
  syncExperienceModeUI();

  if (appMode && !experienceAllowsRole(appMode)) {
    appMode = role;
    sessionStorage.setItem('appMode', role);
    localStorage.setItem('kbrr_app_mode', role);
    applyMode(role);
    updateModePill(role);
  }
  if (typeof showToast === 'function') showToast('Welcome hub updated');
}

function updateWelcomeWorkspaceClubNames() {
  var organiserVerified = hasVerifiedWorkspaceRole('organiser');
  var vaultVerified = hasVerifiedWorkspaceRole('vault');
  var accountUser = (typeof authGetUser === 'function') ? authGetUser() : null;
  var player = (typeof getMyPlayer === 'function') ? getMyPlayer() : null;
  var playerName = (accountUser && (accountUser.nickname || accountUser.displayName)) ||
    (player && (player.displayName || player.name || player.nickname)) || '';
  var names = {
    organiser: organiserVerified
      ? (localStorage.getItem('kbrr_org_club_name') || '')
      : '',
    vault: vaultVerified
      ? (localStorage.getItem('kbrr_vault_club_name') || '')
      : ''
  };
  var playerEl = document.getElementById('welcomePlayerName');
  if (playerEl) {
    playerEl.textContent = playerName;
    playerEl.hidden = !playerName;
    playerEl.classList.remove('is-login-prompt');
  }
  var simplePlayerEl = document.getElementById('simpleMyNickname');
  if (simplePlayerEl) {
    simplePlayerEl.textContent = playerName || 'Player';
    simplePlayerEl.hidden = false;
  }
  var loginLabel = (typeof t === 'function' && t('login')) || 'Login';
  [
    ['welcomeOrganiserClubName', names.organiser, organiserVerified],
    ['welcomeVaultClubName', names.vault, vaultVerified]
  ].forEach(function(item) {
    var el = document.getElementById(item[0]);
    if (!el) return;
    var text = item[2] ? item[1] : loginLabel;
    el.textContent = text;
    el.hidden = !text;
    el.classList.toggle('is-login-prompt', !item[2]);
  });
  var simpleSlotClub = document.getElementById('simpleSlotClubName');
  if (simpleSlotClub) {
    simpleSlotClub.textContent = vaultVerified ? (names.vault || 'Club') : loginLabel;
    simpleSlotClub.classList.toggle('is-login-prompt', !vaultVerified);
  }
  var playerLogout = document.getElementById('welcomePlayerLogout');
  var organiserLogout = document.getElementById('welcomeOrganiserLogout');
  var vaultLogout = document.getElementById('welcomeVaultLogout');
  var simplePlayerLogout = document.getElementById('simplePlayerLogout');
  var simpleVaultLogout = document.getElementById('simpleVaultLogout');
  if (playerLogout) playerLogout.hidden = !playerName;
  if (organiserLogout) organiserLogout.hidden = !organiserVerified;
  if (vaultLogout) vaultLogout.hidden = !vaultVerified;
  if (simplePlayerLogout) simplePlayerLogout.hidden = !playerName;
  if (simpleVaultLogout) simpleVaultLogout.hidden = !vaultVerified;
}

async function welcomeManualRefresh() {
  var btn = document.querySelector('.welcome-refresh-btn');
  if (btn && btn.disabled) return;
  if (btn) { btn.disabled = true; btn.classList.add('is-refreshing'); }
  try {
    if (typeof restoreUserClubRoles === 'function' && typeof authGetUser === 'function') {
      await restoreUserClubRoles(authGetUser());
    }
    if (typeof syncToLocal === 'function') await syncToLocal();
    if (typeof window.scsPrefetchWelcomeHubData === 'function') {
      await window.scsPrefetchWelcomeHubData();
    }
    updateWelcomeWorkspaceClubNames();
    if (typeof mlSyncLangDisplay === 'function') mlSyncLangDisplay();
    if (typeof showToast === 'function') showToast('Welcome refreshed');
  } catch (e) {
    if (typeof showToast === 'function') showToast(e.message || 'Refresh failed');
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('is-refreshing'); }
  }
}

function welcomeLogoutWorkspace(role) {
  if (role === 'viewer') {
    // Player logout is the full application logout. Reuse the existing
    // authenticated app logout flow so the user returns to the Login screen.
    if (typeof authDoLogout === 'function') {
      authDoLogout();
      return;
    }
    if (typeof authLogout === 'function') authLogout();
    localStorage.removeItem('auth_user');
    localStorage.removeItem('kbrr_my_player');
    welcomeSelectedWorkspace = 'viewer';
    if (typeof authShowScreen === 'function') authShowScreen('login');
    return;
  }
  if (role === 'organiser' && typeof organiserLogoutClub === 'function') organiserLogoutClub();
  if (role === 'vault' && typeof vaultLogoutClub === 'function') vaultLogoutClub();
  setTimeout(updateWelcomeWorkspaceClubNames, 0);
}

function welcomeSelectWorkspace(mode) {
  if (!['viewer', 'organiser', 'vault'].includes(mode)) return;
  if (mode === 'vault' && typeof isDemoMode === 'function' && isDemoMode()) {
    if (typeof showDemoVaultBlock === 'function') showDemoVaultBlock();
    return;
  }
  welcomeSelectedWorkspace = mode;
  var carousel = document.getElementById('welcomeWorkspaceCarousel');
  if (carousel) carousel.setAttribute('data-selected', mode);

  // Build 388: each workspace keeps its permanent location.
  // Selection changes only the tile emphasis; it no longer rotates the
  // chosen workspace into the centre position.
  var visibleOrder = ['viewer', 'organiser', 'vault'];
  ['viewer', 'organiser', 'vault'].forEach(function(name) {
    var el = document.getElementById('experienceMode' + (name === 'viewer' ? 'Viewer' : name === 'organiser' ? 'Organiser' : 'Vault'));
    if (!el) return;
    var selected = name === mode;
    var position = visibleOrder.indexOf(name);
    el.classList.toggle('active', selected);
    // Do not assign carousel position classes. The old carousel-centre class
    // makes the Organiser tile project forward even when Player is selected.
    el.classList.remove('carousel-left', 'carousel-centre', 'carousel-right');
    el.style.order = String(position + 1);
    el.setAttribute('aria-checked', selected ? 'true' : 'false');
    el.setAttribute('tabindex', selected ? '0' : '-1');
  });
  document.querySelectorAll('.welcome-carousel-dot').forEach(function(dot, index) {
    var dotMode = ['viewer', 'organiser', 'vault'][index];
    var selected = dotMode === mode;
    dot.classList.toggle('active', selected);
    dot.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
  var caption = document.getElementById('mlExperienceCaption');
  if (caption) caption.textContent = mode === 'viewer'
    ? 'Player workspace'
    : (mode === 'organiser' ? 'Session Organiser workspace' : 'Club Manager workspace');
  var nextAction1 = document.getElementById('welcomeNextAction1');
  var nextAction2 = document.getElementById('welcomeNextAction2');
  var nextActionKeys = mode === 'organiser'
    ? ['organiserCardAction1', 'organiserCardAction2']
    : (mode === 'vault'
      ? ['managerCardAction1', 'managerCardAction2']
      : ['playerCardAction1', 'playerCardAction2']);
  if (nextAction1) {
    nextAction1.setAttribute('data-i18n', nextActionKeys[0]);
    nextAction1.textContent = typeof t === 'function' ? t(nextActionKeys[0]) : nextAction1.textContent;
  }
  if (nextAction2) {
    nextAction2.setAttribute('data-i18n', nextActionKeys[1]);
    nextAction2.textContent = typeof t === 'function' ? t(nextActionKeys[1]) : nextAction2.textContent;
  }
  updateWelcomeWorkspaceClubNames();
  updateWelcomeHubCard(mode);
}

function updateWelcomeHubHelper(mode) {
  var helper = document.getElementById('welcomeNextAction1');
  if (!helper) return;
  helper.removeAttribute('data-i18n');
  helper.textContent = mode === 'viewer'
    ? 'Find and join slots, play and improve.'
    : (mode === 'organiser'
      ? 'Create, manage and run your next session efficiently.'
      : 'Manage clubs, members, organisers and activities.');
}

function updateWelcomeHubCard(mode) {
  var heading = document.getElementById('welcomeHubHeading');
  var continueLabel = document.getElementById('welcomeContinueLabel');
  if (heading) heading.textContent = 'Choose your hub';
  if (continueLabel) continueLabel.textContent = mode === 'viewer' ? 'Enter My Hub' : (mode === 'organiser' ? 'Enter Session Hub' : 'Enter Club Hub');
  updateWelcomeHubHelper(mode);
  if (mode !== 'viewer') return;

  var player = (typeof getMyPlayer === 'function') ? getMyPlayer() : null;
  var account = (typeof authGetUser === 'function') ? authGetUser() : null;
  var name = (account && (account.nickname || account.displayName)) || (player && player.name) || 'Player';
  var photo = document.getElementById('welcomePlayerPhoto');
  var nameEl = document.getElementById('welcomePlayerName');
  var ratingEl = document.getElementById('welcomePlayerRating');
  var pointsEl = document.getElementById('welcomePlayerPoints');
  if (photo) {
    var savedPhoto = welcomeGetSavedRolePhoto('viewer');
    photo.src = savedPhoto || (player && player.gender === 'Female' ? 'female.png' : 'male.png');
  }
  if (nameEl) nameEl.textContent = name;
  var simpleNameEl = document.getElementById('simpleMyNickname');
  if (simpleNameEl) simpleNameEl.textContent = name;
  var rating = Number(player && (player.global_rating ?? player.rating));
  var points = Number(player && (player.global_points ?? player.points));
  if (ratingEl) ratingEl.textContent = Number.isFinite(rating) && rating > 0 ? rating.toFixed(1) : '1.0';
  if (pointsEl) pointsEl.textContent = Number.isFinite(points) ? points.toFixed(1) : '0.0';
}

/* Build 456: the Round hub has one actionable upcoming-slot tile. It opens
   Organiser normally, then brings the existing time-gated Start Session card
   into view. The existing slot flow remains the authority for starting. */
async function welcomeOpenOrganiserUpcomingSlot(event) {
  if (event) {
    if (typeof event.preventDefault === 'function') event.preventDefault();
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
  }
  var organiser = (window.__scsWelcomeHubData && window.__scsWelcomeHubData.organiser) || {};
  var slot = organiser.nextSlot || null;
  var tile = document.getElementById('welcomeOrganiserNextSlot');
  if (!slot || !slot.id || (tile && tile.getAttribute('aria-disabled') === 'true')) return;
  if (tile && tile.classList.contains('is-opening')) return;

  if (typeof authIsLoggedIn === 'function' && !authIsLoggedIn()) {
    sessionStorage.setItem('scs_pending_workspace', 'organiser');
    if (typeof authShowScreen === 'function') authShowScreen('login');
    return;
  }
  if (typeof canAccessMode === 'function' && !canAccessMode('organiser')) {
    if (typeof showModeUpgradePrompt === 'function') showModeUpgradePrompt('organiser');
    return;
  }

  if (tile) tile.classList.add('is-opening');
  try {
    var club = await syncOrganiserMembershipAccess(null, organiser.clubId || '');
    if (!club || !club.id) return;
    if (typeof setMyClub === 'function') setMyClub(club.id, club.name || organiser.clubName || '');
    localStorage.setItem('kbrr_club_mode', club.source === 'vault' ? 'admin' : 'user');
    appMode = 'organiser';
    sessionStorage.setItem('appMode', 'organiser');
    localStorage.setItem('kbrr_app_mode', 'organiser');
    applyMode('organiser');
    updateModePill('organiser');
    var overlay = document.getElementById('modeSelectOverlay');
    if (overlay) overlay.style.display = 'none';
    if (typeof homeHideScreen === 'function') homeHideScreen();
    if (typeof vaultSlotsStartRoundsFromSlot === 'function') {
      await vaultSlotsStartRoundsFromSlot(slot.id);
    }
    var roundsPage = document.getElementById('roundsPage');
    var roundOpened = roundsPage && roundsPage.style.display !== 'none';
    var rollingOpened = typeof schedulerState !== 'undefined' && schedulerState.mbmActive;
    if (!roundOpened && !rollingOpened && overlay) overlay.style.display = 'flex';
  } finally {
    if (tile) tile.classList.remove('is-opening');
  }
}


/* Build 422: My Hub profile photo — camera, photo library, remove, local persistence. */
function welcomeProfilePhotoStorageKey() {
  var account = (typeof authGetUser === 'function') ? authGetUser() : null;
  var player = (typeof getMyPlayer === 'function') ? getMyPlayer() : null;
  var identity = (account && (account.id || account.user_id || account.email || account.nickname)) ||
                 (player && (player.id || player.user_id || player.email || player.name)) || 'default';
  return 'scs_welcome_profile_photo_' + String(identity).toLowerCase().replace(/[^a-z0-9_.@-]/g, '_');
}

function welcomeGetSavedProfilePhoto() {
  try { return localStorage.getItem(welcomeProfilePhotoStorageKey()) || ''; }
  catch (e) { return ''; }
}

function welcomeOpenPhotoMenu() {
  var sheet = document.getElementById('welcomePhotoSheet');
  if (!sheet) return;
  sheet.hidden = false;
  requestAnimationFrame(function(){ sheet.classList.add('open'); });
  document.body.classList.add('welcome-photo-menu-open');
}

function welcomeClosePhotoMenu() {
  var sheet = document.getElementById('welcomePhotoSheet');
  if (!sheet) return;
  sheet.classList.remove('open');
  document.body.classList.remove('welcome-photo-menu-open');
  setTimeout(function(){ if (!sheet.classList.contains('open')) sheet.hidden = true; }, 180);
}

function welcomeChooseProfilePhoto(source) {
  var input = document.getElementById(source === 'camera' ? 'welcomeProfileCameraInput' : 'welcomeProfileLibraryInput');
  welcomeClosePhotoMenu();
  if (!input) return;
  input.value = '';
  setTimeout(function(){ input.click(); }, 80);
}

function welcomeHandleProfilePhoto(input) {
  var file = input && input.files && input.files[0];
  if (!file) return;
  if (!file.type || file.type.indexOf('image/') !== 0) {
    alert('Please select an image.');
    return;
  }
  var reader = new FileReader();
  reader.onerror = function(){ alert('Unable to read this photo. Please try another image.'); };
  reader.onload = function(event) {
    var image = new Image();
    image.onerror = function(){ alert('Unable to open this photo. Please try another image.'); };
    image.onload = function() {
      try {
        var side = Math.min(image.naturalWidth || image.width, image.naturalHeight || image.height);
        var sx = Math.max(0, ((image.naturalWidth || image.width) - side) / 2);
        var sy = Math.max(0, ((image.naturalHeight || image.height) - side) / 2);
        var canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(image, sx, sy, side, side, 0, 0, 512, 512);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        localStorage.setItem(welcomeProfilePhotoStorageKey(), dataUrl);
        var photo = document.getElementById('welcomePlayerPhoto');
        if (photo) photo.src = dataUrl;
      } catch (e) {
        alert('The photo could not be saved. Please try a smaller image.');
      }
    };
    image.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

function welcomeRemoveProfilePhoto() {
  try { localStorage.removeItem(welcomeProfilePhotoStorageKey()); } catch (e) {}
  var player = (typeof getMyPlayer === 'function') ? getMyPlayer() : null;
  var photo = document.getElementById('welcomePlayerPhoto');
  if (photo) photo.src = player && player.gender === 'Female' ? 'female.png' : 'male.png';
  welcomeClosePhotoMenu();
}


var welcomeTileSliding = false;

/* Build 470 — stable whole-card slide.
   The existing Build 470 bordered card is never cloned, rebuilt or resized.
   It leaves the viewport as one object, the selected live workspace changes
   while the card is fully off-screen, and that same card enters from the
   opposite side. Only translate3d is animated. */
function welcomeCycleWorkspace(direction) {
  if (welcomeTileSliding) return;
  var modes = (typeof getVisibleWorkspaces === 'function' ? getVisibleWorkspaces() : ['viewer', 'organiser', 'vault']);
  if (!modes.length) return;
  var current = modes.indexOf(welcomeSelectedWorkspace);
  if (current < 0) current = 0;
  var step = direction < 0 ? -1 : 1;
  var nextMode = modes[(current + step + modes.length) % modes.length];
  var frame = document.querySelector('#modeSelectOverlay .welcome-card-frame');

  if (!frame || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    welcomeSelectWorkspace(nextMode);
    return;
  }

  welcomeTileSliding = true;
  var travel = Math.ceil(window.innerWidth + frame.getBoundingClientRect().width);
  var exitX = step > 0 ? -travel : travel;
  var enterX = -exitX;
  var duration = 130;
  var easing = 'cubic-bezier(.2,.78,.25,1)';

  frame.style.willChange = 'transform';
  frame.style.transition = 'transform ' + duration + 'ms ' + easing;
  frame.style.transform = 'translate3d(' + exitX + 'px,0,0)';

  window.setTimeout(function() {
    // The card is fully outside the viewport here. Update the live content,
    // then place the same unchanged card beyond the opposite edge.
    welcomeSelectWorkspace(nextMode);
    frame.style.transition = 'none';
    frame.style.transform = 'translate3d(' + enterX + 'px,0,0)';
    void frame.offsetWidth;

    requestAnimationFrame(function() {
      frame.style.transition = 'transform ' + duration + 'ms ' + easing;
      frame.style.transform = 'translate3d(0,0,0)';
    });

    window.setTimeout(function() {
      frame.style.transition = '';
      frame.style.transform = '';
      frame.style.willChange = '';
      welcomeTileSliding = false;
    }, duration + 18);
  }, duration + 8);
}

(function enableWelcomeWorkspaceSwipe() {
  var startX = null;
  var startY = null;
  document.addEventListener('touchstart', function(event) {
    var frame = event.target && event.target.closest ? event.target.closest('.welcome-card-frame') : null;
    if (!frame || !event.touches || event.touches.length !== 1) return;
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchend', function(event) {
    if (startX === null || !event.changedTouches || !event.changedTouches.length) return;
    var dx = event.changedTouches[0].clientX - startX;
    var dy = event.changedTouches[0].clientY - startY;
    startX = null;
    startY = null;
    if (Math.abs(dx) < 45 || Math.abs(dx) <= Math.abs(dy)) return;
    welcomeCycleWorkspace(dx < 0 ? 1 : -1);
  }, { passive: true });
})();

// Build 610: My Hub-only Welcome shortcuts reuse the existing Player Hub destinations.
// Enter the viewer workspace first, then open the exact same page used by the existing My Hub action bar.
function welcomeOpenViewerShortcut(pageID, tabBtnID) {
  if (window.scsNotificationsMarkWelcomeViewed) window.scsNotificationsMarkWelcomeViewed();
  welcomeSelectedWorkspace = 'viewer';
  switchMode('viewer');
  window.setTimeout(function() {
    if (typeof homeGo === 'function') homeGo(pageID, tabBtnID || null);
  }, 30);
}

function welcomeOpenViewerSlots() {
  if (window.scsNotificationsMarkWelcomeViewed) window.scsNotificationsMarkWelcomeViewed();
  welcomeSelectedWorkspace = 'viewer';
  switchMode('viewer');
  window.setTimeout(function() {
    if (typeof homeOpenViewerSlots === 'function') homeOpenViewerSlots();
  }, 30);
}

function welcomeOpenVaultSlot(slotId) {
  slotId = String(slotId || '').trim();
  if (!slotId) return;
  welcomeSelectedWorkspace = 'vault';
  switchMode('vault');
  window.setTimeout(async function() {
    // Open the Slot Manager calendar first, then its management sheet. This
    // deliberately avoids the similarly styled My Hub quick-slot viewer.
    if (typeof appMode !== 'undefined' && appMode !== 'vault') return;
    if (typeof homeGo === 'function') homeGo('vaultSlotsPage', null);
    if (typeof vaultSlotsOpenPage === 'function') await vaultSlotsOpenPage();
    if (typeof vaultSlotsViewSlot === 'function') await vaultSlotsViewSlot(slotId);
  }, 120);
}

function welcomeApprovalEscape(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch) {
    return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch];
  });
}

async function welcomeOpenVaultApprovals() {
  var existing = document.getElementById('welcomeSlotApprovalsOverlay');
  if (existing) existing.remove();
  var overlay = document.createElement('div');
  overlay.id = 'welcomeSlotApprovalsOverlay';
  overlay.className = 'welcome-slot-approvals-overlay';
  overlay.innerHTML = '<section class="welcome-slot-approvals-panel" role="dialog" aria-modal="true" aria-labelledby="welcomeApprovalsTitle">' +
    '<header><span><small>SLOT MANAGER</small><strong id="welcomeApprovalsTitle">Pending approvals</strong></span><button type="button" data-close aria-label="Close">×</button></header>' +
    '<div class="welcome-slot-approvals-list"><div class="welcome-slot-approvals-loading">Loading requests…</div></div>' +
    '</section>';
  document.body.appendChild(overlay);
  overlay.querySelector('[data-close]').onclick = function(){ overlay.remove(); };
  overlay.onclick = function(event){ if (event.target === overlay) overlay.remove(); };

  var vault = (window.__scsWelcomeHubData && window.__scsWelcomeHubData.vault) || {};
  var slotIds = Array.isArray(vault.pendingSlotIds) ? vault.pendingSlotIds : (vault.pendingSlotId ? [vault.pendingSlotId] : []);
  var slots = [];
  for (var i = 0; i < slotIds.length; i++) {
    if (typeof vaultSlotsLoadOne !== 'function') break;
    var loaded = await vaultSlotsLoadOne(slotIds[i]).catch(function(){ return null; });
    if (loaded) slots.push(loaded);
  }
  if (!document.body.contains(overlay)) return;
  var requests = [];
  slots.forEach(function(slot) {
    (slot.claims || []).forEach(function(claim) {
      if (String(claim && claim.status || '').toLowerCase() === 'pending') requests.push({ slot:slot, claim:claim });
    });
  });
  var linkedRequestIds = new Set(requests.map(function(item) {
    var request = item.claim && item.claim.player && item.claim.player.clubJoinRequest;
    return request && request.id ? String(request.id) : '';
  }).filter(Boolean));
  var clubRequests = Array.isArray(vault.pendingClubRequests) ? vault.pendingClubRequests.filter(function(request) {
    return request && request.id && !linkedRequestIds.has(String(request.id));
  }) : [];
  var list = overlay.querySelector('.welcome-slot-approvals-list');
  if (!requests.length && !clubRequests.length) {
    list.innerHTML = '<div class="welcome-slot-approvals-empty">No pending approvals.</div>';
    return;
  }
  var slotRequestHtml = requests.map(function(item) {
    var claim = item.claim, slot = item.slot;
    var name = (claim.player && claim.player.name) || 'Player';
    var combined = !!(claim.player && claim.player.clubJoinRequest);
    var label = combined ? 'Approve Club & Slot' : 'Approve Slot';
    return '<article class="welcome-slot-approval-row" data-claim-id="' + welcomeApprovalEscape(claim.id) + '">' +
      '<div class="welcome-slot-approval-copy"><strong>' + welcomeApprovalEscape(name) + '</strong><span>' +
        welcomeApprovalEscape(String(slot.slot_date || '') + ' · ' + String(slot.start_time || '').slice(0,5) + (slot.venue ? ' · ' + slot.venue : '')) + '</span></div>' +
      '<div class="welcome-slot-approval-actions"><button type="button" class="approve" data-approve="1" data-claim="' + welcomeApprovalEscape(claim.id) + '" data-slot="' + welcomeApprovalEscape(slot.id) + '">' + label + '</button>' +
      '<button type="button" class="reject" data-approve="0" data-claim="' + welcomeApprovalEscape(claim.id) + '" data-slot="' + welcomeApprovalEscape(slot.id) + '">Reject</button></div>' +
    '</article>';
  }).join('');
  var clubRequestHtml = clubRequests.map(function(request) {
    return '<article class="welcome-slot-approval-row" data-club-request-id="' + welcomeApprovalEscape(request.id) + '">' +
      '<div class="welcome-slot-approval-copy"><strong>' + welcomeApprovalEscape(request.nickname || 'Player') + '</strong>' +
      '<span>Club membership request · Rating ' + welcomeApprovalEscape(Number(request.requested_rating || 1).toFixed(1)) + '</span></div>' +
      '<div class="welcome-slot-approval-actions"><button type="button" class="approve" data-club-action="approve" data-request="' + welcomeApprovalEscape(request.id) + '" data-user="' + welcomeApprovalEscape(request.user_account_id) + '" data-nickname="' + welcomeApprovalEscape(request.nickname || 'Player') + '" data-rating="' + welcomeApprovalEscape(request.requested_rating || 1) + '">Approve Club</button>' +
      '<button type="button" class="reject" data-club-action="reject" data-request="' + welcomeApprovalEscape(request.id) + '">Reject</button></div>' +
    '</article>';
  }).join('');
  list.innerHTML = slotRequestHtml + clubRequestHtml;
  list.querySelectorAll('[data-claim]').forEach(function(button) {
    button.onclick = async function() {
      if (button.disabled || typeof vaultSlotsReviewClaim !== 'function') return;
      var buttons = button.closest('.welcome-slot-approval-actions').querySelectorAll('button');
      buttons.forEach(function(btn){ btn.disabled = true; });
      await vaultSlotsReviewClaim(button.dataset.claim, button.dataset.slot, button.dataset.approve === '1', true);
      var row = button.closest('.welcome-slot-approval-row');
      if (row) row.remove();
      if (!list.querySelector('.welcome-slot-approval-row')) list.innerHTML = '<div class="welcome-slot-approvals-empty">No pending approvals.</div>';
      if (typeof scsPrefetchWelcomeHubData === 'function') scsPrefetchWelcomeHubData(true).catch(function(){});
    };
  });
  list.querySelectorAll('[data-club-action]').forEach(function(button) {
    button.onclick = async function() {
      if (button.disabled) return;
      var row = button.closest('.welcome-slot-approval-row');
      var buttons = row.querySelectorAll('button');
      buttons.forEach(function(btn){ btn.disabled = true; });
      var result;
      if (button.dataset.clubAction === 'approve') {
        result = await authAcceptRequest(button.dataset.request, vault.clubId, button.dataset.user, button.dataset.nickname, null, Number(button.dataset.rating || 1));
      } else {
        result = await authRejectRequest(button.dataset.request);
      }
      if (result && result.error) {
        buttons.forEach(function(btn){ btn.disabled = false; });
        if (typeof showToast === 'function') showToast(result.error);
        return;
      }
      if (row) row.remove();
      if (!list.querySelector('.welcome-slot-approval-row')) list.innerHTML = '<div class="welcome-slot-approvals-empty">No pending approvals.</div>';
      if (typeof syncToLocal === 'function' && button.dataset.clubAction === 'approve') syncToLocal().catch(function(){});
      if (typeof scsPrefetchWelcomeHubData === 'function') scsPrefetchWelcomeHubData(true).catch(function(){});
    };
  });
}

async function welcomeContinueWorkspace() {
  var targetMode = welcomeSelectedWorkspace || 'viewer';

  // Player can be opened without an account. Organiser and Club Manager are
  // protected workspaces and must always show the account login first when the
  // user is not signed in.
  if (targetMode !== 'viewer' &&
      typeof authIsLoggedIn === 'function' &&
      !authIsLoggedIn()) {
    sessionStorage.setItem('scs_pending_workspace', targetMode);
    if (typeof authShowScreen === 'function') authShowScreen('login');
    return;
  }

  // Authentication is verified during app startup and then monitored by the
  // session watcher. Do not block a hub-card click on another network read:
  // when that request is slow or an older active_sessions row is unavailable,
  // both protected cards otherwise look completely unresponsive.
  if (targetMode !== 'viewer' && typeof _startSessionWatch === 'function') {
    _startSessionWatch();
  }
  switchMode(targetMode);
}

function selectMode(mode) {
  appMode = mode;
  sessionStorage.setItem('appMode', mode);
  localStorage.setItem('kbrr_app_mode', mode);
  // My Hub is the app home. Keep the legacy mode selector in the DOM only
  // for compatibility, but never render it over the Home screen.
  var overlay = document.getElementById('modeSelectOverlay');
  if (overlay) {
    overlay.classList.remove('scs-launch-first-paint');
    overlay.style.display = 'none';
  }
  // Apply viewer/organiser body classes
  applyMode(mode);
  // Show home screen (defined in HomeScreen.js)
  showHomeScreen();
}

function applyMode(mode) {
  appMode = mode;
  if (mode === 'organiser' || mode === 'vault') welcomeMarkModeUsed(mode);

  // Body class for organiser scrollable tabs (kept for any CSS that uses it)
  document.body.classList.toggle('organiser-tabs', mode === 'organiser');
  // Keep the Round Manager workspace identity explicit. Several shell/safe-area
  // rules are intentionally scoped to organiser-mode; without this class the
  // iOS top area can inherit the Round iMode blue surface.
  document.body.classList.toggle('organiser-mode', mode === 'organiser');
  document.body.classList.toggle('vault-mode',     mode === 'vault');
  document.querySelectorAll('.workspace-role-logout').forEach(function(button) {
    button.style.display = mode === 'viewer' ? 'none' : '';
  });

  // Sync home mode pill buttons (3 modes)
  var hpv  = document.getElementById('homePillViewer');
  var hpo  = document.getElementById('homePillOrganiser');
  var hpvm = document.getElementById('homePillVault');
  if (hpv)  hpv.classList.toggle('active',  mode === 'viewer');
  if (hpo)  hpo.classList.toggle('active',  mode === 'organiser');
  if (hpvm) hpvm.classList.toggle('active', mode === 'vault');

  // Apply viewer restrictions
  if (mode === 'viewer') {
    setViewerMode(true);
  } else {
    if (window._vSessionTabPinned) {
      if (typeof viewerStopPoll === 'function') viewerStopPoll();
      if (typeof _vHidePage     === 'function') _vHidePage();
    }
    setViewerMode(false);
  }
}

function setViewerMode(isViewer) {
  // Use body class -- all viewer restrictions handled via CSS + JS checks
  if (isViewer) {
    document.body.classList.add('viewer-mode');
    // Ensure we're on the club tab by default
    // settings no longer has tabs
  } else {
    document.body.classList.remove('viewer-mode');
  }

  // Lock/Unlock toggle button
  const lockBtn = document.getElementById('lockToggleBtn');
  if (lockBtn) {
    lockBtn.style.pointerEvents = isViewer ? 'none' : '';
    lockBtn.style.opacity       = isViewer ? '0.35' : '';
  }

  // New round / control buttons in rounds page
  ['#addRoundBtn', '#removeRoundBtn', '#minRoundsPlus', '#minRoundsMinus'].forEach(sel => {
    const el = document.querySelector(sel);
    if (el) { el.style.pointerEvents = isViewer ? 'none' : ''; el.style.opacity = isViewer ? '0.35' : ''; }
  });

  // Import/Add buttons -- hide entirely in viewer
  ['#openImportBtn', '.open-import-btn', '#addPlayersTypeBtn', '#addPlayersBrowseBtn'].forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      el.style.display = isViewer ? 'none' : '';
    });
  });
}

function closeModeSheet() {
  var o = document.getElementById('modeSelectOverlay');
  if (o) {
    o.classList.remove('scs-launch-first-paint');
    o.style.display = 'none';
  }
}

function _refreshWelcomeSubtitle() {
  var el = document.getElementById('welcomeTopbarSub');
  if (!el) return;
  var user = (typeof authGetUser === 'function') ? authGetUser() : null;
  el.textContent = (user && (user.nickname || user.email)) ? (user.nickname || user.email) : 'Choose Mode';
}

function openModeSwitcher() {
  // Build 1044: the former mode selector is retained in the DOM for compatibility,
  // but My Hub is now the application home. Any legacy "back to modes" action
  // returns to My Hub instead of exposing the old Welcome screen.
  if (typeof authIsLoggedIn === 'function' && !authIsLoggedIn()) {
    if (typeof authShowScreen === 'function') authShowScreen('welcome');
    return;
  }
  welcomeSelectedWorkspace = 'viewer';
  switchMode('viewer');
}

var _organiserWorkspaceOpening = false;

function organiserAccessEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showOrganiserAccessMenu(clubs, options) {
  options = options || {};
  var directSelect = options.directSelect === true;
  return new Promise(function(resolve) {
    var existing = document.getElementById('organiserAccessOverlay');
    if (existing) existing.remove();
    var user = (typeof authGetUser === 'function') ? authGetUser() : null;
    var playerName = user && (user.nickname || user.displayName || user.email)
      ? (user.nickname || user.displayName || user.email)
      : ((typeof t === 'function' && t('playerRole')) || 'Player');
    var activeClub = (typeof getMyClub === 'function') ? getMyClub() : null;
    var cachedId = localStorage.getItem('kbrr_org_club_id') || '';
    var selectedId = clubs.some(function(club) { return String(club.id) === String(cachedId); })
      ? String(cachedId)
      : (clubs.some(function(club) { return String(club.id) === String((activeClub && activeClub.id) || ''); })
        ? String(activeClub.id)
        : String(clubs[0].id));
    var overlay = document.createElement('div');
    overlay.id = 'organiserAccessOverlay';
    overlay.className = 'organiser-access-overlay';
    overlay.innerHTML = `
      <section class="organiser-access-sheet" role="dialog" aria-modal="true" aria-labelledby="organiserAccessTitle">
        <button class="organiser-access-close" type="button" aria-label="Close">×</button>
        ${directSelect ? '' : `<div class="organiser-access-icon" aria-hidden="true">▦</div>
        <h2 id="organiserAccessTitle">${organiserAccessEscape((typeof t === 'function' && t('continueAsOrganiser')) || 'Continue as Organiser')}</h2>
        <p class="organiser-access-account">${organiserAccessEscape((typeof t === 'function' && t('signedInAs')) || 'Signed in as')} <strong>${organiserAccessEscape(playerName)}</strong></p>`}
        <div class="organiser-access-label">${organiserAccessEscape((typeof t === 'function' && t('selectClubTitle')) || 'Select Club')}</div>
        <div class="organiser-access-clubs">
          ${clubs.map(function(club) {
            var selected = String(club.id) === String(selectedId);
            var accessLabel = club.source === 'vault'
              ? ((typeof t === 'function' && t('clubManagerRole')) || 'Club Manager')
              : ((typeof t === 'function' && t('clubMember')) || 'Club member');
            return `<button class="organiser-access-club${selected ? ' selected' : ''}" type="button" data-club-id="${organiserAccessEscape(club.id)}">
              <span class="organiser-access-club-mark" aria-hidden="true">🏸</span>
              <span class="organiser-access-club-copy"><strong>${organiserAccessEscape(club.name || club.id)}</strong><small>${organiserAccessEscape(accessLabel)}</small></span>
              <span class="organiser-access-radio" aria-hidden="true"></span>
            </button>`;
          }).join('')}
        </div>
        ${directSelect ? '' : `<div class="organiser-access-actions">
          <button class="organiser-access-continue" type="button">${organiserAccessEscape((typeof t === 'function' && t('continueBtn')) || 'Continue')} <span aria-hidden="true">→</span></button>
        </div>`}
      </section>`;
    document.body.appendChild(overlay);

    var finished = false;
    function finish(result) {
      if (finished) return;
      finished = true;
      overlay.remove();
      resolve(result);
    }
    overlay.querySelectorAll('.organiser-access-club').forEach(function(button) {
      button.addEventListener('click', function() {
        selectedId = button.getAttribute('data-club-id') || selectedId;
        if (directSelect) {
          var selectedClub = clubs.find(function(club) { return String(club.id) === String(selectedId); }) || clubs[0];
          finish(selectedClub);
          return;
        }
        overlay.querySelectorAll('.organiser-access-club').forEach(function(item) {
          item.classList.toggle('selected', item === button);
        });
      });
    });
    overlay.querySelector('.organiser-access-close').addEventListener('click', function() { finish(null); });
    var continueButton = overlay.querySelector('.organiser-access-continue');
    if (continueButton) {
      continueButton.addEventListener('click', function() {
        finish(clubs.find(function(club) { return club.id === selectedId; }) || clubs[0]);
      });
    }
    overlay.addEventListener('click', function(event) { if (event.target === overlay) finish(null); });
  });
}

async function scsOpenPlayersManagerWhenRoundManagerEmpty(clubId) {
  try {
    // If the user just closed Players, respect that action and let Round
    // Manager remain visible instead of immediately reopening Players.
    if (window.__scsSkipEmptyPlayersRedirectOnce) {
      window.__scsSkipEmptyPlayersRedirectOnce = false;
      return false;
    }
    // Never leave an existing online or iMode session, even if its current
    // player data has not finished painting yet.
    var hasOnlineSession = (typeof getMySessionId === 'function') && !!getMySessionId();
    var hasOfflineSession = !!(window.SCSOfflineRounds &&
      typeof window.SCSOfflineRounds.hasSessionInProgress === 'function' &&
      window.SCSOfflineRounds.hasSessionInProgress());
    if (hasOnlineSession || hasOfflineSession) return false;

    // Only redirect on initial Round Manager entry when there is no active
    // session and no usable player list.
    // Existing sessions and normal Round Manager navigation remain untouched.
    var playerCount = 0;
    try {
      if (typeof schedulerState !== 'undefined' && schedulerState) {
        if (Array.isArray(schedulerState.activeplayers)) playerCount = schedulerState.activeplayers.length;
        if (!playerCount && Array.isArray(schedulerState.allPlayers)) {
          playerCount = schedulerState.allPlayers.filter(function(player) {
            return player && player.active !== false;
          }).length;
        }
      }
    } catch (_) {}
    if (playerCount > 0) return false;

    if (typeof homeHideScreen === 'function') homeHideScreen();
    if (typeof _navSource !== 'undefined') _navSource = 'rounds';
    window.__scsPlayersReturnSource = 'rounds';
    if (typeof showPage === 'function') showPage('playersPage', null);
    if (typeof _updateDynamicBackBtns === 'function') _updateDynamicBackBtns('playersPage');
    return true;
  } catch (error) {
    console.warn('Round Manager empty-state redirect failed:', error);
    return false;
  }
}

async function openOrganiserWorkspaceForMember(selectedClubId) {
  if (_organiserWorkspaceOpening) return;
  _organiserWorkspaceOpening = true;
  try {
    var clubs = await getOrganiserEligibleClubs();
    var demoSession = (typeof isDemoMode === 'function' && isDemoMode()) ||
      (typeof isRoundManagerDemoMode === 'function' && isRoundManagerDemoMode());
    var realClubs = demoSession ? clubs : clubs.filter(function(club) { return club.source !== 'demo'; });
    if (!realClubs.length) {
      showRoundManagerSignedOutChoice({ signedInNoClub: true });
      return;
    }
    var selectedClub = selectedClubId
      ? realClubs.find(function(club) { return club.id === String(selectedClubId); })
      : null;
    if (!selectedClub) {
      var activeClub = (typeof getMyClub === 'function') ? getMyClub() : null;
      var vaultIsVerified = (typeof hasVerifiedWorkspaceRole === 'function' && hasVerifiedWorkspaceRole('vault')) ||
        sessionStorage.getItem('scs_vault_verified') === '1' || localStorage.getItem('scs_vault_verified') === '1';
      var preferredIds = [
        localStorage.getItem('kbrr_org_club_id') || '',
        vaultIsVerified ? (localStorage.getItem('kbrr_vault_club_id') || '') : '',
        activeClub && activeClub.id
      ].map(function(id) { return String(id || ''); }).filter(Boolean);
      for (var preferredIndex = 0; preferredIndex < preferredIds.length && !selectedClub; preferredIndex++) {
        selectedClub = realClubs.find(function(club) { return club.id === preferredIds[preferredIndex]; }) || null;
      }
    }
    // First Round Manager entry must visibly choose a club. Once a Round
    // Manager club is saved, later entries go straight to that club.
    if (!selectedClub) selectedClub = await showOrganiserAccessMenu(realClubs);
    if (!selectedClub) return;
    var offlineEntry = navigator.onLine === false;
    var club;
    if (offlineEntry) {
      // Never create/update membership offline. Use the last club that passed
      // the normal online organiser verification on this device.
      if (localStorage.getItem('scs_organiser_verified') !== '1' ||
          String(localStorage.getItem('kbrr_org_club_id') || '') !== String(selectedClub.id)) {
        if (typeof showToast === 'function') showToast('Round Manager needs a previously verified subscription and club for offline use.');
        return;
      }
      club = {
        id: String(selectedClub.id),
        name: selectedClub.name || localStorage.getItem('kbrr_org_club_name') || '',
        source: 'offline-cache'
      };
    } else {
      club = await syncOrganiserMembershipAccess(null, selectedClub.id);
      if (!club || !club.id) return;
    }
    if (typeof setMyClub === 'function') setMyClub(club.id, club.name || '');
    localStorage.setItem('kbrr_club_mode', club.source === 'vault' ? 'admin' : 'user');
    var overlay = document.getElementById('modeSelectOverlay');
    if (overlay) {
      overlay.classList.remove('scs-launch-first-paint');
      overlay.style.display = 'none';
    }
    appMode = 'organiser';
    sessionStorage.setItem('appMode', 'organiser');
    localStorage.setItem('kbrr_app_mode', 'organiser');
    applyMode('organiser');
    updateModePill('organiser');
    welcomeMarkModeUsed('organiser');
    // Paint Round Manager first, then route a genuinely empty setup to Players.
    if (typeof showHomeScreen === 'function') showHomeScreen();
    setTimeout(function() {
      scsOpenPlayersManagerWhenRoundManagerEmpty(club.id).catch(function(error) {
        console.warn('Round Manager initial Players page skipped:', error);
      });
    }, 0);
    // Offline entry goes straight to the dedicated Round Mode Offline card.
    // Online entry keeps the existing default Round Mode card.
    if (offlineEntry) {
      setTimeout(function() {
        if (typeof orgSetSchedulingSlide === 'function') orgSetSchedulingSlide(1);
      }, 0);
    }
  } catch (error) {
    if (typeof showToast === 'function') showToast(error.message || 'Could not open Organiser');
  } finally {
    _organiserWorkspaceOpening = false;
    updateWelcomeWorkspaceClubNames();
  }
}

function switchMode(mode) {
  if (!experienceAllowsRole(mode)) {
    if (typeof showToast === 'function') showToast('This hub is hidden by your Experience Mode setting');
    return;
  }
  // Check subscription access
  if (typeof canAccessMode === 'function' && !canAccessMode(mode)) {
    if (typeof showModeUpgradePrompt === 'function') showModeUpgradePrompt(mode);
    return;
  }

  // Protected workspaces must never bypass the account login when opened
  // from Welcome or from the mode switcher.
  if (mode !== 'viewer' &&
      typeof authIsLoggedIn === 'function' &&
      !authIsLoggedIn()) {
    if (mode === 'organiser') {
      showRoundManagerSignedOutChoice();
      return;
    }
    sessionStorage.setItem('scs_pending_workspace', mode);
    welcomeSelectedWorkspace = mode;
    if (typeof authShowScreen === 'function') authShowScreen('login');
    return;
  }

  // Viewer -- no login or club needed
  if (mode === 'viewer') {
    const overlay = document.getElementById('modeSelectOverlay');
    if (overlay) {
      overlay.classList.remove('scs-launch-first-paint');
      overlay.style.display = 'none';
    }
    appMode = mode;
    sessionStorage.setItem('appMode', mode);
    localStorage.setItem('kbrr_app_mode', mode);
    applyMode(mode);
    updateModePill(mode);
    if (typeof showHomeScreen === 'function') showHomeScreen();
    welcomeRefreshClubBroadcast();
  if (typeof window.scsNotificationsCheckNow === 'function') {
      setTimeout(function() { window.scsNotificationsCheckNow(); }, 350);
    }
    return;
  }

  // Organiser -- available to every signed-in player who belongs to the club.
  if (mode === 'organiser') {
    // Round Manager owns its first-time club choice. Do not silently inherit
    // Slot Manager's club before Round Manager has been set once.
    var savedOrganiserClub = localStorage.getItem('kbrr_org_club_id') || '';
    openOrganiserWorkspaceForMember(savedOrganiserClub);
    return;
  }

  // Vault -- independent session flag, admin password only
  if (mode === 'vault') {
    requestVaultMode();
    return;
  }
}

function isRoundManagerDemoMode() {
  return sessionStorage.getItem('scs_round_manager_demo') === '1';
}

async function roundManagerStartDemo() {
  var currentUser = (typeof authGetUser === 'function') ? authGetUser() : null;
  var demoClubId = (typeof DEMO_CLUB_ID !== 'undefined') ? String(DEMO_CLUB_ID || '') : '';

  // IMPORTANT: Round Manager's Demo is a club/workspace choice, not an
  // authentication choice. If a real user is already signed in, never call
  // authStartDemo(): that function intentionally signs in as the shared Demo
  // account and overwrites auth_user/_authUser, which made Home/My Card become
  // "Demo". Keep the real login untouched and mark only this Round Manager
  // entry as using the Demo club.
  if (currentUser && currentUser.id) {
    sessionStorage.setItem('scs_round_manager_demo', '1');
    await openOrganiserWorkspaceForMember(demoClubId);
    return;
  }

  // Signed-out visitors still use the existing shared Demo account flow.
  if (!(typeof isDemoMode === 'function' && isDemoMode())) {
    if (typeof authStartDemo !== 'function') return;
    await authStartDemo();
  }
  if (typeof isDemoMode === 'function' && isDemoMode()) {
    await openOrganiserWorkspaceForMember(demoClubId);
  }
}

function showRoundManagerSignedOutChoice(options) {
  options = options || {};
  var signedInNoClub = options.signedInNoClub === true;
  var existing = document.getElementById('roundManagerEntryChoiceOverlay');
  if (existing) existing.remove();
  var overlay = document.createElement('div');
  overlay.id = 'roundManagerEntryChoiceOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10025;background:rgba(0,0,0,.62);display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(4px)';
  overlay.innerHTML = `
    <section class="club-setup-sheet" role="dialog" aria-modal="true" aria-labelledby="roundManagerEntryChoiceTitle">
      <button type="button" class="club-setup-assist-close" aria-label="Close">&#215;</button>
      <div class="mode-sheet-handle"></div>
      <div class="mode-sheet-title" id="roundManagerEntryChoiceTitle">Round Manager</div>
      <p style="font-size:.84rem;color:var(--text-dim);margin:0 0 16px;line-height:1.5">${signedInNoClub ? 'Choose a club or use Demo.' : 'Choose how you want to enter Round Manager.'}</p>
      <div class="round-manager-entry-options" style="display:grid;gap:12px">
        <button type="button" class="rounds-template-action-btn is-create" data-round-entry="member" style="${signedInNoClub ? 'display:none' : ''}">
          <span class="rounds-template-action-icon" aria-hidden="true">👤</span>
          <span><strong>Member Login</strong><small>Sign in with your existing SCS player account.</small></span>
          <span class="rounds-template-action-arrow" aria-hidden="true">&rsaquo;</span>
        </button>
        <button type="button" class="rounds-template-action-btn is-edit" data-round-entry="club">
          <span class="rounds-template-action-icon" aria-hidden="true">🏆</span>
          <span><strong>Club &amp; Password</strong><small>Enter directly using the club's shared password.</small></span>
          <span class="rounds-template-action-arrow" aria-hidden="true">&rsaquo;</span>
        </button>
        <button type="button" class="rounds-template-action-btn is-create" data-round-entry="demo">
          <span class="rounds-template-action-icon" aria-hidden="true">🎮</span>
          <span><strong>Use Demo</strong><small>Open the Demo club and try Round Manager immediately.</small></span>
          <span class="rounds-template-action-arrow" aria-hidden="true">›</span>
        </button>
      </div>
    </section>`;
  function closeChoice() { if (overlay && overlay.parentNode) overlay.remove(); }
  overlay.querySelector('.club-setup-assist-close').addEventListener('click', closeChoice);
  overlay.addEventListener('click', function(event) { if (event.target === overlay) closeChoice(); });
  overlay.querySelector('[data-round-entry="member"]').addEventListener('click', function() {
    closeChoice();
    sessionStorage.setItem('scs_pending_workspace', 'organiser');
    welcomeSelectedWorkspace = 'organiser';
    if (typeof authShowScreen === 'function') authShowScreen('login');
  });
  overlay.querySelector('[data-round-entry="club"]').addEventListener('click', function() {
    closeChoice();
    _showClubSetupSheet('organiser_guest');
  });
  overlay.querySelector('[data-round-entry="demo"]').addEventListener('click', function() {
    closeChoice();
    roundManagerStartDemo();
  });
  document.body.appendChild(overlay);
}

async function scsChangeRoundManagerClub() {
  if (typeof appMode === 'undefined' || appMode !== 'organiser') return;
  try {
    var clubs = await getOrganiserEligibleClubs();
    var demoSession = (typeof isDemoMode === 'function' && isDemoMode()) ||
      (typeof isRoundManagerDemoMode === 'function' && isRoundManagerDemoMode());
    var choices = demoSession ? clubs : clubs.filter(function(club) { return club.source !== 'demo'; });
    if (!choices.length) {
      if (typeof showToast === 'function') showToast('No organiser clubs are available.');
      return;
    }
    var selected = await showOrganiserAccessMenu(choices, { directSelect: true });
    if (!selected || !selected.id) return;
    var currentId = localStorage.getItem('kbrr_org_club_id') || '';
    if (String(currentId) === String(selected.id)) return;

    var currentClub = { id: currentId, name: localStorage.getItem('kbrr_org_club_name') || '' };
    if (currentId && typeof _scsGuideConfirmClubChange === 'function') {
      var ok = await _scsGuideConfirmClubChange(currentClub, selected);
      if (!ok) return;
    }
    if (currentId && typeof _scsGuideResetOrganiserSessionForClubChange === 'function') {
      await _scsGuideResetOrganiserSessionForClubChange();
    }
    var club = selected;
    if (selected.source !== 'demo' && typeof isRoundManagerDemoMode === 'function' && isRoundManagerDemoMode()) {
      sessionStorage.removeItem('scs_round_manager_demo');
    }
    if (navigator.onLine !== false && typeof syncOrganiserMembershipAccess === 'function') {
      club = await syncOrganiserMembershipAccess(null, selected.id) || selected;
    }
    syncRoundAndSlotManagerClub(String(club.id), club.name || selected.name || '');
    if (typeof setMyClub === 'function') setMyClub(String(club.id), club.name || selected.name || '');
    window.__scsWelcomeOrganiserChoice = String(club.id);
    sessionStorage.setItem('scs_organiser_verified', '1');
    localStorage.setItem('scs_organiser_verified', '1');
    if (typeof syncToLocal === 'function') await syncToLocal();
    if (typeof updateModePill === 'function') updateModePill('organiser');
    if (typeof showHomeScreen === 'function') showHomeScreen();
  } catch (error) {
    console.warn('Round Manager club change failed:', error);
    if (typeof showToast === 'function') showToast(error && error.message ? error.message : 'Could not change club.');
  }
}

function scsTopbarModeAction(event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  if (typeof appMode !== 'undefined' && appMode === 'organiser') {
    scsChangeRoundManagerClub();
    return;
  }
  openModeSwitcher();
}

function updateModePill(mode) {
  const icons  = { viewer: '🏸', organiser: '🏆', vault: '🔑' };
  const labels = { viewer: t('myHub'), organiser: t('roundManager'), vault: t('slotManager') };
  const colors = { viewer: '#6c8cff', organiser: '#2dce89', vault: '#f5a623' };
  const icon  = icons[mode]  || '🏸';
  const label = labels[mode] || 'Mode';
  const color = colors[mode] || '#6c8cff';
  ['', '2'].forEach(suffix => {
    const iconEl  = document.getElementById('modePillIcon'  + suffix);
    const labelEl = document.getElementById('modePillLabel' + suffix);
    const btnEl   = document.getElementById('modePillBtn'   + suffix);
    if (iconEl)  iconEl.textContent  = icon;
    if (labelEl) labelEl.textContent = label;
    // modePillBtn2 (main scs-topbar): apply full pill styling
    if (btnEl && suffix === '2') { btnEl.style.color = color; btnEl.style.borderColor = color + '44'; btnEl.style.background = color + '11'; }
    // modePillBtn (home topbar): reset any previously applied inline styles
    if (btnEl && suffix === '') { btnEl.style.color = ''; btnEl.style.borderColor = ''; btnEl.style.background = ''; }
  });
  // Update dynamic subtitle on both topbars
  var subtitle = '';
  if (mode === 'viewer') {
    var accountUser = (typeof authGetUser === 'function') ? authGetUser() : null;
    var player = (typeof getMyPlayer === 'function') ? getMyPlayer() : null;
    subtitle = (accountUser && (accountUser.nickname || accountUser.displayName)) ||
      (player && (player.displayName || player.name || player.nickname)) || '';
  } else if (mode === 'organiser' || mode === 'vault') {
    var club = (typeof getMyClub === 'function') ? getMyClub() : null;
    subtitle = (club && club.name) || '';
  }
  ['modePillSub', 'modePillSub2'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.textContent = subtitle;
  });
  // Update Settings page mode value
  const settingsModeEl = document.getElementById('settingsModeValue');
  if (settingsModeEl) { settingsModeEl.textContent = icon + ' ' + label; settingsModeEl.style.color = color; }
  // Sync scs-topbar icon bg colour
  document.querySelectorAll('.scs-topbar-icon-wrap').forEach(function(el) {
    el.style.background = color + '28';
  });
}

function initModeOnLoad() {
  // Build 1044: My Hub replaces the old workspace Welcome page.
  var homeEl = document.getElementById('homePageOverlay');
  if (homeEl) homeEl.style.display = 'none';
  document.querySelectorAll('.page').forEach(function(page) {
    page.style.display = 'none';
  });

  var overlay = document.getElementById('modeSelectOverlay');
  if (overlay) {
    overlay.classList.remove('scs-launch-first-paint');
    overlay.style.display = 'none';
  }

  loadHomeStyle();
  appMode = 'viewer';
  welcomeSelectedWorkspace = 'viewer';
  localStorage.setItem('kbrr_app_mode', 'viewer');
  updateModePill('viewer');
  if (typeof welcomeSelectWorkspace === 'function') welcomeSelectWorkspace('viewer');
  if (typeof welcomeApplyAllHubData === 'function') welcomeApplyAllHubData();

  initAppFlow();
}

async function initAppFlow() {
  // ── Demo mode auto-resume ──
  if (typeof isDemoMode === 'function' && isDemoMode()) {
    var user = typeof authGetUser === 'function' ? authGetUser() : null;
    if (user && user.id) {
      // Resume demo on My Hub; the old workspace Welcome page is no longer shown.
      if (typeof _demoStartTimer === 'function') _demoStartTimer();
      switchMode('viewer');
      return;
    } else {
      // Demo session expired — clean up
      localStorage.removeItem('scs_demo_mode');
    }
  }

  // ── Step 1: Check auth ──
  if (typeof authIsLoggedIn === 'function' && !authIsLoggedIn()) {
    // Invite links must support existing users and brand-new members.
    authShowScreen('welcome');
    return;
  }

  // ── Step 2: My Hub is the application Home — paint it immediately. ──
  // Do not block the first usable screen on club/subscription/prefetch network
  // requests. Those refresh in the background and update the same existing
  // controls/data when they finish. No feature or manager function is removed.
  if ((typeof authGetPendingJoinClubId === 'function' && authGetPendingJoinClubId()) ||
      sessionStorage.getItem('pending_join_club_id')) {
    if (typeof welcomeSelectWorkspace === 'function') welcomeSelectWorkspace('viewer');
  }
  switchMode('viewer');

  if (typeof renderLauncherStartSessionCard === 'function') {
    setTimeout(renderLauncherStartSessionCard, 0);
    setTimeout(renderLauncherStartSessionCard, 800);
  }
  if (typeof welcomeApplyAllHubData === 'function') welcomeApplyAllHubData();

  // Refresh account roles/subscription after Home is already visible.
  if (navigator.onLine !== false) {
    Promise.resolve().then(async function() {
      if (typeof restoreUserClubRoles === 'function') {
        await restoreUserClubRoles().catch(function(e) {
          console.warn('Club role restore skipped:', e && (e.message || e));
        });
      }
      var subscriptionUser = typeof authGetUser === 'function' ? authGetUser() : null;
      if (subscriptionUser && typeof verifyAccessWithServer === 'function') {
        await verifyAccessWithServer(subscriptionUser).catch(function(e) {
          console.warn('Subscription refresh skipped:', e && (e.message || e));
        });
      }
      if (typeof welcomeApplyAllHubData === 'function') welcomeApplyAllHubData();
      if (typeof showHomeScreen === 'function' && appMode === 'viewer') showHomeScreen();
    }).catch(function(e) {
      console.warn('Home background refresh skipped:', e && (e.message || e));
    });
  }
  if (typeof welcomeRefreshHubIfVisible === 'function') welcomeRefreshHubIfVisible(false);
  return;
}

/* ============================================================
   MAIN -- Navigation, tab access, scheduler init, round progression
   File: main.js
   ============================================================ */

let sessionFinished = false;
let lastPage = null;



function isPageVisible(pageId) {
  const el = document.getElementById(pageId);
  return el && el.style.display !== 'none';
}








document.addEventListener('DOMContentLoaded', async () => {
  // License check — must have valid key to use app
  // Check license on every app open
  (async function() {
    const subscriptionUser = typeof authGetUser === 'function' ? authGetUser() : null;
    const legacyEmail = localStorage.getItem('scs_sub_email');
    if ((subscriptionUser || legacyEmail) && typeof checkLicense === 'function') {
      await checkLicense(subscriptionUser || legacyEmail);
    } else {
      if (typeof _initTrial === 'function') _initTrial();
      if (typeof subShowTrialBanner === 'function') subShowTrialBanner();
    }
  })();
  // Restore theme and font size from saved prefs FIRST
  if (typeof initTheme    === 'function') initTheme();
  if (typeof initFontSize === 'function') initFontSize();
  syncExperienceModeUI();

  // Complete social OAuth before normal restored-session or launcher handling.
  if (typeof authHandleGoogleCallback === 'function') {
    var googleCallbackHandled = await authHandleGoogleCallback();
    if (googleCallbackHandled) return;
  }
  if (typeof authHandleLineCallback === 'function') {
    var lineCallbackHandled = await authHandleLineCallback();
    if (lineCallbackHandled) return;
  }

  // Paint the local app state first. My Hub is the Home screen and must never
  // wait behind session validation or workspace prefetch network requests.
  initModeOnLoad();
  syncExperienceModeUI();
  if (typeof window.scsFinishStartup === 'function') window.scsFinishStartup();

  // Validate a restored login in the background. authVerifySession() already
  // handles a displaced/expired account by returning to the login screen.
  if (typeof authIsLoggedIn === 'function' && authIsLoggedIn()) {
    Promise.resolve().then(async function() {
      if (typeof authVerifySession === 'function') {
        var startupSessionValid = await authVerifySession();
        if (!startupSessionValid) return;
      }
      if (typeof _startSessionWatch === 'function') _startSessionWatch();
      if (typeof restoreUserClubRoles === 'function') {
        await restoreUserClubRoles().catch(function(){});
      }
    }).catch(function(e) {
      console.warn('Background session validation skipped:', e && (e.message || e));
    });
  }

  // Preserve the existing prefetch functions, but do not make the Home render
  // depend on them. They populate the same caches asynchronously.
  if (typeof window.scsPrefetchAllWorkspaceData === 'function') {
    window.scsPrefetchAllWorkspaceData().catch(function(e) {
      console.warn('Workspace prefetch skipped:', e && (e.message || e));
    });
  }

  // schedulerState starts empty -- user imports players fresh each session
  consolidateMasterDB();
  updateRoundsPageAccess();
  updateSummaryPageAccess();
  // Init Supabase admin state (token + club)
  if (typeof clubAdminInit === "function") clubAdminInit();
  // Player/global caches were already loaded by scsPrefetchAllWorkspaceData().
  // Do not immediately start the same network sync again after startup.
  // Sync all global players into local cache only as a fallback when prefetch was unavailable.
  if (!window.__scsWorkspacePrefetchReady && typeof syncGlobalPlayersCache === "function") syncGlobalPlayersCache();
  // Build 603: auto-finish LIVE sessions with no activity for 3 hours.
  if (typeof cleanupLiveSessions === "function") cleanupLiveSessions();
  setInterval(() => {
    if (typeof cleanupLiveSessions === "function") cleanupLiveSessions();
  }, 15 * 60 * 1000);

  // ── Profile gate handled by selectMode() after mode is chosen ──

  // Auto end session if no round activity for 1 hour
  const AUTO_END_MS = 60 * 60 * 1000; // 1 hour
  setInterval(async () => {
    // Only trigger if there are active rounds with scored games
    const hasGames = typeof allRounds !== "undefined" &&
      allRounds.some(r => (r.games || r).some(g => g.winner));
    if (!hasGames) return;

    // Check last round update time from live_sessions
    try {
      const club = (typeof getMyClub === "function") ? getMyClub() : { id: null };
      if (!club.id) return;
      const today = (typeof localDateStr === 'function') ? localDateStr() : new Date().toISOString().split("T")[0];
      const rows  = await sbGet("live_sessions",
        `club_id=eq.${club.id}&date=eq.${today}&order=updated_at.desc&limit=1`);
      if (!rows || !rows.length) return;

      const lastUpdate = new Date(rows[0].updated_at).getTime();
      if (Date.now() - lastUpdate < AUTO_END_MS) return;

      // 1hr idle -- warn organiser, don't silently end
      console.log('Session idle for 1hr — prompting organiser');
      if (document.getElementById('roundsPage') &&
          document.getElementById('roundsPage').style.display !== 'none') {
        // Only show if currently on rounds page
        var existing = document.getElementById('scs-idle-warning');
        if (!existing) {
          var warn = document.createElement('div');
          warn.id = 'scs-idle-warning';
          warn.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#e63757;color:#fff;padding:12px 20px;border-radius:12px;font-size:0.85rem;font-weight:600;z-index:9999;text-align:center;max-width:280px;box-shadow:0 4px 16px rgba(0,0,0,0.4);';
          warn.innerHTML = '⚠️ Session idle for 1 hour.<br><span style="font-weight:400;font-size:0.8rem;">Tap End when finished to save results.</span>';
          warn.onclick = function() { warn.remove(); };
          document.body.appendChild(warn);
          setTimeout(function() { if (warn.parentNode) warn.remove(); }, 10000);
        }
      }
    } catch(e) { /* silent */ }
  }, 5 * 60 * 1000); // check every 5 minutes
});

window.addEventListener('beforeunload', () => {
  consolidateMasterDB();   // merge any new players added during session on close
  // Note: do NOT complete session on close — organiser may reopen and resume.
  // Session only completes when organiser explicitly taps End.
});

// ── Sync when back online ──
window.addEventListener('online', async () => {
  console.log('Back online -- flushing sync queue...');
  if (typeof flushSyncQueue === 'function') await flushSyncQueue();
  if (typeof syncToLocal    === 'function') await syncToLocal();
});

/* =========================
   CONSOLIDATE MASTER DB
   Merges players from ALL sources into newImportHistory.
   Safe -- never overwrites existing ratings, only adds missing players.
   Called on app open and close.
========================= */
function consolidateMasterDB() {
  try {
    const master   = JSON.parse(localStorage.getItem("newImportHistory")      || "[]");
    const favs     = JSON.parse(localStorage.getItem("newImportFavorites")     || "[]");
    const sets     = JSON.parse(localStorage.getItem("newImportFavoriteSets")  || "[]");
    const session  = JSON.parse(localStorage.getItem("schedulerPlayers")       || "[]");

    // Build lookup of existing master players (preserve their ratings)
    const masterMap = new Map();
    master.forEach(p => {
      if (p && p.displayName)
        masterMap.set(p.displayName.trim().toLowerCase(), p);
    });

    // Collect players from favorites and session only -- NOT from sets
    // Sets are separate and should not pollute history
    const allSources = [
      ...favs,
      ...session.map(p => ({ displayName: p.name, gender: p.gender })),
    ];

    // Add missing players -- never overwrite existing
    allSources.forEach(p => {
      if (!p || !p.displayName) return;
      const key = p.displayName.trim().toLowerCase();
      if (!masterMap.has(key)) {
        masterMap.set(key, {
          displayName: p.displayName.trim(),
          gender: p.gender || "Male",
          rating: 1.0   // default for new players only
        });
      }
    });

    const merged = Array.from(masterMap.values());
    localStorage.setItem("newImportHistory", JSON.stringify(merged));

    // Update in-memory historyPlayers if available
    if (newImportState) newImportState.historyPlayers = merged;
  } catch(e) {
    console.error("consolidateMasterDB error", e);
  }
}

/* ============================================================
   RATING -- SINGLE DOOR
   
   Rule: activeRating is computed ONCE at sync time in syncToLocal.
   Everything else reads newImportHistory[].activeRating -- mode-blind.

   getActiveRating(name)     -- only READ path
   setActiveRating(name,val) -- only WRITE path (in-memory + localStorage)
   syncRatings()             -- refreshes all visible badges
   
   Mode logic lives ONLY in syncToLocal (read) and dbSyncRatings (write).
   ============================================================ */

function getRatingMode() {
  return 'local'; // global mode blocked until fully tested
}

function setRatingMode(mode) {
  localStorage.setItem('kbrr_rating_mode', mode);
  syncRatings();
}

/* READ -- just reads activeRating, no mode logic here */
function isGuestPlayerName(name) {
  try {
    const key = String(name || '').trim().toLowerCase();
    const ap = schedulerState.allPlayers.find(p => String(p.name || '').trim().toLowerCase() === key);
    return !!(ap && (ap.guest || ap.unrated)) || /\(guest(?:\s+[a-z0-9]+)?\)$/i.test(String(name || ''));
  } catch(e) {
    return /\(guest(?:\s+[a-z0-9]+)?\)$/i.test(String(name || ''));
  }
}

function getActiveRating(name) {
  try {
    if (isGuestPlayerName(name)) return null;
    const key = name.trim().toLowerCase();
    // 1. Check allPlayers in-memory first (most current during active session)
    const ap = schedulerState.allPlayers.find(p => p.name.trim().toLowerCase() === key);
    if (ap && ap.activeRating !== undefined && ap.activeRating !== null) return ap.activeRating;
    // 2. Fallback to newImportHistory
    const master = JSON.parse(localStorage.getItem("newImportHistory") || "[]");
    const hp = master.find(h => h.displayName.trim().toLowerCase() === key);
    return (hp && hp.activeRating !== undefined) ? hp.activeRating : 1.0;
  } catch(e) { return 1.0; }
}

/* WRITE -- updates in-memory and localStorage, mode-blind */
function setActiveRating(name, val) {
  try {
    if (isGuestPlayerName(name)) return;
    const key     = name.trim().toLowerCase();
    const clamped = Math.min(5.0, Math.max(1.0, Math.round(val * 10) / 10));

    // Update allPlayers in-memory
    const ap = schedulerState.allPlayers.find(p => p.name.trim().toLowerCase() === key);
    if (ap) ap.activeRating = clamped;

    // Persist to newImportHistory
    const master = JSON.parse(localStorage.getItem("newImportHistory") || "[]");
    const hp = master.find(h => h.displayName.trim().toLowerCase() === key);
    if (hp) {
      hp.activeRating = clamped;
      localStorage.setItem("newImportHistory", JSON.stringify(master));
      // Keep in-memory historyPlayers in sync too
      if (newImportState && newImportState.historyPlayers) {
        const mp = newImportState.historyPlayers.find(h => h.displayName.trim().toLowerCase() === key);
        if (mp) mp.activeRating = clamped;
      }
    }
  } catch(e) { console.error("setActiveRating error", e); }
}

/* Legacy aliases -- safe to leave, all point to same door */
function getRating(name)         { return getActiveRating(name); }
function setRating(name, rating) { setActiveRating(name, rating); }
function getClubRating(name)     { return getActiveRating(name); }
function setClubRating(name, r)  { setActiveRating(name, r); }

function syncRatings() {
  document.querySelectorAll(".rating-badge[data-player]").forEach(badge => {
    const name = badge.getAttribute("data-player");
    if (!name) return;
    if (isGuestPlayerName(name)) {
      badge.removeAttribute("data-player");
      badge.textContent = "guest";
      return;
    }
    const rating = getActiveRating(name);
    badge.textContent = Number.isFinite(rating) ? rating.toFixed(1) : "guest";
  });
}

function syncPlayersFromMaster() { syncRatings(); }


function updateRoundsPageAccess() {
  const block = schedulerState.activeplayers.length < 4;
  const roundsTab = document.getElementById('tabBtnRounds');

  if (!roundsTab) return;

  roundsTab.style.pointerEvents = block ? 'none' : 'auto';
  roundsTab.style.opacity = block ? '0.4' : '1';
  roundsTab.setAttribute('aria-disabled', block);

  if (block && isPageVisible('roundsPage')) {
    if (typeof _navSource !== 'undefined') _navSource = 'rounds';
    window.__scsPlayersReturnSource = 'rounds';
    showPage('playersPage', null);
  }
}


function updateSummaryPageAccess() {
  const hasRounds = Array.isArray(allRounds) && allRounds.length > 0;
  const summaryTab = document.getElementById('tabBtnSummary');
  const block = !hasRounds;

  if (!summaryTab) return;

  summaryTab.style.pointerEvents = block ? 'none' : 'auto';
  summaryTab.style.opacity = block ? '0.4' : '1';
  summaryTab.setAttribute('aria-disabled', block);

  if (block && isPageVisible('summaryPage')) {
    showPage('playersPage', null);
  }
}

// Central page-level guard for background database polling.
// While Round Manager is visible, only round-owned activity (heartbeat and
// explicit round actions) should touch the database.
window.scsIsRoundManagerVisible = function() {
  try {
    var page = document.getElementById('roundsPage');
    return !!(page && page.style.display !== 'none');
  } catch (_) {
    return false;
  }
};

function showPage(pageID, el) {
  // Build 1076: page-to-page navigation must not repaint the iOS safe area.
  // Safe-area ownership stays with primary workspace navigation/homeHideScreen.
  // In particular, Players -> Round now restores the Round page without
  // touching html/body/theme colours during the return render.

  // A workspace page must sit above no launcher layer. Welcome refreshes can
  // complete after navigation and otherwise leave the mode selector catching
  // taps over Rounds and its Standard/Balanced settings.
  var launcherOverlay = document.getElementById('modeSelectOverlay');
  if (launcherOverlay) launcherOverlay.style.display = 'none';

  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');

  // Show selected page
  var selectedPage = document.getElementById(pageID);
  selectedPage.style.display = 'block';

  // Keep back-navigation ownership in sync with the primary workspace page.
  // This prevents a previously opened Settings page from leaving a stale
  // _navSource="settings" value that can send Players -> Settings on close.
  if (typeof _navSource !== 'undefined') {
    if (pageID === 'roundsPage') _navSource = 'rounds';
    else if (pageID === 'settingsPage') _navSource = 'settings';
  }
  if (pageID === 'playersPage') {
    if (!window.__scsPlayersReturnSource) {
      var roundNav = document.getElementById('scsNavRound');
      if ((roundNav && roundNav.classList.contains('is-active')) ||
          (typeof appMode !== 'undefined' && appMode === 'organiser')) {
        window.__scsPlayersReturnSource = 'rounds';
        if (typeof _navSource !== 'undefined') _navSource = 'rounds';
      }
    }
    selectedPage.scrollTop = 0;
    if (selectedPage.scrollTo) { try { selectedPage.scrollTo({ top: 0, left: 0, behavior: 'auto' }); } catch (_) { selectedPage.scrollTop = 0; } }
  }

  // Hide both top bars while inside a page
  document.querySelectorAll('.home-topbar, .top-bar').forEach(b => b.style.display = 'none');

  // Update active tab styling
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  if (el) {
    el.classList.add('active');
    // Scroll active tab into view smoothly
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  // Restore Session tab if a session is currently pinned open
  if (window._vSessionTabPinned) {
    const vBtn = document.getElementById('tabBtnViewer');
    if (vBtn) vBtn.style.display = '';
  }

  // Sync all rating badges on the newly visible page
  syncRatings();

  // Players page -- update list on open
  if (pageID === 'playersPage') {
    if (typeof updatePlayerList === 'function') updatePlayerList();
  }

  // Fixed Pairs page -- refresh selectors on open
  if (pageID === 'fixedPairsPage') {
    if (typeof updateFixedPairSelectors === 'function') updateFixedPairSelectors();
    if (typeof renderFixedPairs === 'function') renderFixedPairs();
  }

  // ➜ Additional action when roundsPage is opened
  if (pageID === "roundsPage") {
    if (sessionFinished) {
      sessionFinished = false;
      allRounds.length = 0;
    }
    updateMixedSessionFlag();
    if (allRounds.length <= 1) {
      resetRounds();
    } else {
      // If court count changed, use the same whole-round 🎲 path.
      const currentCourts = parseInt(document.getElementById('num-courts')?.textContent || '1');
      if (currentCourts !== schedulerState.numCourts) {
        if (typeof courts !== 'undefined') courts = currentCourts;
        schedulerState.numCourts = currentCourts;
        schedulerState.courts = currentCourts;
        if (typeof RefreshRound === 'function') RefreshRound();
      } else {
        if (typeof showRound === 'function') showRound(currentRoundIndex);
      }
    }
    updateSessionLiveBar();
  }

  if (pageID === "summaryPage") {
    if (typeof renderSummaryFromSession === 'function') renderSummaryFromSession();
  }

  if (pageID === "vaultReportPage") {
    // Update month label
    const d = new Date();
    const label = d.toLocaleString('default', { month: 'long', year: 'numeric' });
    const titleEl = document.getElementById('reportMonthTitle');
    const subEl   = document.getElementById('reportMonthSub');
    if (titleEl) titleEl.textContent = label + ' ' + (t('report') || 'Report');
    if (subEl)   subEl.textContent   = t('monthlyStats') || 'Monthly stats';
    // Render preview
    if (typeof reportFetchData === 'function') {
      const preview   = document.getElementById('reportPreview');
      const statusEl  = document.getElementById('reportStatus');

      // Step 1 — show local data immediately (never blank)
      try {
        const localPlayers = JSON.parse(localStorage.getItem('newImportHistory') || '[]');
        if (localPlayers.length && preview) {
          const localData = {
            club: (typeof getMyClub === 'function') ? getMyClub() : { name: '' },
            month: reportCurrentMonth(),
            monthLabel: reportMonthLabel(),
            usingLocal: true,
            players: localPlayers
              .filter(p => p.displayName || p.name)
              .map(p => ({
                name:        p.displayName || p.name || '',
                rating:      parseFloat(p.activeRating || p.rating) || 1.0,
                points:      parseFloat(p.club_points) || 0,
                monthWins:   0, monthLosses: 0, monthGames: 0,
                monthCost:   0, sessCount: 0, winRate: 0
              }))
              .sort((a, b) => b.rating - a.rating)
          };
          const iframe = document.createElement('iframe');
          iframe.style.cssText = 'width:100%;height:80vh;border:none;border-radius:16px;';
          iframe.srcdoc = reportBuildHTML(localData);
          preview.innerHTML = '';
          preview.appendChild(iframe);
          if (statusEl) { statusEl.textContent = '📱 Local data — syncing...'; statusEl.style.color = 'var(--muted)'; }
        }
      } catch(e) { /* silent */ }

      // Step 2 — fetch from server and update
      reportFetchData().then(data => {
        if (preview) {
          const iframe = document.createElement('iframe');
          iframe.style.cssText = 'width:100%;height:80vh;border:none;border-radius:16px;';
          iframe.srcdoc = reportBuildHTML(data);
          preview.innerHTML = '';
          preview.appendChild(iframe);
        }
        if (statusEl) { statusEl.textContent = data.usingLocal ? '⚠️ Offline — local data only' : ''; statusEl.style.color = '#f5a623'; }
      }).catch(e => {
        // Server failed — local data already showing, just update status
        if (statusEl) { statusEl.textContent = '⚠️ Offline — showing local data'; statusEl.style.color = '#f5a623'; }
      });
    }
  }

  if (pageID === "vaultReport2Page") {
    if (typeof r2Init === 'function') r2Init();
  }

  // QC — start watching current mode
  if (pageID === 'homeScreen' || pageID === 'viewerHome') {
    if (typeof qcStart === 'function') qcStart('viewer');
  } else if (pageID === 'playersPage' || pageID === 'roundsPage') {
    if (typeof qcStart === 'function') qcStart('organiser');
  } else if (pageID === 'vaultPage' || pageID === 'vaultRegisterPage') {
    if (typeof qcStart === 'function') qcStart('vault');
  }

  if (pageID === "myCardPage") {
    if (typeof renderMyCard === 'function') renderMyCard();
  }

  if (pageID === "recentMatchesPage") {
    if (typeof renderMyCard === 'function') renderMyCard();
  }

  if (pageID === "joinClubPage") {
    if (typeof joinClubPageOpen === 'function') joinClubPageOpen();
  }

  if (pageID === "settingsPage") {
    if (typeof subShowTrialBanner === 'function') subShowTrialBanner();
    updateModePill(localStorage.getItem('kbrr_app_mode') || 'organiser');
    loadHomeStyle();
    if (typeof appearSyncFromSaved === 'function') appearSyncFromSaved();
    syncExperienceModeUI();
    // Track that settings is the source for sub-pages
    if (typeof _navSource !== 'undefined') _navSource = 'settings';
  }

  if (pageID === "helpPage") {
    if (typeof onHelpTabOpen === "function") onHelpTabOpen();
  }

  if (pageID === "dashboardPage") {
    if (typeof renderDashboard === "function") renderDashboard();
  } else {
    // Stop dashboard poll when navigating away
    if (typeof dashboardStopPoll === 'function') dashboardStopPoll();
  }

  if (pageID === "vaultPage") {
    if (typeof clubLoginRefresh === 'function') clubLoginRefresh();
    if (typeof viewerLoadClubs === 'function') viewerLoadClubs();
    if (typeof sbPopulateDeleteDropdown === 'function') sbPopulateDeleteDropdown();
  }

  if (pageID === "vaultVenuesPage") {
    if (typeof vaultVenuesOpenPage === 'function') vaultVenuesOpenPage();
  }

  if (pageID === "vaultPlayingPage") {
    if (typeof playerPlayingRenderList === 'function') playerPlayingRenderList();
  }

  if (pageID === "vaultRegisterPage") {
    if (typeof vaultRenderRegister === 'function') vaultRenderRegister();
  }

  if (pageID === "vaultModifyPage") {
    if (typeof vaultRenderModify === 'function') vaultRenderModify();
  }

  if (pageID === "vaultRequestsPage") {
    if (typeof vaultLoadRequests === 'function') vaultLoadRequests();
  }

  if (pageID === "vaultClubMgmtPage") {
    if (typeof clubLoginRefresh === 'function') clubLoginRefresh();
    // Always show delete panel only
    ['Connect','Create','Delete'].forEach(function(p) {
      var el = document.getElementById('clubMgmt' + p + 'Panel');
      if (el) el.style.display = p === 'Delete' ? 'block' : 'none';
    });
  }

  if (pageID === "orgClubMgmtPage") {
    if (typeof orgClubLoginRefresh === 'function') orgClubLoginRefresh();
    if (typeof orgLoadClubs === 'function') orgLoadClubs();
  }

  // Update last visited page
  lastPage = pageID;
}

let IS_MIXED_SESSION = false;

function updateMixedSessionFlag() {
  let hasMale = false;
  let hasFemale = false;

  for (const p of schedulerState.allPlayers) {
    if (p.gender === "Male") hasMale = true;
    if (p.gender === "Female") hasFemale = true;
    if (hasMale && hasFemale) break;
  }

  IS_MIXED_SESSION = hasMale && hasFemale;
}

	





















  








// Page initialization
function initPage() {
  document.getElementById("playersPage").style.display = 'block';
  document.getElementById("roundsPage").style.display = 'none';
}

/* ============================================================
   SYNC -- Server is master.
   THIS is the only place mode logic runs for READING.
   Pulls from Supabase → picks correct field based on mode → 
   writes as activeRating → everything else is mode-blind.
============================================================ */
async function syncToLocal() {
  const club = (typeof getMyClub === "function") ? getMyClub() : { id: null };
  setSyncIndicator(t("syncing"), "#aaa");

  if (!club.id) {
    setSyncIndicator(t("noClubSelectedWarn"), "#e6a817");
    return;
  }

  try {
    // Flush any offline-queued writes first
    if (typeof flushSyncQueue === "function") await flushSyncQueue();

    const players = await dbGetPlayers(true);
    if (!players || !players.length) {
      setSyncIndicator(t("noPlayersFoundWarn"), "#e6a817");
      return;
    }

    // Always use clubRating (club_rating column) as the active rating
    const synced = players.map(gp => {
      const activeRating = parseFloat(gp.clubRating) || parseFloat(gp.rating) || 1.0;
      return {
        displayName:  gp.name.trim(),
        gender:       gp.gender || "Male",
        rating:       parseFloat(gp.rating)     || 1.0,
        clubRating:   parseFloat(gp.clubRating) || 1.0,
        activeRating,
        id:           gp.id
      };
    });

    // Server wins -- write to local cache
    localStorage.setItem("newImportHistory", JSON.stringify(synced));

    // Update in-memory state
    if (newImportState) {
      newImportState.historyPlayers = synced;
      if (typeof newImportRefreshSelectCards === "function") newImportRefreshSelectCards();
    }

    // Update allPlayers in-memory activeRating (safe -- doesn't reset active session games)
    if (schedulerState && schedulerState.allPlayers) {
      synced.forEach(sp => {
        const ap = schedulerState.allPlayers.find(
          p => p.name.trim().toLowerCase() === sp.displayName.trim().toLowerCase()
        );
        if (ap) ap.activeRating = sp.activeRating;
      });
    }

    syncRatings();

    const count = synced.length;
    const msg   = `✅ ${count} ${t("playerPlural")} synced · ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
    const syncedAt = Date.now();
    localStorage.setItem("kbrr_last_sync", JSON.stringify({ msg, color: "#2dce89", at: syncedAt, ok: true }));
    setSyncIndicator(msg, "#2dce89");
    window.dispatchEvent(new CustomEvent('scs:data-synced', { detail: { source: 'players', at: syncedAt, ok: true } }));

  } catch (e) {
    console.warn("syncToLocal failed:", e.message);
    const msg = t("offlineCache");
    const failedAt = Date.now();
    localStorage.setItem("kbrr_last_sync", JSON.stringify({ msg, color: "#e6a817", at: failedAt, ok: false }));
    setSyncIndicator(msg, "#e6a817");
    window.dispatchEvent(new CustomEvent('scs:data-synced', { detail: { source: 'players', at: failedAt, ok: false } }));
  }
}

function setSyncIndicator(msg, color) {
  const indicator = document.getElementById("sbSyncStatus");
  if (indicator) { indicator.textContent = msg; indicator.style.color = color; }
}

function restoreSyncIndicator() {
  try {
    const saved = localStorage.getItem("kbrr_last_sync");
    if (saved) {
      const { msg, color } = JSON.parse(saved);
      setSyncIndicator(msg, color);
    }
  } catch(e) {}
}



/* =============================================================
   SESSION LIVE BAR
============================================================= */
function updateSessionLiveBar() {
  const bar = document.getElementById('sessionLiveBar');
  if (!bar) return;
  const sessionId = (typeof getMySessionId === 'function') ? getMySessionId() : null;
  const hasRounds = typeof allRounds !== 'undefined' && allRounds.length > 0;
  const hasIModeSession = !!(window.SCSOfflineRounds &&
    typeof window.SCSOfflineRounds.isIModeActive === 'function' &&
    window.SCSOfflineRounds.isIModeActive());
  bar.style.display = (sessionId || hasRounds || hasIModeSession) ? 'flex' : 'none';
}

/* =============================================================
   VAULT MODE -- Admin password gate
============================================================= */
async function getVaultEligibleClubs() {
  var user = (typeof authGetUser === 'function') ? authGetUser() : null;
  if (!user || !user.id || typeof sbGet !== 'function') return [];
  var grants = await sbGet('user_club_roles',
    'user_account_id=eq.' + encodeURIComponent(user.id) +
    '&vault_verified=eq.true&order=updated_at.desc&select=club_id,updated_at')
    .catch(function() { return []; });
  var ids = [];
  (grants || []).forEach(function(row) {
    var id = String(row.club_id || '');
    if (id && ids.indexOf(id) < 0) ids.push(id);
  });
  if (!ids.length) return [];
  var clubs = await sbGet('clubs', 'id=in.(' + ids.join(',') + ')&select=id,name').catch(function() { return []; });
  var names = {};
  (clubs || []).forEach(function(club) { names[String(club.id)] = club.name || ''; });
  return ids.filter(function(id) { return Object.prototype.hasOwnProperty.call(names, id); }).map(function(id) {
    return { id:id, name:names[id], source:'vault' };
  });
}

async function openVaultWorkspaceForAdmin(selectedClubId, forceChoose) {
  var clubs = await getVaultEligibleClubs();
  var selectedClub = selectedClubId
    ? clubs.find(function(club) { return String(club.id) === String(selectedClubId); })
    : null;

  if (forceChoose === true && clubs.length) {
    selectedClub = await showOrganiserAccessMenu(clubs, { directSelect:true });
    if (!selectedClub) return false;
  }

  if (!selectedClub && clubs.length) {
    var savedId = localStorage.getItem('kbrr_vault_club_id') || '';
    selectedClub = clubs.find(function(club) { return String(club.id) === String(savedId); }) || null;
  }

  // First Slot Manager / Add Slot entry: visibly choose from already verified
  // manager clubs. If none has been verified on this account yet, use the
  // existing admin-password club setup flow.
  if (!selectedClub && clubs.length) {
    selectedClub = await showOrganiserAccessMenu(clubs);
    if (!selectedClub) return false;
  }
  if (!selectedClub) {
    _showClubSetupSheet('vault');
    return false;
  }

  localStorage.setItem('kbrr_vault_club_id', String(selectedClub.id));
  localStorage.setItem('kbrr_vault_club_name', selectedClub.name || '');
  sessionStorage.setItem('scs_vault_verified', '1');
  localStorage.setItem('scs_vault_verified', '1');
  syncRoundAndSlotManagerClub(selectedClub.id, selectedClub.name || '');
  if (typeof setMyClub === 'function') setMyClub(selectedClub.id, selectedClub.name || '');

  var overlay = document.getElementById('modeSelectOverlay');
  if (overlay) {
    overlay.classList.remove('scs-launch-first-paint');
    overlay.style.display = 'none';
  }
  appMode = 'vault';
  sessionStorage.setItem('appMode', 'vault');
  localStorage.setItem('kbrr_app_mode', 'vault');
  applyMode('vault');
  updateModePill('vault');
  welcomeMarkModeUsed('vault');
  if (typeof showHomeScreen === 'function') showHomeScreen();
  return true;
}

function requestVaultMode() {
  // Pro subscription required for Vault mode
  if (typeof canAccessMode === 'function' && !canAccessMode('vault')) {
    if (typeof showModeUpgradePrompt === 'function') showModeUpgradePrompt('vault');
    return;
  }

  var savedVaultClub = localStorage.getItem('kbrr_vault_club_id') || '';
  if (hasVerifiedWorkspaceRole('vault') && savedVaultClub) {
    openVaultWorkspaceForAdmin(savedVaultClub, false);
    return;
  }

  // No saved Slot Manager club yet. The async opener will show the available
  // verified manager clubs or fall back to the existing admin-password setup.
  openVaultWorkspaceForAdmin('', false);
}

async function vaultSlotsChangeClub() {
  var changed = await openVaultWorkspaceForAdmin('', true);
  if (!changed) return;
  if (typeof homeGo === 'function') homeGo('vaultSlotsPage', null);
  if (typeof vaultSlotsOpenPage === 'function') await vaultSlotsOpenPage();
  if (typeof vaultSlotsUpdateClubPill === 'function') vaultSlotsUpdateClubPill();
}

/* =============================================================
   CLUB SETUP SHEET -- shown when entering Organiser or Vault without a club
   Provides: Join existing club | Create new club
============================================================= */
var _clubSetupTargetMode = null; // mode to enter after club is set up
var _clubSetupCreateEmail = '';  // email during create-club OTP flow

function _clubSetupClose(returnToAssist) {
  var overlay = document.getElementById('clubSetupSheetOverlay');
  if (overlay) overlay.remove();

  var assistRole = '';
  try {
    assistRole = sessionStorage.getItem('scs_club_setup_from_assist') || '';
    sessionStorage.removeItem('scs_club_setup_from_assist');
  } catch (e) {}

  if (returnToAssist !== false && assistRole) {
    setTimeout(function() { scsOpenGuidedFunctions(assistRole); }, 80);
    return true;
  }
  return false;
}

function _showClubSetupSheet(targetMode) {
  if (targetMode === 'organiser') {
    openOrganiserWorkspaceForMember();
    return;
  }
  _clubSetupTargetMode = targetMode;
  const existing = document.getElementById('clubSetupSheetOverlay');
  if (existing) existing.remove();

  const organiserEntry = targetMode === 'organiser' || targetMode === 'organiser_guest';
  const modeLabel = targetMode === 'vault' ? t('vaultManager') : t('roundOrganiser');
  const connectText = organiserEntry
    ? (t('clubConnectOrganiserMsg') || 'You need to be connected to a club. Join an existing club. To create a new club, switch to Vault mode.')
    : (t('clubConnectVaultMsg') || 'You need to be connected to a club. Join an existing club, or create a club under Vault.');
  const joinPasswordPh = targetMode === 'vault'
    ? (t('clubAdminPasswordPh') || 'Club Admin password')
    : (t('clubOrganiserPasswordPh') || 'Club Organiser password');

  const overlay = document.createElement('div');
  overlay.id = 'clubSetupSheetOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10020;background:rgba(0,0,0,0.6);display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(4px)';
  overlay.innerHTML = `
    <div class="club-setup-sheet" id="clubSetupSheet">
      <button type="button" class="club-setup-assist-close" aria-label="Close and return to Assist" onclick="_clubSetupClose(true)">✕</button>
      <div class="mode-sheet-handle"></div>
      <div class="mode-sheet-title">${modeLabel}</div>
      <p style="font-size:0.84rem;color:var(--text-dim);margin-bottom:16px;line-height:1.5">
        ${connectText}
      </p>

      <!-- TAB SWITCHER (hidden for organiser — join only) -->
      <div class="club-setup-tabs" id="clubSetupTabs" style="${organiserEntry ? 'display:none' : ''}">
        <button class="club-setup-tab active" id="clubSetupTabJoin" onclick="_clubSetupShowTab('join')">${t('joinClub') || 'Join Club'}</button>
        <button class="club-setup-tab" id="clubSetupTabCreate" onclick="_clubSetupShowTab('create')">${t('createClub') || 'Create Club'}</button>
      </div>

      <!-- JOIN PANEL -->
      <div id="clubSetupPanelJoin" style="margin-top:14px">
        <input type="text" id="csJoinSearch" class="auth-input" placeholder="🔍 ${t('searchClubPlaceholder') || 'Search Club...'}" style="margin-bottom:6px" oninput="_clubSetupSearch(this.value)">
        <div id="csJoinResults" style="display:none;max-height:160px;overflow-y:auto;border-radius:10px;border:1px solid var(--border);margin-bottom:8px;background:var(--surface2)"></div>
        <div id="csJoinSelected" style="display:none;padding:8px 12px;border-radius:8px;background:rgba(108,99,255,0.1);border:1px solid rgba(108,99,255,0.3);margin-bottom:8px;font-size:0.85rem;color:var(--text)"></div>
        <input type="password" id="csJoinPassword" class="auth-input" placeholder="${joinPasswordPh}" style="margin-bottom:10px">
        <div id="csJoinNicknameWrap" style="display:none;margin-bottom:10px">
          <div id="csJoinNicknameMsg" style="font-size:0.8rem;color:var(--text-dim);margin:0 2px 6px;line-height:1.4"></div>
          <input type="text" id="csJoinNickname" class="auth-input" placeholder="Nickname for this club" autocomplete="nickname">
        </div>
        <div id="csJoinFeedback" style="font-size:0.82rem;color:var(--red);min-height:18px;margin-bottom:10px"></div>
        <div style="display:flex;gap:10px">
          <button class="admin-modal-cancel" style="flex:1" onclick="_clubSetupClose(true)">${t('cancel') || 'Cancel'}</button>
          <button class="admin-modal-ok" style="flex:1" onclick="_clubSetupJoin()">${t('joinBtn') || 'Join'}</button>
        </div>
      </div>

      <!-- CREATE PANEL -->
      <div id="clubSetupPanelCreate" style="display:none;margin-top:14px">
        <div id="clubSetupPanelCreateForm">
          <input type="text"     id="csCreateName"    class="auth-input" placeholder="${t('clubNamePh')}"      style="margin-bottom:8px">
          <input type="password" id="csCreateAdminPw" class="auth-input" placeholder="${t('enterAdminPasswordPh')}"  style="margin-bottom:10px">
          <div id="csCreateFeedback" style="font-size:0.82rem;min-height:18px;margin-bottom:10px"></div>
          <div style="display:flex;gap:10px">
            <button class="admin-modal-cancel" style="flex:1" onclick="_clubSetupClose(true)">${t('cancel') || 'Cancel'}</button>
            <button class="admin-modal-ok" style="flex:1" onclick="_clubSetupCreateDirect()">${t('createClub') || 'Create Club'}</button>
          </div>
        </div>
      </div>
    </div>
  `;
  overlay.addEventListener('click', e => { if (e.target === overlay) _clubSetupClose(true); });
  document.body.appendChild(overlay);
  document.getElementById('clubSetupSheet').addEventListener('click', e => e.stopPropagation());

  // Load clubs for join dropdown
  _clubSetupLoadClubs();
}

function _clubSetupShowTab(tab) {
  document.getElementById('clubSetupTabJoin').classList.toggle('active', tab === 'join');
  document.getElementById('clubSetupTabCreate').classList.toggle('active', tab === 'create');
  document.getElementById('clubSetupPanelJoin').style.display   = tab === 'join'   ? '' : 'none';
  document.getElementById('clubSetupPanelCreate').style.display = tab === 'create' ? '' : 'none';
  // Reset create form
  if (tab === 'create') {
    _clubSetupCreateEmail = '';
  }
}

var _clubSetupSelectedId   = null;
var _clubSetupSelectedName = null;
var _clubSetupSearchTimer  = null;

function _clubSetupSearch(query) {
  var resultsEl = document.getElementById('csJoinResults');
  var selectedEl = document.getElementById('csJoinSelected');
  // Clear selection when user types again
  _clubSetupSelectedId = null;
  _clubSetupSelectedName = null;
  if (selectedEl) selectedEl.style.display = 'none';

  if (!query || query.trim().length < 2) {
    if (resultsEl) resultsEl.style.display = 'none';
    return;
  }
  if (resultsEl) {
    resultsEl.style.display = 'block';
    resultsEl.innerHTML = '<div style="padding:10px 12px;font-size:0.82rem;color:var(--muted)">Searching...</div>';
  }
  clearTimeout(_clubSetupSearchTimer);
  _clubSetupSearchTimer = setTimeout(async function() {
    try {
      var rows = await sbGet('clubs', 'name=ilike.' + encodeURIComponent('%' + query.trim() + '%') + '&select=id,name&order=name.asc&limit=15');
      if (!rows || !rows.length) {
        if (resultsEl) resultsEl.innerHTML = '<div style="padding:10px 12px;font-size:0.82rem;color:var(--muted)">No clubs found</div>';
        return;
      }
      if (resultsEl) {
        resultsEl.innerHTML = rows.map(function(c) {
          return '<div onclick="_clubSetupSelectClub(\'' + c.id + '\',\'' + c.name.replace(/'/g,"\\'") + '\')" ' +
            'class="club-setup-search-result" role="button" tabindex="0">' +
            '<span class="club-setup-result-icon">🏢</span><span class="club-setup-result-name">' + c.name + '</span><span class="club-setup-result-action">' + t('selectAction') + '</span></div>';
        }).join('');
      }
      var exactMatches = rows.filter(function(c) {
        return String(c.name || '').trim().toLowerCase() === query.trim().toLowerCase();
      });
      if (exactMatches.length === 1) {
        _clubSetupSelectClub(exactMatches[0].id, exactMatches[0].name);
      }
    } catch(e) {
      if (resultsEl) resultsEl.innerHTML = '<div style="padding:10px 12px;font-size:0.82rem;color:var(--red)">Search failed</div>';
    }
  }, 350);
}

function _clubSetupSelectClub(id, name) {
  _clubSetupSelectedId   = id;
  _clubSetupSelectedName = name;
  var resultsEl  = document.getElementById('csJoinResults');
  var selectedEl = document.getElementById('csJoinSelected');
  var searchEl   = document.getElementById('csJoinSearch');
  if (resultsEl)  resultsEl.style.display = 'none';
  if (searchEl)   searchEl.value = name;
  if (selectedEl) {
    selectedEl.classList.add('club-setup-selected-confirmation');
    selectedEl.replaceChildren();
    var selectedCheck = document.createElement('span');
    selectedCheck.className = 'club-setup-selected-check';
    selectedCheck.textContent = '✓';
    var selectedCopy = document.createElement('span');
    selectedCopy.className = 'club-setup-selected-copy';
    var selectedLabel = document.createElement('small');
    selectedLabel.textContent = t('selectedClub');
    var selectedName = document.createElement('strong');
    selectedName.textContent = name;
    selectedCopy.append(selectedLabel, selectedName);
    selectedEl.append(selectedCheck, selectedCopy);
    selectedEl.style.display = 'flex';
  }
  var feedback = document.getElementById('csJoinFeedback');
  if (feedback) feedback.textContent = '';
  var nickWrap = document.getElementById('csJoinNicknameWrap');
  var nickInput = document.getElementById('csJoinNickname');
  if (nickWrap) nickWrap.style.display = 'none';
  if (nickInput) nickInput.value = '';
  // Focus password field
  var pw = document.getElementById('csJoinPassword');
  if (pw) pw.focus();
}

async function _clubSetupLoadClubs() {
  // No-op — replaced by search
}

async function _clubSetupJoin() {
  const pwInput = document.getElementById('csJoinPassword');
  const fb = document.getElementById('csJoinFeedback');
  const setFb = (msg, ok) => { if (fb) { fb.textContent = msg; fb.style.color = ok ? '#2dce89' : '#e63757'; } };

  if (!_clubSetupSelectedId) { setFb(t('pleaseSelectClubDot'), false); return; }
  const pw = pwInput ? pwInput.value.trim() : '';
  if (!pw) { setFb(t('enterClubPassword'), false); return; }

  setFb(t('checkingDot'), true);
  try {
    const encodedPw = encodeURIComponent(pw);
    const asAdmin = await sbGet('clubs', `id=eq.${_clubSetupSelectedId}&admin_password=eq.${encodedPw}&select=id,name`);
    const asUser  = await sbGet('clubs', `id=eq.${_clubSetupSelectedId}&select_password=eq.${encodedPw}&select=id,name`);

    if (!asAdmin.length && !asUser.length) throw new Error(t('wrongPasswordDot'));

    let role = asAdmin.length ? 'admin' : 'user';
    const clubs = asAdmin.length ? asAdmin : asUser;

    // Enforce mode-specific password rules before proceeding
    if (_clubSetupTargetMode === 'organiser' && role === 'admin') {
      throw new Error('Organiser requires the member password, not the admin password.');
    }
    if (_clubSetupTargetMode === 'vault' && role === 'user') {
      throw new Error('Vault requires the admin password, not the member password.');
    }

    // An explicit successful Round Manager or Slot Manager club login also
    // establishes the signed-in user's player membership in that club. Use
    // the account nickname when it is free; otherwise stop here and ask for
    // a different nickname for this club before entering the workspace.
    if ((_clubSetupTargetMode === 'vault' || _clubSetupTargetMode === 'organiser_guest') &&
        typeof ensureClubManagerPlayerMembership === 'function') {
      var nicknameInput = document.getElementById('csJoinNickname');
      var chosenNickname = nicknameInput ? nicknameInput.value.trim() : '';
      var membershipResult = await ensureClubManagerPlayerMembership(
        typeof authGetUser === 'function' ? authGetUser() : null,
        clubs[0].id,
        chosenNickname
      );
      if (membershipResult && membershipResult.needsNickname) {
        var nicknameWrap = document.getElementById('csJoinNicknameWrap');
        var nicknameMsg = document.getElementById('csJoinNicknameMsg');
        if (nicknameWrap) nicknameWrap.style.display = '';
        if (nicknameMsg) nicknameMsg.textContent = membershipResult.nicknameConflict
          ? '“' + (membershipResult.suggestedNickname || '') + '” is already used in this club. Choose a different nickname.'
          : 'Choose a nickname for this club.';
        if (nicknameInput) {
          if (!chosenNickname && membershipResult.suggestedNickname) nicknameInput.value = membershipResult.suggestedNickname;
          nicknameInput.focus();
          nicknameInput.select();
        }
        setFb('Choose a different nickname for this club.', false);
        return;
      }
      if (!membershipResult) throw new Error('Could not add you to this club.');
    }

    const guestOrganiser = _clubSetupTargetMode === 'organiser_guest';
    if (!guestOrganiser) await saveUserClubRole(clubs[0].id, _clubSetupTargetMode);

    if (typeof setMyClub === 'function') setMyClub(clubs[0].id, clubs[0].name);
    if (_clubSetupTargetMode === 'vault' || _clubSetupTargetMode === 'organiser' || guestOrganiser) {
      syncRoundAndSlotManagerClub(clubs[0].id, clubs[0].name || '');
    }
    localStorage.setItem('kbrr_club_mode', role);
    localStorage.setItem('kbrr_rating_field', 'club_rating');

    // Restore the selected workspace grant immediately
    // and redraw the Welcome tiles so their logout buttons are current
    // without requiring the manual Welcome refresh button.
    if (!guestOrganiser && typeof restoreUserClubRoles === 'function') {
      await restoreUserClubRoles(typeof authGetUser === 'function' ? authGetUser() : null);
    }
    if (typeof updateWelcomeWorkspaceClubNames === 'function') {
      updateWelcomeWorkspaceClubNames();
    }

    if (pwInput) pwInput.value = '';

    setFb(role === 'admin' ? t('joinedAsAdmin') : t('joinedSuccessfully'), true);

    // Small delay so user sees success, then enter the mode
    setTimeout(() => {
      const ov = document.getElementById('clubSetupSheetOverlay');
      if (ov) ov.remove();
      if (typeof clubLoginRefresh === 'function') clubLoginRefresh();
      if (typeof syncToLocal === 'function') syncToLocal();

      const mode = _clubSetupTargetMode;
      if (mode === 'vault') {
        sessionStorage.setItem('scs_vault_verified', '1');
        localStorage.setItem('scs_vault_verified', '1');
        appMode = 'vault';
        sessionStorage.setItem('appMode', 'vault');
        localStorage.setItem('kbrr_app_mode', 'vault');
        applyMode('vault');
        updateModePill('vault');
        if (!_clubSetupClose(true) && typeof showHomeScreen === 'function') showHomeScreen();
      } else if (mode === 'organiser' || mode === 'organiser_guest') {
        // Organiser accepts user or admin password
        sessionStorage.setItem('scs_organiser_verified', '1');
        if (mode === 'organiser') localStorage.setItem('scs_organiser_verified', '1');
        appMode = 'organiser';
        sessionStorage.setItem('appMode', 'organiser');
        localStorage.setItem('kbrr_app_mode', 'organiser');
        applyMode('organiser');
        updateModePill('organiser');
        if (!_clubSetupClose(true) && typeof showHomeScreen === 'function') {
          showHomeScreen();
          setTimeout(function() {
            scsOpenPlayersManagerWhenRoundManagerEmpty(clubs[0].id).catch(function(error) {
              console.warn('Round Manager initial Players page skipped:', error);
            });
          }, 0);
        }
      }
    }, 700);
  } catch(e) { setFb('❌ ' + e.message, false); }
}

async function _clubSetupCreateSendOtp() { _clubSetupCreateDirect(); } // legacy alias
async function _clubSetupCreateResend()  { } // no longer needed

async function _clubSetupCreateVerify() { _clubSetupCreateDirect(); } // legacy alias

async function _clubSetupCreateDirect() {
  const name    = document.getElementById('csCreateName')?.value.trim();
  const adminPw = document.getElementById('csCreateAdminPw')?.value.trim();
  const fb      = document.getElementById('csCreateFeedback');
  const setFb   = (msg, ok) => { if (fb) { fb.textContent = msg; fb.style.color = ok ? '#2dce89' : '#e63757'; } };

  if (!name)    { setFb(t('enterClubName'), false); return; }
  if (!adminPw) { setFb(t('enterAdminPw'), false); return; }

  setFb(t('creatingClubDot'), true);
  try {
    const club = await dbAddClub(name, null, adminPw);
    if (typeof setMyClub === 'function') setMyClub(club.id, club.name);
    if (_clubSetupTargetMode === 'vault' || _clubSetupTargetMode === 'organiser') {
      syncRoundAndSlotManagerClub(club.id, club.name || '');
    }
    localStorage.setItem('kbrr_club_mode', 'admin');
    localStorage.setItem('kbrr_rating_field', 'club_rating');
    setFb('✅ ' + club.name + ' ' + t('clubCreatedAdmin'), true);
    await saveUserClubRole(club.id, _clubSetupTargetMode);

    // Keep the Welcome workspace cards synchronized immediately after a new
    // management club is created; do not wait for a manual refresh.
    if (typeof restoreUserClubRoles === 'function') {
      await restoreUserClubRoles(typeof authGetUser === 'function' ? authGetUser() : null);
    }
    if (typeof updateWelcomeWorkspaceClubNames === 'function') {
      updateWelcomeWorkspaceClubNames();
    }

    setTimeout(() => {
      const ov = document.getElementById('clubSetupSheetOverlay');
      if (ov) ov.remove();
      if (typeof clubLoginRefresh === 'function') clubLoginRefresh();
      if (typeof syncToLocal === 'function') syncToLocal();

      const mode = _clubSetupTargetMode;
      // Creator is always admin
      if (mode === 'vault') { sessionStorage.setItem('scs_vault_verified', '1'); localStorage.setItem('scs_vault_verified', '1'); }
      if (mode === 'organiser') { sessionStorage.setItem('scs_organiser_verified', '1'); localStorage.setItem('scs_organiser_verified', '1'); }
      appMode = mode;
      sessionStorage.setItem('appMode', mode);
      localStorage.setItem('kbrr_app_mode', mode);
      applyMode(mode);
      if (!_clubSetupClose(true) && typeof showHomeScreen === 'function') showHomeScreen();
    }, 1000);
  } catch(e) { setFb('❌ ' + e.message, false); }
}

function _showVaultPasswordPrompt() {
  const existing = document.getElementById('vaultPromptOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'vaultPromptOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.6);display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(4px)';
  overlay.innerHTML = `
    <div class="vault-pw-sheet" id="vaultPwSheet">
      <div class="mode-sheet-handle"></div>
      <div class="mode-sheet-title">🔑 Vault Manager</div>
      <p style="font-size:0.84rem;color:var(--text-dim);margin-bottom:16px;line-height:1.5">
        Enter your club password (member or admin) to access Vault Manager.
      </p>
      <input type="password" id="vaultPwInput" class="admin-password-input"
             placeholder="${t('enterAdminPasswordPh')}"
             onkeydown="if(event.key==='Enter')verifyVaultPassword()"
             style="margin-bottom:12px;width:100%">
      <div id="vaultPwError" style="font-size:0.82rem;color:var(--red);min-height:18px;margin-bottom:12px"></div>
      <div style="display:flex;gap:10px">
        <button class="admin-modal-cancel" style="flex:1"
                onclick="document.getElementById('vaultPromptOverlay').remove()">Cancel</button>
        <button class="admin-modal-ok" style="flex:1"
                onclick="verifyVaultPassword()">Enter Vault</button>
      </div>
    </div>
  `;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  document.getElementById('vaultPwSheet').addEventListener('click', e => e.stopPropagation());
  setTimeout(() => document.getElementById('vaultPwInput')?.focus(), 100);
}

async function verifyVaultPassword() {
  const input = document.getElementById('vaultPwInput');
  const errEl = document.getElementById('vaultPwError');
  const pw    = (input ? input.value : '').trim();
  if (!pw) { if (errEl) errEl.textContent = t('enterAdminPasswordHint'); return; }

  const club = (typeof getMyClub === 'function') ? getMyClub() : null;
  if (!club || !club.id) { if (errEl) errEl.textContent = t('noClubSelected'); return; }

  if (errEl) errEl.textContent = t('checkingDotDot');
  try {
    const adminRows = await sbGet('clubs', `id=eq.${club.id}&admin_password=eq.${encodeURIComponent(pw)}&select=id`);
    const userRows  = await sbGet('clubs', `id=eq.${club.id}&select_password=eq.${encodeURIComponent(pw)}&select=id`);
    if ((!adminRows || !adminRows.length) && (!userRows || !userRows.length)) {
      if (errEl) errEl.textContent = t('wrongAdminPw');
      if (input) input.value = '';
      return;
    }
    const role = (adminRows && adminRows.length) ? 'admin' : 'user';
    localStorage.setItem('kbrr_club_mode', role);
    await saveUserClubRole(club.id, 'vault');
    const ov = document.getElementById('vaultPromptOverlay');
    if (ov) ov.remove();
    localStorage.setItem('scs_vault_verified', '1');
    switchMode('vault');
  } catch(e) {
    if (errEl) errEl.textContent = t('errorPrefix') + e.message;
  }
}

/* =============================================================
   POWER BUTTON -- End Session
============================================================= */
async function endSession(fromProfile = false) {
  // Show shuttle cost sheet instead of plain confirm
  showShuttleSheet();
}

function showShuttleSheet() {
  const existing = document.getElementById('shuttleSheetOverlay');
  if (existing) existing.remove();

  const playerCount = (typeof schedulerState !== 'undefined') ? schedulerState.allPlayers.length : 0;

  const overlay = document.createElement('div');
  overlay.id = 'shuttleSheetOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:flex-end;';
  overlay.innerHTML = `
    <div class="shuttle-sheet" id="shuttleSheet">
      <div class="shuttle-handle"></div>
      <div class="shuttle-title">💰 ${t('sessionCost')}</div>

      <div class="shuttle-mode-toggle">
        <button class="shuttle-mode-btn active" id="shuttleModeA" onclick="shuttleSwitchMode('itemized')">📋 ${t('itemized')}</button>
        <button class="shuttle-mode-btn" id="shuttleModeB" onclick="shuttleSwitchMode('flat')">💴 ${t('flatFee')}</button>
      </div>

      <!-- Itemized mode -->
      <div id="shuttleModeItemized">
        <div class="shuttle-2col">
          <div class="shuttle-input-group">
            <div class="shuttle-input-label">🪶 ${t('pricePerTube')}</div>
            <input type="number" id="shuttleTubePrice" class="shuttle-input" placeholder="e.g. 6000" oninput="shuttleCalc()">
          </div>
          <div class="shuttle-input-group">
            <div class="shuttle-input-label">🏸 ${t('shuttlesUsed')}</div>
            <input type="number" id="shuttleCount" class="shuttle-input" placeholder="e.g. 16" oninput="shuttleCalc()">
          </div>
        </div>
        <div class="shuttle-divider"><div class="shuttle-div-line"></div><span class="shuttle-div-txt">${t('optional')}</span><div class="shuttle-div-line"></div></div>
        <div class="shuttle-input-group">
          <div class="shuttle-input-label">🏟 ${t('courtFeeTotal')}</div>
          <input type="number" id="shuttleCourtFee" class="shuttle-input" placeholder="¥0" oninput="shuttleCalc()">
        </div>
        <div class="shuttle-input-group" style="margin-top:8px">
          <div class="shuttle-input-label">📦 ${t('miscFeeTotal')}</div>
          <input type="number" id="shuttleMiscFee" class="shuttle-input" placeholder="¥0" oninput="shuttleCalc()">
        </div>
      </div>

      <!-- Flat fee mode -->
      <div id="shuttleModeFlat" style="display:none">
        <div class="shuttle-input-group" style="margin-top:4px">
          <div class="shuttle-input-label">💴 ${t('amountPerPlayer')}</div>
          <input type="number" id="shuttleFlatFee" class="shuttle-input shuttle-input-lg" placeholder="¥0" oninput="shuttleCalc()">
        </div>
      </div>

      <!-- Calc result -->
      <div class="shuttle-calc-box" id="shuttleCalcBox" style="display:none">
        <div class="shuttle-calc-row" id="shuttleCalcShuttles" style="display:none">
          <span class="shuttle-calc-label">🪶 ${t('shuttlesLabel')}</span>
          <span class="shuttle-calc-val" id="shuttleCostShuttles">--</span>
        </div>
        <div class="shuttle-calc-row" id="shuttleCalcCourt" style="display:none">
          <span class="shuttle-calc-label">🏟 ${t('courtLabel')}</span>
          <span class="shuttle-calc-val" id="shuttleCostCourt">--</span>
        </div>
        <div class="shuttle-calc-row" id="shuttleCalcMisc" style="display:none">
          <span class="shuttle-calc-label">📦 ${t('miscLabel')}</span>
          <span class="shuttle-calc-val" id="shuttleCostMisc">--</span>
        </div>
        <div class="shuttle-calc-row shuttle-calc-total">
          <span class="shuttle-calc-label">${t('perPlayerLabel')} (${playerCount})</span>
          <span class="shuttle-calc-val shuttle-calc-big" id="shuttleCostPerPlayer">--</span>
        </div>
      </div>

      <button onclick="confirmEndSession()"
        style="width:100%;padding:15px;background:linear-gradient(135deg,#e63757,#c42444);color:#fff;border:none;border-radius:14px;font-size:1rem;font-weight:800;cursor:pointer;font-family:inherit;margin-top:10px;letter-spacing:0.02em;box-shadow:0 4px 16px rgba(230,55,87,0.35);">
        ⏹ ${t('endSession')}
      </button>
      <button onclick="skipShuttleAndEnd()"
        style="width:100%;padding:10px;background:none;border:none;color:var(--muted,#888);font-size:0.8rem;cursor:pointer;font-family:inherit;margin-top:4px;opacity:0.7;">
        ${t('skipEndWithoutCost')}
      </button>
    </div>`;

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  document.getElementById('shuttleSheet').addEventListener('click', e => e.stopPropagation());
}

function shuttleSwitchMode(mode) {
  const isItemized = mode === 'itemized';
  document.getElementById('shuttleModeItemized').style.display = isItemized ? '' : 'none';
  document.getElementById('shuttleModeFlat').style.display     = isItemized ? 'none' : '';
  document.getElementById('shuttleModeA').classList.toggle('active', isItemized);
  document.getElementById('shuttleModeB').classList.toggle('active', !isItemized);
  document.getElementById('shuttleCalcBox').style.display = 'none';
}

function shuttleCalc() {
  const players = (typeof schedulerState !== 'undefined') ? schedulerState.allPlayers.length : 0;
  const isFlat  = document.getElementById('shuttleModeFlat')?.style.display !== 'none';

  if (isFlat) {
    const flat = parseFloat(document.getElementById('shuttleFlatFee')?.value) || 0;
    if (!flat) { document.getElementById('shuttleCalcBox').style.display = 'none'; return; }
    document.getElementById('shuttleCalcBox').style.display = '';
    document.getElementById('shuttleCalcShuttles').style.display = 'none';
    document.getElementById('shuttleCalcCourt').style.display    = 'none';
    document.getElementById('shuttleCalcMisc').style.display     = 'none';
    document.getElementById('shuttleCostPerPlayer').textContent  = '¥' + Math.round(flat).toLocaleString();
    return;
  }

  // Itemized
  const tubePrice  = parseFloat(document.getElementById('shuttleTubePrice')?.value) || 0;
  const count      = parseFloat(document.getElementById('shuttleCount')?.value) || 0;
  const courtFee   = parseFloat(document.getElementById('shuttleCourtFee')?.value) || 0;
  const miscFee    = parseFloat(document.getElementById('shuttleMiscFee')?.value) || 0;

  const shuttleCost = tubePrice && count ? (tubePrice / 12) * count : 0;
  const total       = shuttleCost + courtFee + miscFee;
  const perPlayer   = players > 0 ? total / players : 0;

  if (!total) { document.getElementById('shuttleCalcBox').style.display = 'none'; return; }

  document.getElementById('shuttleCalcBox').style.display = '';

  const showRow = (rowId, valId, val) => {
    document.getElementById(rowId).style.display = val > 0 ? '' : 'none';
    if (val > 0) document.getElementById(valId).textContent = '¥' + Math.round(val / players).toLocaleString() + '/player';
  };
  showRow('shuttleCalcShuttles', 'shuttleCostShuttles', shuttleCost);
  showRow('shuttleCalcCourt',    'shuttleCostCourt',    courtFee);
  showRow('shuttleCalcMisc',     'shuttleCostMisc',     miscFee);
  document.getElementById('shuttleCostPerPlayer').textContent = '¥' + Math.round(perPlayer).toLocaleString();
}

async function confirmEndSession() {
  const players  = (typeof schedulerState !== 'undefined') ? schedulerState.allPlayers.length : 0;
  const isFlat   = document.getElementById('shuttleModeFlat')?.style.display !== 'none';
  let shuttleData = null;

  if (isFlat) {
    const flat = parseFloat(document.getElementById('shuttleFlatFee')?.value) || 0;
    if (flat) shuttleData = { mode: 'flat', cost_per_player: Math.round(flat), player_count: players };
  } else {
    const tubePrice = parseFloat(document.getElementById('shuttleTubePrice')?.value) || 0;
    const count     = parseFloat(document.getElementById('shuttleCount')?.value) || 0;
    const courtFee  = parseFloat(document.getElementById('shuttleCourtFee')?.value) || 0;
    const miscFee   = parseFloat(document.getElementById('shuttleMiscFee')?.value) || 0;
    const shuttleCost = tubePrice && count ? (tubePrice / 12) * count : 0;
    const total       = shuttleCost + courtFee + miscFee;
    const perPlayer   = players > 0 ? Math.round(total / players) : 0;
    if (total) shuttleData = {
      mode: 'itemized',
      tube_price: tubePrice, shuttles_used: count,
      court_fee: courtFee,   misc_fee: miscFee,
      total_cost: Math.round(total),
      cost_per_player: perPlayer,
      player_count: players
    };
  }

  document.getElementById('shuttleSheetOverlay')?.remove();
  await _doEndSession(shuttleData);
}

/* ── Edit Session Cost (organiser only) ── */
function showEditCostSheet(sessionId, existingData, sessionPlayers) {
  const existing = document.getElementById('editCostOverlay');
  if (existing) existing.remove();

  const isFlat    = !existingData || existingData.mode === 'flat';
  const flatVal   = existingData?.cost_per_player || '';
  const tubePrice = existingData?.tube_price       || '';
  const shuttles  = existingData?.shuttles_used    || '';
  const courtFee  = existingData?.court_fee        || '';
  const miscFee   = existingData?.misc_fee         || '';
  const players   = (sessionPlayers && sessionPlayers.length) ? sessionPlayers.length : (existingData?.player_count || 0);

  const overlay = document.createElement('div');
  overlay.id = 'editCostOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:flex-end;';
  overlay.innerHTML = `
    <div class="shuttle-sheet" id="editCostSheet">
      <div class="shuttle-handle"></div>
      <div class="shuttle-title">✏️ ${t('editSessionCost')}</div>
      <div class="shuttle-mode-toggle">
        <button class="shuttle-mode-btn ${isFlat?'':'active'}" id="editModeA" onclick="editCostSwitchMode('itemized')">📋 ${t('itemized')}</button>
        <button class="shuttle-mode-btn ${isFlat?'active':''}" id="editModeB" onclick="editCostSwitchMode('flat')">💴 ${t('flatFee')}</button>
      </div>
      <div id="editModeItemized" style="${isFlat?'display:none':''}">
        <div class="shuttle-2col">
          <div class="shuttle-input-group">
            <div class="shuttle-input-label">🪶 ${t('pricePerTube')}</div>
            <input type="number" id="editTubePrice" class="shuttle-input" value="${tubePrice}" placeholder="e.g. 6000" oninput="editCostCalc()">
          </div>
          <div class="shuttle-input-group">
            <div class="shuttle-input-label">🏸 ${t('shuttlesUsed')}</div>
            <input type="number" id="editShuttleCount" class="shuttle-input" value="${shuttles}" placeholder="e.g. 16" oninput="editCostCalc()">
          </div>
        </div>
        <div class="shuttle-input-group">
          <div class="shuttle-input-label">🏟 ${t('courtFeeTotal')}</div>
          <input type="number" id="editCourtFee" class="shuttle-input" value="${courtFee}" placeholder="¥0" oninput="editCostCalc()">
        </div>
        <div class="shuttle-input-group" style="margin-top:8px">
          <div class="shuttle-input-label">📦 ${t('miscFeeTotal')}</div>
          <input type="number" id="editMiscFee" class="shuttle-input" value="${miscFee}" placeholder="¥0" oninput="editCostCalc()">
        </div>
      </div>
      <div id="editModeFlat" style="${isFlat?'':'display:none'}">
        <div class="shuttle-input-group">
          <div class="shuttle-input-label">💴 ${t('amountPerPlayer')}</div>
          <input type="number" id="editFlatFee" class="shuttle-input shuttle-input-lg" value="${flatVal}" placeholder="¥0" oninput="editCostCalc()">
        </div>
      </div>
      <div class="shuttle-result" id="editCostResult"></div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button onclick="document.getElementById('editCostOverlay').remove()"
          style="flex:1;padding:14px;background:none;border:2px solid var(--border,#444);color:var(--text,#fff);border-radius:14px;font-size:1rem;font-weight:700;cursor:pointer;font-family:inherit;">
          ${t('cancel')}
        </button>
        <button onclick="saveEditedCost('${sessionId}', _editCostPlayers)"
          style="flex:2;padding:14px;background:linear-gradient(135deg,#6c63ff,#574fd6);color:#fff;border:none;border-radius:14px;font-size:1rem;font-weight:800;cursor:pointer;font-family:inherit;">
          💾 ${t('save')}
        </button>
      </div>
    </div>`;

  window._editCostPlayers = sessionPlayers || [];
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  editCostCalc();
}

function editCostSwitchMode(mode) {
  document.getElementById('editModeItemized').style.display = mode === 'itemized' ? '' : 'none';
  document.getElementById('editModeFlat').style.display     = mode === 'flat'     ? '' : 'none';
  document.getElementById('editModeA').classList.toggle('active', mode === 'itemized');
  document.getElementById('editModeB').classList.toggle('active', mode === 'flat');
  editCostCalc();
}

function editCostCalc() {
  const isFlat  = document.getElementById('editModeFlat')?.style.display !== 'none';
  const result  = document.getElementById('editCostResult');
  if (!result) return;
  if (isFlat) {
    const flat = parseFloat(document.getElementById('editFlatFee')?.value) || 0;
    result.innerHTML = flat ? `<span class="shuttle-per-player">¥${Math.round(flat).toLocaleString()} / player</span>` : '';
  } else {
    const tubePrice = parseFloat(document.getElementById('editTubePrice')?.value)    || 0;
    const count     = parseFloat(document.getElementById('editShuttleCount')?.value) || 0;
    const courtFee  = parseFloat(document.getElementById('editCourtFee')?.value)     || 0;
    const miscFee   = parseFloat(document.getElementById('editMiscFee')?.value)      || 0;
    const shuttle   = tubePrice && count ? (tubePrice / 12) * count : 0;
    const total     = shuttle + courtFee + miscFee;
    const pc        = window._editCostPlayers ? window._editCostPlayers.length : 0;
    const perPlayer = pc > 0 ? Math.round(total / pc) : 0;
    if (total) {
      result.innerHTML = `<span class="shuttle-per-player">Total ¥${Math.round(total).toLocaleString()}${pc ? ' · ¥' + perPlayer.toLocaleString() + '/player' : ''}</span>`;
    }
  }
}

async function saveEditedCost(sessionId, sessionPlayers) {
  const playerCount = Array.isArray(sessionPlayers) ? sessionPlayers.length : (sessionPlayers || 0);
  const isFlat = document.getElementById('editModeFlat')?.style.display !== 'none';
  let shuttleData = null;

  if (isFlat) {
    const flat = parseFloat(document.getElementById('editFlatFee')?.value) || 0;
    if (flat) shuttleData = { mode: 'flat', cost_per_player: Math.round(flat), player_count: playerCount };
  } else {
    const tubePrice = parseFloat(document.getElementById('editTubePrice')?.value)    || 0;
    const count     = parseFloat(document.getElementById('editShuttleCount')?.value) || 0;
    const courtFee  = parseFloat(document.getElementById('editCourtFee')?.value)     || 0;
    const miscFee   = parseFloat(document.getElementById('editMiscFee')?.value)      || 0;
    const shuttle   = tubePrice && count ? (tubePrice / 12) * count : 0;
    const total     = shuttle + courtFee + miscFee;
    const perPlayer = playerCount > 0 ? Math.round(total / playerCount) : 0;
    if (total) shuttleData = {
      mode: 'itemized', tube_price: tubePrice, shuttles_used: count,
      court_fee: courtFee, misc_fee: miscFee,
      total_cost: Math.round(total), cost_per_player: perPlayer, player_count: playerCount
    };
  }

  if (!shuttleData) { alert('Please enter cost details'); return; }

  try {
    // 1. Update sessions.shuttle_data
    await sbPatch('sessions', `id=eq.${sessionId}`, { shuttle_data: shuttleData });

    // 2. Update players.sessions[].cost_per_player matched by session_id
    const club = (typeof getMyClub === 'function') ? getMyClub() : null;
    if (club && club.id && Array.isArray(sessionPlayers) && sessionPlayers.length) {
      for (const p of sessionPlayers) {
        const name = p.name || p.player_name || '';
        if (!name) continue;
        try {
          const mrows = await sbGet('memberships',
            `club_id=eq.${club.id}&nickname=ilike.${encodeURIComponent(name)}&select=player_id`
          ).catch(() => []);
          if (!mrows || !mrows.length) continue;
          const prows = await sbGet('players',
            `id=eq.${mrows[0].player_id}&select=id,sessions`
          ).catch(() => []);
          if (!prows || !prows.length) continue;
          const existing = prows[0].sessions || [];
          // Match by session_id (new entries) — reliable even with multiple sessions per day
          const updated = existing.map(entry =>
            entry.session_id === sessionId
              ? { ...entry, cost_per_player: shuttleData.cost_per_player }
              : entry
          );
          // Only patch if something changed
          if (JSON.stringify(updated) !== JSON.stringify(existing)) {
            await sbPatch('players', `id=eq.${prows[0].id}`, { sessions: updated }).catch(() => {});
          }
        } catch(e) { /* silent per player */ }
      }
    }

    document.getElementById('editCostOverlay')?.remove();
    if (typeof renderDashboard === 'function') renderDashboard();
    _qcToast('✅ Cost updated — ¥' + shuttleData.cost_per_player.toLocaleString() + '/player');
  } catch(e) {
    alert('Failed to save: ' + e.message);
  }
}

async function skipShuttleAndEnd() {
  document.getElementById('shuttleSheetOverlay')?.remove();
  await _doEndSession(null);
}

async function _doEndSession(shuttleData) {
  // Build 823: the Rounds-page End button comes here directly.
  // Detect Offline Mode using the persistent in-progress flag, clear that lock,
  // and keep the prepared IndexedDB database untouched.
  const endingOfflineSession =
    window.SCSOfflineRounds &&
    (
      (typeof window.SCSOfflineRounds.hasSessionInProgress === 'function' &&
       window.SCSOfflineRounds.hasSessionInProgress()) ||
      (typeof window.SCSOfflineRounds.isActive === 'function' &&
       window.SCSOfflineRounds.isActive())
    );

  // Show ending feedback
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1a1a2e;color:#fff;padding:16px 24px;border-radius:14px;font-size:0.9rem;font-weight:700;z-index:99999;text-align:center;';
  toast.textContent = t('endingSession');
  document.body.appendChild(toast);

  if (endingOfflineSession) {
    // Offline play is local-only. End the local Offline session and unlock
    // Round Manager, but do not write the Offline session to the server.
    if (window.SCSOfflineRounds &&
        typeof window.SCSOfflineRounds.endSession === 'function') {
      await window.SCSOfflineRounds.endSession(shuttleData);
    }
  } else {
    // Normal online session completion stays exactly as before.
    if (typeof dbCompleteSession === 'function') await dbCompleteSession(shuttleData);

    // Flush live_sessions → players.sessions, then delete temp rows
    if (typeof flushLiveSession === 'function') await flushLiveSession();

    // Release session slots
    if (typeof dbReleaseMySession === 'function') await dbReleaseMySession();
  }

  // Clear local session state -- no reload
  localStorage.removeItem('schedulerState');
  localStorage.removeItem('allRounds');
  localStorage.removeItem('currentRoundIndex');
  sessionStorage.removeItem('kbrr_session_db_id');

  // Reset in-memory state
  if (typeof allRounds !== 'undefined') allRounds.length = 0;
  if (typeof schedulerState !== 'undefined') {
    schedulerState.activeplayers = [];
    schedulerState.allPlayers    = [];
    if (schedulerState.winCount)    schedulerState.winCount.clear();
    if (schedulerState.PlayedCount) schedulerState.PlayedCount.clear();
    if (schedulerState.restCount)   schedulerState.restCount.clear();
    schedulerState.mbmActive  = false;
    schedulerState.fixedPairs = [];
    schedulerState.fixedPairGameQueue     = null;
    schedulerState.fixedPairGameQueueHash = null;
    if (typeof clearFixedPairsUI        === 'function') clearFixedPairsUI();
    if (typeof updateFixedPairSelectors  === 'function') updateFixedPairSelectors();
  }

  // Stop heartbeat
  if (typeof stopSessionHeartbeat === 'function') stopSessionHeartbeat();

  // Reset round state machine
  if (typeof currentState !== 'undefined') currentState = 'idle';
  if (typeof roundActive  !== 'undefined') roundActive  = false;
  if (typeof sessionFinished !== 'undefined') sessionFinished = false;

  // Reset Next/Play button appearance
  const nextBtn  = document.getElementById('nextBtn');
  const btnText  = document.getElementById('btnText');
  const btnIcon  = nextBtn ? nextBtn.querySelector('.icon') : null;
  if (nextBtn)  { nextBtn.classList.add('start-state'); nextBtn.classList.remove('round-active','end'); }
  if (btnText)  { btnText.textContent = t('startGame') || 'Play'; }
  if (btnIcon)  { btnIcon.textContent = ' ▶'; }

  // Re-enable all disabled buttons
  document.querySelectorAll('.disabled').forEach(el => {
    el.style.pointerEvents = '';
    el.classList.remove('disabled');
  });

  // Hide live bar
  updateSessionLiveBar();

  // Remove toast
  toast.textContent = t('sessionEnded');
  setTimeout(() => toast.remove(), 1500);

  // Clear saved snapshot — session is done
  if (typeof clearSnapshot === 'function') clearSnapshot();

  // Clear player list UI
  if (typeof updatePlayerList === 'function') updatePlayerList();

  // Go home after the completed session.
  if (typeof showHomeScreen === 'function') {
    showHomeScreen();
  }

  // After ending an Offline session, return Round Manager to normal Round Mode.
  // Prepared Offline rounds remain available for a later new Offline session.
  if (endingOfflineSession && typeof orgSetSchedulingSlide === 'function') {
    setTimeout(function() { orgSetSchedulingSlide(0); }, 0);
  }
}

/* === SETTINGS TAB SWITCHER === */
function settingsShowTab(tab) {
  ["club","general"].forEach(t => {
    const el = document.getElementById("settingsTab" + t.charAt(0).toUpperCase() + t.slice(1));
    if (el) el.style.display = t === tab ? "" : "none";
    const btn = document.getElementById("settingsTab" + t.charAt(0).toUpperCase() + t.slice(1) + "Btn");
    if (btn) btn.classList.toggle("active", t === tab);
  });
}

// Close fixed pair picker on outside click
document.addEventListener("click", function(e) {
  if (typeof fpOpenPicker !== "undefined" && fpOpenPicker !== null) {
    if (!e.target.closest(".fp-picker-field") && !e.target.closest(".fp-dropdown")) {
      fpClosePicker(fpOpenPicker);
    }
  }
});


/* ── Tile Style System ── */
function setTileStyle(style) {
  // Color is now the single app tile style. Migrate any legacy preference.
  document.body.classList.remove('tile-style-glow','tile-style-color');
  document.body.classList.add('tile-style-color');
  localStorage.setItem('kbrr_tile_style', 'color');
}

function loadHomeStyle() {
  setTileStyle('color');
}


// Verify again whenever the installed PWA returns from the background.
// This catches a login takeover even when the two-minute poll was paused by iOS/Android.
document.addEventListener('visibilitychange', async function() {
  if (document.visibilityState !== 'visible') return;
  if (typeof authIsLoggedIn !== 'function' || !authIsLoggedIn()) return;
  if (typeof authVerifySession === 'function') {
    var validSession = await authVerifySession();
    if (!validSession) return;
  }
  if (typeof _startSessionWatch === 'function') _startSessionWatch();
});


/* Build 356 — swipe/keyboard support for the rotational Welcome carousel. */
(function initWelcomeWorkspaceCarousel() {
  function setup() {
    var carousel = document.getElementById('welcomeWorkspaceCarousel');
    if (!carousel || carousel.dataset.carouselReady === '1') return;
    carousel.dataset.carouselReady = '1';
    var modes = ['viewer', 'organiser', 'vault'];
    var touchStartX = null;

    function rotate(direction) {
      var current = modes.indexOf(welcomeSelectedWorkspace);
      if (current < 0) current = 0;
      var next = (current + direction + modes.length) % modes.length;
      welcomeCycleWorkspace(direction);
      var selected = carousel.querySelector('.welcome-workspace.active');
      if (selected) selected.focus({ preventScroll: true });
    }

    carousel.addEventListener('keydown', function(event) {
      if (event.key === 'ArrowLeft') { event.preventDefault(); rotate(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); rotate(1); }
    });
    carousel.addEventListener('touchstart', function(event) {
      touchStartX = event.changedTouches && event.changedTouches[0] ? event.changedTouches[0].clientX : null;
    }, { passive: true });
    carousel.addEventListener('touchend', function(event) {
      if (touchStartX === null || !event.changedTouches || !event.changedTouches[0]) return;
      var distance = event.changedTouches[0].clientX - touchStartX;
      touchStartX = null;
      if (Math.abs(distance) < 38) return;
      rotate(distance < 0 ? 1 : -1);
    }, { passive: true });

    welcomeSelectWorkspace(welcomeSelectedWorkspace || 'viewer');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
})();

/* Build 358 — Guided Functions: independent, one-time helper for each module. */
var _scsGuideRole = '';
var _scsGuideCurrentStep = null;
var _scsGuideChildPageId = '';
var _scsGuideOrigin = null;

function _scsGuideCaptureOrigin(){
  var modeOverlay=document.getElementById('modeSelectOverlay');
  var home=document.getElementById('homePageOverlay');
  var visiblePage='';
  document.querySelectorAll('.page').forEach(function(page){
    if(!visiblePage&&page.style.display!=='none'&&getComputedStyle(page).display!=='none')visiblePage=page.id||'';
  });
  _scsGuideOrigin={
    modeOverlayVisible:!!(modeOverlay&&getComputedStyle(modeOverlay).display!=='none'),
    homeVisible:!!(home&&getComputedStyle(home).display!=='none'),
    pageId:visiblePage
  };
}

function _scsGuideRestoreOrigin(){
  var origin=_scsGuideOrigin;
  _scsGuideOrigin=null;
  if(!origin)return;
  if(origin.modeOverlayVisible){
    if(typeof openModeSwitcher==='function'){openModeSwitcher();return;}
    var modeOverlay=document.getElementById('modeSelectOverlay');
    if(modeOverlay)modeOverlay.style.display='flex';
    return;
  }
  if(origin.homeVisible){
    if(typeof showHomeScreen==='function'){showHomeScreen();return;}
    var home=document.getElementById('homePageOverlay');
    if(home)home.style.display='flex';
    return;
  }
  if(origin.pageId&&document.getElementById(origin.pageId)){
    if(typeof homeHideScreen==='function')homeHideScreen();
    if(typeof showPage==='function')showPage(origin.pageId,null);
    else document.getElementById(origin.pageId).style.display='block';
    return;
  }
  if(typeof showHomeScreen==='function')showHomeScreen();
}
var _scsGuideConfig = {
  viewer: {
    accent:'#2767e8', icon:'🏸', title:'Let’s Set Up MyHub',
    subtitle:'A few guided actions will get you ready to join and play.',
    note:'This helper appears only for an incomplete Player module. It will not change another module.',
    steps:[
      {id:'nickname', title:'Nickname', desc:'Choose the name other players will see.'},
      {id:'gender', title:'Gender', desc:'Set your player gender for eligible slots.'},
      {id:'club', title:'Join a Club', desc:'Find your club and send a join request.'}
    ]
  },
  vault: {
    accent:'#20934b', icon:'🏢', title:'Let’s set up Club Manager',
    subtitle:'Connect your club, create a player and publish the first slot.',
    note:'Each completed action is detected automatically. Existing Club Manager users continue normally.',
    steps:[
      {id:'club', title:'Create / Join Your Club', desc:'Create a new club or connect to your existing club.'},
      {id:'player', title:'Create New Player', desc:'Register one new player for the club.'},
      {id:'slot', title:'Create Slot', desc:'Create and publish the club’s first slot.'}
    ]
  },
  organiser: {
    accent:'#6937d5', icon:'📅', title:'Let’s Set Up Round Manager',
    subtitle:'Choose a club, prepare its players, then start the round.',
    note:'A slot can start only when it becomes available 15 minutes before its scheduled time. The helper does not alter that rule.',
    steps:[
      {id:'joinClub', title:'Join a Club', desc:'Search for your club and send a join request.'},
      {id:'selectClub', title:'Select Club', desc:'Choose the club where you want to organise rounds.'},
      {id:'newPlayer', title:'Create New Player', desc:'Register the first player when this club has no players.'},
      {id:'players', title:'Add Players', desc:'Select at least four players for the round.'},
      {id:'round', title:'Start Round', desc:'Open the due slot and start when the existing 15-minute rule enables it.'}
    ]
  }
};
var _scsGuideJapanese = {
  viewer:{title:'マイハブを設定しましょう',subtitle:'いくつかの手順で、クラブへの参加とプレーの準備ができます。',steps:{nickname:['ニックネーム','他の選手に表示される名前を設定します。'],gender:['性別','参加可能なスロットを表示するため性別を設定します。'],club:['クラブに参加','クラブを検索して参加リクエストを送信します。']}},
  vault:{title:'スロット管理を設定しましょう',subtitle:'クラブに接続し、選手を登録して最初のスロットを公開します。',steps:{club:['クラブを作成・参加','新しいクラブを作成するか、既存のクラブに接続します。'],player:['新しい選手を登録','クラブに新しい選手を1人登録します。'],slot:['スロットを作成','クラブの最初のスロットを作成して公開します。']}},
  organiser:{title:'ラウンド管理を設定しましょう',subtitle:'クラブを選択し、選手を準備してラウンドを開始します。',steps:{joinClub:['クラブに参加','クラブを検索して参加リクエストを送信します。'],selectClub:['クラブを選択','ラウンドを運営するクラブを選択します。'],newPlayer:['新しい選手を登録','クラブに選手がいない場合、最初の選手を登録します。'],players:['選手を追加','ラウンドに参加する選手を4人以上選択します。'],round:['ラウンド開始','開始可能なスロットを開き、既存の15分前ルールに従って開始します。']}},
  guidedFunctions:'ガイド機能',genderTitle:'性別を選択',genderDesc:'参加可能なスロットを正しく表示するために使用します。',male:'男性',female:'女性',close:'閉じる',clubConnected:'クラブは接続済みです。',membershipAvailable:'クラブへの参加資格があります。',joinFirst:'先にクラブに参加してください。',selectFirst:'先にクラブを選択してください。',playersRegistered:'選手は登録済みです。',createPlayerFirst:'先に選手を登録してください。',selectFour:'先に4人以上の選手を選択してください。',optionalSettings:'ラウンド設定（任意）',optionalSettingsDesc:'固定ペア・方式・勝者記録',fixedPairs:'固定ペア',optional:'任意',roundAlgorithm:'ラウンド方式',algorithmDesc:'ゲームの生成方法を選択',standard:'標準',balanced:'バランス',markWinner:'勝者を記録',markWinnerDesc:'各ゲーム後に勝者を選択',pair:'ペア',pairs:'ペア'
};
function _scsGuideLanguage(){return localStorage.getItem('appLanguage')||'en';}
function _scsGuideText(key,fallback){return _scsGuideLanguage()==='jp'&&_scsGuideJapanese[key]!==undefined?_scsGuideJapanese[key]:fallback;}
function _scsGuideLocalConfig(role){
  var base=_scsGuideConfig[role];
  if(!base||_scsGuideLanguage()!=='jp')return base;
  var local=_scsGuideJapanese[role];
  return Object.assign({},base,{title:local.title,subtitle:local.subtitle,steps:base.steps.map(function(step){var words=local.steps[step.id];return Object.assign({},step,{title:words[0],desc:words[1]});})});
}
var _scsGuideOrganiserClubs=[];
var _scsGuideOrganiserClubsLoading=false;
var _scsGuideOrganiserClubsLoadedAt=0;
var _scsGuideOrganiserPlayers=[];
var _scsGuideOrganiserPlayersClubId='';
var _scsGuideOrganiserPlayersLoading=false;
var _scsGuideOrganiserPlayersLoadedAt=0;
function _scsGuideKey(role){ return 'scs_guided_functions_'+role; }
function _scsGuideHasPlayerName(){ var u=typeof authGetUser==='function'?authGetUser():null,p=typeof getMyPlayer==='function'?getMyPlayer():null;return !!((u&&(u.nickname||u.displayName))||(p&&(p.name||p.displayName||p.nickname))); }
function _scsGuideNormaliseGender(value){
  var g=String(value||'').trim().toLowerCase();
  if(g==='male'||g==='m'||g==='man'||g==='boy') return 'Male';
  if(g==='female'||g==='f'||g==='woman'||g==='girl') return 'Female';
  return '';
}
function _scsGuideHasGender(){
  var u=typeof authGetUser==='function'?authGetUser():null;
  var p=typeof getMyPlayer==='function'?getMyPlayer():null;
  var gender=_scsGuideNormaliseGender((u&&u.gender)||(p&&p.gender)||localStorage.getItem('scs_player_gender'));
  if(!gender) return false;

  // The logged-in account/profile is the source of truth. Keep the old
  // confirmation keys in sync so existing helper logic also recognises it.
  localStorage.setItem('scs_player_gender',gender);
  localStorage.setItem('scs_player_gender_confirmed','1');
  try{
    if(u){
      u.gender=gender;
      u.genderConfirmed=true;
      localStorage.setItem('auth_user',JSON.stringify(u));
    }
  }catch(e){}
  try{
    if(typeof setMyPlayer==='function'){
      setMyPlayer({name:(p&&p.name)||((u&&(u.nickname||u.displayName))||''),gender:gender});
    }
  }catch(e){}
  return true;
}
function _scsGuideHasClub(){ var c=typeof getMyClub==='function'?getMyClub():null;return !!(c&&c.id); }
function _scsGuideGetOrganiserClubs(){
  var hub=(window.__scsWelcomeHubData&&window.__scsWelcomeHubData.organiser)||{};
  var hubClubs=Array.isArray(hub.clubs)?hub.clubs:[];
  var combined=[].concat(_scsGuideOrganiserClubs||[],hubClubs||[]);
  var seen=new Set(),result=[];
  combined.forEach(function(club){
    var id=String((club&&club.id)||'');
    if(!id||seen.has(id))return;
    seen.add(id);result.push(club);
  });
  if(!result.length&&hasVerifiedWorkspaceRole('organiser')){
    var id=localStorage.getItem('kbrr_org_club_id')||'';
    if(id)result.push({id:id,name:localStorage.getItem('kbrr_org_club_name')||'',source:'cache'});
  }
  return result;
}
function _scsGuideOrganiserHasMembership(){return _scsGuideGetOrganiserClubs().length>0;}
function _scsGuideOrganiserSelectedClub(){
  var clubs=_scsGuideGetOrganiserClubs();
  var selected=String(window.__scsWelcomeOrganiserChoice||localStorage.getItem('kbrr_org_club_id')||'');
  if(!selected){
    var active=typeof getMyClub==='function'?getMyClub():null;
    selected=String((active&&active.id)||'');
  }
  return clubs.find(function(club){return String(club.id)===selected;})||null;
}
function _scsGuideOrganiserHasSelectedClub(){return !!_scsGuideOrganiserSelectedClub();}
function _scsGuideLoadOrganiserClubs(force){
  if(typeof getOrganiserEligibleClubs!=='function'||_scsGuideOrganiserClubsLoading)return;
  if(!force&&Date.now()-_scsGuideOrganiserClubsLoadedAt<5000)return;
  _scsGuideOrganiserClubsLoading=true;
  getOrganiserEligibleClubs().then(function(clubs){
    _scsGuideOrganiserClubs=Array.isArray(clubs)?clubs:[];
    _scsGuideOrganiserClubsLoadedAt=Date.now();
  }).catch(function(){
    _scsGuideOrganiserClubsLoadedAt=Date.now();
  }).finally(function(){
    _scsGuideOrganiserClubsLoading=false;
    var overlay=document.getElementById('scsGuidedFunctions');
    if(_scsGuideRole==='organiser'&&overlay&&!overlay.hidden)scsOpenGuidedFunctions('organiser');
  });
}
function _scsGuideOrganiserClubId(){
  var selected=_scsGuideOrganiserSelectedClub();
  if(selected&&selected.id)return String(selected.id);
  var active=typeof getMyClub==='function'?getMyClub():null;
  return String((active&&active.id)||'');
}
function _scsGuideRefreshOrganiserPlayers(force){
  if(typeof dbGetPlayers!=='function'||_scsGuideOrganiserPlayersLoading)return;
  var clubId=_scsGuideOrganiserClubId();
  if(!clubId){
    _scsGuideOrganiserPlayers=[];
    _scsGuideOrganiserPlayersClubId='';
    _scsGuideOrganiserPlayersLoadedAt=Date.now();
    return;
  }
  if(!force&&_scsGuideOrganiserPlayersClubId===clubId&&Date.now()-_scsGuideOrganiserPlayersLoadedAt<3000)return;
  _scsGuideOrganiserPlayersLoading=true;
  dbGetPlayers(!!force).then(function(players){
    // Ignore a late response if the user changed clubs while loading.
    if(_scsGuideOrganiserClubId()!==clubId)return;
    _scsGuideOrganiserPlayers=Array.isArray(players)?players:[];
    _scsGuideOrganiserPlayersClubId=clubId;
    _scsGuideOrganiserPlayersLoadedAt=Date.now();
  }).catch(function(){
    if(_scsGuideOrganiserClubId()===clubId){
      _scsGuideOrganiserPlayersLoadedAt=Date.now();
    }
  }).finally(function(){
    _scsGuideOrganiserPlayersLoading=false;
    var overlay=document.getElementById('scsGuidedFunctions');
    if(_scsGuideRole==='organiser'&&overlay&&!overlay.hidden)scsOpenGuidedFunctions('organiser');
  });
}
function _scsGuideHasPlayers(){
  var clubId=_scsGuideOrganiserClubId();
  var hasRegistered=!!(clubId&&_scsGuideOrganiserPlayersClubId===clubId&&_scsGuideOrganiserPlayers.length);
  var hasSession=!!(window.schedulerState&&Array.isArray(schedulerState.allPlayers)&&schedulerState.allPlayers.length);
  return hasRegistered||hasSession;
}
function _scsGuideSelectedPlayerCount(){
  if(!window.schedulerState)return 0;
  if(Array.isArray(schedulerState.activeplayers)&&schedulerState.activeplayers.length)return schedulerState.activeplayers.length;
  if(Array.isArray(schedulerState.allPlayers))return schedulerState.allPlayers.filter(function(player){return player&&player.active;}).length;
  return 0;
}
function _scsGuideHasEnoughPlayers(){return _scsGuideSelectedPlayerCount()>=4;}
function _scsGuideRestoreSelectedPlayers(){
  if(!window.schedulerState||!Array.isArray(schedulerState.allPlayers)||!schedulerState.activeplayers)return;

  var currentActive=Array.from(schedulerState.activeplayers||[]).map(function(name){return String(name||'').trim();}).filter(Boolean);
  var sourcePlayers=[];
  var sourceActive=[];

  // Assist can open before normal Organiser entry restores the current
  // session. Restore only its player slice, without changing rounds.
  if(!schedulerState.allPlayers.length||!currentActive.length){
    try{
      var snapshot=JSON.parse(localStorage.getItem('kbrr_snapshot')||'null');
      var savedState=snapshot&&snapshot.schedulerState;
      if(savedState&&Array.isArray(savedState.allPlayers)){
        sourcePlayers=savedState.allPlayers;
        sourceActive=Array.isArray(savedState.activeplayers)?savedState.activeplayers:[];
      }
    }catch(e){}
  }
  if(!sourcePlayers.length&&!schedulerState.allPlayers.length){
    try{
      var cached=JSON.parse(localStorage.getItem('schedulerPlayers')||'[]');
      if(Array.isArray(cached)){
        sourcePlayers=cached;
        sourceActive=cached.filter(function(player){return player&&player.active;}).map(function(player){return player.name;});
      }
    }catch(e){}
  }

  if(sourcePlayers.length&&!schedulerState.allPlayers.length){
    schedulerState.allPlayers.splice(0,schedulerState.allPlayers.length,...sourcePlayers.map(function(player){
      return Object.assign({},player);
    }));
  }
  if(sourceActive.length&&!currentActive.length){
    var activeKeys=new Set(sourceActive.map(function(name){return String(name||'').trim().toLowerCase();}).filter(Boolean));
    schedulerState.allPlayers.forEach(function(player){
      if(player&&player.name)player.active=activeKeys.has(String(player.name).trim().toLowerCase());
    });
    schedulerState.activeplayers.splice(
      0,
      schedulerState.activeplayers.length,
      ...schedulerState.allPlayers.filter(function(player){return player&&player.active;}).map(function(player){return player.name;}).reverse()
    );
  }

  // Repair a partial state where active names exist before player objects.
  var known=new Set(schedulerState.allPlayers.map(function(player){return String((player&&player.name)||'').trim().toLowerCase();}));
  var history=[];
  try{history=JSON.parse(localStorage.getItem('newImportHistory')||'[]');}catch(e){}
  Array.from(schedulerState.activeplayers||[]).forEach(function(name){
    var key=String(name||'').trim().toLowerCase();
    if(!key||known.has(key))return;
    var record=Array.isArray(history)?history.find(function(player){
      return String((player&&(player.displayName||player.name))||'').trim().toLowerCase()===key;
    }):null;
    schedulerState.allPlayers.push({
      name:String(name).trim(),
      gender:(record&&record.gender)||'Male',
      rating:(record&&(record.activeRating||record.rating))||1,
      activeRating:(record&&(record.activeRating||record.rating))||1,
      active:true
    });
    known.add(key);
  });
}
function _scsGuideStepDone(role,id){
  if(role==='viewer'){
    if(id==='joined') return typeof authIsLoggedIn==='function'&&authIsLoggedIn();
    if(id==='nickname') return _scsGuideHasPlayerName();
    if(id==='gender') return _scsGuideHasGender();
    if(id==='club') return _scsGuideHasClub();
  }
  if(role==='vault'){
    if(id==='club') return _scsGuideHasClub()||hasVerifiedWorkspaceRole('vault');
    if(id==='player') return _scsGuideHasPlayers();
    if(id==='slot') return false;
  }
  if(role==='organiser'){
    if(id==='joinClub') return _scsGuideOrganiserHasMembership();
    if(id==='selectClub') return _scsGuideOrganiserHasSelectedClub();
    if(id==='newPlayer') return _scsGuideOrganiserHasSelectedClub()&&_scsGuideHasPlayers();
    if(id==='players') return _scsGuideOrganiserHasSelectedClub()&&_scsGuideHasEnoughPlayers();
    if(id==='round') return false;
  }
  return false;
}

function scsGuideAskGender(){
  var old=document.getElementById('scsGuideGenderModal'); if(old)old.remove();
  var currentUser=typeof authGetUser==='function'?authGetUser():null;
  var currentPlayer=typeof getMyPlayer==='function'?getMyPlayer():null;
  var currentGender=_scsGuideNormaliseGender(
    (currentUser&&currentUser.gender)||(currentPlayer&&currentPlayer.gender)||localStorage.getItem('scs_player_gender')
  );
  var modal=document.createElement('div'); modal.id='scsGuideGenderModal'; modal.className='scs-guide-gender-modal';
  modal.innerHTML='<div class="scs-guide-gender-card"><button class="scs-guide-gender-close scs-popup-close-btn" type="button" aria-label="'+_scsGuideText('close','Close')+'">×</button><div class="scs-guide-gender-icon">🏸</div><h3>'+_scsGuideText('genderTitle','Select your gender')+'</h3><p>'+_scsGuideText('genderDesc','This helps SCS show the correct eligible slots.')+'</p><div class="scs-guide-gender-actions"><button type="button" data-gender="Male">♂ '+_scsGuideText('male','Male')+'</button><button type="button" data-gender="Female">♀ '+_scsGuideText('female','Female')+'</button></div></div>';
  document.body.appendChild(modal);
  modal.querySelectorAll('[data-gender]').forEach(function(btn){
    var selected=btn.getAttribute('data-gender')===currentGender;
    btn.classList.toggle('is-selected',selected);
    btn.setAttribute('aria-pressed',selected?'true':'false');
  });
  function close(){modal.remove();}
  modal.querySelector('.scs-guide-gender-close').onclick=close;
  modal.addEventListener('click',function(e){if(e.target===modal)close();});
  modal.querySelectorAll('[data-gender]').forEach(function(btn){btn.onclick=function(){
    var gender=btn.getAttribute('data-gender');
    localStorage.setItem('scs_player_gender',gender); localStorage.setItem('scs_player_gender_confirmed','1');
    try{var u=typeof authGetUser==='function'?authGetUser():null;if(u){u.gender=gender;u.genderConfirmed=true;localStorage.setItem('auth_user',JSON.stringify(u));}}catch(e){}
    try{var p=typeof getMyPlayer==='function'?getMyPlayer():null;if(typeof setMyPlayer==='function')setMyPlayer({name:(p&&p.name)||(_scsGuideHasPlayerName()&&((authGetUser()||{}).nickname))||'',gender:gender});}catch(e){}
    close(); setTimeout(function(){scsOpenGuidedFunctions('viewer');},120);
  };});
}

function scsMigrateExistingGuides(){
  if(localStorage.getItem('scs_guided_functions_migrated_357')) return;
  if((typeof authIsLoggedIn==='function'&&authIsLoggedIn()) && _scsGuideHasPlayerName() && _scsGuideHasGender() && _scsGuideHasClub()) localStorage.setItem(_scsGuideKey('viewer'),'complete');
  if(typeof hasVerifiedWorkspaceRole==='function'&&hasVerifiedWorkspaceRole('organiser')) localStorage.setItem(_scsGuideKey('organiser'),'complete');
  if(typeof hasVerifiedWorkspaceRole==='function'&&hasVerifiedWorkspaceRole('vault')) localStorage.setItem(_scsGuideKey('vault'),'complete');
  localStorage.setItem('scs_guided_functions_migrated_357','1');
}
function scsMaybeShowGuidedFunctions(role){
  // Retained as a compatibility no-op for older callers. Guided Functions
  // open only from an explicit Assist action via scsOpenGuidedFunctions().
  return false;
}
function scsGuideOpenFixedPairs(){
  _scsGuideRestoreSelectedPlayers();
  if(!window.schedulerState || !Array.isArray(schedulerState.activeplayers) || schedulerState.activeplayers.length < 4){
    if(typeof showToast==='function')showToast('Select at least 4 players first.');
    else alert('Select at least 4 players first.');
    return;
  }
  if(typeof updateFixedPairSelectors==='function')updateFixedPairSelectors();
  scsOpenGuideChildPage('fixedPairsPage','tabBtnFixedPairs','organiser');
}

function scsGuideSetRoundAlgorithm(mode){
  var selected=mode==='balanced'?'balanced':'standard';
  if(typeof setGameGenerationMode==='function')setGameGenerationMode(selected,true);
  scsGuideSyncRoundOptions();
}

function scsGuideSetMarkWinner(enabled){
  var mainToggle=document.getElementById('modeToggle');
  if(mainToggle){
    mainToggle.checked=!!enabled;
    mainToggle.dispatchEvent(new Event('change',{bubbles:true}));
  }else{
    localStorage.setItem('playMode',enabled?'competitive':'random');
  }
  var stepToggle=document.getElementById('stepModeToggle');
  if(stepToggle)stepToggle.checked=!!enabled;
  scsGuideSyncRoundOptions();
}

function scsGuideToggleRoundOptions(forceOpen){
  var body=document.getElementById('scsGuideRoundOptionsBody');
  var toggle=document.getElementById('scsGuideRoundOptionsToggle');
  if(!body||!toggle)return;
  var open=(typeof forceOpen==='boolean')?forceOpen:body.hidden;
  body.hidden=!open;
  toggle.setAttribute('aria-expanded',open?'true':'false');
  toggle.classList.toggle('is-open',open);
}

function scsGuideSyncRoundOptions(){
  var host=document.getElementById('scsGuideRoundOptions');
  if(!host)return;
  var mode=(typeof getGameGenerationMode==='function')?getGameGenerationMode():(localStorage.getItem('gameGenerationMode')||'standard');
  mode=mode==='balanced'?'balanced':'standard';
  host.querySelectorAll('[data-guide-algorithm]').forEach(function(button){
    var active=button.getAttribute('data-guide-algorithm')===mode;
    button.classList.toggle('is-active',active);
    button.setAttribute('aria-pressed',active?'true':'false');
  });
  var winner=(typeof getPlayMode==='function')?getPlayMode()==='competitive':localStorage.getItem('playMode')==='competitive';
  var winnerToggle=document.getElementById('scsGuideMarkWinner');
  if(winnerToggle)winnerToggle.checked=winner;
  var pairCount=(window.schedulerState&&Array.isArray(schedulerState.fixedPairs))?schedulerState.fixedPairs.length:0;
  var pairState=document.getElementById('scsGuideFixedPairsState');
  if(pairState)pairState.textContent=pairCount?pairCount+' '+_scsGuideText(pairCount===1?'pair':'pairs',pairCount===1?'pair':'pairs'):_scsGuideText('optional','Optional');
}

function scsOpenGuidedFunctions(role){
  var cfg=_scsGuideLocalConfig(role); if(!cfg)return;
  var existingOverlay=document.getElementById('scsGuidedFunctions');
  if(existingOverlay&&existingOverlay.hidden&&!document.body.classList.contains('scs-guide-child-open')&&!document.body.classList.contains('scs-guide-nested-player-open')){
    _scsGuideCaptureOrigin();
  }
  _scsGuideRole=role;
  if(role==='organiser'){
    _scsGuideRestoreSelectedPlayers();
    _scsGuideLoadOrganiserClubs(false);
    // Player registration writes to the club database, not necessarily to the
    // current session. Refresh the selected club's roster whenever Assist is
    // shown so Create New Player / Add Players never use stale page state.
    _scsGuideRefreshOrganiserPlayers(false);
  }
  var overlay=document.getElementById('scsGuidedFunctions'); if(!overlay)return;
  // The helper is an app-level surface, never content within the currently
  // open Dashboard/Player/Club page. Reattach it to the document root in case
  // HTML recovery or a page renderer moved it into another stacking context.
  if(overlay.parentElement!==document.body) document.body.appendChild(overlay);
  overlay.style.setProperty('--guide-accent',cfg.accent); overlay.hidden=false; overlay.setAttribute('aria-hidden','false');
  document.body.classList.add('scs-guide-open');
  var kicker=document.getElementById('scsGuideKicker');if(kicker)kicker.textContent=_scsGuideText('guidedFunctions','GUIDED FUNCTIONS');
  document.getElementById('scsGuideRoleIcon').textContent=cfg.icon; document.getElementById('scsGuideTitle').textContent=cfg.title; document.getElementById('scsGuideSubtitle').textContent=cfg.subtitle;
  var doneCount=0,current=null,html='';
  cfg.steps.forEach(function(step,i){
    var done=_scsGuideStepDone(role,step.id);
    var organiserHasMembership=role==='organiser'&&_scsGuideOrganiserHasMembership();
    var organiserHasSelected=role==='organiser'&&_scsGuideOrganiserHasSelectedClub();
    var organiserHasPlayers=role==='organiser'&&_scsGuideHasPlayers();
    // Organiser Assist is a permanent shortcut menu, not a one-way wizard.
    // Only Join a Club becomes unavailable after membership exists. Every
    // other action remains enabled so the organiser can change club, create
    // more players, edit player selection, or reopen rounds at any time.
    var locked=(role==='organiser'&&step.id==='joinClub'&&done) ||
      (role==='vault'&&step.id==='club'&&done);
    if(done)doneCount++;
    else if(!locked&&!current)current=step;
    var description=step.desc;
    if(locked){
      if(role==='vault'&&step.id==='club')description=_scsGuideText('clubConnected','Club already connected.');
      else if(role==='organiser'&&step.id==='joinClub')description=_scsGuideText('membershipAvailable','Club membership already available.');
      else if(role==='organiser'&&step.id==='selectClub')description=_scsGuideText('joinFirst','Join a club first.');
      else if(role==='organiser'&&step.id==='newPlayer')description=!organiserHasSelected?_scsGuideText('selectFirst','Select a club first.'):_scsGuideText('playersRegistered','Players already registered.');
      else if(role==='organiser'&&step.id==='players')description=!organiserHasSelected?_scsGuideText('selectFirst','Select a club first.'):_scsGuideText('createPlayerFirst','Create a player first.');
      else description=_scsGuideText('selectFour','Select at least 4 players first.');
    }
    if(role==='organiser'&&step.id==='round'){
      html+='<section class="scs-guide-round-options" id="scsGuideRoundOptions" aria-label="Optional round settings">'+
        '<button type="button" class="scs-guide-round-options-toggle" id="scsGuideRoundOptionsToggle" aria-expanded="false" aria-controls="scsGuideRoundOptionsBody" onclick="scsGuideToggleRoundOptions()">'+
          '<span class="scs-guide-option-icon">⚙️</span><span class="scs-guide-option-copy"><strong>'+_scsGuideText('optionalSettings','Optional Round Settings')+'</strong><small>'+_scsGuideText('optionalSettingsDesc','Fixed pairs, algorithm &amp; winner')+'</small></span><span class="scs-guide-option-chevron">⌄</span>'+ 
        '</button>'+ 
        '<div class="scs-guide-round-options-body" id="scsGuideRoundOptionsBody" hidden>'+ 
          '<button type="button" class="scs-guide-option-row scs-guide-fixed-pairs" onclick="scsGuideOpenFixedPairs()"><span class="scs-guide-option-icon">🤝</span><span class="scs-guide-option-copy"><strong>'+_scsGuideText('fixedPairs','Fixed Pairs')+'</strong><small id="scsGuideFixedPairsState">'+_scsGuideText('optional','Optional')+'</small></span><span class="scs-guide-option-arrow">›</span></button>'+ 
          '<div class="scs-guide-option-block"><div class="scs-guide-option-label"><span>'+_scsGuideText('roundAlgorithm','Round Algorithm')+'</span><small>'+_scsGuideText('algorithmDesc','Choose how games are generated')+'</small></div><div class="scs-guide-algorithm-toggle" role="group" aria-label="'+_scsGuideText('roundAlgorithm','Round Algorithm')+'"><button type="button" data-guide-algorithm="standard" onclick="scsGuideSetRoundAlgorithm(\'standard\')">'+_scsGuideText('standard','Standard')+'</button><button type="button" data-guide-algorithm="balanced" onclick="scsGuideSetRoundAlgorithm(\'balanced\')">'+_scsGuideText('balanced','Balanced')+'</button></div></div>'+ 
          '<div class="scs-guide-option-row scs-guide-winner-row"><span class="scs-guide-option-icon">♛</span><span class="scs-guide-option-copy"><strong>'+_scsGuideText('markWinner','Mark Winner')+'</strong><small>'+_scsGuideText('markWinnerDesc','Show winner selection after games')+'</small></span><label class="switch"><input id="scsGuideMarkWinner" type="checkbox" onchange="scsGuideSetMarkWinner(this.checked)"><span class="slider"></span></label></div>'+ 
        '</div>'+ 
      '</section>';
    }
    html+='<button type="button" class="scs-guide-step '+(done?'is-done':((current&&current.id===step.id)?'is-current':''))+(locked?' is-disabled':'')+'" data-guide-step="'+step.id+'"'+
      (locked?' disabled aria-disabled="true"':' aria-disabled="false"')+
      '><span class="scs-guide-step-num">'+(done?'✓':(i+1))+'</span><span><div class="scs-guide-step-title">'+step.title+'</div><div class="scs-guide-step-desc">'+description+'</div></span><span class="scs-guide-step-arrow">›</span></button>';
  });
  var stepsHost=document.getElementById('scsGuideSteps');
  stepsHost.innerHTML=html;
  stepsHost.querySelectorAll('[data-guide-step]').forEach(function(button){
    button.addEventListener('click',function(){
      if(button.disabled)return;
      scsGuideChooseStep(button.getAttribute('data-guide-step'));
    });
  });
  if(role==='organiser')scsGuideSyncRoundOptions();
  document.getElementById('scsGuideProgressBar').style.width=Math.round(doneCount/cfg.steps.length*100)+'%';
  _scsGuideCurrentStep=current||cfg.steps[cfg.steps.length-1];
  if(!current){localStorage.setItem(_scsGuideKey(role),'complete');}
}
function scsGuideChooseStep(id){_scsGuideCurrentStep={id:id};scsRunGuidePrimary();}
function scsCloseGuidedFunctions(skip,suppressRestore){
  var o=document.getElementById('scsGuidedFunctions');
  if(o){o.hidden=true;o.setAttribute('aria-hidden','true');}
  document.body.classList.remove('scs-guide-open');
  if(skip&&_scsGuideRole)localStorage.setItem(_scsGuideKey(_scsGuideRole),'dismissed');
  if(!suppressRestore)_scsGuideRestoreOrigin();
}

function scsOpenGuideChildPage(pageId,tabId,role){
  var page=document.getElementById(pageId);
  if(!page)return;
  role=role||_scsGuideRole||'organiser';
  _scsGuideRole=role;
  _scsGuideChildPageId=pageId;
  try{
    sessionStorage.setItem('scs_guide_child_page',pageId);
    sessionStorage.setItem('scs_guide_child_role',role);
  }catch(e){}

  // Keep Assist mounted underneath, exactly like the Player Assist children.
  if(typeof homeHideScreen==='function')homeHideScreen();
  if(typeof showPage==='function')showPage(pageId,tabId?document.getElementById(tabId):null);
  else page.style.display='block';

  page.classList.add('scs-assist-child-page');
  var oldClose=page.querySelector('.scs-assist-child-close');
  if(oldClose)oldClose.remove();
  var close=document.createElement('button');
  close.type='button';
  close.className='scs-assist-child-close scs-popup-close-btn';
  close.setAttribute('aria-label','Close and return to Assist');
  close.textContent='✕';
  close.onclick=scsGuideReturnFromChild;
  page.appendChild(close);
  document.body.classList.add('scs-guide-child-open');
}

function scsPlayersOpenNewPlayer(){
  var playersPage=document.getElementById('playersPage');
  var fromAssist=!!(playersPage&&playersPage.classList.contains('scs-assist-child-page'));
  if(!fromAssist){
    window._regNavSource='playersPage';
    if(typeof homeGo==='function')homeGo('vaultRegisterPage',null);
    return;
  }

  var registerPage=document.getElementById('vaultRegisterPage');
  if(!registerPage)return;
  registerPage.style.display='block';
  registerPage.classList.add('scs-assist-nested-player-page');
  var oldClose=registerPage.querySelector('.scs-assist-nested-player-close');
  if(oldClose)oldClose.remove();
  var close=document.createElement('button');
  close.type='button';
  close.className='scs-assist-nested-player-close scs-popup-close-btn';
  close.setAttribute('aria-label','Close and return to Players');
  close.textContent='✕';
  close.onclick=scsPlayersCloseNewPlayer;
  registerPage.appendChild(close);
  document.body.classList.add('scs-guide-nested-player-open');
  if(typeof vaultRenderRegister==='function')vaultRenderRegister();
}

function scsPlayersCloseNewPlayer(){
  var registerPage=document.getElementById('vaultRegisterPage');
  if(registerPage){
    registerPage.classList.remove('scs-assist-nested-player-page');
    registerPage.style.display='none';
    var close=registerPage.querySelector('.scs-assist-nested-player-close');
    if(close)close.remove();
  }
  document.body.classList.remove('scs-guide-nested-player-open');

  // Restore Players through the normal page router instead of only toggling
  // display.  Other navigation/render work can hide all .page elements while
  // New Player is open, which previously left a blank screen on close.
  var playersPage=document.getElementById('playersPage');
  if(playersPage){
    if(typeof homeHideScreen==='function')homeHideScreen();
    if(typeof showPage==='function'){
      showPage('playersPage',document.getElementById('tabBtnPlayers'));
    }else{
      document.querySelectorAll('.page').forEach(function(p){p.style.display='none';});
      playersPage.style.display='block';
    }

    // New Player is a nested Assist page, so Players must remain the active
    // Assist child. Reassert this state in case another render cleared it.
    playersPage.classList.add('scs-assist-child-page');
    _scsGuideChildPageId='playersPage';
    _scsGuideRole='organiser';
    try{
      sessionStorage.setItem('scs_guide_child_page','playersPage');
      sessionStorage.setItem('scs_guide_child_role','organiser');
    }catch(e){}
    document.body.classList.add('scs-guide-child-open');

    // Ensure the Assist close control still exists after restoration.
    var childClose=playersPage.querySelector('.scs-assist-child-close');
    if(!childClose){
      childClose=document.createElement('button');
      childClose.type='button';
      childClose.className='scs-assist-child-close scs-popup-close-btn';
      childClose.setAttribute('aria-label','Close and return to Assist');
      childClose.textContent='✕';
      childClose.onclick=scsGuideReturnFromChild;
      playersPage.appendChild(childClose);
    }
  }
  if(typeof updatePlayerList==='function')updatePlayerList();
}

function scsGuideReturnFromChild(){
  var pageId=_scsGuideChildPageId;
  var role=_scsGuideRole||'organiser';
  try{
    pageId=pageId||sessionStorage.getItem('scs_guide_child_page')||'';
    role=sessionStorage.getItem('scs_guide_child_role')||role;
    sessionStorage.removeItem('scs_guide_child_page');
    sessionStorage.removeItem('scs_guide_child_role');
  }catch(e){}
  var page=pageId?document.getElementById(pageId):document.querySelector('.scs-assist-child-page');
  if(page){
    page.classList.remove('scs-assist-child-page');
    page.style.display='none';
    var close=page.querySelector('.scs-assist-child-close');
    if(close)close.remove();
  }
  _scsGuideChildPageId='';
  document.body.classList.remove('scs-guide-child-open');
  if(role==='organiser'){
    // A player may have just been created. Force a fresh club roster before
    // deciding which guided action is enabled.
    _scsGuideOrganiserPlayersLoadedAt=0;
    _scsGuideRefreshOrganiserPlayers(true);
  }
  setTimeout(function(){scsOpenGuidedFunctions(role);},60);
}

function scsGuideReturnFromVaultSlotManager(){
  var home=document.getElementById('homePageOverlay');
  var close=home&&home.querySelector('.scs-topbar-x');
  if(close&&close.hasAttribute('data-scs-assist-original-onclick')){
    var original=close.getAttribute('data-scs-assist-original-onclick')||'openModeSwitcher()';
    close.onclick=null;
    close.setAttribute('onclick',original);
    close.removeAttribute('data-scs-assist-original-onclick');
    close.setAttribute('aria-label','Close');
  }
  if(home)home.classList.remove('scs-assist-child-page');
  if(typeof homeHideScreen==='function')homeHideScreen();
  else if(home)home.style.display='none';
  _scsGuideChildPageId='';
  document.body.classList.remove('scs-guide-child-open');
  try{
    sessionStorage.removeItem('scs_guide_child_page');
    sessionStorage.removeItem('scs_guide_child_role');
    sessionStorage.removeItem('scs_slot_from_assist');
  }catch(e){}
  setTimeout(function(){scsOpenGuidedFunctions('vault');},60);
}

async function scsGuideOpenVaultSlotManager(){
  var home=document.getElementById('homePageOverlay');
  if(!home)return;
  // Assist may be launched from a non-selected carousel tile. Reuse an
  // already verified Club Manager session, but never bypass its login gate.
  if(typeof appMode!=='undefined'&&appMode!=='vault'){
    var verified=typeof hasVerifiedWorkspaceRole==='function'&&hasVerifiedWorkspaceRole('vault');
    if(!verified){
      scsCloseGuidedFunctions(false,true);
      if(typeof requestVaultMode==='function')requestVaultMode();
      return;
    }
    appMode='vault';
    try{sessionStorage.setItem('appMode','vault');localStorage.setItem('kbrr_app_mode','vault');}catch(e){}
    if(typeof applyMode==='function')applyMode('vault');
    if(typeof updateModePill==='function')updateModePill('vault');
  }
  _scsGuideRole='vault';
  _scsGuideChildPageId='homePageOverlay';
  try{
    sessionStorage.setItem('scs_guide_child_page','homePageOverlay');
    sessionStorage.setItem('scs_guide_child_role','vault');
    sessionStorage.setItem('scs_slot_from_assist','1');
  }catch(e){}

  // This is the existing Club Manager home and slot calendar, not a second
  // slot page. Keep Assist mounted underneath while the workspace is shown
  // as a modal above it.
  if(typeof showHomeScreen==='function')showHomeScreen();
  home.classList.add('scs-assist-child-page');
  document.body.classList.add('scs-guide-child-open');

  var close=home.querySelector('.scs-topbar-x');
  if(close){
    if(!close.hasAttribute('data-scs-assist-original-onclick')){
      close.setAttribute('data-scs-assist-original-onclick',close.getAttribute('onclick')||'openModeSwitcher()');
    }
    close.removeAttribute('onclick');
    close.onclick=scsGuideReturnFromVaultSlotManager;
    close.setAttribute('aria-label','Close and return to Assist');
  }
  try{
    if(typeof renderVaultHomeSlotsUI==='function')await renderVaultHomeSlotsUI(true);
  }catch(e){console.warn('Assist Slot Manager refresh failed',e);}
  setTimeout(function(){
    var slots=document.getElementById('vaultUpcomingSlots');
    if(slots)slots.scrollIntoView({behavior:'smooth',block:'start'});
  },80);
}

function scsGuideReturnFromJoinClub(){
  var fromAssist=false;
  var assistRole='viewer';
  try{fromAssist=sessionStorage.getItem('scs_join_club_from_assist')==='1';}catch(e){}
  if(!fromAssist){if(typeof showHomeScreen==='function')showHomeScreen();return;}
  try{assistRole=sessionStorage.getItem('scs_join_club_assist_role')||'viewer';}catch(e){}

  // Club Search launched from Assist is only a popup above Assist.
  // Close that popup and leave the underlying Assist page exactly where it was.
  var page=document.getElementById('joinClubPage');
  if(page){page.classList.remove('scs-assist-club-popup');page.style.display='none';}
  var backdrop=document.getElementById('scsAssistClubBackdrop');
  if(backdrop)backdrop.remove();
  document.body.classList.remove('scs-assist-club-open');
  try{
    sessionStorage.removeItem('scs_join_club_from_assist');
    sessionStorage.removeItem('scs_join_club_assist_role');
  }catch(e){}
  if(assistRole==='organiser'){
    _scsGuideOrganiserClubsLoadedAt=0;
    _scsGuideLoadOrganiserClubs(true);
  }
  setTimeout(function(){scsOpenGuidedFunctions(assistRole);},80);
}

function scsGuideJoinClubCompleted(){
  var fromAssist=false;
  try{fromAssist=sessionStorage.getItem('scs_join_club_from_assist')==='1';}catch(e){}
  if(!fromAssist)return false;
  setTimeout(function(){scsGuideReturnFromJoinClub();},350);
  return true;
}

async function scsOpenJoinClubFromGuide(role){
  // Prepare the existing Club Search page off-screen first. It is revealed only
  // after memberships, pending requests and club data have finished rendering,
  // preventing flashing and changing popup dimensions.
  role=role||_scsGuideRole||'viewer';
  try{
    sessionStorage.setItem('scs_join_club_from_assist','1');
    sessionStorage.setItem('scs_join_club_assist_role',role);
  }catch(e){}
  var page=document.getElementById('joinClubPage');
  if(!page)return;

  var old=document.getElementById('scsAssistClubBackdrop');if(old)old.remove();
  var backdrop=document.createElement('div');
  backdrop.id='scsAssistClubBackdrop';
  backdrop.className='scs-assist-club-backdrop scs-assist-club-loading';
  backdrop.innerHTML='<div class="scs-assist-club-loader" role="status" aria-label="Loading clubs"><span></span></div>';
  document.body.appendChild(backdrop);
  document.body.classList.add('scs-assist-club-open');

  page.classList.add('scs-assist-club-popup','scs-assist-club-preparing');
  page.style.display='block';
  try{
    if(typeof joinClubPageOpen==='function') await joinClubPageOpen();
  }catch(e){console.warn('Assist club preload failed',e);}

  // Wait one paint so all calculated content sizes are settled before reveal.
  await new Promise(function(resolve){requestAnimationFrame(function(){requestAnimationFrame(resolve);});});
  page.classList.remove('scs-assist-club-preparing');
  backdrop.classList.remove('scs-assist-club-loading');
  backdrop.innerHTML='';
  backdrop.onclick=function(e){if(e.target===backdrop)scsGuideReturnFromJoinClub();};
  setTimeout(function(){
    var input=document.getElementById('joinClubPageSearch');
    if(input){try{input.focus({preventScroll:true});}catch(e){input.focus();}}
  },80);
}


async function scsGuideOpenCreateSlot(){
  // Reuse the established Club Manager Slot Manager. Selecting a date there
  // reveals its existing Add Slot action and keeps a single source of truth.
  await scsGuideOpenVaultSlotManager();
}

function _scsGuideConfirmClubChange(currentClub,newClub){
  return new Promise(function(resolve){
    var modal=document.createElement('div');
    modal.className='scs-guide-club-change-modal';
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    modal.setAttribute('aria-labelledby','scsGuideClubChangeTitle');
    var currentName=(currentClub&&currentClub.name)||'the current club';
    var newName=(newClub&&newClub.name)||'the selected club';
    modal.innerHTML='<div class="scs-guide-club-change-card">'+
      '<div class="scs-guide-club-change-icon">⚠️</div>'+
      '<h3 id="scsGuideClubChangeTitle">Change Club?</h3>'+
      '<p>Change from <strong>'+organiserAccessEscape(currentName)+'</strong> to <strong>'+organiserAccessEscape(newName)+'</strong>?</p>'+
      '<p class="scs-guide-club-change-warning">Your current player selection and round setup will be cleared.</p>'+
      '<div class="scs-guide-club-change-actions">'+
        '<button type="button" class="scs-guide-club-change-cancel">Cancel</button>'+
        '<button type="button" class="scs-guide-club-change-confirm">Change Club</button>'+
      '</div></div>';
    document.body.appendChild(modal);
    var finished=false;
    function close(result){
      if(finished)return; finished=true;
      document.removeEventListener('keydown',onKey);
      modal.remove(); resolve(result);
    }
    function onKey(e){if(e.key==='Escape')close(false);}
    document.addEventListener('keydown',onKey);
    modal.querySelector('.scs-guide-club-change-cancel').onclick=function(){close(false);};
    modal.querySelector('.scs-guide-club-change-confirm').onclick=function(){close(true);};
    modal.addEventListener('click',function(e){if(e.target===modal)close(false);});
    setTimeout(function(){var b=modal.querySelector('.scs-guide-club-change-cancel');if(b)b.focus();},30);
  });
}

async function _scsGuideResetOrganiserSessionForClubChange(){
  // A club change starts a completely fresh organiser session. Club-created
  // players/history remain in the database; only the current round setup is cleared.
  try{
    if(typeof dbReleaseMySession==='function') await dbReleaseMySession();
  }catch(e){console.warn('Could not release previous organiser session',e);}

  try{
    localStorage.removeItem('schedulerPlayers');
    localStorage.removeItem('schedulerState');
    localStorage.removeItem('allRounds');
    localStorage.removeItem('currentRoundIndex');
    localStorage.removeItem('isOnPage2');
    sessionStorage.removeItem('kbrr_session_db_id');
  }catch(e){}

  if(typeof newImportState!=='undefined'&&newImportState){
    newImportState.selectedPlayers=[];
    if(newImportState.unavailablePlayers&&typeof newImportState.unavailablePlayers.clear==='function'){
      newImportState.unavailablePlayers.clear();
    }
    if(newImportState.slotUnavailablePlayers&&typeof newImportState.slotUnavailablePlayers.clear==='function'){
      newImportState.slotUnavailablePlayers.clear();
    }
  }

  if(typeof allRounds!=='undefined'&&allRounds){allRounds.length=0;}
  if(typeof lastRound!=='undefined'&&lastRound){lastRound.length=0;}
  if(typeof currentRoundIndex!=='undefined')currentRoundIndex=0;
  if(typeof isOnPage2!=='undefined')isOnPage2=false;
  if(typeof resetRest!=='undefined')resetRest=false;

  if(typeof schedulerState!=='undefined'&&schedulerState){
    schedulerState.numCourts=0;
    schedulerState.courts=1;
    schedulerState.allPlayers=[];
    if(Array.isArray(schedulerState.activeplayers))schedulerState.activeplayers.splice(0,schedulerState.activeplayers.length);
    else schedulerState.activeplayers=[];
    schedulerState.fixedPairs=[];
    schedulerState.roundIndex=0;
    schedulerState.markingWinnerMode=false;
    schedulerState.courtTypes=[];
    schedulerState.courtFormats=[];
    schedulerState.PlayedCount=new Map();
    schedulerState.typePlayCount={MD:new Map(),LD:new Map(),XD:new Map()};
    schedulerState.restCount=new Map();
    schedulerState.restQueue=new Map();
    schedulerState.PlayerScoreMap=new Map();
    schedulerState.playedTogether=new Map();
    schedulerState.fixedMap=new Map();
    schedulerState.pairPlayedSet=new Set();
    schedulerState.gamesMap=new Set();
    schedulerState.winCount=new Map();
    schedulerState.pairCooldownMap=new Map();
    schedulerState.rankPoints=new Map();
    schedulerState.streakMap=new Map();
    schedulerState.pairHistory=new Map();
    schedulerState.reachablePairs=new Set();
    schedulerState.opponentMap=new Map();
    schedulerState.fixedPairGameQueue=null;
    schedulerState.fixedPairGameQueueHash=null;
    schedulerState.mbmActive=false;
  }

  if(typeof currentState!=='undefined')currentState='idle';
  if(typeof roundActive!=='undefined')roundActive=false;
  if(typeof sessionFinished!=='undefined')sessionFinished=false;
  if(typeof clearFixedPairsUI==='function')clearFixedPairsUI();
  if(typeof updateFixedPairSelectors==='function')updateFixedPairSelectors();
  if(typeof updatePlayerList==='function')updatePlayerList();
  if(typeof updateRoundsPageAccess==='function')updateRoundsPageAccess();
  if(typeof updateSummaryPageAccess==='function')updateSummaryPageAccess();
}

async function scsGuideSelectOrganiserClub(){
  var clubs=[];
  try{
    clubs=typeof getOrganiserEligibleClubs==='function'?await getOrganiserEligibleClubs():[];
  }catch(e){clubs=[];}
  _scsGuideOrganiserClubs=Array.isArray(clubs)?clubs:[];
  _scsGuideOrganiserClubsLoadedAt=Date.now();
  if(!clubs.length){
    if(typeof showToast==='function')showToast('Join a club first.');
    scsOpenGuidedFunctions('organiser');
    return;
  }
  var selected=typeof showOrganiserAccessMenu==='function'
    ? await showOrganiserAccessMenu(clubs,{directSelect:true})
    : clubs[0];
  if(!selected||!selected.id){scsOpenGuidedFunctions('organiser');return;}
  var currentClub=_scsGuideOrganiserSelectedClub();
  var isDifferentClub=!!(currentClub&&currentClub.id&&String(currentClub.id)!==String(selected.id));
  if(isDifferentClub){
    var confirmed=await _scsGuideConfirmClubChange(currentClub,selected);
    if(!confirmed){scsOpenGuidedFunctions('organiser');return;}
    await _scsGuideResetOrganiserSessionForClubChange();
  }
  var club=selected;
  try{
    if(typeof syncOrganiserMembershipAccess==='function'){
      club=await syncOrganiserMembershipAccess(null,selected.id)||selected;
    }
    if(typeof setMyClub==='function')setMyClub(club.id,club.name||selected.name||'');
    window.__scsWelcomeOrganiserChoice=String(club.id);
    appMode='organiser';
    sessionStorage.setItem('appMode','organiser');
    localStorage.setItem('kbrr_app_mode','organiser');
    if(typeof applyMode==='function')applyMode('organiser');
    if(typeof updateModePill==='function')updateModePill('organiser');
    if(typeof syncToLocal==='function')await syncToLocal();
    _scsGuideRestoreSelectedPlayers();
    _scsGuideOrganiserPlayers=[];
    _scsGuideOrganiserPlayersClubId='';
    _scsGuideOrganiserPlayersLoadedAt=0;
    _scsGuideRefreshOrganiserPlayers(true);
  }catch(e){
    if(typeof showToast==='function')showToast(e.message||'Could not select club.');
  }
  scsOpenGuidedFunctions('organiser');
}

function scsRunGuidePrimary(){
  var role=_scsGuideRole,id=_scsGuideCurrentStep&&_scsGuideCurrentStep.id;
  // Player and Organiser actions open above the checklist. Closing the child
  // returns directly to the same role's Assist page.
  if(role==='viewer'){
    if(id==='nickname'){
      if(typeof authOpenNicknameEditor==='function'){
        var before=_scsGuideHasPlayerName(); authOpenNicknameEditor();
        var tries=0, timer=setInterval(function(){tries++; if(_scsGuideHasPlayerName()||tries>120){clearInterval(timer); if(_scsGuideHasPlayerName()&&!before)setTimeout(function(){scsOpenGuidedFunctions('viewer');},180);}},250);
      }
      return;
    }
    if(id==='gender'){scsGuideAskGender();return;}
    if(id==='club'){scsOpenJoinClubFromGuide('viewer');return;}
  }
  if(role==='vault'){
    scsCloseGuidedFunctions(false,true);
    if(id==='club'){
      if(_scsGuideStepDone('vault','club')){scsOpenGuidedFunctions('vault');return;}
      try{sessionStorage.setItem('scs_club_setup_from_assist','vault');}catch(e){}
      _showClubSetupSheet('vault');
      return;
    }
    if(id==='player'){
      window._regNavSource=null;
      scsOpenGuideChildPage('vaultRegisterPage',null,'vault');
      if(typeof vaultRenderRegister==='function')vaultRenderRegister();
      return;
    }
    if(id==='slot'){scsGuideOpenCreateSlot();return;}
  }
  if(role==='organiser'){
    if(id==='joinClub'){
      if(_scsGuideOrganiserHasMembership()){scsOpenGuidedFunctions('organiser');return;}
      _scsGuideOrganiserClubsLoadedAt=0;
      scsOpenJoinClubFromGuide('organiser');
      return;
    }
    if(id==='selectClub'){scsGuideSelectOrganiserClub();return;}
    if(id==='newPlayer'){
      window._regNavSource=null;
      scsOpenGuideChildPage('vaultRegisterPage',null,'organiser');
      if(typeof vaultRenderRegister==='function')vaultRenderRegister();
      return;
    }
    if(id==='players'){
      _scsGuideRestoreSelectedPlayers();
      scsOpenGuideChildPage('playersPage','tabBtnPlayers','organiser');
      return;
    }
    if(id==='round'){
      scsGuideStartRoundFromDashboardSlot();
      return;
    }
  }
}


/* Build 529: Round Manager Assist reuses the Dashboard slot Start Session flow.
   Assist is closed first, then the same authoritative slot-start function opens
   the existing normal full-page Rounds screen. */
async function scsGuideStartRoundFromDashboardSlot(){
  var existingSessionId=typeof getMySessionId==='function'?getMySessionId():null;
  var hasExistingRounds=typeof allRounds!=='undefined'&&Array.isArray(allRounds)&&allRounds.length>0;
  var liveSessionAvailable=(existingSessionId||hasExistingRounds)&&
    (typeof sessionFinished==='undefined'||!sessionFinished);

  // A started slot no longer appears in the Dashboard Start Session card.
  // In that state Start Round means reopen the organiser's live Rounds page.
  if(liveSessionAvailable){
    appMode='organiser';
    sessionStorage.setItem('appMode','organiser');
    localStorage.setItem('kbrr_app_mode','organiser');
    if(typeof applyMode==='function')applyMode('organiser');
    if(typeof updateModePill==='function')updateModePill('organiser');
    scsCloseGuidedFunctions(false,true);
    var existingModeOverlay=document.getElementById('modeSelectOverlay');
    if(existingModeOverlay)existingModeOverlay.style.display='none';
    if(typeof homeHideScreen==='function')homeHideScreen();
    if(typeof showPage==='function')showPage('roundsPage',document.getElementById('tabBtnRounds'));
    else{
      var existingRoundsPage=document.getElementById('roundsPage');
      if(existingRoundsPage)existingRoundsPage.style.display='block';
    }
    if(hasExistingRounds&&typeof showRound==='function'){
      var roundIndex=typeof currentRoundIndex==='number'?currentRoundIndex:allRounds.length-1;
      showRound(Math.max(0,Math.min(roundIndex,allRounds.length-1)));
    }
    return;
  }

  if(typeof renderLauncherStartSessionCard!=='function'){
    alert(t('roundsUnavailable')||'Rounds are not available yet.');
    return;
  }
  try{
    await renderLauncherStartSessionCard();
  }catch(e){
    console.warn('Assist Start Round dashboard refresh failed',e);
    alert((t('noPlayableSlot')||'No playable slot is available now.')+'\n'+(e.message||''));
    return;
  }

  // Invoke the real Dashboard Start Session control. This keeps its slot,
  // player, timing and permission checks as the only source of truth.
  var startButton=document.querySelector('#organiserNextSlotCard .mc-slot-action-btn, #launcherStartSessionCard .mc-slot-action-btn');
  if(!startButton){
    // No scheduled slot is due. Assist still supports the normal organiser
    // flow built from the players selected in its Add Players step.
    var selectedCount=typeof schedulerState!=='undefined'&&schedulerState.activeplayers
      ? schedulerState.activeplayers.length
      : 0;
    if(selectedCount<4){
      alert(t('need4Players')||'Need at least 4 selected players.');
      return;
    }
    appMode='organiser';
    sessionStorage.setItem('appMode','organiser');
    localStorage.setItem('kbrr_app_mode','organiser');
    if(typeof applyMode==='function')applyMode('organiser');
    if(typeof updateModePill==='function')updateModePill('organiser');
    scsCloseGuidedFunctions(false,true);
    document.querySelectorAll('.organiser-access-overlay').forEach(function(overlay){overlay.remove();});
    var fallbackModeOverlay=document.getElementById('modeSelectOverlay');
    if(fallbackModeOverlay)fallbackModeOverlay.style.display='none';
    // Use the exact same navigation path as the normal Round Manager Start
    // button. showPage('roundsPage') owns initial round generation, so do not
    // invoke goToRounds() a second time here.
    if(typeof homeGo==='function')homeGo('roundsPage','tabBtnRounds');
    else{
      if(typeof homeHideScreen==='function')homeHideScreen();
      if(typeof showPage==='function')showPage('roundsPage',document.getElementById('tabBtnRounds'));
    }
    return;
  }
  if(startButton.disabled){
    alert(startButton.textContent||t('startSessionNotReady')||'This slot is not ready to start yet.');
    return;
  }

  var launcherSlot=(typeof _launcherDueSlot!=='undefined'&&_launcherDueSlot)||{};
  var clubId=String(launcherSlot.clubId||localStorage.getItem('kbrr_org_club_id')||'');
  var clubName=launcherSlot.clubName||localStorage.getItem('kbrr_org_club_name')||'';
  if(clubId&&typeof setMyClub==='function')setMyClub(clubId,clubName);
  if(clubId){
    localStorage.setItem('kbrr_org_club_id',clubId);
    localStorage.setItem('kbrr_org_club_name',clubName);
  }
  appMode='organiser';
  sessionStorage.setItem('appMode','organiser');
  localStorage.setItem('kbrr_app_mode','organiser');
  if(typeof applyMode==='function')applyMode('organiser');
  if(typeof updateModePill==='function')updateModePill('organiser');

  // The Assist and launcher overlays otherwise remain above the Rounds page,
  // making a successful start look like no action occurred.
  scsCloseGuidedFunctions(false,true);
  var modeOverlay=document.getElementById('modeSelectOverlay');
  if(modeOverlay)modeOverlay.style.display='none';
  if(typeof homeHideScreen==='function')homeHideScreen();
  startButton.click();
}

/* Build 431: club-scoped hub photos and startup-prefetched welcome data. */
var welcomePhotoRole = 'viewer';
var welcomePhotoKeyAtSelection = '';

function welcomeNormalisePhotoRole(role) {
  return role === 'organiser' ? 'organiser' : (role === 'vault' ? 'vault' : 'viewer');
}

function welcomePhotoKeyPart(value) {
  return String(value || 'default').toLowerCase().replace(/[^a-z0-9_.@-]/g, '_');
}

function welcomePhotoIdentity() {
  var account = (typeof authGetUser === 'function') ? authGetUser() : null;
  var player = (typeof getMyPlayer === 'function') ? getMyPlayer() : null;
  var identity = (account && (account.id || account.user_id || account.email || account.nickname)) ||
                 (player && (player.id || player.user_id || player.email || player.name)) || 'default';
  return welcomePhotoKeyPart(identity);
}

function welcomeRoleClubInfo(role) {
  role = welcomeNormalisePhotoRole(role);
  if (role === 'organiser') return { id: localStorage.getItem('kbrr_org_club_id') || '', name: localStorage.getItem('kbrr_org_club_name') || '' };
  if (role === 'vault') return { id: localStorage.getItem('kbrr_vault_club_id') || '', name: localStorage.getItem('kbrr_vault_club_name') || '' };
  return { id: welcomePhotoIdentity(), name: '' };
}

function welcomeRolePhotoStorageKey(role) {
  role = welcomeNormalisePhotoRole(role);
  if (role === 'viewer') return 'scs_hub_photo_v6_viewer_' + welcomePhotoIdentity();
  var info = welcomeRoleClubInfo(role);
  if (!info.id) return '';
  return 'scs_hub_photo_v6_' + role + '_club_' + welcomePhotoKeyPart(info.id);
}

function welcomeGetSavedRolePhoto(role) {
  role = welcomeNormalisePhotoRole(role);
  var key = welcomeRolePhotoStorageKey(role);
  if (!key) return '';
  try {
    var saved = localStorage.getItem(key) || '';
    if (saved) return saved;

    // One-time migration only for the same resolved role/club. Never copy a
    // different club's "last" image into the current club.
    var info = welcomeRoleClubInfo(role);
    var legacy = role === 'viewer'
      ? ['scs_hub_photo_v5_viewer_' + welcomePhotoIdentity(), 'scs_welcome_profile_photo_' + welcomePhotoIdentity()]
      : [
          'scs_hub_photo_v5_' + role + '_id_' + welcomePhotoKeyPart(info.id),
          info.name ? 'scs_hub_photo_v5_' + role + '_name_' + welcomePhotoKeyPart(info.name) : '',
          'scs_hub_photo_v4_' + role + '_' + welcomePhotoKeyPart(info.id)
        ];
    for (var i = 0; i < legacy.length; i++) {
      if (!legacy[i]) continue;
      var oldPhoto = localStorage.getItem(legacy[i]) || '';
      if (!oldPhoto) continue;
      localStorage.setItem(key, oldPhoto);
      return oldPhoto;
    }
  } catch (e) { console.warn('Hub photo restore failed:', e); }
  return '';
}

function welcomeProfilePhotoStorageKey() { return welcomeRolePhotoStorageKey('viewer'); }
function welcomeGetSavedProfilePhoto() { return welcomeGetSavedRolePhoto('viewer'); }

function welcomeOpenPhotoMenu(role) {
  welcomePhotoRole = welcomeNormalisePhotoRole(role);
  welcomePhotoKeyAtSelection = welcomeRolePhotoStorageKey(welcomePhotoRole);
  if (!welcomePhotoKeyAtSelection && welcomePhotoRole !== 'viewer') {
    if (typeof showToast === 'function') showToast('Please wait for the club data to finish loading.');
    return;
  }
  var title = document.getElementById('welcomePhotoSheetTitle');
  if (title) title.textContent = welcomePhotoRole === 'viewer' ? 'Profile Photo' : 'Team Picture';
  var sheet = document.getElementById('welcomePhotoSheet');
  if (!sheet) return;
  sheet.hidden = false;
  requestAnimationFrame(function(){ sheet.classList.add('open'); });
  document.body.classList.add('welcome-photo-menu-open');
}

function welcomeChooseRolePhoto(role) {
  welcomePhotoRole = welcomeNormalisePhotoRole(role);
  welcomePhotoKeyAtSelection = welcomeRolePhotoStorageKey(welcomePhotoRole);
  if (!welcomePhotoKeyAtSelection && welcomePhotoRole !== 'viewer') {
    if (typeof showToast === 'function') showToast('Please wait for the club data to finish loading.');
    return;
  }
  var input = document.getElementById('welcomeProfileLibraryInput');
  if (!input) return;
  input.value = '';
  input.click();
}

function welcomeRolePhotoElement(role) {
  role = welcomeNormalisePhotoRole(role);
  return document.getElementById(role === 'organiser' ? 'welcomeOrganiserPhoto' : (role === 'vault' ? 'welcomeVaultPhoto' : 'welcomePlayerPhoto'));
}

// Build 1015: built-in Welcome tile pictures. A saved user/club image always
// takes priority; these files are used only when no custom picture is saved.
function welcomeDefaultRolePhoto(role) {
  role = welcomeNormalisePhotoRole(role);
  if (role === 'organiser') return 'welcome-default-round-manager.png';
  if (role === 'vault') return 'welcome-default-slot-manager.png';
  return 'welcome-default-myhub.png';
}

function welcomeApplySimpleRolePhoto(role, photoUrl) {
  role = welcomeNormalisePhotoRole(role);
  var id = role === 'organiser' ? 'simpleOrganiserPhoto' : (role === 'vault' ? 'simpleVaultPhoto' : 'simpleViewerPhoto');
  var image = document.getElementById(id);
  if (!image) return;
  var saved = photoUrl === undefined ? welcomeGetSavedRolePhoto(role) : photoUrl;
  var resolved = saved || welcomeDefaultRolePhoto(role);
  image.src = resolved;
  image.hidden = false;
  var fallback = image.parentElement && image.parentElement.querySelector('.simple-mode-icon-fallback');
  if (fallback) fallback.hidden = true;
}

function welcomeSaveRolePhoto(role, dataUrl, fixedKey) {
  var key = fixedKey || welcomeRolePhotoStorageKey(role);
  if (!key) return false;
  try {
    localStorage.setItem(key, dataUrl);
    return localStorage.getItem(key) === dataUrl;
  } catch (e) {
    console.warn('Hub photo save failed:', e);
    return false;
  }
}

function welcomeHandleProfilePhoto(input) {
  var file = input && input.files && input.files[0];
  if (!file) return;
  if (!file.type || file.type.indexOf('image/') !== 0) { alert('Please select an image.'); return; }
  var roleAtSelection = welcomeNormalisePhotoRole(welcomePhotoRole);
  var keyAtSelection = welcomePhotoKeyAtSelection || welcomeRolePhotoStorageKey(roleAtSelection);
  var reader = new FileReader();
  reader.onerror = function(){ alert('Unable to read this photo. Please try another image.'); };
  reader.onload = function(event) {
    var image = new Image();
    image.onerror = function(){ alert('Unable to open this photo. Please try another image.'); };
    image.onload = function() {
      try {
        var w = image.naturalWidth || image.width, h = image.naturalHeight || image.height;
        var side = Math.min(w, h), sx = Math.max(0, (w-side)/2), sy = Math.max(0, (h-side)/2);
        var canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 256;
        canvas.getContext('2d').drawImage(image, sx, sy, side, side, 0, 0, 256, 256);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.68);
        if (!welcomeSaveRolePhoto(roleAtSelection, dataUrl, keyAtSelection)) {
          alert('The photo could not be saved. Please free some browser storage and try again.');
          return;
        }
        var photo = welcomeRolePhotoElement(roleAtSelection);
        if (photo) photo.src = dataUrl;
        welcomeApplySimpleRolePhoto(roleAtSelection, dataUrl);
      } catch (e) { alert('The photo could not be saved. Please try another image.'); }
    };
    image.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

function welcomeRemoveProfilePhoto() {
  var role = welcomeNormalisePhotoRole(welcomePhotoRole);
  var key = welcomePhotoKeyAtSelection || welcomeRolePhotoStorageKey(role);
  try { if (key) localStorage.removeItem(key); } catch (e) {}
  var photo = welcomeRolePhotoElement(role);
  if (photo) {
    if (role === 'viewer') {
      var player = (typeof getMyPlayer === 'function') ? getMyPlayer() : null;
      photo.src = player && player.gender === 'Female' ? 'female.png' : 'male.png';
    } else photo.src = 'male.png';
  }
  welcomeApplySimpleRolePhoto(role, '');
  welcomeClosePhotoMenu();
}

function welcomeFlattenSlotMap(map) {
  var out = [];
  Object.keys(map || {}).forEach(function(date) { (map[date] || []).forEach(function(slot) { if (slot) out.push(slot); }); });
  return out;
}

function welcomeFindNextOrganiserSlot(slots) {
  var today = typeof localDateStr === 'function'
    ? localDateStr(new Date())
    : new Date().toISOString().slice(0,10);
  var now = new Date();
  var minutesNow = now.getHours() * 60 + now.getMinutes();
  return (slots || []).filter(function(slot) {
    var status = String(slot.status || '').toLowerCase();
    if (status !== 'posted' || String(slot.slot_date || '') !== today || slot.played_session_id) return false;
    var endParts = String(slot.end_time || '').match(/^(\d{1,2}):(\d{2})/);
    if (endParts) {
      var endMinutes = (parseInt(endParts[1], 10) || 0) * 60 + (parseInt(endParts[2], 10) || 0);
      if (minutesNow >= endMinutes) return false;
    }
    return true;
  }).sort(function(a,b) {
    return (String(a.slot_date || '') + ' ' + String(a.start_time || ''))
      .localeCompare(String(b.slot_date || '') + ' ' + String(b.start_time || ''));
  })[0] || null;
}

function welcomeRenderOrganiserClubPills() {
  var organiser = (window.__scsWelcomeHubData && window.__scsWelcomeHubData.organiser) || {};
  var clubs = Array.isArray(organiser.clubs) ? organiser.clubs : [];
  // On a first login the selected organiser club can be restored before the
  // memberships/options request has finished (or when that request briefly
  // fails).  The card still has a valid resolved clubId/clubName, so use it as
  // a one-item display option instead of hiding the pill until another refresh.
  if (!clubs.length && organiser.clubId) {
    clubs = [{
      id: String(organiser.clubId),
      name: organiser.clubName || localStorage.getItem('kbrr_org_club_name') || 'Club',
      source: 'resolved'
    }];
  }
  var savedId = String(localStorage.getItem('kbrr_org_club_id') || '');
  var selectedId = clubs.some(function(club) { return String(club.id) === savedId; })
    ? savedId
    : String(window.__scsWelcomeOrganiserChoice || organiser.clubId || '');
  var selectedClub = clubs.find(function(club) {
    return String(club.id) === selectedId;
  }) || clubs[0] || null;
  var containers = [
    document.getElementById('welcomeOrganiserClubPills'),
    document.getElementById('simpleRoundClubPills')
  ].filter(Boolean);
  var fallbackName = document.getElementById('welcomeOrganiserName');
  if (!containers.length) return;
  if (!selectedClub) {
    containers.forEach(function(container) {
      container.innerHTML = '';
      container.hidden = true;
    });
    if (fallbackName) fallbackName.hidden = false;
    return;
  }
  if (fallbackName) fallbackName.hidden = true;
  containers.forEach(function(container) {
    container.hidden = false;
    container.innerHTML =
      '<span class="welcome-club-pill welcome-club-menu-pill selected" role="button" tabindex="0"' +
        ' aria-haspopup="dialog" data-club-id="' + organiserAccessEscape(selectedClub.id) + '"' +
        ' title="' + organiserAccessEscape(selectedClub.name || selectedClub.id) + '">' +
        '<span class="welcome-club-pill-name">' + organiserAccessEscape(selectedClub.name || selectedClub.id) + '</span>' +
        '<span class="welcome-club-pill-arrow" aria-hidden="true">⌄</span></span>';
    var pill = container.querySelector('.welcome-club-menu-pill');
    if (pill) {
      pill.addEventListener('click', welcomeOpenOrganiserClubMenu);
      pill.addEventListener('keydown', function(event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          welcomeOpenOrganiserClubMenu(event);
        }
      });
    }
  });
}

async function welcomeOpenOrganiserClubMenu(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  var organiser = (window.__scsWelcomeHubData && window.__scsWelcomeHubData.organiser) || {};
  var clubs = Array.isArray(organiser.clubs) ? organiser.clubs : [];
  if (!clubs.length && organiser.clubId) {
    clubs = [{
      id: String(organiser.clubId),
      name: organiser.clubName || localStorage.getItem('kbrr_org_club_name') || 'Club',
      source: 'resolved'
    }];
  }
  if (!clubs.length) {
    if (typeof showToast === 'function') showToast('No organiser clubs are available.');
    return;
  }
  var selected = await showOrganiserAccessMenu(clubs, { directSelect: true });
  if (selected && selected.id) {
    await welcomeSelectOrganiserClub(selected.id);
  }
}

async function welcomeSelectOrganiserClub(clubId) {
  var organiser = (window.__scsWelcomeHubData && window.__scsWelcomeHubData.organiser) || {};
  var clubs = Array.isArray(organiser.clubs) ? organiser.clubs : [];
  var selected = clubs.find(function(club) { return String(club.id) === String(clubId || ''); });
  if (!selected) return;

  window.__scsWelcomeOrganiserChoice = String(selected.id);
  organiser.clubId = String(selected.id);
  organiser.clubName = selected.name || '';
  organiser.nextSlot = null;
  syncRoundAndSlotManagerClub(String(selected.id), selected.name || '');
  // Keep the active club used by both Round Manager and Slot Manager in
  // sync with the club selected on the Welcome page.
  if (typeof setMyClub === 'function') setMyClub(String(selected.id), selected.name || '');
  sessionStorage.setItem('scs_organiser_verified', '1');
  localStorage.setItem('scs_organiser_verified', '1');
  welcomeRenderOrganiserClubPills();
  welcomeLoadRoleHubData('organiser');

  var containers = [document.getElementById('welcomeOrganiserClubPills'), document.getElementById('simpleRoundClubPills')].filter(Boolean);
  containers.forEach(function(container) { container.classList.add('is-loading'); });
  try {
    var today = typeof localDateStr === 'function' ? localDateStr(new Date()) : new Date().toISOString().slice(0,10);
    var endDate = new Date();
    endDate.setDate(endDate.getDate() + 60);
    var end = typeof localDateStr === 'function' ? localDateStr(endDate) : endDate.toISOString().slice(0,10);
    var slots = typeof dbGetSlotsForRange === 'function'
      ? await dbGetSlotsForRange(selected.id, today, today).catch(function() { return []; })
      : [];
    organiser.nextSlot = welcomeFindNextOrganiserSlot(slots);
    welcomeLoadRoleHubData('organiser');
  } finally {
    containers.forEach(function(container) { container.classList.remove('is-loading'); });
  }
}

async function scsPrefetchWelcomeHubData(force) {
  if (window.__scsWelcomeHubRefreshPromise) {
    if (!force) return window.__scsWelcomeHubRefreshPromise;
    var currentRefresh = window.__scsWelcomeHubRefreshPromise;
    return currentRefresh.then(function() {
      // The current promise clears the shared reference in its finally handler
      // before this continuation, so this performs a fresh authenticated read.
      return scsPrefetchWelcomeHubData(false);
    }, function() {
      return scsPrefetchWelcomeHubData(false);
    });
  }
  var generation = ++window.__scsWelcomeHubRefreshGeneration;
  window.__scsWelcomeHubRefreshPromise = (async function() {
  var today = typeof localDateStr === 'function' ? localDateStr(new Date()) : new Date().toISOString().slice(0,10);
  var endDate = new Date();
  endDate.setDate(endDate.getDate() + 60);
  var end = typeof localDateStr === 'function' ? localDateStr(endDate) : endDate.toISOString().slice(0,10);
  var user = (typeof authGetUser === 'function') ? authGetUser() : null;

  // Player hub uses the same account-linked memberships and aggregation as
  // My Card. The small local player profile contains only identity fields and
  // must not be used as the source of rating or points.
  var playerMemberships = [];
  if (user && user.id && typeof sbGet === 'function') {
    playerMemberships = await sbGet('memberships',
      'user_account_id=eq.' + encodeURIComponent(user.id) +
      '&select=player_id,club_id,club_rating,club_points').catch(function(error) {
        console.warn('Player hub prefetch failed:', error);
        return [];
      });
  }
  var ratingTotal = 0;
  var ratingCount = (playerMemberships || []).length;
  var pointsTotal = 0;
  (playerMemberships || []).forEach(function(membership) {
    var rating = parseFloat(membership.club_rating);
    if (Number.isFinite(rating)) ratingTotal += rating;
    var points = parseFloat(membership.club_points);
    if (Number.isFinite(points)) pointsTotal += points;
  });
  var playerIds = Array.from(new Set((playerMemberships || []).map(function(membership) {
    return membership && membership.player_id ? String(membership.player_id) : '';
  }).filter(Boolean)));
  if (user && user.id && typeof sbGet === 'function') {
    var accountPlayers = await sbGet('players',
      'user_account_id=eq.' + encodeURIComponent(user.id) + '&select=id').catch(function() { return []; });
    (accountPlayers || []).forEach(function(playerRow) {
      if (playerRow && playerRow.id && playerIds.indexOf(String(playerRow.id)) < 0) {
        playerIds.push(String(playerRow.id));
      }
    });
  }
  var bookedSlots = 0;
  if (playerIds.length && typeof sbGet === 'function') {
    var bookedClaims = await sbGet('slot_claims',
      'player_id=in.(' + playerIds.join(',') + ')&status=eq.confirmed&select=slot_id').catch(function() { return []; });
    var bookedSlotIds = Array.from(new Set((bookedClaims || []).map(function(claim) {
      return claim && claim.slot_id ? String(claim.slot_id) : '';
    }).filter(Boolean)));
    if (bookedSlotIds.length) {
      var bookedRows = await sbGet('slots',
        'id=in.(' + bookedSlotIds.join(',') + ')&slot_date=gte.' + today +
        '&status=in.(posted,scheduled)&select=id').catch(function() { return []; });
      bookedSlots = new Set((bookedRows || []).map(function(slot) { return String(slot.id); })).size;
    }
  }
  var clubCount = new Set((playerMemberships || []).map(function(membership) {
    return membership && membership.club_id ? String(membership.club_id) : '';
  }).filter(Boolean)).size;
  var localPlayer = (typeof getMyPlayer === 'function') ? getMyPlayer() : null;
  var playerData = {
    name: (user && (user.nickname || user.displayName)) ||
      (localPlayer && (localPlayer.displayName || localPlayer.name || localPlayer.nickname)) || 'Player',
    gender: (user && user.gender) || (localPlayer && localPlayer.gender) || 'Male',
    clubs: clubCount,
    bookedSlots: bookedSlots,
    rating: ratingCount ? ratingTotal / ratingCount : 0,
    points: pointsTotal
  };

  // Organiser access follows membership. Resolve the current/first eligible
  // club before querying slots instead of assuming its localStorage keys were
  // already populated when the document started.
  var organiserOptions = (typeof getOrganiserEligibleClubs === 'function')
    ? await getOrganiserEligibleClubs(user).catch(function() { return []; })
    : [];
  var cachedOrganiserId = localStorage.getItem('kbrr_org_club_id') || '';
  var organiserClub = (organiserOptions || []).find(function(club) {
    return String(club.id) === String(cachedOrganiserId);
  }) || (organiserOptions && organiserOptions[0]) || null;
  var organiserClubId = organiserClub ? String(organiserClub.id || '') : cachedOrganiserId;
  var organiserClubName = (organiserClub && organiserClub.name) ||
    localStorage.getItem('kbrr_org_club_name') || 'Club';
  var vaultClubId = localStorage.getItem('kbrr_vault_club_id') || '';
  var vaultClubName = localStorage.getItem('kbrr_vault_club_name') || 'Club';
  // On a fresh document the persisted role can be restored slightly later
  // than the first Welcome data request. Resolve the verified grant directly
  // so the initial Slot Manager card does not miss its slot/request badges.
  if (!vaultClubId && user && user.id && typeof getLinkedManagementClub === 'function') {
    var linkedVaultClub = await getLinkedManagementClub('vault').catch(function() { return null; });
    if (linkedVaultClub && linkedVaultClub.id) {
      vaultClubId = String(linkedVaultClub.id);
      vaultClubName = linkedVaultClub.name || vaultClubName;
    }
  }

  var organiserSlots = [];
  if (organiserClubId && typeof dbGetSlotsForRange === 'function') {
    organiserSlots = await dbGetSlotsForRange(organiserClubId, today, today).catch(function(error) {
      console.warn('Organiser hub prefetch failed:', error); return [];
    });
  }
  var next = welcomeFindNextOrganiserSlot(organiserSlots);
  var organiserData = {
    clubId: organiserClubId,
    clubName: organiserClubName,
    clubs: organiserOptions || [],
    nextSlot: next
  };

  var members = [];
  if (vaultClubId && typeof sbGet === 'function') {
    members = await sbGet('memberships', 'club_id=eq.' + encodeURIComponent(vaultClubId) + '&select=id').catch(function(error) {
      console.warn('Club member hub prefetch failed:', error); return [];
    });
  }
  // Query the authoritative slot range directly. The Vault calendar map may
  // still be empty when Welcome opens even though the workspace later loads it.
  var vaultSlots = [];
  if (vaultClubId && typeof dbGetSlotsForRange === 'function') {
    vaultSlots = await dbGetSlotsForRange(vaultClubId, today, end).catch(function(error) {
      console.warn('Club slot hub prefetch failed:', error); return [];
    });
  }
  var activeSlots = (vaultSlots || []).filter(function(slot) {
    var status = String(slot.status || '').toLowerCase();
    return ['posted','scheduled'].indexOf(status) >= 0 && String(slot.slot_date || '') >= today && !slot.played_session_id;
  });
  var postedSlots = (vaultSlots || []).filter(function(slot) {
    return String(slot.status || '').toLowerCase() === 'posted' &&
      String(slot.slot_date || '') >= today && !slot.played_session_id;
  });
  var draftSlots = (vaultSlots || []).filter(function(slot) {
    return String(slot.status || '').toLowerCase() === 'draft' &&
      String(slot.slot_date || '') >= today && !slot.played_session_id;
  });
  postedSlots.sort(function(a, b) {
    return String(a.slot_date || '').localeCompare(String(b.slot_date || '')) ||
      String(a.start_time || '').localeCompare(String(b.start_time || ''));
  });
  // Club Manager owns posted, scheduled and draft future slots. Show the
  // earliest one on Welcome; pending approvals still come only from posted
  // slots because only those can receive player join requests.
  var manageableUpcomingSlots = activeSlots.concat(draftSlots).sort(function(a, b) {
    return String(a.slot_date || '').localeCompare(String(b.slot_date || '')) ||
      String(a.start_time || '').localeCompare(String(b.start_time || ''));
  });
  var nextVaultSlot = manageableUpcomingSlots[0] || null;
  var pendingVaultSlots = postedSlots.filter(function(slot) {
    return (slot.claims || []).some(function(claim) {
      return String(claim && claim.status || '').toLowerCase() === 'pending';
    });
  });
  var pendingApprovalCount = pendingVaultSlots.reduce(function(total, slot) {
    return total + (slot.claims || []).filter(function(claim) {
      return String(claim && claim.status || '').toLowerCase() === 'pending';
    }).length;
  }, 0);
  var slotLinkedClubRequestIds = new Set();
  (vaultSlots || []).forEach(function(slot) {
    (slot.claims || []).forEach(function(claim) {
      var request = claim && claim.player && claim.player.clubJoinRequest;
      if (request && request.id) slotLinkedClubRequestIds.add(String(request.id));
    });
  });
  var pendingClubJoinRequests = [];
  if (vaultClubId && typeof sbGet === 'function') {
    pendingClubJoinRequests = await sbGet('club_join_requests',
      'club_id=eq.' + encodeURIComponent(vaultClubId) +
      '&status=eq.pending&select=id,user_account_id,nickname,requested_rating,requested_at&order=requested_at.asc'
    ).catch(function() { return []; });
    pendingClubJoinRequests = (pendingClubJoinRequests || []).filter(function(request) {
      return !slotLinkedClubRequestIds.has(String(request && request.id || ''));
    });
  }
  pendingApprovalCount += pendingClubJoinRequests.length;
  var unpaidCount = 0;
  (vaultSlots || []).forEach(function(slot) {
    var cost = typeof _vsSlotCostPerPlayer === 'function'
      ? _vsSlotCostPerPlayer(slot)
      : Number(slot && slot.cost_per_player || 0);
    if (!(cost > 0)) return;
    (slot.claims || []).forEach(function(claim) {
      if (String(claim && claim.status || '').toLowerCase() === 'confirmed' && !claim.paid_at) {
        unpaidCount += 1;
      }
    });
  });
  var vaultData = {
    clubId: vaultClubId,
    clubName: vaultClubName,
    members: members.length,
    activeSlots: activeSlots.length,
    postedSlots: postedSlots.length,
    draftSlots: draftSlots.length,
    unpaid: unpaidCount,
    nextSlot: nextVaultSlot,
    pendingApprovals: pendingApprovalCount,
    pendingSlotId: pendingVaultSlots[0] ? pendingVaultSlots[0].id : '',
    pendingSlotIds: pendingVaultSlots.map(function(slot) { return slot.id; }),
    pendingClubRequests: pendingClubJoinRequests
  };

  if (generation === window.__scsWelcomeHubRefreshGeneration) {
    window.__scsWelcomeHubData = {
      player: playerData,
      organiser: organiserData,
      vault: vaultData,
      refreshedAt: Date.now()
    };
    welcomeApplyAllHubData();
  }
  return window.__scsWelcomeHubData;
  })().finally(function() {
    window.__scsWelcomeHubRefreshPromise = null;
  });
  return window.__scsWelcomeHubRefreshPromise;
}
window.scsPrefetchWelcomeHubData = scsPrefetchWelcomeHubData;

function welcomeApplyPlayerHubData() {
  var data = (window.__scsWelcomeHubData && window.__scsWelcomeHubData.player) || null;
  if (!data) return;
  var photo = document.getElementById('welcomePlayerPhoto');
  var nameEl = document.getElementById('welcomePlayerName');
  var ratingEl = document.getElementById('welcomePlayerRating');
  var pointsEl = document.getElementById('welcomePlayerPoints');
  var clubsEl = document.getElementById('welcomePlayerClubs');
  var bookedEl = document.getElementById('welcomePlayerBookedSlots');
  if (photo) photo.src = welcomeGetSavedRolePhoto('viewer') ||
    (data.gender === 'Female' ? 'female.png' : 'male.png');
  welcomeApplySimpleRolePhoto('viewer');
  if (nameEl) {
    nameEl.textContent = data.name || 'Player';
    nameEl.hidden = false;
  }
  var simpleNameEl = document.getElementById('simpleMyNickname');
  if (simpleNameEl) simpleNameEl.textContent = data.name || 'Player';
  if (ratingEl) ratingEl.textContent = Number(data.rating || 0).toFixed(1);
  if (pointsEl) pointsEl.textContent = Number(data.points || 0).toFixed(1);
  if (clubsEl) clubsEl.textContent = String(Number(data.clubs || 0));
  if (bookedEl) bookedEl.textContent = String(Number(data.bookedSlots || 0));
}

async function welcomeLoadRoleHubData(mode) {
  var data = window.__scsWelcomeHubData || {};
  if (mode === 'organiser') {
    var organiser = data.organiser || {};
    var orgPhoto = document.getElementById('welcomeOrganiserPhoto');
    if (orgPhoto) orgPhoto.src = welcomeGetSavedRolePhoto('organiser') || 'male.png';
    welcomeApplySimpleRolePhoto('organiser');
    var orgName = document.getElementById('welcomeOrganiserName');
    if (orgName) orgName.textContent = organiser.clubName || localStorage.getItem('kbrr_org_club_name') || 'Club';
    var savedOrganiserId = localStorage.getItem('kbrr_org_club_id') || '';
    if (savedOrganiserId || organiser.clubId) {
      window.__scsWelcomeOrganiserChoice = String(savedOrganiserId || organiser.clubId);
    }
    welcomeRenderOrganiserClubPills();
    var title = document.getElementById('welcomeOrganiserNextSlotTitle');
    var meta = document.getElementById('welcomeOrganiserNextSlotMeta');
    var roundTile = document.getElementById('welcomeOrganiserNextSlot');
    var next = organiser.nextSlot || null;
    if (next) {
      if (title) title.textContent = organiser.clubName || next._viewerClubName || 'Club';
      if (meta) meta.textContent = String(next.slot_date || '') + ' · ' + String(next.start_time || '').slice(0,5) + (next.venue ? ' · ' + next.venue : '');
      if (roundTile) {
        roundTile.classList.add('has-slot');
        roundTile.setAttribute('aria-disabled', 'false');
        roundTile.setAttribute('tabindex', '0');
      }
    } else {
      if (title) title.textContent = 'No slot today';
      if (meta) meta.textContent = 'A posted slot today will appear here.';
      if (roundTile) {
        roundTile.classList.remove('has-slot', 'is-opening');
        roundTile.setAttribute('aria-disabled', 'true');
        roundTile.setAttribute('tabindex', '-1');
      }
    }
  }
  if (mode === 'vault') {
    var vaultVerified = hasVerifiedWorkspaceRole('vault');
    var simpleSlotStatus = document.getElementById('simpleSlotStatus');
    var simpleSlotNext = document.getElementById('simpleSlotNext');
    var simpleSlotPending = document.getElementById('simpleSlotPending');
    // Never paint cached slot/request data for a logged-out Club workspace.
    if (!vaultVerified) {
      if (simpleSlotNext) { simpleSlotNext.hidden = true; simpleSlotNext.textContent = ''; simpleSlotNext.dataset.slotId = ''; }
      if (simpleSlotPending) { simpleSlotPending.hidden = true; simpleSlotPending.textContent = ''; simpleSlotPending.dataset.slotId = ''; }
      if (simpleSlotStatus) simpleSlotStatus.hidden = true;
      updateWelcomeWorkspaceClubNames();
      return;
    }
    var vault = data.vault || {};
    var vaultPhoto = document.getElementById('welcomeVaultPhoto');
    if (vaultPhoto) vaultPhoto.src = welcomeGetSavedRolePhoto('vault') || 'male.png';
    welcomeApplySimpleRolePhoto('vault');
    var vaultName = document.getElementById('welcomeVaultName');
    if (vaultName) vaultName.textContent = vault.clubName || localStorage.getItem('kbrr_vault_club_name') || 'Club';
    var simpleVaultName = document.getElementById('simpleSlotClubName');
    if (simpleVaultName) simpleVaultName.textContent = vault.clubName || localStorage.getItem('kbrr_vault_club_name') || 'Club';
    var membersEl = document.getElementById('welcomeVaultMembers');
    var postedEl = document.getElementById('welcomeVaultPostedSlots');
    var draftEl = document.getElementById('welcomeVaultDraftSlots');
    var unpaidEl = document.getElementById('welcomeVaultUnpaid');
    if (membersEl) membersEl.textContent = String(Number(vault.members || 0));
    if (postedEl) postedEl.textContent = String(Number(vault.postedSlots || 0));
    if (draftEl) draftEl.textContent = String(Number(vault.draftSlots || 0));
    if (unpaidEl) unpaidEl.textContent = String(Number(vault.unpaid || 0));
    var nextSlot = vault.nextSlot || null;
    if (simpleSlotNext) {
      if (nextSlot && nextSlot.id) {
        var nextDate = String(nextSlot.slot_date || '');
        try { nextDate = new Date(nextDate + 'T00:00:00').toLocaleDateString(undefined, { month:'short', day:'numeric' }); } catch (e) {}
        simpleSlotNext.textContent = 'Next: ' + nextDate + ' · ' + String(nextSlot.start_time || '').slice(0,5);
        simpleSlotNext.dataset.slotId = nextSlot.id;
        simpleSlotNext.hidden = false;
      } else {
        simpleSlotNext.hidden = true;
        simpleSlotNext.dataset.slotId = '';
      }
    }
    if (simpleSlotPending) {
      var pendingCount = Number(vault.pendingApprovals || 0);
      simpleSlotPending.textContent = pendingCount + ' Pending';
      simpleSlotPending.dataset.slotId = vault.pendingSlotId || '';
      simpleSlotPending.hidden = !pendingCount;
    }
    if (simpleSlotStatus) simpleSlotStatus.hidden = !(nextSlot && nextSlot.id) && !Number(vault.pendingApprovals || 0);
  }
}

function welcomeApplyAllHubData() {
  welcomeApplyPlayerHubData();
  welcomeLoadRoleHubData('organiser');
  welcomeLoadRoleHubData('vault');
  updateWelcomeWorkspaceClubNames();
}

var _welcomeUpdateHubCard422 = updateWelcomeHubCard;
updateWelcomeHubCard = function(mode) {
  _welcomeUpdateHubCard422(mode);
  welcomeApplyAllHubData();
};

function welcomeRefreshHubIfVisible(force) {
  var overlay = document.getElementById('modeSelectOverlay');
  if (!overlay || overlay.style.display === 'none' || document.visibilityState === 'hidden') return;
  var refreshedAt = Number(window.__scsWelcomeHubData && window.__scsWelcomeHubData.refreshedAt || 0);
  if (!force && refreshedAt && Date.now() - refreshedAt < 15000) {
    welcomeApplyAllHubData();
    return;
  }
  if (typeof window.scsPrefetchWelcomeHubData === 'function') {
    window.scsPrefetchWelcomeHubData(!!force).catch(function(error) {
      console.warn('Visible welcome hub refresh skipped:', error);
    });
  }
  // Welcome has its own new-slot check. Do not wait for My Hub to open.
  if (typeof window.scsNotificationsCheckNow === 'function') {
    window.scsNotificationsCheckNow();
  }
}
window.welcomeRefreshHubIfVisible = welcomeRefreshHubIfVisible;

document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') welcomeRefreshHubIfVisible(false);
});
window.addEventListener('pageshow', function() {
  welcomeRefreshHubIfVisible(false);
});


/* ── 30-minute in-app club invitation broadcast ── */
var __scsClubBroadcastTimer = null;
var __scsWelcomeBroadcast = null;

function scsBroadcastClubInfo() {
  var activeClub = (typeof getMyClub === 'function') ? getMyClub() : null;
  return {
    id: localStorage.getItem('kbrr_vault_club_id') || (activeClub && activeClub.id) || '',
    name: localStorage.getItem('kbrr_vault_club_name') || (activeClub && activeClub.name) || 'Your club'
  };
}
function scsBroadcastIsoNow(){ return new Date().toISOString(); }
async function scsGetActiveClubBroadcast(clubId) {
  if (!clubId || typeof sbGet !== 'function') return null;
  var rows = await sbGet('club_invite_broadcasts',
    'club_id=eq.' + encodeURIComponent(clubId) + '&stopped_at=is.null&expires_at=gt.' + encodeURIComponent(scsBroadcastIsoNow()) + '&select=id,club_id,club_name,expires_at&order=expires_at.desc&limit=1'
  ).catch(function(){ return []; });
  return rows && rows[0] || null;
}
function scsPaintBroadcastManager(row) {
  var state=document.getElementById('clubInviteBroadcastState'), start=document.getElementById('clubInviteBroadcastBtn'), stop=document.getElementById('clubInviteBroadcastStopBtn');
  if (!state) return;
  if (!row || !row.expires_at || new Date(row.expires_at).getTime() <= Date.now()) {
    state.textContent=t('notActive'); state.removeAttribute('data-i18n'); if(start) start.hidden=false; if(stop) stop.hidden=true;
    if(__scsClubBroadcastTimer){clearInterval(__scsClubBroadcastTimer);__scsClubBroadcastTimer=null;} return;
  }
  var sec=Math.max(0,Math.ceil((new Date(row.expires_at).getTime()-Date.now())/1000));
  state.textContent=t('active')+' · '+Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0')+' '+t('remaining');
  state.dataset.broadcastId=row.id||''; if(start) start.hidden=true; if(stop) stop.hidden=false;
}
async function scsRefreshBroadcastManager(){ var c=scsBroadcastClubInfo(); scsPaintBroadcastManager(await scsGetActiveClubBroadcast(c.id)); }
async function scsStartClubInviteBroadcast(){
  var c=scsBroadcastClubInfo(), user=(typeof authGetUser==='function'?authGetUser():null);
  if(!c.id){scsInvitePrototypeNotice('Select a club first');return;}
  var existing=await scsGetActiveClubBroadcast(c.id); if(existing){scsPaintBroadcastManager(existing);return;}
  var now=new Date(), expires=new Date(now.getTime()+30*60*1000);
  try {
    var rows=await sbPost('club_invite_broadcasts',{club_id:c.id,club_name:c.name,created_by:user&&user.id||null,starts_at:now.toISOString(),expires_at:expires.toISOString()});
    var row=Array.isArray(rows)?rows[0]:rows; row=row||{club_id:c.id,club_name:c.name,expires_at:expires.toISOString()};
    scsPaintBroadcastManager(row); scsInvitePrototypeNotice('Invite posted for 30 minutes');
    if(__scsClubBroadcastTimer)clearInterval(__scsClubBroadcastTimer); __scsClubBroadcastTimer=setInterval(scsRefreshBroadcastManager,1000);
  } catch(e){scsInvitePrototypeNotice('Could not post invite');}
}
async function scsStopClubInviteBroadcast(){
  var state=document.getElementById('clubInviteBroadcastState'), id=state&&state.dataset.broadcastId;
  if(id) await sbPatch('club_invite_broadcasts','id=eq.'+encodeURIComponent(id),{stopped_at:new Date().toISOString()}).catch(function(){});
  scsPaintBroadcastManager(null); scsInvitePrototypeNotice('Invite stopped');
}
async function welcomeRefreshClubBroadcast(){
  var host=document.getElementById('welcomeClubBroadcastInvite'); if(!host||typeof authGetUser!=='function'||!authGetUser())return;
  var data=window.__scsWelcomeHubData&&window.__scsWelcomeHubData.player;
  if(data && Number(data.clubs||0)>0){host.hidden=true;__scsWelcomeBroadcast=null;return;}
  var rows=await sbGet('club_invite_broadcasts','stopped_at=is.null&expires_at=gt.'+encodeURIComponent(scsBroadcastIsoNow())+'&select=id,club_id,club_name,expires_at&order=starts_at.desc&limit=1').catch(function(){return[];});
  var row=rows&&rows[0]; __scsWelcomeBroadcast=row||null;
  if(!row){host.hidden=true;return;}
  var name=document.getElementById('welcomeClubBroadcastName'), time=document.getElementById('welcomeClubBroadcastTime'); if(name)name.textContent=row.club_name||'Club';
  if(time){var min=Math.max(1,Math.ceil((new Date(row.expires_at).getTime()-Date.now())/60000));time.textContent=min+' min left';}
  host.hidden=false;
}
function welcomeOpenClubBroadcastInvite(){
  var row=__scsWelcomeBroadcast; if(!row)return;
  welcomeSelectWorkspace('viewer'); welcomeContinueWorkspace();
  setTimeout(function(){ if(typeof clubInviteJoinOpen==='function'){homeGo('clubInviteJoinPage',null);clubInviteJoinOpen(row.club_id,row.club_name||'Club');}},80);
}
window.welcomeOpenClubBroadcastInvite=welcomeOpenClubBroadcastInvite;

var __scsClubInviteUrl = '';

async function scsOpenClubInvite() {
  var sheet = document.getElementById('scsClubInviteSheet');
  if (!sheet) return;
  var activeClub = (typeof getMyClub === 'function') ? getMyClub() : null;
  var clubId = localStorage.getItem('kbrr_vault_club_id') || (activeClub && activeClub.id) || localStorage.getItem('kbrr_my_club_id') || '';
  var clubName = localStorage.getItem('kbrr_vault_club_name') || (activeClub && activeClub.name) || localStorage.getItem('kbrr_my_club_name') || 'Your club';
  var qrClub = document.getElementById('clubInviteQrClub');
  if (qrClub) qrClub.textContent = clubName;
  var linkText = document.getElementById('clubInviteLinkText');
  var appBase = location.origin + location.pathname;
  __scsClubInviteUrl = clubId ? (appBase + '?join=' + encodeURIComponent(clubId)) : '';
  if (linkText) linkText.textContent = __scsClubInviteUrl || 'No active club selected';
  scsRefreshBroadcastManager();
  sheet.hidden = false;
  requestAnimationFrame(function(){ sheet.classList.add('is-open'); });
}

async function scsCopyClubInviteLink() {
  if (!__scsClubInviteUrl) { scsInvitePrototypeNotice('Select a club first'); return; }
  try {
    await navigator.clipboard.writeText(__scsClubInviteUrl);
    scsInvitePrototypeNotice('Club request link copied');
  } catch (e) {
    scsInvitePrototypeNotice('Could not copy the link');
  }
}

async function scsShareClubInviteLink() {
  if (!__scsClubInviteUrl) { scsInvitePrototypeNotice('Select a club first'); return; }
  var clubName = document.getElementById('clubInviteQrClub')?.textContent || 'my club';
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Join ' + clubName, text: 'Send a request to join ' + clubName + '.', url: __scsClubInviteUrl });
      return;
    } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  scsCopyClubInviteLink();
}

function scsCloseClubInvite() {
  var sheet = document.getElementById('scsClubInviteSheet');
  if (!sheet) return;
  sheet.classList.remove('is-open');
  setTimeout(function(){ sheet.hidden = true; }, 180);
}


function scsShowClubInviteQr() {
  if (!__scsClubInviteUrl) { scsInvitePrototypeNotice('Select a club first'); return; }
  scsRenderClubInviteQr();
  var overlay = document.getElementById('clubInviteQrOverlay');
  if (overlay) overlay.hidden = false;
}
function scsHideClubInviteQr() {
  var overlay = document.getElementById('clubInviteQrOverlay');
  if (overlay) overlay.hidden = true;
}

function scsSetClubInviteView(view) {
  var qr = view === 'qr';
  var requestTab = document.getElementById('clubInviteRequestTab');
  var qrTab = document.getElementById('clubInviteQrTab');
  var requestView = document.getElementById('clubInviteRequestView');
  var qrView = document.getElementById('clubInviteQrView');
  if (requestTab) { requestTab.classList.toggle('is-active', !qr); requestTab.setAttribute('aria-selected', qr ? 'false' : 'true'); }
  if (qrTab) { qrTab.classList.toggle('is-active', qr); qrTab.setAttribute('aria-selected', qr ? 'true' : 'false'); }
  if (requestView) requestView.hidden = qr;
  if (qrView) qrView.hidden = !qr;
  if (qr) scsRenderClubInviteQr();
}

function scsRenderClubInviteQr() {
  var host = document.getElementById('clubInviteQrCode');
  if (!host || typeof qrcode !== 'function') return;
  var value = __scsClubInviteUrl || (location.origin + location.pathname);
  var qr = qrcode(0, 'H');
  qr.addData(value, 'Byte');
  qr.make();
  host.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 4, scalable: true });
  var svg = host.querySelector('svg');
  if (svg) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Secure member QR for ' + (document.getElementById('clubInviteQrClub')?.textContent || 'club'));
  }
}

function scsInvitePrototypeNotice(message) {
  var toast = document.getElementById('clubInvitePrototypeToast');
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(window.__scsInviteToastTimer);
  window.__scsInviteToastTimer = setTimeout(function(){ toast.hidden = true; }, 1800);
}


/* Build 1044 — primary Home / Round / Slot / Settings navigation. */
function scsCloseHomeQuickMenu() {
  var menu = document.getElementById('scsHomeQuickMenu');
  if (menu) menu.hidden = true;
}

function scsToggleHomeQuickMenu(event) {
  if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
  var menu = document.getElementById('scsHomeQuickMenu');
  if (!menu) return;
  menu.hidden = !menu.hidden;
  if (!menu.hidden) {
    scsRefreshHomeQuickClubControls();
    scsRefreshHomeQuickApprovalAction();
  }
}

async function scsRefreshHomeQuickApprovalAction() {
  var row = document.getElementById('scsQuickApprovePlayers');
  var label = document.getElementById('scsQuickApprovePlayersLabel');
  var clubLine = document.getElementById('scsQuickApproveClubName');
  var homeGroup = document.getElementById('myHubApprovePlayersGroup');
  var homeCount = document.getElementById('myHubApprovePlayersCount');
  var homeClub = document.getElementById('myHubApprovePlayersClub');
  if (!row && !homeGroup) return;

  var clubId = '';
  var clubName = '';
  try {
    clubId = localStorage.getItem('kbrr_org_club_id') || '';
    clubName = localStorage.getItem('kbrr_org_club_name') || '';
  } catch (_) {}

  if (row) { row.hidden = true; row.style.display = 'none'; }
  if (homeGroup) homeGroup.hidden = true;
  if (label) label.textContent = 'Approve Players';
  if (clubLine) clubLine.textContent = clubName || '';
  if (homeCount) homeCount.textContent = '0';
  if (homeClub) homeClub.textContent = clubName || '';
  if (!clubId || typeof sbGet !== 'function') return;

  try {
    var requests = await sbGet('club_join_requests', 'club_id=eq.' + encodeURIComponent(clubId) + '&status=eq.pending&select=id');
    var count = Array.isArray(requests) ? requests.length : 0;
    // The quick action is deliberately absent when there is nothing to approve.
    if (count <= 0) return;
    if (label) label.textContent = 'Approve Players (' + count + ')';
    if (row) { row.hidden = false; row.style.display = ''; }
    if (homeCount) homeCount.textContent = String(count);
    if (homeClub) homeClub.textContent = clubName || 'Pending club membership requests';
    if (homeGroup) homeGroup.hidden = false;
  } catch (_) {
    // On a temporary network/read failure keep the conditional action hidden.
  }
}

function scsHomeRoundSessionInProgress() {
  try {
    if (typeof sessionFinished !== 'undefined' && sessionFinished) return false;
    if (typeof allRounds !== 'undefined' && Array.isArray(allRounds) &&
        allRounds.some(function(round) { return !round || !round.isMbm; })) return true;
    if (typeof getMySessionId === 'function' && getMySessionId()) return true;
  } catch (_) {}
  return false;
}

function scsRefreshHomeQuickRoundAvailability() {
  var row = document.querySelector('.scs-home-quick-round-row');
  if (!row) return;
  var active = scsHomeRoundSessionInProgress();
  row.disabled = active;
  row.classList.toggle('is-session-active', active);
  row.setAttribute('aria-disabled', active ? 'true' : 'false');
  row.title = active ? 'A round session is already in progress. End it before starting another round.' : '';
  var title = row.querySelector('.scs-home-quick-copy > strong');
  if (title) title.textContent = active ? 'Round in Progress' : 'Start a Round';
}

function scsRefreshHomeQuickClubControls() {
  var roundEl = document.getElementById('scsQuickRoundClub');
  var slotEl = document.getElementById('scsQuickSlotClub');
  if (roundEl) {
    var roundName = localStorage.getItem('kbrr_org_club_name') || '';
    if (!roundName && window.__scsWelcomeHubData && window.__scsWelcomeHubData.organiser) {
      roundName = window.__scsWelcomeHubData.organiser.clubName || '';
    }
    roundEl.textContent = roundName || 'Select club';
    var roundNameLine = document.getElementById('scsQuickRoundClubName');
    if (roundNameLine) roundNameLine.textContent = roundName || 'Select a club';
    var registerNameLine = document.getElementById('scsQuickRegisterClubName');
    if (registerNameLine) registerNameLine.textContent = roundName || 'Select a club';
    roundEl.title = roundName ? 'Change Round Manager club' : 'Select Round Manager club';
  }
  scsRefreshHomeQuickRoundAvailability();
  if (slotEl) {
    var slotId = localStorage.getItem('kbrr_vault_club_id') || '';
    var slotName = localStorage.getItem('kbrr_vault_club_name') || '';
    var slotNameLine = document.getElementById('scsQuickSlotClubName');
    if (slotId) {
      if (slotNameLine) slotNameLine.textContent = slotName || 'Club';
      slotEl.innerHTML = '<svg class="scs-quick-slot-logout-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3M13 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></svg><span class="scs-quick-slot-logout-label">Logout</span>';
      slotEl.setAttribute('aria-label', 'Logout ' + (slotName || 'Slot Manager'));
    } else {
      if (slotNameLine) slotNameLine.textContent = 'Login to a club';
      slotEl.textContent = 'Login';
      slotEl.setAttribute('aria-label', 'Slot Manager login');
    }
    slotEl.title = slotId ? 'Logout ' + (slotName || 'Slot Manager') : 'Login to Slot Manager';
  }
}

async function scsQuickRoundClubMenu(event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  if (typeof welcomeOpenOrganiserClubMenu === 'function') await welcomeOpenOrganiserClubMenu(event);
  scsRefreshHomeQuickClubControls();
  scsRefreshHomeQuickApprovalAction();
}

async function scsQuickSlotClubAction(event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  var slotId = localStorage.getItem('kbrr_vault_club_id') || '';
  if (slotId) {
    if (typeof vaultLogoutClub === 'function') vaultLogoutClub();
    window.setTimeout(scsRefreshHomeQuickClubControls, 0);
    return;
  }
  if (typeof openVaultWorkspaceForAdmin === 'function') {
    await openVaultWorkspaceForAdmin('', false);
    scsRefreshHomeQuickClubControls();
    // Login from the quick menu is only a club authentication action. Return
    // to Home instead of treating the club-name control as Post a Slot.
    if (typeof switchMode === 'function') switchMode('viewer');
    var menu = document.getElementById('scsHomeQuickMenu');
    if (menu) menu.hidden = false;
    scsRefreshHomeQuickClubControls();
  }
}

function scsSetPrimarySafeArea(surface) {
  if (!document.body) return;
  var isHome = surface === 'home' || surface === 'viewer';
  var isLight = document.body.classList.contains('app-light') || document.documentElement.classList.contains('app-light');
  var shellBg = isLight ? '#f4f6fb' : '#0f0f13';

  document.body.classList.toggle('scs-home-active', isHome);
  document.body.classList.toggle('scs-nonhome-active', !isHome);

  // The iOS status bar is opaque (see apple-mobile-web-app-status-bar-style),
  // so the document no longer needs a synthetic safe-area overlay. Keep only
  // the real app shell neutral; workspace colours belong to their own cards.
  document.documentElement.style.backgroundColor = shellBg;
  document.body.style.backgroundColor = shellBg;
  var metaTheme = document.getElementById('metaThemeColor');
  if (metaTheme) metaTheme.setAttribute('content', shellBg);
}

function scsSyncPrimaryBottomNav(active) {
  // Keep the primary bar outside homePageOverlay so it remains available on
  // Settings and other linked pages even when the Home overlay is hidden.
  var primaryNav = document.getElementById('scsPrimaryBottomNav');
  if (primaryNav && primaryNav.parentElement !== document.body) document.body.appendChild(primaryNav);
  var map = { viewer:'scsNavHome', organiser:'scsNavRound', vault:'scsNavSlot', settings:'scsNavSettings' };
  Object.keys(map).forEach(function(key) {
    var el = document.getElementById(map[key]);
    if (el) el.classList.toggle('is-active', key === active);
  });
  var add = document.getElementById('scsHomeAddBtn');
  if (add) add.style.display = active === 'viewer' ? '' : 'none';

  // Keep the iOS safe-area/status-bar background blue only on Home.
  scsSetPrimarySafeArea(active === 'viewer' ? 'home' : 'nonhome');

  // Build 1064: the SCS identity/title header belongs to Home only.
  // Round Manager, Slot Manager and Settings start directly with their content.
  var appHeader = document.querySelector('#homePageOverlay .home-app-header');
  if (appHeader) appHeader.style.display = active === 'viewer' ? '' : 'none';
}

// Remember exactly where Settings was opened from so closing it returns there.
// This applies to Home, Round Manager, Slot Manager and any visible inner page.
window.__scsSettingsReturnState = window.__scsSettingsReturnState || null;

function scsCaptureSettingsReturnState() {
  var settings = document.getElementById('settingsPage');
  if (settings && settings.style.display !== 'none') return;

  var visiblePage = null;
  document.querySelectorAll('.page').forEach(function(page) {
    if (!visiblePage && page.id !== 'settingsPage' && getComputedStyle(page).display !== 'none') {
      visiblePage = page.id;
    }
  });

  var home = document.getElementById('homePageOverlay');
  var homeVisible = !!(home && getComputedStyle(home).display !== 'none');
  var workspace = (typeof appMode !== 'undefined' && appMode) ? appMode : 'viewer';
  var activePrimary = 'viewer';
  if (document.getElementById('scsNavRound') && document.getElementById('scsNavRound').classList.contains('is-active')) activePrimary = 'organiser';
  else if (document.getElementById('scsNavSlot') && document.getElementById('scsNavSlot').classList.contains('is-active')) activePrimary = 'vault';
  else if (document.getElementById('scsNavHome') && document.getElementById('scsNavHome').classList.contains('is-active')) activePrimary = 'viewer';
  else if (workspace === 'organiser' || workspace === 'vault' || workspace === 'viewer') activePrimary = workspace;

  var myHubView = 'home';
  var activeHubTab = document.querySelector('.myhub-top-tab.is-active');
  if (activeHubTab) {
    var txt = (activeHubTab.textContent || '').trim().toLowerCase();
    if (txt === 'slots' || txt === 'clubs' || txt === 'report' || txt === 'home') myHubView = txt;
  }

  window.__scsSettingsReturnState = {
    pageId: visiblePage,
    homeVisible: homeVisible,
    workspace: workspace,
    primary: activePrimary,
    myHubView: myHubView
  };
}

function scsCloseSettings() {
  var settings = document.getElementById('settingsPage');
  if (settings) settings.style.display = 'none';
  var home = document.getElementById('homePageOverlay');
  if (home) home.classList.remove('settings-open');

  var state = window.__scsSettingsReturnState;
  window.__scsSettingsReturnState = null;
  if (!state) {
    if (typeof showHomeScreen === 'function') showHomeScreen();
    return;
  }

  // If Settings was opened from an inner page, restore that exact page.
  if (state.pageId && document.getElementById(state.pageId)) {
    if (typeof showPage === 'function') showPage(state.pageId, null);
    if (typeof scsSyncPrimaryBottomNav === 'function') scsSyncPrimaryBottomNav(state.primary || state.workspace || 'viewer');
    return;
  }

  // Otherwise restore the exact workspace home and, for My Hub, its selected top tab.
  if (state.workspace === 'organiser' || state.workspace === 'vault' || state.workspace === 'viewer') {
    try { appMode = state.workspace; } catch (_) {}
    try { welcomeSelectedWorkspace = state.workspace; } catch (_) {}
    try { sessionStorage.setItem('appMode', state.workspace); } catch (_) {}
    try { localStorage.setItem('kbrr_app_mode', state.workspace); } catch (_) {}
    if (typeof applyMode === 'function') { try { applyMode(state.workspace); } catch (_) {} }
  }
  if (typeof showHomeScreen === 'function') showHomeScreen();
  if (state.workspace === 'viewer' && state.myHubView && typeof setMyHubTopTabView === 'function') {
    try { setMyHubTopTabView(state.myHubView); } catch (_) {}
  }
  if (typeof scsSyncPrimaryBottomNav === 'function') scsSyncPrimaryBottomNav(state.primary || state.workspace || 'viewer');
}

function scsPrimaryNavigate(target) {
  scsCloseHomeQuickMenu();
  if (target === 'settings') {
    scsCaptureSettingsReturnState();
    scsSyncPrimaryBottomNav('settings');
    if (typeof homeGo === 'function') homeGo('settingsPage', 'tabBtnSettings');
    return;
  }

  // Bottom-bar Round is a Continue shortcut while an organiser session is live.
  // With no live session it keeps the existing behaviour and opens Round Manager.
  if (target === 'organiser') {
    welcomeSelectedWorkspace = 'organiser';
    var existingSessionId = typeof getMySessionId === 'function' ? getMySessionId() : null;
    var hasExistingRounds = typeof allRounds !== 'undefined' && Array.isArray(allRounds) && allRounds.length > 0;
    var liveSessionAvailable = (existingSessionId || hasExistingRounds) &&
      (typeof sessionFinished === 'undefined' || !sessionFinished);

    if (liveSessionAvailable) {
      appMode = 'organiser';
      try { sessionStorage.setItem('appMode', 'organiser'); } catch (_) {}
      try { localStorage.setItem('kbrr_app_mode', 'organiser'); } catch (_) {}
      if (typeof applyMode === 'function') applyMode('organiser');
      if (typeof updateModePill === 'function') updateModePill('organiser');
      scsSyncPrimaryBottomNav('organiser');
      var modeOverlay = document.getElementById('modeSelectOverlay');
      if (modeOverlay) modeOverlay.style.display = 'none';
      if (typeof homeHideScreen === 'function') homeHideScreen();
      if (typeof showPage === 'function') {
        showPage('roundsPage', document.getElementById('tabBtnRounds'));
      } else {
        var roundsPage = document.getElementById('roundsPage');
        if (roundsPage) roundsPage.style.display = 'block';
      }
      if (hasExistingRounds && typeof showRound === 'function') {
        var roundIndex = typeof currentRoundIndex === 'number' ? currentRoundIndex : allRounds.length - 1;
        showRound(Math.max(0, Math.min(roundIndex, allRounds.length - 1)));
      }
      return;
    }
  }

  if (target === 'viewer') welcomeSelectedWorkspace = 'viewer';
  if (target === 'vault') {
    welcomeSelectedWorkspace = 'vault';
    window._scsVaultAddSlotMode = false;
    // Bottom Slot always opens the Slot Manager overview. If a manager club is
    // already authenticated, reuse it directly; otherwise keep the existing
    // Slot Manager login flow.
    var savedVaultClub = '';
    var vaultVerified = false;
    try {
      savedVaultClub = localStorage.getItem('kbrr_vault_club_id') || '';
      vaultVerified = sessionStorage.getItem('scs_vault_verified') === '1' || localStorage.getItem('scs_vault_verified') === '1';
    } catch (_) {}

    // Navigation back to an already-authenticated Slot Manager must not depend
    // on a new network role lookup. Reuse the verified local manager session.
    if (savedVaultClub && vaultVerified) {
      appMode = 'vault';
      try { sessionStorage.setItem('appMode', 'vault'); } catch (_) {}
      try { localStorage.setItem('kbrr_app_mode', 'vault'); } catch (_) {}
      if (typeof applyMode === 'function') applyMode('vault');
      if (typeof updateModePill === 'function') updateModePill('vault');
      if (typeof showHomeScreen === 'function') showHomeScreen();
      window._scsVaultAddSlotMode = false;
      if (typeof _vhsExpandedOverview !== 'undefined') _vhsExpandedOverview = null;
      if (typeof renderVaultHomeSlotsUI === 'function') {
        Promise.resolve(renderVaultHomeSlotsUI(true)).catch(function(e){ console.warn('Slot Manager overview render skipped:', e); });
      }
      scsSyncPrimaryBottomNav('vault');
      return;
    }

    // No authenticated manager session: use the existing Slot Manager login flow.
    if (typeof openVaultWorkspaceForAdmin === 'function') {
      Promise.resolve(openVaultWorkspaceForAdmin(savedVaultClub, false)).then(function(opened) {
        if (!opened) return;
        window._scsVaultAddSlotMode = false;
        if (typeof _vhsExpandedOverview !== 'undefined') _vhsExpandedOverview = null;
        if (typeof renderVaultHomeSlotsUI === 'function') {
          return renderVaultHomeSlotsUI(true);
        }
      }).then(function() { scsSyncPrimaryBottomNav('vault'); }).catch(function(error) {
        console.error('Could not open Slot Manager:', error);
        if (typeof showToast === 'function') showToast(error && error.message ? error.message : 'Could not open Slot Manager');
      });
      return;
    }
  }
  switchMode(target);
}

async function scsOpenPostSlotManager() {
  // Home + > Post a Slot must land on the established Slot Manager HOME shown
  // in the old app (Upcoming/Completed calendar with the inline + Add Slot).
  // Do not route through the hidden legacy vaultSlotsPage and do not open the
  // composer automatically.  Resolve/authenticate the manager club first,
  // then paint the normal Vault home and its existing slot calendar.
  if (typeof canAccessMode === 'function' && !canAccessMode('vault')) {
    if (typeof showModeUpgradePrompt === 'function') showModeUpgradePrompt('vault');
    return false;
  }
  if (typeof authIsLoggedIn === 'function' && !authIsLoggedIn()) {
    try { sessionStorage.setItem('scs_pending_workspace', 'vault'); } catch (e) {}
    welcomeSelectedWorkspace = 'vault';
    if (typeof authShowScreen === 'function') authShowScreen('login');
    return false;
  }

  try { sessionStorage.removeItem('scs_home_quick_action'); } catch (e) {}
  welcomeSelectedWorkspace = 'vault';
  window._scsVaultAddSlotMode = true;
  var savedVaultClub = '';
  try { savedVaultClub = localStorage.getItem('kbrr_vault_club_id') || ''; } catch (e) {}

  var opened = await openVaultWorkspaceForAdmin(savedVaultClub, false);
  if (!opened) return false;

  // openVaultWorkspaceForAdmin already sets appMode='vault' and calls
  // showHomeScreen(). Repeat only the lightweight render/positioning here so
  // this quick action always finishes on the visible Slot Manager calendar.
  if (typeof renderVaultHomeSlotsUI === 'function') {
    try { await renderVaultHomeSlotsUI(true); } catch (e) { console.warn('Slot Manager calendar render skipped:', e); }
  }
  window.requestAnimationFrame(function() {
    var slotCard = document.getElementById('vaultUpcomingSlots');
    if (slotCard) {
      try { slotCard.scrollIntoView({ block:'start' }); } catch (e) {}
    }
  });
  return true;
}

function scsHomeQuickAction(action) {
  if (action === 'round' && scsHomeRoundSessionInProgress()) {
    scsRefreshHomeQuickRoundAvailability();
    return;
  }
  scsCloseHomeQuickMenu();
  if (action === 'round') {
    welcomeSelectedWorkspace = 'organiser';
    if (typeof scsSetPrimarySafeArea === 'function') scsSetPrimarySafeArea('nonhome');
    switchMode('organiser');
    return;
  }
  if (action === 'slot') {
    scsOpenPostSlotManager().catch(function(error) {
      console.error('Could not open Slot Manager for Post a Slot:', error);
      if (typeof showToast === 'function') showToast(error && error.message ? error.message : 'Could not open Slot Manager');
    });
    return;
  }
  if (action === 'approve') {
    // Reuse the existing Approve Players page for the currently selected
    // Round Manager club. This action is only rendered when requests exist.
    var approveClubId = '';
    var approveClubName = '';
    try {
      approveClubId = localStorage.getItem('kbrr_org_club_id') || '';
      approveClubName = localStorage.getItem('kbrr_org_club_name') || '';
    } catch (e) {}
    if (approveClubId && typeof setMyClub === 'function') {
      setMyClub(approveClubId, approveClubName);
    }
    if (typeof homeGo === 'function') {
      homeGo('vaultRequestsPage', null);
    } else if (typeof showPage === 'function') {
      showPage('vaultRequestsPage', null);
    }
    return;
  }
  if (action === 'register') {
    // Reuse the existing Register Players page and bind it to the currently
    // selected Round Manager club. No duplicate registration form.
    var orgClubId = '';
    var orgClubName = '';
    try {
      orgClubId = localStorage.getItem('kbrr_org_club_id') || '';
      orgClubName = localStorage.getItem('kbrr_org_club_name') || '';
    } catch (e) {}
    if (orgClubId && typeof setMyClub === 'function') {
      setMyClub(orgClubId, orgClubName);
    }
    window._regNavSource = 'organiserHome';
    if (typeof homeGo === 'function') {
      homeGo('vaultRegisterPage', null);
    } else if (typeof showPage === 'function') {
      showPage('vaultRegisterPage', null);
    }
    return;
  }
  if (action === 'club') {
    welcomeSelectedWorkspace = 'viewer';
    switchMode('viewer');
    window.setTimeout(function() {
      if (typeof homeGo === 'function') homeGo('joinClubPage', null);
    }, 40);
  }
}
