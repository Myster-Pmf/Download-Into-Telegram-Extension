// VideoGrab - services/jobQueue.js
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const db = require('./db');
const ytdlp = require('./ytdlp');
const telegramClient = require('./telegramClient');

const MAX_CONCURRENT_DOWNLOADS = Math.max(1, parseInt(process.env.MAX_CONCURRENT_DOWNLOADS || '1', 10));
const MAX_READY_UPLOADS = Math.max(1, parseInt(process.env.MAX_READY_UPLOADS || '2', 10));
const TELEGRAM_MAX_UPLOAD_BYTES = Math.max(
  50 * 1024 * 1024,
  parseInt(process.env.TELEGRAM_MAX_UPLOAD_BYTES || String(1900 * 1024 * 1024), 10)
);

let activeDownloads = 0;
let isUploading = false;
let pollingInterval = null;

function cleanupJobFolder(jobId) {
  const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..');
  const jobDir = path.join(DATA_DIR, `downloads/${jobId}`);
  if (fs.existsSync(jobDir)) {
    try {
      fs.rmSync(jobDir, { recursive: true, force: true });
      console.log(`[Queue] Cleaned up temporary directory: downloads/${jobId}`);
    } catch (e) {
      console.error(`[Queue] Failed to delete directory ${jobDir}:`, e);
    }
  }
}

async function getReadyUploadCount() {
  const jobs = await db.getJobsByStatus('downloaded');
  return jobs.length;
}

