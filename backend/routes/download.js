// VideoGrab - routes/download.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../services/db');
const ytdlp = require('../services/ytdlp');

router.post('/', (req, res) => {
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
      pageUrl
    } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'Missing video URL in request body.' });
    }

    // Check duplicate download in the last 7 days
    const duplicate = db.getRecentDuplicate(url);
    const hasDuplicate = !!duplicate;

    // Create a new job ID
    const jobId = uuidv4();

    // Sanitize filename for SQLite/JSON record
    let cleanFilename = outputFilename || '';
    cleanFilename = cleanFilename.replace(/[\/\\:\*\?"<>\|]/g, '').trim();
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
      payload: payload // Save the payload alongside the job row
    };

    db.createJob(jobRecord);

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

// POST /cancel - Cancel a queued or running job
router.post('/cancel', (req, res) => {
  try {
    const { jobId } = req.body;
    if (!jobId) {
      return res.status(400).json({ error: 'Missing jobId in request body.' });
    }

    const job = db.getJob(jobId);
    if (!job) {
      return res.status(404).json({ error: `Job with ID "${jobId}" not found.` });
    }

    if (job.status === 'done' || job.status === 'error') {
      return res.json({ success: false, message: `Job is already finished with status: ${job.status}` });
    }

    console.log(`[Router] Cancelling job ${jobId} (current status: ${job.status})`);

    // 1. If downloading, kill the process
    if (job.status === 'downloading') {
      ytdlp.cancelDownload(jobId); // Kill process if active in memory
      db.updateJob(jobId, { status: 'error', error: 'Download was cancelled by user.' });
      return res.json({ success: true, message: 'Download cancellation signal sent.' });
    }

    // 2. If queued, just mark as error/cancelled
    if (job.status === 'queued') {
      db.updateJob(jobId, { status: 'error', error: 'Job cancelled by user before starting.' });
      return res.json({ success: true, message: 'Queued job cancelled.' });
    }

    // 3. If uploading, mark as error/cancelled (the worker will ignore the success completion)
    if (job.status === 'uploading') {
      db.updateJob(jobId, { status: 'error', error: 'Upload was cancelled by user.' });
      return res.json({ success: true, message: 'Upload cancellation signal sent.' });
    }

    res.json({ success: false, message: 'Could not cancel job in current state.' });

  } catch (error) {
    console.error('[Router] Error cancelling download:', error);
    res.status(500).json({ error: 'Failed to cancel download job.' });
  }
});

module.exports = router;
