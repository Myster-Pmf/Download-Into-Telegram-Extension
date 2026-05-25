// VideoGrab - popup.js (Manifest V2)

// --- Constants & Global State ---
const DEFAULT_SETTINGS = {
  backendUrl: 'http://localhost:3000',
  apiKey: 'my_secure_shared_secret_api_key',
  tgTarget: '@mygroup',
  quality: 'best',
  autoMatch: 'true',
  defaultUa: navigator.userAgent,
  ytdlpFlags: '--embed-subs'
};

let activeSettings = { ...DEFAULT_SETTINGS };
let detectedVideosList = [];
let siteProfiles = [];
let globalCookiesText = '';
let globalUserAgent = navigator.userAgent;

// Active download polling timers (jobId => intervalId)
const activePolls = new Map();
const videoInfoCache = new Map();
let telegramLoggedIn = false;

// --- Glob to Regex Converter ---
function globToRegex(glob) {
  // Escape regex specials except '*'
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  // Convert '*' to '.*'
  const regexStr = '^' + escaped.replace(/\*/g, '.*') + '$';
  return new RegExp(regexStr, 'i');
}

// --- Domain Matcher ---
function matchProfileForUrl(videoUrl) {
  if (activeSettings.autoMatch === 'false') return null;

  try {
    const parsedUrl = new URL(videoUrl);
    const hostname = parsedUrl.hostname;

    for (const profile of siteProfiles) {
      if (!profile.domainPattern) continue;
      const regex = globToRegex(profile.domainPattern);
      if (regex.test(hostname)) {
        return profile;
      }
    }
  } catch (e) {
    console.error('Failed to match URL domain:', e);
  }
  return null;
}

// --- DOM elements ---
const elements = {
  backendStatus: document.getElementById('backend-status'),
  videosList: document.getElementById('videos-list'),
  customProfilesList: document.getElementById('custom-profiles-list'),
  historyList: document.getElementById('history-list'),

  // Settings Form
  settingsForm: document.getElementById('settings-form'),
  settBackendUrl: document.getElementById('sett-backend-url'),
  settApiKey: document.getElementById('sett-api-key'),
  settTgTarget: document.getElementById('sett-tg-target'),
  settTgTargetCustom: document.getElementById('sett-tg-target-custom'),
  refreshChatsBtn: document.getElementById('refresh-chats-btn'),
  tgTargetSelect: document.getElementById('tg-target-select'),
  tgTargetCustom: document.getElementById('tg-target-custom'),
  tgRefreshChatsBtn: document.getElementById('tg-refresh-chats-btn'),
  tgSaveTargetBtn: document.getElementById('tg-save-target-btn'),
  settQuality: document.getElementById('sett-quality'),
  settAutoMatch: document.getElementById('sett-auto-match'),
  settDefaultUa: document.getElementById('sett-default-ua'),
  settYtdlpFlags: document.getElementById('sett-ytdlp-flags'),

  // Global Profile elements
  globalCookies: document.getElementById('global-cookies'),
  globalCookieFile: document.getElementById('global-cookie-file'),
  clearGlobalCookies: document.getElementById('clear-global-cookies'),
  globalUa: document.getElementById('global-ua'),
  saveGlobalProfileBtn: document.getElementById('save-global-profile-btn'),

  // Telegram Wizard steps
  tgStatusCard: document.getElementById('tg-status-card'),
  tgStatusBadge: document.getElementById('tg-status-badge'),
  tgStatusText: document.getElementById('tg-status-text'),

  authStepPhone: document.getElementById('auth-step-phone'),
  authStepOtp: document.getElementById('auth-step-otp'),
  authStep2fa: document.getElementById('auth-step-2fa'),
  authStepLogged: document.getElementById('auth-step-logged'),

  tgPhone: document.getElementById('tg-phone'),
  tgOtp: document.getElementById('tg-otp'),
  tgPassword: document.getElementById('tg-password'),
  tg2faHint: document.getElementById('tg-2fa-hint'),

  // Telegram action buttons
  tgSendOtpBtn: document.getElementById('tg-send-otp-btn'),
  tgVerifyOtpBtn: document.getElementById('tg-verify-otp-btn'),
  tgVerify2faBtn: document.getElementById('tg-verify-2fa-btn'),
  tgLogoutBtn: document.getElementById('tg-logout-btn'),

  tgBackPhoneBtn: document.getElementById('tg-back-phone-btn'),
  tgBackOtpBtn: document.getElementById('tg-back-otp-btn'),

  // Custom Profile Modal
  profileModal: document.getElementById('profile-modal'),
  modalTitle: document.getElementById('modal-title'),
  profileForm: document.getElementById('profile-form'),
  profileId: document.getElementById('profile-id'),
  profName: document.getElementById('prof-name'),
  profPattern: document.getElementById('prof-pattern'),
  profCookies: document.getElementById('prof-cookies'),
  profCookieFile: document.getElementById('prof-cookie-file'),
  profOrigin: document.getElementById('prof-origin'),
  profReferer: document.getElementById('prof-referer'),
  profUa: document.getElementById('prof-ua'),
  closeModalBtn: document.getElementById('close-modal-btn'),
  newProfileBtn: document.getElementById('new-profile-btn'),

  clearVideosBtn: document.getElementById('clear-videos-btn'),
  refreshHistoryBtn: document.getElementById('refresh-history-btn'),
  scopeTabCheckbox: document.getElementById('scope-tab-checkbox'),
  toastRegion: document.getElementById('toast-region'),
  appDialog: document.getElementById('app-dialog'),
  appDialogIcon: document.getElementById('app-dialog-icon'),
  appDialogTitle: document.getElementById('app-dialog-title'),
  appDialogMessage: document.getElementById('app-dialog-message'),
  appDialogDetail: document.getElementById('app-dialog-detail'),
  appDialogCancel: document.getElementById('app-dialog-cancel'),
  appDialogConfirm: document.getElementById('app-dialog-confirm')
};

let activeTabUrl = '';
let activeJobsMap = new Map();

function getDomain(urlStr) {
  try {
    const url = new URL(urlStr);
    return url.hostname;
  } catch (e) {
    return '';
  }
}

function showToast(message, type = 'info') {
  if (!elements.toastRegion) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  elements.toastRegion.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(6px)';
    setTimeout(() => toast.remove(), 220);
  }, 3200);
}

