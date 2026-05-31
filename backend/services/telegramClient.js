// VideoGrab - services/telegramClient.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bigInt = require('big-integer');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');
const { computeCheck } = require('telegram/Password');
const db = require('./db');

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '../data');
const SESSION_PATH = path.join(DATA_DIR, 'session.json');
const SESSION_DB_KEY = 'telegram_session';

// Memory storage for ongoing logins
let clientInstance = null;
let tempLoginState = {
  phone: '',
  phoneCodeHash: ''
};

// AES encryption setup
function getEncryptionKey() {
  const key = process.env.SESSION_ENCRYPT_KEY || 'default_key_32_chars_long_1234567';
  return crypto.createHash('sha256').update(key).digest();
}

function encrypt(text) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
  try {
    const key = getEncryptionKey();
    const parts = text.split(':');
    const iv = Buffer.from(parts.shift(), 'hex');
    const encryptedText = Buffer.from(parts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    console.error('[Telegram] Failed to decrypt session:', e);
    return '';
  }
}

async function loadSessionString() {
  // 1. Try remote Turso DB first (returns '' empty string if not found, null if DB unavailable)
  const dbResult = await db.getSession(SESSION_DB_KEY);
  if (dbResult !== null) {
    // DB mode: result is either a session string or '' (empty = not found)
    if (dbResult) {
      try {
        return decrypt(dbResult);
      } catch (e) {
        console.error('[Telegram] Failed to decrypt session from database:', e);
      }
    }
    return '';
  }

  // 2. File fallback (local JSON mode — db.getSession returned null)
  if (fs.existsSync(SESSION_PATH)) {
    try {
      const raw = fs.readFileSync(SESSION_PATH, 'utf8');
      const data = JSON.parse(raw);
      if (data.encryptedSession) {
        return decrypt(data.encryptedSession);
      }
    } catch (e) {
      console.error('[Telegram] Error reading session file:', e);
    }
  }
  return '';
}

async function saveSessionString(sessionString) {
  const encrypted = encrypt(sessionString);

  // 1. Always save to database if available
  await db.saveSession(SESSION_DB_KEY, encrypted);

  // 2. Also save to local file as fallback
  try {
    const dir = path.dirname(SESSION_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SESSION_PATH, JSON.stringify({ encryptedSession: encrypted }, null, 2));
  } catch (e) {
    console.error('[Telegram] Error saving session file:', e);
  }
}

async function getClient() {
  if (clientInstance) {
    return clientInstance;
  }

  const apiId = parseInt(process.env.TELEGRAM_API_ID, 10);
  const apiHash = process.env.TELEGRAM_API_HASH;

  if (!apiId || !apiHash) {
    throw new Error('TELEGRAM_API_ID or TELEGRAM_API_HASH is missing from environment.');
  }

  const sessionString = await loadSessionString();
  const session = new StringSession(sessionString);

  clientInstance = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5
  });

  await clientInstance.connect();
  console.log('[Telegram] Client connected.');

  return clientInstance;
}

async function checkLoginStatus() {
  try {
    const client = await getClient();
    const loggedIn = await client.isUserAuthorized();
    let username = null;
    if (loggedIn) {
      const me = await client.getMe();
      username = me.username || me.firstName || 'User';
    }
    return { loggedIn, username };
  } catch (e) {
    console.error('[Telegram] Check status error:', e);
    return { loggedIn: false, username: null };
  }
}

async function sendOtp(phone) {
  const client = await getClient();
  const apiId = parseInt(process.env.TELEGRAM_API_ID, 10);
  const apiHash = process.env.TELEGRAM_API_HASH;
  
  const result = await client.sendCode(
    { apiId, apiHash },
    phone
  );

  tempLoginState = {
    phone: phone,
    phoneCodeHash: result.phoneCodeHash
  };

  return result.phoneCodeHash;
}

async function verifyOtp(phone, phoneCodeHash, code) {
  const client = await getClient();
  try {
    const phoneToUse = phone || tempLoginState.phone;
    const hashToUse = phoneCodeHash || tempLoginState.phoneCodeHash;

    // Use raw MTProto Api.auth.SignIn (GramJS 2.x has no client.signIn)
    await client.invoke(
      new Api.auth.SignIn({
        phoneNumber: phoneToUse,
        phoneCodeHash: hashToUse,
        phoneCode: code
      })
    );

    // Save session on success
    const sessionString = client.session.save();
    await saveSessionString(sessionString);
    return { status: 'success' };
  } catch (error) {
    // GramJS raises an RPC error with errorMessage 'SESSION_PASSWORD_NEEDED'
    if (error.errorMessage === 'SESSION_PASSWORD_NEEDED') {
      // Fetch the 2FA password hint from Telegram
      let hint = 'No hint available';
      try {
        const srpResult = await client.invoke(new Api.account.GetPassword());
        hint = srpResult.hint || hint;
      } catch (e) {
        console.error('[Telegram] Failed to fetch 2FA hint:', e);
      }
      return {
        status: '2fa_required',
        hint: hint
      };
    }
    throw error;
  }
}

