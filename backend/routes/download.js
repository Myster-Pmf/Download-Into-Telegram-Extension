// VideoGrab - routes/download.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../services/db');

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

module.exports = router;