function getFileSize(filepath) {
  return fs.statSync(filepath).size;
}

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = '';

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}. ${stderr.substring(0, 500)}`));
      }
    });
  });
}

function getVideoDuration(filepath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filepath
    ];
    const child = spawn('ffprobe', args, { windowsHide: true });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      const duration = parseFloat(stdout.trim());
      if (code === 0 && Number.isFinite(duration) && duration > 0) {
        resolve(duration);
      } else {
        reject(new Error(`Could not read video duration with ffprobe. ${stderr.substring(0, 300)}`));
      }
    });
  });
}

function removeFiles(files) {
  for (const file of files) {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (e) {
      console.warn(`[Queue] Failed to remove temporary split file ${file}: ${e.message}`);
    }
  }
}

async function splitVideoForTelegram(filepath, filename) {
  const fileSize = getFileSize(filepath);
  if (fileSize <= TELEGRAM_MAX_UPLOAD_BYTES) {
    return [{ filepath, filename }];
  }

  const duration = await getVideoDuration(filepath);
  const dir = path.dirname(filepath);
  const ext = path.extname(filename) || '.mp4';
  const baseName = path.basename(filename, ext);
  let partCount = Math.max(2, Math.ceil((fileSize / TELEGRAM_MAX_UPLOAD_BYTES) * 1.1));
  let lastOutputs = [];

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    removeFiles(lastOutputs);
    const segmentTime = Math.max(60, Math.floor(duration / partCount));
    const outputPattern = path.join(dir, `${baseName}.part%03d${ext}`);

    console.log(`[Queue] Splitting ${filename} (${formatBytes(fileSize)}) into ~${partCount} playable parts.`);

    await runCommand('ffmpeg', [
      '-hide_banner',
      '-y',
      '-i', filepath,
      '-map', '0',
      '-c', 'copy',
      '-f', 'segment',
      '-segment_time', String(segmentTime),
      '-reset_timestamps', '1',
      '-avoid_negative_ts', 'make_zero',
      outputPattern
    ]);

    const outputs = fs.readdirSync(dir)
      .filter(file => file.startsWith(`${baseName}.part`) && file.endsWith(ext))
      .sort()
      .map(file => path.join(dir, file));

    lastOutputs = outputs;
    if (outputs.length === 0) {
      throw new Error('ffmpeg did not create any split video parts.');
    }

    const largestPart = Math.max(...outputs.map(getFileSize));
    if (largestPart <= TELEGRAM_MAX_UPLOAD_BYTES) {
      return outputs.map((partPath) => ({
        filepath: partPath,
        filename: path.basename(partPath)
      }));
    }

    partCount = Math.ceil(partCount * 1.5);
  }

  throw new Error(`Could not split ${filename} below Telegram upload threshold. Largest generated part was still too large.`);
}

async function runDownload(job) {
  const jobId = job.id;
  console.log(`[Queue] Downloading job ${jobId} | URL: ${job.url}`);

  try {
    await db.updateJob(jobId, { status: 'downloading', progress: 0, error: null });

    const result = await ytdlp.downloadVideo(jobId, job.payload, async (progress) => {
      if (typeof progress === 'number') {
        await db.updateJob(jobId, { progress });
      } else {
        await db.updateJob(jobId, {
          progress: progress.percent,
          downloaded_bytes: progress.downloadedBytes || 0,
          total_bytes: progress.totalBytes || job.total_bytes || null,
          speed: progress.speed || null
        });
      }
    });

    console.log(`[Queue] Download finished for job ${jobId}. Local file: ${result.filepath}`);

    await db.updateJob(jobId, {
      filename: result.filename,
      filepath: result.filepath,
      status: 'downloaded',
      progress: 100,
      downloaded_bytes: getFileSize(result.filepath),
      total_bytes: getFileSize(result.filepath)
    });
  } catch (err) {
    console.error(`[Queue] Download job ${jobId} encountered an error:`, err);

    const currentJob = await db.getJob(jobId);
    if (!currentJob || currentJob.status !== 'error') {
      await db.updateJob(jobId, {
        status: 'error',
        error: err.message || 'An unexpected error occurred during download.'
      });
    }
    cleanupJobFolder(jobId);
  }
}

async function runUpload(job) {
  const jobId = job.id;
  console.log(`[Queue] Uploading job ${jobId} | File: ${job.filepath}`);

  try {
    await db.updateJob(jobId, { status: 'uploading', progress: 0, downloaded_bytes: 0, error: null });

    const filepath = job.filepath;
    const filename = job.filename;

    if (!filepath || !fs.existsSync(filepath)) {
      throw new Error('Downloaded file not found on disk before upload.');
    }

    const authStatus = await telegramClient.checkLoginStatus();
    if (!authStatus.loggedIn) {
      throw new Error('Telegram client is not authenticated. Please log in through the extension popup settings.');
    }

    const dateStr = new Date().toISOString().split('T')[0];
    const titleName = job.output_name || filename.replace(/\.[^/.]+$/, '');
    const target = job.payload.target || process.env.TELEGRAM_TARGET || '@mygroup';

    const uploadParts = await splitVideoForTelegram(filepath, filename);
    const totalParts = uploadParts.length;

    for (let index = 0; index < totalParts; index += 1) {
      const part = uploadParts[index];
      const partLabel = totalParts > 1 ? ` (${index + 1}/${totalParts})` : '';
      const caption = `Video: ${titleName}${partLabel}\nSource: ${job.page_url || 'N/A'}\nDate: ${dateStr}`;

      await telegramClient.uploadFile(
        target,
        part.filepath,
        part.filename,
        caption,
        async (progressFloat, uploadSpeed) => {
          const partProgress = totalParts === 1
            ? progressFloat
            : (index + progressFloat) / totalParts;
          const percent = Math.min(99, Math.round(partProgress * 100));
          const cur = await db.getJob(jobId);
          if (cur && cur.status === 'uploading') {
            const totalBytes = cur.total_bytes || getFileSize(filepath);
            await db.updateJob(jobId, {
              progress: percent,
              downloaded_bytes: Math.round((percent / 100) * totalBytes),
              total_bytes: totalBytes,
              speed: uploadSpeed || null
            });
          }
        }
      );
    }

    const currentJob = await db.getJob(jobId);
    if (currentJob && currentJob.status === 'uploading') {
      const totalBytes = currentJob.total_bytes || getFileSize(filepath);
      await db.updateJob(jobId, { status: 'done', progress: 100, downloaded_bytes: totalBytes, total_bytes: totalBytes });
      console.log(`[Queue] Job ${jobId} finished successfully.`);
    } else {
      console.log(`[Queue] Job ${jobId} was cancelled during upload. Skipping success completion.`);
    }

    cleanupJobFolder(jobId);
  } catch (err) {
    console.error(`[Queue] Upload job ${jobId} encountered an error:`, err);

    const currentJob = await db.getJob(jobId);
    if (!currentJob || currentJob.status !== 'error') {
      await db.updateJob(jobId, {
        status: 'error',
        error: err.message || 'An unexpected error occurred during upload.'
      });
    }
    cleanupJobFolder(jobId);
  }
}

async function startNextDownloads() {
  const readyCount = await getReadyUploadCount();
  while (activeDownloads < MAX_CONCURRENT_DOWNLOADS && readyCount < MAX_READY_UPLOADS) {
    const nextJob = await db.getNextJob();
    if (!nextJob) return;

    activeDownloads += 1;
    runDownload(nextJob)
      .catch((err) => {
        console.error(`[Queue] Critical download worker error on job ${nextJob.id}:`, err);
      })
      .finally(() => {
        activeDownloads -= 1;
        setImmediate(processQueue);
      });
  }
}

async function startNextUpload() {
  if (isUploading) return;

  const nextJob = await db.getNextDownloadedJob();
  if (!nextJob) return;

  isUploading = true;
  runUpload(nextJob)
    .catch((err) => {
      console.error(`[Queue] Critical upload worker error on job ${nextJob.id}:`, err);
    })
    .finally(() => {
      isUploading = false;
      setImmediate(processQueue);
    });
}

function processQueue() {
  startNextUpload().catch(err => console.error('[Queue] Error in startNextUpload:', err));
  startNextDownloads().catch(err => console.error('[Queue] Error in startNextDownloads:', err));
}

function startQueueWorker() {
  if (pollingInterval) return;

  console.log('[Queue] Job queue worker started.');
  pollingInterval = setInterval(processQueue, 1500);
  setImmediate(processQueue);
}

module.exports = {
  startQueueWorker,
  cleanupJobFolder
};
