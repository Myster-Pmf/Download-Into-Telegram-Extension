// VideoGrab - background.js (Manifest V3)

const VIDEO_REGEX = /\.(m3u8|mpd|mp4|mkv|webm|ts|m4s|f4v|3gp|avi|mov|wmv|flv)($|\?)/i;

// Content-Type patterns that indicate actual video streams (not manifests)
const VIDEO_CONTENT_TYPES = [
  'video/mp4', 'video/webm', 'video/x-flv', 'video/x-msvideo',
  'video/quicktime', 'video/x-ms-wmv', 'video/3gpp', 'video/ogg',
  'video/mpeg', 'video/mp2t', 'video/x-matroska'
];

function getVideoType(url) {
  const match = url.match(VIDEO_REGEX);
  if (match) {
    const ext = match[1].toLowerCase();
    if (ext === 'm3u8') return 'HLS';
    if (ext === 'mpd') return 'DASH';
    if (ext === 'ts') return 'HLS-Segment';
    if (ext === 'm4s') return 'DASH-Segment';
    return ext.toUpperCase();
  }
  return 'MP4';
}

function getVideoTypeFromContentType(contentType) {
  const ct = contentType.toLowerCase().split(';')[0].trim();
  if (ct === 'video/mp4') return 'MP4';
  if (ct === 'video/webm') return 'WEBM';
  if (ct === 'video/x-matroska') return 'MKV';
  if (ct === 'video/mp2t') return 'HLS-Segment';
  if (ct === 'video/x-flv') return 'FLV';
  if (ct === 'video/quicktime') return 'MOV';
  if (ct === 'video/3gpp') return '3GP';
  return 'MP4';
}

function isVideoUrl(url) {
  return VIDEO_REGEX.test(url);
}

function isVideoContentType(contentType) {
  if (!contentType) return false;
  const ct = contentType.toLowerCase().split(';')[0].trim();
  return VIDEO_CONTENT_TYPES.some(vt => ct === vt);
}

// Clean filename candidate from page title or URL slug
function sanitizeFilename(title, url) {
  let name = '';
  if (title) {
    name = title;
  } else {
    try {
      const parsed = new URL(url);
      const parts = parsed.pathname.split('/');
      name = parts[parts.length - 1] || 'video';
      name = name.replace(/\.(m3u8|mpd|mp4|mkv|webm|ts|m4s|f4v|3gp|avi|mov|wmv|flv)$/i, '');
    } catch (e) {
      name = 'video';
    }
  }
  return name.replace(/[\/\\:\*\?"<>\|]/g, '').trim().substring(0, 150) || 'video';
}

// ---------------------------------------------------------------------------
// 1) URL-extension based detection (existing logic, now with more extensions)
// ---------------------------------------------------------------------------

chrome.webRequest.onBeforeSendHeaders.addListener(
  function(details) {
    const url = details.url;
    if (!isVideoUrl(url)) return;

    const headers = {};
    if (details.requestHeaders) {
      for (const header of details.requestHeaders) {
        const name = header.name.toLowerCase();
        if (name === 'referer') headers.referer = header.value;
        if (name === 'origin') headers.origin = header.value;
        if (name === 'user-agent') headers.userAgent = header.value;
      }
    }

    const type = getVideoType(url);

    if (details.tabId >= 0) {
      chrome.tabs.get(details.tabId, function(tab) {
        const pageTitle = tab ? tab.title : '';
        const pageUrl = tab ? tab.url : '';
        const cleanName = sanitizeFilename(pageTitle, url);
        saveVideo(url, type, headers, pageUrl, cleanName);
      });
    } else {
      const cleanName = sanitizeFilename('', url);
      saveVideo(url, type, headers, '', cleanName);
    }
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders", "extraHeaders"]
);

// ---------------------------------------------------------------------------
// 2) Content-Type based detection — catches videos served without extensions
// ---------------------------------------------------------------------------

chrome.webRequest.onResponseStarted.addListener(
  function(details) {
    const url = details.url;
    // Skip if already caught by the extension-based regex
    if (isVideoUrl(url)) return;

    // Check response headers for video Content-Type
    let contentType = '';
    if (details.responseHeaders) {
      for (const header of details.responseHeaders) {
        if (header.name.toLowerCase() === 'content-type') {
          contentType = header.value || '';
          break;
        }
      }
    }

    if (!isVideoContentType(contentType)) return;

    const headers = {};
    // Capture request headers from the tab if available
    if (details.tabId >= 0) {
      chrome.tabs.get(details.tabId, function(tab) {
        const pageTitle = tab ? tab.title : '';
        const pageUrl = tab ? tab.url : '';
        const cleanName = sanitizeFilename(pageTitle, url);
        const type = getVideoTypeFromContentType(contentType);
        saveVideo(url, type, headers, pageUrl, cleanName);
      });
    } else {
      const cleanName = sanitizeFilename('', url);
      const type = getVideoTypeFromContentType(contentType);
      saveVideo(url, type, headers, '', cleanName);
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// ---------------------------------------------------------------------------
// 3) Message handling — popup requests + real-time notifications
// ---------------------------------------------------------------------------

// Respond to popup's GET_DETECTED_VIDEOS request
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_DETECTED_VIDEOS') {
    chrome.storage.local.get({ detectedVideos: [] }, (result) => {
      sendResponse({ videos: result.detectedVideos });
    });
    return true; // keep message channel open for async response
  }

  if (message.type === 'VIDEO_DETECTED_FROM_CONTENT') {
    // Content script detected a <video> element
    const { srcUrl, pageUrl } = message;
    if (!srcUrl || srcUrl.startsWith('blob:')) return;
    const cleanName = sanitizeFilename('', srcUrl);
    saveVideo(srcUrl, getVideoType(srcUrl), {}, pageUrl || '', cleanName);
  }
});

// ---------------------------------------------------------------------------
// 4) Storage + notification helpers
// ---------------------------------------------------------------------------

function saveVideo(url, type, headers, pageUrl, cleanName) {
  chrome.storage.local.get({ detectedVideos: [] }, function(result) {
    let videos = result.detectedVideos;

    const index = videos.findIndex(v => v.url === url);
    const newVideo = {
      id: 'vid_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      url: url,
      type: type,
      headers: headers,
      pageUrl: pageUrl,
      filename: cleanName,
      timestamp: Date.now()
    };

    if (index !== -1) {
      newVideo.id = videos[index].id;
      videos[index] = newVideo;
    } else {
      videos.unshift(newVideo);
    }

    if (videos.length > 100) {
      videos = videos.slice(0, 100);
    }

    chrome.storage.local.set({ detectedVideos: videos });

    // Notify popup if it's open (ignore errors if no listener)
    try {
      chrome.runtime.sendMessage({
        type: 'VIDEO_DETECTED',
        srcUrl: url,
        pageUrl: pageUrl,
        title: cleanName,
        filename: cleanName,
        filesize: null,
        duration: null,
        thumbnail: null,
        mimeType: ''
      }, () => { void chrome.runtime.lastError; });
    } catch (e) {
      // Popup not open — safe to ignore
    }
  });
}