async function verify2fa(password) {
  const client = await getClient();

  // 1. Fetch the SRP parameters from Telegram
  const srpResult = await client.invoke(new Api.account.GetPassword());

  // 2. Compute the SRP check using the user's password
  const srpCheck = await computeCheck(srpResult, password);

  // 3. Submit the password via MTProto
  await client.invoke(new Api.auth.CheckPassword({ password: srpCheck }));

  // 4. Save session on success
  const sessionString = client.session.save();
  await saveSessionString(sessionString);

  const me = await client.getMe();
  return {
    status: 'success',
    username: me.username || me.firstName || 'User'
  };
}

async function logout() {
  const client = await getClient();
  try {
    await client.logOut();
  } catch (e) {
    console.error('[Telegram] Error calling logOut:', e);
  }

  // Delete session from database
  await db.deleteSession(SESSION_DB_KEY);

  // Delete local session file
  if (fs.existsSync(SESSION_PATH)) {
    fs.unlinkSync(SESSION_PATH);
  }

  // Reset client instance
  clientInstance = null;
  tempLoginState = { phone: '', phoneCodeHash: '' };
  
  return { status: 'logged_out' };
}

async function uploadFile(target, filepath, filename, caption, progressCallback) {
  const client = await getClient();
  
  // Resolve the target entity (group or channel)
  let entity;
  try {
    if (target.startsWith('-100')) {
      entity = await client.getEntity(bigInt(target));
    } else if (/^\-?\d+$/.test(target)) {
      entity = await client.getEntity(bigInt(target));
    } else {
      entity = await client.getEntity(target);
    }
  } catch (e) {
    throw new Error(`Could not resolve Telegram target "${target}": ${e.message}`);
  }

  console.log(`[Telegram] Starting file upload of ${filename} to ${target}...`);

  let lastProgress = 0;
  let lastTime = Date.now();
  let fileInfo = fs.statSync(filepath);
  let totalBytes = fileInfo.size;
  let lastSpeed = '';

  await client.sendFile(entity, {
    file: filepath,
    forceDocument: false, // Send as native video if possible
    fileName: filename,
    caption: caption,
    progressCallback: (progressFloat) => {
      const now = Date.now();
      const timeElapsed = (now - lastTime) / 1000; // seconds
      
      if (timeElapsed >= 1.0 || progressFloat === 1.0) {
        const bytesUploaded = progressFloat * totalBytes;
        const bytesDiff = bytesUploaded - (lastProgress * totalBytes);
        const speedBps = timeElapsed > 0 ? bytesDiff / timeElapsed : 0;
        
        if (speedBps > 1024 * 1024) {
          lastSpeed = `${(speedBps / (1024 * 1024)).toFixed(2)} MB/s`;
        } else if (speedBps > 1024) {
          lastSpeed = `${(speedBps / 1024).toFixed(1)} KB/s`;
        } else if (speedBps > 0) {
          lastSpeed = `${Math.round(speedBps)} B/s`;
        }
        
        lastProgress = progressFloat;
        lastTime = now;
      }
      
      if (progressCallback) {
        progressCallback(progressFloat, lastSpeed);
      }
    }
  });

  console.log(`[Telegram] Successfully uploaded ${filename}.`);
}

async function getChats() {
  const client = await getClient();
  const loggedIn = await client.isUserAuthorized();
  if (!loggedIn) {
    throw new Error('Telegram client is not authorized.');
  }

  const dialogs = await client.getDialogs({});
  return dialogs
    .filter(d => d.isGroup || d.isChannel)
    .map(d => {
      let type = 'Group';
      if (d.isChannel) type = 'Channel';
      return {
        id: d.id.toString(),
        title: d.title || 'Untitled',
        type: type,
        username: d.entity && d.entity.username ? `@${d.entity.username}` : null
      };
    });
}

module.exports = {
  checkLoginStatus,
  sendOtp,
  verifyOtp,
  verify2fa,
  logout,
  uploadFile,
  getChats
};
