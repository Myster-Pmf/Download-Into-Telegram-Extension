// VideoGrab - services/telegramClient.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bigInt = require('big-integer');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '../data');
const SESSION_PATH = path.join(DATA_DIR, 'session.json');

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

function loadSessionString() {
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

function saveSessionString(sessionString) {
  try {
    const dir = path.dirname(SESSION_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const encrypted = encrypt(sessionString);
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

  const sessionString = loadSessionString();
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

    const user = await client.signIn({
      phoneNumber: phoneToUse,
      phoneCodeHash: hashToUse,
      phoneCode: code
    });

    // Save session if successfully logged in
    const sessionString = client.session.save();
    saveSessionString(sessionString);
    return { status: 'success' };
  } catch (error) {
    if (error.name === 'SessionPasswordNeededError') {
      // 2FA required. Return hint
      return { 
        status: '2fa_required', 
        hint: error.hint || 'No hint provided by Telegram' 
      };
    }
    throw error;
  }
}

async function verify2fa(password) {
  const client = await getClient();
  const phoneToUse = tempLoginState.phone;

  await client.signIn({
    phoneNumber: phoneToUse,
    password: password
  });

  // Save session if successfully logged in
  const sessionString = client.session.save();
  saveSessionString(sessionString);

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

  // Delete session file
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

  await client.sendFile(entity, {
    file: filepath,
    forceDocument: false, // Send as native video if possible
    fileName: filename,
    caption: caption,
    progressCallback: (progressFloat) => {
      // Progress is a decimal between 0 and 1
      if (progressCallback) {
        progressCallback(progressFloat);
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
