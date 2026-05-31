// VideoGrab - popup-utils.js
// Shared utility functions: formatting, toast, dialog, debounce

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) { size /= 1024; unitIndex++; }
  const precision = size >= 100 || unitIndex === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return '';
  const value = Number(bytesPerSec);
  if (!Number.isFinite(value)) return '';
  return formatBytes(value) + '/s';
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '';
  const s = Math.round(Number(seconds));
  if (!Number.isFinite(s)) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function formatRelativeTime(isoString) {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function showToast(message, type = 'info') {
  if (!elements.toastRegion) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  elements.toastRegion.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(6px)';
    setTimeout(() => toast.remove(), 220);
  }, 3200);
}

function showDialog({
  title = 'Confirm Action',
  message = '',
  detail = '',
  confirmText = 'OK',
  cancelText = 'Cancel',
  variant = 'warning',
  hideCancel = false
} = {}) {
  return new Promise((resolve) => {
    const dialog = elements.appDialog;
    if (!dialog) { resolve(!hideCancel); return; }

    elements.appDialogTitle.textContent = title;
    elements.appDialogMessage.textContent = message;
    elements.appDialogConfirm.textContent = confirmText;
    elements.appDialogCancel.textContent = cancelText;
    elements.appDialogCancel.style.display = hideCancel ? 'none' : 'inline-flex';

    const icons = { danger: ['!', 'rgba(239,68,68,0.14)', '#fca5a5'], success: ['✓', 'rgba(16,185,129,0.14)', 'var(--status-green)'], warning: ['!', 'rgba(245,158,11,0.14)', '#fbbf24'] };
    const [icon, bg, color] = icons[variant] || icons.warning;
    elements.appDialogIcon.textContent = icon;
    elements.appDialogIcon.style.background = bg;
    elements.appDialogIcon.style.color = color;

    if (detail) {
      elements.appDialogDetail.textContent = detail;
      elements.appDialogDetail.classList.add('active');
    } else {
      elements.appDialogDetail.textContent = '';
      elements.appDialogDetail.classList.remove('active');
    }

    const cleanup = (result) => {
      dialog.classList.remove('active');
      elements.appDialogConfirm.removeEventListener('click', onConfirm);
      elements.appDialogCancel.removeEventListener('click', onCancel);
      dialog.removeEventListener('click', onOverlay);
      resolve(result);
    };
    const onConfirm = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onOverlay = (e) => { if (e.target === dialog && !hideCancel) cleanup(false); };

    elements.appDialogConfirm.addEventListener('click', onConfirm);
    elements.appDialogCancel.addEventListener('click', onCancel);
    dialog.addEventListener('click', onOverlay);
    dialog.classList.add('active');
  });
}

/** Check if any jobs are currently active (queued/downloading/uploading) */
async function hasActiveTransfers() {
  try {
    const res = await fetch(`${getBackendUrl()}/jobs?limit=25`, {
      headers: { 'X-API-Key': getApiKey() }
    });
    if (!res.ok) return activeJobsMap.size > 0;
    const jobs = await res.json();
    return jobs.some(j => ['queued', 'downloading', 'downloaded', 'uploading'].includes(String(j.status).toLowerCase()));
  } catch {
    return activeJobsMap.size > 0;
  }
}
