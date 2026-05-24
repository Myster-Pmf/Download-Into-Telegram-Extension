// VideoGrab - background.js (Manifest V2)

const VIDEO_REGEX = /\.(m3u8|mpd|mp4|mkv|webm)($|\?)/i;

function getVideoType(url) {
  const match = url.match(VIDEO_REGEX);
  if (match) {
    const ext = match[1].toLowerCase();
    if (ext === 'm3u8') return 'HLS';
    if (ext === 'mpd') return 'DASH';
    return ext.toUpperCase();
  }
  return 'MP4';
}

function isVideoUrl(url) {
  return VIDEO_REGEX.test(url);
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
      // Strip extension if present
      name = name.replace(/\.(m3u8|mpd|mp4|mkv|webm)$/i, '');
    } catch (e) {
      name = 'video';
    }
  }
  
  // Strip illegal Windows/Unix filename characters
  return name.replace(/[\/\\:\*\?"<>\|]/g, '').trim().substring(0, 150) || 'video';
}

// Keep in-memory cache of requests to avoid duplication in rapid fires
const processedUrls = new Set();

chrome.webRequest.onBeforeSendHeaders.addListener(
  function(details) {
    const url = details.url;
    if (!isVideoUrl(url)) return;

    // Check if we've already processed this exact URL in the last 5 seconds
    if (processedUrls.has(url)) return;
    processedUrls.add(url);
    setTimeout(() => processedUrls.delete(url), 5000);

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

    // Get Tab details
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

function saveVideo(url, type, headers, pageUrl, cleanName) {
  chrome.storage.local.get({ detectedVideos: [] }, function(result) {
    let videos = result.detectedVideos;
    
    // Check if URL already exists in storage, if so update it, else prepend
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
      // Update existing item metadata but keep its ID
      newVideo.id = videos[index].id;
      videos[index] = newVideo;
    } else {
      videos.unshift(newVideo);
    }

    // Cap at 100 items
    if (videos.length > 100) {
      videos = videos.slice(0, 100);
    }

    chrome.storage.local.set({ detectedVideos: videos });
  });
}
