// VideoGrab - routes/download.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../services/db');
const ytdlp = require('../services/ytdlp');
const { cleanupJobFolder } = require('../services/jobQueue');

// POST / - Enqueue a download job
router.post('/', async (req, res) => {
  try {
    const {
      url,
      outputFilename,
      referer,
      origin,
      userAgent,
      cookiesContent,
      target,
      quality,
      extraFlags,
      pageUrl,
      totalBytes
    } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'Missing video URL in request body.' });
    }

    // Check duplicate download in the last 7 days
    const duplicate = await db.getRecentDuplicate(url);
    const hasDuplicate = !!duplicate;

    // Create a new job ID
    const jobId = uuidv4();

    // Sanitize filename for SQLite/JSON record
    let cleanFilename = outputFilename || '';
    cleanFilename = cleanFilename.replace(/[\/\\:\*\?"<>|]/g, '').trim();
    if (cleanFilename.length > 200) {
      cleanFilename = cleanFilename.substring(0, 200);
    }

    // Assemble payload for the yt-dlp/upload worker
    const payload = {
      url,
      outputFilename: cleanFilename,
      referer,
      origin,
      userAgent,
      cookiesContent,
      target,
      quality: quality || 'best',
      extraFlags,
      pageUrl
    };

    // Store job in database
    const jobRecord = {
      id: jobId,
      url: url,
      output_name: cleanFilename || null,
      page_url: pageUrl || null,
      total_bytes: totalBytes || null,
      payload: payload
    };

    await db.createJob(jobRecord);

    console.log(`[Router] Enqueued download job ${jobId} for URL ${url}`);

    res.json({
      jobId: jobId,
      status: 'queued',
      warning: hasDuplicate ? 'Warning: This video was already downloaded within the last 7 days.' : null
    });

  } catch (error) {
    console.error('[Router] Error enqueuing download:', error);
    res.status(500).json({ error: 'Failed to enqueue download job.' });
  }
});

// POST /info - Resolve video metadata before queuing a download
router.post('/info', async (req, res) => {
  try {
    const info = await ytdlp.getVideoInfo(req.body || {});
    res.json(info);
  } catch (error) {
    console.error('[Router] Error resolving video info:', error);
    res.status(500).json({ error: error.message || 'Failed to resolve video metadata.' });
  }
});

// POST /cancel - Cancel a queued or running job
router.post('/cancel', async (req, res) => {
  try {
    const { jobId } = req.body;
    if (!jobId) {
      return res.status(400).json({ error: 'Missing jobId in request body.' });
    }

    const job = await db.getJob(jobId);
    if (!job) {
      return res.status(404).json({ error: `Job with ID "${jobId}" not found.` });
    }

    if (job.status === 'done' || job.status === 'error') {
      return res.json({ success: false, message: `Job is already finished with status: ${job.status}` });
    }

    console.log(`[Router] Cancelling job ${jobId} (current status: ${job.status})`);

    // 1. If downloading, kill the active process
    if (job.status === 'downloading') {
      ytdlp.cancelDownload(jobId);
      await db.updateJob(jobId, { status: 'error', error: 'Download was cancelled by user.' });
      return res.json({ success: true, message: 'Download cancellation signal sent.' });
    }

    // 2. If queued, just mark as cancelled
    if (job.status === 'queued') {
      await db.updateJob(jobId, { status: 'error', error: 'Job cancelled by user before starting.' });
      return res.json({ success: true, message: 'Queued job cancelled.' });
    }

    // 3. If downloaded but not yet uploaded, mark cancelled and clean up local file
    if (job.status === 'downloaded') {
      await db.updateJob(jobId, { status: 'error', error: 'Job cancelled by user before upload.' });
      cleanupJobFolder(jobId);
      return res.json({ success: true, message: 'Downloaded job cancelled and local file removed.' });
    }

    // 4. If uploading, mark as cancelled (worker checks status before marking done)
    if (job.status === 'uploading') {
      await db.updateJob(jobId, { status: 'error', error: 'Upload was cancelled by user.' });
      return res.json({ success: true, message: 'Upload marked as cancelled. If Telegram already accepted the transfer, it may still finish.' });
    }

    res.json({ success: false, message: 'Could not cancel job in current state.' });

  } catch (error) {
    console.error('[Router] Error cancelling download:', error);
    res.status(500).json({ error: 'Failed to cancel download job.' });
  }
});

module.exports = router;
