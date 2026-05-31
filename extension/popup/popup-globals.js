// VideoGrab - popup-globals.js
// Global constants, state, and DOM element map

const DEFAULT_BACKEND_URL = 'https://lightx99-downloadintotelegram.hf.space';
const DEFAULT_API_KEY = 'omnitrix2.0';

const DEFAULT_SETTINGS = {
  backendUrl: '',        // empty = use DEFAULT_BACKEND_URL
  apiKey: '',            // empty = use DEFAULT_API_KEY
  tgTarget: '',
  quality: 'best',
  autoMatch: 'true',
  defaultUa: navigator.userAgent,
  ytdlpFlags: ''
};

let activeSettings = { ...DEFAULT_SETTINGS };
let detectedVideosList = [];
let siteProfiles = [];
let globalCookiesText = '';
let globalUserAgent = navigator.userAgent;
let liveCookiesText = '';
let telegramLoggedIn = false;
let activeTabUrl = '';
let activeTabExactUrl = '';  // full URL including path, for exact-page filtering
let tgPhoneCodeHash = '';    // stored OTP code hash

// Active download polling timers (jobId => intervalId)
const activePolls = new Map();
const videoInfoCache = new Map();
const activeJobsMap = new Map();

/** Returns the effective backend URL (falling back to default if blank, trailing slashes stripped) */
function getBackendUrl() {
  const url = (activeSettings.backendUrl || '').trim() || DEFAULT_BACKEND_URL;
  return url.replace(/\/+$/, '');
}

/** Returns the effective API key (falling back to default if blank) */
function getApiKey() {
  return (activeSettings.apiKey || '').trim() || DEFAULT_API_KEY;
}

// --- DOM Element Map ---
const elements = {
  backendStatus: document.getElementById('backend-status'),
  videosList: document.getElementById('videos-list'),
  customProfilesList: document.getElementById('custom-profiles-list'),
  historyList: document.getElementById('history-list'),

  // Settings Form
  settingsForm: document.getElementById('settings-form'),
  settBackendUrl: document.getElementById('sett-backend-url'),
  settApiKey: document.getElementById('sett-api-key'),
  settQuality: document.getElementById('sett-quality'),
  settAutoMatch: document.getElementById('sett-auto-match'),
  settDefaultUa: document.getElementById('sett-default-ua'),
  settYtdlpFlags: document.getElementById('sett-ytdlp-flags'),
  settTgTargetInfo: document.getElementById('sett-tg-target-info'),

  // Global Profile elements
  globalCookies: document.getElementById('global-cookies'),
  globalCookieFile: document.getElementById('global-cookie-file'),
  globalUa: document.getElementById('global-ua'),
  saveGlobalProfileBtn: document.getElementById('save-global-profile-btn'),
  globalCookieStatus: document.getElementById('global-cookie-status'),
  globalRefreshCookiesBtn: document.getElementById('global-refresh-cookies-btn'),
  globalEditCookiesBtn: document.getElementById('global-edit-cookies-btn'),
  globalDownloadCookiesBtn: document.getElementById('global-download-cookies-btn'),
  globalCookieEditor: document.getElementById('global-cookie-editor'),
  globalCookieMismatchHint: document.getElementById('global-cookie-mismatch-hint'),
  globalRestoreLiveBtn: document.getElementById('global-restore-live-btn'),
  profLiveCookieStatus: document.getElementById('prof-live-cookie-status'),
  profSyncCookiesBtn: document.getElementById('prof-sync-cookies-btn'),

  // Telegram Wizard steps
  tgStatusCard: document.getElementById('tg-status-card'),
  tgStatusBadge: document.getElementById('tg-status-badge'),
  tgStatusText: document.getElementById('tg-status-text'),

  authStepPhone: document.getElementById('auth-step-phone'),
  authStepOtp: document.getElementById('auth-step-otp'),
  authStep2fa: document.getElementById('auth-step-2fa'),
  authStepLogged: document.getElementById('auth-step-logged'),

  tgPhone: document.getElementById('tg-phone'),
  tgOtp: document.getElementById('tg-otp'),
  tgPassword: document.getElementById('tg-password'),
  tg2faHint: document.getElementById('tg-2fa-hint'),

  // Telegram action buttons
  tgSendOtpBtn: document.getElementById('tg-send-otp-btn'),
  tgVerifyOtpBtn: document.getElementById('tg-verify-otp-btn'),
  tgVerify2faBtn: document.getElementById('tg-verify-2fa-btn'),
  tgLogoutBtn: document.getElementById('tg-logout-btn'),
  tgBackPhoneBtn: document.getElementById('tg-back-phone-btn'),
  tgBackOtpBtn: document.getElementById('tg-back-otp-btn'),
  tgTargetSelect: document.getElementById('tg-target-select'),
  tgTargetCustom: document.getElementById('tg-target-custom'),
  tgRefreshChatsBtn: document.getElementById('tg-refresh-chats-btn'),
  tgSaveTargetBtn: document.getElementById('tg-save-target-btn'),

  // Custom Profile Modal
  profileModal: document.getElementById('profile-modal'),
  modalTitle: document.getElementById('modal-title'),
  profileForm: document.getElementById('profile-form'),
  profileId: document.getElementById('profile-id'),
  profName: document.getElementById('prof-name'),
  profPattern: document.getElementById('prof-pattern'),
  profCookies: document.getElementById('prof-cookies'),
  profCookieFile: document.getElementById('prof-cookie-file'),
  profOrigin: document.getElementById('prof-origin'),
  profReferer: document.getElementById('prof-referer'),
  profUa: document.getElementById('prof-ua'),
  closeModalBtn: document.getElementById('close-modal-btn'),
  newProfileBtn: document.getElementById('new-profile-btn'),

  clearVideosBtn: document.getElementById('clear-videos-btn'),
  refreshHistoryBtn: document.getElementById('refresh-history-btn'),
  clearHistoryBtn: document.getElementById('clear-history-btn'),
  scopeTabCheckbox: document.getElementById('scope-tab-checkbox'),
  toastRegion: document.getElementById('toast-region'),
  appDialog: document.getElementById('app-dialog'),
  appDialogIcon: document.getElementById('app-dialog-icon'),
  appDialogTitle: document.getElementById('app-dialog-title'),
  appDialogMessage: document.getElementById('app-dialog-message'),
  appDialogDetail: document.getElementById('app-dialog-detail'),
  appDialogCancel: document.getElementById('app-dialog-cancel'),
  appDialogConfirm: document.getElementById('app-dialog-confirm')
};

// --- Glob to Regex ---
function globToRegex(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + escaped.replace(/\*/g, '.*') + '$', 'i');
}

// --- Domain Matcher ---
function matchProfileForUrl(videoUrl) {
  if (activeSettings.autoMatch === 'false') return null;
  try {
    const hostname = new URL(videoUrl).hostname;
    for (const profile of siteProfiles) {
      if (!profile.domainPattern) continue;
      if (globToRegex(profile.domainPattern).test(hostname)) return profile;
    }
  } catch (e) { /* ignore */ }
  return null;
}

function getDomain(urlStr) {
  try { return new URL(urlStr).hostname; } catch (e) { return ''; }
}