function showDialog({
  title = 'Confirm Action',
  message = '',
  detail = '',
  confirmText = 'OK',
  cancelText = 'Cancel',
  variant = 'warning',
  hideCancel = false
} = {}) {
  return new Promise((resolve) => {
    const dialog = elements.appDialog;
    if (!dialog) {
      resolve(!hideCancel);
      return;
    }

    elements.appDialogTitle.textContent = title;
    elements.appDialogMessage.textContent = message;
    elements.appDialogConfirm.textContent = confirmText;
    elements.appDialogCancel.textContent = cancelText;
    elements.appDialogCancel.style.display = hideCancel ? 'none' : 'inline-flex';
    elements.appDialogIcon.textContent = variant === 'danger' ? '!' : variant === 'success' ? 'OK' : '!';
    elements.appDialogIcon.style.background = variant === 'danger' ? 'rgba(239, 68, 68, 0.14)' : variant === 'success' ? 'rgba(16, 185, 129, 0.14)' : 'rgba(245, 158, 11, 0.14)';
    elements.appDialogIcon.style.color = variant === 'danger' ? '#fca5a5' : variant === 'success' ? 'var(--status-green)' : '#fbbf24';

    if (detail) {
      elements.appDialogDetail.textContent = detail;
      elements.appDialogDetail.classList.add('active');
    } else {
      elements.appDialogDetail.textContent = '';
      elements.appDialogDetail.classList.remove('active');
    }

    const cleanup = (result) => {
      dialog.classList.remove('active');
      elements.appDialogConfirm.removeEventListener('click', onConfirm);
      elements.appDialogCancel.removeEventListener('click', onCancel);
      dialog.removeEventListener('click', onOverlay);
      resolve(result);
    };
    const onConfirm = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onOverlay = (event) => {
      if (event.target === dialog && !hideCancel) cleanup(false);
    };

    elements.appDialogConfirm.addEventListener('click', onConfirm);
    elements.appDialogCancel.addEventListener('click', onCancel);
    dialog.addEventListener('click', onOverlay);
    dialog.classList.add('active');
  });
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const precision = size >= 100 || unitIndex === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

function getSelectedTarget(selectEl, customEl) {
  if (!selectEl) return '';
  return selectEl.value === 'custom' ? (customEl.value || '').trim() : selectEl.value;
}

function setTargetControlsValue(target) {
  [elements.settTgTarget, elements.tgTargetSelect].forEach((select) => {
    if (!select) return;
    const customInput = select === elements.settTgTarget ? elements.settTgTargetCustom : elements.tgTargetCustom;
    const hasOption = Array.from(select.options).some(opt => opt.value === target);
    if (target && hasOption) {
      select.value = target;
      customInput.style.display = 'none';
      customInput.value = '';
    } else if (target) {
      select.value = 'custom';
      customInput.style.display = 'block';
      customInput.value = target;
    }
  });
}

function syncTargetControls(sourceSelect, sourceCustom) {
  const target = getSelectedTarget(sourceSelect, sourceCustom);
  if (sourceSelect.value === 'custom') {
    sourceCustom.style.display = 'block';
  } else {
    sourceCustom.style.display = 'none';
  }
  setTargetControlsValue(target);
}

async function hasActiveTransfers() {
  try {
    const response = await fetch(`${activeSettings.backendUrl}/jobs?limit=25`, {
      headers: { 'X-API-Key': activeSettings.apiKey }
    });
    if (!response.ok) return activeJobsMap.size > 0;
    const jobs = await response.json();
    return jobs.some(j => ['queued', 'downloading', 'downloaded', 'uploading'].includes(String(j.status).toLowerCase()));
  } catch (e) {
    return activeJobsMap.size > 0;
  }
}

async function confirmTargetChangeIfNeeded(oldTarget, newTarget) {
  if (!oldTarget || oldTarget === newTarget) return true;
  if (!(await hasActiveTransfers())) return true;

  return showDialog({
    title: 'Change Telegram Target?',
    message: 'There are active or queued transfers right now.',
    detail: 'Changing the chat or channel only affects the next download/upload. The transfer already running keeps the target it was started with.',
    confirmText: 'Change Target',
    cancelText: 'Keep Current',
    variant: 'warning'
  });
}

async function loadActiveJobs() {
  try {
    const response = await fetch(`${activeSettings.backendUrl}/jobs?limit=25`, {
      headers: {
        'X-API-Key': activeSettings.apiKey
      }
    });
    if (response.ok) {
      const jobs = await response.json();
      activeJobsMap.clear();
      const active = jobs.filter(j => j.status === 'queued' || j.status === 'downloading' || j.status === 'uploading');
      active.forEach(job => {
        activeJobsMap.set(job.url, job);
      });
    }
  } catch (e) {
    console.error('Failed to load active jobs:', e);
  }
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    if (tabs && tabs[0]) {
      activeTabUrl = tabs[0].url;
    }

    // 1. Initial local UI setup (fast storage reads)
    setupTabs();
    await loadSettings(); // Restores sync settings instantly
    await loadSiteProfiles(); // Restores local site profiles instantly

    // 2. Render detected videos list immediately from local storage (extremely fast, zero blocking!)
    await refreshDetectedVideos();

    // 3. Perform network checks and async updates in the background (non-blocking)
    (async () => {
      // Refresh chats target list in background
      if (activeSettings.tgTarget) {
        fetchTelegramChats(activeSettings.tgTarget);
      }

      // Ping backend
      pingBackend();

      // Check Telegram auth status
      await checkTelegramStatus();

      // Fetch active running jobs
      await loadActiveJobs();

      // Re-render videos to attach progress tracking bars for running jobs if any exist
      if (activeJobsMap.size > 0) {
        renderVideos();
      }
    })();

    // Listen for storage updates to refresh video list in real-time
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.detectedVideos) {
        detectedVideosList = changes.detectedVideos.newValue || [];
        renderVideos();
      }
    });

    // Wire scoping checkbox
    if (elements.scopeTabCheckbox) {
      elements.scopeTabCheckbox.addEventListener('change', () => {
        renderVideos();
      });
    }

    // Settings form submission
    elements.settingsForm.addEventListener('submit', saveSettings);

    // Keep Telegram target controls in Settings and Telegram tabs synchronized.
    elements.settTgTarget.addEventListener('change', () => {
      syncTargetControls(elements.settTgTarget, elements.settTgTargetCustom);
    });
    elements.settTgTargetCustom.addEventListener('input', () => {
      if (elements.settTgTarget.value === 'custom') {
        elements.tgTargetSelect.value = 'custom';
        elements.tgTargetCustom.value = elements.settTgTargetCustom.value;
        elements.tgTargetCustom.style.display = 'block';
      }
    });
    elements.tgTargetSelect.addEventListener('change', () => {
      syncTargetControls(elements.tgTargetSelect, elements.tgTargetCustom);
    });
    elements.tgTargetCustom.addEventListener('input', () => {
      if (elements.tgTargetSelect.value === 'custom') {
        elements.settTgTarget.value = 'custom';
        elements.settTgTargetCustom.value = elements.tgTargetCustom.value;
        elements.settTgTargetCustom.style.display = 'block';
      }
    });

    // Settings form refresh chats click
    elements.refreshChatsBtn.addEventListener('click', async () => {
      elements.refreshChatsBtn.disabled = true;
      elements.refreshChatsBtn.innerText = 'Loading...';
      await fetchTelegramChats(activeSettings.tgTarget);
      elements.refreshChatsBtn.disabled = false;
      elements.refreshChatsBtn.innerText = 'Refresh';
    });

    elements.tgRefreshChatsBtn.addEventListener('click', async () => {
      elements.tgRefreshChatsBtn.disabled = true;
      elements.tgRefreshChatsBtn.innerText = 'Loading...';
      await fetchTelegramChats(activeSettings.tgTarget);
      elements.tgRefreshChatsBtn.disabled = false;
      elements.tgRefreshChatsBtn.innerText = 'Refresh';
    });
    elements.tgSaveTargetBtn.addEventListener('click', async () => {
      await saveSettings();
    });

    // Clear videos
    elements.clearVideosBtn.addEventListener('click', () => {
      chrome.storage.local.set({ detectedVideos: [] }, () => {
        detectedVideosList = [];
        renderVideos();
      });
    });

    // Refresh history
    elements.refreshHistoryBtn.addEventListener('click', fetchHistory);

    // Setup profile modals
    elements.newProfileBtn.addEventListener('click', () => openProfileModal());
    elements.closeModalBtn.addEventListener('click', closeProfileModal);
    elements.profileForm.addEventListener('submit', saveCustomProfile);

    // Cookie files readers
    setupCookieFileReaders();

    // Save Global Profile
    elements.saveGlobalProfileBtn.addEventListener('click', saveGlobalProfile);
    elements.clearGlobalCookies.addEventListener('click', () => {
      elements.globalCookies.value = '';
    });

    // Telegram auth listeners
    setupTelegramWizardListeners();

    // History tab click auto-fetch
    document.querySelector('[data-tab="tab-history"]').addEventListener('click', fetchHistory);
  });
});

