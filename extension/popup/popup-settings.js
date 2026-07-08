// VideoGrab - popup-settings.js
// Load/save app settings, Telegram chat list, target dropdown management

/** Populate the settings form fields from activeSettings */
function populateSettingsForm() {
  if (elements.settBackendUrl)  elements.settBackendUrl.value  = activeSettings.backendUrl  || '';
  if (elements.settApiKey)      elements.settApiKey.value      = activeSettings.apiKey      || '';
  if (elements.settQuality)     elements.settQuality.value     = activeSettings.quality     || 'best';
  if (elements.settAutoMatch)   elements.settAutoMatch.value   = activeSettings.autoMatch   || 'true';
  if (elements.settDefaultUa)   elements.settDefaultUa.value   = activeSettings.defaultUa   || navigator.userAgent;
  if (elements.settYtdlpFlags)  elements.settYtdlpFlags.value  = activeSettings.ytdlpFlags  || '';
}

/** Save settings form values into storage and activeSettings */
function saveSettingsForm() {
  activeSettings.backendUrl  = (elements.settBackendUrl  ? elements.settBackendUrl.value.trim()  : '') || '';
  activeSettings.apiKey      = (elements.settApiKey      ? elements.settApiKey.value.trim()      : '') || '';
  activeSettings.quality     = elements.settQuality    ? elements.settQuality.value    : 'best';
  activeSettings.autoMatch   = elements.settAutoMatch  ? elements.settAutoMatch.value  : 'true';
  activeSettings.defaultUa   = elements.settDefaultUa  ? elements.settDefaultUa.value  : navigator.userAgent;
  activeSettings.ytdlpFlags  = elements.settYtdlpFlags ? elements.settYtdlpFlags.value : '';

  chrome.storage.local.set({ appSettings: activeSettings }, () => {
    showToast('Settings saved.', 'success');
    // Update backend status label after URL change
    checkBackendStatus();
  });
}

/** Load all persisted data from chrome.storage.local into globals */
function loadPersistedData(callback) {
  chrome.storage.local.get(
    ['appSettings', 'siteProfiles', 'globalCookiesText', 'globalUserAgent', 'detectedVideos', 'tgPhoneCodeHash', 'tgAuthState'],
    (result) => {
      if (result.appSettings) {
        activeSettings = { ...DEFAULT_SETTINGS, ...result.appSettings };
      }
      siteProfiles       = Array.isArray(result.siteProfiles)   ? result.siteProfiles   : [];
      globalCookiesText  = result.globalCookiesText              || '';
      globalUserAgent    = result.globalUserAgent                || navigator.userAgent;
      tgPhoneCodeHash    = result.tgPhoneCodeHash                || '';
      tgAuthState        = result.tgAuthState                    || 'phone';

      // Restore persisted video list (all URLs, cross-tab — filtered in render)
      if (Array.isArray(result.detectedVideos)) {
        detectedVideosList = result.detectedVideos.map(v => ({
          ...v,
          srcUrl: v.srcUrl || v.url || '',
          url: v.url || v.srcUrl || ''
        }));
      }

      if (callback) callback();
    }
  );
}

// --- Telegram Chat / Target Dropdown ---

/** Populate the tg-target-select dropdown with an array of chat objects */
function populateTargetSelect(chats, savedTarget) {
  const sel = elements.tgTargetSelect;
  if (!sel) return;

  // Keep the placeholder and custom option
  while (sel.options.length > 0) sel.remove(0);

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.disabled = true;
  placeholder.selected = true;
  placeholder.textContent = 'Choose a chat…';
  sel.appendChild(placeholder);

  (chats || []).forEach(chat => {
    const opt = document.createElement('option');
    opt.value = chat.id || chat.username || chat.title;
    opt.textContent = chat.title ? `${chat.title} (${chat.type || 'chat'})` : opt.value;
    sel.appendChild(opt);
  });

  // Try to restore saved value
  if (savedTarget) {
    const found = Array.from(sel.options).some(o => o.value === savedTarget);
    if (found) sel.value = savedTarget;
  }

  // Update the info label in Settings tab
  if (elements.settTgTargetInfo) {
    const current = activeSettings.tgTarget;
    elements.settTgTargetInfo.textContent = current
      ? `Current target: ${current}`
      : 'No target selected — choose a chat in the Telegram tab after logging in.';
  }
}

