// VideoGrab - popup-profiles.js
// Site profile CRUD, rendering, and modal interactions



  // --- Cookie status updater ---
  const updateCookieStatus = async () => {
    const statusDiv = card.querySelector('#cs-cookie-status');
    const textarea  = card.querySelector('#cs-cookies-textarea');
    let cookiesText = '';

    if (hasMatch && matchedProfile.cookiesText) {
      // Profile has saved cookies — use those
      cookiesText = matchedProfile.cookiesText;
    } else {
      // Use live browser cookies for this domain
      cookiesText = await extractBrowserCookiesForDomain(domain);
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
