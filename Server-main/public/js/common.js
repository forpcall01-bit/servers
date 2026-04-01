const COMMON = {
  get token() { return localStorage.getItem('gz_token'); },
  set token(v) { localStorage.setItem('gz_token', v); },
  get user() { try { return JSON.parse(localStorage.getItem('gz_user') || 'null'); } catch { return null; } },
  set user(v) { localStorage.setItem('gz_user', JSON.stringify(v)); },
  get serverUrl() { return localStorage.getItem('gz_server') || ''; },
  set serverUrl(v) { localStorage.setItem('gz_server', v); },
};

function requireAuth() {
  if (!COMMON.token || !COMMON.user) {
    window.location.href = '/';
    return false;
  }
  return true;
}

async function api(method, path, body) {
  const res = await fetch(COMMON.serverUrl + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(COMMON.token ? { Authorization: 'Bearer ' + COMMON.token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const contentType = res.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) throw new Error('Server returned invalid response');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function toast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast ' + type + ' show';
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

function fmtTime(secs) {
  if (secs <= 0) return '00:00';
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function openSheet(id) {
  const sheet = document.getElementById(id);
  const bg = document.getElementById('bg-' + id.replace('sheet-', ''));
  if (sheet) sheet.classList.add('open');
  if (bg) bg.classList.add('open');
}

function closeSheet(id) {
  const sheet = document.getElementById(id);
  const bg = document.getElementById('bg-' + id.replace('sheet-', ''));
  if (sheet) sheet.classList.remove('open');
  if (bg) bg.classList.remove('open');
}

function showModal(title, message, action) {
  const titleEl = document.getElementById('modal-title');
  const msgEl = document.getElementById('modal-message');
  const confirmBtn = document.getElementById('modal-confirm-btn');
  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  if (confirmBtn) {
    confirmBtn.className = action === 'sleep' ? 'modal-btn confirm sleep' : 'modal-btn confirm';
    confirmBtn.textContent = 'Confirm';
  }
  const modal = document.getElementById('confirm-modal');
  if (modal) modal.classList.add('active');
  window._pendingAction = action;
}

function closeModal() {
  const modal = document.getElementById('confirm-modal');
  if (modal) modal.classList.remove('active');
  window._pendingAction = null;
}

async function executeAction() {
  const action = window._pendingAction;
  if (!action) return closeModal();
  closeModal();
  try {
    await api('POST', '/pcs/' + window.currentPcId + '/' + action, { group_id: window.currentGroupId });
    toast(action.charAt(0).toUpperCase() + action.slice(1) + ' command sent', 'ok');
  } catch (e) {
    toast(e.message || 'Command failed', 'err');
  }
}

function confirmAction(action) {
  if (!window.currentPcId) { toast('No PC selected', 'err'); return; }
  window._pendingAction = action;
  const pcName = window.currentPcName || 'PC';
  if (action === 'sleep') {
    showModal('Put PC to Sleep?', `Put ${pcName} to sleep?\n\n\u26a0\ufe0f This will interrupt any active session.`, 'sleep');
  } else if (action === 'shutdown') {
    showModal('Shutdown PC?', `Shutdown ${pcName}?\n\n\u26a0\ufe0f This will end all sessions and turn off the PC.\nThis cannot be undone.`, 'shutdown');
  }
}

function getPrefs() {
  try { return JSON.parse(localStorage.getItem('gz_prefs') || '{}'); } catch { return {}; }
}

function togglePref(key) {
  const prefs = getPrefs();
  prefs[key] = !prefs[key];
  localStorage.setItem('gz_prefs', JSON.stringify(prefs));
  applyPrefs();
}

function applyPrefs() {
  const prefs = getPrefs();
  const addGroupFab = document.querySelector('#screen-groups .fab, .fab[data-action="newgroup"]');
  const addPcFab = document.querySelector('#screen-dashboard .fab, .fab[data-action="addpc"]');
  if (addGroupFab) addGroupFab.style.display = prefs.hideAddGroup ? 'none' : '';
  if (addPcFab) addPcFab.style.display = prefs.hideAddPC ? 'none' : '';
  ['hideAddGroup', 'hideAddPC'].forEach(key => {
    const el = document.getElementById('pref-' + key);
    if (!el) return;
    const on = !!prefs[key];
    el.style.background = on ? 'var(--green)' : 'var(--s4)';
    const dot = el.querySelector('div');
    if (dot) dot.style.transform = on ? 'translateX(16px)' : 'translateX(0)';
  });
}

function getGroupRate(groupId) {
  if (!groupId) return 5;
  try {
    const rates = JSON.parse(localStorage.getItem('gz_group_rates') || '{}');
    return rates[groupId] || 5;
  } catch { return 5; }
}

function saveGroupRate(groupId, rate) {
  try {
    const rates = JSON.parse(localStorage.getItem('gz_group_rates') || '{}');
    rates[groupId] = rate;
    localStorage.setItem('gz_group_rates', JSON.stringify(rates));
  } catch (e) { toast('Failed to save', 'err'); }
}

const _LH_KEY = 'gz_history_';
function lhGet(pcId) { try { return JSON.parse(localStorage.getItem(_LH_KEY + pcId) || '[]'); } catch { return []; } }
function lhSet(pcId, entries, socket, groupId) {
  localStorage.setItem(_LH_KEY + pcId, JSON.stringify(entries.slice(0, 5)));
  if (socket && groupId) {
    socket.emit('admin:history-update', { group_id: groupId, pc_id: pcId, history: entries.slice(0, 5) });
  }
}
function lhAdd(pcId, entry, socket, groupId) {
  const h = lhGet(pcId);
  h.unshift(entry);
  lhSet(pcId, h, socket, groupId);
}

function doLogout() {
  if (!confirm('Logout?')) return;
  localStorage.removeItem('gz_token');
  localStorage.removeItem('gz_user');
  localStorage.removeItem('gz_server');
  window.location.href = '/';
}

function checkExpiryWarning() {
  const expiry = COMMON.user?.expiry_date;
  const banner = document.getElementById('expiry-banner');
  if (!banner) return;
  if (!expiry) { banner.style.display = 'none'; return; }
  const daysLeft = Math.ceil((expiry - Date.now()) / 86400000);
  if (daysLeft > 0 && daysLeft <= 5) {
    banner.style.display = 'flex';
    const daysEl = document.getElementById('expiry-days');
    if (daysEl) daysEl.textContent = daysLeft;
  } else {
    banner.style.display = 'none';
  }
}
