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

async function apiGet(path, params = {}) {
  const query = new URLSearchParams(params).toString();
  const url = `${getApiBase()}${path}${query ? '?' + query : ''}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(9000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

async function getSuggestionGroups(title) {
  try {
    getSuggestionGroups.lastError = null;
    const res = await apiGet('/groups', { q: title });
    return Array.isArray(res) ? res : [];
  } catch (error) {
    console.warn('getSuggestionGroups failed:', error.message);
    getSuggestionGroups.lastError = error.message;
    return [];
  }
}

async function getSchedule(group, range = getTwoWeekRange()) {
  try {
    getSchedule.lastError = null;
    return await apiGet('/schedule', { group, ...(range || {}) });
  } catch (error) {
    console.warn('getSchedule failed:', error.message);
    getSchedule.lastError = error.message;
    return null;
  }
}

window.getSuggestionGroups = getSuggestionGroups;
window.getSchedule = getSchedule;
window.getTwoWeekRange = getTwoWeekRange;
