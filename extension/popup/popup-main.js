// VideoGrab - popup-main.js
// DOMContentLoaded orchestration: load data, wire up tabs, init all modules

document.addEventListener('DOMContentLoaded', async () => {

  // Handle logo load error without inline handler (CSP compliant)
  const logoImg = document.getElementById('app-logo-img');
  if (logoImg) {
    logoImg.addEventListener('error', () => { logoImg.style.display = 'none'; });
  }
  await new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0]) {
        activeTabUrl      = getDomain(tabs[0].url || '') ? (new URL(tabs[0].url)).origin : '';
        activeTabExactUrl = tabs[0].url || '';
      }
      resolve();
    });
  });

  // 2. Load all persisted data from storage
  await new Promise((resolve) => loadPersistedData(resolve));

  // Normalize: clear stale old default values that were saved by previous versions
  // Old default API key was 'my_secure_shared_secret_api_key' — reset to blank so new default applies
  const OLD_DEFAULT_API_KEYS = ['my_secure_shared_secret_api_key', 'your_api_key_here', 'omnitrix2.0', 'downloadIntoTelegrambyOmnitrix'];
  if (OLD_DEFAULT_API_KEYS.includes(activeSettings.apiKey)) {
    activeSettings.apiKey = '';
  }
  // Old default backend was also saved literally — keep it as is since it's the same URL
  // 3. Populate settings form fields
  populateSettingsForm();

  // 4. Wire up all event listeners (order doesn't matter as long as DOM is ready)
  initSettingsEvents();
  initCookieUIEvents();
  initProfileEvents();
  initVideosEvents();
  initHistoryEvents();
  initTelegramEvents();
  initTabNavigation();

  // 6. Check backend health
  checkBackendStatus();

  // 7. Refresh live cookie state for current tab
  await refreshLiveCookiesState();

  // 8. Render site profiles
  renderProfiles();

  // 9. Render videos (already detected ones from storage)
  renderVideos();

  // 10. Register video detection listener (incoming from background)
  initVideoDetectionListener();

  // 11. Request any already-detected videos from the background script
  chrome.runtime.sendMessage({ type: 'GET_DETECTED_VIDEOS' }, (response) => {
    if (chrome.runtime.lastError) return; // background may not have responded
    if (response && Array.isArray(response.videos)) {
      let updated = false;
      response.videos.forEach(v => {
        if (!detectedVideosList.some(existing => existing.srcUrl === v.srcUrl)) {
          detectedVideosList.unshift(v);
          updated = true;
        }
      });
      if (updated) {
        chrome.storage.local.set({ detectedVideos: detectedVideosList });
        renderVideos();
      }
    }
  });

  // 12. Check Telegram login status and auto-load chat list if logged in
  await checkTelegramLoginStatus();
  if (telegramLoggedIn) {
    const chats = await fetchTelegramChats();
    populateTargetSelect(chats, activeSettings.tgTarget);
  }

  // 13. Restore active jobs from storage (resume polling on any jobs that were active)
  resumeActivePolls();
});

// --- Tab Navigation ---
function initTabNavigation() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels  = document.querySelectorAll('.tab-panel');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;

      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const panel = document.getElementById(`tab-${targetTab}`);
      if (panel) panel.classList.add('active');

      // Lazy-load tab content
      if (targetTab === 'profiles') renderProfiles();
      if (targetTab === 'history') renderHistory();
      if (targetTab === 'telegram') checkTelegramLoginStatus();
    });
  });
}

// --- Resume polling for any jobs that were in-progress when popup was closed ---
async function resumeActivePolls() {
  try {
    const res = await fetch(`${getBackendUrl()}/jobs?limit=25`, {
      headers: { 'X-API-Key': getApiKey() }
    });
    if (!res.ok) return;
    const jobs = await res.json();

    const active = jobs.filter(j =>
      ['queued', 'downloading', 'downloaded', 'uploading'].includes(String(j.status).toLowerCase())
    );

    active.forEach(job => {
      const jobId = job.jobId;
      if (!activePolls.has(jobId)) {
        // We don't have the srcUrl here; try to match from detectedVideosList by page_url
        const video = detectedVideosList.find(v => v.pageUrl === job.pageUrl) || { srcUrl: job.url || '' };
        activeJobsMap.set(jobId, {
          jobId,
          srcUrl:   video.srcUrl || job.url || '',
          status:   job.status,
          progress: job.progress || 0
        });
        startPolling(jobId, video);
      }
    });

    if (active.length > 0) renderVideos();
  } catch (e) {
    console.error('[Main] resumeActivePolls error:', e);
  }
}
