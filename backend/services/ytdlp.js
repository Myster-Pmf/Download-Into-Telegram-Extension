// VideoGrab - services/ytdlp.js
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function sanitizeFilename(name) {
  if (!name) return '%(title)s';
  // Strip characters illegal in Windows/Linux filenames
  let sanitized = name.replace(/[\/\\:\*\?"<>\|]/g, '').trim();
  // Max 200 chars
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
    
    // Create download directories
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
      '--newline'
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

    // Append quality flags
    const qualityArgs = getQualityFlags(quality);
    args.push(...qualityArgs);

    // Append custom flags
    if (extraFlags && extraFlags.trim().length > 0) {
      // Split flags while filtering empty space tokens
      const customArgs = extraFlags.split(/\s+/).filter(f => f.length > 0);
      args.push(...customArgs);
    }

    // Append source URL
    args.push(url);

    console.log(`[yt-dlp] Spawning yt-dlp with arguments:`, args);

    const child = spawn('yt-dlp', args);
    let errorOutput = '';

    child.stdout.on('data', (data) => {
      const output = data.toString();
      const lines = output.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        
        // Match percentage progress
        const match = line.match(/(\d+\.?\d*)%/);
        if (match) {
          const percent = Math.min(100, Math.round(parseFloat(match[1])));
          if (progressCallback) {
            progressCallback(percent);
          }
        }
      }
    });

    child.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    child.on('close', (code) => {
      // Clean up cookies temp file
      if (cookieFilePath && fs.existsSync(cookieFilePath)) {
        try {
          fs.unlinkSync(cookieFilePath);
        } catch (e) {
          console.error(`[yt-dlp] Failed to delete cookie file:`, e);
        }
      }

      if (code !== 0) {
        console.error(`[yt-dlp] Failed with code ${code}. Error: ${errorOutput}`);
        return reject(new Error(`yt-dlp exited with code ${code}. Details: ${errorOutput}`));
      }

      // Locate downloaded file inside the jobDir
      try {
        const files = fs.readdirSync(jobDir);
        if (files.length === 0) {
          return reject(new Error('No downloaded files found in job directory.'));
        }
        
        // Select the first file (excluding any temp parts if left over, though code 0 ensures download is complete)
        // Usually, the finished file won't have .part extension
        const completedFile = files.find(f => !f.endsWith('.part') && !f.endsWith('.ytdl'));
        if (!completedFile) {
          return reject(new Error('Could not find completed download file (only temp parts found).'));
        }

        const finalPath = path.join(jobDir, completedFile);
        resolve({
          filepath: finalPath,
          filename: completedFile
        });
      } catch (e) {
        reject(new Error(`Failed to resolve output file: ${e.message}`));
      }
    });

    child.on('error', (err) => {
      if (cookieFilePath && fs.existsSync(cookieFilePath)) {
        try {
          fs.unlinkSync(cookieFilePath);
        } catch (e) {}
      }
      reject(err);
    });
  });
}

module.exports = {
  downloadVideo
};
