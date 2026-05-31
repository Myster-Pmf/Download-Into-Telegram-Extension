// VideoGrab - popup-profiles.js
// Site profile CRUD, rendering, and modal interactions

function renderProfiles() {
  const list = elements.customProfilesList;
  if (!list) return;
  list.innerHTML = '';

  if (siteProfiles.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔧</div>
        <p>No site profiles yet.<br>Create one to customize cookies &amp; headers per domain.</p>
      </div>`;
    return;
  }

  siteProfiles.forEach((profile, index) => {
    const card = document.createElement('div');
    card.className = 'profile-card';
    card.innerHTML = `
      <div class="profile-card-header">
        <span class="profile-name">${escapeHtml(profile.name || 'Unnamed Profile')}</span>
        <span class="profile-pattern">${escapeHtml(profile.domainPattern || '*')}</span>
      </div>
      <div class="profile-card-meta">
        ${profile.cookiesText ? `<span class="profile-tag">🍪 ${countCookies(profile.cookiesText)} cookies</span>` : '<span class="profile-tag dim">Live cookies</span>'}
        ${profile.userAgent  ? '<span class="profile-tag">🖥 Custom UA</span>'  : ''}
        ${profile.origin     ? '<span class="profile-tag">🌐 Origin set</span>' : ''}
      </div>
      <div class="profile-card-actions">
        <button class="btn-icon edit-profile-btn" data-index="${index}" title="Edit profile">✏️</button>
        <button class="btn-icon delete-profile-btn" data-index="${index}" title="Delete profile">🗑️</button>
      </div>`;
    list.appendChild(card);
  });

  list.querySelectorAll('.edit-profile-btn').forEach(btn => {
    btn.addEventListener('click', () => openProfileModal(Number(btn.dataset.index)));
  });

  list.querySelectorAll('.delete-profile-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteProfile(Number(btn.dataset.index)));
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