/** Fetch chat list from backend */
async function fetchTelegramChats() {
  try {
    const res = await fetch(`${getBackendUrl()}/telegram/chats`, {
      headers: { 'X-API-Key': getApiKey() }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json(); // [{id, title, type}]
  } catch (e) {
    console.error('[Settings] fetchTelegramChats error:', e);
    return [];
  }
}

/** Refresh the chat dropdown — call after login or manually */
async function refreshChatList() {
  const btn = elements.tgRefreshChatsBtn;
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }

  const chats = await fetchTelegramChats();
  populateTargetSelect(chats, activeSettings.tgTarget);

  if (btn) { btn.disabled = false; btn.textContent = 'Refresh Chats'; }
  showToast(chats.length ? `Loaded ${chats.length} chats.` : 'No chats found — are you logged in?', chats.length ? 'success' : 'warning');
}

/** Save the currently selected target from the dropdown into settings */
async function saveSelectedTarget() {
  const sel = elements.tgTargetSelect;
  if (!sel) return;

  const selected = sel.value;
  if (!selected) {
    showToast('Please select a chat first.', 'warning');
    return;
  }

  // Warn if active transfers exist
  const busy = await hasActiveTransfers();
  if (busy) {
    const ok = await showDialog({
      title: 'Active Transfers',
      message: 'There are active downloads/uploads. Changing the target will affect future jobs only.',
      confirmText: 'Change Anyway',
      variant: 'warning'
    });
    if (!ok) return;
  }

  activeSettings.tgTarget = selected;
  chrome.storage.local.set({ appSettings: activeSettings }, () => {
    if (elements.settTgTargetInfo) {
      elements.settTgTargetInfo.textContent = `Current target: ${selected}`;
    }
    showToast(`Target set to: ${selected}`, 'success');
  });
}

/** Check backend health and update the status indicator */
async function checkBackendStatus() {
  const el = elements.backendStatus;
  if (!el) return;

  el.className = 'backend-status checking';
  el.querySelector('.status-dot').setAttribute('aria-label', 'Checking…');
  
  const targetUrl = getBackendUrl();
  console.log('[Backend check] Pinging backend at:', `${targetUrl}/ping`);

  try {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 15000); // 15s to allow HF Space wake up
    const res = await fetch(`${targetUrl}/ping`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      console.log('[Backend check] Response OK:', data);
      el.className = 'backend-status online';
      const label = el.querySelector('.status-label');
      if (label) label.textContent = 'Backend Online';
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (e) {
    console.error('[Backend check] Failed to connect to backend:', targetUrl, e);
    el.className = 'backend-status offline';
    const label = el.querySelector('.status-label');
    if (label) {
      // Display simplified target domain in the status label for better UX
      let displayUrl = targetUrl;
      try { displayUrl = new URL(targetUrl).hostname; } catch {}
      label.textContent = `Unreachable (${displayUrl})`;
      el.setAttribute('title', `Could not connect to: ${targetUrl}. Double check this URL in the Settings tab or make sure your internet is working.`);
    }
  }
}

/** Wire up settings tab events */
function initSettingsEvents() {
  if (elements.settingsForm) {
    elements.settingsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      saveSettingsForm();
    });
  }

  if (elements.tgRefreshChatsBtn) {
    elements.tgRefreshChatsBtn.addEventListener('click', refreshChatList);
  }

  if (elements.tgSaveTargetBtn) {
    elements.tgSaveTargetBtn.addEventListener('click', saveSelectedTarget);
  }
}