// --- Tab Setup ---
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active from buttons and contents
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPane = document.getElementById(btn.getAttribute('data-tab'));
      targetPane.classList.add('active');
    });
  });

  // Wire filters inside Detected Videos
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderVideos(btn.getAttribute('data-filter'));
    });
  });
}

// --- Settings Operations ---
async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
      activeSettings = items;

      elements.settBackendUrl.value = items.backendUrl;
      elements.settApiKey.value = items.apiKey;
      elements.settQuality.value = items.quality;
      elements.settAutoMatch.value = items.autoMatch;
      elements.settDefaultUa.value = items.defaultUa;
      elements.settYtdlpFlags.value = items.ytdlpFlags;
      setTargetControlsValue(items.tgTarget);

      resolve();
    });
  });
}

async function saveSettings(e) {
  if (e) e.preventDefault();

  const target = getSelectedTarget(elements.settTgTarget, elements.settTgTargetCustom);

  if (!target) {
    showToast('Choose a Telegram target chat or channel first.', 'warning');
    return;
  }

  const canChangeTarget = await confirmTargetChangeIfNeeded(activeSettings.tgTarget, target);
  if (!canChangeTarget) {
    setTargetControlsValue(activeSettings.tgTarget);
    return;
  }

  const newSettings = {
    backendUrl: elements.settBackendUrl.value.trim().replace(/\/$/, ''), // Remove trailing slash
    apiKey: elements.settApiKey.value.trim(),
    tgTarget: target,
    quality: elements.settQuality.value,
    autoMatch: elements.settAutoMatch.value,
    defaultUa: elements.settDefaultUa.value.trim(),
    ytdlpFlags: elements.settYtdlpFlags.value.trim()
  };

  return new Promise((resolve) => {
    chrome.storage.sync.set(newSettings, async () => {
      activeSettings = newSettings;
      showToast('Settings saved successfully.', 'success');
      pingBackend(); // Re-ping new backend
      await fetchTelegramChats(target); // Refresh chats list
      resolve();
    });
  });
}

async function fetchTelegramChats(savedTarget = null) {
  const selects = [elements.settTgTarget, elements.tgTargetSelect].filter(Boolean);
  const customInputs = [elements.settTgTargetCustom, elements.tgTargetCustom].filter(Boolean);

  selects.forEach(select => {
    select.innerHTML = '<option value="">Loading chats...</option>';
  });
  customInputs.forEach(input => {
    input.style.display = 'none';
  });

  try {
    const response = await fetch(`${activeSettings.backendUrl}/telegram/chats`, {
      headers: {
        'X-API-Key': activeSettings.apiKey
      }
    });

    if (!response.ok) {
      throw new Error('Backend unauthorized or offline');
    }

    const chats = await response.json();
    selects.forEach(select => {
      select.innerHTML = '';

      const customOpt = document.createElement('option');
      customOpt.value = 'custom';
      customOpt.innerText = 'Custom username or ID';
      select.appendChild(customOpt);
    });

    let matched = false;
    chats.forEach(chat => {
      const val = chat.username || chat.id;
      selects.forEach(select => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.innerText = `${chat.title} (${chat.type}${chat.username ? ` - ${chat.username}` : ''})`;
        select.appendChild(opt);
      });

      if (savedTarget && (String(savedTarget) === String(chat.id) || savedTarget === chat.username)) {
        matched = true;
      }
    });

    if (savedTarget && !matched) {
      selects.forEach(select => { select.value = 'custom'; });
      customInputs.forEach(input => {
        input.style.display = 'block';
        input.value = savedTarget;
      });
    } else if (!savedTarget && chats.length > 0) {
      selects.forEach(select => { select.selectedIndex = 1; });
    } else if (savedTarget) {
      setTargetControlsValue(savedTarget);
    }

  } catch (e) {
    console.error('[Settings] Dialogs fetch failed:', e);
    selects.forEach(select => {
      select.innerHTML = '<option value="custom">Custom username or ID</option>';
      select.value = 'custom';
    });
    customInputs.forEach(input => {
      input.style.display = 'block';
      if (savedTarget) input.value = savedTarget;
    });
  }
}

// --- Site Profiles Operations ---
async function loadSiteProfiles() {
  return new Promise((resolve) => {
    chrome.storage.local.get({
      siteProfiles: [],
      globalCookiesText: '',
      globalUserAgent: navigator.userAgent
    }, (items) => {
      siteProfiles = items.siteProfiles;
      globalCookiesText = items.globalCookiesText;
      globalUserAgent = items.globalUserAgent;

      elements.globalCookies.value = globalCookiesText;
      elements.globalUa.value = globalUserAgent;

      renderProfilesList();
      resolve();
    });
  });
}

