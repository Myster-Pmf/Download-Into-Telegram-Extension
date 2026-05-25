// VideoGrab - services/ytdlp.js
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Track active child processes by jobId for cancellation
const activeProcesses = new Map();

function sanitizeFilename(name) {
  if (!name) return '%(title)s';
  let sanitized = name.replace(/[\/\\:\*\?"<>\|]/g, '').trim();
  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 200);
  }
  return sanitized || '%(title)s';
}

function getQualityFlags(quality) {
  switch (String(quality).toLowerCase()) {
    case '1080p':
      return ['-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]'];
    case '720p':
      return ['-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]'];
    case '480p':
      return ['-f', 'bestvideo[height<=480]+bestaudio/best[height<=480]'];
    case '360p':
      return ['-f', 'bestvideo[height<=360]+bestaudio/best[height<=360]'];
    case 'worst':
      return ['-f', 'worstvideo+worstaudio/worst'];
    case 'best':
    default:
      return ['-f', 'bestvideo+bestaudio/best'];
  }
}

function downloadVideo(jobId, options, progressCallback) {
  return new Promise((resolve, reject) => {
    const {
      url,
      outputFilename,
      referer,
      origin,
      userAgent,
      cookiesContent,
      quality,
      extraFlags
    } = options;

    const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..');
    const downloadsDir = path.join(DATA_DIR, 'downloads');
    const jobDir = path.join(downloadsDir, jobId);

    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir, { recursive: true });
    }
    if (!fs.existsSync(jobDir)) {
      fs.mkdirSync(jobDir, { recursive: true });
    }

    let cookieFilePath = null;
    if (cookiesContent && cookiesContent.trim().length > 0) {
      cookieFilePath = path.join(os.tmpdir(), `cookies_${jobId}.txt`);
      fs.writeFileSync(cookieFilePath, cookiesContent);
    }

    const args = [
      '--no-update',
      '--hls-prefer-native',
      '--newline',
      '--progress'
    ];

    if (cookieFilePath) {
      args.push('--cookies', cookieFilePath);
    }

    if (referer) {
      args.push('--add-header', `Referer: ${referer}`);
    }
    if (origin) {
      args.push('--add-header', `Origin: ${origin}`);
    }
    if (userAgent) {
      args.push('--user-agent', userAgent);
    }

    const sanitizedName = sanitizeFilename(outputFilename);
    const outPathTemplate = path.join(jobDir, `${sanitizedName}.%(ext)s`);
    args.push('-o', outPathTemplate);

    const qualityArgs = getQualityFlags(quality);
    args.push(...qualityArgs);

    if (extraFlags && extraFlags.trim().length > 0) {
      const customArgs = extraFlags.split(/\s+/).filter(f => f.length > 0);
      args.push(...customArgs);
    }

    args.push(url);

    console.log(`[yt-dlp] Spawning job ${jobId}:`, args.join(' '));

    const child = spawn('yt-dlp', args, { windowsHide: true });
    let errorOutput = '';
    let lastProgress = 0;

    // Store reference for cancellation
    activeProcesses.set(jobId, child);

    const cleanupCookies = () => {
      if (cookieFilePath && fs.existsSync(cookieFilePath)) {
        try { fs.unlinkSync(cookieFilePath); } catch (e) {}
      }
    };

    // Parse progress from both stdout and stderr (yt-dlp sends progress to both depending on version)
    const handleOutput = (data) => {
      const output = data.toString();
      const lines = output.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;

        // Match percentage: "[download]  47.3% of ~234.56MiB" or "47.3%"
        const percentMatch = line.match(/(\d+\.?\d*)%/);
        if (percentMatch) {
          const percent = Math.min(100, Math.round(parseFloat(percentMatch[1])));
          if (percent > lastProgress) {
            lastProgress = percent;
            if (progressCallback) {
              progressCallback(percent);
            }
          }
        }

        // Match fragment progress: "(frag 47/100)"
        const fragMatch = line.match(/\(frag\s+(\d+)\/(\d+)\)/);
        if (fragMatch) {
          const current = parseInt(fragMatch[1], 10);
          const total = parseInt(fragMatch[2], 10);
          if (total > 0) {
            const fragPercent = Math.round((current / total) * 100);
            if (fragPercent > lastProgress) {
              lastProgress = fragPercent;
              if (progressCallback) {
                progressCallback(fragPercent);
              }
            }
          }
        }
      }
    };

    child.stdout.on('data', handleOutput);
    child.stderr.on('data', (data) => {
      const text = data.toString();
      errorOutput += text;
      // Also parse stderr for progress (some yt-dlp versions output there)
      handleOutput(data);
    });

    child.on('close', (code, signal) => {
      activeProcesses.delete(jobId);
      cleanupCookies();

      // If killed by cancel signal
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        return reject(new Error('Download was cancelled by user.'));
      }

      if (code !== 0) {
        console.error(`[yt-dlp] Job ${jobId} failed (code ${code}). stderr: ${errorOutput.substring(0, 500)}`);
        return reject(new Error(`yt-dlp exited with code ${code}. ${errorOutput.substring(0, 300)}`));
      }

      // Locate downloaded file
      try {
        const files = fs.readdirSync(jobDir);
        if (files.length === 0) {
          return reject(new Error('No downloaded files found in job directory.'));
        }
        const completedFile = files.find(f => !f.endsWith('.part') && !f.endsWith('.ytdl'));
        if (!completedFile) {
          return reject(new Error('Could not find completed download file (only temp parts found).'));
        }

        const finalPath = path.join(jobDir, completedFile);
        resolve({ filepath: finalPath, filename: completedFile });
      } catch (e) {
        reject(new Error(`Failed to resolve output file: ${e.message}`));
      }
    });

    child.on('error', (err) => {
      activeProcesses.delete(jobId);
      cleanupCookies();
      reject(err);
    });
  });
}

function cancelDownload(jobId) {
  const child = activeProcesses.get(jobId);
  if (child) {
    console.log(`[yt-dlp] Cancelling download for job ${jobId}`);
    child.kill('SIGTERM');
    activeProcesses.delete(jobId);
    return true;
  }
  return false;
}

module.exports = {
  downloadVideo,
  cancelDownload
};
