// VideoGrab - popup-profiles.js
// Site profile CRUD, rendering, and modal interactions

/** Render the profiles tab: current-site card + saved profiles list */
async function renderProfiles() {
  const container = elements.customProfilesList;
  if (!container) return;
  container.innerHTML = '';

  // --- Current site card ---
  const domain = activeTabUrl ? getDomain(activeTabUrl) : '';
  if (domain) {
    const matchedProfile = matchProfileForUrl(activeTabUrl);
    const matchedIndex   = matchedProfile ? siteProfiles.indexOf(matchedProfile) : -1;
    const hasMatch       = matchedIndex !== -1;

    const card = document.createElement('div');
    card.className = 'profile-card current-site-card';
    card.innerHTML = `
      <div class="profile-card-header">
        <span class="profile-name">🌐 Current: ${escapeHtml(domain)}</span>
        ${hasMatch ? '<span class="profile-badge">Profile Active</span>' : '<span class="profile-badge badge-auto">Auto</span>'}
      </div>
      <div class="profile-card-body">
        <div id="cs-cookie-status" class="cookie-status-indicator">
          <span class="cookie-status-text">Checking…</span>
        </div>
        <textarea id="cs-cookies-textarea" rows="3" placeholder="Cookie string (Netscape format)" readonly></textarea>
        <div class="cs-btn-row">
          <button type="button" id="cs-sync-btn" class="btn btn-sm">Sync Live</button>
          <button type="button" id="cs-edit-btn" class="btn btn-sm">Edit</button>
          <button type="button" id="cs-export-btn" class="btn btn-sm">Export</button>
          ${hasMatch ? '<button type="button" id="cs-detach-btn" class="btn btn-sm btn-danger">Detach</button>' : ''}
        </div>
        <div id="cs-editor" style="display:none; margin-top:8px;">
          <input type="text" id="cs-origin-input" placeholder="Origin override" class="input-sm" />
          <input type="text" id="cs-referer-input" placeholder="Referer override" class="input-sm" />
          <input type="text" id="cs-ua-input" placeholder="User-Agent override" class="input-sm" />
          <input type="file" id="cs-import-file" accept=".txt" style="font-size:11px; margin-top:4px;" />
          <button type="button" id="cs-save-btn" class="btn btn-sm btn-primary" style="margin-top:4px;">Save as Profile</button>
        </div>
      </div>
    `;
    container.appendChild(card);
    await initCurrentSiteCardEvents(card, domain, hasMatch, matchedProfile, matchedIndex);
  }

  // --- Saved profiles list ---
  if (siteProfiles.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.style.cssText = 'padding: 20px; border-style: solid;';
    empty.innerHTML = `<p>No site-specific profiles configured. Add a profile below to target specific domains with custom cookies/headers.</p>`;
    container.appendChild(empty);
    return;
  }

  siteProfiles.forEach((profile, idx) => {
    const pCard = document.createElement('div');
    pCard.className = 'profile-card';
    const cookieSize = profile.cookiesText ? Math.round(profile.cookiesText.length / 1024) : 0;
    pCard.innerHTML = `
      <div class="profile-card-header">
        <span class="profile-name">${escapeHtml(profile.name || 'Unnamed')}</span>
        <div class="profile-card-actions">
          <button class="btn-link edit-prof-btn" data-idx="${idx}">Edit</button>
          <button class="btn-link btn-danger-link delete-prof-btn" data-idx="${idx}">Delete</button>
        </div>
      </div>
      <div class="profile-card-body" style="font-size: 12px; line-height: 1.6;">
        <div><strong>Pattern:</strong> <code>${escapeHtml(profile.domainPattern)}</code></div>
        <div><strong>Cookies:</strong> ${cookieSize > 0 ? `Imported (${cookieSize} KB)` : 'None'}</div>
        ${profile.origin ? `<div><strong>Origin:</strong> <code>${escapeHtml(profile.origin)}</code></div>` : ''}
        ${profile.referer ? `<div><strong>Referer:</strong> <code>${escapeHtml(profile.referer)}</code></div>` : ''}
        ${profile.userAgent ? `<div style="text-overflow: ellipsis; white-space: nowrap; overflow: hidden; max-width: 450px;"><strong>UA:</strong> <small>${escapeHtml(profile.userAgent)}</small></div>` : ''}
      </div>
    `;
    pCard.querySelector('.edit-prof-btn').addEventListener('click', () => openProfileModal(idx));
    pCard.querySelector('.delete-prof-btn').addEventListener('click', () => deleteProfile(idx));
    container.appendChild(pCard);
  });
}