function saveGlobalProfile() {
  const cookies = elements.globalCookies.value.trim();
  const ua = elements.globalUa.value.trim();

  chrome.storage.local.set({
    globalCookiesText: cookies,
    globalUserAgent: ua
  }, () => {
    globalCookiesText = cookies;
    globalUserAgent = ua;
    showToast('Global fallback profile updated.', 'success');
    renderVideos(); // Re-render videos indicators
  });
}

function renderProfilesList() {
  elements.customProfilesList.innerHTML = '';

  if (siteProfiles.length === 0) {
    elements.customProfilesList.innerHTML = `
      <div class="empty-state" style="padding: 20px; border-style: solid;">
        <p>No site-specific profiles configured. Add a profile below to target specific domains with custom cookies/headers.</p>
      </div>
    `;
    return;
  }

  siteProfiles.forEach((profile) => {
    const card = document.createElement('div');
    card.className = 'profile-card';

    // Cookie string snippet size computation
    const cookieSize = profile.cookiesText ? Math.round(profile.cookiesText.length / 1024) : 0;

    card.innerHTML = `
      <div class="profile-card-header">
        <span class="profile-name">${profile.name}</span>
        <div class="profile-card-actions">
          <button class="btn-link edit-prof-btn" data-id="${profile.id}">Edit</button>
          <button class="btn-link btn-danger-link delete-prof-btn" data-id="${profile.id}">Delete</button>
        </div>
      </div>
      <div class="profile-card-body" style="font-size: 12px; line-height: 1.6;">
        <div><strong>Pattern:</strong> <code>${profile.domainPattern}</code></div>
        <div><strong>Cookies:</strong> ${cookieSize > 0 ? `Imported (${cookieSize} KB)` : 'None'}</div>
        ${profile.defaultOrigin ? `<div><strong>Origin:</strong> <code>${profile.defaultOrigin}</code></div>` : ''}
        ${profile.defaultReferer ? `<div><strong>Referer:</strong> <code>${profile.defaultReferer}</code></div>` : ''}
        ${profile.defaultUserAgent ? `<div style="text-overflow: ellipsis; white-space: nowrap; overflow: hidden; max-width: 450px;"><strong>UA:</strong> <small>${profile.defaultUserAgent}</small></div>` : ''}
      </div>
    `;

    // Wire actions
    card.querySelector('.edit-prof-btn').addEventListener('click', () => openProfileModal(profile.id));
    card.querySelector('.delete-prof-btn').addEventListener('click', () => deleteProfile(profile.id));

    elements.customProfilesList.appendChild(card);
  });
}

function openProfileModal(id = null) {
  elements.profileForm.reset();

  if (id) {
    // Edit mode
    const prof = siteProfiles.find(p => p.id === id);
    if (prof) {
      elements.modalTitle.innerText = 'Edit Site Profile';
      elements.profileId.value = prof.id;
      elements.profName.value = prof.name;
      elements.profPattern.value = prof.domainPattern;
      elements.profCookies.value = prof.cookiesText || '';
      elements.profOrigin.value = prof.defaultOrigin || '';
      elements.profReferer.value = prof.defaultReferer || '';
      elements.profUa.value = prof.defaultUserAgent || '';
    }
  } else {
    // New mode
    elements.modalTitle.innerText = 'New Site Profile';
    elements.profileId.value = '';
  }

  elements.profileModal.classList.add('active');
}

function closeProfileModal() {
  elements.profileModal.classList.remove('active');
}

function saveCustomProfile(e) {
  e.preventDefault();

  const id = elements.profileId.value;
  const name = elements.profName.value.trim();
  const pattern = elements.profPattern.value.trim();
  const cookies = elements.profCookies.value.trim();
  const origin = elements.profOrigin.value.trim();
  const referer = elements.profReferer.value.trim();
  const ua = elements.profUa.value.trim();

  const newProfile = {
    id: id || 'prof_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    name,
    domainPattern: pattern,
    cookiesText: cookies,
    defaultOrigin: origin,
    defaultReferer: referer,
    defaultUserAgent: ua
  };

  if (id) {
    // Update
    const idx = siteProfiles.findIndex(p => p.id === id);
    if (idx !== -1) siteProfiles[idx] = newProfile;
  } else {
    // Insert
    siteProfiles.push(newProfile);
  }

  chrome.storage.local.set({ siteProfiles }, () => {
    closeProfileModal();
    renderProfilesList();
    renderVideos(); // Refresh matching cookie labels
  });
}

async function deleteProfile(id) {
  const ok = await showDialog({
    title: 'Delete Profile?',
    message: 'This removes the saved cookies and header overrides for this site profile.',
    confirmText: 'Delete Profile',
    cancelText: 'Cancel',
    variant: 'danger'
  });
  if (!ok) return;

  siteProfiles = siteProfiles.filter(p => p.id !== id);
  chrome.storage.local.set({ siteProfiles }, () => {
    renderProfilesList();
    renderVideos();
  });
}

// Netscape cookies import helper
function setupCookieFileReaders() {
  const handleFile = (fileInput, textareaElement) => {
    const file = fileInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      textareaElement.value = e.target.result;
    };
    reader.readAsText(file);
  };

  elements.globalCookieFile.addEventListener('change', () => {
    handleFile(elements.globalCookieFile, elements.globalCookies);
  });

  elements.profCookieFile.addEventListener('change', () => {
    handleFile(elements.profCookieFile, elements.profCookies);
  });
}

// --- Detected Videos (Tab 1) ---
async function refreshDetectedVideos() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ detectedVideos: [] }, (result) => {
      detectedVideosList = result.detectedVideos;
      renderVideos();
      resolve();
    });
  });
}

