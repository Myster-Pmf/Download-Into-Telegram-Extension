// VideoGrab - popup-videos.js
// Video detection rendering, download triggering, progress polling, and history

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

/** Return the canonical page URL from a video entry (used for tab-scope filter) */
function getVideoPageUrl(video) {
  return video.pageUrl || video.srcUrl || '';
}

/** Filter detectedVideosList to the active tab's exact URL */
function getVideosForCurrentTab() {
  if (!activeTabExactUrl) return detectedVideosList;
  // Normalize: strip trailing slash and fragment
  const normalize = (u) => { try { const p = new URL(u); return p.origin + p.pathname.replace(/\/$/, ''); } catch { return u; } };
  const tabNorm = normalize(activeTabExactUrl);
  return detectedVideosList.filter(v => normalize(getVideoPageUrl(v)) === tabNorm);
}

function renderVideos() {
  const list = elements.videosList;
  if (!list) return;
  list.innerHTML = '';

  const scopeEl  = elements.scopeTabCheckbox;
  const tabScope = scopeEl ? scopeEl.checked : true;
  let videos     = tabScope ? getVideosForCurrentTab() : detectedVideosList;

  if (videos.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🎬</div>
        <p>No videos detected on this page.<br>
           <span class="empty-hint">Navigate to a page with video content and videos will appear here automatically.</span>
        </p>
      </div>`;
    return;
  }

  // Sort by resolution (height) descending, then by filesize descending
  videos = [...videos].sort((a, b) => {
    const ha = a.height || 0, hb = b.height || 0;
    if (hb !== ha) return hb - ha;
    return (b.filesize || 0) - (a.filesize || 0);
  });

  videos.forEach((video) => renderVideoCard(video, list));
}

function renderVideoCard(video, container) {
  const card = document.createElement('div');
  card.className = 'video-card';
  card.id = `video-card-${video.id || video.srcUrl}`;

  const title    = video.title || video.filename || extractFilename(video.srcUrl) || 'Unknown Video';
  const size     = video.filesize ? formatBytes(video.filesize) : '';
  const duration = video.duration ? formatDuration(video.duration) : '';
  const res      = (video.width && video.height) ? `${video.width}×${video.height}` : '';
  const domain   = getDomain(video.pageUrl || '');
  const thumb    = video.thumbnail || null;

  // Check if already being downloaded
  const existingJob = [...activeJobsMap.values()].find(j => j.srcUrl === video.srcUrl);
  const isActive    = existingJob && ['queued', 'downloading', 'downloaded', 'uploading'].includes(existingJob.status);

  card.innerHTML = `
    <div class="video-card-inner">
      ${thumb ? `<div class="video-thumb"><img src="${escapeHtml(thumb)}" alt="Thumbnail" /></div>` : ''}
      <div class="video-card-body">
        <div class="video-title" title="${escapeHtml(title)}">${escapeHtml(truncateStr(title, 60))}</div>
        <div class="video-meta">
          ${domain     ? `<span class="meta-chip">🌐 ${escapeHtml(domain)}</span>` : ''}
          ${res        ? `<span class="meta-chip">📐 ${res}</span>` : ''}
          ${size       ? `<span class="meta-chip">💾 ${size}</span>` : '<span class="meta-chip size-loading" data-src="${escapeHtml(video.srcUrl)}">💾 …</span>'}
          ${duration   ? `<span class="meta-chip">⏱ ${duration}</span>` : ''}
        </div>
        ${isActive ? renderProgressBar(existingJob) : ''}
        <div class="video-card-actions">
          <input class="video-name-input" type="text" placeholder="Output name (optional)" value="${escapeHtml(video.outputName || '')}" id="name-${video.id}" />
          <button class="btn-download${isActive ? ' btn-disabled' : ''}" data-video-id="${escapeHtml(video.id || video.srcUrl)}" ${isActive ? 'disabled' : ''}>
            ${isActive ? '⏳ Queued' : '⬇️ Send to Telegram'}
          </button>
        </div>
      </div>
    </div>`;

  container.appendChild(card);

  // Download button handler
  const dlBtn = card.querySelector('.btn-download');
  if (dlBtn && !isActive) {
    dlBtn.addEventListener('click', () => {
      const nameInput = card.querySelector('.video-name-input');
      triggerDownload(video, nameInput ? nameInput.value.trim() : '');
    });
  }
}

function renderProgressBar(job) {
  if (!job) return '';
  const pct    = Math.min(100, Math.max(0, job.progress || 0));
  const status = statusLabel(job.status);
  const speed  = job.speed ? ` · ${formatSpeed(job.speed)}` : '';
  const bytes  = job.totalBytes ? ` · ${formatBytes(job.downloadedBytes || 0)} / ${formatBytes(job.totalBytes)}` : '';
  return `
    <div class="progress-wrap">
      <div class="progress-label">${status}${bytes}${speed}</div>
      <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
    </div>`;
}

function statusLabel(status) {
  const labels = {
    queued:      '⏳ Queued',
    downloading: '⬇️ Downloading',
    downloaded:  '✅ Downloaded',
    uploading:   '📤 Uploading to Telegram',
    done:        '✅ Done',
    error:       '❌ Error'
  };
  return labels[status] || status;
}

function truncateStr(str, max) {
  if (!str) return '';
  return str.length > max ? str.substring(0, max - 1) + '…' : str;
}

function extractFilename(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop().split('?')[0]) || '';
  } catch { return ''; }
}

// ---------------------------------------------------------------------------
// Download triggering
// ---------------------------------------------------------------------------

async function triggerDownload(video, outputName) {
  if (!activeSettings.tgTarget) {
    showToast('No Telegram target selected. Go to the Telegram tab to set one.', 'warning');
    return;
  }

  const videoUrl  = video.srcUrl || video.url || '';
  const pageUrl   = video.pageUrl || activeTabExactUrl || '';

  if (!videoUrl) {
    showToast('Cannot download: video URL is missing.', 'error');
    return;
  }

  // Match profile using the page URL first (where the video was detected),
  // then fall back to the video src URL (CDN domain).
  const matchedProfile = matchProfileForUrl(pageUrl) || matchProfileForUrl(videoUrl);
  const cookiesText    = await getCookiesForDownload(video, matchedProfile);
  
  // Resolve headers: profile overrides > captured request headers > computed defaults
  const capturedHeaders = video.headers || {};
  const ua      = (matchedProfile?.userAgent) || capturedHeaders.userAgent || activeSettings.defaultUa || globalUserAgent || navigator.userAgent;
  const referer = (matchedProfile?.referer)   || capturedHeaders.referer  || pageUrl || '';

  // Compute origin from referer/pageUrl if not explicitly overridden
  let defaultOrigin = '';
  try { if (referer) defaultOrigin = new URL(referer).origin; } catch (e) {}
  const origin = (matchedProfile?.origin) ? matchedProfile.origin : (capturedHeaders.origin || defaultOrigin);

  const body = {
    url:            videoUrl,
    outputFilename: outputName || video.title || '',
    referer:        referer,
    origin:         origin,
    userAgent:      ua,
    cookiesContent: cookiesText || '',
    target:         activeSettings.tgTarget,
    quality:        activeSettings.quality || 'best',
    extraFlags:     activeSettings.ytdlpFlags || '',
    pageUrl:        pageUrl
  };

  try {
    const res = await fetch(`${getBackendUrl()}/download`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key':    getApiKey()
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const jobId = data.jobId;
    if (!jobId) throw new Error('Backend did not return a jobId.');

    // Record the job with source srcUrl so we can match it back to the card
    activeJobsMap.set(jobId, {
      jobId,
      srcUrl:   videoUrl,
      status:   'queued',
      progress: 0
    });

    const profileInfo = matchedProfile ? ` · Profile: ${matchedProfile.name}` : '';
    const cookieInfo  = cookiesText ? ` · Cookies: ${countCookies(cookiesText)}` : '';
    showToast(`Queued!${profileInfo}${cookieInfo}`, 'success');
    renderVideos();
    startPolling(jobId, video);

  } catch (e) {
    console.error('[Download] triggerDownload error:', e);
    showToast(`Failed to queue: ${e.message}`, 'error');
  }
}


// ---------------------------------------------------------------------------
// Progress polling
// ---------------------------------------------------------------------------

function startPolling(jobId, video) {
  if (activePolls.has(jobId)) return;

  const intervalId = setInterval(async () => {
    try {
      const res = await fetch(`${getBackendUrl()}/status/${jobId}`, {
        headers: { 'X-API-Key': getApiKey() }
      });
      if (!res.ok) return;
      const job = await res.json();

      activeJobsMap.set(jobId, { ...job, srcUrl: video.srcUrl });

      // Update card progress bar without full re-render
      updateCardProgress(video.srcUrl, job);

      if (['done', 'error'].includes(job.status)) {
        clearInterval(intervalId);
        activePolls.delete(jobId);

        if (job.status === 'done') {
          showToast(`✅ Upload complete: ${job.filename || 'file'}`, 'success');
          // Remove job from active map after brief delay (so final state shows)
          setTimeout(() => {
            activeJobsMap.delete(jobId);
            renderVideos();
          }, 3000);
        } else if (job.status === 'error') {
          showToast(`❌ Job failed: ${job.error || 'Unknown error'}`, 'error');
          activeJobsMap.delete(jobId);
          renderVideos();
        }

        // Refresh history list
        await renderHistory();
      }
    } catch (e) {
      console.error('[Poll] Error polling job:', jobId, e);
    }
  }, 2000);

  activePolls.set(jobId, intervalId);
}

/** Update only the progress bar inside a card (avoids full list re-render during active transfer) */
function updateCardProgress(srcUrl, job) {
  const cardId = `video-card-${srcUrl}`;
  const card   = document.getElementById(cardId) || document.querySelector(`[id^="video-card-"]`);

  // Find the right card by data attribute
  const allCards = document.querySelectorAll('.video-card .btn-download');
  let targetCard = null;
  allCards.forEach(btn => {
    if (btn.dataset.videoId === srcUrl) targetCard = btn.closest('.video-card');
  });
  if (!targetCard) return;

  // Update or insert progress bar
  let pw = targetCard.querySelector('.progress-wrap');
  if (!pw) {
    pw = document.createElement('div');
    const actions = targetCard.querySelector('.video-card-actions');
    if (actions) actions.insertAdjacentElement('beforebegin', pw);
  }
  pw.outerHTML = renderProgressBar(job);

  // Update download button
  const btn = targetCard.querySelector('.btn-download');
  if (btn) {
    const isActive = ['queued', 'downloading', 'downloaded', 'uploading'].includes(job.status);
    btn.disabled = isActive;
    btn.className = `btn-download${isActive ? ' btn-disabled' : ''}`;
    btn.textContent = isActive ? statusLabel(job.status) : '⬇️ Send to Telegram';
  }
}

// ---------------------------------------------------------------------------
// Auto-size & duration fetch
// ---------------------------------------------------------------------------

/** Attempt to HEAD-request a video URL to get size and populate the card */
async function fetchVideoMeta(video) {
  if (!video.srcUrl) return;
  if (videoInfoCache.has(video.srcUrl)) {
    const cached = videoInfoCache.get(video.srcUrl);
    Object.assign(video, cached);
    return;
  }

  try {
    // Include cookies so protected CDN content doesn't 403
    const matchedProfile = matchProfileForUrl(video.pageUrl) || matchProfileForUrl(video.srcUrl);
    const cookiesText = await getCookiesForDownload(video, matchedProfile);

    const headers = {};
    if (cookiesText) headers['Cookie'] = cookiesText.split('\n')
      .filter(l => l.trim() && !l.startsWith('#'))
      .map(l => { const parts = l.split('\t'); return parts.length >= 7 ? `${parts[5]}=${parts[6]}` : ''; })
      .filter(Boolean)
      .join('; ');

    const res = await fetch(video.srcUrl, { method: 'HEAD', headers, signal: AbortSignal.timeout(6000) });
    const contentLength = res.headers.get('content-length');
    const contentType   = res.headers.get('content-type') || '';

    if (contentLength) video.filesize = parseInt(contentLength, 10);

    videoInfoCache.set(video.srcUrl, {
      filesize: video.filesize || null,
      duration: video.duration || null,
      mimeType: contentType
    });
  } catch {
    // Silently ignore — CORS or network errors are expected for cross-origin media
  }
}

// ---------------------------------------------------------------------------
// Clear detected videos
// ---------------------------------------------------------------------------

function initVideosEvents() {
  if (elements.clearVideosBtn) {
    elements.clearVideosBtn.addEventListener('click', async () => {
      const ok = await showDialog({
        title: 'Clear Video List',
        message: 'Remove all detected videos from the list? (Does not cancel active downloads.)',
        confirmText: 'Clear',
        variant: 'warning'
      });
      if (!ok) return;
      detectedVideosList = [];
      chrome.storage.local.set({ detectedVideos: [] }, () => {
        renderVideos();
        showToast('Video list cleared.', 'info');
      });
    });
  }

  if (elements.scopeTabCheckbox) {
    elements.scopeTabCheckbox.addEventListener('change', renderVideos);
  }
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

async function renderHistory() {
  const list = elements.historyList;
  if (!list) return;

  list.innerHTML = '<div class="history-loading">Loading history…</div>';

  try {
    const res = await fetch(`${getBackendUrl()}/jobs?limit=50`, {
      headers: { 'X-API-Key': getApiKey() }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const jobs = await res.json();

    list.innerHTML = '';

    if (!jobs || jobs.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <p>No download history yet.<br>Completed downloads will appear here.</p>
        </div>`;
      return;
    }

    jobs.forEach(job => {
      const row = document.createElement('div');
      row.className = `history-row status-${job.status}`;

      const name    = job.outputName || job.filename || extractFilename(job.url) || 'Unknown';
      const size    = job.totalBytes ? formatBytes(job.totalBytes) : '';
      const speed   = job.speed      ? formatSpeed(job.speed)      : '';
      const timeAgo = formatRelativeTime(job.createdAt);
      const statusBadge = `<span class="status-badge ${job.status}">${statusLabel(job.status)}</span>`;

      row.innerHTML = `
        <div class="history-row-main">
          <span class="history-name" title="${escapeHtml(job.url)}">${escapeHtml(truncateStr(name, 55))}</span>
          ${statusBadge}
        </div>
        <div class="history-row-meta">
          ${size    ? `<span>💾 ${size}</span>` : ''}
          ${speed   ? `<span>⚡ ${speed}</span>` : ''}
          ${timeAgo ? `<span>🕐 ${timeAgo}</span>` : ''}
          ${job.error ? `<span class="history-error" title="${escapeHtml(job.error)}">⚠️ ${escapeHtml(truncateStr(job.error, 50))}</span>` : ''}
        </div>`;

      list.appendChild(row);
    });

  } catch (e) {
    list.innerHTML = `<div class="history-error-msg">Failed to load history: ${e.message}</div>`;
  }
}