/** Set up event listeners for the current-site cookie card */
async function initCurrentSiteCardEvents(card, domain, hasMatch, matchedProfile, matchedIndex) {
  // --- Cookie status updater ---
  const updateCookieStatus = async () => {
    const statusDiv = card.querySelector('#cs-cookie-status');
    const textarea  = card.querySelector('#cs-cookies-textarea');
    let cookiesText = '';

    try {
      if (hasMatch && matchedProfile.cookiesText) {
        cookiesText = matchedProfile.cookiesText;
      } else {
        cookiesText = await extractBrowserCookiesForDomain(domain);
      }
    } catch (e) {
      console.error('[Profiles] Cookie extraction failed:', e);
    }

    if (textarea) textarea.value = cookiesText;

    const count = countCookies(cookiesText);
    if (statusDiv) {
      statusDiv.className = 'cookie-status-indicator ' + (count > 0 ? 'has-cookies' : 'no-cookies');
      const txt = statusDiv.querySelector('.cookie-status-text');
      if (txt) {
        txt.innerText = count > 0
          ? `${hasMatch && matchedProfile.cookiesText ? 'Profile' : 'Live'} — ${count} cookie${count !== 1 ? 's' : ''}`
          : 'No cookies found for this domain';
      }
    }
    return cookiesText;
  };

  await updateCookieStatus();

  // --- Sync button ---
  card.querySelector('#cs-sync-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    const textarea = card.querySelector('#cs-cookies-textarea');
    const liveCookies = await extractBrowserCookiesForDomain(domain);
    if (textarea) textarea.value = liveCookies;
    // Refresh status with live
    const statusDiv = card.querySelector('#cs-cookie-status');
    const count = countCookies(liveCookies);
    if (statusDiv) {
      statusDiv.className = 'cookie-status-indicator ' + (count > 0 ? 'has-cookies' : 'no-cookies');
      const txt = statusDiv.querySelector('.cookie-status-text');
      if (txt) txt.innerText = count > 0 ? `Live — ${count} cookie${count !== 1 ? 's' : ''}` : 'No cookies found';
    }
    showToast('Browser cookies synced.', 'success');
  });

  // --- Edit toggle button ---
  const editBtn = card.querySelector('#cs-edit-btn');
  const editor  = card.querySelector('#cs-editor');
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = editor.style.display === 'block';
    editor.style.display = isOpen ? 'none' : 'block';
    editBtn.textContent = isOpen ? 'Edit' : 'Close';
  });

  // --- Export button ---
  card.querySelector('#cs-export-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    const textarea = card.querySelector('#cs-cookies-textarea');
    const cookiesText = textarea ? textarea.value.trim() : await extractBrowserCookiesForDomain(domain);
    if (!cookiesText) {
      showToast('No cookies to export.', 'warning');
      return;
    }
    const blob = new Blob([cookiesText], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${domain}_cookies.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported cookies.txt', 'success');
  });

  // --- Detach profile button (if a profile is matched) ---
  if (hasMatch) {
    const detachBtn = card.querySelector('#cs-detach-btn');
    if (detachBtn) {
      detachBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await showDialog({
          title: 'Remove Profile Match',
          message: `This will delete the "${matchedProfile.name || 'Unnamed'}" profile so it no longer applies to ${domain}. Are you sure?`,
          confirmText: 'Remove',
          variant: 'danger'
        });
        if (!ok) return;
        siteProfiles.splice(matchedIndex, 1);
        chrome.storage.local.set({ siteProfiles }, () => {
          renderProfiles();
          showToast('Profile removed.', 'info');
        });
      });
    }
  }

  // --- Import file ---
  card.querySelector('#cs-import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const textarea = card.querySelector('#cs-cookies-textarea');
      if (textarea) textarea.value = ev.target.result.trim();
      showToast('Cookie file loaded. Click "Save as Profile" to apply.', 'info');
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // --- Save / Update button ---
  card.querySelector('#cs-save-btn').addEventListener('click', () => {
    const cookiesVal = (card.querySelector('#cs-cookies-textarea')?.value || '').trim();
    const originVal  = (card.querySelector('#cs-origin-input')?.value  || '').trim();
    const refererVal = (card.querySelector('#cs-referer-input')?.value || '').trim();
    const uaVal      = (card.querySelector('#cs-ua-input')?.value      || '').trim();

    if (hasMatch) {
      // Update existing matched profile
      siteProfiles[matchedIndex] = {
        ...matchedProfile,
        cookiesText: cookiesVal,
        origin:      originVal,
        referer:     refererVal,
        userAgent:   uaVal
      };
      chrome.storage.local.set({ siteProfiles }, () => {
        renderProfiles();
        showToast(`Profile "${matchedProfile.name || 'Unnamed'}" updated.`, 'success');
      });
    } else {
      // Create a new profile override for this domain
      const cleanPattern = domain.includes('.') ? `*.${domain}` : domain;
      const newProfile = {
        name:          `${domain} Profile`,
        domainPattern: cleanPattern,
        cookiesText:   cookiesVal,
        origin:        originVal,
        referer:       refererVal,
        userAgent:     uaVal
      };
      siteProfiles.push(newProfile);
      chrome.storage.local.set({ siteProfiles }, () => {
        renderProfiles();
        showToast(`Profile created for ${domain}.`, 'success');
      });
    }
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function openProfileModal(index) {
  const isNew = index === undefined || index === null || index < 0;
  const profile = isNew ? {} : (siteProfiles[index] || {});

  if (elements.modalTitle)   elements.modalTitle.textContent = isNew ? 'New Site Profile' : 'Edit Site Profile';
  if (elements.profileId)    elements.profileId.value    = isNew ? '' : String(index);
  if (elements.profName)     elements.profName.value     = profile.name          || '';
  if (elements.profPattern)  elements.profPattern.value  = profile.domainPattern || '';
  if (elements.profCookies)  elements.profCookies.value  = profile.cookiesText   || '';
  if (elements.profOrigin)   elements.profOrigin.value   = profile.origin        || '';
  if (elements.profReferer)  elements.profReferer.value  = profile.referer       || '';
  if (elements.profUa)       elements.profUa.value       = profile.userAgent     || '';

  // Reset live cookie status display
  if (elements.profLiveCookieStatus) {
    const txt = elements.profLiveCookieStatus.querySelector('.cookie-status-text');
    if (txt) txt.innerText = 'Checking…';
    elements.profLiveCookieStatus.className = 'cookie-status-indicator';
  }

  if (profile.domainPattern) checkModalDomainCookies(profile.domainPattern);

  if (elements.profileModal) elements.profileModal.classList.add('active');
}

function closeProfileModal() {
  if (elements.profileModal) elements.profileModal.classList.remove('active');
}

async function saveProfileFromModal() {
  const indexStr = elements.profileId ? elements.profileId.value : '';
  const index    = indexStr !== '' ? Number(indexStr) : -1;
  const isNew    = index < 0;

  const profile = {
    name:          (elements.profName     ? elements.profName.value.trim()    : '') || 'Unnamed',
    domainPattern: (elements.profPattern  ? elements.profPattern.value.trim() : '') || '*',
    cookiesText:   elements.profCookies   ? elements.profCookies.value.trim() : '',
    origin:        elements.profOrigin    ? elements.profOrigin.value.trim()  : '',
    referer:       elements.profReferer   ? elements.profReferer.value.trim() : '',
    userAgent:     elements.profUa        ? elements.profUa.value.trim()      : ''
  };

  if (isNew) {
    siteProfiles.push(profile);
  } else {
    siteProfiles[index] = profile;
  }

  chrome.storage.local.set({ siteProfiles }, () => {
    renderProfiles();
    closeProfileModal();
    showToast(isNew ? 'Profile created.' : 'Profile updated.', 'success');
  });
}

async function deleteProfile(index) {
  const profile = siteProfiles[index];
  if (!profile) return;
  const confirmed = await showDialog({
    title: 'Delete Profile',
    message: `Delete profile "${profile.name || 'Unnamed'}"?`,
    confirmText: 'Delete',
    variant: 'danger'
  });
  if (!confirmed) return;
  siteProfiles.splice(index, 1);
  chrome.storage.local.set({ siteProfiles }, () => {
    renderProfiles();
    showToast('Profile deleted.', 'info');
  });
}

/** Wire up profile modal events */
function initProfileEvents() {
  if (elements.newProfileBtn) {
    elements.newProfileBtn.addEventListener('click', () => openProfileModal(-1));
  }

  if (elements.closeModalBtn) {
    elements.closeModalBtn.addEventListener('click', closeProfileModal);
  }

  // Close on overlay click
  if (elements.profileModal) {
    elements.profileModal.addEventListener('click', (e) => {
      if (e.target === elements.profileModal) closeProfileModal();
    });
  }

  if (elements.profileForm) {
    elements.profileForm.addEventListener('submit', (e) => {
      e.preventDefault();
      saveProfileFromModal();
    });
  }

  // Re-check live cookies when domain pattern changes in modal
  const debouncedCheck = debounce((val) => checkModalDomainCookies(val), 500);
  if (elements.profPattern) {
    elements.profPattern.addEventListener('input', (e) => debouncedCheck(e.target.value.trim()));
  }

  // Upload cookies.txt into profile modal
  if (elements.profCookieFile) {
    elements.profCookieFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (elements.profCookies) elements.profCookies.value = ev.target.result.trim();
        showToast('Cookie file loaded into profile.', 'success');
      };
      reader.readAsText(file);
      e.target.value = '';
    });
  }
}