function updateCardProgressUi(videoId, status, percent, errorMsg = '', metrics = {}) {
  const cardElement = document.getElementById(`card-${videoId}`);
  if (!cardElement) return;
  const statusKey = String(status || '').toLowerCase();

  const statusLabel = cardElement.querySelector('.progress-status');
  const percentLabel = cardElement.querySelector('.progress-percent');
  const measureLabel = cardElement.querySelector('.progress-measure');
  const fill = cardElement.querySelector('.progress-bar-fill');
  const downloadButton = cardElement.querySelector('.download-video-btn');
  const filenameInput = cardElement.querySelector('.filename-input');
  const removeBtn = cardElement.querySelector('.remove-video-btn');
  const cancelBtn = cardElement.querySelector('.cancel-download-btn');

  if (statusLabel) {
    statusLabel.innerText = status;
    statusLabel.className = `progress-status status-${statusKey}`;
  }
  if (percentLabel) {
    percentLabel.innerText = `${percent}%`;
  }
  if (measureLabel) {
    const downloaded = formatBytes(metrics.downloadedBytes);
    const total = formatBytes(metrics.totalBytes);
    if (downloaded && total) {
      measureLabel.innerText = `${downloaded} / ${total}`;
    } else if (total) {
      measureLabel.innerText = `Size ${total}`;
    } else {
      measureLabel.innerText = '';
    }
  }
  if (fill) {
    fill.style.width = `${percent}%`;
  }

  // Show progress container
  const progContainer = cardElement.querySelector('.progress-container');
  if (progContainer) {
    progContainer.style.display = 'block';
  }

  if (statusKey === 'error') {
    if (percentLabel) percentLabel.innerText = 'Error';

    // Create or update error message node
    let errNode = cardElement.querySelector('.card-error-text');
    if (!errNode) {
      errNode = document.createElement('div');
      errNode.className = 'card-error-text';
      errNode.style.color = 'var(--status-red)';
      errNode.style.fontSize = '11px';
      errNode.style.marginTop = '6px';
      cardElement.appendChild(errNode);
    }
    errNode.innerText = errorMsg;

    if (downloadButton) {
      downloadButton.disabled = false;
      downloadButton.innerText = 'Retry Download';
    }
    if (filenameInput) filenameInput.disabled = false;
    if (removeBtn) removeBtn.disabled = false;
    if (cancelBtn) cancelBtn.style.display = 'none';

  } else if (statusKey === 'done') {
    // Hide error node if any
    const errNode = cardElement.querySelector('.card-error-text');
    if (errNode) errNode.remove();

    if (downloadButton) {
      downloadButton.disabled = false;
      downloadButton.innerText = 'Download';
    }
    if (filenameInput) filenameInput.disabled = false;
    if (removeBtn) removeBtn.disabled = false;
    if (cancelBtn) cancelBtn.style.display = 'none';

  } else {
    // Queued, downloading, uploading
    // Hide error node if any
    const errNode = cardElement.querySelector('.card-error-text');
    if (errNode) errNode.remove();

    if (downloadButton) {
      downloadButton.disabled = true;
      downloadButton.innerText = statusKey === 'uploading' ? 'Uploading...' : 'Downloading...';
    }
    if (filenameInput) filenameInput.disabled = true;
    if (removeBtn) removeBtn.disabled = true;

    if (cancelBtn) {
      cancelBtn.style.display = 'inline-block';
      cancelBtn.disabled = false;
      cancelBtn.innerText = '[Cancel]';
    }
  }
}

