// VideoGrab - services/db.js
// Asynchronous database repository supporting local JSON file-based database
// and remote/serverless Turso SQL Database client.

const fs = require('fs');
const path = require('path');

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '../data');
const DB_PATH = path.join(DATA_DIR, 'jobs.json');

let libsqlClient = null;

// Optional Turso configuration
if (process.env.TURSO_DATABASE_URL) {
  try {
    const { createClient } = require('@libsql/client');
    libsqlClient = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN
    });
    console.log('[DB] Initializing with remote Turso database client.');
  } catch (e) {
    console.error('[DB] Failed to load @libsql/client. Make sure it is installed.', e);
  }
} else {
  console.log('[DB] Initializing with local JSON file database client.');
}

async function initDb() {
  if (libsqlClient) {
    try {
      await libsqlClient.execute(`
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY,
          url TEXT,
          output_name TEXT,
          status TEXT,
          progress INTEGER,
          downloaded_bytes INTEGER DEFAULT 0,
          total_bytes INTEGER,
          filename TEXT,
          filepath TEXT,
          page_url TEXT,
          payload TEXT,
          error TEXT,
          created_at TEXT,
          updated_at TEXT,
          speed TEXT
        )
      `);
      try {
        await libsqlClient.execute(`ALTER TABLE jobs ADD COLUMN speed TEXT`);
      } catch (err) {
        // Safe to ignore if column already exists
      }
      try {
        await libsqlClient.execute(`ALTER TABLE jobs ADD COLUMN payload TEXT`);
      } catch (err) {
        // Safe to ignore if column already exists
      }
      await libsqlClient.execute(`
        CREATE TABLE IF NOT EXISTS sessions (
          key TEXT PRIMARY KEY,
          value TEXT
        )
      `);
    } catch (e) {
      console.error('[DB] Failed to initialize Turso SQL tables:', e);
    }
  } else {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, JSON.stringify([], null, 2));
    }
  }
}

// Synchronous JSON helpers (internal to JSON mode only, wrapped in async public functions)
function readJobsSync() {
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, JSON.stringify([], null, 2));
    }
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    console.error('[DB] Error reading JSON database:', e);
    return [];
  }
}

function writeJobsSync(jobs) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(jobs, null, 2));
  } catch (e) {
    console.error('[DB] Error writing JSON database:', e);
  }
}

// Helper to parse Turso row output
function mapSqlRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    url: row.url,
    output_name: row.output_name,
    status: row.status,
    progress: Number(row.progress || 0),
    downloaded_bytes: Number(row.downloaded_bytes || 0),
    total_bytes: row.total_bytes ? Number(row.total_bytes) : null,
    filename: row.filename,
    filepath: row.filepath,
    page_url: row.page_url,
    payload: row.payload ? JSON.parse(row.payload) : null,
    error: row.error,
    created_at: row.created_at,
    updated_at: row.updated_at,
    speed: row.speed || null
  };
}

// --- Public Async Database Interface ---

