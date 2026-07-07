// VideoGrab - content.js
// Monitors <video> elements in the page and reports sources to the background script.

(function () {
  'use strict';

  const reported = new Set();

  function reportVideo(srcUrl) {
    if (!srcUrl || srcUrl.startsWith('blob:') || srcUrl.startsWith('data:')) return;
    if (reported.has(srcUrl)) return;
    reported.add(srcUrl);
    try {
      chrome.runtime.sendMessage({
        type: 'VIDEO_DETECTED_FROM_CONTENT',
        srcUrl: srcUrl,
        pageUrl: location.href
      }, () => { void chrome.runtime.lastError; });
    } catch (e) {
      // Extension context invalidated — ignore
    }
  }

  function scanVideoElement(video) {
    const src = video.src || video.currentSrc || '';
    if (src) reportVideo(src);

    // Also check <source> children
    const sources = video.querySelectorAll('source');
    sources.forEach(s => {
      if (s.src) reportVideo(s.src);
    });
  }

  function scanAllVideos() {
    document.querySelectorAll('video').forEach(scanVideoElement);
  }

  // Scan existing videos on load
  scanAllVideos();

  // Watch for new <video> elements or src attribute changes
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'childList') {
        m.addedNodes.forEach(node => {
          if (node.nodeName === 'VIDEO') scanVideoElement(node);
          if (node.querySelectorAll) node.querySelectorAll('video').forEach(scanVideoElement);
        });
      }
      if (m.type === 'attributes' && m.target.nodeName === 'VIDEO') {
        scanVideoElement(m.target);
      }
      if (m.type === 'attributes' && m.target.nodeName === 'SOURCE') {
        const parentVideo = m.target.closest('video');
        if (parentVideo) scanVideoElement(parentVideo);
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src']
  });
})();