function renderVideos(filterType = null) {
  elements.videosList.innerHTML = '';

  if (!filterType) {
    const activeFilterBtn = document.querySelector('.filter-btn.active');
    filterType = activeFilterBtn ? activeFilterBtn.getAttribute('data-filter') : 'all';
  }

  const activeDomain = activeTabUrl ? getDomain(activeTabUrl) : '';
  const scopeToCurrent = elements.scopeTabCheckbox ? elements.scopeTabCheckbox.checked : true;

  const filtered = detectedVideosList.filter(vid => {
    // 1. Stream type filtering
    if (filterType !== 'all' && vid.type.toUpperCase() !== filterType.toUpperCase()) {
      return false;
    }

    // 2. Domain-based filtering
    if (scopeToCurrent && activeDomain) {
      const vidDomain = getDomain(vid.pageUrl);
      if (vidDomain !== activeDomain) {
        return false;
      }
    }

    return true;
  });

  if (filtered.length === 0) {
    elements.videosList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎬</div>
        <h3>No streams captured</h3>
        <p>No matches for current criteria.</p>
      </div>
    `;
    return;
  }

  filtered.forEach((video) => {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.id = `card-${video.id}`;

    // Auto-match cookie profiles
    const matchedProfile = matchProfileForUrl(video.url);
    const profileLabel = matchedProfile
      ? `Matched profile: ${matchedProfile.name} (${matchedProfile.domainPattern})`
      : 'Global fallback cookies';

    const profileClass = matchedProfile ? '' : 'global';

    // Intercepted headers fallback
    const referer = video.headers.referer || '';
    const origin = video.headers.origin || '';
    const userAgent = video.headers.userAgent || '';

    card.innerHTML = `
      <div class="card-top">
        <span class="video-badge badge-${video.type.toLowerCase()}">${video.type}</span>
        <span class="video-url-title" title="${video.url}">${video.url}</span>
        <div class="card-actions-top">
          <button class="btn-link copy-url-btn">Copy URL</button>
        </div>
      </div>

      <div class="cookie-match-indicator ${profileClass}">
        ${profileLabel}
      </div>

      <div class="video-meta-row">
        <span class="video-size-text">Size: <span class="video-size-value">Not checked yet</span></span>
        <button type="button" class="btn-link check-size-btn">Check size</button>
      </div>

      <div class="form-group">
        <label>Output Filename (.mp4 / .mkv auto-resolved)</label>
        <input type="text" class="filename-input" value="${video.filename || 'video'}">
      </div>

      <!-- Expandable Headers Section -->
      <div class="expandable-section">
        <button type="button" class="expand-toggle">
          <span>▼ Override Headers (Expand to customize)</span>
          <span class="expand-icon">▾</span>
        </button>
        <div class="expand-content">
          <div class="form-group">
            <label>Origin Override</label>
            <input type="text" class="header-origin" value="${origin}" placeholder="https://domain.com">
          </div>
          <div class="form-group">
            <label>Referer Override</label>
            <input type="text" class="header-referer" value="${referer}" placeholder="https://domain.com/page">
          </div>
          <div class="form-group">
            <label>User-Agent Override</label>
            <input type="text" class="header-ua" value="${userAgent}" placeholder="Custom User-Agent">
          </div>
        </div>
      </div>

      <!-- Queue/Progress tracker -->
      <div class="progress-container">
        <div class="progress-info" style="align-items: center; display: flex; justify-content: space-between;">
          <span class="progress-status status-queued">Queued</span>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="progress-measure"></span>
            <span class="progress-percent">0%</span>
            <button type="button" class="btn-link cancel-download-btn" style="color: var(--status-red); font-size: 10px; font-weight: bold; text-decoration: none; padding: 0;">[Cancel]</button>
          </div>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill"></div>
        </div>
      </div>

      <div class="card-bottom-actions">
        <button class="btn btn-secondary btn-sm remove-video-btn">Remove</button>
        <button class="btn btn-primary btn-sm download-video-btn">Download</button>
      </div>
    `;

    // Wire actions
    card.querySelector('.copy-url-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(video.url);
      showToast('URL copied to clipboard.', 'success');
    });

    card.querySelector('.check-size-btn').addEventListener('click', async () => {
      await fetchVideoInfo(video, card, matchedProfile);
    });

    // Expand headers toggle
    const expSec = card.querySelector('.expandable-section');
    const expTog = card.querySelector('.expand-toggle');
    expTog.addEventListener('click', () => {
      expSec.classList.toggle('active');
    });

    // Remove video
    card.querySelector('.remove-video-btn').addEventListener('click', () => {
      removeVideoFromStorage(video.id);
    });

    // Download click orchestration
    card.querySelector('.download-video-btn').addEventListener('click', (e) => {
      triggerDownload(video, card, matchedProfile, e.target);
    });

    // Wire Cancel Download action
    card.querySelector('.cancel-download-btn').addEventListener('click', async () => {
      const jobId = card.getAttribute('data-job-id');
      if (!jobId) return;

      const cancelBtn = card.querySelector('.cancel-download-btn');
      cancelBtn.disabled = true;
      cancelBtn.innerText = 'Cancelling...';

      try {
        const response = await fetch(`${activeSettings.backendUrl}/download/cancel`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': activeSettings.apiKey
          },
          body: JSON.stringify({ jobId })
        });
        const resData = await response.json();
        if (resData.success) {
          console.log(`Job ${jobId} successfully cancelled.`);
        } else {
          showDialog({
            title: 'Could Not Cancel',
            message: resData.message || 'The backend could not cancel this transfer.',
            confirmText: 'OK',
            hideCancel: true,
            variant: 'danger'
          });
          cancelBtn.disabled = false;
          cancelBtn.innerText = '[Cancel]';
        }
      } catch (err) {
        console.error('Failed to send cancel request:', err);
        showToast('Network error sending cancel request.', 'error');
        cancelBtn.disabled = false;
        cancelBtn.innerText = '[Cancel]';
      }
    });

    elements.videosList.appendChild(card);

    // Check if there is an active running/queued job for this video
    const activeJob = activeJobsMap.get(video.url);
    if (activeJob) {
      card.setAttribute('data-job-id', activeJob.id || activeJob.jobId);
      updateCardProgressUi(video.id, activeJob.status, activeJob.progress || 0, activeJob.error || '', {
        downloadedBytes: activeJob.downloadedBytes,
        totalBytes: activeJob.totalBytes
      });
      pollJobStatus(activeJob.id || activeJob.jobId, video.id);
    }
  });
}

function removeVideoFromStorage(id) {
  chrome.storage.local.get({ detectedVideos: [] }, (res) => {
    const updated = res.detectedVideos.filter(v => v.id !== id);
    chrome.storage.local.set({ detectedVideos: updated }, () => {
      detectedVideosList = updated;
      renderVideos();
    });
  });
}

// --- Download Executor & Poller ---
function buildDownloadOptions(video, cardElement, matchedProfile) {
  const filename = cardElement.querySelector('.filename-input').value.trim();
  const origin = cardElement.querySelector('.header-origin').value.trim();
  const referer = cardElement.querySelector('.header-referer').value.trim();
  const userAgent = cardElement.querySelector('.header-ua').value.trim();

  const finalOrigin = origin || (matchedProfile && matchedProfile.defaultOrigin) || video.headers.origin || '';
  const finalReferer = referer || (matchedProfile && matchedProfile.defaultReferer) || video.headers.referer || '';
  const finalUA = userAgent || (matchedProfile && matchedProfile.defaultUserAgent) || video.headers.userAgent || activeSettings.defaultUa;
  const finalCookies = matchedProfile ? (matchedProfile.cookiesText || '') : (globalCookiesText || '');

  return {
    url: video.url,
    outputFilename: filename,
    referer: finalReferer,
    origin: finalOrigin,
    userAgent: finalUA,
    cookiesContent: finalCookies,
    target: activeSettings.tgTarget,
    quality: activeSettings.quality,
    extraFlags: activeSettings.ytdlpFlags,
    pageUrl: video.pageUrl
  };
}

async function fetchVideoInfo(video, cardElement, matchedProfile) {
  const sizeLabel = cardElement.querySelector('.video-size-value');
  const sizeBtn = cardElement.querySelector('.check-size-btn');
  const cached = videoInfoCache.get(video.url);
  if (cached) {
    sizeLabel.textContent = cached.totalBytes ? formatBytes(cached.totalBytes) : 'Size unavailable';
    return cached;
  }

  sizeBtn.disabled = true;
  sizeBtn.textContent = 'Checking...';
  sizeLabel.textContent = 'Checking...';

  try {
    const response = await fetch(`${activeSettings.backendUrl}/download/info`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': activeSettings.apiKey
      },
      body: JSON.stringify(buildDownloadOptions(video, cardElement, matchedProfile))
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error || 'Could not read video size.');
    }
    videoInfoCache.set(video.url, data);
    sizeLabel.textContent = data.totalBytes ? formatBytes(data.totalBytes) : 'Size unavailable';
    return data;
  } catch (err) {
    sizeLabel.textContent = 'Size unavailable';
    showToast(err.message || 'Could not read video size.', 'warning');
    return null;
  } finally {
    sizeBtn.disabled = false;
    sizeBtn.textContent = 'Check size';
  }
}

async function triggerDownload(video, cardElement, matchedProfile, downloadButton) {
  if (!telegramLoggedIn) {
    await checkTelegramStatus();
  }
  if (!telegramLoggedIn) {
    showDialog({
      title: 'Telegram Login Required',
      message: 'Please sign in to Telegram before starting a download.',
      detail: 'The backend can download the video, but upload will fail without an authenticated Telegram session.',
      confirmText: 'OK',
      hideCancel: true,
      variant: 'warning'
    });
    return;
  }
  if (!activeSettings.tgTarget) {
    showToast('Choose a Telegram target chat or channel first.', 'warning');
    return;
  }

  const info = await fetchVideoInfo(video, cardElement, matchedProfile);
  const options = buildDownloadOptions(video, cardElement, matchedProfile);
  if (info && info.totalBytes) {
    options.totalBytes = info.totalBytes;
  }

  // Disable UI components in the card
  updateCardProgressUi(video.id, 'Queued', 0, '', { totalBytes: options.totalBytes });

  try {
    const response = await fetch(`${activeSettings.backendUrl}/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': activeSettings.apiKey
      },
      body: JSON.stringify(options)
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      updateCardProgressUi(video.id, 'Error', 0, data.error || 'Failed to trigger download API.');
      return;
    }

    if (data.warning) {
      console.warn('Backend warning:', data.warning);
    }

    cardElement.setAttribute('data-job-id', data.jobId);

    activeJobsMap.set(video.url, {
      id: data.jobId,
      status: 'queued',
      progress: 0,
      totalBytes: options.totalBytes || null,
      downloadedBytes: 0
    });

    // Start polling status
    pollJobStatus(data.jobId, video.id);

  } catch (err) {
    console.error('Download trigger request failed:', err);
    updateCardProgressUi(video.id, 'Error', 0, 'Could not connect to the backend server.');
  }
}