async function createJob(job) {
  if (libsqlClient) {
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
      payload: job.payload ? JSON.stringify(job.payload) : null,
      error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      speed: null
    };
    await libsqlClient.execute({
      sql: `INSERT INTO jobs (id, url, output_name, status, progress, downloaded_bytes, total_bytes, filename, filepath, page_url, payload, error, created_at, updated_at, speed)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        newJob.id, newJob.url, newJob.output_name, newJob.status, newJob.progress,
        newJob.downloaded_bytes, newJob.total_bytes, newJob.filename, newJob.filepath,
        newJob.page_url, newJob.payload, newJob.error, newJob.created_at, newJob.updated_at, newJob.speed
      ]
    });
    return { ...newJob, payload: job.payload || null };
  } else {
    const jobs = readJobsSync();
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
      updated_at: new Date().toISOString(),
      speed: null
    };
    jobs.push(newJob);
    writeJobsSync(jobs);
    return newJob;
  }
}

async function updateJob(id, updates) {
  if (libsqlClient) {
    const keys = Object.keys(updates);
    if (keys.length === 0) return null;

    const setClauses = [];
    const args = [];
    for (const key of keys) {
      setClauses.push(`${key} = ?`);
      let val = updates[key];
      if (key === 'payload' && val && typeof val === 'object') {
        val = JSON.stringify(val);
      }
      args.push(val);
    }
    
    setClauses.push(`updated_at = ?`);
    const updatedAt = new Date().toISOString();
    args.push(updatedAt);
    args.push(id);

    await libsqlClient.execute({
      sql: `UPDATE jobs SET ${setClauses.join(', ')} WHERE id = ?`,
      args: args
    });

    return await getJob(id);
  } else {
    const jobs = readJobsSync();
    const index = jobs.findIndex(j => j.id === id);
    if (index !== -1) {
      jobs[index] = {
        ...jobs[index],
        ...updates,
        updated_at: new Date().toISOString()
      };
      writeJobsSync(jobs);
      return jobs[index];
    }
    return null;
  }
}

async function getJob(id) {
  if (libsqlClient) {
    const res = await libsqlClient.execute({
      sql: `SELECT * FROM jobs WHERE id = ? LIMIT 1`,
      args: [id]
    });
    if (res.rows.length === 0) return null;
    return mapSqlRow(res.rows[0]);
  } else {
    const jobs = readJobsSync();
    return jobs.find(j => j.id === id) || null;
  }
}

async function getJobs(limit = 20) {
  if (libsqlClient) {
    const res = await libsqlClient.execute({
      sql: `SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?`,
      args: [limit]
    });
    return res.rows.map(mapSqlRow);
  } else {
    const jobs = readJobsSync();
    return jobs
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  }
}

async function getNextJob() {
  if (libsqlClient) {
    const res = await libsqlClient.execute(`
      SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1
    `);
    if (res.rows.length === 0) return null;
    return mapSqlRow(res.rows[0]);
  } else {
    const jobs = readJobsSync();
    const queued = jobs
      .filter(j => j.status === 'queued')
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return queued[0] || null;
  }
}

async function getNextDownloadedJob() {
  if (libsqlClient) {
    const res = await libsqlClient.execute(`
      SELECT * FROM jobs WHERE status = 'downloaded' ORDER BY created_at ASC LIMIT 1
    `);
    if (res.rows.length === 0) return null;
    return mapSqlRow(res.rows[0]);
  } else {
    const jobs = readJobsSync();
    const downloaded = jobs
      .filter(j => j.status === 'downloaded')
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return downloaded[0] || null;
  }
}

async function getJobsByStatus(status) {
  if (libsqlClient) {
    const res = await libsqlClient.execute({
      sql: `SELECT * FROM jobs WHERE status = ?`,
      args: [status]
    });
    return res.rows.map(mapSqlRow);
  } else {
    return readJobsSync().filter(j => j.status === status);
  }
}

async function getRunningJobsCount() {
  if (libsqlClient) {
    const res = await libsqlClient.execute(`
      SELECT COUNT(*) as count FROM jobs WHERE status IN ('downloading', 'uploading')
    `);
    return Number(res.rows[0].count || 0);
  } else {
    const jobs = readJobsSync();
    return jobs.filter(j => j.status === 'downloading' || j.status === 'uploading').length;
  }
}

async function getRecentDuplicate(url) {
  if (libsqlClient) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const res = await libsqlClient.execute({
      sql: `SELECT * FROM jobs WHERE url = ? AND status = 'done' AND created_at > ? LIMIT 1`,
      args: [url, sevenDaysAgo.toISOString()]
    });
    if (res.rows.length === 0) return null;
    return mapSqlRow(res.rows[0]);
  } else {
    const jobs = readJobsSync();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return jobs.find(j => 
      j.url === url && 
      j.status === 'done' && 
      new Date(j.created_at) > sevenDaysAgo
    ) || null;
  }
}

async function resetStuckJobs() {
  if (libsqlClient) {
    try {
      const updatedAt = new Date().toISOString();
      await libsqlClient.execute({
        sql: `UPDATE jobs SET status = 'queued', progress = 0, error = ?, updated_at = ? WHERE status = 'downloading'`,
        args: ['Server restarted while download was in progress; job was requeued.', updatedAt]
      });
      await libsqlClient.execute({
        sql: `UPDATE jobs SET status = 'error', error = ?, updated_at = ? WHERE status = 'uploading'`,
        args: ['Server restarted while upload was in progress. Check Telegram before retrying to avoid duplicates.', updatedAt]
      });
      console.log('[DB] Turso SQL database cleared stuck jobs.');
    } catch (e) {
      console.error('[DB] Failed to reset stuck jobs on Turso:', e);
    }
  } else {
    try {
      if (!fs.existsSync(DB_PATH)) return;
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
}

// --- Dynamic Session Store (optional Turso persistent sessions) ---

async function getSession(key) {
  if (libsqlClient) {
    try {
      const res = await libsqlClient.execute({
        sql: `SELECT value FROM sessions WHERE key = ? LIMIT 1`,
        args: [key]
      });
      if (res.rows.length > 0) {
        return res.rows[0].value;
      }
    } catch (e) {
      console.error('[DB] Failed to fetch session from Turso:', e);
    }
    return '';
  }
  return null; // Signals file fallback in local JSON mode
}

async function saveSession(key, value) {
  if (libsqlClient) {
    try {
      await libsqlClient.execute({
        sql: `INSERT INTO sessions (key, value) VALUES (?, ?) 
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        args: [key, value]
      });
    } catch (e) {
      console.error('[DB] Failed to save session to Turso:', e);
    }
  }
}

async function deleteSession(key) {
  if (libsqlClient) {
    try {
      await libsqlClient.execute({
        sql: `DELETE FROM sessions WHERE key = ?`,
        args: [key]
      });
    } catch (e) {
      console.error('[DB] Failed to delete session on Turso:', e);
    }
  }
}

async function clearFinishedJobs() {
  if (libsqlClient) {
    try {
      await libsqlClient.execute("DELETE FROM jobs WHERE status IN ('done', 'error')");
      console.log('[DB] Turso SQL database cleared finished jobs.');
    } catch (e) {
      console.error('[DB] Failed to clear finished jobs on Turso:', e);
      throw e;
    }
  } else {
    try {
      const jobs = readJobsSync();
      const filtered = jobs.filter(j => j.status !== 'done' && j.status !== 'error');
      writeJobsSync(filtered);
      console.log('[DB] Local JSON database cleared finished jobs.');
    } catch (e) {
      console.error('[DB] Error clearing finished jobs:', e);
      throw e;
    }
  }
}

// Automatically initialize when file is loaded
(async () => {
  await initDb();
  await resetStuckJobs();
})();

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
  getRecentDuplicate,
  resetStuckJobs,
  getSession,
  saveSession,
  deleteSession,
  clearFinishedJobs
};
