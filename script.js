/*
      ██╗          ██╗     ██╗
      ██║          ╚██╗   ██╔╝
      ██║           ╚██╗ ██╔╝ 
      ██║            ╚████╔╝  
      ██║             ╚██╔╝   
      ██║             ██╔██╗  
      ██║            ██╔╝ ╚██╗ 
      ██║           ██╔╝   ╚██╗
      ██████████╗  ██╔╝     ╚██╗
      ██████████║  ╚═╝       ╚═╝
      ╚═════════╝               
*/

const SCHEDULE_API = 'https://telegram2.korglosa.workers.dev';

const DEFAULT_KNOWN_GROUPS = [
  'ФЕП-11с', 'ФЕП-12с', 'ФЕП-13с',
  'ФЕП-21с', 'ФЕП-22с', 'ФЕП-23с',
  'ФЕП-31с', 'ФЕП-32с', 'ФЕП-33с',
  'ФЕП-41с', 'ФЕП-42с', 'ФЕП-43с',
  'ФЕП-11м', 'ФЕП-12м', 'ФЕП-21м'
];

function getApiBase() {
  try {
    return localStorage.getItem('_worker_url') || SCHEDULE_API;
  } catch {
    return SCHEDULE_API;
  }
}

function formatDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${date.getFullYear()}`;
}

function getTwoWeekRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); 
  const end = new Date(start);
  end.setDate(start.getDate() + 13);
  return { sdate: formatDate(start), edate: formatDate(end) };
}

function notifyNetworkStatus(isOnline, detail = '') {
  try {
    window.dispatchEvent(new CustomEvent('app-network-status', {
      detail: { isOnline, reason: detail }
    }));
  } catch(e) {}
}

async function apiGet(path, params = {}) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    notifyNetworkStatus(false, 'offline');
    throw new Error('Офлайн режим');
  }

  const query = new URLSearchParams(params).toString();
  const url = `${getApiBase()}${path}${query ? '?' + query : ''}`;

  try {
    // 4.5s adaptive timeout for snappy feel on weak networks
    const response = await fetch(url, { signal: AbortSignal.timeout(4500) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    notifyNetworkStatus(true);
    return data;
  } catch (err) {
    notifyNetworkStatus(false, err.name === 'TimeoutError' ? 'timeout' : 'error');
    throw err;
  }
}

async function getSuggestionGroups(title = '') {
  const q = (title || '').trim().toLowerCase();
  try {
    getSuggestionGroups.lastError = null;
    const res = await apiGet('/groups', { q: title });
    if (Array.isArray(res) && res.length > 0) {
      try {
        localStorage.setItem('sched_groups_list', JSON.stringify(res));
      } catch(e) {}
      return res;
    }
    return res || [];
  } catch (error) {
    console.warn('getSuggestionGroups failed:', error.message);
    getSuggestionGroups.lastError = error.message;

    // Offline / fallback cache
    try {
      const cached = JSON.parse(localStorage.getItem('sched_groups_list') || 'null');
      if (Array.isArray(cached) && cached.length > 0) {
        if (!q) return cached;
        return cached.filter(g => (typeof g === 'string' ? g : g.name || '').toLowerCase().includes(q));
      }
    } catch(e) {}

    // Fallback to default known groups
    if (!q) return DEFAULT_KNOWN_GROUPS;
    return DEFAULT_KNOWN_GROUPS.filter(g => g.toLowerCase().includes(q));
  }
}

async function getSchedule(group, range = getTwoWeekRange()) {
  try {
    getSchedule.lastError = null;
    const data = await apiGet('/schedule', { group, ...(range || {}) });
    return data;
  } catch (error) {
    console.warn('getSchedule failed:', error.message);
    getSchedule.lastError = error.message;
    return null;
  }
}

window.getSuggestionGroups = getSuggestionGroups;
window.getSchedule = getSchedule;
window.getTwoWeekRange = getTwoWeekRange;