async function clearFinishedHistory() {
  const ok = await showDialog({
    title: 'Clear History',
    message: 'Remove all completed and failed downloads from history? Active jobs are unaffected.',
    confirmText: 'Clear History',
    variant: 'danger'
  });
  if (!ok) return;

  try {
    const res = await fetch(`${getBackendUrl()}/jobs/finished`, {
      method:  'DELETE',
      headers: { 'X-API-Key': getApiKey() }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await renderHistory();
    showToast('History cleared.', 'success');
  } catch (e) {
    showToast(`Failed to clear: ${e.message}`, 'error');
  }
}

function initHistoryEvents() {
  if (elements.refreshHistoryBtn) {
    elements.refreshHistoryBtn.addEventListener('click', renderHistory);
  }
  if (elements.clearHistoryBtn) {
    elements.clearHistoryBtn.addEventListener('click', clearFinishedHistory);
  }
}

// ---------------------------------------------------------------------------
// Receive video detections from background script
// ---------------------------------------------------------------------------

function initVideoDetectionListener() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== 'VIDEO_DETECTED') return;

    const { srcUrl, pageUrl, title, filename, filesize, duration, thumbnail, mimeType, width, height } = message;
    if (!srcUrl) return;

    // Update existing entry or create new one
    const existingIdx = detectedVideosList.findIndex(v => v.srcUrl === srcUrl);
    if (existingIdx !== -1) {
      const existing = detectedVideosList[existingIdx];
      if (width) existing.width = width;
      if (height) existing.height = height;
      if (duration) existing.duration = duration;
      if (filesize) existing.filesize = filesize;
    } else {
      const video = {
        id:        srcUrl,
        srcUrl,
        pageUrl,
        title:     title    || filename || extractFilename(srcUrl),
        filename:  filename || extractFilename(srcUrl),
        filesize:  filesize || null,
        duration:  duration || null,
        width:     width    || null,
        height:    height   || null,
        thumbnail: thumbnail || null,
        mimeType:  mimeType  || ''
      };

      detectedVideosList.unshift(video);

      if (detectedVideosList.length > 200) detectedVideosList.length = 200;

      // If size unknown, try HEAD fetch to auto-populate
      if (!video.filesize) {
        fetchVideoMeta(video).then(() => {
          const tabScope = elements.scopeTabCheckbox ? elements.scopeTabCheckbox.checked : true;
          const videos   = tabScope ? getVideosForCurrentTab() : detectedVideosList;
          if (videos.includes(video)) renderVideos();
        });
      }
    }

    chrome.storage.local.set({ detectedVideos: detectedVideosList });

    const scopeEl = elements.scopeTabCheckbox;
    const tabScope = scopeEl ? scopeEl.checked : true;
    if (!tabScope || getVideoPageUrl({ pageUrl }) === activeTabExactUrl) {
      renderVideos();
    }
  });
}
