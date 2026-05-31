// VideoGrab - popup-telegram.js
// Telegram auth wizard step navigation and action handlers

// --- Step visibility helpers ---
function showTgStep(stepName) {
  ['authStepPhone', 'authStepOtp', 'authStep2fa', 'authStepLogged'].forEach(key => {
    const el = elements[key];
    if (el) el.classList.toggle('active', key === stepName);
  });
}

function setTgBusy(btn, loading, defaultText) {
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? 'Please wait…' : defaultText;
}

// --- Auth status check ---
async function checkTelegramLoginStatus() {
  const card  = elements.tgStatusCard;
  const badge = elements.tgStatusBadge;
  const text  = elements.tgStatusText;

  if (card)  card.className  = 'tg-status-card checking';
  if (badge) badge.className = 'tg-badge checking';
  if (badge) badge.textContent = '…';
  if (text)  text.textContent  = 'Checking Telegram status…';

  try {
    const res = await fetch(`${getBackendUrl()}/telegram/status`, {
      headers: { 'X-API-Key': getApiKey() }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    telegramLoggedIn = !!data.loggedIn;

    if (telegramLoggedIn) {
      if (card)  card.className  = 'tg-status-card logged-in';
      if (badge) badge.className = 'tg-badge online';
      if (badge) badge.textContent = '✓';
      if (text) {
        const name = data.firstName ? `${data.firstName}${data.lastName ? ' ' + data.lastName : ''}` : 'Unknown';
        const phone = data.phone ? ` · ${data.phone}` : '';
        text.textContent = `Logged in as ${name}${phone}`;
      }
      showTgStep('authStepLogged');
    } else {
      if (card)  card.className  = 'tg-status-card logged-out';
      if (badge) badge.className = 'tg-badge offline';
      if (badge) badge.textContent = '✗';
      if (text)  text.textContent  = 'Not logged in — use the form below to connect.';
      showTgStep('authStepPhone');
    }
  } catch (e) {
    telegramLoggedIn = false;
    if (card)  card.className  = 'tg-status-card error';
    if (badge) badge.className = 'tg-badge error';
    if (badge) badge.textContent = '!';
    if (text) {
      if (e.message.includes('401')) {
        text.textContent = 'Unauthorized (401) · Please verify your API Key in the Settings tab.';
      } else {
        text.textContent = `Could not reach backend: ${e.message}`;
      }
    }
    showTgStep('authStepPhone');
  }
}

// --- Send OTP ---
async function sendOtp() {
  const phone = elements.tgPhone ? elements.tgPhone.value.trim() : '';
  if (!phone) {
    showToast('Enter your phone number first.', 'warning');
    return;
  }

  setTgBusy(elements.tgSendOtpBtn, true, 'Send Code');
  try {
    const res = await fetch(`${getBackendUrl()}/telegram/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': getApiKey() },
      body:    JSON.stringify({ phone })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    // Store phoneCodeHash globally and persist in local storage
    tgPhoneCodeHash = data.phoneCodeHash || '';
    chrome.storage.local.set({ tgPhoneCodeHash });

    showToast('Code sent! Check your Telegram app.', 'success');
    showTgStep('authStepOtp');
  } catch (e) {
    showToast(`Failed: ${e.message}`, 'error');
  } finally {
    setTgBusy(elements.tgSendOtpBtn, false, 'Send Code');
  }
}

// --- Verify OTP ---
async function verifyOtp() {
  const otp   = elements.tgOtp   ? elements.tgOtp.value.trim()   : '';
  const phone = elements.tgPhone ? elements.tgPhone.value.trim() : '';

  if (!otp) {
    showToast('Enter the code you received.', 'warning');
    return;
  }

  setTgBusy(elements.tgVerifyOtpBtn, true, 'Verify Code');
  try {
    const res = await fetch(`${getBackendUrl()}/telegram/otp`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': getApiKey() },
      body:    JSON.stringify({ phone, code: otp, phoneCodeHash: tgPhoneCodeHash })
    });
    const data = await res.json();

    if (!res.ok) {
      // 2FA required
      if (res.status === 202 || data.need2fa) {
        if (elements.tg2faHint && data.hint) elements.tg2faHint.textContent = `Hint: ${data.hint}`;
        showTgStep('authStep2fa');
        return;
      }
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    // Clear saved phoneCodeHash upon successful login
    tgPhoneCodeHash = '';
    chrome.storage.local.remove('tgPhoneCodeHash');

    showToast('Logged in to Telegram!', 'success');
    await checkTelegramLoginStatus();
    // Auto-load chats after login
    await refreshChatList();
  } catch (e) {
    showToast(`Verification failed: ${e.message}`, 'error');
  } finally {
    setTgBusy(elements.tgVerifyOtpBtn, false, 'Verify Code');
  }
}

// --- Verify 2FA ---
async function verify2fa() {
  const password = elements.tgPassword ? elements.tgPassword.value : '';
  if (!password) {
    showToast('Enter your 2FA password.', 'warning');
    return;
  }

  setTgBusy(elements.tgVerify2faBtn, true, 'Confirm');
  try {
    const res = await fetch(`${getBackendUrl()}/telegram/2fa`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': getApiKey() },
      body:    JSON.stringify({ password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    // Clear saved phoneCodeHash upon successful login
    tgPhoneCodeHash = '';
    chrome.storage.local.remove('tgPhoneCodeHash');

    showToast('2FA verified! Logged in.', 'success');
    await checkTelegramLoginStatus();
    await refreshChatList();
  } catch (e) {
    showToast(`2FA failed: ${e.message}`, 'error');
  } finally {
    setTgBusy(elements.tgVerify2faBtn, false, 'Confirm');
  }
}

// --- Logout ---
async function logoutTelegram() {
  const ok = await showDialog({
    title:       'Log Out',
    message:     'Log out of Telegram on this backend? Active uploads may fail.',
    confirmText: 'Log Out',
    variant:     'danger'
  });
  if (!ok) return;

  setTgBusy(elements.tgLogoutBtn, true, 'Log Out');
  try {
    const res = await fetch(`${getBackendUrl()}/telegram/logout`, {
      method:  'POST',
      headers: { 'X-API-Key': getApiKey() }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    telegramLoggedIn = false;
    showToast('Logged out of Telegram.', 'info');
    await checkTelegramLoginStatus();
  } catch (e) {
    showToast(`Logout failed: ${e.message}`, 'error');
  } finally {
    setTgBusy(elements.tgLogoutBtn, false, 'Log Out');
  }
}

/** Wire up all Telegram tab events */
function initTelegramEvents() {
  if (elements.tgSendOtpBtn)    elements.tgSendOtpBtn.addEventListener('click',    sendOtp);
  if (elements.tgVerifyOtpBtn)  elements.tgVerifyOtpBtn.addEventListener('click',  verifyOtp);
  if (elements.tgVerify2faBtn)  elements.tgVerify2faBtn.addEventListener('click',  verify2fa);
  if (elements.tgLogoutBtn)     elements.tgLogoutBtn.addEventListener('click',     logoutTelegram);

  // Back buttons
  if (elements.tgBackPhoneBtn) {
    elements.tgBackPhoneBtn.addEventListener('click', () => showTgStep('authStepPhone'));
  }
  if (elements.tgBackOtpBtn) {
    elements.tgBackOtpBtn.addEventListener('click', () => showTgStep('authStepOtp'));
  }

  // Allow pressing Enter to advance the wizard
  if (elements.tgPhone) {
    elements.tgPhone.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendOtp(); });
  }
  if (elements.tgOtp) {
    elements.tgOtp.addEventListener('keydown', (e) => { if (e.key === 'Enter') verifyOtp(); });
  }
  if (elements.tgPassword) {
    elements.tgPassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') verify2fa(); });
  }
}