function pollJobStatus(jobId, videoId) {
  if (activePolls.has(jobId)) {
    return; // Already polling
  }

  const interval = setInterval(async () => {
    try {
      const response = await fetch(`${activeSettings.backendUrl}/status/${jobId}`, {
        headers: {
          'X-API-Key': activeSettings.apiKey
        }
      });

      if (!response.ok) {
        throw new Error('Failed to query status.');
      }

      const data = await response.json();

      updateCardProgressUi(videoId, data.status, data.progress || 0, data.error || '', {
        downloadedBytes: data.downloadedBytes,
        totalBytes: data.totalBytes
      });

      if (data.status === 'done' || data.status === 'error') {
        clearInterval(interval);
        activePolls.delete(jobId);

        // Remove from activeJobsMap
        for (const [url, job] of activeJobsMap.entries()) {
          if ((job.id || job.jobId) === jobId) {
            activeJobsMap.delete(url);
            break;
          }
        }
      }

    } catch (err) {
      console.error(`Status polling failed for job ${jobId}:`, err);
    }
  }, 2000);

  activePolls.set(jobId, interval);
}

// --- Ping & Wakeup Service ---
async function pingBackend() {
  const badge = elements.backendStatus;
  const dot = badge.querySelector('.status-dot');
  const txt = badge.querySelector('.status-text');

  badge.className = 'status-badge status-waking';
  txt.innerText = 'Waking backend...';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 seconds wake up window

  const wakeTimer = setTimeout(() => {
    // Show wake up status helper if it takes >3 seconds
    txt.innerText = 'Waking backend (HF Space)...';
  }, 3000);

  try {
    const res = await fetch(`${activeSettings.backendUrl}/ping`, {
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    clearTimeout(wakeTimer);

    if (res.ok) {
      badge.className = 'status-badge status-online';
      txt.innerText = 'Connected';
      return true;
    }
  } catch (e) {
    clearTimeout(timeoutId);
    clearTimeout(wakeTimer);
  }

  badge.className = 'status-badge status-offline';
  txt.innerText = 'Offline';
  return false;
}

// --- Telegram Authentication Wizard ---
async function checkTelegramStatus() {
  try {
    const res = await fetch(`${activeSettings.backendUrl}/telegram/status`, {
      headers: { 'X-API-Key': activeSettings.apiKey }
    });

    if (!res.ok) return;

    const data = await res.json();
    updateTelegramUi(data.loggedIn, data.username);
    if (data.loggedIn) {
      await fetchTelegramChats(activeSettings.tgTarget);
    }
  } catch (e) {
    console.error('Failed to load Telegram status:', e);
  }
}

function updateTelegramUi(loggedIn, username) {
  telegramLoggedIn = !!loggedIn;
  const card = elements.tgStatusCard;
  const badge = elements.tgStatusBadge;
  const txt = elements.tgStatusText;

  // Hide all panels
  elements.authStepPhone.classList.remove('active');
  elements.authStepOtp.classList.remove('active');
  elements.authStep2fa.classList.remove('active');
  elements.authStepLogged.classList.remove('active');

  if (loggedIn) {
    card.className = 'tg-status-card logged-in';
    badge.className = 'badge badge-success';
    badge.innerText = '🟢 Logged in';
    txt.innerHTML = `Signed into Telegram user account: <strong>@${username}</strong>`;

    elements.authStepLogged.classList.add('active');
  } else {
    card.className = 'tg-status-card logged-out';
    badge.className = 'badge badge-danger';
    badge.innerText = '🔴 Not logged in';
    txt.innerText = 'Your backend is not signed into Telegram. Complete the form below to connect your account.';

    elements.authStepPhone.classList.add('active');
  }
}

let activePhoneCodeHash = null;

function setupTelegramWizardListeners() {
  // Send OTP
  elements.tgSendOtpBtn.addEventListener('click', async () => {
    const phone = elements.tgPhone.value.trim();
    if (!phone) {
      showToast('Please enter your phone number.', 'warning');
      return;
    }

    elements.tgSendOtpBtn.disabled = true;
    elements.tgSendOtpBtn.innerText = 'Sending OTP...';

    try {
      const res = await fetch(`${activeSettings.backendUrl}/telegram/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': activeSettings.apiKey
        },
        body: JSON.stringify({ phone })
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        showToast(data.error || 'Failed to send OTP.', 'error');
        elements.tgSendOtpBtn.disabled = false;
        elements.tgSendOtpBtn.innerText = 'Send OTP Code';
        return;
      }

      activePhoneCodeHash = data.phoneCodeHash;

      // Shift UI to step 2 (OTP code input)
      elements.authStepPhone.classList.remove('active');
      elements.authStepOtp.classList.add('active');
      elements.tgOtp.value = '';

    } catch (e) {
      showToast('Failed to send OTP. Server connection error.', 'error');
    } finally {
      elements.tgSendOtpBtn.disabled = false;
      elements.tgSendOtpBtn.innerText = 'Send OTP Code';
    }
  });

  // Verify OTP Code
  elements.tgVerifyOtpBtn.addEventListener('click', async () => {
    const phone = elements.tgPhone.value.trim();
    const code = elements.tgOtp.value.trim();
    if (!code) {
      showToast('Please enter the OTP verification code.', 'warning');
      return;
    }

    elements.tgVerifyOtpBtn.disabled = true;
    elements.tgVerifyOtpBtn.innerText = 'Verifying Code...';

    try {
      const res = await fetch(`${activeSettings.backendUrl}/telegram/otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': activeSettings.apiKey
        },
        body: JSON.stringify({
          phone: phone,
          code: code,
          phoneCodeHash: activePhoneCodeHash
        })
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        showToast(data.error || 'Invalid OTP code.', 'error');
        elements.tgVerifyOtpBtn.disabled = false;
        elements.tgVerifyOtpBtn.innerText = 'Verify Code';
        return;
      }

      if (data.status === '2fa_required') {
        // Shift UI to step 3 (2FA Password)
        elements.tg2faHint.innerText = `Hint: ${data.hint || 'No hint available'}`;
        elements.authStepOtp.classList.remove('active');
        elements.authStep2fa.classList.add('active');
        elements.tgPassword.value = '';
      } else {
        // Success login
        await checkTelegramStatus();
      }

    } catch (e) {
      showToast('Verify code request failed.', 'error');
    } finally {
      elements.tgVerifyOtpBtn.disabled = false;
      elements.tgVerifyOtpBtn.innerText = 'Verify Code';
    }
  });

  // Verify 2FA Password
  elements.tgVerify2faBtn.addEventListener('click', async () => {
    const password = elements.tgPassword.value;
    if (!password) {
      showToast('Please enter your 2FA password.', 'warning');
      return;
    }

    elements.tgVerify2faBtn.disabled = true;
    elements.tgVerify2faBtn.innerText = 'Verifying Password...';

    try {
      const res = await fetch(`${activeSettings.backendUrl}/telegram/2fa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': activeSettings.apiKey
        },
        body: JSON.stringify({ password })
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        showToast(data.error || 'Invalid 2FA password.', 'error');
        return;
      }

      await checkTelegramStatus();

    } catch (e) {
      showToast('2FA verification request failed.', 'error');
    } finally {
      elements.tgVerify2faBtn.disabled = false;
      elements.tgVerify2faBtn.innerText = 'Verify Password';
    }
  });

  // Log Out
  elements.tgLogoutBtn.addEventListener('click', async () => {
    const ok = await showDialog({
      title: 'Sign Out of Telegram?',
      message: 'This will disconnect the backend Telegram session. Downloads can still be queued, but uploads will fail until you sign in again.',
      confirmText: 'Sign Out',
      cancelText: 'Stay Signed In',
      variant: 'danger'
    });
    if (!ok) return;

    elements.tgLogoutBtn.disabled = true;
    elements.tgLogoutBtn.innerText = 'Logging out...';

    try {
      const res = await fetch(`${activeSettings.backendUrl}/telegram/logout`, {
        method: 'POST',
        headers: { 'X-API-Key': activeSettings.apiKey }
      });

      if (res.ok) {
        updateTelegramUi(false, null);
      }
    } catch (e) {
      showToast('Logout request failed.', 'error');
    } finally {
      elements.tgLogoutBtn.disabled = false;
      elements.tgLogoutBtn.innerText = 'Sign Out of Telegram';
    }
  });

  // Back buttons
  elements.tgBackPhoneBtn.addEventListener('click', () => {
    elements.authStepOtp.classList.remove('active');
    elements.authStepPhone.classList.add('active');
  });

  elements.tgBackOtpBtn.addEventListener('click', () => {
    elements.authStep2fa.classList.remove('active');
    elements.authStepOtp.classList.add('active');
  });
}

// --- History & Logs (Tab 4) ---
async function fetchHistory() {
  elements.historyList.innerHTML = '<div style="text-align:center; padding: 20px; font-size: 13px; color: var(--text-muted);">Fetching download logs...</div>';

  try {
    const res = await fetch(`${activeSettings.backendUrl}/jobs?limit=25`, {
      headers: { 'X-API-Key': activeSettings.apiKey }
    });

    if (!res.ok) {
      throw new Error('Server returned non-ok response.');
    }

    const data = await res.json();
    renderHistory(data);

  } catch (err) {
    console.error('Failed to fetch download logs:', err);
    elements.historyList.innerHTML = `
      <div class="empty-state" style="border-color: var(--status-red);">
        <div class="empty-icon" style="color: var(--status-red);">!</div>
        <h3>Failed to load logs</h3>
        <p>Could not fetch history from backend. Ensure settings and API keys are correct.</p>
      </div>
    `;
  }
}

function renderHistory(jobs) {
  elements.historyList.innerHTML = '';

  if (jobs.length === 0) {
    elements.historyList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📜</div>
        <h3>No download logs</h3>
        <p>Start downloading videos to build a history stream.</p>
      </div>
    `;
    return;
  }

  jobs.forEach(job => {
    const card = document.createElement('div');
    card.className = 'history-card';

    const cleanDate = new Date(job.createdAt).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const statusClass = `status-${job.status.toLowerCase()}`;
    const displayName = job.outputName || job.filename || 'Unnamed video';
    const progress = Math.max(0, Math.min(100, Number(job.progress || 0)));
    const transferredText = job.totalBytes
      ? `${formatBytes(job.downloadedBytes)} / ${formatBytes(job.totalBytes)}`
      : '';

    card.innerHTML = `
      <div class="history-title" title="${displayName}">${displayName}</div>
      <div style="font-size: 10px; color: var(--text-dark); word-break: break-all; margin-top: 2px;">URL: ${job.url}</div>

      ${job.error ? `<div class="history-error-msg">${job.error}</div>` : ''}


      <div class="history-progress">
        <div class="progress-info">
          <span class="history-progress-text">${transferredText}</span>
          <span class="history-progress-text">${progress}%</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width: ${progress}%;"></div>
        </div>
      </div>

      <div class="history-meta">
        <span>${cleanDate}</span>
        <span class="history-status-badge ${statusClass}">${job.status}</span>
      </div>

      ${job.status === 'error' || job.status === 'done' ? `
        <div class="mt-1" style="display:flex; justify-content: flex-end;">
          <button class="btn btn-secondary btn-sm retrigger-btn" style="padding: 3px 8px; font-size: 10px;">Re-download</button>
        </div>
      ` : ''}
    `;

    if (job.status === 'error' || job.status === 'done') {
      card.querySelector('.retrigger-btn').addEventListener('click', () => {
        retriggerJob(job);
      });
    }

    elements.historyList.appendChild(card);
  });
}

async function retriggerJob(job) {
  // Try to find if this URL is already in our detected list
  let matchingVideo = detectedVideosList.find(v => v.url === job.url);
  if (!matchingVideo) {
    // Construct a temporary video item
    matchingVideo = {
      id: 'retrigger_' + Date.now(),
      url: job.url,
      type: 'MP4',
      headers: {},
      pageUrl: job.pageUrl,
      filename: job.outputName,
      timestamp: Date.now()
    };
  }

  // Switch to videos tab
  document.querySelector('[data-tab="tab-videos"]').click();

  // Save/prepend this video to local storage so it renders in Tab 1
  chrome.storage.local.get({ detectedVideos: [] }, (res) => {
    let videos = res.detectedVideos;
    const exists = videos.some(v => v.url === matchingVideo.url);
    if (!exists) {
      videos.unshift(matchingVideo);
      chrome.storage.local.set({ detectedVideos: videos }, () => {
        // Wait for render, then scroll to card or highlight
        setTimeout(() => {
          const cardNode = document.getElementById(`card-${matchingVideo.id}`);
          if (cardNode) {
            cardNode.scrollIntoView({ behavior: 'smooth' });
            cardNode.style.border = '1px solid var(--color-primary)';
            setTimeout(() => cardNode.style.border = '1px solid var(--border-glass)', 2500);
          }
        }, 300);
      });
    } else {
      // Find card element and highlight it
      const match = videos.find(v => v.url === matchingVideo.url);
      const cardNode = document.getElementById(`card-${match.id}`);
      if (cardNode) {
        cardNode.scrollIntoView({ behavior: 'smooth' });
        cardNode.style.border = '1px solid var(--color-primary)';
        setTimeout(() => cardNode.style.border = '1px solid var(--border-glass)', 2500);
      }
    }
  });
}
