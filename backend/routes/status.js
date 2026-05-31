// VideoGrab - routes/status.js
const express = require('express');
const router = express.Router();
const db = require('../services/db');

// GET /status/:jobId - Poll status of a specific job
router.get('/status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await db.getJob(jobId);

    if (!job) {
      return res.status(404).json({ error: `Job with ID "${jobId}" not found.` });
    }

    res.json({
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      downloadedBytes: job.downloaded_bytes || 0,
      totalBytes: job.total_bytes || null,
      filename: job.filename,
      error: job.error
    });
  } catch (error) {
    console.error('[Router] Error fetching job status:', error);
    res.status(500).json({ error: 'Failed to retrieve job status.' });
  }
});

// GET /jobs - Fetch download history log
router.get('/jobs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const jobs = await db.getJobs(limit);

    res.json(
      jobs.map(j => ({
        jobId: j.id,
        url: j.url,
        outputName: j.output_name,
        status: j.status,
        progress: j.progress,
        downloadedBytes: j.downloaded_bytes || 0,
        totalBytes: j.total_bytes || null,
        filename: j.filename,
        pageUrl: j.page_url,
        error: j.error,
        createdAt: j.created_at
      }))
    );
  } catch (error) {
    console.error('[Router] Error fetching jobs history:', error);
    res.status(500).json({ error: 'Failed to retrieve jobs history.' });
  }
});

module.exports = router;
