// VideoGrab - services/jobQueue.js
const fs = require('fs');
const path = require('path');
const db = require('./db');
const ytdlp = require('./ytdlp');
const telegramClient = require('./telegramClient');

let isWorking = false;
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

async function runJob(job) {
  const jobId = job.id;
  console.log(`[Queue] Processing job ${jobId} | URL: ${job.url}`);

  try {
    // 1. Shift state to downloading
    db.updateJob(jobId, { status: 'downloading', progress: 0 });

    // 2. Execute yt-dlp download
    const result = await ytdlp.downloadVideo(jobId, job.payload, (progressPercent) => {
      db.updateJob(jobId, { progress: progressPercent });
    });

    const filepath = result.filepath;
    const filename = result.filename;

    console.log(`[Queue] Download finished for job ${jobId}. Local file: ${filepath}`);

    // Update DB with actual filename and shift state to uploading
    db.updateJob(jobId, { 
      filename: filename, 
      status: 'uploading',
      progress: 0 
    });

    // 3. Pre-check file size (max 2 GB Telegram user upload limit)
    if (!fs.existsSync(filepath)) {
      throw new Error('Downloaded file not found on disk after completion.');
    }
    const stats = fs.statSync(filepath);
    const fileSizeInBytes = stats.size;
    const fileSizeInGB = fileSizeInBytes / (1024 * 1024 * 1024);

    if (fileSizeInBytes > 2 * 1024 * 1024 * 1024) {
      throw new Error(`File size is ${fileSizeInGB.toFixed(2)} GB, which exceeds the Telegram user account limit of 2.0 GB.`);
    }

    // 4. Verify Telegram Login Status
    const authStatus = await telegramClient.checkLoginStatus();
    if (!authStatus.loggedIn) {
      throw new Error('Telegram client is not authenticated. Please log in through the extension popup settings.');
    }

    // 5. Upload file via MTProto User account
    const dateStr = new Date().toISOString().split('T')[0];
    const titleName = job.output_name || filename.replace(/\.[^/.]+$/, "");
    const caption = `📹 ${titleName}\n🔗 ${job.page_url || 'N/A'}\n⏱ ${dateStr}`;
    
    const target = job.payload.target || process.env.TELEGRAM_TARGET || '@mygroup';

    await telegramClient.uploadFile(
      target,
      filepath,
      filename,
      caption,
      (progressFloat) => {
        const percent = Math.min(99, Math.round(progressFloat * 100)); // Cap upload progress visual below 100 until fully completed
        const cur = db.getJob(jobId);
        if (cur && cur.status === 'uploading') {
          db.updateJob(jobId, { progress: percent });
        }
      }
    );

    // 6. Complete task
    const currentJob = db.getJob(jobId);
    if (currentJob && currentJob.status === 'uploading') {
      db.updateJob(jobId, { status: 'done', progress: 100 });
      console.log(`[Queue] Job ${jobId} finished successfully.`);
    } else {
      console.log(`[Queue] Job ${jobId} was cancelled during upload. Skipping success completion.`);
    }

    // 7. Remove local downloaded files
    cleanupJobFolder(jobId);

  } catch (err) {
    console.error(`[Queue] Job ${jobId} encountered an error:`, err);
    
    // Only update to generic error if the job isn't already marked as error/cancelled
    const currentJob = db.getJob(jobId);
    if (!currentJob || currentJob.status !== 'error') {
      db.updateJob(jobId, { 
        status: 'error', 
        error: err.message || 'An unexpected error occurred during processing.' 
      });
    }
    // Ensure directory is cleaned
    cleanupJobFolder(jobId);
  }
}

function processQueue() {
  if (isWorking) return;

  // Read currently running processes count (max concurrency = 1)
  const runningCount = db.getRunningJobsCount();
  const maxConcurrency = 1;

  if (runningCount >= maxConcurrency) {
    return;
  }

  // Get next queued job (FIFO)
  const nextJob = db.getNextJob();
  if (!nextJob) {
    return;
  }

  isWorking = true;
  runJob(nextJob)
    .catch((err) => {
      console.error(`[Queue] Critical worker error on job ${nextJob.id}:`, err);
    })
    .finally(() => {
      isWorking = false;
      // Recurse immediately to fetch next job in queue if any
      setImmediate(processQueue);
    });
}

function startQueueWorker() {
  if (pollingInterval) return;
  
  console.log('[Queue] Job queue worker started.');
  // Poll queue database every 1.5 seconds
  pollingInterval = setInterval(processQueue, 1500);
}

module.exports = {
  startQueueWorker
};
