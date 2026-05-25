// VideoGrab - services/db.js
// A clean, pure-JS, JSON-file-based database repository for job history.
// Provides safe, synchronous read/write access to prevent node-gyp build issues on Windows.

const fs = require('fs');
const path = require('path');

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '../data');
const DB_PATH = path.join(DATA_DIR, 'jobs.json');

function initDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify([], null, 2));
  }
}

function readJobs() {
  try {
    initDb();
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    console.error('[DB] Error reading jobs database:', e);
    return [];
  }
}

function writeJobs(jobs) {
  try {
    initDb();
    fs.writeFileSync(DB_PATH, JSON.stringify(jobs, null, 2));
  } catch (e) {
    console.error('[DB] Error writing jobs database:', e);
  }
}

function createJob(job) {
  const jobs = readJobs();
  const newJob = {
    id: job.id,
    url: job.url,
    output_name: job.output_name || null,
    status: 'queued',
    progress: 0,
    downloaded_bytes: 0,
    total_bytes: job.total_bytes || null,
    filename: null,
    filepath: null,
    page_url: job.page_url || null,
    payload: job.payload || null,
    error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  jobs.push(newJob);
  writeJobs(jobs);
  return newJob;
}

function updateJob(id, updates) {
  const jobs = readJobs();
  const index = jobs.findIndex(j => j.id === id);
  if (index !== -1) {
    jobs[index] = {
      ...jobs[index],
      ...updates,
      updated_at: new Date().toISOString()
    };
    writeJobs(jobs);
    return jobs[index];
  }
  return null;
}

function getJob(id) {
  const jobs = readJobs();
  return jobs.find(j => j.id === id) || null;
}

function getJobs(limit = 20) {
  const jobs = readJobs();
  // Sort descending by created_at (newest first)
  return jobs
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);
}

function getNextJob() {
  const jobs = readJobs();
  // Find the first job that is queued, sorted ascending by created_at (oldest first)
  const queued = jobs
    .filter(j => j.status === 'queued')
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return queued[0] || null;
}

function getNextDownloadedJob() {
  const jobs = readJobs();
  const downloaded = jobs
    .filter(j => j.status === 'downloaded')
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return downloaded[0] || null;
}

function getJobsByStatus(status) {
  return readJobs().filter(j => j.status === status);
}

function getRunningJobsCount() {
  const jobs = readJobs();
  return jobs.filter(j => j.status === 'downloading' || j.status === 'uploading').length;
}

function getRecentDuplicate(url) {
  const jobs = readJobs();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  return jobs.find(j => 
    j.url === url && 
    j.status === 'done' && 
    new Date(j.created_at) > sevenDaysAgo
  ) || null;
}

function resetStuckJobs() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const jobs = JSON.parse(raw);
    let changed = false;
    jobs.forEach(j => {
      if (j.status === 'downloading') {
        j.status = 'queued';
        j.progress = 0;
        j.error = 'Server restarted while download was in progress; job was requeued.';
        j.updated_at = new Date().toISOString();
        changed = true;
      } else if (j.status === 'uploading') {
        j.status = 'error';
        j.error = 'Server restarted while upload was in progress. Check Telegram before retrying to avoid duplicates.';
        j.updated_at = new Date().toISOString();
        changed = true;
      }
    });
    if (changed) {
      fs.writeFileSync(DB_PATH, JSON.stringify(jobs, null, 2));
      console.log('[DB] Cleaned up stuck downloading/uploading jobs from previous session.');
    }
  } catch (e) {
    console.error('[DB] Error resetting stuck jobs:', e);
  }
}

// Automatically initialize when file is loaded
initDb();
resetStuckJobs();

module.exports = {
  initDb,
  createJob,
  updateJob,
  getJob,
  getJobs,
  getNextJob,
  getNextDownloadedJob,
  getJobsByStatus,
  getRunningJobsCount,
  getRecentDuplicate
};
